// docs/localization.md §L3.3 / §L12 — read the DOMAIN SLICES a folder locale's
// `index.ts` merges, from its source, with the TypeScript parser.
//
// WHY THIS MODULE EXISTS (issue #414)
//
// `check-i18n.mjs` used to carry its own list of slices:
//
//     const DOMAIN_FILES = ['ui', 'canvas', 'inspector', 'templates', 'dataImport']
//
// and assembled EVERY folder locale — the base `en` included — from that list.
// A slice added to `en/index.ts` (the real merge) but not to the list dropped
// out of both sides at once: the key counts still matched, the new slice's ICU
// was never parsed, the dead-key / unknown-key scan never saw its keys, and the
// run printed `ok`. The list had already been extended once by hand
// (`dataImport`) while its comment still said "the four domain files".
//
// So the slice list is read from the merge itself: the relative default
// imports of `index.ts`, in the order the merged object literal spreads them
// (the spread order is the merge precedence). Anything this parser does not
// recognise is a STOP, never a shorter list — the same rule as
// `catalog-source.mjs` and `registry-source.mjs`.

import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Unwrap `x as const` / `x satisfies T` / `(x)` down to the expression. */
function unwrap(node) {
  let n = node
  for (;;) {
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) {
      n = n.expression
      continue
    }
    return n
  }
}

/**
 * The slice names a locale's `index.ts` merges, in spread order — `['ui',
 * 'canvas', …]` for `import ui from './ui'` … `{ ...ui, ...canvas, … }`.
 *
 * THROWS — never returns a partial or empty list — when the file cannot be
 * read, does not parse, has no default export, the default export does not
 * resolve to an object literal, the literal has anything but spreads of
 * identifiers, a spread identifier is not a relative default import, or an
 * import is not spread. Every one of those is a reason to stop.
 *
 * @param {string} path absolute path to a `<locale>/index.ts`
 * @returns {string[]}
 */
export function catalogSlices(path) {
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`${path}: cannot be read (${e.code ?? e.message})`)
  }
  if (!src.trim()) throw new Error(`${path}: file is empty`)

  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diags = sf.parseDiagnostics ?? []
  if (diags.length) {
    const first = ts.flattenDiagnosticMessageText(diags[0].messageText, ' ')
    const { line } = sf.getLineAndCharacterOfPosition(diags[0].start ?? 0)
    throw new Error(`${path}: does not parse — ${first} (line ${line + 1}); ${diags.length} diagnostic(s)`)
  }

  // relative default imports: local name → slice name (the specifier without './')
  const imports = new Map()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue
    if (st.importClause.isTypeOnly) continue
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = st.moduleSpecifier.text
    const m = /^\.\/([A-Za-z][\w-]*)(?:\.ts)?$/.exec(spec)
    if (!m) continue // `../en` (the type import) and anything not a sibling slice
    imports.set(st.importClause.name.text, m[1])
  }

  // `export default <expr>` — the object itself or the const that holds it
  let exported = null
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st) && !st.isExportEquals) exported = unwrap(st.expression)
  }
  if (!exported) throw new Error(`${path}: no \`export default\` found`)
  let obj = null
  if (ts.isObjectLiteralExpression(exported)) obj = exported
  else if (ts.isIdentifier(exported)) {
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === exported.text && d.initializer) {
          const init = unwrap(d.initializer)
          if (ts.isObjectLiteralExpression(init)) obj = init
        }
      }
    }
    if (!obj) throw new Error(`${path}: \`export default ${exported.text}\` does not resolve to an object literal in this file`)
  } else {
    throw new Error(`${path}: \`export default\` is ${ts.SyntaxKind[exported.kind]}, not an object literal or an identifier`)
  }

  const slices = []
  for (const p of obj.properties) {
    if (!ts.isSpreadAssignment(p)) {
      throw new Error(`${path}: the merged catalog has a property that is not a spread (${ts.SyntaxKind[p.kind]}); a locale's index.ts merges slices and declares no key of its own`)
    }
    const e = unwrap(p.expression)
    if (!ts.isIdentifier(e)) throw new Error(`${path}: a spread of ${ts.SyntaxKind[e.kind]}; only a slice's default import may be spread`)
    const slice = imports.get(e.text)
    if (!slice) throw new Error(`${path}: \`...${e.text}\` is not a relative default import of this file`)
    if (slices.includes(slice)) throw new Error(`${path}: slice "${slice}" is spread twice`)
    slices.push(slice)
  }
  for (const [local, slice] of imports) {
    if (!slices.includes(slice)) throw new Error(`${path}: slice "${slice}" is imported (as ${local}) but not merged`)
  }
  if (slices.length === 0) throw new Error(`${path}: merges zero slices`)
  return slices
}
