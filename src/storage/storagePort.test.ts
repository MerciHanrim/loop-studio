import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS, storagePort, type StorageKey } from './storagePort'

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
  it('lists the fourteen keys Loop Studio stores, by kind', () => {
    const byKind: Record<string, string[]> = {}
    for (const [key, kind] of Object.entries(STORAGE_KEYS)) (byKind[kind] ??= []).push(key)
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(14)
    expect(byKind.work).toEqual(['loop-studio:graph:v1'])
    expect(byKind.personal).toEqual(['loop-studio:author'])
    expect(byKind.preference).toHaveLength(9)
    expect(byKind.onboarding).toEqual(['loop-studio/guided-tour/1', 'loop-studio/contextual-help/1', 'loop-studio/import-quickstart/1'])
    expect(Object.keys(byKind).sort()).toEqual(['onboarding', 'personal', 'preference', 'work'])
  })

  it('names every key by its real stored spelling (a rename would orphan saved data)', () => {
    expect(Object.keys(STORAGE_KEYS).sort()).toEqual(
      [
        'loop-studio/contextual-help/1',
        'loop-studio/guided-tour/1',
        'loop-studio/import-quickstart/1',
        'loop-studio/ui-locale/1',
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
