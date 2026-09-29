// docs/localization.md §L9.3 — every element that renders text whose direction is
// a product decision still declares that direction.
//
// The canvas subtree is pinned `direction: ltr` (§L9.2) and the app chrome mirrors
// with the reader, so an element inside either one cannot get its direction by
// inheritance and be right for all three kinds of text it might hold:
//
//   an engine token   a number, an expression grammar, an id, a generated value.
//                     `dir="ltr"` — author order, so a leading sign cannot travel.
//   text a person typed  `dir="auto"` — the value's own first strong character.
//   catalog prose     the reader's direction, from the app's own resolver.
//
// WHAT THIS CHECK IS, AND WHAT IT IS NOT
//
// It defends the elements in `content-direction.json` against losing their
// direction, or against having it silently changed to the wrong one of the three.
// That is the realistic failure over time: a refactor drops an attribute, or
// someone "simplifies" `dir={uiDir}` to `dir="ltr"` on a sentence.
//
// It does NOT discover a new text-rendering element added later. Nothing short of
// re-running the §L9.3 census does, and that census needed human adjudication of
// 550 candidate rows — 177 of them turned out to render text at all. Saying so here
// is the point: a check that implied exhaustiveness would be worse than this one,
// because a green run would be read as "every element is covered".
//
// Fails closed. A file that will not parse, an element the manifest cannot find, an
// address that finds more than one element, or an unknown `expect` value is an
// error — never a skip.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'scripts/content-direction.json')

/** `dir` is an HTML attribute and means nothing in the SVG namespace; an SVG
 *  <text> takes `direction`, the CSS presentation attribute. Measured, not assumed:
 *  an SVG <text> breaks on the same strings an HTML span does (`+3` renders `3+`)
 *  and `direction="ltr"` fixes it. */
const SVG_TAGS = new Set(['svg', 'g', 'text', 'tspan', 'textPath'])

const problems = []
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))

const sfCache = new Map()
function parse(rel) {
  if (!sfCache.has(rel)) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) {
      problems.push(`${rel}: listed in the manifest and not in the tree`)
      sfCache.set(rel, null)
    } else {
      const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      if (sf.parseDiagnostics?.length) {
        problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
        sfCache.set(rel, null)
      } else sfCache.set(rel, sf)
    }
  }
  return sfCache.get(rel)
}

const squash = (s) => s.replace(/\s+/g, '')

/** the opening elements of `tag` in this file, in document order */
function elementsOfTag(sf, tag) {
  const out = []
  const visit = (n) => {
    const open = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxElement(n) ? n.openingElement : null
    if (open && open.tagName.getText(sf) === tag) out.push({ node: n, open })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/**
 * Resolve one manifest entry to exactly one element.
 *
 * `find` is a list of substrings that must ALL appear in the element's own text.
 * One substring is not always enough: `{p.s}` appears in two sibling spans and the
 * only thing that separates them, the class name, is not adjacent to it. Each key
 * avoids the direction attributes, so an address does not change when one is added.
 *
 * A candidate that strictly CONTAINS another candidate is dropped: it matched only
 * by inheriting its descendant's text, and the descendant is the target. No string
 * exists that is inside a child and not inside its parent, so without this rule a
 * class name addresses both the element and every wrapper around it.
 *
 * `ordinal` breaks the remaining tie, and only where the elements are genuinely
 * indistinguishable by their own text — two identical `<p>{row.sourceKey}</p>`, one
 * per branch. It indexes the surviving candidates in document order.
 */
function resolve(sf, entry) {
  const all = elementsOfTag(sf, entry.tag)
  const keys = entry.find.map(squash)
  let hits = all.filter((c) => {
    const t = squash(c.node.getText(sf))
    return keys.every((k) => t.includes(k))
  })
  if (hits.length === 0) return { error: `no <${entry.tag}> matches ${JSON.stringify(entry.find)} - the address is stale` }
  if (hits.length > 1) {
    const inner = hits.filter(
      (c) => !hits.some((o) => o !== c && o.node.getStart(sf) >= c.node.getStart(sf) && o.node.getEnd() <= c.node.getEnd()),
    )
    if (inner.length) hits = inner
  }
  if (hits.length > 1) {
    if (entry.ordinal == null) {
      return { error: `${hits.length} <${entry.tag}> match ${JSON.stringify(entry.find)} and the entry declares no ordinal` }
    }
    const pick = hits[entry.ordinal]
    if (!pick) return { error: `ordinal ${entry.ordinal} is out of range among ${hits.length} candidates` }
    return { open: pick.open }
  }
  return { open: hits[0].open }
}

const rows = { ltr: 0, auto: 0, 'locale-direction': 0, 'branch-computed': 0 }

for (const entry of manifest.elements) {
  const sf = parse(entry.file)
  if (!sf) continue
  const where = `${entry.file} <${entry.tag}> ${JSON.stringify(entry.find)}`

  const r = resolve(sf, entry)
  if (r.error) {
    problems.push(`${where}: ${r.error}`)
    continue
  }

  const want = SVG_TAGS.has(entry.tag) ? 'direction' : 'dir'
  const attr = r.open.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === want)

  // a per-fragment edit puts the direction on a NEW CHILD element, so the element
  // named by the entry carries none of its own; its contract is the marker
  const fragmentOnly = Boolean(entry.marker) && entry.expect === 'auto' && !attr

  if (!attr && !fragmentOnly) {
    problems.push(`${where}: declares no \`${want}\` - it would inherit a direction that is right for only one of the three kinds of text`)
    continue
  }

  if (entry.marker) {
    const text = fs.readFileSync(path.join(ROOT, entry.file), 'utf8')
    if (!squash(text).includes(squash(entry.marker))) {
      problems.push(`${where}: the declared marker \`${entry.marker}\` is gone`)
      continue
    }
  }

  if (!fragmentOnly) {
    const init = attr.initializer
    const literal = init && ts.isStringLiteral(init) ? init.text : null
    const isExpression = Boolean(init && ts.isJsxExpression(init))

    if (entry.expect === 'ltr' || entry.expect === 'auto') {
      if (literal !== entry.expect) {
        problems.push(
          `${where}: expected ${want}="${entry.expect}" and found ${literal != null ? `"${literal}"` : init ? init.getText(sf) : '(nothing)'}`,
        )
        continue
      }
    } else if (entry.expect === 'locale-direction' || entry.expect === 'branch-computed') {
      if (!isExpression) {
        problems.push(`${where}: expected ${want}={…} reading the app's direction and found a literal ${JSON.stringify(literal)}`)
        continue
      }
      // catalog prose must come from the app's own resolver, not be re-derived
      if (entry.expect === 'locale-direction') {
        const text = fs.readFileSync(path.join(ROOT, entry.file), 'utf8')
        if (!/useLocaleDirection/.test(text)) {
          problems.push(`${where}: uses an expression but ${entry.file} never calls \`useLocaleDirection\` - the direction is re-derived somewhere else`)
          continue
        }
        if (/document\.documentElement|getAttribute\(['"]dir/.test(text)) {
          problems.push(`${where}: ${entry.file} reads \`dir\` back off the document - the direction has a second source of truth`)
          continue
        }
      }
    } else {
      problems.push(`${where}: unknown expect value ${JSON.stringify(entry.expect)}`)
      continue
    }
  }

  rows[entry.expect]++
}

// the manifest's own arithmetic, so a hand edit that adds an element without
// updating the totals is caught rather than trusted
const counted = Object.values(rows).reduce((a, b) => a + b, 0)
if (manifest.totals.elements !== manifest.elements.length) {
  problems.push(`content-direction.json: totals.elements says ${manifest.totals.elements} and the list holds ${manifest.elements.length}`)
}
for (const [k, v] of Object.entries(manifest.totals.byExpect)) {
  const actual = manifest.elements.filter((e) => e.expect === k).length
  if (actual !== v) problems.push(`content-direction.json: totals.byExpect.${k} says ${v} and the list holds ${actual}`)
}
if (manifest.elements.length === 0) problems.push('content-direction.json holds no elements - the reader is broken, not the source')

console.log('check-content-direction')
for (const [k, v] of Object.entries(rows)) console.log('  ' + k.padEnd(18) + v)
console.log('  verified          ' + counted + ' of ' + manifest.elements.length)
console.log('  problems        : ' + problems.length)
for (const p of problems) console.log('     ' + p)
if (problems.length || counted !== manifest.elements.length) {
  if (counted !== manifest.elements.length) console.log('     not every manifest element was verified - that is a failure, not a partial pass')
  process.exitCode = 1
} else {
  console.log('  every listed element still declares the direction its content decides')
  console.log('  (this list is not exhaustive by construction - see $limit in the manifest)')
}
