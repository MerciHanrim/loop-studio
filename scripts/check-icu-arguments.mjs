// docs/localization.md §L9.4 — EVERY ICU argument in shipped source is
// accounted for, and nothing new can appear without saying what it is.
//
//   node scripts/check-icu-arguments.mjs            # the check
//   node scripts/check-icu-arguments.mjs --missing  # rows still needing a class
//
// WHY THIS EXISTS BESIDE `check-isolate-arguments.mjs`
//
// That checker answers "is every DECLARED obligation implemented". It is exact
// in both directions for the sites in its manifest, and its own `$limit` says so:
// it cannot discover an argument that starts carrying a user value later. This
// one answers the other question — "is every argument classified at all" — so the
// population is closed rather than sampled.
//
// It was written because the first attempt at that population was an
// argument-NAME grep of mine (`{header}`, `{label}`, `{name}`…), which is a
// guess about vocabulary rather than a measurement. Re-run from the TypeScript
// TYPE CHECKER it came out at 205 arguments, not the 34 the grep matched.
//
// THE CLASSES, AND WHICH ONES ARE DERIVED RATHER THAN ASSERTED
//
// Three classes are read off the type checker or the syntax, so they are
// evidence and not a claim in a file someone has to keep true:
//
//   number    the expression's type is number-like — no text, nothing to reorder
//   enum      a CLOSED union of string literals; the members are printed so the
//             claim is checkable
//   catalog   the expression is a `t(…)` call (or a conditional whose every leaf
//             is one) — a translated string, already the reader's direction
//   isolated  the expression wraps the value with `isolateAuto` / `isolateLtr`;
//             `scripts/isolate-obligations.json` must declare it
//
// Everything else needs a row in `scripts/icu-argument-disposition.json` stating
// its class and the EVIDENCE for it. An argument with neither a derived class
// nor a row is a STOP, which is what makes a newly added interpolation fail
// closed instead of joining an unexamined majority.
//
// AN ARGUMENT OBJECT PASSED IN A VARIABLE (review I2, 2026-11-22)
//
// `t(key, params)` with `params` a variable used to give no rows at all, so its
// arguments were neither counted nor failed: the revision chip's title and the
// frame announcements' held-key path passed user and wire values raw that way.
// Now a variable is TRACED when it is a `const` in the same function whose
// initializer is an object literal: its properties are the arguments, and so is
// every later `<name>.<prop> = <expr>` in that function (the import wizards set
// `detail.value` to the isolated cell that way). Anything that cannot be traced,
// a variable of any other shape or a `...spread` inside the object, is listed in
// the disposition file's `opaque` section with the REASON it is safe, or it is a
// STOP.
//
// Fixtures: `LOOP_CHECK_SOURCE_OVERRIDES` is a JSON map from a repo-relative path
// to a file that stands in for it (a source file or a manifest), used by
// `scripts/check-argument-variables.test.mjs`.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const emitMissing = process.argv.includes('--missing')
const OVERRIDES = JSON.parse(process.env.LOOP_CHECK_SOURCE_OVERRIDES || '{}')
/** a repo-relative file's text, or its stand-in */
const readRel = (rel) => readFileSync(OVERRIDES[rel] ?? resolve(root, rel), 'utf8')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const DISPOSITION = JSON.parse(readRel('scripts/icu-argument-disposition.json'))
const OBLIGATIONS = JSON.parse(readRel('scripts/isolate-obligations.json'))

/** the classes a manifest row may declare */
const MANIFEST_CLASSES = new Set(['auto', 'ltr', 'per-fragment', 'closed-value', 'unreachable', 'attribute'])
/** the classes that mean "this value needs bounding" — a row in one of these is
 *  a RECORDED OBLIGATION, and the check below asserts whether it is implemented
 *  matches what the row says, in both directions */
const NEEDS_ISOLATE = new Set(['auto', 'ltr', 'per-fragment'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  resolveJsonModule: true,
}
const host = ts.createCompilerHost(compilerOptions)
const hostGetSourceFile = host.getSourceFile
host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
  const rel = relative(root, fileName).replace(/\\/g, '/')
  if (OVERRIDES[rel]) return ts.createSourceFile(fileName, readRel(rel), languageVersion, true)
  return hostGetSourceFile(fileName, languageVersion, onError, shouldCreate)
}
const program = ts.createProgram(walk(join(root, 'src')), compilerOptions, host)
const checker = program.getTypeChecker()

/** strip the wrappers that do not change what an expression is */
function unwrap(e) {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e))
  ) {
    e = e.expression
  }
  return e
}

/** the function a node is in (the scope a traced `const` must share) */
function functionOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p)) {
      return p
    }
  }
  return node.getSourceFile()
}

/** Trace an argument object passed in a variable: `{ lit, assigns }` when it is a
 *  `const` of the same function initialized with an object literal, and every other
 *  use of the name in that function is a property READ, a `<name>.<prop> = …`
 *  assignment or this call; `null` otherwise (a STOP unless declared opaque). */
function traceVariable(arg, call) {
  const e = unwrap(arg)
  if (!ts.isIdentifier(e)) return null
  const sym = checker.getSymbolAtLocation(e)
  const decl = sym?.declarations?.[0]
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return null
  const list = decl.parent
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return null
  const lit = unwrap(decl.initializer)
  if (!ts.isObjectLiteralExpression(lit)) return null
  const fn = functionOf(call)
  if (functionOf(decl) !== fn) return null
  const assigns = []
  let other = false
  const visit = (n) => {
    if (ts.isIdentifier(n) && n !== decl.name && checker.getSymbolAtLocation(n) === sym) {
      const p = n.parent
      if (e === n || (ts.isCallExpression(p) && isTCall(p, p.getSourceFile()) && p.arguments[1] === n)) {
        // the argument object of a `t(…)` call (this one, or another one sharing it)
      } else if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        const outer = p.parent
        if (ts.isBinaryExpression(outer) && outer.left === p) {
          if (outer.operatorToken.kind === ts.SyntaxKind.EqualsToken) assigns.push({ name: p.name.text, expr: outer.right })
          else other = true // a compound assignment
        }
        // otherwise a property read, which changes nothing
      } else {
        other = true // passed on, spread, element access, reassigned: not traceable
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(fn)
  return other ? null : { lit, assigns }
}

function enclosingOf(node, sf) {
  const names = []
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) names.push(p.name.text)
    else if (ts.isMethodDeclaration(p) && p.name) names.push(p.name.getText(sf))
    else if (
      (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
      ts.isVariableDeclaration(p.parent) &&
      p.parent.name
    ) {
      names.push(p.parent.name.getText(sf))
    }
  }
  return names.length ? names.reverse().join('>') : '<module>'
}

/** An HTML attribute on an intrinsic element — markup cannot reach it, which is
 *  the axis PR B kept separate — versus a PROP on a component, which is not an
 *  attribute at all and is usually rendered as text. */
function sinkOf(node, sf) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) {
      const owner = p.parent?.parent
      const tag =
        owner && (ts.isJsxSelfClosingElement(owner) || ts.isJsxOpeningElement(owner))
          ? owner.tagName.getText(sf)
          : '?'
      return `${/^[a-z]/.test(tag) ? 'attr' : 'prop'}:${tag}.${p.name.getText(sf)}`
    }
    if (ts.isJsxExpression(p) && p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) return 'text'
  }
  return 'indirect'
}

const isTCall = (n, sf) => ts.isCallExpression(n) && /(^|\.)t$/.test(n.expression.getText(sf))

/** An argument whose value is bounded where it is PRODUCED rather than in the
 *  argument list. It is accounted for, but not by anything visible at the call
 *  site — `isolate-obligations.json` names the producing function and
 *  `check-isolate-arguments.mjs` asserts which of its returns are wrapped. Only
 *  the two files together close it; this one records that it is claimed. */
const isProducerObligation = (file, enclosing, key, arg) =>
  OBLIGATIONS.obligations.some(
    (o) =>
      o.shape === 'producer' &&
      o.file === file &&
      o.enclosing === enclosing &&
      o.sites.some((s) => (s.keys ?? []).includes(key) && s.producerArg === arg),
  )

/** a translated string: a `t(…)` call, or a conditional whose EVERY leaf is one.
 *  A conditional with one non-catalog arm is deliberately not catalog. */
function isCatalog(expr, sf) {
  if (ts.isParenthesizedExpression(expr)) return isCatalog(expr.expression, sf)
  if (ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return isCatalog(expr.expression, sf)
  if (ts.isConditionalExpression(expr)) return isCatalog(expr.whenTrue, sf) && isCatalog(expr.whenFalse, sf)
  return isTCall(expr, sf)
}

const mentionsIsolate = (expr) => {
  let found = false
  const visit = (n) => {
    if (ts.isIdentifier(n) && /^isolate(Auto|Ltr)$/.test(n.text)) found = true
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return found
}

function typeClass(expr) {
  let type
  try {
    type = checker.getTypeAtLocation(expr)
  } catch {
    return { kind: 'unknown', members: null }
  }
  const parts = type.isUnion() ? type.types : [type]
  const flag = (t) => {
    if (t.flags & ts.TypeFlags.NumberLike) return 'number'
    if (t.flags & ts.TypeFlags.StringLiteral) return 'stringLiteral'
    if (t.flags & ts.TypeFlags.String) return 'string'
    if (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return 'nullish'
    return 'other'
  }
  const kinds = new Set(parts.map(flag))
  kinds.delete('nullish')
  if (kinds.size === 1 && kinds.has('number')) return { kind: 'number', members: null }
  if (kinds.size === 1 && kinds.has('stringLiteral')) {
    return {
      kind: 'enum',
      members: parts.filter((t) => t.flags & ts.TypeFlags.StringLiteral).map((t) => t.value),
    }
  }
  return { kind: 'other', members: null }
}

// ── enumerate ──────────────────────────────────────────────────────────────
const args = []
/** argument objects (or parts of them) that cannot be traced, each needing an
 *  `opaque` entry with its reason */
const opaqueSites = []
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue
  const rel = relative(root, sf.fileName).replace(/\\/g, '/')
  if (!rel.startsWith('src/') || /\.test\.tsx?$/.test(rel)) continue
  if ((sf.parseDiagnostics ?? []).length) {
    console.error(`  FAIL  ${rel}: does not parse`)
    process.exit(1)
  }
  const seen = new Map()
  const visit = (n) => {
    if (isTCall(n, sf) && n.arguments.length > 1) {
      const a0 = n.arguments[0]
      const key = ts.isStringLiteralLike(a0) ? a0.text : `<computed> ${a0.getText(sf).replace(/\s+/g, ' ')}`
      const a1 = n.arguments[1]
      const enclosing = enclosingOf(n, sf)
      const sink = sinkOf(n, sf)
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      const text = (e) => e.getText(sf).replace(/\s+/g, ' ')
      /** one argument, from a property of the object or an assignment to it */
      const push = (name, expr, via) => {
        const id = `${rel}::${enclosing}::${key}::${name}`
        const ord = (seen.get(id) ?? 0) + 1
        seen.set(id, ord)
        const tc = typeClass(expr)
        args.push({
          file: rel,
          enclosing,
          key,
          arg: name,
          ord,
          sink,
          line,
          via,
          expr: text(expr),
          derived: mentionsIsolate(expr)
            ? 'isolated'
            : isProducerObligation(rel, enclosing, key, name)
              ? 'producer'
              : tc.kind === 'number'
                ? 'number'
                : tc.kind === 'enum'
                  ? 'enum'
                  : isCatalog(expr, sf)
                    ? 'catalog'
                    : null,
          members: tc.members,
        })
      }
      let lit = null
      let assigns = []
      if (ts.isObjectLiteralExpression(a1)) {
        lit = a1
      } else {
        const traced = traceVariable(a1, n)
        if (traced) {
          lit = traced.lit
          assigns = traced.assigns
        } else {
          opaqueSites.push({ file: rel, enclosing, key, expr: text(a1), line })
        }
      }
      if (lit) {
        const via = lit === a1 ? 'literal' : `const ${text(unwrap(a1))}`
        for (const p of lit.properties) {
          if (ts.isSpreadAssignment(p)) {
            opaqueSites.push({ file: rel, enclosing, key, expr: text(p), line })
            continue
          }
          if (ts.isPropertyAssignment(p) && p.name) push(p.name.getText(sf).replace(/['"]/g, ''), p.initializer, via)
          else if (ts.isShorthandPropertyAssignment(p)) push(p.name.getText(sf), p.name, via)
        }
        for (const a of assigns) push(a.name, a.expr, `${via}, assigned`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

const addr = (r) => `${r.file}::${r.enclosing}::${r.key}::${r.arg}#${r.ord}`
const rowByAddr = new Map(DISPOSITION.rows.map((r) => [addr(r), r]))

if (emitMissing) {
  const missing = args.filter((a) => !a.derived && !rowByAddr.has(addr(a)))
  const declared = new Set((DISPOSITION.opaque ?? []).map((o) => `${o.file}::${o.enclosing}::${o.key}::${o.expr}`))
  const opaqueMissing = opaqueSites.filter((s) => !declared.has(`${s.file}::${s.enclosing}::${s.key}::${s.expr}`))
  console.log(JSON.stringify({ arguments: missing, opaque: opaqueMissing }, null, 1))
  process.exit(0)
}

console.log(`ICU arguments in shipped source: ${args.length}`)
const tally = {}
for (const a of args) tally[a.derived ?? rowByAddr.get(addr(a))?.class ?? 'UNCLASSIFIED'] = (tally[a.derived ?? rowByAddr.get(addr(a))?.class ?? 'UNCLASSIFIED'] ?? 0) + 1
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('')

// ── 1. every argument is classified, exactly once ──────────────────────────
let unclassified = 0
let doubled = 0
for (const a of args) {
  const row = rowByAddr.get(addr(a))
  if (!a.derived && !row) {
    fail(`UNCLASSIFIED  ${a.file}:${a.line}  ${a.key} {${a.arg}} = ${a.expr.slice(0, 60)}`)
    unclassified++
  }
  if (a.derived && row) {
    fail(`double-classified: ${addr(a)} is derived \`${a.derived}\` AND has a manifest row`)
    doubled++
  }
}
if (!unclassified && !doubled) ok(`every argument classified exactly once: ${args.length} / ${args.length}`)

// ── 1b. an argument object the checker cannot trace (a variable of another shape,
//        or a `...spread` inside the object) is declared in `opaque`, WITH the
//        reason it is safe; a declaration nothing matches is stale ──
const OPAQUE = DISPOSITION.opaque ?? []
const oaddr = (o) => `${o.file}::${o.enclosing}::${o.key}::${o.expr}`
const opaqueByAddr = new Map(OPAQUE.map((o) => [oaddr(o), o]))
let untraced = 0
for (const s of opaqueSites) {
  const d = opaqueByAddr.get(oaddr(s))
  if (!d) {
    fail(`UNTRACEABLE  ${s.file}:${s.line}  ${s.key} receives \`${s.expr}\`, which the checker cannot read; write the arguments as an object literal, or declare it in \`opaque\` with the reason it is safe`)
    untraced++
  } else if (!d.reason || !String(d.reason).trim()) {
    fail(`opaque entry without a reason: ${oaddr(d)}`)
    untraced++
  }
}
const liveOpaque = new Set(opaqueSites.map(oaddr))
for (const o of OPAQUE) {
  if (!liveOpaque.has(oaddr(o))) {
    fail(`stale opaque entry (no such argument object): ${oaddr(o)}`)
    untraced++
  }
}
if (OPAQUE.length !== (DISPOSITION.totals.opaque ?? 0)) {
  fail(`opaque entries: ${OPAQUE.length}, manifest declares ${DISPOSITION.totals.opaque ?? 0}`)
  untraced++
}
if (!untraced) {
  ok(`every argument object is read or declared opaque with a reason: ${args.filter((a) => a.via !== 'literal').length} traced argument(s) from variables, ${opaqueSites.length} opaque part(s)`)
}

// ── 2. no stale manifest row ───────────────────────────────────────────────
const live = new Set(args.map(addr))
let stale = 0
for (const r of DISPOSITION.rows) {
  if (!live.has(addr(r))) {
    fail(`stale disposition row (no such argument): ${addr(r)}`)
    stale++
  }
  if (!MANIFEST_CLASSES.has(r.class)) fail(`unknown class "${r.class}" on ${addr(r)}`)
  if (!r.evidence) fail(`no evidence recorded for ${addr(r)}`)
}
if (!stale) ok(`no stale disposition row: ${DISPOSITION.rows.length} row(s), all live`)

// ── 3. a row that says "needs bounding" must NOT already be wrapped, and a
//       wrapped argument must not be sitting in the disposition file — the two
//       manifests own disjoint halves of the population ──────────────────────
let drift = 0
for (const r of DISPOSITION.rows) {
  const a = args.find((x) => addr(x) === addr(r))
  if (!a) continue
  if (NEEDS_ISOLATE.has(r.class) && a.derived === 'isolated') {
    fail(`${addr(r)} is classed \`${r.class}\` (recorded, not implemented) but IS wrapped — move it to isolate-obligations.json`)
    drift++
  }
  if (!NEEDS_ISOLATE.has(r.class) && a.derived === 'isolated') {
    fail(`${addr(r)} is classed \`${r.class}\` but is wrapped`)
    drift++
  }
}
if (!drift) ok('the two manifests do not overlap')

// ── 4. every WRAPPED argument is declared in isolate-obligations.json.
//    A CROSS-REFERENCE, not a re-derivation: it matches on (file, enclosing,
//    argument), because three of the wrapped sites compute their key and this
//    checker records the key EXPRESSION rather than resolving it. The exact
//    match — resolved key set, argument slot, isolate kind, site count — is
//    `check-isolate-arguments.mjs`, and duplicating that resolver here would be
//    two implementations of one rule. ──
let undeclared = 0
for (const a of args.filter((x) => x.derived === 'isolated')) {
  // a site's declared `args`, or a producer site's `producerArg` (the import
  // wizards' `detail.value`, read through the traced variable since review I2)
  const known = OBLIGATIONS.obligations.some(
    (o) =>
      o.file === a.file &&
      o.enclosing === a.enclosing &&
      o.sites.some((s) => (s.args ?? []).includes(a.arg) || s.producerArg === a.arg),
  )
  if (!known) {
    fail(`wrapped but not declared as an obligation: ${addr(a)}`)
    undeclared++
  }
}
if (!undeclared) ok(`every wrapped argument is a declared obligation: ${args.filter((x) => x.derived === 'isolated').length}`)

// ── 5. NOTHING is left classed "needs bounding but is not bounded". C3.5's
//       first pass recorded 19 such rows; leaving them there would have been a
//       durable record of a known gap rather than a disposition, so they were
//       implemented and moved to `isolate-obligations.json`. The total is
//       asserted at ZERO, and a row reappearing in one of those classes is red. ──
const recorded = DISPOSITION.rows.filter((r) => NEEDS_ISOLATE.has(r.class))
if (recorded.length !== DISPOSITION.totals.recordedNotImplemented) {
  fail(`recorded-not-implemented: ${recorded.length} row(s), manifest declares ${DISPOSITION.totals.recordedNotImplemented}`)
} else if (recorded.length === 0) {
  ok('no argument is classed "needs bounding" while unbounded: 0')
} else {
  fail(`${recorded.length} argument(s) still classed as needing an isolate they do not have`)
}
if (DISPOSITION.rows.length !== DISPOSITION.totals.rows) {
  fail(`disposition rows: ${DISPOSITION.rows.length}, manifest declares ${DISPOSITION.totals.rows}`)
} else {
  ok(`disposition rows: ${DISPOSITION.rows.length} / ${DISPOSITION.totals.rows}`)
}
if (args.length !== DISPOSITION.totals.arguments) {
  fail(`argument total: enumerated ${args.length}, manifest declares ${DISPOSITION.totals.arguments}`)
} else {
  ok(`argument total: ${args.length} / ${DISPOSITION.totals.arguments}`)
}

// ── 6. the attribute axis stays its own number ─────────────────────────────
const attrArgs = args.filter((a) => a.sink.startsWith('attr:'))
if (attrArgs.length !== DISPOSITION.totals.attributeSink) {
  fail(`attribute-sink arguments: enumerated ${attrArgs.length}, manifest declares ${DISPOSITION.totals.attributeSink}`)
} else {
  ok(`attribute-sink arguments (PR B's separate axis): ${attrArgs.length}`)
}

console.log('')
console.log(
  failed
    ? 'check-icu-arguments: FAILED'
    : 'check-icu-arguments: ok — the ICU argument population is closed, with zero unclassified',
)
process.exit(failed ? 1 : 0)
