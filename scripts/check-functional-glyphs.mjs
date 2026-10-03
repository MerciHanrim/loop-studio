// Issue #298 — a functional glyph replaced by a shared icon must not come back,
// neither in the UI nor in a translation catalog.
//
//   node scripts/check-functional-glyphs.mjs
//
// WHY THIS EXISTS
//
// MEASURED on 2026-10-01: the shipped font drew three of the symbols the UI typed
// as text (`©`, `×`, `−`); every other one was drawn by an operating-system font,
// so a button differed in weight, size and baseline from Windows to iOS, and the
// emoji-capable ones (`🔒` `▶` `⏸` `⏭` `☀` `↗` `✳`) came out as colour emoji on
// iOS. Issue #298 replaced them with `src/ui/icons.tsx`. A glyph typed into a new
// button, or into a translated label by the next release, would bring the
// platform difference back one character at a time; this check is the fence.
//
// WHAT IS CHECKED, AND WHERE
//
//  1. Components (`src/components/**/*.tsx`, `src/ui/**/*.tsx`): no replaced
//     glyph in RENDERED text — JSX text, a string literal inside a JSX
//     expression, or an `aria-label` / `title` / `placeholder` attribute. Read
//     through the TypeScript AST, so a comment that names a glyph (many do, this
//     file included) is not a hit.
//  2. Catalogs (`src/i18n/locales/**`): no replaced glyph in any translated VALUE,
//     in any locale. A glyph inside a translation is on screen in that language
//     and is part of the accessible name.
//
// THE ALLOW-LIST is explicit and short. A character stays text when it MEANS
// something rather than standing in for a control:
//
//   `©`                copyright, in the About dialog
//   `＋ － ＝`          add / remove / equals, beside the palette marks and on the
//                      expression keypad
//   `→ ← × − ≥ ≤ ≈ ± ÷ ≠ °`  formulas, menu paths and hints (the arrow contract,
//                      scripts/check-arrow-direction.mjs, rules on `→` / `←`)
//   `⏎ ⇥ ␡`            the written names of control characters in import messages
//
// These are not in the replaced set below, so they are never reported; the list is
// written here so that the next reader knows they were decided, not missed.
//
// OUT OF SCOPE: anything a person typed (node and frame names, notes, imported
// data), the engine and model fixtures (`src/engine/**`, `src/model/**`,
// `examples/**`), test files, and SVG path data. The check is about the chrome.
//
// Fails closed: a file that does not parse is an error, never a skip.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** the glyphs issue #298 replaced, by what they stood for */
export const REPLACED = {
  '🔒': 'canvas lock (locked)',
  '🔓': 'canvas lock (unlocked)',
  '▶': 'play',
  '⏸': 'pause',
  '⏭': 'step',
  '⟲': 'reset',
  '⟳': 'replay',
  '☀': 'theme: light',
  '☾': 'theme: dark',
  '◐': 'theme: auto',
  '↗': 'external link',
  '↖': 'external link (rtl)',
  '↶': 'undo',
  '↷': 'redo',
  '✳': 'edge trigger mark',
  '⌖': 'focus',
  '✕': 'close',
  '⋯': 'more',
  '▾': 'disclosure (down)',
  '▴': 'disclosure (up)',
  '▸': 'submenu disclosure',
  '◂': 'submenu disclosure (rtl)',
  '✓': 'selected mark',
  '✎': 'proposal mark',
  '⌥': 'revision mark',
  '●': 'unsaved dot',
  '◉': 'palette: pool',
  '◇': 'palette: gate',
  '⇄': 'palette: converter',
  '⊗': 'palette: end',
  '▭': 'palette: parameter',
  '↔': 'in-sentence both-ways arrow (now words)',
}
const TRACKED = new Set(Object.keys(REPLACED))
const NAME_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'aria-description'])

const problems = []

function walk(dir, test, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, test, out)
    else if (test(e.name)) out.push(p)
  }
  return out
}
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

function parse(abs, kind) {
  const sf = ts.createSourceFile(rel(abs), fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, kind)
  if (sf.parseDiagnostics?.length) problems.push(`${rel(abs)}: did not parse cleanly - refusing to report it as clean`)
  return sf
}

const found = (text) => [...text].filter((ch) => TRACKED.has(ch))

/** glyphs in what a component RENDERS or NAMES */
export function componentHits(sf) {
  const hits = []
  const note = (text, node, where) => {
    for (const ch of found(text)) hits.push({ ch, where, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 })
  }
  const literalsIn = (e, where) => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) note(e.text, e, where)
    else if (ts.isTemplateExpression(e)) {
      note(e.head.text, e, where)
      for (const s of e.templateSpans) note(s.literal.text, e, where)
    } else if (ts.isConditionalExpression(e)) {
      literalsIn(e.whenTrue, where)
      literalsIn(e.whenFalse, where)
    } else if (ts.isBinaryExpression(e)) {
      literalsIn(e.left, where)
      literalsIn(e.right, where)
    } else if (ts.isParenthesizedExpression(e)) literalsIn(e.expression, where)
  }
  const visit = (n) => {
    if (ts.isJsxText(n)) note(n.text, n, 'JSX text')
    else if (ts.isJsxExpression(n) && n.expression && ts.isJsxElement(n.parent)) literalsIn(n.expression, 'JSX expression')
    else if (ts.isJsxAttribute(n) && NAME_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      if (ts.isStringLiteral(n.initializer)) note(n.initializer.text, n, n.name.getText(sf))
      else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) literalsIn(n.initializer.expression, n.name.getText(sf))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** glyphs in a catalog file's string VALUES (property assignments) */
export function catalogHits(sf) {
  const hits = []
  const visit = (n) => {
    if (ts.isPropertyAssignment(n)) {
      const v = n.initializer
      const texts = []
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) texts.push(v.text)
      else if (ts.isTemplateExpression(v)) texts.push(v.head.text, ...v.templateSpans.map((s) => s.literal.text))
      for (const t of texts) for (const ch of found(t)) hits.push({ ch, key: n.name.getText(sf).replace(/^['"]|['"]$/g, ''), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let files = 0
  for (const dir of ['src/components', 'src/ui']) {
    for (const abs of walk(path.join(ROOT, dir), (n) => /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n))) {
      files++
      for (const h of componentHits(parse(abs, ts.ScriptKind.TSX))) {
        problems.push(`${rel(abs)}:${h.line}: renders \`${h.ch}\` (${REPLACED[h.ch]}) in ${h.where} - use the shared icon (src/ui/icons.tsx)`)
      }
    }
  }
  let catalogs = 0
  for (const abs of walk(path.join(ROOT, 'src/i18n/locales'), (n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n))) {
    catalogs++
    for (const h of catalogHits(parse(abs, ts.ScriptKind.TS))) {
      problems.push(`${rel(abs)}:${h.line}: the value of \`${h.key}\` carries \`${h.ch}\` (${REPLACED[h.ch]}) - a translated string carries no functional glyph`)
    }
  }
  if (problems.length) {
    console.error(`check:functional-glyphs - ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`check:functional-glyphs: ${files} component files and ${catalogs} catalog files carry none of the ${TRACKED.size} replaced glyphs`)
}
