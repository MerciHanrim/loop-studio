// docs/localization.md §L9.4 — every isolation obligation is implemented, with
// the RIGHT isolate, on the RIGHT argument, at EVERY call site, and no such
// argument is still passed raw.
//
//   node scripts/check-isolate-arguments.mjs
//
// WHY IT IS NOT "does the file call isolateAuto somewhere"
//
// That question is answerable by a grep and answers nothing. A site can import
// the helper, call it on the wrong argument, use `isolateAuto` where the value
// is a known-LTR token, or wrap one branch of a closed key set and leave the
// other raw — and a presence check passes all four. So the manifest states the
// key set, the argument slot and the isolate kind for each call site, and each
// is asserted against the AST.
//
// HOW A CALL SITE IS ADDRESSED
//
// By `(file, enclosing function, resolved key set)`. The key is resolved from
// SOURCE by `resolveKeys`, which handles a literal, a conditional, a `??`
// fallback, a local `const` and a lookup into a module-level map — and returns
// null for anything else, which is a STOP. That generality replaced a
// `keyAuthority: "dynamic:ISSUE_KEY"` special case: three of the sites added in
// C3.5 compute their key a third, fourth and fifth way, and a checker with one
// special case per shape is one shape behind.
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
  return sf
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

/** Every string-literal value of a module-level `const NAME = { … }` map. */
function mapValues(sf, name) {
  let found = null
  const visit = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      const vals = n.initializer.properties.map((p) =>
        ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : null,
      )
      found = vals.some((v) => v === null) ? null : [...new Set(vals)]
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found && found.length ? found : null
}

/** The nearest `const <name> = …` declaration at or inside `scope`. */
function localInit(scope, sf, name) {
  const hits = []
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      hits.push(n.initializer)
    }
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return hits.length === 1 ? hits[0] : null
}

/** Resolve a `t(…)` key expression to a CLOSED SET of literal keys, or `null`
 *  when it cannot be resolved — which is a STOP, never an empty set. */
function resolveKeys(expr, sf, scope) {
  if (ts.isStringLiteralLike(expr)) return [expr.text]
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) {
    return resolveKeys(expr.expression, sf, scope)
  }
  if (ts.isConditionalExpression(expr)) {
    const a = resolveKeys(expr.whenTrue, sf, scope)
    const b = resolveKeys(expr.whenFalse, sf, scope)
    return a && b ? [...new Set([...a, ...b])] : null
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const a = resolveKeys(expr.left, sf, scope)
    const b = resolveKeys(expr.right, sf, scope)
    return a && b ? [...new Set([...a, ...b])] : null
  }
  if (ts.isElementAccessExpression(expr)) {
    return mapValues(sf, expr.expression.getText(sf))
  }
  if (ts.isIdentifier(expr)) {
    const init = localInit(scope, sf, expr.text)
    return init ? resolveKeys(init, sf, scope) : null
  }
  // a template literal, a function call, anything else — not a closed set
  return null
}

/** The function body a local `const` would be declared in. */
function scopeOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p)) {
      return p
    }
  }
  return node.getSourceFile()
}

/** Every `t(...)` call in a file, with its resolved key set and its arguments. */
function tCalls(rel) {
  const sf = parse(rel)
  const out = []
  const visit = (n) => {
    if (ts.isCallExpression(n) && /(^|\.)t$/.test(n.expression.getText(sf)) && n.arguments.length) {
      const props = new Map()
      const a1 = n.arguments[1]
      if (a1 && ts.isObjectLiteralExpression(a1)) {
        for (const p of a1.properties) {
          if (ts.isPropertyAssignment(p) && p.name) props.set(p.name.getText(sf).replace(/['"]/g, ''), p.initializer)
          else if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.getText(sf), p.name)
        }
      }
      out.push({
        keys: resolveKeys(n.arguments[0], sf, scopeOf(n)),
        raw: n.arguments[0].getText(sf).replace(/\s+/g, ' '),
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

/** A key SET as one comparable string. The separator is printable on purpose: a
 *  NUL meant the pretty-printer needed a control character inside a regex, which
 *  this repo has a standing reason to avoid, and a catalog key is a dotted
 *  identifier that can never contain " | ". */
const sig = (keys) => [...keys].sort().join(' | ')
const wrappedBy = (expr, sf, name) => ts.isCallExpression(expr) && expr.expression.getText(sf) === name
function mentionsWrapper(expr, sf, name) {
  let found = false
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === name) found = true
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return found
}

/** How many times the wrapper is CALLED inside an expression.
 *
 *  A per-fragment site is not defended by "is the wrapper mentioned": the
 *  resource-type mismatch interpolates TWO user values per pair, and dropping
 *  one of them leaves the other, so a presence check stays green while half the
 *  values go raw. The manifest declares how many fragments a site has and this
 *  counts them. */
function wrapperCalls(expr, sf, name) {
  let n = 0
  const visit = (x) => {
    if (ts.isCallExpression(x) && x.expression.getText(sf) === name) n += 1
    ts.forEachChild(x, visit)
  }
  visit(expr)
  return n
}

console.log(`isolation obligations: ${MANIFEST.obligations.length}`)
console.log(`  (rows ${MANIFEST.totals.rows}, call sites ${MANIFEST.totals.callSites})`)
console.log('')

const byFile = new Map()
for (const o of MANIFEST.obligations) if (!byFile.has(o.file)) byFile.set(o.file, tCalls(o.file))

let siteCount = 0
const claimed = new Set()

for (const o of MANIFEST.obligations) {
  const calls = byFile.get(o.file)
  let good = true

  // ── a PRODUCER site: the value is wrapped where it is PRODUCED, not in the
  //    argument list. Two reasons a site is shaped that way, and both are real:
  //    the call passes a prepared object rather than an object literal
  //    (`wizard-issue-value`), or only SOME of the producer's branches make a
  //    value that needs bounding (`inspector-activator-describe` returns a bare
  //    number on its literal branch, and wrapping that too was a real product
  //    defect — two invisible characters around every plain number, for
  //    nothing). The call is still located by its key set. ──
  if (o.shape === 'producer') {
    const expected = o.sites[0]
    const wrapper = WRAPPER[expected.kind]
    const resolved = calls.filter(
      (c) => c.enclosing === o.enclosing && c.keys && (expected.keys ? sameSet(c.keys, expected.keys) : c.keys.length === expected.keyCount),
    )
    if (resolved.length !== 1) {
      fail(`${o.id}: expected 1 call in ${o.enclosing} with the declared key set, found ${resolved.length}`)
      continue
    }
    const sf = parse(o.file)
    if (expected.producerAssignment) {
      // `<target> = <wrapper>(…)` somewhere in the file, read off the AST
      let found = 0
      const visit = (n) => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          n.left.getText(sf) === expected.producerAssignment &&
          wrappedBy(n.right, sf, wrapper)
        ) {
          found += 1
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
      if (found !== 1) {
        fail(`${o.id}: expected 1 \`${expected.producerAssignment} = ${wrapper}(…)\` assignment, found ${found}`)
        continue
      }
      ok(`${o.id}: producer \`${expected.producerAssignment}\` wrapped with ${wrapper}`)
    } else {
      // a named function whose STRING-producing returns are wrapped. Both counts
      // are declared: a return added later is a new branch nobody classified,
      // and a wrap removed is the defect.
      let fn = null
      const find = (n) => {
        if (ts.isFunctionDeclaration(n) && n.name?.text === expected.producerFn) fn = n
        ts.forEachChild(n, find)
      }
      find(sf)
      if (!fn) {
        fail(`${o.id}: no function \`${expected.producerFn}\` in ${o.file}`)
        continue
      }
      let total = 0
      let wrapped = 0
      const count = (n) => {
        if (ts.isReturnStatement(n) && n.expression) {
          total += 1
          if (wrappedBy(n.expression, sf, wrapper)) wrapped += 1
        }
        ts.forEachChild(n, count)
      }
      count(fn)
      if (total !== expected.totalReturns || wrapped !== expected.wrappedReturns) {
        fail(
          `${o.id}: \`${expected.producerFn}\` has ${wrapped}/${total} returns wrapped with ${wrapper}, manifest declares ${expected.wrappedReturns}/${expected.totalReturns}`,
        )
        continue
      }
      ok(`${o.id}: producer \`${expected.producerFn}\`, ${wrapped} of ${total} returns wrapped with ${wrapper}`)
    }
    siteCount += 1
    claimed.add(`${o.file}::${o.enclosing}::${sig(resolved[0].keys)}::0`)
    continue
  }

  // ── ordinary sites, grouped by key SET so two calls sharing one key are two
  //    entries and a computed key resolving to four is ONE ──
  const groups = new Map()
  for (const s of o.sites) {
    const k = sig(s.keys)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(s)
  }
  for (const [k, entries] of groups) {
    const first = JSON.stringify({ args: entries[0].args, kind: entries[0].kind, kindByArg: entries[0].kindByArg ?? null, shape: entries[0].shape ?? null })
    for (const e of entries.slice(1)) {
      if (JSON.stringify({ args: e.args, kind: e.kind, kindByArg: e.kindByArg ?? null, shape: e.shape ?? null }) !== first) {
        fail(`${o.id}: two sites share the key set ${k} but declare different arguments or kinds`)
        good = false
      }
    }
    const found = calls.filter((c) => c.enclosing === o.enclosing && c.keys && sig(c.keys) === k)
    if (found.length !== entries.length) {
      const unresolved = calls.filter((c) => c.enclosing === o.enclosing && !c.keys)
      fail(
        `${o.id} / ${k}: expected ${entries.length} call site(s) in ${o.enclosing}, found ${found.length}` +
          (unresolved.length ? ` (${unresolved.length} call(s) there have an UNRESOLVABLE key: ${unresolved.map((u) => u.raw).join(', ')})` : ''),
      )
      good = false
      continue
    }
    for (const [i, site] of found.entries()) {
      const e = entries[i]
      siteCount += 1
      claimed.add(`${o.file}::${o.enclosing}::${k}::${i}`)
      for (const arg of e.args) {
        const kind = e.kindByArg?.[arg] ?? e.kind
        const wrapper = WRAPPER[kind]
        if (!wrapper) {
          fail(`${o.id}: unknown isolate kind "${kind}" for \`${arg}\``)
          good = false
          continue
        }
        const expr = site.props.get(arg)
        if (!expr) {
          fail(`${o.id} / ${arg}: argument not present at ${o.file}:${site.line}`)
          good = false
          continue
        }
        const direct = wrappedBy(expr, site.sf, wrapper)
        const inside = mentionsWrapper(expr, site.sf, wrapper)
        if (e.shape === 'per-fragment') {
          if (direct) {
            fail(`${o.id} / ${arg}: isolated as ONE value; this site needs per-fragment isolation`)
            good = false
          } else if (!inside) {
            fail(`${o.id} / ${arg}: no ${wrapper} inside it — the fragments are raw`)
            good = false
          } else {
            const n = wrapperCalls(expr, site.sf, wrapper)
            if (n !== e.fragments) {
              fail(`${o.id} / ${arg}: ${n} ${wrapper} call(s) inside, manifest declares ${e.fragments} fragment(s) — one of them is raw`)
              good = false
            }
          }
        } else if (!direct) {
          fail(
            `${o.id} / ${arg}: passed RAW at ${o.file}:${site.line} — expected ${wrapper}(…), got \`${expr.getText(site.sf).replace(/\s+/g, ' ').slice(0, 60)}\``,
          )
          good = false
        }
        const other = WRAPPER[kind === 'auto' ? 'ltr' : 'auto']
        if (mentionsWrapper(expr, site.sf, other)) {
          fail(`${o.id} / ${arg}: uses ${other}, but this argument is declared \`${kind}\``)
          good = false
        }
      }
    }
  }
  if (good) {
    const args = [...new Set(o.sites.flatMap((s) => s.args ?? []))].join('/')
    ok(`${o.id}: ${o.sites.length} call site(s), arg(s) ${args}`)
  }
}

function sameSet(a, b) {
  return sig(a) === sig(b)
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

for (const [source, want] of Object.entries(MANIFEST.rowsBySource)) {
  const got = MANIFEST.obligations.reduce(
    (n, o) => n + o.rows.filter((r) => (source === 'pr-b-census' ? r.startsWith('decisions-') : r.startsWith(source))).length,
    0,
  )
  if (got !== want) fail(`rows from ${source}: counted ${got}, manifest declares ${want}`)
  else ok(`rows from ${source}: ${got} / ${want}`)
}

// ── every USE of a helper is a declared obligation ──
const declaredFiles = new Set(MANIFEST.obligations.map((o) => o.file))
let strays = 0
for (const rel of declaredFiles) {
  const sf = parse(rel)
  const visit = (n) => {
    if (ts.isCallExpression(n) && /^isolate(Auto|Ltr)$/.test(n.expression.getText(sf))) {
      const encl = enclosingOf(n, sf)
      // a producer-shaped obligation wraps inside a NAMED function that is not
      // the one holding the `t(…)` call, so that name counts as declared too
      const declared = (o) => o.enclosing === encl || o.sites.some((s) => s.producerFn === encl)
      if (!MANIFEST.obligations.some((o) => o.file === rel && declared(o))) {
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
