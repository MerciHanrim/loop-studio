import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS, STORAGE_MODE_KEY, WORK_KEY, storagePort, storageSession } from '../storage/storagePort'
import { useGraphStore } from './graphStore'
import {
  deleteWorkData,
  installLossWarning,
  resetAllData,
  sessionHasWork,
  switchToPersonal,
  switchToTemporary,
} from './sessionActions'
import { useSessionStore } from './sessionStore'

// Issue #297 — what the Storage and privacy area does once confirmed. The
// global setup opens the browser door before each test; a Map stands in for
// `localStorage` (vitest env is `node`), so "what the browser holds" is the
// Map's exact entries.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}
let mem: MemStorage
const entries = () => [...mem.m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
const graph = () => useGraphStore.getState()

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.useFakeTimers()
  graph().newGraph()
  vi.runAllTimers() // the debounced autosave of the empty document lands
  mem.m.clear()
  useSessionStore.getState().sync()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** one real node on the canvas, autosaved */
function makeWork(): void {
  graph().addNodeAt('pool', { x: 0, y: 0 })
  vi.runAllTimers()
}

describe('sessionHasWork', () => {
  it('is false for an empty canvas and true once a node exists', () => {
    expect(sessionHasWork()).toBe(false)
    makeWork()
    expect(sessionHasWork()).toBe(true)
  })
})

describe('personal → temporary', () => {
  it('starts empty: a fresh in-memory door, the canvas cleared, and the stored document untouched', () => {
    makeWork()
    const before = entries()
    expect(before.map(([k]) => k)).toEqual([WORK_KEY])
    switchToTemporary(false)
    vi.runAllTimers()
    expect(storageSession.mode()).toBe('temporary')
    expect(useSessionStore.getState().mode).toBe('temporary')
    expect(graph().nodes).toHaveLength(0)
    expect(entries()).toEqual(before) // not deleted, not rewritten
    // the empty document was saved to MEMORY, not to the browser
    expect(storagePort.getItem(WORK_KEY)).not.toBeNull()
    expect(JSON.parse(storagePort.getItem(WORK_KEY)!).nodes).toEqual([])
  })

  it('taking the diagram along keeps it open, saved to memory only; the browser keeps its copy', () => {
    makeWork()
    const before = entries()
    const nodesBefore = graph().nodes.map((n) => n.id)
    switchToTemporary(true)
    vi.runAllTimers()
    expect(storageSession.mode()).toBe('temporary')
    expect(graph().nodes.map((n) => n.id)).toEqual(nodesBefore)
    expect(JSON.parse(storagePort.getItem(WORK_KEY)!).nodes.map((n: { id: string }) => n.id)).toEqual(nodesBefore)
    expect(entries()).toEqual(before)
    // and an edit in the session still reaches the browser nowhere
    graph().addNodeAt('pool', { x: 10, y: 10 })
    vi.runAllTimers()
    expect(entries()).toEqual(before)
  })
})

describe('temporary → personal', () => {
  it('the first write happens at the switch: the open diagram replaces the stored one', () => {
    mem.m.set(WORK_KEY, '{"previous":true}')
    storageSession.use('temporary')
    useSessionStore.getState().sync()
    makeWork()
    expect(mem.m.get(WORK_KEY)).toBe('{"previous":true}') // nothing written yet
    switchToPersonal()
    expect(storageSession.mode()).toBe('personal')
    expect(useSessionStore.getState().mode).toBe('personal')
    const stored = JSON.parse(mem.m.get(WORK_KEY)!)
    expect(stored.nodes.map((n: { id: string }) => n.id)).toEqual(graph().nodes.map((n) => n.id))
  })
})

describe('Delete work data', () => {
  it('personal: the record goes and the canvas is emptied; every other key stays', () => {
    makeWork()
    mem.m.set('loop-studio:author', '{"name":"me"}')
    mem.m.set('loop-studio:theme', 'dark')
    deleteWorkData()
    expect(mem.m.has(WORK_KEY)).toBe(false)
    expect(graph().nodes).toHaveLength(0)
    expect(mem.m.get('loop-studio:author')).toBe('{"name":"me"}')
    expect(mem.m.get('loop-studio:theme')).toBe('dark')
    // the autosave that follows holds an empty diagram, never the old one
    vi.runAllTimers()
    expect(JSON.parse(mem.m.get(WORK_KEY) ?? '{"nodes":[]}').nodes).toEqual([])
  })

  it("temporary: the BROWSER's record goes; the session's own diagram stays", () => {
    mem.m.set(WORK_KEY, '{"previous":true}')
    mem.m.set('loop-studio:author', '{"name":"them"}')
    storageSession.use('temporary')
    useSessionStore.getState().sync()
    makeWork()
    const mine = graph().nodes.map((n) => n.id)
    deleteWorkData()
    expect(mem.m.has(WORK_KEY)).toBe(false)
    expect(mem.m.get('loop-studio:author')).toBe('{"name":"them"}')
    expect(graph().nodes.map((n) => n.id)).toEqual(mine)
    expect(storagePort.getItem(WORK_KEY)).not.toBeNull()
  })
})

describe('Reset all Loop Studio data', () => {
  it('removes every registered key, the mode key included, and closes the port', () => {
    for (const k of Object.keys(STORAGE_KEYS)) mem.m.set(k, 'v')
    mem.m.set('not-ours', 'kept')
    storageSession.remember('personal')
    useSessionStore.getState().sync()
    expect(useSessionStore.getState().remembered).toBe('personal')
    const removed = resetAllData(false)
    expect(removed.sort()).toEqual(Object.keys(STORAGE_KEYS).sort())
    expect(entries()).toEqual([['not-ours', 'kept']])
    expect(mem.m.has(STORAGE_MODE_KEY)).toBe(false)
    expect(storageSession.state()).toBe('closed')
    // a flush on the way out stores nothing
    graph().addNodeAt('pool', { x: 0, y: 0 })
    vi.runAllTimers()
    expect(entries()).toEqual([['not-ours', 'kept']])
  })
})

describe('the loss warning', () => {
  type Handler = (e: { preventDefault: () => void; returnValue: string }) => void
  const fakeWindow = () => {
    let handler: Handler | null = null
    return {
      addEventListener: (_: string, h: Handler) => void (handler = h),
      removeEventListener: () => void (handler = null),
      fire: () => {
        let prevented = false
        const e = { preventDefault: () => void (prevented = true), returnValue: 'x' }
        handler?.(e)
        return { prevented, returnValue: e.returnValue }
      },
    }
  }

  it('warns only in a temporary session that has work', () => {
    const w = fakeWindow()
    const off = installLossWarning(w as unknown as Window)
    expect(w.fire().prevented).toBe(false) // personal, empty
    makeWork()
    expect(w.fire().prevented).toBe(false) // personal, with work
    switchToTemporary(true)
    expect(w.fire()).toEqual({ prevented: true, returnValue: '' }) // temporary, with work
    graph().newGraph()
    expect(w.fire().prevented).toBe(false) // temporary, empty
    off()
  })
})
