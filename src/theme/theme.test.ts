import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyStoredTheme, applyTheme, isThemeMode, readStoredTheme, THEME_KEY } from './theme'

// Issue #302 — the stored theme at start-up. The unit tests run without a DOM:
// the port reads the `localStorage` global, so a small one is installed per
// test, and the root element is a stand-in with the three attribute methods.

type Root = { attrs: Map<string, string>; getAttribute: (n: string) => string | null; setAttribute: (n: string, v: string) => void; removeAttribute: (n: string) => void; hasAttribute: (n: string) => boolean }
const fakeRoot = (): Root => {
  const attrs = new Map<string, string>()
  return {
    attrs,
    getAttribute: (n) => attrs.get(n) ?? null,
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
    hasAttribute: (n) => attrs.has(n),
  }
}
const fakeStorage = (behaviour: 'ok' | 'throws' = 'ok') => {
  const m = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    getItem(k: string) {
      if (behaviour === 'throws') throw new Error('storage unavailable')
      return m.get(k) ?? null
    },
    setItem(k: string, v: string) {
      writes.push(k)
      m.set(k, v)
    },
    removeItem(k: string) {
      m.delete(k)
    },
  }
}
const g = globalThis as unknown as { localStorage?: unknown }
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

describe('the stored theme', () => {
  let storage: ReturnType<typeof fakeStorage>
  let root: Root
  beforeEach(() => {
    storage = fakeStorage()
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
    root = fakeRoot()
  })
  afterEach(() => {
    if (had) Object.defineProperty(globalThis, 'localStorage', had)
    else delete g.localStorage
  })

  it('reads light and dark as themselves and system as system', () => {
    for (const v of ['light', 'dark', 'system'] as const) {
      storage.setItem(THEME_KEY, v)
      expect(readStoredTheme()).toBe(v)
    }
  })

  it('treats an absent value, an unknown value and a mis-cased value as system', () => {
    expect(readStoredTheme()).toBe('system')
    for (const v of ['bogus', '', 'Dark', 'DARK', ' dark', 'null', '{"mode":"dark"}']) {
      storage.setItem(THEME_KEY, v)
      expect(readStoredTheme(), v).toBe('system')
    }
  })

  it('treats storage that throws as system, and throws nothing itself', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage('throws'), configurable: true, writable: true })
    expect(() => readStoredTheme()).not.toThrow()
    expect(readStoredTheme()).toBe('system')
  })

  it('applies light and dark as data-theme and system as no attribute', () => {
    const el = root as unknown as HTMLElement
    applyTheme('dark', el)
    expect(root.getAttribute('data-theme')).toBe('dark')
    applyTheme('light', el)
    expect(root.getAttribute('data-theme')).toBe('light')
    applyTheme('system', el)
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('applyStoredTheme applies what is stored and writes nothing back', () => {
    const el = root as unknown as HTMLElement
    storage.setItem(THEME_KEY, 'dark')
    storage.writes.length = 0
    expect(applyStoredTheme(el)).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(storage.writes).toEqual([])
    // an invalid value starts as system and is left as it was in storage
    storage.setItem(THEME_KEY, 'bogus')
    storage.writes.length = 0
    expect(applyStoredTheme(el)).toBe('system')
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(storage.getItem(THEME_KEY)).toBe('bogus')
    expect(storage.writes).toEqual([])
  })

  it('isThemeMode knows exactly the three modes', () => {
    expect(['system', 'light', 'dark'].every(isThemeMode)).toBe(true)
    expect([undefined, null, 1, 'auto', 'Light'].some(isThemeMode)).toBe(false)
  })
})
