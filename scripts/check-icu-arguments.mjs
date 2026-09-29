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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const emitMissing = process.argv.includes('--missing')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const DISPOSITION = JSON.parse(readFileSync(resolve(root, 'scripts/icu-argument-disposition.json'), 'utf8'))
const OBLIGATIONS = JSON.parse(readFileSync(resolve(root, 'scripts/isolate-obligations.json'), 'utf8'))

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

const program = ts.createProgram(walk(join(root, 'src')), {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  resolveJsonModule: true,
})
const checker = program.getTypeChecker()

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
      if (a1 && ts.isObjectLiteralExpression(a1)) {
        const enclosing = enclosingOf(n, sf)
        const sink = sinkOf(n, sf)
        for (const p of a1.properties) {
          if (ts.isSpreadAssignment(p)) {
            fail(`${rel}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1}: a SPREAD argument cannot be enumerated`)
            continue
          }
          let name = null
          let expr = null
          if (ts.isPropertyAssignment(p) && p.name) {
            name = p.name.getText(sf).replace(/['"]/g, '')
            expr = p.initializer
          } else if (ts.isShorthandPropertyAssignment(p)) {
            name = p.name.getText(sf)
            expr = p.name
          }
          if (!name || !expr) continue
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
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            expr: expr.getText(sf).replace(/\s+/g, ' '),
            derived: mentionsIsolate(expr)
              ? 'isolated'
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
  console.log(JSON.stringify(missing, null, 1))
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
  const known = OBLIGATIONS.obligations.some(
    (o) => o.file === a.file && o.enclosing === a.enclosing && o.sites.some((s) => (s.args ?? []).includes(a.arg)),
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
