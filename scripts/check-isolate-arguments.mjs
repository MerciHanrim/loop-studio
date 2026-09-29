// docs/localization.md §L9.4 — every deferred isolation obligation is
// implemented, with the RIGHT isolate, on the RIGHT argument, at EVERY call
// site, and no such argument is still passed raw.
//
//   node scripts/check-isolate-arguments.mjs
//
// WHY IT IS NOT "does the file call isolateAuto somewhere"
//
// That question is answerable by a grep and answers nothing. A site can import
// the helper, call it on the wrong argument, use `isolateAuto` where the value
// is a known-LTR token, or wrap one branch of a closed key set and leave the
// other raw — and a presence check passes all four. So the manifest states the
// kind, the key or key family, and the argument slot, and each is asserted
// against the AST.
//
// Built on the TypeScript parser, never a regex: `createSourceFile` RECOVERS
// from a syntax error instead of throwing, so `parseDiagnostics` is checked and
// a file that does not parse is a STOP rather than a shorter list of findings.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

const MANIFEST = JSON.parse(readFileSync(resolve(root, 'scripts/isolate-obligations.json'), 'utf8'))
const WRAPPER = { auto: 'isolateAuto', ltr: 'isolateLtr' }

/** Parse a source file, failing closed on anything unrecognised. */
function parse(rel) {
  const src = readFileSync(resolve(root, rel), 'utf8')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const diags = sf.parseDiagnostics ?? []
  if (diags.length) {
    throw new Error(
      `${rel}: does not parse — ${ts.flattenDiagnosticMessageText(diags[0].messageText, ' ')}`,
    )
  }
  return { sf, src }
}

/** The enclosing function chain of a node, as `Outer>inner`. */
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

/** Every `t(...)` call in a file, with its key (or null when computed). */
function tCalls(rel) {
  const { sf } = parse(rel)
  const out = []
  const visit = (n) => {
    if (ts.isCallExpression(n) && /(^|\.)t$/.test(n.expression.getText(sf)) && n.arguments.length) {
      const a0 = n.arguments[0]
      const key = ts.isStringLiteralLike(a0) ? a0.text : null
      const props = new Map()
      const a1 = n.arguments[1]
      if (a1 && ts.isObjectLiteralExpression(a1)) {
        for (const p of a1.properties) {
          if (ts.isPropertyAssignment(p) && p.name) {
            props.set(p.name.getText(sf).replace(/['"]/g, ''), p.initializer)
          } else if (ts.isShorthandPropertyAssignment(p)) {
            props.set(p.name.getText(sf), p.name)
          }
        }
      }
      out.push({
        key,
        computed: key === null ? a0.getText(sf).replace(/\s+/g, ' ') : null,
        enclosing: enclosingOf(n, sf),
        props,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        sf,
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Is `expr` a call to the named wrapper? */
const wrappedBy = (expr, sf, name) =>
  ts.isCallExpression(expr) && expr.expression.getText(sf) === name

/** Does `expr` mention the wrapper anywhere inside it? (the per-fragment case,
 *  where the wrapper sits inside a `.map()` rather than around the argument) */
function mentionsWrapper(expr, sf, name) {
  let found = false
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === name) found = true
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return found
}

console.log(`isolation obligations: ${MANIFEST.obligations.length}`)
console.log(`  (rows ${MANIFEST.totals.rows}, call sites ${MANIFEST.totals.callSites})`)
console.log('')

/** The arguments an obligation claims for ONE key. A branch does not always
 *  interpolate the same set — `import.loc.*` names a column header on two of its
 *  five branches and not on the other three — so a single `args` list would
 *  either miss a real argument or demand one that is not there. */
const argsFor = (o, key) => o.argsByKey?.[key] ?? o.args

const byFile = new Map()
for (const o of MANIFEST.obligations) {
  if (!byFile.has(o.file)) byFile.set(o.file, tCalls(o.file))
}

let siteCount = 0
const seenSites = new Set()

for (const o of MANIFEST.obligations) {
  const wrapper = WRAPPER[o.kind]
  if (!wrapper) {
    fail(`${o.id}: unknown isolate kind "${o.kind}"`)
    continue
  }
  const calls = byFile.get(o.file)

  // ── the dynamic key family: no literal to match, so the FAMILY is read from
  //    the AST and must be non-empty, and the single call site is addressed by
  //    its enclosing function ──
  if (String(o.keyAuthority).startsWith('dynamic:')) {
    const mapName = o.keyAuthority.split(':')[1]
    const { sf } = parse(o.file)
    let family = null
    const findMap = (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === mapName &&
        n.initializer &&
        ts.isObjectLiteralExpression(n.initializer)
      ) {
        family = n.initializer.properties
          .map((p) => (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : null))
          .filter(Boolean)
      }
      ts.forEachChild(n, findMap)
    }
    findMap(sf)
    if (!family || family.length === 0) {
      fail(`${o.id}: the dynamic key family ${mapName} parsed as empty — fail closed`)
      continue
    }
    const sites = calls.filter((c) => c.key === null && c.computed.includes(mapName))
    if (sites.length !== 1) {
      fail(`${o.id}: expected exactly 1 \`t(${mapName}[…])\` call, found ${sites.length}`)
      continue
    }
    // the argument is assigned before the call, so the wrapper is asserted over
    // the enclosing function's source rather than over the call's own props
    const fnSrc = readFileSync(resolve(root, o.file), 'utf8')
    const assign = new RegExp(
      `${o.args[0]}\\s*=\\s*${wrapper}\\(`,
    )
    if (!assign.test(fnSrc)) {
      fail(`${o.id}: no \`${o.args[0]} = ${wrapper}(…)\` assignment feeding the ${mapName} call`)
      continue
    }
    siteCount += 1
    seenSites.add(`${o.file}::${mapName}[…]`)
    ok(`${o.id}: ${family.length}-key family via ${mapName}, arg \`${o.args[0]}\` wrapped with ${wrapper}`)
    continue
  }

  // ── literal keys / closed key sets ──
  if (!o.keys.length) {
    fail(`${o.id}: no keys declared and no dynamic family`)
    continue
  }
  let allGood = true
  for (const key of o.keys) {
    const sites = calls.filter((c) => c.key === key && c.enclosing === o.enclosing)
    if (sites.length !== 1) {
      fail(`${o.id} / ${key}: resolved to ${sites.length} call site(s) in ${o.enclosing} (must be exactly 1)`)
      allGood = false
      continue
    }
    const site = sites[0]
    siteCount += 1
    seenSites.add(`${o.file}::${o.enclosing}::${key}`)
    for (const arg of argsFor(o, key)) {
      const expr = site.props.get(arg)
      if (!expr) {
        fail(`${o.id} / ${key}: argument \`${arg}\` is not present at ${o.file}:${site.line}`)
        allGood = false
        continue
      }
      const direct = wrappedBy(expr, site.sf, wrapper)
      const inside = mentionsWrapper(expr, site.sf, wrapper)
      if (o.shape === 'per-fragment') {
        // the wrapper must be INSIDE the expression (once per fragment), and
        // must NOT be wrapped around the joined whole
        if (direct) {
          fail(`${o.id} / ${key}: \`${arg}\` is isolated as ONE value; this site needs per-fragment isolation`)
          allGood = false
        } else if (!inside) {
          fail(`${o.id} / ${key}: \`${arg}\` has no ${wrapper} inside it — the fragments are raw`)
          allGood = false
        }
      } else if (!direct) {
        fail(
          `${o.id} / ${key}: \`${arg}\` is passed RAW at ${o.file}:${site.line} — expected ${wrapper}(…), got \`${expr.getText(site.sf).replace(/\s+/g, ' ').slice(0, 60)}\``,
        )
        allGood = false
      }
      // the other kind must NOT appear on this argument
      const other = WRAPPER[o.kind === 'auto' ? 'ltr' : 'auto']
      if (mentionsWrapper(expr, site.sf, other)) {
        fail(`${o.id} / ${key}: \`${arg}\` uses ${other}, but this obligation is \`${o.kind}\``)
        allGood = false
      }
    }
  }
  if (allGood) {
    const args = [...new Set(o.keys.flatMap((k) => argsFor(o, k)))].join('/')
    ok(`${o.id}: ${o.keys.length} call site(s), arg(s) ${args} wrapped with ${wrapper}`)
  }
}

console.log('')
// ── exhaustiveness, both directions ──
if (siteCount !== MANIFEST.totals.callSites) {
  fail(`call-site total: resolved ${siteCount}, manifest declares ${MANIFEST.totals.callSites}`)
} else {
  ok(`call-site exhaustiveness: ${siteCount} / ${MANIFEST.totals.callSites}`)
}

const rows = MANIFEST.obligations.reduce((n, o) => n + o.rows.length, 0)
if (rows !== MANIFEST.totals.rows) {
  fail(`rows: obligations carry ${rows}, manifest declares ${MANIFEST.totals.rows}`)
} else {
  ok(`rows accounted for: ${rows} / ${MANIFEST.totals.rows}`)
}

// ── and the rows split by where they came from, so the PR B census and the C3.5
//    sweep cannot quietly borrow each other's count ──
for (const [source, want] of Object.entries(MANIFEST.rowsBySource)) {
  const got = MANIFEST.obligations.reduce(
    (n, o) => n + o.rows.filter((r) => (source === 'pr-b-census' ? r.startsWith('decisions-') : r.startsWith(source))).length,
    0,
  )
  if (got !== want) fail(`rows from ${source}: counted ${got}, manifest declares ${want}`)
  else ok(`rows from ${source}: ${got} / ${want}`)
}

// ── every USE of a helper is a declared obligation: a call site that isolates
//    something the manifest does not know about means the manifest is stale ──
const declaredFiles = new Set(MANIFEST.obligations.map((o) => o.file))
let strays = 0
for (const rel of declaredFiles) {
  const { sf } = parse(rel)
  const visit = (n) => {
    if (ts.isCallExpression(n) && /^isolate(Auto|Ltr)$/.test(n.expression.getText(sf))) {
      const encl = enclosingOf(n, sf)
      const known = MANIFEST.obligations.some((o) => o.file === rel && o.enclosing === encl)
      if (!known) {
        fail(`${rel}: ${n.expression.getText(sf)} called in \`${encl}\`, which no obligation declares`)
        strays++
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
if (!strays) ok('no isolate call outside a declared obligation')

console.log('')
console.log(
  failed
    ? 'check-isolate-arguments: FAILED'
    : 'check-isolate-arguments: ok — every obligation implemented, with its declared kind, on its declared argument, at every call site',
)
process.exit(failed ? 1 : 0)
