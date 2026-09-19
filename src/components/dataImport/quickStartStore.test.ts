import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QUICKSTART_STORAGE_KEY, readQuickStartState, useQuickStartStore } from './quickStartStore'

// docs/data-import.md §DI17 — the quick-start block's collapsed state. One
// versioned localStorage key; a manual toggle is an EXPLICIT choice that the
// first successful import never overrides; a missing/corrupt value reads as
// "expanded, not explicit" (never as "dismissed"). (vitest env is `node`, no
// jsdom — Map-backed localStorage, like hintStore.test.ts.)

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  useQuickStartStore.setState(readQuickStartState())
})

describe('quickStartStore', () => {
  it('defaults to expanded and not explicit', () => {
    expect(useQuickStartStore.getState()).toMatchObject({ collapsed: false, explicit: false })
  })

  it('the first successful import collapses it when the user never toggled it', () => {
    useQuickStartStore.getState().markFirstSuccess()
    expect(useQuickStartStore.getState()).toMatchObject({ collapsed: true, explicit: false })
    expect(JSON.parse(localStorage.getItem(QUICKSTART_STORAGE_KEY)!)).toEqual({ collapsed: true, explicit: false })
  })

  it('a manual toggle is persisted as explicit and survives a re-read', () => {
    useQuickStartStore.getState().setCollapsed(true)
    expect(readQuickStartState()).toEqual({ collapsed: true, explicit: true })
    useQuickStartStore.getState().setCollapsed(false)
    expect(readQuickStartState()).toEqual({ collapsed: false, explicit: true })
  })

  it('the first success never overrides an explicit expanded choice', () => {
    useQuickStartStore.getState().setCollapsed(false)
    useQuickStartStore.getState().markFirstSuccess()
    expect(useQuickStartStore.getState()).toMatchObject({ collapsed: false, explicit: true })
  })

  it('a corrupt or foreign value reads as the default, never as collapsed', () => {
    localStorage.setItem(QUICKSTART_STORAGE_KEY, '{"collapsed":"yes"')
    expect(readQuickStartState()).toEqual({ collapsed: false, explicit: false })
    localStorage.setItem(QUICKSTART_STORAGE_KEY, '[1]')
    expect(readQuickStartState()).toEqual({ collapsed: false, explicit: false })
    localStorage.setItem(QUICKSTART_STORAGE_KEY, '{"collapsed":true}')
    expect(readQuickStartState()).toEqual({ collapsed: true, explicit: false })
  })

  it('the storage key is versioned so a future copy revision can reset it', () => {
    expect(QUICKSTART_STORAGE_KEY).toMatch(/\/\d+$/)
  })
})
