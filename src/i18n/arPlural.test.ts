import { describe, expect, it } from 'vitest'
import { pluralArms, pluralBlocks } from './icuPlural'
import { BASE_CATALOG, getEntry } from './registry'

// docs/localization.md §L2.24 — the ARABIC plural contract, written before the
// Arabic catalog exists.
//
// WHY THIS IS ARABIC-ONLY AND NOT A STRONGER `check:i18n`
//
// `check:i18n` requires every plural block to have an `other` arm, and nothing
// more. That is the right shape for a whole-registry check — but it means a
// catalog can declare `one` and `other` and stop, and ICU will format the rest
// through `other` without an error. For English, French or Dutch the gap is
// small. For Arabic it is the whole language: `Intl.PluralRules('ar')` declares
// SIX categories and all six are reachable, so a two-arm message is wrong for
// every count of 0, 2, 3-10 and 11-99 while CI stays green.
//
// Raising the registry-wide validator to "declare every category your locale
// has" would be a much larger change: it would re-open seventeen shipped
// catalogs at once, and the locales that shipped with a deliberate subset would
// have to be re-argued one by one. This file therefore states the Arabic
// contract only.
//
// WHY IT CANNOT GO QUIETLY VACUOUS
//
// There is no `ar` catalog yet, so the interesting half of this file has
// nothing real to read. A guard that silently checks nothing is the failure
// mode this repo has hit before, so the shape here is deliberate:
//
//   • the CHECKER is exercised against fixtures on every run, so it is never
//     unproven;
//   • one test asserts that `ar` is NOT registered. Registering Arabic turns
//     that test RED, and the only way to make it green again is to come back
//     here and point the checker at the real catalog.
//
// So the file is loud at exactly the moment it would otherwise fall silent.

/** Every category `Intl` says Arabic has. Read from the platform, not typed:
 *  the point of the contract is that the catalog matches the runtime. */
const AR_CATEGORIES = new Intl.PluralRules('ar').resolvedOptions().pluralCategories

/** The values that reach each category, MEASURED over the fixture the arc was
 *  given. Kept as data so a failure names a number a reader can try. */
const REACHES: Record<string, number[]> = {
  zero: [0],
  one: [1],
  two: [2],
  few: [3, 4, 5, 6, 10, 103, 110],
  many: [11, 12, 20, 21, 22, 23, 99, 111],
  other: [100, 101, 102, 1000, 1000000],
}

/** The arms one Arabic plural block must declare. `=N` exact-match arms are
 *  allowed ON TOP of these, never instead of one. */
const REQUIRED = [...AR_CATEGORIES].sort()

/** The category names a block declares, exact-match arms excluded. */
function declaredCategories(block: string): string[] {
  return pluralArms(block)
    .map(([selector]) => selector)
    .filter((s) => !s.startsWith('='))
    .sort()
}

/** Every plural block in a catalog, as `[key, block]`. */
function blocksOf(catalog: Record<string, string>): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    pluralBlocks(value).map((b) => [key, b] as [string, string]),
  )
}

describe('the Arabic plural contract is the one the platform declares', () => {
  it('Arabic has all six categories, and this file did not invent the list', () => {
    expect(REQUIRED).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
  })

  it('every category is reachable, so none of the six is dead weight', () => {
    const pr = new Intl.PluralRules('ar')
    for (const [category, values] of Object.entries(REACHES)) {
      for (const n of values) {
        expect(pr.select(n), `ar: ${n} should select \`${category}\``).toBe(category)
      }
    }
    expect(Object.keys(REACHES).sort()).toEqual(REQUIRED)
  })

  it('a region tag does not change the answer', () => {
    for (const tag of ['ar-EG', 'ar-SA', 'ar-MA', 'ar-DZ']) {
      expect([...new Intl.PluralRules(tag).resolvedOptions().pluralCategories].sort()).toEqual(REQUIRED)
    }
  })
})

describe('the checker itself, exercised on fixtures', () => {
  const six =
    '{n, plural, zero {لا شيء} one {واحد} two {اثنان} few {# قليل} many {# كثير} other {# أخرى}}'

  it('accepts a block that declares all six', () => {
    expect(declaredCategories(six)).toEqual(REQUIRED)
  })

  it('rejects the English-shaped two-arm block — the defect this file exists for', () => {
    const two = '{n, plural, one {واحد} other {# أخرى}}'
    expect(declaredCategories(two)).not.toEqual(REQUIRED)
    expect(REQUIRED.filter((c) => !declaredCategories(two).includes(c))).toEqual([
      'few',
      'many',
      'two',
      'zero',
    ])
  })

  it('rejects a block that merges `two` into `few`, which reads plausible and is wrong', () => {
    const merged = '{n, plural, zero {لا} one {واحد} few {# قليل} many {# كثير} other {# أخرى}}'
    expect(declaredCategories(merged)).not.toContain('two')
  })

  it('does not let an exact-match arm stand in for a category', () => {
    const faked = '{n, plural, =2 {اثنان} one {واحد} other {# أخرى}}'
    expect(declaredCategories(faked)).toEqual(['one', 'other'])
  })

  it('counts an exact-match arm as an addition when the six are also there', () => {
    const extra = six.replace('{n, plural,', '{n, plural, =0 {فارغ}')
    expect(declaredCategories(extra)).toEqual(REQUIRED)
  })

  it('reads a block that starts the message, which a naive split drops', () => {
    // the §L2.20 trap: a zero-width match at index 0 does not split
    expect(pluralBlocks(six + ' ذيل')).toHaveLength(1)
  })
})

describe('the contract binds to the real catalog the moment Arabic ships', () => {
  // This is the tripwire. While `ar` is unregistered there is nothing to read,
  // and a quiet skip would leave the whole file decorative. Registering Arabic
  // fails HERE, and the fix is to replace this test with the catalog sweep
  // sketched below — not to delete it.
  it('`ar` is not registered yet — when it is, wire the sweep below', () => {
    expect(
      getEntry('ar'),
      'Arabic is now registered: enable the catalog sweep in this file',
    ).toBeUndefined()
  })

  it('the sweep works — proved on `en`, whose own contract is different', () => {
    // `en` is not Arabic, so this asserts the MECHANISM (find blocks, read
    // arms), not the Arabic category set. It is what will run over the Arabic
    // catalog unchanged, with REQUIRED as the expectation.
    const blocks = blocksOf(BASE_CATALOG as Record<string, string>)
    expect(blocks.length, 'the base catalog should have plural blocks to read').toBeGreaterThan(0)
    for (const [key, block] of blocks) {
      const cats = declaredCategories(block)
      expect(cats, `${key}: every plural block must declare \`other\``).toContain('other')
    }
  })
})
