import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '../storage/storagePort'
import { ANNOUNCED_KEY, NOT_A_TRACE, OPENED_KEY, RETURNING_PROFILE_KEYS, decideWhatsNew, isUnread, readStoredId } from './decide'

// Issue #296 — who is told about an update. Pure functions, made-up facts.

const NEWEST = 'release:0.15.0'

describe('every stored key is classified', () => {
  it('each registered key is a trace of a person or is explicitly not one', () => {
    const classified = [...RETURNING_PROFILE_KEYS, ...NOT_A_TRACE].sort()
    expect(classified).toEqual(Object.keys(STORAGE_KEYS).sort())
  })
  it('no key is in both lists', () => {
    expect(RETURNING_PROFILE_KEYS.filter((k) => (NOT_A_TRACE as readonly string[]).includes(k))).toEqual([])
    expect(new Set(RETURNING_PROFILE_KEYS).size).toBe(RETURNING_PROFILE_KEYS.length)
  })
  it('fourteen keys are traces, and four are not', () => {
    // a key added to the registry later lands in NEITHER list and fails the
    // first test above: it does not become a trace on its own
    expect(RETURNING_PROFILE_KEYS).toHaveLength(14)
    expect(NOT_A_TRACE).toHaveLength(4)
  })
  it('the storage-mode key is not a trace: a brand-new profile writes it at the gate (issue #297)', () => {
    expect(NOT_A_TRACE).toContain('loop-studio:storage-mode')
    expect(RETURNING_PROFILE_KEYS).not.toContain('loop-studio:storage-mode')
  })
  it('the document key is not a trace: the app saves the default sample by itself', () => {
    expect(NOT_A_TRACE).toContain('loop-studio:graph:v1')
    expect(RETURNING_PROFILE_KEYS).not.toContain('loop-studio:graph:v1')
  })
  it("this feature's own keys are not traces", () => {
    expect(NOT_A_TRACE).toContain(ANNOUNCED_KEY)
    expect(NOT_A_TRACE).toContain(OPENED_KEY)
    expect(ANNOUNCED_KEY).toBe('loop-studio/whats-new/announced/1')
    expect(OPENED_KEY).toBe('loop-studio/whats-new/opened/1')
  })
})

describe('a stored id', () => {
  it('is kept when it is release:<something>', () => {
    expect(readStoredId('release:0.15.0')).toBe('release:0.15.0')
    expect(readStoredId('release:9.9.9')).toBe('release:9.9.9')
  })
  it('is treated as absent when it is missing, empty or not an id', () => {
    for (const raw of [null, undefined, '', 'release:', '0.15.0', 'dismissed', '{"id":"release:0.15.0"}', ' release:0.15.0']) {
      expect(readStoredId(raw), String(raw)).toBeNull()
    }
  })
})

describe('the three states of a profile', () => {
  it('empty storage: a first visit, no notice, the newest id becomes the baseline', () => {
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: null, hasReturningTrace: false })).toEqual({ kind: 'first-visit', baseline: NEWEST })
  })
  it('only the auto-saved sample document: still a first visit', () => {
    // the document key is not in the allow-list, so the caller reports no trace
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: null, hasReturningTrace: false }).kind).toBe('first-visit')
  })
  it('a real returning profile that was never told: a notice for the newest entry', () => {
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: null, hasReturningTrace: true })).toEqual({ kind: 'notice', id: NEWEST })
  })
})

describe('once a profile has a record, the record decides', () => {
  it('told about the newest entry: nothing to say, with or without other traces', () => {
    expect(decideWhatsNew({ newestId: NEWEST, announced: NEWEST, opened: null, hasReturningTrace: true })).toEqual({ kind: 'up-to-date' })
    expect(decideWhatsNew({ newestId: NEWEST, announced: NEWEST, opened: null, hasReturningTrace: false })).toEqual({ kind: 'up-to-date' })
  })
  it('told about an older entry: a notice, even with no other trace', () => {
    // the second launch of a profile whose first visit recorded the baseline
    // and then never touched a setting
    expect(decideWhatsNew({ newestId: 'release:0.16.0', announced: NEWEST, opened: null, hasReturningTrace: false })).toEqual({ kind: 'notice', id: 'release:0.16.0' })
  })
  it('the comparison is equality of ids, not an ordering of versions', () => {
    // a record that names a "later" version is simply a different id
    expect(decideWhatsNew({ newestId: NEWEST, announced: 'release:9.0.0', opened: null, hasReturningTrace: false })).toEqual({ kind: 'notice', id: NEWEST })
    // 0.9.9 and 0.10.0 are never compared as text or as numbers
    expect(decideWhatsNew({ newestId: 'release:0.10.0', announced: 'release:0.9.9', opened: null, hasReturningTrace: false }).kind).toBe('notice')
  })
  it('a first visit followed by a second launch on the same release says nothing twice', () => {
    const first = decideWhatsNew({ newestId: NEWEST, announced: null, opened: null, hasReturningTrace: false })
    expect(first).toEqual({ kind: 'first-visit', baseline: NEWEST })
    // the baseline was written; by now the person has also skipped the tour
    expect(decideWhatsNew({ newestId: NEWEST, announced: NEWEST, opened: null, hasReturningTrace: true })).toEqual({ kind: 'up-to-date' })
  })
})

describe('a profile that has already opened the newest entry', () => {
  it('is not told about it, even with no announced record', () => {
    // the notice was waiting behind another overlay, and the person read the
    // notes from the Help menu instead
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: NEWEST, hasReturningTrace: true })).toEqual({ kind: 'up-to-date' })
    expect(decideWhatsNew({ newestId: NEWEST, announced: 'release:0.14.0', opened: NEWEST, hasReturningTrace: true })).toEqual({ kind: 'up-to-date' })
  })
  it('having opened an OLDER entry changes nothing', () => {
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: 'release:0.14.0', hasReturningTrace: true })).toEqual({ kind: 'notice', id: NEWEST })
    expect(decideWhatsNew({ newestId: NEWEST, announced: null, opened: 'release:0.14.0', hasReturningTrace: false })).toEqual({ kind: 'first-visit', baseline: NEWEST })
  })
})

describe('an empty release-note list', () => {
  it('announces nothing to anyone', () => {
    expect(decideWhatsNew({ newestId: null, announced: null, opened: null, hasReturningTrace: true })).toEqual({ kind: 'none' })
    expect(decideWhatsNew({ newestId: null, announced: NEWEST, opened: null, hasReturningTrace: false })).toEqual({ kind: 'none' })
  })
})

describe('the New marker', () => {
  it('shows until the newest entry has been opened', () => {
    expect(isUnread(NEWEST, null)).toBe(true)
    expect(isUnread(NEWEST, 'release:0.14.0')).toBe(true)
    expect(isUnread(NEWEST, NEWEST)).toBe(false)
  })
  it('does not show when there is no entry', () => {
    expect(isUnread(null, null)).toBe(false)
  })
})
