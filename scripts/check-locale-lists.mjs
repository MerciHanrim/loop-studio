// docs/localization.md §L5.4 — an ENUMERATION of the shipped locales must
// enumerate all of them.
//
//   node scripts/check-locale-lists.mjs
//
// WHY THIS EXISTS
//
// Registering `ar` made ten hard-coded locale lists stale. Six went RED and were
// fixed the normal way. FOUR SAID NOTHING: a list that omits a locale does not
// fail, it stops measuring. `descriptive-copy-wrapping.spec.ts` is named "every
// shipped locale" and was checking seventeen of eighteen; `toolbar-locale-width`,
// `module-label-localization` and `percent-affix` were the same. Every one of them
// was green the whole time. That is a class, not four accidents.
//
// PER ENUMERATION, NOT PER FILE. The first version of this checker asked the
// question per file, and one red-first case walked straight through it:
// `module-label-localization.spec.ts` holds THREE locale tables, so dropping `ar`
// from one of them left the file still naming all eighteen. A guard that a single
// mutation defeats is not a guard, so the unit is the enumeration.
//
// An enumeration is any array or object literal in which at least `THRESHOLD`
// shipped codes appear as string literals or property names, at any depth — which
// covers a flat list, a table of `[code, tag]` pairs, and an object keyed by
// locale. Only the INNERMOST such node is judged, so an outer array holding
// several tables is not reported in place of the table that is actually short.
//
// A DELIBERATELY PARTIAL enumeration says so with `locale-subset:` and a reason in
// a comment attached to it. `percent-affix.spec.ts` has two: the locales whose
// percent sign takes a no-break space, and the ones where it touches the number.
// Splitting them is the point of that spec, so the exemption is real — and it is
// written at the site, where a reviewer sees it, rather than in an allowlist here.
//
// The codes come from `registry.ts`, so the day a nineteenth locale is registered
// every enumeration is red until it is added.
//
// WHAT THIS DOES NOT PROTECT. Stated because "no locale list can go stale" is what
// a green run here invites you to read, and it is not what this proves:
//
//   * a SMALL list. Fewer than `THRESHOLD` codes and it is not recognised as an
//     enumeration at all, so a three-locale list that should have four is invisible
//     here. The threshold exists because a spec naming two or three locales as
//     examples is not enumerating them, and there is no way to tell those apart by
//     counting.
//   * the inside of a declared `locale-subset:`. That is the point of the
//     exemption — the group is partial on purpose — so a locale dropped from one is
//     caught only by the file-union clause, and only if no other enumeration in
//     that file happens to name it.
//   * a file that declares `locale-subset-file:`. Both clauses go quiet there, so
//     the three files carrying that marker are protected by nothing here.
//   * anything outside `e2e/`, `src/` and `scripts/`, and anything not written as
//     a literal — a list built at runtime from a filter is not read.
//
// What it does prove is the shape that actually broke ten times: a large literal
// list of locale codes that someone forgot to extend.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

/** A node naming this many shipped codes is enumerating them. Well below the count
 *  (18) so a list of "most" locales cannot slip under, and well above the two or
 *  three a spec names as examples. */
const THRESHOLD = 10

/** every non-pseudo registry code, read from the SOURCE */
const shipped = (() => {
  const src = readFileSync(resolve(root, 'src/i18n/registry.ts'), 'utf8')
  const sf = ts.createSourceFile('registry.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if ((sf.parseDiagnostics ?? []).length) throw new Error('registry.ts does not parse')
  const out = []
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      const get = (name) => {
        const p = n.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === name)
        return p && ts.isPropertyAssignment(p) ? p.initializer.getText(sf).replace(/^['"]|['"]$/g, '') : null
      }
      const code = get('code')
      if (code && get('direction') && get('pseudo') !== 'true') out.push(code)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (out.length === 0) throw new Error('no locale codes parsed out of registry.ts')
  return out
})()
const SHIPPED = new Set(shipped)

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      walk(p, out)
    } else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(p)
  }
  return out
}

/** The shipped codes named anywhere inside a node — as a string literal, or as a
 *  property name (`ar:` is an identifier, `'zh-Hans':` is a string). */
function codesIn(node, sf) {
  const found = new Set()
  const visit = (n) => {
    if (ts.isStringLiteralLike(n) && SHIPPED.has(n.text)) found.add(n.text)
    else if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      n.name &&
      SHIPPED.has(n.name.getText(sf).replace(/['"]/g, ''))
    ) {
      found.add(n.name.getText(sf).replace(/['"]/g, ''))
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** `locale-subset:` in a comment attached to this node (or to the statement it is
 *  part of), which is how a deliberately partial enumeration declares itself. */
function exempt(node, sf, src) {
  for (let p = node; p; p = p.parent) {
    const ranges = ts.getLeadingCommentRanges(src, p.getFullStart()) ?? []
    for (const r of ranges) if (src.slice(r.pos, r.end).includes('locale-subset:')) return true
    if (ts.isStatement(p)) break
  }
  return false
}

const files = walk(resolve(root, 'e2e'))
  .concat(walk(resolve(root, 'src')), walk(resolve(root, 'scripts')))
  .filter((f) => !/registry\.ts$/.test(f))

let enumerations = 0
let exemptions = 0
const gaps = []
/** per file: every shipped code named anywhere in it, and whether it declares a
 *  file-wide subset */
const fileUnion = new Map()
for (const abs of files) {
  const rel = relative(root, abs).replace(/\\/g, '/')
  const src = readFileSync(abs, 'utf8')
  if (shipped.filter((c) => src.includes(`'${c}'`) || src.includes(`"${c}"`) || new RegExp(`\\b${c.replace('-', '\\-')}\\s*:`).test(src)).length < THRESHOLD) {
    continue
  }
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if ((sf.parseDiagnostics ?? []).length) {
    fail(`${rel}: does not parse`)
    continue
  }
  // every candidate node, then keep only the INNERMOST ones
  const candidates = []
  const visit = (n) => {
    if (ts.isArrayLiteralExpression(n) || ts.isObjectLiteralExpression(n)) {
      const codes = codesIn(n, sf)
      if (codes.size >= THRESHOLD) candidates.push({ node: n, codes })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  fileUnion.set(rel, {
    codes: codesIn(sf, sf),
    exemptFile: src.includes('locale-subset-file:'),
  })
  const innermost = candidates.filter(
    (c) => !candidates.some((o) => o !== c && o.node.getStart(sf) >= c.node.getStart(sf) && o.node.getEnd() <= c.node.getEnd()),
  )
  for (const c of innermost) {
    const line = sf.getLineAndCharacterOfPosition(c.node.getStart(sf)).line + 1
    if (exempt(c.node, sf, src)) {
      exemptions++
      continue
    }
    enumerations++
    const missing = shipped.filter((x) => !c.codes.has(x))
    if (missing.length) gaps.push({ rel, line, have: c.codes.size, missing })
  }
}

console.log(`shipped locales in the registry: ${shipped.length}   ${shipped.join(' ')}`)
console.log(`enumerations found (>= ${THRESHOLD} codes named): ${enumerations}, plus ${exemptions} declared \`locale-subset:\``)
console.log(`files checked for a complete UNION: ${[...fileUnion.values()].filter((u) => !u.exemptFile).length}, plus ${[...fileUnion.values()].filter((u) => u.exemptFile).length} declared \`locale-subset-file:\``)
console.log('')

for (const g of gaps) {
  fail(`${g.rel}:${g.line}: enumerates ${g.have} of ${shipped.length} shipped locales, missing ${g.missing.join(' ')}`)
}
// ── the SECOND clause, and it is not redundant. An exempted `locale-subset:` can
//    still lose a locale silently: dropping `ar` from the percent no-gap group is
//    invisible to the per-enumeration rule, because that group is declared partial.
//    So the FILE's union must be complete too. A file whose partiality is
//    file-wide (every table in it excludes the base locale) says
//    `locale-subset-file:` with its reason.
for (const [rel, u] of fileUnion) {
  if (u.exemptFile) continue
  const missing = shipped.filter((c) => !u.codes.has(c))
  if (missing.length) {
    fail(`${rel}: the file as a whole names ${u.codes.size} of ${shipped.length}, missing ${missing.join(' ')} — no enumeration in it covers them`)
  }
}
if (!gaps.length) ok(`every enumeration names all ${shipped.length}`)
if (enumerations === 0) fail('no enumeration was recognised — the detector is broken, not the tree')

console.log('')
console.log(
  failed
    ? 'check-locale-lists: FAILED'
    : 'check-locale-lists: ok — no enumeration knows about some of the shipped locales and not the rest',
)
process.exit(failed ? 1 : 0)
