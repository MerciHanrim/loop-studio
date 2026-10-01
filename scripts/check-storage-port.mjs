// Issue #297, step 1 — browser storage has ONE door.
//
// Every read and write of browser storage goes through `src/storage/storagePort.ts`.
// The port is what later decides whether this browser profile is read at all
// (a temporary session must read nothing and write nothing), so one direct
// `localStorage` call anywhere else silently defeats it. A convention will not
// hold that line; this check does.
//
//   node scripts/check-storage-port.mjs
//
// THE RULE IS LEXICAL, on purpose. Outside the port, these names do not appear
// in product code at all — not as an identifier, not as a string that is
// exactly the name:
//
//   localStorage · sessionStorage · indexedDB · cookie · onstorage · 'storage'
//
// That covers every spelling that can be decided from the source text: a bare
// call, `window.localStorage`, `self.sessionStorage`, `window['localStorage']`,
// `Reflect.get(window, 'localStorage')`, a name held in a constant, a
// destructuring, an alias of `document`, `window.document.cookie`, and the
// `storage` event (which hands a page what ANOTHER tab wrote). It deliberately
// does not try to tell an access from a declaration or a property key: a rule
// with exemptions is a rule with gaps, and the fix for a clash is another name.
//
// A comment is not code, and a longer string that merely mentions a name (a
// message, a storage key) is not the name. The files are read with the
// TypeScript parser, never a regex.
//
// What it CANNOT see — stated so nobody takes a green run for more than it is:
//   - a name assembled at run time (`window['local' + 'Storage']`, `eval`)
//   - code in a dependency (`node_modules`) and in `index.html` / `public/`
//   - other persistence APIs (Cache API, OPFS, `navigator.storage`)
// The first needs a run-time trap in a test; the last is a scope decision.
//
// Test files are not product code and are not scanned. The check FAILS CLOSED:
// a file that does not parse, a missing port, or a port that no longer touches
// `localStorage` itself are each an error, not a clean result.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const PORT = 'src/storage/storagePort.ts'
/** the names that may not appear as an identifier outside the port */
const NAMES = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'onstorage'])
/** the exact string values that may not appear outside the port */
const STRINGS = new Set([...NAMES, 'storage'])
/** the globals the port itself must still touch (fail-closed self-check) */
const PORT_GLOBALS = new Set(['localStorage', 'sessionStorage', 'indexedDB'])

// every extension the bundler would take from `src/`
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const TEST = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const KIND = { ts: ts.ScriptKind.TS, mts: ts.ScriptKind.TS, cts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX }

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs)
    else if (CODE.test(e.name) && !TEST.test(e.name) && !/\.d\.(ts|mts|cts)$/.test(e.name)) files.push(abs)
  }
}
walk(SRC)

const problems = []
const violations = []
let portUses = 0
let portCalls = 0

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, KIND[rel.split('.').pop()])
  if (sf.parseDiagnostics?.length) {
    problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
    continue
  }
  const at = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const visit = (n) => {
    if (ts.isIdentifier(n) && NAMES.has(n.text)) {
      if (rel !== PORT) violations.push(`${at(n)}  ${n.text}`)
      else if (PORT_GLOBALS.has(n.text)) portUses++
    } else if (ts.isStringLiteralLike(n) && STRINGS.has(n.text)) {
      // a string that IS the name: `window['localStorage']`, a constant that
      // holds it, `Reflect.get(window, 'localStorage')`, `addEventListener('storage')`
      if (rel !== PORT) violations.push(`${at(n)}  '${n.text}'`)
    } else if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'storagePort') {
      portCalls++
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

if (!fs.existsSync(path.join(ROOT, PORT))) problems.push(`${PORT}: the storage port does not exist`)
else if (portUses === 0) problems.push(`${PORT}: the port itself no longer touches a storage global - this check is looking at the wrong file`)

console.log(`  scanned ${files.length} product source files`)
console.log(`  storage port: ${PORT} (${portUses} use(s) of a storage global inside it, ${portCalls} call(s) through it elsewhere)`)
for (const p of problems) console.error(`  FAIL  ${p}`)
if (violations.length) {
  console.error(`  FAIL  ${violations.length} direct use(s) of browser storage outside the port:`)
  for (const v of violations) console.error(`          ${v}`)
}
if (problems.length || violations.length) {
  console.error('\n  Browser storage has one door. Read and write through `storagePort`.')
  process.exit(1)
}
console.log('  ok    no direct use of browser storage outside the port')
