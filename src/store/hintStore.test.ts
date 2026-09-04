import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HINT_STORAGE_KEY,
  LARGE_GRAPH_HINT_DELAY_MS,
  POST_TOUR_COOLDOWN_MS,
  __resetHintTimers,
  useHintStore,
} from './hintStore'
import { useTourStore } from './tourStore'

// docs/contextual-inline-help.md §CIH8 — hintStore unit boundary. (vitest env
// is `node`, no jsdom — Map-backed localStorage, like tourStore.test.ts.)

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
let mem: MemStorage

const reset = () => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  __resetHintTimers()
  useHintStore.setState({
    seen: {},
    hasInteracted: false,
    largeGraphDelayElapsed: false,
    postTourCooldownActive: false,
  })
  useTourStore.setState({ phase: 'idle', step: 0, platform: 'desktop', replay: false, appSettled: false })
}

beforeEach(reset)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const run = () => useHintStore.getState()

describe('hintStore — seen / markSeen / rearm (§CIH2.1a / §CIH4)', () => {
  it('nothing is seen by default', () => {
    expect(run().seen).toEqual({})
  })

  it('markSeen records the hint and persists it', () => {
    run().markSeen('empty-canvas')
    expect(run().seen).toEqual({ 'empty-canvas': true })
    expect(JSON.parse(mem.getItem(HINT_STORAGE_KEY)!)).toEqual({ 'empty-canvas': true })
  })

  it('markSeen is a no-op once already seen (no redundant write)', () => {
    run().markSeen('mc-first-open')
    const setItemSpy = vi.spyOn(mem, 'setItem')
    run().markSeen('mc-first-open')
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('marking one hint seen does not affect another', () => {
    run().markSeen('review-first-open')
    expect(run().seen).toEqual({ 'review-first-open': true })
    expect(run().seen['focus-filter-discovery']).toBeUndefined()
  })

  it('rearm clears just the one id, leaving the rest seen', () => {
    run().markSeen('empty-canvas')
    run().markSeen('mc-first-open')
    run().rearm('empty-canvas')
    expect(run().seen).toEqual({ 'mc-first-open': true })
    expect(JSON.parse(mem.getItem(HINT_STORAGE_KEY)!)).toEqual({ 'mc-first-open': true })
  })

  it('rearm on a hint never seen is a no-op', () => {
    const setItemSpy = vi.spyOn(mem, 'setItem')
    run().rearm('focus-filter-discovery')
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(run().seen).toEqual({})
  })

  it('a localStorage write failure is non-fatal — in-memory state still updates', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => run().markSeen('empty-canvas')).not.toThrow()
    expect(run().seen).toEqual({ 'empty-canvas': true })
  })
})

describe('hintStore — reading a corrupt/absent stored value (§CIH8, §GT6.3 precedent)', () => {
  const freshStore = async () => {
    vi.resetModules()
    const mod = await import('./hintStore')
    return mod.useHintStore.getState()
  }

  it('an absent key reads as nothing seen', async () => {
    vi.stubGlobal('localStorage', new MemStorage())
    expect((await freshStore()).seen).toEqual({})
  })

  it('an unparsable value reads as nothing seen, never as a lockout', async () => {
    const m = new MemStorage()
    m.setItem(HINT_STORAGE_KEY, 'not json')
    vi.stubGlobal('localStorage', m)
    expect((await freshStore()).seen).toEqual({})
  })

  it('a non-object JSON value (array, number) reads as nothing seen', async () => {
    for (const bad of ['[1,2,3]', '42', '"hi"', 'null']) {
      const m = new MemStorage()
      m.setItem(HINT_STORAGE_KEY, bad)
      vi.stubGlobal('localStorage', m)
      expect((await freshStore()).seen).toEqual({})
    }
  })

  it('a read that throws is caught, not propagated', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect((await freshStore()).seen).toEqual({})
  })

  it('non-true values in the stored object are dropped', async () => {
    const m = new MemStorage()
    m.setItem(HINT_STORAGE_KEY, JSON.stringify({ 'empty-canvas': true, 'mc-first-open': false, junk: 'x' }))
    vi.stubGlobal('localStorage', m)
    expect((await freshStore()).seen).toEqual({ 'empty-canvas': true })
  })
})

describe('hintStore — session-only interaction flag (§CIH3 #4)', () => {
  it('hasInteracted starts false and latches true on markInteracted', () => {
    expect(run().hasInteracted).toBe(false)
    run().markInteracted()
    expect(run().hasInteracted).toBe(true)
  })

  it('markInteracted is idempotent', () => {
    run().markInteracted()
    expect(() => run().markInteracted()).not.toThrow()
    expect(run().hasInteracted).toBe(true)
  })
})

describe('hintStore — post-tour cooldown (§CIH2.3a)', () => {
  it('is inactive before the tour ever runs', () => {
    expect(run().postTourCooldownActive).toBe(false)
  })

  it('activates when the tour goes from an active phase back to idle, then clears after the window', () => {
    vi.useFakeTimers()
    useTourStore.setState({ phase: 'running' })
    useTourStore.setState({ phase: 'idle' })
    expect(run().postTourCooldownActive).toBe(true)
    vi.advanceTimersByTime(POST_TOUR_COOLDOWN_MS - 1)
    expect(run().postTourCooldownActive).toBe(true)
    vi.advanceTimersByTime(1)
    expect(run().postTourCooldownActive).toBe(false)
  })

  it('does not activate on a phase change that never leaves idle', () => {
    useTourStore.setState({ phase: 'idle' })
    expect(run().postTourCooldownActive).toBe(false)
  })
})

describe('hintStore — large-graph interaction-or-delay gate (§CIH3 #4)', () => {
  it('the delay clock starts once appSettled flips true, and elapses after LARGE_GRAPH_HINT_DELAY_MS', () => {
    vi.useFakeTimers()
    expect(run().largeGraphDelayElapsed).toBe(false)
    useTourStore.setState({ appSettled: true })
    vi.advanceTimersByTime(LARGE_GRAPH_HINT_DELAY_MS - 1)
    expect(run().largeGraphDelayElapsed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(run().largeGraphDelayElapsed).toBe(true)
  })
})
