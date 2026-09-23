import IntlMessageFormat from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import de from './locales/de'
import en from './locales/en'
import es419 from './locales/es-419'
import fr from './locales/fr'
import ja from './locales/ja'
import ko from './locales/ko'
import zhHans from './locales/zh-Hans'
import zhHant from './locales/zh-Hant'

// docs/localization.md §L12 — the catalog contracts that are only visible in
// the RENDERED string: ICU quoting (§L4.1) and plural-category fallback
// (§L4.6). `validateCatalog` compares argument names and kinds, which catches
// a `{n}` that became `{count}`; neither of these is an argument mistake, so
// neither is visible to it.

const CATALOGS = { de, 'es-419': es419, fr, ja, ko, 'zh-Hans': zhHans, 'zh-Hant': zhHant } as const

/** Enough of an argument bag to render anything: a number satisfies a plain
 *  slot, `number` and `plural`, and falls through a `select` to its `other`
 *  arm (which `validateCatalog` already requires). */
function args(message: string, n = 1): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)) out[m[1]] = n
  return out
}

const render = (message: string, locale: string, n = 1) =>
  String(new IntlMessageFormat(message, locale).format(args(message, n)))

const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length

// ---------------------------------------------------------------- quoting
//
// The real defect this guards (French, caught in review 2026-09-22): the
// message was written as a DOUBLE-quoted TS string, so every backslash was
// doubled for TypeScript on top of ICU's own `'...'` quoting, and ICU emitted
// the backslashes as text —
//
//     en  “@{” at column 5 is never closed
//     fr  « @\{\ » au caractère 5 n’est jamais fermée      ← two stray \
//
// Both parse. Both declare `{column}`. Only rendering them shows it.
//
// The invariant: a translation may say anything, but the SYNTAX CHARACTERS it
// quotes are the product's own, so each locale must render exactly as many
// backslashes and literal braces as `en` does for that key.
describe('ICU quoting survives into the rendered string', () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    it(`${locale} renders every message, with en's literal syntax characters`, () => {
      const wrong: string[] = []
      for (const [key, message] of Object.entries(catalog as Record<string, string>)) {
        const base = en[key as keyof typeof en]
        if (base == null) continue
        let mine: string
        let theirs: string
        try {
          theirs = render(base, 'en')
          mine = render(message, locale)
        } catch (e) {
          wrong.push(`${key}: throws — ${(e as Error).message}`)
          continue
        }
        for (const ch of ['\\', '{', '}']) {
          const a = count(theirs, ch)
          const b = count(mine, ch)
          if (a !== b) wrong.push(`${key}: ${JSON.stringify(ch)} en=${a} ${locale}=${b} → ${mine}`)
        }
      }
      expect(wrong).toEqual([])
    })
  }
})

// ------------------------------------------------------- plural categories
//
// French cardinal rules select `many` for exact multiples such as 1,000,000
// (2,000,000 too; 1,000,001 is `other`). The French catalog omits an explicit
// `many` arm because its wording would be identical to `other`, and the ICU
// fallback to `other` is what makes that safe. That fallback is a contract, so
// it is tested rather than assumed: the day a French message needs a `many`
// wording that differs, this is where the free omission stops being free.
describe('French plural categories', () => {
  /** the wording, with every number and its group separators taken out */
  const wording = (s: string) => s.replace(/[\d  .,\s]+/g, ' ').trim()

  it('selects many for an exact million, and other just past it', () => {
    const pr = new Intl.PluralRules('fr')
    expect(pr.select(0)).toBe('one') // French puts 0 in `one`, unlike English
    expect(pr.select(1)).toBe('one')
    expect(pr.select(2)).toBe('other')
    expect(pr.select(1_000_000)).toBe('many')
    expect(pr.select(2_000_000)).toBe('many')
    expect(pr.select(1_000_001)).toBe('other')
  })

  it('every French plural renders at 1,000,000 through its `other` arm', () => {
    const checked: string[] = []
    for (const [key, message] of Object.entries(fr as Record<string, string>)) {
      if (!message.includes(', plural,')) continue
      checked.push(key)
      expect(/many\s*\{/.test(message), `${key} has an explicit many arm`).toBe(false)
      // renders without an ICU error, and says what the `other` arm says
      expect(wording(render(message, 'fr', 1_000_000)), `${key} at 1,000,000`).toBe(
        wording(render(message, 'fr', 2)),
      )
    }
    expect(checked.length, 'the French catalog must actually have plurals').toBe(19)
  })

  it('0 takes the `one` arm, where the gender and participle agreement lives', () => {
    const at0 = (key: string) => render(fr[key as keyof typeof fr] as string, 'fr', 0)
    expect(at0('import.refresh.review.added')).toBe('0 ligne sera ajoutée')
    expect(at0('import.refresh.review.locallyDeleted')).toBe('0 valeur a été supprimée localement')
    expect(at0('import.refresh.review.fkRepoints')).toBe('0 clé étrangère a changé')
  })
})
