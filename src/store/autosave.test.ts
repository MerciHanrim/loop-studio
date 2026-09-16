import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, saveToStorage } from '../model/serialize'
import { useAutosaveStore } from './autosaveStore'
import { flushAutosave, useGraphStore } from './graphStore'

// Audit ①-4 — (1) a refused autosave write is a reported, visible state, not
// a silent skip; (2) the pending debounced write can be flushed synchronously
// (the pagehide / hidden hook), so the last edit before a close is kept.

class MemStorage {
  m = new Map<string, string>()
  /** throw the browser's quota error for any record longer than this */
  limit = Number.POSITIVE_INFINITY
  blocked = false
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) {
    if (this.blocked) throw new Error('SecurityError')
    if (v.length > this.limit) {
      const e = new Error('quota') as Error & { name: string; code: number }
      e.name = 'QuotaExceededError'
      e.code = 22
      throw e
    }
    this.m.set(k, String(v))
  }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
let mem: MemStorage

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.useFakeTimers()
  useAutosaveStore.setState({ failed: false, reason: null })
  useGraphStore.getState().newGraph()
  vi.runAllTimers() // land newGraph's own autosave
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const poolLabelInStorage = () => {
  const raw = mem.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw).nodes.find((n: { data: { kind: string } }) => n.data.kind === 'pool')?.data.label ?? null) : null
}

describe('saveToStorage reports its outcome', () => {
  it('ok on success; quota when the browser throws QuotaExceededError; unavailable otherwise', () => {
    expect(saveToStorage([], [])).toEqual({ ok: true })
    mem.limit = 10
    expect(saveToStorage([], [])).toEqual({ ok: false, reason: 'quota' })
    mem.limit = Number.POSITIVE_INFINITY
    mem.blocked = true
    expect(saveToStorage([], [])).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('a refused write leaves the previous record untouched', () => {
    saveToStorage([], [])
    const before = mem.getItem(STORAGE_KEY)
    mem.limit = 10
    saveToStorage([], [])
    expect(mem.getItem(STORAGE_KEY)).toBe(before)
  })
})

describe('graphStore → autosaveStore', () => {
  it('a quota failure on the debounced autosave sets failed/quota; the next successful write clears it', () => {
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    mem.limit = 50 // the record is far larger than this
    vi.runAllTimers()
    expect(useAutosaveStore.getState()).toMatchObject({ failed: true, reason: 'quota' })
    mem.limit = Number.POSITIVE_INFINITY
    useGraphStore.getState().addNodeAt('drain', { x: 100, y: 0 })
    vi.runAllTimers()
    expect(useAutosaveStore.getState()).toMatchObject({ failed: false, reason: null })
  })

  it('blocked storage reports unavailable', () => {
    mem.blocked = true
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    vi.runAllTimers()
    expect(useAutosaveStore.getState()).toMatchObject({ failed: true, reason: 'unavailable' })
  })
})

describe('flushAutosave — the pagehide / hidden hook', () => {
  it('writes a pending debounced edit immediately; a no-op when nothing is pending', () => {
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    vi.runAllTimers()
    const id = useGraphStore.getState().nodes[0].id
    useGraphStore.getState().updateNodeData(id, { label: 'LAST-MOMENT' })
    expect(poolLabelInStorage()).not.toBe('LAST-MOMENT') // still debounced
    flushAutosave() // what pagehide / hidden call
    expect(poolLabelInStorage()).toBe('LAST-MOMENT')
    // nothing pending now — a second flush must not rewrite / re-report
    const writes = mem.m.size
    let reports = 0
    const unsub = useAutosaveStore.subscribe(() => reports++)
    flushAutosave()
    unsub()
    expect(mem.m.size).toBe(writes)
    expect(reports).toBe(0)
  })

  it('the pending timer is cancelled after a flush (no double write)', () => {
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    vi.runAllTimers()
    const id = useGraphStore.getState().nodes[0].id
    useGraphStore.getState().updateNodeData(id, { label: 'X' })
    flushAutosave()
    const spy = vi.spyOn(mem, 'setItem')
    vi.runAllTimers()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
