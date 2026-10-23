import { describe, expect, it } from 'vitest'

import { BUILTIN_RESOURCE_TYPES } from '../model/model'
import { BASE_LOCALE, LOCALES } from './registry'

// Copy contracts that live BETWEEN locales rather than inside any one of them.
//
// `check:i18n` proves every catalog has the same keys and the same ICU argument
// shape as `en`, and each locale's own review reads it against `en`. Neither can
// see a rule that exists in the TRANSLATIONS but not in the English source:
//
//   - `language.*` names a language a reader has to recognise by sight, so a
//     one-character slip is invisible to every mechanical check and to a
//     reader of the other language;
//   - the feedback form is English-only, so every non-English UI says so in the
//     link itself. `en` carries no such marker, so a locale that omits it
//     matches the source perfectly and still misinforms its reader;
//   - `inspector.resourceType.placeholder` lists the five BUILTIN_RESOURCE_TYPES,
//     which the model matches BYTE-EQUAL. Translating them reads perfectly and
//     tells the user to type a value the product will not recognise.
//
// Both shipped broken in #266 (`스페인어(라턴아메리카)`, and `es-419` alone
// without the English-form marker). This file is where that class of rule goes.

/** every shipped language other than the base — the pseudo QA locale is not a
 *  language a user has (§L5.4) and is excluded the same way the picker does */
const TRANSLATED = LOCALES.filter((l) => !l.pseudo && l.code !== BASE_LOCALE).map((l) => l.code)

type SurfaceMarkers = {
  /** how this language says the linked form is in English */
  englishForm: RegExp
  /** how this language says the link opens in a new tab */
  newTab: RegExp
}

/** EXHAUSTIVE over `TRANSLATED` — the assertion below fails the moment a
 *  language is registered without a row here, which is the point: the next
 *  locale must decide how it says "English form" before it can ship. */
// locale-subset-file: every table here is over TRANSLATED locales, so `en` is
// absent file-wide by construction.
// locale-subset: TRANSLATED only. `en` is the base catalogue and carries no
// "this form is in English" marker — it IS the English form, so a row for it would
// assert nothing.
// §L2.0 (2026-10) — Korean is the one translated locale. The rows of the
// sixteen archived languages are in
// `archive/i18n/tests/localeSurfaceCopy.multilocale.test.ts`.
const MARKERS: Record<string, SurfaceMarkers> = {
  ko: { englishForm: /영문/, newTab: /새 탭/ },
}

const catalogOf = async (code: string) => {
  const entry = LOCALES.find((l) => l.code === code)
  if (!entry) throw new Error(`no registry entry for ${code}`)
  return entry.catalog()
}

describe('copy contracts that hold ACROSS locales', () => {
  it('covers every translated locale, so a new language cannot skip these rules', () => {
    expect(
      Object.keys(MARKERS).sort(),
      'MARKERS is exhaustive over the shipped translated locales',
    ).toEqual([...TRANSLATED].sort())
  })

  // §L2.0 — the display-name checks for regional variants (`es-419`, `pt-BR`,
  // `pt-PT`) left with the `language.*` keys they read; see the archived copy.
  it('names the two shipped languages in each catalog', async () => {
    const ko = await catalogOf('ko')
    const en = await catalogOf(BASE_LOCALE)
    expect([ko['language.english'], ko['language.korean']]).toEqual(['영어', '한국어'])
    expect([en['language.english'], en['language.korean']]).toEqual(['English', 'Korean'])
  })

  it('tells every non-English reader that the feedback form is in English', async () => {
    const missing: string[] = []
    for (const code of TRANSLATED) {
      const cat = await catalogOf(code)
      const label = cat['tour.help.feedback']
      if (!MARKERS[code]!.englishForm.test(label)) missing.push(`${code}: ${label}`)
    }
    expect(missing, 'the visible feedback label names the form as English').toEqual([])
  })

  it('keeps that marker AND the new-tab notice in the accessible name', async () => {
    const missingForm: string[] = []
    const missingTab: string[] = []
    for (const code of TRANSLATED) {
      const cat = await catalogOf(code)
      const aria = cat['tour.help.feedbackAria']
      if (!MARKERS[code]!.englishForm.test(aria)) missingForm.push(`${code}: ${aria}`)
      if (!MARKERS[code]!.newTab.test(aria)) missingTab.push(`${code}: ${aria}`)
    }
    expect(missingForm, 'the accessible name names the form as English too').toEqual([])
    expect(missingTab, 'and still says the link opens in a new tab').toEqual([])
  })

  it('leaves the English source alone — it is the form, so it makes no claim', async () => {
    const en = await catalogOf(BASE_LOCALE)
    expect(en['tour.help.feedback']).toBe('Send feedback')
    expect(en['tour.help.feedbackAria']).toContain('new tab')
  })
})

// ---------------------------------------------------------------------------
// The resourceType placeholder lists CANONICAL TOKENS, not vocabulary.
//
// `BUILTIN_RESOURCE_TYPES` is `['Gold', 'Energy', 'XP', 'Player', 'Item']` and
// `sameResourceType` compares the normalised strings with `===`. A reader who
// types the translated word gets a CUSTOM type with the generic swatch and no
// built-in colour, so a translated placeholder is not a style choice — it is
// wrong instructions.
//
// MEASURED when Dutch was read back: FOUR shipped locales had translated them.
// `fr` had 4 of 5 wrong, `zh-Hans` and `zh-Hant` all 5, `de` 3 (`Gold` and `XP`
// happen to be spelled the same in German). Eleven other locales already kept
// all five, which is why this is a contract and not a preference.
describe('the resourceType placeholder keeps the canonical tokens', () => {
  it('every catalog contains all five BUILTIN_RESOURCE_TYPES verbatim', async () => {
    const missing: string[] = []
    for (const code of [BASE_LOCALE, ...TRANSLATED]) {
      const cat = await catalogOf(code)
      const value = cat['inspector.resourceType.placeholder']!
      for (const token of BUILTIN_RESOURCE_TYPES) {
        // word boundaries are useless here: CJK catalogs use no spaces
        if (!value.includes(token)) missing.push(`${code}: "${token}" not in ${value}`)
      }
    }
    expect(
      missing,
      'these are byte-matched model tokens — a reader must be able to type them',
    ).toEqual([])
  })

  it('the token list itself is the one the model uses', () => {
    // If a token is ever added, this test fails until every catalog carries it.
    expect([...BUILTIN_RESOURCE_TYPES]).toEqual(['Gold', 'Energy', 'XP', 'Player', 'Item'])
  })
})
