// docs/localization.md §L13 (Slice 3) — the inventory reconcile. A conservative
// static scan of every component for a user-facing English string literal that
// is NOT wrapped in `t(...)`: JSX text nodes, and `aria-label` / `title` /
// `placeholder` attribute string literals. Runs in the `checks` CI job.
//
//   node scripts/check-i18n-surface.mjs
//
// It is deliberately narrow (two or more capitalised / lower words, or an
// attribute value starting with an ASCII letter) and carries a small allowlist
// of format tokens and wire values that are shown verbatim by design (§L3.4).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const COMPONENTS = resolve(root, 'src/components')

// shown verbatim on purpose — format tokens, wire enum values, symbols, ids
const ALLOW = new Set([
  'JSON',
  'CSV',
  'LIVE',
  'DISTRIBUTION',
  'MC',
  'Loop Studio',
  'Graph JSON', // the format label; the human half is keyed separately
  'Workspace JSON',
  'React Flow attribution',
])
// substrings that mark a line as SVG / URL / comment / import noise — NOT a
// blanket "has an attribute" skip (a real JSX text node often shares its line
// with `className=…`), so this list stays deliberately small.
const SKIP_LINE = /xmlns=|viewBox=|\bd="M|https?:\/\/|aria-hidden|^\s*(?:\/\/|\*|import\b)|\/\* /

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(COMPONENTS)) {
  const rel = file.slice(root.length + 1).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (SKIP_LINE.test(line)) return
    // 1) a STATIC JSX text node (no `{}` interpolation) that reads as English
    //    prose — a capitalised word + a lowercase word, or three lowercase
    //    words in a row. Short single words and symbol/number runs don't match.
    for (const m of line.matchAll(/>([^<>{}]+)</g)) {
      const txt = m[1].trim()
      if (!txt || ALLOW.has(txt)) continue
      if (/[A-Z][a-z]+ [a-z]+/.test(txt) || /[a-z]+ [a-z]+ [a-z]+/.test(txt)) {
        hits.push(`${rel}:${i + 1}  JSX text  “${txt}”`)
      }
    }
    // 2) aria-label / title / placeholder = "English literal"
    //    (`(?<![\w-])` so `data-placeholder=` / `data-title=` markers don't match)
    for (const m of line.matchAll(/(?<![\w-])(aria-label|title|placeholder)="([A-Za-z][^"]*)"/g)) {
      if (!ALLOW.has(m[2])) hits.push(`${rel}:${i + 1}  ${m[1]}  “${m[2]}”`)
    }
  })
}

if (hits.length) {
  console.error('check-i18n-surface: untranslated user-facing string(s) found —\n')
  for (const h of hits) console.error('  ' + h)
  console.error(
    '\nWrap each in t(\'…\') with a catalog key, or add it to ALLOW in this script if it is a format token / wire value shown verbatim by design.',
  )
  process.exit(1)
}
console.log(`check-i18n-surface: ok (${walk(COMPONENTS).length} components scanned, no untranslated UI strings)`)
