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
// It parses every product source file with the TypeScript parser (never a
// regex: a comment or a string that merely mentions `localStorage` is not an
// access) and fails on any use of a storage global outside the port:
//
//   localStorage · sessionStorage · indexedDB · document.cookie
//
// in any spelling — bare, `window.localStorage`, `globalThis['localStorage']`.
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
const GLOBALS = new Set(['localStorage', 'sessionStorage', 'indexedDB'])

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(abs)
  }
}
walk(SRC)

const problems = []
const violations = []
let portUses = 0
let portCalls = 0

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (sf.parseDiagnostics?.length) {
    problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
    continue
  }
  const at = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const hit = (n, what) => {
    if (rel === PORT) portUses++
    else violations.push(`${at(n)}  ${what}`)
  }
  const visit = (n) => {
    if (ts.isIdentifier(n) && GLOBALS.has(n.text)) {
      const p = n.parent
      // a DECLARATION named like the global (a property key, a parameter, a
      // variable) is not an access; everything else is. The walk is not
      // scope-aware on purpose: a local that SHADOWS a storage global is still
      // reported where it is used. That errs on the side of failing, and the
      // fix is to give the local another name.
      const declares =
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isPropertySignature(p) && p.name === n) ||
        (ts.isParameter(p) && p.name === n) ||
        (ts.isVariableDeclaration(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.name === n)
      if (!declares) hit(n, n.text)
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && GLOBALS.has(n.argumentExpression.text)) {
      hit(n, `['${n.argumentExpression.text}']`)
    } else if (ts.isPropertyAccessExpression(n) && n.name.text === 'cookie' && ts.isIdentifier(n.expression) && n.expression.text === 'document') {
      hit(n, 'document.cookie')
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
