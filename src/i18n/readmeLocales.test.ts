import { describe, expect, it } from 'vitest'
// `?raw` rather than `node:fs`: nothing under `src/` reads the filesystem, and
// `tsconfig.app.json` carries only `vite/client` types on purpose. Vite's
// `*?raw` declaration keeps this inside the app's existing type surface.
import readme from '../../README.md?raw'
import { LOCALES } from './registry'

// docs/localization.md §L2.11a — the README's language list is a fact that
// lives ONLY in prose, so nothing was checking it. Eight languages shipped
// between v0.12.0 and v0.13.0 while the README still said "EN / KO / JA", and
// CI stayed green the whole time: `check:i18n` compares key sets, the copy
// guards compare locales to each other, and none of them reads a document.
//
// This is the same shape of gap as `localeSurfaceCopy.test.ts` (a rule that
// lives only in the translations) — here it is a rule that lives only in the
// docs.
//
// SCOPE IS DELIBERATELY NARROW. It reads ONLY the fenced block between the
// `LOCALES:BEGIN` / `LOCALES:END` markers, and only the ``code`` cells inside
// it. Ordinary edits to the intro, the feature list or the prose around the
// table cannot break it; the contract is SET EQUALITY against the registry,
// not the wording, the column layout or the row order.

const BEGIN = 'LOCALES:BEGIN'
const END = 'LOCALES:END'

/** The `code` cells inside the delimited block, in the order they appear. */
function readmeLocaleCodes(): string[] {
  const text = readme
  const from = text.indexOf(BEGIN)
  const to = text.indexOf(END)
  if (from < 0 || to < 0 || to < from) {
    throw new Error(`README is missing the ${BEGIN} / ${END} block`)
  }
  const block = text.slice(from, to)
  // a leading table cell holding exactly one backticked token
  return [...block.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!)
}

/** What the product actually ships: registry entries that are not the DEV
 *  pseudo-locale. Derived, never listed here a second time. */
const shipped = LOCALES.filter((l) => !l.pseudo).map((l) => l.code)

describe('README language list', () => {
  it('lists exactly the shipped locales, as a set', () => {
    // set equality, so a row reordering or a wording change is not a failure
    expect([...readmeLocaleCodes()].sort()).toEqual([...shipped].sort())
  })

  it('names no locale the registry does not have', () => {
    const registered = new Set(LOCALES.map((l) => l.code))
    const unknown = readmeLocaleCodes().filter((c) => !registered.has(c))
    expect(unknown, 'codes in the README that are not registered at all').toEqual([])
  })

  it('never advertises the DEV pseudo-locale', () => {
    // `en-XA` is a QA affordance that only exists in a dev build (§L5.4); the
    // production picker has no such row and neither may the README
    expect(readmeLocaleCodes()).not.toContain('en-XA')
    expect(LOCALES.some((l) => l.pseudo)).toBe(true) // and it does exist, so this is not vacuous
  })

  it('states the shipped COUNT in the prose, and gets it right', () => {
    // the intro and the feature list both say "N languages" and link here;
    // a bump that updates the table but not the sentence is still a stale README
    const text = readme
    const claims = [...text.matchAll(/(\d+)\s+languages/g)].map((m) => Number(m[1]))
    expect(claims.length, 'the README should state the language count at least once').toBeGreaterThan(0)
    for (const n of claims) expect(n).toBe(shipped.length)
  })

  it('keeps the table in the picker order, as documentation', () => {
    // §L5.6 — `englishName` under `Intl.Collator('en')`, `code` as tiebreak.
    // Pinned separately from the set contract above ON PURPOSE: if a future
    // README reorders the rows for readability, THIS test fails and the set
    // contract still passes, which is the right signal to a reader.
    const collator = new Intl.Collator('en')
    const byName = [...LOCALES.filter((l) => !l.pseudo)]
      .sort((a, b) => collator.compare(a.englishName, b.englishName) || collator.compare(a.code, b.code))
      .map((l) => l.code)
    expect(readmeLocaleCodes()).toEqual(byName)
  })
})
