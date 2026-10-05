// Issue #301 - the rule behind `scripts/check-licence-screen.mjs`, as a pure
// function so `scripts/licence-screen-rules.test.mjs` can feed it made-up
// sources. The third-party notices are third-party text: the licence view and
// its loader show them as TEXT. Nothing in those files may hand a string to
// the HTML parser:
//
//   - the JSX attribute `dangerouslySetInnerHTML`
//   - `innerHTML` / `outerHTML`, read or written, by name or as `['innerHTML']`
//   - `insertAdjacentHTML`, `document.write` / `writeln`,
//     `createContextualFragment`, `DOMParser`, `setHTMLUnsafe`, `parseHTMLUnsafe`
//
// and the loader reads the portable template through `.content.textContent`.
// A file that does not parse cleanly is a problem, never "clean".
import ts from 'typescript'

const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'write', 'writeln', 'createContextualFragment', 'setHTMLUnsafe', 'parseHTMLUnsafe'])
const HTML_CONSTRUCTORS = new Set(['DOMParser'])

/** the problems in one source file; `name` is used for messages and the parser's JSX mode */
export function checkLicenceSource(name, text) {
  const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind)
  if (sf.parseDiagnostics?.length) return [`${name}: did not parse cleanly - refusing to call it clean`]
  const problems = []
  const at = (node) => `${name}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'dangerouslySetInnerHTML') problems.push(`${at(node)}: dangerouslySetInnerHTML - the notices are shown as text`)
    if (ts.isPropertyAccessExpression(node) && HTML_SINKS.has(node.name.text)) {
      // `.write` / `.writeln` only on `document`
      const isDocWrite = node.name.text === 'write' || node.name.text === 'writeln'
      if (!isDocWrite || node.expression.getText(sf) === 'document') problems.push(`${at(node)}: .${node.name.text} hands a string to the HTML parser`)
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && HTML_SINKS.has(node.argumentExpression.text)) problems.push(`${at(node)}: ['${node.argumentExpression.text}'] hands a string to the HTML parser`)
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && HTML_CONSTRUCTORS.has(node.expression.text)) problems.push(`${at(node)}: ${node.expression.text} parses HTML`)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return problems
}

/** does this source read some `<x>.content.textContent` (the portable template's text)? */
export function readsTemplateContentText(name, text) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let found = false
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'textContent' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'content') found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}
