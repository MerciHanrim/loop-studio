// docs/localization.md §L3.3 — read the KEYS a catalog domain slice declares,
// from its source, with the TypeScript parser.
//
// WHY THIS MODULE EXISTS
//
// `check-i18n.mjs` used to enumerate slice keys with a text regex:
//
//     /^\s*'([a-zA-Z][\w.]*)'\s*:/gm
//
// `\w` is `[A-Za-z0-9_]`, so a key containing a HYPHEN never matched. MEASURED
// against the base catalog: 806 of 852 keys were seen and 46 were invisible —
// every `import.issue.*`, `import.parseErrorKind.*`, `import.commitError.*` and
// `import.refreshIssue.*` code. Those 46 were therefore not covered by the
// cross-slice duplication guard at all: one of them declared in two domain
// files would have merged silently, and the check would still have printed
// "no cross-file duplication".
//
// The count it printed was not wrong so much as MEANINGLESS — it was the size
// of the subset the regex could see, next to a sentence claiming a property of
// the whole file. That is the failure mode this repo has hit before
// (`registry-source.mjs` exists for the same reason), so the fix is the same
// one: parse the real grammar, and FAIL CLOSED on anything unrecognised rather
// than returning a short list.
//
// `createSourceFile` RECOVERS from a syntax error instead of throwing, so
// `parseDiagnostics` is checked explicitly — without that, a slice that does
// not compile would yield a partial key list and read as success.

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
 * The keys a catalog slice declares, in source order.
 *
 * THROWS — never returns a partial or empty list — when the file cannot be
 * read, does not parse, has no recognisable default export, exports something
 * that is not an object literal, or declares no keys at all. Every one of those
 * is a reason to stop, not a reason to check fewer keys.
 *
 * @param {string} path absolute path to a `<locale>/<domain>.ts`
 * @returns {string[]}
 */
export function sliceKeys(path) {
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

  // `export default <expr>` — either the object itself or the const that holds it
  let exported = null
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st) && !st.isExportEquals) exported = unwrap(st.expression)
  }
  if (!exported) throw new Error(`${path}: no \`export default\` found`)

  let obj = null
  if (ts.isObjectLiteralExpression(exported)) {
    obj = exported
  } else if (ts.isIdentifier(exported)) {
    const name = exported.text
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
          const init = unwrap(d.initializer)
          if (ts.isObjectLiteralExpression(init)) obj = init
        }
      }
    }
    if (!obj) {
      throw new Error(`${path}: \`export default ${name}\` does not resolve to an object literal in this file`)
    }
  } else {
    throw new Error(`${path}: \`export default\` is ${ts.SyntaxKind[exported.kind]}, not an object literal or an identifier`)
  }

  const keys = []
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      throw new Error(`${path}: a spread in the object literal hides keys from this parser`)
    }
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) {
      throw new Error(`${path}: unsupported property kind ${ts.SyntaxKind[p.kind]}`)
    }
    const n = p.name
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) keys.push(n.text)
    else if (ts.isIdentifier(n)) keys.push(n.text)
    else if (ts.isNumericLiteral(n)) keys.push(n.text)
    else throw new Error(`${path}: computed or unsupported key at position ${keys.length + 1}`)
  }

  if (keys.length === 0) throw new Error(`${path}: declares zero keys`)
  return keys
}
