import IntlMessageFormat from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import en from './locales/en'
import fr from './locales/fr'
import ja from './locales/ja'
import ko from './locales/ko'
import zhHans from './locales/zh-Hans'
import zhHant from './locales/zh-Hant'

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

const CATALOGS = { en, ko, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant, fr } as const
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
const VOCAB: Record<Exclude<Loc, 'en'>, { char: string; table: string }> = {
  ko: { char: `${N}번째 문자`, table: `${N}열` },
  ja: { char: `${N}文字目`, table: `${N}列目` },
  'zh-Hans': { char: `第 ${N} 个字符`, table: `第 ${N} 列` },
  'zh-Hant': { char: `第 ${N} 個字元`, table: `第 ${N} 欄` },
  fr: { char: `caractère ${N}`, table: `colonne ${N}` },
}

const LOCS = Object.keys(VOCAB) as Exclude<Loc, 'en'>[]

describe('a parser position is a CHARACTER offset, in every language', () => {
  for (const loc of LOCS) {
    it(`${loc} says "${VOCAB[loc].char}", never "${VOCAB[loc].table}"`, () => {
      const wrong: string[] = []
      for (const key of PARSER_KEYS) {
        const out = render(loc, key)
        if (!out.includes(VOCAB[loc].char)) wrong.push(`${key}: no character wording → ${out}`)
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
        expect(out, `${loc} ${key} must not borrow the character wording`).not.toContain(
          VOCAB[loc].char,
        )
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
