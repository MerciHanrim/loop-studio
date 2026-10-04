// docs/localization.md §L9.3 — every text-carrying form control declares a
// direction, and which one it declares is decided by what the field HOLDS.
//
//   a free user-text field   dir="auto"   the value takes the direction the
//                                         person typed it in
//   everything else          dir="ltr"    numbers, generated values like a
//                                         share URL or serialized JSON, and
//                                         expression grammars
//
// The expression fields are the interesting case: a person can type Arabic into
// one, and the field is still LTR. Being able to enter a character is not the
// same as the field adopting its direction — an expression reads left to right
// whatever it contains.
//
// This is a SOURCE check, deliberately. It is exhaustive and cheap, it runs
// without a browser, and it is the only layer that can say "all of them" rather
// than "the ones a test happened to drive". The runtime behaviour is a separate
// layer in e2e/rtl-form-direction.spec.ts.
//
// Fails closed: a file it cannot parse, a control it cannot classify, or a
// control that carries no `dir` at all is an error, never a skip.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/** controls that carry text and therefore need a direction */
const TEXTUAL_INPUT_TYPES = new Set(['text', 'number', 'search', 'url', 'email', 'tel', 'password'])
/** input types that carry no text of their own */
const NON_TEXTUAL = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'hidden', 'submit', 'button', 'image', 'reset'])

/** fields whose value is a technical grammar, not prose. Listed explicitly:
 *  the classification is a product decision and must not be guessed from a
 *  class name. */
const EXPRESSION_FIELDS = new Set([
  'src/components/Inspector.tsx:flow',
  'src/components/Inspector.tsx:activator-condition',
  'src/components/Inspector.tsx:label-expression',
  'src/components/RegisterExprField.tsx:draft',
])

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) files.push(p)
  }
}
walk(SRC)

const problems = []
const rows = []

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const text = fs.readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (sf.parseDiagnostics?.length) {
    problems.push(`${rel}: did not parse cleanly (${sf.parseDiagnostics.length} diagnostic(s)) - refusing to report it as clean`)
    continue
  }

  const visit = (node) => {
    const open = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node) ? node.openingElement : null
    if (open) {
      const tag = open.tagName.getText(sf)
      if (tag === 'input' || tag === 'textarea') {
        const attr = (name) => {
          const a = open.attributes.properties.find((x) => ts.isJsxAttribute(x) && x.name.getText(sf) === name)
          if (!a) return null
          if (!a.initializer) return 'true'
          if (ts.isStringLiteral(a.initializer)) return a.initializer.text
          // `cond ? 'text' : 'password'` (a show / hide control, issue #300): both
          // branches are literals, so both can be judged. Anything else stays
          // undecidable and fails below.
          const e = ts.isJsxExpression(a.initializer) ? a.initializer.expression : null
          if (e && ts.isConditionalExpression(e) && ts.isStringLiteral(e.whenTrue) && ts.isStringLiteral(e.whenFalse)) {
            return e.whenTrue.text + '|' + e.whenFalse.text
          }
          return '(expression)'
        }
        const type = attr('type')
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        const spread = open.attributes.properties.some((x) => ts.isJsxSpreadAttribute(x))
        // a conditional type carries text only when EVERY branch does
        const types = type === null ? [] : type.split('|')
        const textual =
          tag === 'textarea' || type === null || types.every((x) => TEXTUAL_INPUT_TYPES.has(x))
        if (!textual && !types.every((x) => NON_TEXTUAL.has(x))) {
          problems.push(`${rel}:${line} <${tag} type="${type}"> - unknown input type, cannot decide whether it carries text`)
        } else if (textual) {
          const dir = attr('dir')
          rows.push({ rel, line, tag, type, dir, spread })
          if (dir === null) {
            problems.push(`${rel}:${line} <${tag}${type ? ' type="' + type + '"' : ''}> carries text and declares no dir`)
          } else if (dir !== 'auto' && dir !== 'ltr' && dir !== 'rtl') {
            problems.push(`${rel}:${line} <${tag}> declares dir="${dir}", which is not a direction this contract allows`)
          } else if (type === 'number' && dir !== 'ltr') {
            problems.push(`${rel}:${line} a number field declares dir="${dir}" - a numeric token is pinned ltr`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const byDir = {}
for (const r of rows) byDir[r.dir ?? '(none)'] = (byDir[r.dir ?? '(none)'] ?? 0) + 1

console.log('check-form-direction')
console.log('  text-carrying controls found :', rows.length)
console.log('  by declared direction        :', JSON.stringify(byDir))
if (rows.length === 0) {
  problems.push('no text-carrying controls were found at all - the reader is broken, not the source')
}
console.log('  problems                     :', problems.length)
for (const p of problems) console.log('     ' + p)
if (problems.length) process.exitCode = 1
else console.log('  every text-carrying control declares a direction')
