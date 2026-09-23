import { describe, expect, it } from 'vitest'

import { displayLocaleOrder } from './languageOptions'
import { BASE_ENTRY, BASE_LOCALE, LOCALES, type LocaleEntry } from './registry'

// docs/localization.md §L5.6 — the picker's DISPLAY order.
//
// The registry array is DATA. Its order is the order languages happened to
// ship, and nothing may depend on it — `BASE_ENTRY` used to be `LOCALES[0]`,
// which would have made the base locale Chinese the moment this sort was
// applied to the array itself. So the sort lives here, at the presentation
// layer, over a COPY.
//
// Key: `englishName` under `Intl.Collator('en')`, with `code` as a
// deterministic tiebreak. It is the one label that does not move when the UI
// language changes — sorting by the display name would re-order the list
// under the user at the exact moment they are changing language, and sorting
// by endonym would group by script instead.

const codes = (l: readonly LocaleEntry[]) => l.map((e) => e.code)

/** the nine shipped languages, in the order the picker must show them */
const SHIPPED_ORDER = [
  'zh-Hans', // Chinese (Simplified)
  'zh-Hant', // Chinese (Traditional)
  'en', //      English
  'fr', //      French
  'de', //      German
  'ja', //      Japanese
  'ko', //      Korean
  'pt-BR', //   Portuguese (Brazil)
  'es-419', //  Spanish (Latin America)
]

describe('§L5.6 — the picker display order', () => {
  it('sorts the shipped locales by English name', () => {
    const shipped = LOCALES.filter((l) => !l.pseudo)
    expect(codes(displayLocaleOrder(shipped))).toEqual(SHIPPED_ORDER)
  })

  it('keeps a DEV pseudo-locale last, out of the sorted set', () => {
    // it is selectable and searchable, but it is not a language a user has
    // (§L5.4), so it must not sort in among them
    const pseudo = { ...(LOCALES[0] as LocaleEntry), code: 'en-XA', englishName: 'Pseudo (QA)', pseudo: true }
    const ordered = displayLocaleOrder([...LOCALES.filter((l) => !l.pseudo), pseudo])
    expect(codes(ordered)).toEqual([...SHIPPED_ORDER, 'en-XA'])
    // and two of them keep a deterministic order among themselves
    const second = { ...pseudo, code: 'en-XB', englishName: 'Pseudo B (QA)' }
    expect(codes(displayLocaleOrder([second, pseudo]))).toEqual(['en-XA', 'en-XB'])
  })

  it('is a pure function of the SET, not of the input order', () => {
    const shuffles: LocaleEntry[][] = [
      [...LOCALES],
      [...LOCALES].reverse(),
      [...LOCALES].slice(3).concat([...LOCALES].slice(0, 3)),
      [...LOCALES].sort((a, b) => a.code.localeCompare(b.code)),
      [...LOCALES].sort((a, b) => b.code.localeCompare(a.code)),
    ]
    const want = codes(displayLocaleOrder(LOCALES))
    for (const s of shuffles) {
      expect(codes(displayLocaleOrder(s)), s.map((l) => l.code).join(',')).toEqual(want)
    }
  })

  it('never mutates or aliases the array it is given', () => {
    const input = [...LOCALES]
    const before = codes(input)
    const out = displayLocaleOrder(input)
    expect(codes(input), 'the caller’s array is untouched').toEqual(before)
    expect(out).not.toBe(input)
  })

  it('ties break on `code`, so the order can never depend on the input', () => {
    const a = { ...(LOCALES[0] as LocaleEntry), code: 'xx-B', englishName: 'Same Name' }
    const b = { ...(LOCALES[0] as LocaleEntry), code: 'xx-A', englishName: 'Same Name' }
    expect(codes(displayLocaleOrder([a, b]))).toEqual(['xx-A', 'xx-B'])
    expect(codes(displayLocaleOrder([b, a]))).toEqual(['xx-A', 'xx-B'])
  })

  it('does not drop or duplicate an entry', () => {
    const out = displayLocaleOrder(LOCALES)
    expect(out).toHaveLength(LOCALES.length)
    expect(new Set(codes(out)).size).toBe(LOCALES.length)
  })
})

describe('§L5.6 — the registry array is data, and nothing reads its order', () => {
  it('BASE_ENTRY is the entry whose code is BASE_LOCALE, not a position', () => {
    expect(BASE_ENTRY.code).toBe(BASE_LOCALE)
    // ...and it stays that way when the array is in any other order: this is
    // the contract that a naive "just sort LOCALES" would break, since the
    // first entry by English name is `zh-Hans`.
    expect(displayLocaleOrder(LOCALES)[0]?.code).not.toBe(BASE_LOCALE)
  })
})
