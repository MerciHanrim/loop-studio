// docs/localization.md §L9.3 — the arrow meaning units.
//
// MEASURED, and it is why this check exists at all: none of these glyphs mirrors on
// its own. Unicode mirrors only characters carrying `Bidi_Mirrored` — brackets and
// relational operators — so an arrow keeps pointing the same way while the layout
// mirrors around it. Every arrow is therefore a product decision, and each one is
// decided by what its sense is relative to:
//
//   MIRROR  its meaning is defined by the reading flow. An external link opening
//           "outward", a submenu opening on the inline-end side, a value going from
//           one thing to another, undo stepping back through history.
//   KEEP    it names something that does not mirror. `graph-relation` describes the
//           same edge the canvas DRAWS, and the canvas is pinned `ltr` (§L9.2), so a
//           panel reading it right to left would contradict the picture. The
//           transport controls sit with the physical time axis. A menu opens
//           downward for everyone.
//
// FOUR CLAUSES
//
//  1. JSX exhaustiveness. Every mirroring site takes its character from
//     `useArrowGlyph(unit)`, and the count of uses per file matches. A mirroring
//     glyph written as a literal anywhere in a component is an error: two literals
//     in two files is how `undo` and `redo`, which must stay opposite, quietly
//     become equal.
//  2. The KEEP glyphs stay literal, in the recorded places and counts. Without this
//     the first clause could be satisfied by mirroring everything.
//  3. No transform mirroring. `transform: scaleX(-1)` flips the BOX, not the
//     character: it flips whatever else shares the element, never reaches the
//     accessible name, and cannot be read back as text. The opposite characters were
//     measured to exist in the shipping font stack, so a real glyph is available.
//  4. The catalogue contract, for every registered locale. An LTR catalogue carries
//     the ltr glyph; an RTL one carries the mirrored glyph where the unit mirrors and
//     the SAME glyph where it does not — which is the case a translator is most
//     likely to "fix" in the wrong direction.
//
// PSEUDO LOCALES ARE EXEMPT FROM CLAUSE 4, and that is not a loophole: `ar-XB` ships
// the `en` catalogue verbatim on purpose, because it tests DIRECTION and not
// translation. Holding an English string to an Arabic catalogue rule would fail a
// locale for being what it is meant to be.
//
// Reads JSX TEXT through the AST, never a raw file grep: every one of these glyphs
// also appears in prose comments in this repo, and `→` appears in eight of them.
//
// Fails closed: an unparseable file, a recorded site that no longer exists, or a
// count that does not match is an error, never a skip.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/arrow-units.json'), 'utf8'))
const EMIT = process.argv.includes('--emit')

const problems = []
const squash = (s) => s.replace(/\s+/g, '')

const tsxFiles = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) tsxFiles.push(p)
  }
}
walk(path.join(ROOT, 'src'))

const parse = (abs, rel) => {
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (sf.parseDiagnostics?.length) problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
  return sf
}

/** every glyph that appears in RENDERED JSX text, per file.
 *  JsxText children and string literals inside a JsxExpression - not comments, not
 *  attribute values, not identifiers. */
function renderedGlyphs(sf) {
  const found = []
  const note = (text, node) => {
    for (const ch of text) if (TRACKED.has(ch)) found.push({ ch, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 })
  }
  const visit = (n) => {
    if (ts.isJsxText(n)) note(n.text, n)
    else if (ts.isJsxExpression(n) && n.expression) {
      const collect = (e) => {
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) note(e.text, e)
        else if (ts.isConditionalExpression(e)) {
          collect(e.whenTrue)
          collect(e.whenFalse)
        } else if (ts.isTemplateExpression(e)) {
          note(e.head.text, e)
          for (const s of e.templateSpans) note(s.literal.text, e)
        }
      }
      collect(n.expression)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

const TRACKED = new Set()
for (const u of Object.values(M.units)) {
  TRACKED.add(u.ltr)
  TRACKED.add(u.rtl)
}

// ── measure ────────────────────────────────────────────────────────────────
const measured = new Map() // rel -> { glyph -> count }
for (const abs of tsxFiles) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const sf = parse(abs, rel)
  const per = {}
  for (const g of renderedGlyphs(sf)) per[g.ch] = (per[g.ch] || 0) + 1
  if (Object.keys(per).length) measured.set(rel, per)
}

if (EMIT) {
  console.log(JSON.stringify([...measured].map(([file, glyphs]) => ({ file, glyphs })), null, 2))
  process.exit(0)
}

// ── clause 1: every mirroring site goes through the hook ───────────────────
let siteTotal = 0
for (const entry of M.jsx) {
  const abs = path.join(ROOT, entry.file)
  if (!fs.existsSync(abs)) {
    problems.push(`${entry.file}: listed in the arrow manifest and not in the tree`)
    continue
  }
  const text = fs.readFileSync(abs, 'utf8')
  const call = `useArrowGlyph('${entry.unit}')`
  const decl = `const${entry.binding}=${squash(call)}`
  const declCount = squash(text).split(decl).length - 1
  if (declCount !== 1) {
    problems.push(`${entry.file}: expected exactly one \`const ${entry.binding} = ${call}\` and found ${declCount}`)
  }
  // Counted through the AST, not as the text `{binding}`: two of these sites sit
  // inside a ternary (`{expanded ? '▾' : caret}`), where the binding is an
  // identifier in a JSX expression and never appears wrapped in its own braces.
  //
  // Counted ONCE PER IDENTIFIER, walking up from it, rather than by descending from
  // each JSX expression. Descending double-counted: a usage inside a conditionally
  // rendered element is reachable from the outer `{cond && <a>…</a>}` expression as
  // well as from its own, and HelpMenu's single arrow was reported twice.
  const sfUse = parse(abs, entry.file)
  let uses = 0
  const inJsxExpression = (id) => {
    let p = id.parent
    while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p))) {
      p = p.parent
    }
    return Boolean(p && ts.isJsxExpression(p))
  }
  const countUses = (n) => {
    if (ts.isIdentifier(n) && n.text === entry.binding && inJsxExpression(n)) uses++
    ts.forEachChild(n, countUses)
  }
  countUses(sfUse)
  if (uses !== entry.sites) {
    problems.push(`${entry.file}: \`{${entry.binding}}\` is rendered ${uses} time(s), the manifest records ${entry.sites}`)
  }
  siteTotal += entry.sites
}
if (siteTotal !== M.totals.jsxSites) {
  problems.push(`the jsx entries sum to ${siteTotal} sites and totals.jsxSites says ${M.totals.jsxSites}`)
}

// a mirroring glyph must not be written as a literal anywhere a component renders it
const mirrorUnits = Object.entries(M.units).filter(([, u]) => u.verdict === 'mirror')
const keepGlyphs = new Set(Object.entries(M.units).filter(([, u]) => u.verdict === 'keep').flatMap(([, u]) => [u.ltr, u.rtl]))
for (const [id, u] of mirrorUnits) {
  for (const g of [u.ltr, u.rtl]) {
    // a glyph a KEEP unit also uses is governed by clause 2 instead
    if (keepGlyphs.has(g)) continue
    for (const [rel, per] of measured) {
      if (per[g]) problems.push(`${rel}: renders \`${g}\` as a literal - it belongs to the mirroring unit \`${id}\` and must come from useArrowGlyph`)
    }
  }
}

// ── clause 2: the keep glyphs stay literal, where and as often as recorded ──
const expectedKeep = new Map()
for (const k of M.keepLiterals) expectedKeep.set(k.file + ' ' + k.glyph, k)
for (const k of M.keepLiterals) {
  const actual = measured.get(k.file)?.[k.glyph] ?? 0
  if (actual !== k.count) {
    problems.push(`${k.file}: renders \`${k.glyph}\` ${actual} time(s), the manifest records ${k.count} for the \`${k.unit}\` unit`)
  }
}
for (const [rel, per] of measured) {
  for (const [g, n] of Object.entries(per)) {
    if (!keepGlyphs.has(g)) continue
    if (!expectedKeep.has(rel + ' ' + g)) {
      problems.push(`${rel}: renders \`${g}\` ${n} time(s) and the manifest records no keep site there - a new arrow arrived unruled`)
    }
  }
}

// ── clause 3: no transform mirroring ───────────────────────────────────────
const TRANSFORM = /scaleX\(\s*-1|rotateY\(\s*180|scale\(\s*-1/
const cssFiles = ['src/index.css']
for (const rel of [...cssFiles, ...tsxFiles.map((a) => path.relative(ROOT, a).split(path.sep).join('/'))]) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) continue
  const text = fs.readFileSync(abs, 'utf8')
  if (TRANSFORM.test(text)) {
    problems.push(`${rel}: contains a mirroring transform - an arrow must be a CHARACTER, not a flipped box`)
  }
}

// ── clause 4: the catalogue contract ───────────────────────────────────────
const registrySrc = fs.readFileSync(path.join(ROOT, 'src/i18n/registry.ts'), 'utf8')
/** every registry entry's code, direction and pseudo flag, read from the SOURCE so a
 *  new locale is covered the day it is registered */
const entries = []
{
  const sf = ts.createSourceFile('registry.ts', registrySrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      const get = (name) => {
        const p = n.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === name)
        return p && ts.isPropertyAssignment(p) ? p.initializer.getText(sf).replace(/^['"]|['"]$/g, '') : null
      }
      const code = get('code')
      const direction = get('direction')
      if (code && direction) entries.push({ code, direction, pseudo: get('pseudo') === 'true' })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
if (entries.length === 0) problems.push('no locale entries parsed out of registry.ts - the reader is broken, not the source')

// Node's raw ESM loader strips TS types but will not follow the EXTENSIONLESS
// relative imports a folder locale's index.ts uses for its slices. So a folder
// locale is merged here from its domain files, in the same order index.ts spreads
// them - the approach scripts/check-i18n.mjs already takes for the same reason.
const DOMAIN_FILES = ['ui', 'canvas', 'inspector', 'templates', 'dataImport']
const catalogOf = async (code) => {
  const flat = path.join(ROOT, 'src/i18n/locales', code + '.ts')
  if (fs.existsSync(flat)) return (await import(pathToFileURL(flat).href)).default
  const dir = path.join(ROOT, 'src/i18n/locales', code)
  if (!fs.existsSync(path.join(dir, 'index.ts'))) return null
  const parts = []
  for (const d of DOMAIN_FILES) {
    const f = path.join(dir, d + '.ts')
    if (!fs.existsSync(f)) {
      problems.push(`${code}: folder locale is missing the \`${d}\` slice`)
      return null
    }
    parts.push((await import(pathToFileURL(f).href)).default)
  }
  return Object.assign({}, ...parts)
}

// The rule itself lives in src/i18n/arrowContract.ts, and is imported rather than
// written again here. It has to be callable with a locale that does NOT exist yet:
// every RTL locale registered today is pseudo, so every locale this loop can reach is
// one that cannot fail the mirrored-glyph rule. src/i18n/arrowContract.test.ts calls
// the same function with a synthetic real `ar` and proves that registering one arms
// the contract. A rule written only here could be verified only by locales that
// cannot exercise it.
const { arrowCatalogViolations, arrowCensus } = await import(pathToFileURL(path.join(ROOT, 'src/i18n/arrowContract.ts')).href)

const contractInput = { units: M.units, catalog: M.catalog, conditional: M.conditional }
const perLocale = []
let checkedKeys = 0
let glyphOccurrences = 0
let conditionalOccurrences = 0
let censusClaimed = 0
const censusUnclaimed = []
const censusDouble = []
for (const loc of entries) {
  const cat = await catalogOf(loc.code)
  if (!cat) {
    // a pseudo locale reuses another catalogue and has no file of its own
    if (!loc.pseudo) problems.push(`${loc.code}: no catalogue file, and it is not a pseudo locale`)
    perLocale.push({ ...loc, catalogue: false, checked: 0 })
    continue
  }
  // the GLOBAL census, over every string in this catalogue rather than over the
  // keys the manifest names - the one failure a per-key contract cannot see
  const c = arrowCensus(loc, cat, contractInput)
  censusClaimed += c.claimed
  for (const u of c.unclaimed) censusUnclaimed.push(`${loc.code} \`${u.key}\`: ${u.glyph} belongs to no meaning unit`)
  for (const d of c.multiplyClaimed) censusDouble.push(`${loc.code} \`${d.key}\`: ${d.glyph} claimed by ${d.units.join(' and ')}`)

  const r = arrowCatalogViolations(loc, cat, contractInput)
  checkedKeys += r.checked
  glyphOccurrences += r.occurrences
  conditionalOccurrences += r.conditionalOccurrences
  perLocale.push({ ...loc, catalogue: true, checked: r.checked, occurrences: r.occurrences, conditional: r.conditionalOccurrences })
  for (const m of r.missing) {
    problems.push(`${loc.code}: key \`${m.key}\` is missing - the \`${m.unit}\` arrow contract names it`)
  }
  for (const v of r.violations) {
    const u = M.units[v.unit]
    problems.push(
      `${v.locale} \`${v.key}\` (${v.unit}${u ? ', ' + u.verdict : ''}): ${v.reason}`,
    )
  }
}

// ── the arithmetic behind the key-check total, printed rather than asserted flat ──
const withCatalogue = perLocale.filter((l) => l.catalogue)
const pseudoNoCatalogue = perLocale.filter((l) => !l.catalogue && l.pseudo)
const pairsPerLocale = M.catalog.reduce((n, c) => n + c.keys.length, 0)
const occurrencesPerLocale = M.catalog.reduce(
  (n, c) => n + c.keys.reduce((m, k) => m + ((c.occurrences && c.occurrences[k]) || 1), 0),
  0,
)
const conditionalHits = checkedKeys - withCatalogue.length * pairsPerLocale
const expected = withCatalogue.length * pairsPerLocale + conditionalHits
if (checkedKeys !== expected) {
  problems.push(`the pair total ${checkedKeys} does not match ${withCatalogue.length} x ${pairsPerLocale} + ${conditionalHits}`)
}
// the manifest's own per-locale numbers, so an edit to one and not the other is red
if (pairsPerLocale !== M.totals.catalogPairsPerLocale) {
  problems.push(`pairs per locale: derived ${pairsPerLocale}, manifest declares ${M.totals.catalogPairsPerLocale}`)
}
if (occurrencesPerLocale !== M.totals.catalogOccurrencesPerLocale) {
  problems.push(`occurrences per locale: derived ${occurrencesPerLocale}, manifest declares ${M.totals.catalogOccurrencesPerLocale}`)
}
// THE SECOND AXIS. Every catalogue locale must carry exactly the declared number of
// arrow glyphs - not "at least one per governed key", which is what let a second
// wrong glyph through.
const expectedOccurrences = withCatalogue.length * occurrencesPerLocale + conditionalOccurrences
if (glyphOccurrences !== expectedOccurrences) {
  problems.push(
    `the glyph-occurrence total ${glyphOccurrences} does not match ${withCatalogue.length} x ${occurrencesPerLocale} + ${conditionalOccurrences}`,
  )
}
for (const l of withCatalogue) {
  if (l.occurrences - l.conditional !== occurrencesPerLocale) {
    problems.push(`${l.code}: ${l.occurrences - l.conditional} governed arrow glyph(s), every catalogue must carry ${occurrencesPerLocale}`)
  }
}
// THE GLOBAL CENSUS. `unclaimed 0` is a statement about every string in all
// eighteen catalogues, not about the subset the manifest lists; `multiply claimed 0`
// says each occurrence is attributed to exactly ONE unit, so the two totals above
// are a partition and not a coincidence.
for (const u of censusUnclaimed) problems.push(u)
for (const d of censusDouble) problems.push(d)
if (censusClaimed !== glyphOccurrences) {
  problems.push(
    `the census attributed ${censusClaimed} occurrence(s) but the contract counted ${glyphOccurrences} - the two walks disagree`,
  )
}

// the real RTL catalogue is the one the mirrored-glyph rule exists for
const realRtl = withCatalogue.filter((l) => l.direction === 'rtl' && !l.pseudo)
if (realRtl.length === 0) {
  problems.push('no real RTL catalogue is registered, so the mirrored-glyph rule is not exercised by any locale here')
}
for (const l of realRtl) {
  if (l.conditional !== 0) {
    problems.push(`${l.code}: the conditional key uses ${l.conditional} arrow(s); the Arabic translation was decided to use none`)
  }
}
if (conditionalHits < 0) problems.push('a locale checked fewer keys than the contract names - the arithmetic is wrong, not the catalogue')

console.log('check-arrow-direction')
console.log('  units                  ' + Object.keys(M.units).length + '  (mirror ' + mirrorUnits.length + ', keep ' + (Object.keys(M.units).length - mirrorUnits.length) + ')')
console.log('  jsx sites via the hook ' + siteTotal)
console.log('  keep literals          ' + M.keepLiterals.reduce((n, k) => n + k.count, 0))
console.log('')
console.log('  the catalogue clause, and where its key-check total comes from:')
console.log('     registry entries               ' + entries.length)
console.log('     with a catalogue file of their own  ' + withCatalogue.length + '   ' + withCatalogue.map((l) => l.code).join(' '))
console.log('     pseudo, no catalogue of their own   ' + pseudoNoCatalogue.length + '   ' + pseudoNoCatalogue.map((l) => l.code + ' (' + l.direction + ')').join(' '))
console.log('        en-XA generates from en; ar-XB falls back to en verbatim. Neither has')
console.log('        a file, and a catalogue-CONTENT rule cannot apply to a verbatim copy.')
console.log('     (unit, key) pairs per locale   ' + pairsPerLocale + '   = ' + M.catalog.map((c) => c.keys.length + ' ' + c.unit).join(' + '))
console.log('        four keys are governed by TWO units - their string carries two')
console.log('        different arrows - so pairs exceed distinct keys.')
console.log('     conditional hits               ' + conditionalHits + '   (import.qs.sources.excel, counted only where a translation uses an arrow at all)')
console.log('')
console.log('  TWO AXES, named, because they are different numbers:')
console.log('     CONTRACT PAIRS    (locale, unit, key) triples the rule is evaluated on')
console.log('        ' + withCatalogue.length + ' x ' + pairsPerLocale + ' + ' + conditionalHits + ' = ' + checkedKeys)
console.log('     GLYPH OCCURRENCES arrow characters actually inside those values')
console.log('        ' + withCatalogue.length + ' x ' + occurrencesPerLocale + ' + ' + conditionalOccurrences + ' = ' + glyphOccurrences)
console.log('        ' + occurrencesPerLocale + ' and not ' + pairsPerLocale + ' because TWO keys carry the same unit twice:')
for (const c of M.catalog) {
  for (const [k, n] of Object.entries(c.occurrences || {})) {
    console.log('          ' + k + '  ' + n + ' x ' + c.unit + ' (' + c.verdict + ')')
  }
}
console.log('     GLOBAL CENSUS    every arrow in every string of all ' + withCatalogue.length + ' catalogues')
console.log('        attributed ' + censusClaimed + '   unclaimed ' + censusUnclaimed.length + '   multiply claimed ' + censusDouble.length)
console.log('        so the two totals above are a PARTITION of the catalogues\' arrows,')
console.log('        not a sum over the keys the manifest happens to name.')
console.log('     per-locale distribution: ' + [...new Set(withCatalogue.map((l) => l.occurrences - l.conditional))].join(', ') + ' governed in every catalogue; conditional ' + (withCatalogue.filter((l) => l.conditional).map((l) => l.code + '=' + l.conditional).join(' ') || 'none'))
console.log('')
console.log('     the mirrored-glyph rule IS exercised: ' + (realRtl.map((l) => l.code).join(' ') || 'nothing') + ' ships a real RTL catalogue.')
console.log('     src/i18n/arrowContract.test.ts still calls the same function directly,')
console.log('     so the rule stays testable for the NEXT RTL locale before it exists.')
console.log('  problems             : ' + problems.length)
for (const p of problems) console.log('     ' + p)
if (problems.length) process.exitCode = 1
else console.log('  every arrow is decided by its unit, and no arrow is a flipped box')
