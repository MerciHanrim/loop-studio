// Issue #300 — key handling and encryption have ONE module.
//
// A protected share link (`loop-share-protected/1`, docs/specs/SEMANTICS-P.md)
// is sealed and opened in `src/model/shareProtected.ts` and nowhere else. The
// format's promises - the iteration count is fixed, the key is never
// extractable, the browser's own error text never reaches a screen or a log -
// hold only while every such call sits in that one file, where the unit tests
// pin them from the outside. A second call site would be outside those tests.
//
//   node scripts/check-share-crypto.mjs
//
// THE RULE IS LEXICAL, like `check:storage-port`. In product code:
//
//   - the key and cipher operations of Web Crypto
//       deriveKey · deriveBits · importKey · exportKey · generateKey ·
//       wrapKey · unwrapKey · encrypt · decrypt
//     appear as a property name (or as a string that is exactly the name) only
//     in the module;
//   - `subtle` appears only in the module and in `src/model/workspace.ts`,
//     which hashes with `digest` and may do nothing else with it;
//   - `getRandomValues` appears only in the module and in
//     `src/model/revision.ts` (revision ids);
//   - nothing imports a `node:` module or a module named `crypto`.
//
// Inside the module:
//   - `console` and `exportKey` do not appear at all;
//   - the iteration count `600000` and the format identifier
//     `loop-share-protected/1` are each written exactly once, and neither is
//     written anywhere else in product code;
//   - every `importKey` / `deriveKey` call passes the literal `false` as its
//     `extractable` argument, and `deriveKey` asks for exactly one usage;
//   - there is exactly one `encrypt` call and one `decrypt` call.
//
// And `package.json` names no cryptography library: Web Crypto only. The one
// exception (issue #301) is `@noble/hashes` 2.4.0 for the synchronous SHA-256 of
// `src/model/workspace.ts`, held to the conditions in
// `scripts/share-crypto-noble.mjs`: one exact version, nothing it depends on,
// one importer, one path, one name, and nothing of it reachable from the module.
//
// What it CANNOT see: a name assembled at run time, code in a dependency, and
// whether the values passed at run time are the ones the format fixes - the
// unit tests in `src/model/shareProtected.test.ts` check those against an
// independent implementation. Test files are not product code and are not
// scanned. The check FAILS CLOSED: a file that does not parse, a missing
// module, or a module with no key derivation in it are errors.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { checkLock, checkNobleUse, checkPackage } from './share-crypto-noble.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const MODULE = 'src/model/shareProtected.ts'
const DIGEST_ONLY = 'src/model/workspace.ts'
const RANDOM_IDS = 'src/model/revision.ts'
const ITERATIONS = 600000
const FORMAT_ID = 'loop-share-protected/1'

const KEY_OPS = new Set(['deriveKey', 'deriveBits', 'importKey', 'exportKey', 'generateKey', 'wrapKey', 'unwrapKey', 'encrypt', 'decrypt'])

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
const inModule = { iterations: 0, formatId: 0, deriveKey: 0, importKey: 0, encrypt: 0, decrypt: 0 }

/** the property name a node is, when it is one: `x.name` or `x['name']` */
function propertyName(n) {
  if (ts.isIdentifier(n) && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) return n.text
  if (ts.isStringLiteralLike(n) && ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n) return n.text
  return null
}
/** the call a property name is the callee of, else null */
function callOf(n) {
  const access = n.parent
  const call = access?.parent
  return call && ts.isCallExpression(call) && call.expression === access ? call : null
}

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, KIND[rel.split('.').pop()])
  if (sf.parseDiagnostics?.length) {
    problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
    continue
  }
  const at = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const isModule = rel === MODULE
  const visit = (n) => {
    // a module specifier: `import ... from 'x'`, `export ... from 'x'`, `import('x')`
    if (ts.isStringLiteralLike(n)) {
      const p = n.parent
      const specifier =
        ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) ||
        (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword && p.arguments[0] === n)
      if (specifier && (n.text.startsWith('node:') || n.text === 'crypto')) violations.push(`${at(n)}  import of '${n.text}' (product code uses Web Crypto, through the module)`)
      if (n.text === FORMAT_ID) {
        if (isModule) inModule.formatId++
        else violations.push(`${at(n)}  '${FORMAT_ID}' written outside the module`)
      }
    }
    if (ts.isNumericLiteral(n) && Number(n.text.replace(/_/g, '')) === ITERATIONS) {
      if (isModule) inModule.iterations++
      else violations.push(`${at(n)}  ${n.text} (the iteration count is written once, in the module)`)
    }
    const name = propertyName(n)
    const bare = ts.isIdentifier(n) ? n.text : ts.isStringLiteralLike(n) ? n.text : null
    if (name && KEY_OPS.has(name)) {
      if (!isModule) violations.push(`${at(n)}  ${name}`)
      else {
        const call = callOf(n)
        if (name === 'exportKey') problems.push(`${at(n)}: exportKey - the key is never exported`)
        if (call && name in inModule) inModule[name]++
        if (call && (name === 'importKey' || name === 'deriveKey')) {
          const extractable = call.arguments[3]
          if (!extractable || extractable.kind !== ts.SyntaxKind.FalseKeyword) problems.push(`${at(n)}: ${name} must pass the literal false as its extractable argument`)
        }
        if (call && name === 'deriveKey') {
          const usages = call.arguments[4]
          if (!usages || !ts.isArrayLiteralExpression(usages) || usages.elements.length !== 1) problems.push(`${at(n)}: deriveKey must ask for exactly one key usage`)
        }
      }
    } else if (bare && KEY_OPS.has(bare) && ts.isStringLiteralLike(n) && !isModule) {
      // a string that IS the name, wherever it sits: `subtle['deriveKey']`, a constant holding it
      violations.push(`${at(n)}  '${bare}'`)
    }
    if (bare === 'subtle' && !isModule && rel !== DIGEST_ONLY) violations.push(`${at(n)}  subtle`)
    if (bare === 'getRandomValues' && !isModule && rel !== RANDOM_IDS) violations.push(`${at(n)}  getRandomValues`)
    if (isModule && ts.isIdentifier(n) && n.text === 'console') problems.push(`${at(n)}: console - the module reports nothing; the browser's error text differs between causes`)
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

if (!fs.existsSync(path.join(ROOT, MODULE))) problems.push(`${MODULE}: the module does not exist`)
else {
  if (inModule.deriveKey === 0) problems.push(`${MODULE}: no deriveKey call found - this check is looking at the wrong file`)
  if (inModule.iterations !== 1) problems.push(`${MODULE}: the iteration count ${ITERATIONS} must be written exactly once (found ${inModule.iterations})`)
  if (inModule.formatId !== 1) problems.push(`${MODULE}: '${FORMAT_ID}' must be written exactly once (found ${inModule.formatId})`)
  if (inModule.encrypt !== 1 || inModule.decrypt !== 1) problems.push(`${MODULE}: expected exactly one encrypt call and one decrypt call (found ${inModule.encrypt} and ${inModule.decrypt})`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const deps = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(pkg[k] ?? {}))
// issue #301 - no cryptography library, with ONE exception: `@noble/hashes`
// 2.4.0 for the synchronous SHA-256 in src/model/workspace.ts, under the
// conditions in scripts/share-crypto-noble.mjs (and its tests). Every source
// the repository has is scanned for it: product code, unit tests, end-to-end
// specs and scripts.
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const everySource = []
const walkAll = (dir) => {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walkAll(abs)
    else if (CODE.test(e.name) && !/\.d\.(ts|mts|cts)$/.test(e.name)) everySource.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), text: fs.readFileSync(abs, 'utf8') })
  }
}
for (const d of ['src', 'e2e', 'scripts']) walkAll(path.join(ROOT, d))
problems.push(...checkPackage(pkg), ...checkLock(lock), ...checkNobleUse(everySource))

console.log(`  scanned ${files.length} product source files, ${everySource.length} sources for @noble imports, and ${deps.length} package names`)
console.log(`  module: ${MODULE} (deriveKey ${inModule.deriveKey}, importKey ${inModule.importKey}, encrypt ${inModule.encrypt}, decrypt ${inModule.decrypt}; iteration count written ${inModule.iterations}x, format identifier ${inModule.formatId}x)`)
for (const p of problems) console.error(`  FAIL  ${p}`)
if (violations.length) {
  console.error(`  FAIL  ${violations.length} use(s) outside the module:`)
  for (const v of violations) console.error(`          ${v}`)
}
if (problems.length || violations.length) {
  console.error(`\n  Key handling and encryption have one module: ${MODULE}.`)
  process.exit(1)
}
console.log('  ok    key handling and encryption stay in the module, with fixed parameters')
