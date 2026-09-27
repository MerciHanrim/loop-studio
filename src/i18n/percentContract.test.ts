import { describe, expect, it } from 'vitest'
import { bidiFindings } from './bidiControls'
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

/** What `Intl` does, as this file reads it back. `gap` is the VISIBLE run
 *  between the number and the sign (`nbsp` means U+00A0, named rather than
 *  typed); `sign` is whichever character the platform actually uses; `bidi`
 *  names the zero-width controls it wraps the value in, if any. */
type Measured = { position: Position; gap: Gap; sign: string; bidi: readonly string[] }

/** The subset a locale DECLARES. `sign` and `bidi` are omitted by the locales
 *  that take the plain Latin sign and no controls — the default below fills
 *  them in, so seventeen rows do not have to repeat the same two fields, and a
 *  locale that departs from either has to say so in its own row. */
type Declared = { position: Position; gap: Gap; sign?: string; bidi?: readonly string[] }

const DEFAULT_SIGN = PCT
const DEFAULT_BIDI: readonly string[] = []

/** MEASURED per locale, then pinned. */
const CONTRACT: Record<string, Declared> = {
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
  // MEASURED: `84%`, U+0038 U+0034 U+0025 — the sign touches the digits.
  // Dutch groups its numbers like `de` (`1.234.567,89`) and takes `de`'s
  // separator NOWHERE: grouping like one arm and spacing like the other is
  // exactly the combination an assumption would have got wrong.
  nl: { position: 'after', gap: 'none' },
}

const shipped = LOCALES.filter((l) => !l.pseudo)
const gapChar = (g: Gap) => (g === 'nbsp' ? NBSP : '')

/** The invisible bidi marks `Intl` may wrap a percentage in. Named, not typed:
 *  they are zero-width on screen, so a literal here could not be reviewed by
 *  eye, and a test that prints one prints nothing. */
const BIDI_CONTROLS = new Map<string, string>([
  [String.fromCharCode(0x200e), 'LRM'],
  [String.fromCharCode(0x200f), 'RLM'],
  [String.fromCharCode(0x061c), 'ALM'],
])

/** How `Intl` itself lays a percentage out, read back from the FORMATTED PARTS.
 *
 *  This used to read the formatted STRING and search it for `'%'`. That form
 *  answered confidently and wrongly for two whole classes of locale, and both
 *  failures were silent — no throw, no red, just a wrong row:
 *
 *   1. A locale whose sign is not U+0025. `ar-EG` emits U+066A (ARABIC PERCENT
 *      SIGN), so `indexOf('%')` was -1, `position` fell through to `'after'`
 *      because -1 !== 0, and the gap was read from `s[-2]` — `undefined`. The
 *      table then demanded the catalog carry a LATIN `%` the platform never
 *      produces.
 *   2. A locale that wraps the sign in an invisible bidi control. `ar` emits
 *      `84 U+200E % U+200E`, so the character next to the sign is an LRM. The
 *      old gap test compared it against SPACE / NBSP / NNBSP only, so an LRM
 *      read as "no gap at all" — the guard could not see bidi controls, which
 *      is exactly what an RTL locale is about to introduce.
 *
 *  `formatToParts` removes both guesses: the sign is found by its `type`
 *  whatever character it is, and every literal is a separate part, so a
 *  zero-width control can be told apart from a visible gap instead of being
 *  mistaken for one. */
function measure(numberLocale: string): Measured {
  const parts = new Intl.NumberFormat(numberLocale, { style: 'percent' }).formatToParts(0.84)
  const signAt = parts.findIndex((p) => p.type === 'percentSign')
  if (signAt < 0) throw new Error(`${numberLocale}: Intl emitted no percentSign part`)
  const numberAt = parts.findIndex((p) => p.type === 'integer')
  if (numberAt < 0) throw new Error(`${numberLocale}: Intl emitted no integer part`)

  const position: Position = signAt < numberAt ? 'before' : 'after'
  // everything between the number and the sign, in source order
  const [from, to] = position === 'after' ? [numberAt + 1, signAt] : [signAt + 1, numberAt]
  const between = parts.slice(from, to).map((p) => p.value)

  const visible = between.filter((v) => ![...v].every((c) => BIDI_CONTROLS.has(c))).join('')
  const controls = parts
    .flatMap((p) => [...p.value])
    .filter((c) => BIDI_CONTROLS.has(c))
    .map((c) => BIDI_CONTROLS.get(c)!)

  const gap: Gap = visible === NBSP ? 'nbsp' : 'none'
  if (visible !== '' && visible !== NBSP) {
    throw new Error(`${numberLocale}: unhandled visible gap ${JSON.stringify(visible)}`)
  }
  return { position, gap, sign: parts[signAt]!.value, bidi: controls }
}

/** The declared row, with the two common fields filled in. */
const declared = (code: string): Measured => {
  const d = CONTRACT[code]!
  return { position: d.position, gap: d.gap, sign: d.sign ?? DEFAULT_SIGN, bidi: d.bidi ?? DEFAULT_BIDI }
}

/** The exact run the copy must contain, sign and gap included. The sign comes
 *  from the row, not from `PCT`: a locale whose platform sign is not U+0025
 *  must be asked for ITS sign, which is the case the old string search could
 *  not even express. */
const expectedRun = (c: Measured) =>
  c.position === 'after' ? '{pct}' + gapChar(c.gap) + c.sign : c.sign + gapChar(c.gap) + '{pct}'

describe('the percent contract is stated for every shipped locale', () => {
  it('CONTRACT covers the registry exactly', () => {
    expect(Object.keys(CONTRACT).sort()).toEqual(shipped.map((l) => l.code).sort())
  })
})

describe('the declared contract matches the platform', () => {
  for (const l of shipped) {
    it(`${l.code} — Intl agrees with the table`, () => {
      expect(measure(l.numberLocale)).toEqual(declared(l.code))
    })
  }

  // The reason this file was rewritten. Both rows below are what `ar` and
  // `ar-EG` really do; neither is registered, and the point is that the
  // measurement can now SEE them. Under the old string search `ar-EG` returned
  // `{after, none}` — the same answer as English — from `indexOf` returning -1.
  it('reads a non-Latin percent sign instead of failing to find one', () => {
    const m = measure('ar-EG')
    expect(m.sign).toBe(String.fromCharCode(0x066a))
    expect(m.sign).not.toBe(PCT)
    expect(m.bidi).toEqual(['ALM'])
  })

  it('tells an invisible bidi control apart from a visible gap', () => {
    const m = measure('ar')
    expect(m.sign).toBe(PCT)
    // the character beside the sign is an LRM, which is NOT a gap
    expect(m.gap).toBe('none')
    expect(m.bidi).toEqual(['LRM', 'LRM'])
  })

  it('still calls a real no-break space a gap', () => {
    expect(measure('ru')).toEqual({ position: 'after', gap: 'nbsp', sign: PCT, bidi: [] })
  })
})

describe('the catalog copy matches the declared contract', () => {
  for (const l of shipped) {
    it(`${l.code} — both {pct} keys put the sign where the table says`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      const c = declared(l.code)
      const want = expectedRun(c)
      const wrong = expectedRun({ ...c, position: c.position === 'after' ? 'before' : 'after' })
      for (const key of PCT_KEYS) {
        const value = cat[key]
        expect(value, `${l.code} ${key} is missing`).toBeTruthy()
        expect(value, `${l.code} ${key} must contain ${JSON.stringify(want)}`).toContain(want)
        expect(value.includes(wrong), `${l.code} ${key} has the sign on the wrong side`).toBe(false)
      }
    })

    it(`${l.code} — the gap is the exact code point, not a look-alike`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      const c = declared(l.code)
      for (const key of PCT_KEYS) {
        const v = cat[key]
        const i = v.indexOf(c.sign)
        const gapCh = c.position === 'after' ? v[i - 1] : v[i + 1]
        if (c.gap === 'nbsp') {
          // exactly U+00A0 — not a plain space, not the narrow no-break space
          expect(gapCh.codePointAt(0), `${l.code} ${key} gap`).toBe(0x00a0)
          expect(v.includes('{pct}' + SPACE + c.sign), `${l.code} ${key} plain space`).toBe(false)
          expect(v.includes('{pct}' + NNBSP + c.sign), `${l.code} ${key} narrow nbsp`).toBe(false)
        } else {
          // no gap at all: the sign touches the placeholder
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(SPACE)
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(NBSP)
          expect(gapCh, `${l.code} ${key} must have no gap`).not.toBe(NNBSP)
        }
      }
    })

    // A catalog must not carry the scopeless marks `Intl` adds at format time.
    // These two keys are LITERAL copy — `{pct}` is a plain number and the sign
    // beside it is catalog text, so `Intl.NumberFormat(style:'percent')` never
    // runs on them. Whatever controls the platform would emit belong to the
    // platform; writing one into the message would ship a zero-width character
    // no reviewer can see and no locale asked for.
    //
    // This checks `bidiFindings`, NOT "contains no control at all". The
    // difference matters for the locale this file was rewritten for: a PAIRED
    // isolate is a legitimate mechanism where markup cannot reach, and the
    // catalog-wide rule for it lives in `bidiControls.test.ts` with its
    // allowlist. A scopeless LRM here is still wrong, and still fails.
    it(`${l.code} — the copy carries no scopeless bidi control`, async () => {
      const cat = (await l.catalog()) as Record<string, string>
      for (const key of PCT_KEYS) {
        const found = bidiFindings(cat[key]!).map((f) => `${f.kind} ${f.name}@${f.at}`)
        expect(found, `${l.code} ${key} has bidi controls in the catalog text`).toEqual([])
      }
    })
  }
})
