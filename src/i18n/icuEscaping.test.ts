import IntlMessageFormat from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import en from './locales/en'
import ko from './locales/ko'
import { BASE_LOCALE, LOCALES } from './registry'

// docs/localization.md §L12 — the catalog contract that is only visible in the
// RENDERED string: ICU quoting (§L4.1). `validateCatalog` compares argument
// names and kinds, which catches a `{n}` that became `{count}`; a quoting
// mistake is not an argument mistake, so it is not visible to it.

// §L2.0 (2026-10) — Korean is the one translated language. The sixteen
// archived ones, and the French plural-category checks that went with them,
// are in `archive/i18n/tests/icuEscaping.multilocale.test.ts`.
const CATALOGS = { ko } as const

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

// docs/localization.md §L2.11a item 9 — this map is hand-written, because the
// rendering above has to be synchronous and the registry's catalogs are lazy
// `import()` chunks. It is asserted EXHAUSTIVE over the registry, so a locale
// added later cannot be missed silently.
describe('every translated locale is actually in this file', () => {
  it('CATALOGS covers the registry', () => {
    const want = LOCALES.filter((l) => !l.pseudo && l.code !== BASE_LOCALE)
      .map((l) => l.code)
      .sort()
    expect(Object.keys(CATALOGS).sort()).toEqual(want)
  })
})
