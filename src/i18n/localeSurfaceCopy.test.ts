import { describe, expect, it } from 'vitest'

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
//     matches the source perfectly and still misinforms its reader.
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
const MARKERS: Record<string, SurfaceMarkers> = {
  ko: { englishForm: /영문/, newTab: /새 탭/ },
  ja: { englishForm: /英語/, newTab: /新しいタブ/ },
  'zh-Hans': { englishForm: /英文/, newTab: /新标签页/ },
  'zh-Hant': { englishForm: /英文/, newTab: /新分頁/ },
  fr: { englishForm: /anglais/i, newTab: /onglet/i },
  de: { englishForm: /englisch/i, newTab: /Tab/ },
  'es-419': { englishForm: /inglés/i, newTab: /pestaña/i },
  // Brazilian Portuguese says `aba` for a browser tab; `guia` is the
  // Microsoft-style rendering and is not what this catalog uses.
  'pt-BR': { englishForm: /inglês/i, newTab: /aba/i },
  // same language as `es-419`, so the same markers — but the row is still
  // required, because the map is asserted exhaustive over the registry and a
  // locale with no row would otherwise ship unchecked
  'es-ES': { englishForm: /inglés/i, newTab: /pestaña/i },
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

  it('names Latin American Spanish the way Korean software names it', async () => {
    // It shipped as `라턴아메리카` — one stroke off a word that does not exist,
    // invisible to every mechanical check and to any reader of the other seven
    // languages. The replacement is not the literal transliteration either:
    // Korean software says `중남미` for this region (the same choice Diablo IV
    // makes), even though `라틴 아메리카` is the more precise geographic term
    // for what `es-419` covers. The endonym stays `Español (Latinoamérica)`
    // and English stays `Spanish (Latin America)`.
    const ko = await catalogOf('ko')
    expect(ko['language.spanishLatinAmerica']).toBe('스페인어(중남미)')
  })

  // A regional variant's display name is the one string a reader cannot check
  // for themselves: it names a language they do not read, in a language they
  // do. `check:i18n` proves the key EXISTS and that its ICU shape matches, so
  // a value copied from the wrong catalog passes every mechanical gate —
  // `es-419` shipped this key holding the PORTUGUESE endonym for exactly that
  // reason. Each locale's own word for the language, pinned.
  it('names Brazilian Portuguese in each locale, never borrowing the endonym', async () => {
    const want: Record<string, string> = {
      ko: '포르투갈어(브라질)',
      'es-419': 'Portugués (Brasil)',
      'pt-BR': 'Português (Brasil)',
    }
    const got: Record<string, string> = {}
    for (const code of Object.keys(want)) {
      got[code] = (await catalogOf(code))['language.portugueseBrazil']
    }
    expect(got).toEqual(want)
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
