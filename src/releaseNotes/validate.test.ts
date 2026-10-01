import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES, newestReleaseNote, releaseNoteIdFor } from './releaseNotes'
import { compareVersions, parseVersion, validateReleaseNotes, type Catalogs, type ReleaseNoteLike } from './validate'

// Issue #296 — the release-note list's own rules. The same function runs in
// `npm run check:change-declaration`; these tests hand it broken lists.

const ITEMS = ['a.one', 'a.two', 'a.three']
const CATALOGS: Catalogs = {
  en: { 'a.one': 'One', 'a.two': 'Two', 'a.three': 'Three', 'a.four': 'Four', 'a.five': 'Five', 'a.six': 'Six' },
  ko: { 'a.one': '하나', 'a.two': '둘', 'a.three': '셋', 'a.four': '넷', 'a.five': '다섯', 'a.six': '여섯' },
}
const note = (over: Partial<ReleaseNoteLike> = {}): ReleaseNoteLike => ({
  id: 'release:0.15.0',
  version: '0.15.0',
  date: '2026-10-10',
  items: ITEMS,
  ...over,
})
const check = (notes: ReleaseNoteLike[], packageVersion = '0.15.0', catalogs: Catalogs | undefined = CATALOGS) =>
  validateReleaseNotes(notes, { packageVersion, catalogs })

describe('versions', () => {
  it('reads x.y.z and nothing else', () => {
    expect(parseVersion('0.15.0')).toEqual([0, 15, 0])
    for (const bad of ['0.15', 'v0.15.0', '0.15.0-beta', '01.2.3', '', 15, null, undefined]) expect(parseVersion(bad)).toBeNull()
  })
  it('orders numerically, not as text', () => {
    expect(compareVersions([0, 9, 0], [0, 10, 0])).toBeLessThan(0)
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBeGreaterThan(0)
    expect(compareVersions([0, 15, 0], [0, 15, 0])).toBe(0)
  })
})

describe('a valid list', () => {
  it('an empty list is valid', () => {
    expect(check([], '0.14.0')).toEqual([])
  })
  it('one entry for the app version, three to five items, every language', () => {
    expect(check([note()])).toEqual([])
    expect(check([note({ items: ['a.one', 'a.two', 'a.three', 'a.four', 'a.five'] })])).toEqual([])
  })
  it('newest first, an older entry kept as history', () => {
    expect(check([note(), note({ id: 'release:0.14.0', version: '0.14.0', date: '2026-09-30' })])).toEqual([])
  })
  it('the app may be ahead of the newest entry: an internal release has no note', () => {
    expect(check([note({ id: 'release:0.14.0', version: '0.14.0', date: '2026-09-30' })], '0.14.1')).toEqual([])
  })
})

describe('what it rejects', () => {
  const cases: [string, ReleaseNoteLike[], string, RegExp][] = [
    ['an id that is not release:<version>', [note({ id: '0.15.0' })], '0.15.0', /id must be "release:<version>"/],
    ['an id that names another version', [note({ id: 'release:0.15.1' })], '0.15.0', /does not match its version/],
    ['a version that is not x.y.z', [note({ id: 'release:0.15', version: '0.15' })], '0.15.0', /is not x\.y\.z/],
    ['the same id twice', [note(), note()], '0.15.0', /more than once/],
    ['an older entry listed first', [note({ id: 'release:0.14.0', version: '0.14.0', date: '2026-09-30' }), note()], '0.15.0', /newest first/],
    ['a newest entry ahead of the app', [note()], '0.14.0', /newer than the app version/],
    ['a date that does not exist', [note({ date: '2026-02-30' })], '0.15.0', /not a real YYYY-MM-DD date/],
    ['a date in another format', [note({ date: '10/10/2026' })], '0.15.0', /not a real YYYY-MM-DD date/],
    ['an older entry dated after a newer one', [note(), note({ id: 'release:0.14.0', version: '0.14.0', date: '2026-11-01' })], '0.15.0', /is after the newer entry/],
    ['two items', [note({ items: ['a.one', 'a.two'] })], '0.15.0', /2 item\(s\); an entry has 3 to 5/],
    ['six items', [note({ items: ['a.one', 'a.two', 'a.three', 'a.four', 'a.five', 'a.six'] })], '0.15.0', /6 item\(s\)/],
    ['the same item twice', [note({ items: ['a.one', 'a.one', 'a.two'] })], '0.15.0', /listed twice/],
    ['items that are not a list', [note({ items: 'a.one' })], '0.15.0', /must be a list/],
    ['an item that is not a key', [note({ items: ['a.one', '', 'a.two'] })], '0.15.0', /not a catalog key/],
    ['an item with no text in one language', [note({ items: ['a.one', 'a.two', 'a.missing'] })], '0.15.0', /"a\.missing" has no text in "en"/],
  ]
  for (const [name, notes, pkg, expected] of cases) {
    it(name, () => {
      const problems = check(notes, pkg)
      expect(problems.join('\n')).toMatch(expected)
    })
  }

  it('an item translated in one language and empty in another', () => {
    const catalogs: Catalogs = { en: CATALOGS.en, ko: { ...CATALOGS.ko, 'a.two': '   ' } }
    const problems = check([note()], '0.15.0', catalogs)
    expect(problems).toEqual(['release:0.15.0: "a.two" has no text in "ko"'])
  })
  it('an app version that is not x.y.z', () => {
    expect(check([], 'next').join('\n')).toMatch(/app version "next" is not x\.y\.z/)
  })
  it('reports every problem of an entry, not only the first', () => {
    const problems = check([note({ id: 'nope', version: 'nope', date: 'nope', items: [] })])
    expect(problems.length).toBeGreaterThanOrEqual(4)
  })
})

describe('the shipped list', () => {
  it('is valid for the app version it ships with', () => {
    // languages are checked by the build check, which loads every catalog
    expect(validateReleaseNotes(RELEASE_NOTES, { packageVersion: __APP_VERSION__ })).toEqual([])
  })
  it('every id is the id for its version', () => {
    for (const n of RELEASE_NOTES) expect(n.id).toBe(releaseNoteIdFor(n.version))
    expect(newestReleaseNote()).toBe(RELEASE_NOTES[0])
  })
})
