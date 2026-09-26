import { describe, expect, it } from 'vitest'
import { LOCALES } from './registry'

// docs/localization.md §L8 — where a PERCENTAGE puts its sign, per locale.
//
// This started as three separate assertions inside `esEsCopy`, `ptPtCopy` and
// `ruCopy`, each saying "this catalog has U+00A0 before `%` in exactly two
// keys". That form could not answer the question a new locale actually asks —
// does the sign go BEFORE or AFTER, and with WHAT gap — and Turkish is the
// first locale to answer "before, with nothing", which no per-locale NBSP
// count could have expressed.
//
// The contract is declared per locale and asserted EXHAUSTIVE over the
// registry: a new locale cannot ship until someone writes its answer down.
// The declared answer is checked against `Intl.NumberFormat` itself, so the
// table cannot drift from the platform, and against the two catalog strings
// that render a percentage, so the copy cannot drift from the table.
//
// SCOPE: these two keys only. An earlier draft also pinned how many catalog
// values carry U+00A0 anywhere, which tied this file to French punctuation —
// `fr` sets a no-break space inside ordinary prose and a NARROW one (U+202F)
// before `: ; ! ?` — so one new French sentence would have failed a percent
// test. A whole-catalog character budget, where a locale wants one, belongs in
// that locale's own copy test.

const SPACE = String.fromCharCode(0x0020)
const NBSP = String.fromCharCode(0x00a0)
const NNBSP = String.fromCharCode(0x202f)
const PCT = '%'

/** The two keys that render a percentage in running copy. Everything else
 *  formats through ICU, which takes the locale from the registry. */
const PCT_KEYS = ['playbar.mc.progress', 'runbar.mc.cancel'] as const

type Gap = 'none' | 'nbsp'
type Position = 'before' | 'after'

/** MEASURED per locale, then pinned. `gap` is the character between the number
 *  and the sign; `nbsp` means U+00A0, named rather than typed. */
const CONTRACT: Record<string, { position: Position; gap: Gap }> = {
  en: { position: 'after', gap: 'none' },
  ko: { position: 'after', gap: 'none' },
  ja: { position: 'after', gap: 'none' },
  'zh-Hans': { position: 'after', gap: 'none' },
  'zh-Hant': { position: 'after', gap: 'none' },
  fr: { position: 'after', gap: 'nbsp' },
  de: { position: 'after', gap: 'nbsp' },
  'es-419': { position: 'after', gap: 'none' },
  'pt-BR': { position: 'after', gap: 'none' },
  'es-ES': { position: 'after', gap: 'nbsp' },
  'pt-PT': { position: 'after', gap: 'none' },
  ru: { position: 'after', gap: 'nbsp' },
  // the first locale to put the sign FIRST, and with nothing between
  tr: { position: 'before', gap: 'none' },
  // Thai reads like the base here — Latin digits, sign after, no gap. Its
  // `numberLocale` is `th-TH`; MEASURED, the bare `th` lays out identically.
  th: { position: 'after', gap: 'none' },
  vi: { position: 'after', gap: 'none' },
  // MEASURED like every other row: `84%`, U+0038 U+0034 U+0025 — the sign
  // touches the digits. Italian groups its numbers like `de` (`1.234.567,89`)
  // but does NOT take `de`'s no-break space here.
  it: { position: 'after', gap: 'none' },
}

const shipped = LOCALES.filter((l) => !l.pseudo)
const gapChar = (g: Gap) => (g === 'nbsp' ? NBSP : '')

/** How `Intl` itself lays a percentage out, read back from a formatted value
 *  rather than assumed. */
function measure(numberLocale: string): { position: Position; gap: Gap } {
  const s = new Intl.NumberFormat(numberLocale, { style: 'percent' }).format(0.84)
  const i = s.indexOf(PCT)
  const position: Position = i === 0 ? 'before' : 'after'
  const neighbour = position === 'after' ? s[i - 1] : s[i + 1]
  const gap: Gap = neighbour === NBSP ? 'nbsp' : 'none'
  return { position, gap }
}

/** The exact run the copy must contain, sign and gap included. */
const expectedRun = (c: { position: Position; gap: Gap }) =>
  c.position === 'after' ? '{pct}' + gapChar(c.gap) + PCT : PCT + gapChar(c.gap) + '{pct}'

describe('the percent contract is stated for every shipped locale', () => {
  it('CONTRACT covers the registry exactly', () => {
    expect(Object.keys(CONTRACT).sort()).toEqual(shipped.map((l) => l.code).sort())
  })
})

describe('the declared contract matches the platform', () => {
  for (const l of shipped) {
    it(`${l.code} — Intl agrees with the table`, () => {
      expect(measure(l.numberLocale)).toEqual(CONTRACT[l.code])
    })
  }
})

describe('the catalog copy matches the declared contract', () => {
  for (const l of shipped) {
    it(`${l.code} — both {pct} keys put the sign where the table says`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      const c = CONTRACT[l.code]
      const want = expectedRun(c)
      const wrong = expectedRun({ position: c.position === 'after' ? 'before' : 'after', gap: c.gap })
      for (const key of PCT_KEYS) {
        const value = cat[key]
        expect(value, `${l.code} ${key} is missing`).toBeTruthy()
        expect(value, `${l.code} ${key} must contain ${JSON.stringify(want)}`).toContain(want)
        expect(value.includes(wrong), `${l.code} ${key} has the sign on the wrong side`).toBe(false)
      }
    })

    it(`${l.code} — the gap is the exact code point, not a look-alike`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      const c = CONTRACT[l.code]
      for (const key of PCT_KEYS) {
        const v = cat[key]
        const i = v.indexOf(PCT)
        const gapCh = c.position === 'after' ? v[i - 1] : v[i + 1]
        if (c.gap === 'nbsp') {
          // exactly U+00A0 — not a plain space, not the narrow no-break space
          expect(gapCh.codePointAt(0), `${l.code} ${key} gap`).toBe(0x00a0)
          expect(v.includes('{pct}' + SPACE + PCT), `${l.code} ${key} plain space`).toBe(false)
          expect(v.includes('{pct}' + NNBSP + PCT), `${l.code} ${key} narrow nbsp`).toBe(false)
        } else {
          // no gap at all: the sign touches the placeholder
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(SPACE)
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(NBSP)
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(NNBSP)
        }
      }
    })
  }
})
