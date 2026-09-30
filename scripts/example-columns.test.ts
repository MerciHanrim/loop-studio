import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '../src/i18n/registry'

// docs/localization.md §L9.3 — `import.qs.mapping`, and why it is not a style
// choice.
//
// PR C held the key open with "14 of 17 locales keep it verbatim and 3 translate,
// so which it is has to be decided rather than assumed". Re-read, the premise was
// wrong: EVERY locale keeps the four names. The three that looked different vary
// only in punctuation — `zh-Hans` / `zh-Hant` use the fullwidth colon `：` and
// `fr` spaces its colon ` : ` — and none of them touches a name.
//
// The decision then makes itself. `item_id`, `item_name`, `price` and `drop_rate`
// are the HEADER ROW of `EXAMPLE_CSV`: the text the guide's own "Use this
// example" button pastes into the paste box, and the sample file the download
// button writes. Translating one would make the guide describe a column the
// example does not contain.
//
// So the rule lives BETWEEN the catalogue and the product data, which is why it
// is a check of its own rather than a line in one locale's review. The headers
// are read out of the component SOURCE with the parser rather than repeated as a
// literal here — a second copy of the list is the thing that drifts, and this
// file exists because a first copy already drifted into three e2e specs.
//
// It sits in `scripts/` and not `src/` for the same reason
// `scripts/catalog-source.test.ts` does: `tsconfig.app.json` includes only `src`
// and carries no node types, so a test that reads a file cannot live there.

/** The header row of `EXAMPLE_CSV`, read from `DataImportWizard.tsx`.
 *
 *  Parsed, not regexed. A regex over source is how `check-i18n.mjs` came to miss
 *  46 keys, and the failure mode is the same shape: a pattern that matches
 *  something plausible and stops. If the declaration ever stops being a plain
 *  string literal this throws instead of returning a shorter list. */
function exampleHeaders(): string[] {
  const url = new URL('../src/components/dataImport/DataImportWizard.tsx', import.meta.url)
  const src = readFileSync(url, 'utf8')
  const sf = ts.createSourceFile('DataImportWizard.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const diags = sf.parseDiagnostics as ts.Diagnostic[] | undefined
  if (diags?.length) throw new Error('DataImportWizard.tsx does not parse')
  let csv: string | null = null
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'EXAMPLE_CSV' &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    ) {
      csv = n.initializer.text
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (csv === null) throw new Error('EXAMPLE_CSV is not a plain string literal any more')
  const first = (csv as string).split('\n')[0]
  if (!first) throw new Error('EXAMPLE_CSV has no header row')
  return first.split(',')
}

/** every locale with a catalogue of its own — a pseudo locale ships another
 *  catalogue verbatim (§L9.2) and cannot hold a copy rule */
const REAL = LOCALES.filter((l) => !l.pseudo)

/** the glyphs `scripts/arrow-units.json` tracks */
const TRACKED_ARROWS = '→←↗↖▸◂↶↷▾▶⟳⏭⟲'

describe('`import.qs.mapping` names the columns EXAMPLE_CSV actually has', () => {
  it('reads the header row out of the component, so there is one copy of it', () => {
    expect(exampleHeaders()).toEqual(['item_id', 'item_name', 'price', 'drop_rate'])
  })

  it('every catalogue carries all four verbatim', async () => {
    const headers = exampleHeaders()
    const offenders: string[] = []
    for (const l of REAL) {
      const value = (await l.catalog())['import.qs.mapping']
      if (typeof value !== 'string') {
        offenders.push(`${l.code}: key missing`)
        continue
      }
      for (const h of headers) if (!value.includes(h)) offenders.push(`${l.code}: missing \`${h}\``)
    }
    expect(
      offenders,
      'these are the header row of EXAMPLE_CSV — translating one makes the guide describe a column the example does not have',
    ).toEqual([])
  })

  it('covers every shipped locale, so a new language cannot skip the rule', () => {
    expect(REAL.length, 'catalogue locales').toBe(18)
  })
})

describe('the two HELD keys carry no arrow, so the arrow contract does not govern them', () => {
  // Stated as its own check because the two axes were held together once: whether
  // a key takes an arrow and whether its text is translated are different
  // questions about the same string, and `scripts/arrow-units.json` names neither
  // of these keys.
  for (const key of ['import.qs.mapping', 'tour.nav.position']) {
    it(`\`${key}\` has zero tracked arrow glyphs in every catalogue`, async () => {
      const found: string[] = []
      for (const l of REAL) {
        const value = (await l.catalog())[key]
        if (typeof value !== 'string') continue
        for (const ch of value) if (TRACKED_ARROWS.includes(ch)) found.push(`${l.code}: \`${ch}\``)
      }
      expect(found).toEqual([])
    })
  }
})
