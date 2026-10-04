import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS, STORAGE_MODE_KEY, StorageGateError, storagePort, storageSession, type StorageKey } from './storagePort'

// Issue #297, step 1 — the port is a straight pass-through. These tests pin the
// three things a caller relies on and that a later "improvement" would break:
// the values are untouched, the browser's exceptions come through as they are,
// and the global is looked up on every call. (vitest env is `node`.)

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

const KEY: StorageKey = 'loop-studio:theme'
let mem: MemStorage

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
})
afterEach(() => vi.unstubAllGlobals())

describe('storagePort — a pass-through to localStorage', () => {
  it('reads, writes and removes the exact string under the exact key', () => {
    expect(storagePort.getItem(KEY)).toBeNull()
    storagePort.setItem(KEY, 'dark')
    expect(mem.m.get('loop-studio:theme')).toBe('dark')
    expect(storagePort.getItem(KEY)).toBe('dark')
    storagePort.removeItem(KEY)
    expect(mem.m.has('loop-studio:theme')).toBe(false)
    expect(storagePort.getItem(KEY)).toBeNull()
  })

  it('does not transform a value: what is stored is byte for byte what was passed', () => {
    const value = JSON.stringify({ name: '한림', note: 'a "quoted" note\nsecond line', n: [1, 2.5, null] })
    storagePort.setItem('loop-studio:author', value)
    expect(mem.m.get('loop-studio:author')).toBe(value)
    expect(storagePort.getItem('loop-studio:author')).toBe(value)
  })

  it('throws exactly what the browser throws — the caller tells quota from unavailable', () => {
    const quota = new DOMException('full', 'QuotaExceededError')
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied') },
      setItem() { throw quota },
      removeItem() { throw new Error('denied') },
    })
    let caught: unknown
    try {
      storagePort.setItem(KEY, 'x')
    } catch (e) {
      caught = e
    }
    expect(caught).toBe(quota) // the same object, not a wrapper
    expect(() => storagePort.getItem(KEY)).toThrow('denied')
    expect(() => storagePort.removeItem(KEY)).toThrow('denied')
  })

  it('throws when there is no localStorage at all, as a direct call would', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', undefined)
    expect(() => storagePort.getItem(KEY)).toThrow()
    expect(() => storagePort.setItem(KEY, 'x')).toThrow()
  })

  it('looks the global up on every call, so a replaced localStorage is honoured', () => {
    storagePort.setItem(KEY, 'light')
    const other = new MemStorage()
    vi.stubGlobal('localStorage', other)
    expect(storagePort.getItem(KEY)).toBeNull() // the new storage is empty
    storagePort.setItem(KEY, 'dark')
    expect(other.m.get('loop-studio:theme')).toBe('dark')
    expect(mem.m.get('loop-studio:theme')).toBe('light') // the old one was not touched
  })
})

describe('storagePort — the key registry', () => {
  it('lists the seventeen keys Loop Studio stores, by kind', () => {
    const byKind: Record<string, string[]> = {}
    for (const [key, kind] of Object.entries(STORAGE_KEYS)) (byKind[kind] ??= []).push(key)
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(17)
    // issue #297 - the one key read before the gate and written by a temporary session
    expect(byKind.mode).toEqual(['loop-studio:storage-mode'])
    expect(STORAGE_MODE_KEY).toBe('loop-studio:storage-mode')
    expect(byKind.work).toEqual(['loop-studio:graph:v1'])
    expect(byKind.personal).toEqual(['loop-studio:author'])
    expect(byKind.preference).toHaveLength(9)
    expect(byKind.onboarding).toEqual(['loop-studio/guided-tour/1', 'loop-studio/contextual-help/1', 'loop-studio/import-quickstart/1'])
    // issue #296 - which release note this profile was told about, and which it opened
    expect(byKind.release).toEqual(['loop-studio/whats-new/announced/1', 'loop-studio/whats-new/opened/1'])
    expect(Object.keys(byKind).sort()).toEqual(['mode', 'onboarding', 'personal', 'preference', 'release', 'work'])
  })

  it('names every key by its real stored spelling (a rename would orphan saved data)', () => {
    expect(Object.keys(STORAGE_KEYS).sort()).toEqual(
      [
        'loop-studio:storage-mode',
        'loop-studio/contextual-help/1',
        'loop-studio/guided-tour/1',
        'loop-studio/import-quickstart/1',
        'loop-studio/ui-locale/1',
        'loop-studio/whats-new/announced/1',
        'loop-studio/whats-new/opened/1',
        'loop-studio:activity-overlay',
        'loop-studio:author',
        'loop-studio:canvas-locked',
        'loop-studio:filter-panel',
        'loop-studio:focus-mode',
        'loop-studio:graph:v1',
        'loop-studio:inputs-panel',
        'loop-studio:minimap-collapsed',
        'loop-studio:summary-panel',
        'loop-studio:theme',
      ].sort(),
    )
  })
})

// Issue #297 - the session behind the port. The global test setup opens the
// browser door before every test; these put the port back where a page starts.
describe('storageSession — the gate', () => {
  beforeEach(() => storageSession.__resetForTests())

  it('starts shut: every call throws a StorageGateError and touches no storage', () => {
    expect(storageSession.state()).toBe('gate')
    expect(storageSession.mode()).toBeNull()
    expect(() => storagePort.getItem(KEY)).toThrow(StorageGateError)
    expect(() => storagePort.setItem(KEY, 'dark')).toThrow(StorageGateError)
    expect(() => storagePort.removeItem(KEY)).toThrow(StorageGateError)
    expect(mem.m.size).toBe(0)
  })

  it('the mode key is the one read allowed before the gate, and only a mode counts', () => {
    expect(storageSession.readRemembered()).toBeNull()
    mem.m.set(STORAGE_MODE_KEY, 'personal')
    expect(storageSession.readRemembered()).toBe('personal')
    mem.m.set(STORAGE_MODE_KEY, 'temporary')
    expect(storageSession.readRemembered()).toBe('temporary')
    mem.m.set(STORAGE_MODE_KEY, 'yes')
    expect(storageSession.readRemembered()).toBeNull()
    expect(storageSession.state()).toBe('gate') // reading it opens nothing
  })

  it('reads the mode key as null when storage throws, instead of throwing', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') } })
    expect(storageSession.readRemembered()).toBeNull()
  })

  it('remember() writes the mode key and nothing else; null forgets it; it never throws', () => {
    storageSession.remember('personal')
    expect([...mem.m.entries()]).toEqual([[STORAGE_MODE_KEY, 'personal']])
    storageSession.remember('temporary')
    expect([...mem.m.entries()]).toEqual([[STORAGE_MODE_KEY, 'temporary']])
    storageSession.remember(null)
    expect(mem.m.size).toBe(0)
    vi.stubGlobal('localStorage', { setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } })
    expect(() => storageSession.remember('personal')).not.toThrow()
  })
})

describe('storageSession — the two doors', () => {
  beforeEach(() => storageSession.__resetForTests())

  it('personal opens the browser door: a pass-through to localStorage', () => {
    storageSession.use('personal')
    expect(storageSession.state()).toBe('browser')
    expect(storageSession.mode()).toBe('personal')
    storagePort.setItem(KEY, 'dark')
    expect(mem.m.get('loop-studio:theme')).toBe('dark')
    expect(storagePort.getItem(KEY)).toBe('dark')
  })

  it('temporary opens an in-memory door: the same keys and values, and localStorage is never touched', () => {
    mem.m.set('loop-studio:theme', 'dark') // what the previous person left
    mem.m.set('loop-studio:author', '{"name":"previous person"}')
    const before = [...mem.m.entries()]
    storageSession.use('temporary')
    expect(storageSession.state()).toBe('memory')
    expect(storageSession.mode()).toBe('temporary')
    expect(storagePort.getItem(KEY)).toBeNull() // not the previous person's theme
    expect(storagePort.getItem('loop-studio:author')).toBeNull()
    storagePort.setItem(KEY, 'light')
    storagePort.setItem('loop-studio:graph:v1', '{"nodes":[]}')
    expect(storagePort.getItem(KEY)).toBe('light')
    storagePort.removeItem(KEY)
    expect(storagePort.getItem(KEY)).toBeNull()
    expect([...mem.m.entries()]).toEqual(before) // byte for byte what it was
  })

  it('a switch into a temporary session starts from nothing, whatever memory held before', () => {
    storageSession.use('temporary')
    storagePort.setItem(KEY, 'light')
    storageSession.use('temporary')
    expect(storagePort.getItem(KEY)).toBeNull()
  })

  it('a temporary session never fails a write: the quota is not involved', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new DOMException('full', 'QuotaExceededError') } })
    storageSession.use('temporary')
    expect(() => storagePort.setItem('loop-studio:graph:v1', 'x'.repeat(10_000))).not.toThrow()
  })

  it('removeFromBrowser removes from localStorage whatever door is open', () => {
    mem.m.set('loop-studio:graph:v1', '{}')
    storageSession.use('temporary')
    storagePort.setItem('loop-studio:graph:v1', '{"mine":true}')
    storageSession.removeFromBrowser('loop-studio:graph:v1')
    expect(mem.m.has('loop-studio:graph:v1')).toBe(false)
    expect(storagePort.getItem('loop-studio:graph:v1')).toBe('{"mine":true}') // the temporary one stays
  })
})

describe('storageSession — reset all', () => {
  beforeEach(() => storageSession.__resetForTests())

  it('removes every registered key from localStorage, empties memory, and closes the port until a reload', () => {
    for (const key of Object.keys(STORAGE_KEYS)) mem.m.set(key, 'v')
    mem.m.set('someone-elses-key', 'kept')
    storageSession.use('personal')
    const removed = storageSession.resetAll()
    expect(removed.sort()).toEqual(Object.keys(STORAGE_KEYS).sort())
    expect([...mem.m.entries()]).toEqual([['someone-elses-key', 'kept']])
    expect(storageSession.state()).toBe('closed')
    expect(storageSession.mode()).toBeNull()
    // the flush on the way out finds a closed door: nothing is stored again
    storagePort.setItem('loop-studio:graph:v1', '{"nodes":[]}')
    expect(storagePort.getItem('loop-studio:graph:v1')).toBeNull()
    expect(mem.m.has('loop-studio:graph:v1')).toBe(false)
    expect(() => storageSession.use('personal')).toThrow(/reload/)
  })

  it('reports only the keys that were present', () => {
    mem.m.set('loop-studio:theme', 'dark')
    storageSession.use('temporary')
    expect(storageSession.resetAll()).toEqual(['loop-studio:theme'])
  })
})
