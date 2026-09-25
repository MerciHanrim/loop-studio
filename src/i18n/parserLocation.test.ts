import IntlMessageFormat from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import de from './locales/de'
import en from './locales/en'
import es419 from './locales/es-419'
import esES from './locales/es-ES'
import fr from './locales/fr'
import ja from './locales/ja'
import ko from './locales/ko'
import ptBR from './locales/pt-BR'
import ptPT from './locales/pt-PT'
import ru from './locales/ru'
import th from './locales/th'
import tr from './locales/tr'
import zhHans from './locales/zh-Hans'
import zhHant from './locales/zh-Hant'
import { BASE_LOCALE, LOCALES } from './registry'

// docs/localization.md §L2.11 — `{column}` names TWO different things, and a
// translation has to tell them apart.
//
// In the parser errors it is a **1-based CHARACTER offset**, not a table
// column. The code says so in three places:
//   • `src/model/expr/errors.ts` — "carries a 1-based `column` into the raw
//     text"; `src/model/expr/tokenize.ts` computes it as `i + 1` over string
//     indices, and `parse.test.ts` pins `err('@{a\\b}').column === 4`, the
//     4th CHARACTER.
//   • `src/model/csv.ts` — the field's own doc comment reads "1-based
//     character offset within that row", `col++` per character, `col = 1` at
//     each newline; `csv.test.ts` pins "the opening quote is the 3rd char".
//
// In `import.loc.*` it IS a table column: `DataImportWizard.tsx` passes
// `issue.columnIndex + 1` alongside the column's `header`.
//
// The two groups must therefore use DIFFERENT words in every language that
// distinguishes them. `fr` and `zh-Hant` already did; `ko` / `ja` /
// `zh-Hans` said "column" for both.

const CATALOGS = {
  en,
  ko,
  ja,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  fr,
  de,
  'es-419': es419,
  'es-ES': esES,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  ru,
  th,
  tr,
} as const
type Loc = keyof typeof CATALOGS

/** a position no other number in these messages can collide with */
const N = 7

function render(loc: Loc, key: string): string {
  const msg = (CATALOGS[loc] as Record<string, string>)[key]
  const names = [...msg.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1])
  const args = Object.fromEntries(
    names.map((n) => [n, n === 'column' ? N : n === 'line' ? 3 : `<${n}>`]),
  )
  return String(new IntlMessageFormat(msg, loc).format(args))
}

/** the 7 keys whose `{column}` is a character offset */
const PARSER_KEYS = [
  'error.EXPR_SYNTAX.message',
  'error.EXPR_UNCLOSED_PAREN.message',
  'error.EXPR_UNCLOSED_REF.message',
  'error.EXPR_BAD_ESCAPE.message',
  'error.EXPR_NUMBER_RANGE.message',
  'error.EXPR_BAD_TOKEN.message',
  'import.parseError',
] as const

/** the 3 keys whose `{column}` really is a table column */
const TABLE_KEYS = [
  'import.loc.tableColumnHeader',
  'import.loc.tableRowColumn',
  'import.loc.tableRowColumnHeader',
] as const

/** per locale: how a CHARACTER position must read, and the TABLE-column
 *  wording that must not appear in a parser message. English is the base and
 *  keeps its own "column" wording — it is the origin of the drift, not a
 *  locale being corrected here. */
const VOCAB: Record<Exclude<Loc, 'en'>, { char: string | RegExp; table: string }> = {
  ko: { char: `${N}번째 문자`, table: `${N}열` },
  ja: { char: `${N}文字目`, table: `${N}列目` },
  'zh-Hans': { char: `第 ${N} 个字符`, table: `第 ${N} 列` },
  'zh-Hant': { char: `第 ${N} 個字元`, table: `第 ${N} 欄` },
  fr: { char: `caractère ${N}`, table: `colonne ${N}` },
  // German splits the same way: `Zeichen` for a character offset,
  // `Spalte` for a real table column (§L2.12).
  // both approved German forms: `Zeichen {column}` next to the thing at
  // that position, `an Zeichenposition {column}` as a standalone phrase
  de: { char: new RegExp(`Zeichen(position)? ${N}`), table: `Spalte ${N}` },
  // Spanish splits the same way: `carácter` for a character offset,
  // `columna` for a real table column (§L2.13).
  'es-419': { char: `carácter ${N}`, table: `columna ${N}` },
  // Spain splits it with the same two words
  'es-ES': { char: `carácter ${N}`, table: `columna ${N}` },
  // Portuguese splits it the same way, and the Brazilian spelling is
  // `caractere` — `carácter` / `caráter` are European.
  'pt-BR': { char: `caractere ${N}`, table: `coluna ${N}` },
  // The European spelling, and the whole reason this row is separate: the two
  // Portuguese catalogs must NOT converge on one word here. The guard forces
  // `carácter` on these seven PARSER keys only — `carácter` in its ordinary
  // sense elsewhere in `pt-PT` is not banned, and `caracteres` is the plural
  // in both locales.
  'pt-PT': { char: `carácter ${N}`, table: `coluna ${N}` },
  // Russian splits it the same way. `char` is a RegExp because the parser
  // messages inflect the noun — `в символе 7` in a prepositional phrase — while the
  // table half stays nominative `столбец 7`.
  ru: { char: new RegExp(`символ(е)? ${N}`), table: `столбец ${N}` },
  // Turkish splits it the same way: `karakter` is a character offset,
  // `sütun` a real table column. The ordinal suffix sits on the NUMBER
  // (`{column}. karakter`), so the number leads.
  tr: { char: `${N}. karakter`, table: `sütun ${N}` },
  // Thai keeps the same split: `ตำแหน่งอักขระ` is a character offset into the
  // pasted text, `คอลัมน์` a real spreadsheet column. Thai has no spaces
  // between words, so the number simply follows the noun with one space.
  th: { char: `ตำแหน่งอักขระ ${N}`, table: `คอลัมน์ ${N}` },
}

const LOCS = Object.keys(VOCAB) as Exclude<Loc, 'en'>[]

/** `char` is a string for the locales with one fixed wording and a RegExp
 *  where the language legitimately has more than one (German). */
const saysChar = (out: string, char: string | RegExp) =>
  typeof char === 'string' ? out.includes(char) : char.test(out)

describe('a parser position is a CHARACTER offset, in every language', () => {
  for (const loc of LOCS) {
    it(`${loc} says "${VOCAB[loc].char}", never "${VOCAB[loc].table}"`, () => {
      const wrong: string[] = []
      for (const key of PARSER_KEYS) {
        const out = render(loc, key)
        if (!saysChar(out, VOCAB[loc].char))
          wrong.push(`${key}: no character wording → ${out}`)
        if (out.includes(VOCAB[loc].table)) wrong.push(`${key}: table-column wording → ${out}`)
      }
      expect(wrong).toEqual([])
    })
  }

  it('the 1-based number itself survives into every rendered message', () => {
    for (const loc of [...LOCS, 'en'] as Loc[])
      for (const key of PARSER_KEYS)
        expect(render(loc, key), `${loc} ${key}`).toContain(String(N))
  })

  it('both parsers are covered — expression errors and the CSV parse error', () => {
    expect(PARSER_KEYS.filter((k) => k.startsWith('error.EXPR_'))).toHaveLength(6)
    expect(PARSER_KEYS).toContain('import.parseError')
    // and every EXPR key that takes a position is in the list
    const withColumn = Object.entries(en as Record<string, string>)
      .filter(([k, v]) => k.startsWith('error.EXPR_') && v.includes('{column}'))
      .map(([k]) => k)
    expect(withColumn.sort()).toEqual(
      PARSER_KEYS.filter((k) => k.startsWith('error.EXPR_')).slice().sort(),
    )
  })
})

// The reverse guard. `import.loc.*` is a real table column — correcting the
// parser messages must not touch it, in either direction.
describe('a real table column keeps its own word', () => {
  for (const loc of LOCS) {
    it(`${loc} still says "${VOCAB[loc].table}" for import.loc.*`, () => {
      for (const key of TABLE_KEYS) {
        const out = render(loc, key)
        expect(out, `${loc} ${key}`).toContain(VOCAB[loc].table)
        expect(
          saysChar(out, VOCAB[loc].char),
          `${loc} ${key} must not borrow the character wording`,
        ).toBe(false)
      }
    })
  }

  it('the two groups are disjoint and together are every {column} key', () => {
    const all = Object.entries(en as Record<string, string>)
      .filter(([, v]) => v.includes('{column}'))
      .map(([k]) => k)
      .sort()
    expect(all).toEqual([...PARSER_KEYS, ...TABLE_KEYS].slice().sort())
  })
})

// docs/localization.md §L2.11a item 9 — the same coverage gap `icuEscaping.
// test.ts` closed, and closed the same way.
//
// WHY THE MAPS ARE HAND-WRITTEN: `render()` has to be synchronous, and the
// registry's catalogs are lazy `import()` chunks, so this file cannot build
// `CATALOGS` from the registry. It imports each catalog by name instead.
//
// WHY THAT NEEDS A SEPARATE ASSERTION: every test above iterates `LOCS`, which
// is derived from `VOCAB`, which is derived from `CATALOGS`. A locale missing
// from `CATALOGS` is therefore not a failure — it is simply not tested, and
// the suite stays green. The type system does not catch it either: `VOCAB` is
// keyed on `Exclude<Loc, 'en'>` and `Loc` is `keyof typeof CATALOGS`, so a
// locale absent from `CATALOGS` is absent from the type it would have to
// satisfy. MEASURED while adding `ru`: with its import, its `CATALOGS` entry
// and its `VOCAB` row all removed, `tsc -b` exits 0 and this file passes
// 23/23. The two assertions below are what turns that into a red.
describe('every shipped locale is actually in this file', () => {
  it('CATALOGS covers the registry, base locale included', () => {
    const want = LOCALES.filter((l) => !l.pseudo)
      .map((l) => l.code)
      .sort()
    expect(Object.keys(CATALOGS).sort()).toEqual(want)
  })

  it('VOCAB corrects every locale except the base', () => {
    const want = LOCALES.filter((l) => !l.pseudo && l.code !== BASE_LOCALE)
      .map((l) => l.code)
      .sort()
    expect(Object.keys(VOCAB).sort()).toEqual(want)
    // and the tests above really do run over all of them
    expect(LOCS.slice().sort()).toEqual(want)
  })
})
