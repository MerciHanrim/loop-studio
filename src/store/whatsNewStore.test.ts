import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_NOTES, newestReleaseNote, type ReleaseNote } from '../releaseNotes/releaseNotes'
import { ANNOUNCED_KEY, OPENED_KEY } from '../whatsNew/decide'
import { __rebootWhatsNew, bootWhatsNew, useWhatsNewStore } from './whatsNewStore'

// Issue #296 — the stored states behind the notice, the panel and the marker.
// (vitest env is `node` — a Map-backed storage.)

class MemStorage {
  m = new Map<string, string>()
  writes: [string, string][] = []
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.writes.push([k, String(v)]); this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}
let mem: MemStorage

const NOTE: ReleaseNote = { id: 'release:0.15.0', version: '0.15.0', date: '2026-10-02', items: [] }
const NEXT: ReleaseNote = { id: 'release:0.16.0', version: '0.16.0', date: '2026-11-01', items: [] }
const TOUR = 'loop-studio/guided-tour/1'
const DOC = 'loop-studio:graph:v1'
const state = () => useWhatsNewStore.getState()

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
})
afterEach(() => vi.unstubAllGlobals())

describe('the real list', () => {
  it('has a newest entry, and the store starts from it', () => {
    expect(newestReleaseNote()).toBe(RELEASE_NOTES[0])
    __rebootWhatsNew()
    expect(state().note).toBe(RELEASE_NOTES[0])
  })
})

describe('a first visit', () => {
  it('empty storage: no notice, the baseline is recorded, the marker shows', () => {
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
    expect(state().unread).toBe(true)
    expect(mem.m.get(ANNOUNCED_KEY)).toBe('release:0.15.0')
    expect(mem.m.has(OPENED_KEY)).toBe(false)
    expect(mem.writes).toEqual([[ANNOUNCED_KEY, 'release:0.15.0']])
  })
  it('only the auto-saved sample document: the same', () => {
    mem.m.set(DOC, '{"nodes":[]}')
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
    expect(mem.m.get(ANNOUNCED_KEY)).toBe('release:0.15.0')
  })
  it('the second launch on the same release still says nothing, whatever was touched since', () => {
    __rebootWhatsNew(NOTE)
    mem.m.set(TOUR, 'dismissed')
    mem.m.set('loop-studio:theme', 'dark')
    mem.writes = []
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
    expect(mem.writes).toEqual([])
  })
  it('the next release is the first one that profile is told about', () => {
    __rebootWhatsNew(NOTE)
    __rebootWhatsNew(NEXT)
    expect(state().noticePending).toBe(true)
    expect(state().note).toBe(NEXT)
  })
})

describe('a returning profile', () => {
  beforeEach(() => mem.m.set(TOUR, 'dismissed'))

  it('is owed a notice, and nothing is recorded until it is really on screen', () => {
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(true)
    expect(state().noticeShowing).toBe(false)
    expect(mem.m.has(ANNOUNCED_KEY)).toBe(false)
    expect(mem.writes).toEqual([])
  })
  it('a notice that never got on screen is offered again on the next launch', () => {
    __rebootWhatsNew(NOTE)
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(true)
  })
  it('records announced the moment the notice is rendered', () => {
    __rebootWhatsNew(NOTE)
    state().setNoticeShowing(true)
    expect(state().noticeShowing).toBe(true)
    expect(mem.m.get(ANNOUNCED_KEY)).toBe('release:0.15.0')
    expect(mem.m.has(OPENED_KEY)).toBe(false)
  })
  it('stepping aside and coming back keeps it pending and keeps the record', () => {
    __rebootWhatsNew(NOTE)
    state().setNoticeShowing(true)
    state().setNoticeShowing(false)
    expect(state().noticePending).toBe(true)
    expect(state().noticeShowing).toBe(false)
    state().setNoticeShowing(true)
    expect(state().noticeShowing).toBe(true)
    expect(mem.m.get(ANNOUNCED_KEY)).toBe('release:0.15.0')
  })
  it('once shown it does not come back on the next launch, closed or not', () => {
    __rebootWhatsNew(NOTE)
    state().setNoticeShowing(true)
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
  })
  it('closing the notice keeps the marker', () => {
    __rebootWhatsNew(NOTE)
    state().setNoticeShowing(true)
    state().dismissNotice()
    expect(state().noticePending).toBe(false)
    expect(state().noticeShowing).toBe(false)
    expect(state().unread).toBe(true)
    expect(mem.m.has(OPENED_KEY)).toBe(false)
  })
  it('opening the panel clears the marker and records opened, once', () => {
    __rebootWhatsNew(NOTE)
    state().markOpened()
    expect(state().unread).toBe(false)
    expect(mem.m.get(OPENED_KEY)).toBe('release:0.15.0')
    const writes = mem.writes.length
    state().markOpened()
    expect(mem.writes).toHaveLength(writes)
  })
  it('the marker stays cleared on the next launch and returns with the next release', () => {
    __rebootWhatsNew(NOTE)
    state().markOpened()
    __rebootWhatsNew(NOTE)
    expect(state().unread).toBe(false)
    __rebootWhatsNew(NEXT)
    expect(state().unread).toBe(true)
  })
  it('opening the panel withdraws a notice that is still owed', () => {
    __rebootWhatsNew(NOTE)
    state().setNoticeShowing(true)
    state().markOpened()
    expect(state().noticePending).toBe(false)
    expect(state().noticeShowing).toBe(false)
  })
  it('a notice that was only waiting is not offered again once the notes were read from Help', () => {
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(true)
    // never rendered, so `announced` was never written
    state().markOpened()
    expect(mem.m.has(ANNOUNCED_KEY)).toBe(false)
    expect(mem.m.get(OPENED_KEY)).toBe('release:0.15.0')
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
    expect(state().unread).toBe(false)
    // the next release is announced as usual
    __rebootWhatsNew(NEXT)
    expect(state().noticePending).toBe(true)
  })
  it('showing is refused when no notice is owed', () => {
    __rebootWhatsNew(NOTE)
    state().dismissNotice()
    state().setNoticeShowing(true)
    expect(state().noticeShowing).toBe(false)
  })
})

describe('what is in storage is not trusted blindly', () => {
  it('a corrupt announced value is treated as absent', () => {
    mem.m.set(ANNOUNCED_KEY, 'yes')
    __rebootWhatsNew(NOTE)
    // no other trace: a first visit, and the baseline replaces the bad value
    expect(state().noticePending).toBe(false)
    expect(mem.m.get(ANNOUNCED_KEY)).toBe('release:0.15.0')
  })
  it('a corrupt opened value leaves the marker showing', () => {
    mem.m.set(OPENED_KEY, 'true')
    __rebootWhatsNew(NOTE)
    expect(state().unread).toBe(true)
  })
  it("this feature's own keys are not a trace of a person", () => {
    mem.m.set(OPENED_KEY, 'release:0.14.0')
    expect(bootWhatsNew(NOTE).decision).toEqual({ kind: 'first-visit', baseline: 'release:0.15.0' })
  })
})

describe('storage that cannot be used', () => {
  it('unreadable: no automatic notice, the marker and the panel still work for the session', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    })
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(false)
    expect(state().unread).toBe(true)
    expect(() => state().markOpened()).not.toThrow()
    expect(state().unread).toBe(false)
  })
  it('readable but not writable: the notice still shows, and nothing throws', () => {
    mem.m.set(TOUR, 'dismissed')
    mem.setItem = () => {
      throw new Error('quota')
    }
    __rebootWhatsNew(NOTE)
    expect(state().noticePending).toBe(true)
    expect(() => state().setNoticeShowing(true)).not.toThrow()
    expect(state().noticeShowing).toBe(true)
    expect(() => state().dismissNotice()).not.toThrow()
  })
  it('no storage object at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => __rebootWhatsNew(NOTE)).not.toThrow()
    expect(state().noticePending).toBe(false)
  })
})

describe('an empty list', () => {
  it('owes nothing, shows no marker and writes nothing', () => {
    mem.m.set(TOUR, 'dismissed')
    __rebootWhatsNew(null)
    expect(state().note).toBeNull()
    expect(state().noticePending).toBe(false)
    expect(state().unread).toBe(false)
    expect(mem.writes).toEqual([])
  })
})
