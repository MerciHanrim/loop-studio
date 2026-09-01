import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTourSession,
  TOUR_STORAGE_KEY,
  TOUR_TOTAL,
  readTourKey,
  useTourStore,
} from './tourStore'

// docs/guided-tour.md §GT6.4 — the exit-state transition table; §GT6.3 —
// localStorage failure is non-fatal. (vitest env is `node` — Map-backed store.)

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
  __resetTourSession()
  useTourStore.setState({ phase: 'idle', step: 0, platform: 'desktop', replay: false, appSettled: false })
}

beforeEach(reset)
afterEach(() => vi.unstubAllGlobals())

const run = () => useTourStore.getState()
const nextTo = (n: number) => {
  for (let i = 0; i < n; i++) run().next()
}

describe('tourStore — first-run offer (§GT6.1 / §GT6.3)', () => {
  it('offers the Welcome card once, only when the key is absent', () => {
    expect(run().offerWelcome()).toBe(true)
    expect(run().phase).toBe('welcome')
    useTourStore.setState({ phase: 'idle' })
    expect(run().offerWelcome()).toBe(false) // once per session
  })

  it('does not offer when the key is set (either value)', () => {
    for (const v of ['completed', 'dismissed'] as const) {
      reset()
      mem.setItem(TOUR_STORAGE_KEY, v)
      expect(run().offerWelcome()).toBe(false)
      expect(run().phase).toBe('idle')
    }
  })

  it('a corrupt stored value is treated as absent (card offered once) and left untouched', () => {
    mem.setItem(TOUR_STORAGE_KEY, 'garbage')
    expect(run().offerWelcome()).toBe(true) // NOT locked out by a bad value (§GT6)
    expect(mem.getItem(TOUR_STORAGE_KEY)).toBe('garbage') // never rewritten
    // …but only once per session
    useTourStore.setState({ phase: 'idle' })
    expect(run().offerWelcome()).toBe(false)
  })

  it('only `completed` / `dismissed` count as a decision; anything else is absent', () => {
    for (const bad of ['seen', 'true', '1', '{}', 'COMPLETED', '']) {
      reset()
      mem.setItem(TOUR_STORAGE_KEY, bad)
      expect(readTourKey()).toBeNull()
      expect(run().offerWelcome()).toBe(true)
    }
  })

  it('offers at most once per session even when getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    })
    expect(readTourKey()).toBeNull() // caught, not propagated
    expect(run().offerWelcome()).toBe(true)
    useTourStore.setState({ phase: 'idle' })
    expect(run().offerWelcome()).toBe(false)
  })
})

describe('tourStore — exit-state transition table (§GT6.4)', () => {
  it('Welcome → Start tour: nothing written', () => {
    run().offerWelcome()
    run().startFromWelcome('desktop')
    expect(run().phase).toBe('running')
    expect(readTourKey()).toBeNull()
  })

  it('Welcome → Skip: dismissed', () => {
    run().offerWelcome()
    run().skipWelcome()
    expect(run().phase).toBe('idle')
    expect(readTourKey()).toBe('dismissed')
  })

  it('Tour → Done (pressed on step 6): completed; reaching step 6 writes nothing', () => {
    run().offerWelcome()
    run().startFromWelcome('desktop')
    nextTo(TOUR_TOTAL - 1)
    expect(run().step).toBe(TOUR_TOTAL - 1)
    expect(readTourKey()).toBeNull()
    run().finish()
    expect(readTourKey()).toBe('completed')
    expect(run().phase).toBe('idle')
  })

  it('Tour → Escape / close on step 6: dismissed (not completed)', () => {
    run().startFromWelcome('desktop')
    nextTo(TOUR_TOTAL - 1)
    run().dismiss()
    expect(readTourKey()).toBe('dismissed')
  })

  it('replay from Help never rewrites the key, on any exit', () => {
    mem.setItem(TOUR_STORAGE_KEY, 'completed')
    run().startReplay('desktop')
    expect(run().replay).toBe(true)
    run().dismiss()
    expect(readTourKey()).toBe('completed')

    mem.setItem(TOUR_STORAGE_KEY, 'dismissed')
    run().startReplay('desktop')
    nextTo(TOUR_TOTAL - 1)
    run().finish()
    expect(readTourKey()).toBe('dismissed')
  })

  it('closing still works when setItem throws (§GT6.3)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    run().offerWelcome()
    expect(() => run().skipWelcome()).not.toThrow()
    expect(run().phase).toBe('idle')
  })
})

describe('tourStore — step bounds', () => {
  it('next clamps at the last step; back clamps at 0', () => {
    run().startReplay('desktop')
    nextTo(20)
    expect(run().step).toBe(TOUR_TOTAL - 1)
    for (let i = 0; i < 20; i++) run().back()
    expect(run().step).toBe(0)
  })
})
