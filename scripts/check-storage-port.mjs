// Issue #297 — browser storage has ONE door.
//
// Every read and write of browser storage goes through `src/storage/storagePort.ts`.
// The port is what decides whether this browser profile is read at all (before
// the storage gate is answered the port is shut; a temporary session reads
// nothing and writes nothing that lasts), so one direct `localStorage` call
// anywhere else silently defeats it. A convention will not hold that line; this
// check does.
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
// The port's second door, `src/storage/themeBoot.js` (issues #302 and #297), is
// a classic script inlined into <head> before the first paint. It may read
// exactly two keys with `getItem`: the storage-mode key, and - only inside an
// `if` whose condition is that read - the theme key. In that order, nothing
// else, and never a write. The nesting is checked on the syntax tree, so the
// theme cannot be read before the mode says `personal`.
//
// A comment is not code, and a longer string that merely mentions a name (a
// message, a storage key) is not the name. The files are read with the
// TypeScript parser, never a regex.
//
// What it CANNOT see — stated so nobody takes a green run for more than it is:
//   - a name assembled at run time (`window['local' + 'Storage']`, `eval`)
//   - code in a dependency (`node_modules`) and in `index.html` / `public/`
//   - other persistence APIs (Cache API, OPFS, `navigator.storage`)
//   - WHEN a call through the port happens: a store that reads at module
//     evaluation is fine behind the gate and a leak in front of it. The module
//     graph is a run-time fact; `e2e/storage-port-runtime.spec.ts` traps it.
// The first needs a run-time trap in a test; the third is a scope decision.
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
/** the port's second door: a classic script inlined into <head> by vite.config.ts */
const BOOT = 'src/storage/themeBoot.js'
const BOOT_MODE_KEY = 'loop-studio:storage-mode'
const BOOT_THEME_KEY = 'loop-studio:theme'
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
/** the boot door's reads, in source order: the key each one reads, and the node */
const bootReads = []

/** `localStorage.getItem('<literal>')` with `n` being the `localStorage` identifier → the literal key, else null */
function bootGetItemKey(n) {
  const access = n.parent
  const call = access?.parent
  const ok =
    n.text === 'localStorage' &&
    ts.isPropertyAccessExpression(access) &&
    access.expression === n &&
    access.name.text === 'getItem' &&
    ts.isCallExpression(call) &&
    call.expression === access &&
    call.arguments.length === 1 &&
    ts.isStringLiteral(call.arguments[0])
  return ok ? { key: call.arguments[0].text, call } : null
}

/** does `node` lie inside `range`'s source span? */
const within = (node, range) => node.getStart() >= range.getStart() && node.getEnd() <= range.getEnd()

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
      if (rel === BOOT) {
        // the boot door: `localStorage.getItem('<one of two keys>')` and nothing else
        const read = bootGetItemKey(n)
        if (read && (read.key === BOOT_MODE_KEY || read.key === BOOT_THEME_KEY)) bootReads.push({ key: read.key, call: read.call, node: n })
        else violations.push(`${at(n)}  ${n.text} (the boot door may only read '${BOOT_MODE_KEY}' and '${BOOT_THEME_KEY}' with getItem)`)
      } else if (rel !== PORT) violations.push(`${at(n)}  ${n.text}`)
      else if (PORT_GLOBALS.has(n.text)) portUses++
    } else if (ts.isStringLiteralLike(n) && STRINGS.has(n.text)) {
      // a string that IS the name: `window['localStorage']`, a constant that
      // holds it, `Reflect.get(window, 'localStorage')`, `addEventListener('storage')`
      if (rel !== PORT && rel !== BOOT) violations.push(`${at(n)}  '${n.text}'`)
    } else if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'storagePort') {
      portCalls++
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (rel === BOOT) {
    // exactly one read of each key, the mode first, and the theme read nested
    // inside an `if` whose condition contains the mode read
    const keys = bootReads.map((r) => r.key)
    if (keys.join(' | ') !== `${BOOT_MODE_KEY} | ${BOOT_THEME_KEY}`) {
      problems.push(`${BOOT}: expected exactly one read of '${BOOT_MODE_KEY}' followed by exactly one read of '${BOOT_THEME_KEY}', found [${keys.join(', ')}]`)
    } else {
      const [mode, theme] = bootReads
      let guarded = false
      for (let p = theme.call.parent; p && !guarded; p = p.parent) {
        if (ts.isIfStatement(p) && within(mode.call, p.expression) && within(theme.call, p.thenStatement)) guarded = true
      }
      if (!guarded) problems.push(`${BOOT}: the theme read at ${at(theme.node)} is not inside an if-statement whose condition is the mode read at ${at(mode.node)}`)
      const cond = (() => {
        for (let p = mode.call.parent; p; p = p.parent) if (ts.isIfStatement(p) && within(mode.call, p.expression)) return p.expression.getText(sf)
        return ''
      })()
      if (!/===\s*'personal'/.test(cond)) problems.push(`${BOOT}: the mode condition must compare the read with 'personal' (found: ${cond || 'none'})`)
    }
  }
}

if (!fs.existsSync(path.join(ROOT, PORT))) problems.push(`${PORT}: the storage port does not exist`)
else if (portUses === 0) problems.push(`${PORT}: the port itself no longer touches a storage global - this check is looking at the wrong file`)
if (!fs.existsSync(path.join(ROOT, BOOT))) problems.push(`${BOOT}: the boot door does not exist`)
// the inlined copy must be the file: a stale or edited copy in index.html would escape the scan
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
if (/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html)) problems.push('index.html: touches browser storage directly; the boot door is inlined by vite.config.ts from the scanned file, never written into index.html')

console.log(`  scanned ${files.length} product source files`)
console.log(`  storage port: ${PORT} (${portUses} use(s) of a storage global inside it, ${portCalls} call(s) through it elsewhere)`)
console.log(`  boot door: ${BOOT} (${bootReads.length} read(s): ${bootReads.map((r) => r.key).join(' then ') || 'none'})`)
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
