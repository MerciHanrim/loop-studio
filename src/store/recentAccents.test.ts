import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storagePort, storageSession } from '../storage/storagePort'
import { readRecentAccents, RECENT_ACCENTS_KEY, RECENT_ACCENTS_MAX, rememberAccent } from './recentAccents'

// docs/flow-colour-and-compact-nodes.md FC-2.7 — the recent flow colours.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  // the global setup opened the browser door before this stub existed; reopen
  storageSession.__resetForTests()
  storageSession.use('personal')
})
afterEach(() => vi.unstubAllGlobals())

describe('recent flow colours', () => {
  it('newest first, de-duplicated, at most eight, stored form only', () => {
    expect(readRecentAccents()).toEqual([])
    for (const c of ['#111111', '#222222', '#333333']) rememberAccent(c)
    expect(rememberAccent('#222222')).toEqual(['#222222', '#333333', '#111111'])
    for (let i = 0; i < 10; i++) rememberAccent(`#00000${i}`)
    const list = readRecentAccents()
    expect(list).toHaveLength(RECENT_ACCENTS_MAX)
    expect(list[0]).toBe('#000009')
    expect(rememberAccent('red')).toEqual(list)
    expect(rememberAccent('#abcdef')[0]).toBe('#ABCDEF')
  })

  it('a corrupted stored value reads as an empty or filtered list', () => {
    storagePort.setItem(RECENT_ACCENTS_KEY, 'not json')
    expect(readRecentAccents()).toEqual([])
    storagePort.setItem(RECENT_ACCENTS_KEY, JSON.stringify(['#638EA5', 'red', 7, '#638ea5', '#74906B']))
    expect(readRecentAccents()).toEqual(['#638EA5', '#74906B'])
  })

  it('a temporary session keeps them in memory only, and a reset removes them', () => {
    rememberAccent('#638EA5')
    expect(localStorage.getItem(RECENT_ACCENTS_KEY)).not.toBeNull()
    localStorage.removeItem(RECENT_ACCENTS_KEY)
    storageSession.use('temporary')
    try {
      rememberAccent('#74906B')
      expect(readRecentAccents()).toEqual(['#74906B'])
      expect(localStorage.getItem(RECENT_ACCENTS_KEY)).toBeNull()
    } finally {
      storageSession.use('personal')
    }
    rememberAccent('#B47599')
    const removed = storageSession.resetAll()
    expect(removed).toContain(RECENT_ACCENTS_KEY)
    expect(localStorage.getItem(RECENT_ACCENTS_KEY)).toBeNull()
  })
})
