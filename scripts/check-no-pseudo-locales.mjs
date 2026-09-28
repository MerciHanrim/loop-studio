// docs/localization.md §L5.4 / §L9.2 — the DEV-only pseudo-locales (`en-XA`, the
// QA locale; `ar-XB`, the RTL one) must be byte-absent from every production
// artefact. They are safe to declare only because `devPseudoLocales()` returns
// early on `import.meta.env.DEV`, which the bundler evaluates as statically
// false; this asserts the tree-shake actually happened.
//
// Three deliberate choices, each from something that went wrong first:
//
//  1. The markers are DERIVED from the registry source through the shared
//     TypeScript-AST reader (`registry-source.mjs`), never hand-listed. The
//     pre-existing byte check in `e2e/portable-file.spec.ts` carried a literal
//     `'en-XA'` and so silently stopped covering the pseudo-locale set the moment
//     `ar-XB` was added. `pseudoMarkers()` also refuses to answer at all if the
//     `import.meta.env.DEV` guard has been edited away — which is the one change
//     that would make every byte check below pass for the wrong reason.
//
//     The markers are the CODE *and* the user-visible names (`englishName`,
//     `nativeName`). Codes alone are a narrower contract than agreed and would
//     let `ar-XB` be tree-shaken while the literal `Pseudo RTL (QA)` still
//     shipped. `displayNameKey` is excluded on purpose: both pseudo entries reuse
//     `language.english`, which English itself needs, and the parser refuses any
//     marker a shipped locale shares rather than failing every build.
//
//  2. Each artefact is checked on ITS OWN shape, not one shared chunk contract.
//     `dist` and `dist-pwa` are many files (a JS chunk per locale, plus a service
//     worker in the PWA build); `dist-portable` is a SINGLE inlined HTML file
//     with no separate chunks at all. A checker that expected per-locale chunk
//     files would be wrong about portable, and a checker that expected one file
//     would scan almost nothing in the other two.
//
//  3. It FAILS CLOSED. Zero markers, zero files, a missing directory, or an
//     artefact whose own shape assertion does not hold are all errors. A checker
//     that "finds no violations" because it found nothing to look at is the
//     failure mode this whole family of scripts exists to avoid.
//
// Usage:  node scripts/check-no-pseudo-locales.mjs <dir> [<dir> ...]
//         node scripts/check-no-pseudo-locales.mjs --all
//
// It is wired into each build command's own completion contract in package.json,
// so `npm run build` cannot report success while shipping a QA locale.
import fs from 'node:fs'
import path from 'node:path'
import { pseudoMarkers, shippedCodes } from './registry-source.mjs'

const RED = process.stdout.isTTY ? '\u001b[31m' : ''
const OFF = process.stdout.isTTY ? '\u001b[0m' : ''
const fail = (msg) => {
  console.error(`${RED}check-no-pseudo-locales: ${msg}${OFF}`)
  process.exitCode = 1
}

/** Each artefact and what its shape must look like, so "nothing scanned" can
 *  never read as "nothing wrong". `minFiles` is a floor, not a count. */
const ARTEFACTS = {
  dist: { label: 'production build', exts: ['.js', '.html', '.css'], minFiles: 5, expectSingleFile: false },
  'dist-pwa': { label: 'PWA build', exts: ['.js', '.html', '.css', '.webmanifest'], minFiles: 5, expectSingleFile: false },
  'dist-portable': { label: 'portable single file', exts: ['.html'], minFiles: 1, expectSingleFile: true },
}

const walk = (dir) => {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

const targets = process.argv.slice(2)
const dirs = targets.includes('--all') ? Object.keys(ARTEFACTS) : targets
if (dirs.length === 0) {
  fail('no artefact directory given (expected one of: ' + Object.keys(ARTEFACTS).join(', ') + ', or --all)')
  process.exit(1)
}

// ── the markers, derived ────────────────────────────────────────────────────
let markers
let shipped
try {
  markers = pseudoMarkers()
  shipped = shippedCodes()
} catch (e) {
  fail('could not read the registry: ' + e.message)
  process.exit(1)
}
if (markers.length === 0) {
  fail('the registry yielded ZERO pseudo-locale markers, so this check would pass vacuously')
  process.exit(1)
}
console.log('pseudo-locale markers that must not ship (derived from the registry source):')
for (const m of markers) console.log('   ' + JSON.stringify(m))
console.log('shipped locales that MUST be present:', shipped.length)

for (const dir of dirs) {
  const spec = ARTEFACTS[dir]
  if (!spec) {
    fail(`\`${dir}\` is not a known artefact directory`)
    continue
  }
  if (!fs.existsSync(dir)) {
    fail(`\`${dir}\` (${spec.label}) does not exist — build it before checking it`)
    continue
  }
  const all = walk(dir)
  const scanned = all.filter((f) => spec.exts.includes(path.extname(f).toLowerCase()))
  if (scanned.length < spec.minFiles) {
    fail(`\`${dir}\` has only ${scanned.length} scannable file(s), fewer than the ${spec.minFiles} its shape requires`)
    continue
  }
  // portable is ONE inlined document: a second .html, or a sibling .js chunk,
  // means the inlining did not happen and this check is looking at the wrong
  // thing entirely.
  if (spec.expectSingleFile) {
    const htmls = all.filter((f) => path.extname(f).toLowerCase() === '.html')
    const jsChunks = all.filter((f) => path.extname(f).toLowerCase() === '.js')
    if (htmls.length !== 1) {
      fail(`\`${dir}\` should be ONE html document, found ${htmls.length}`)
      continue
    }
    if (jsChunks.length > 0) {
      fail(`\`${dir}\` has ${jsChunks.length} separate .js chunk(s), so it is not a single inlined file`)
      continue
    }
  }

  let hits = 0
  let bytes = 0
  const present = new Set()
  for (const file of scanned) {
    const text = fs.readFileSync(file, 'utf8')
    bytes += Buffer.byteLength(text)
    for (const m of markers) {
      if (text.includes(m)) {
        fail(`${file} contains the pseudo-locale marker ${JSON.stringify(m)}`)
        hits++
      }
    }
    // A positive control: the shipped locale codes DO appear, so a check that
    // found no markers because it read empty or wrong files reports that instead
    // of passing. (Not every file carries every code — the union over the
    // artefact is what must be complete.)
    //
    // DELIMITED, and in all three forms the toolchain actually emits. MEASURED:
    // the minifier rewrites string literals as TEMPLATE literals — the bundle
    // carries `code:` + backtick + `es-419` — so a control that looked only for
    // "…" and '…' reported ten of the seventeen codes missing and blamed the
    // build. Delimiters are also what keeps this from matching noise: a bare
    // substring search for a two-letter code hits minified identifiers (`ko` is
    // a React internal in this very bundle).
    for (const c of shipped) {
      if (text.includes(`"${c}"`) || text.includes(`'${c}'`) || text.includes('`' + c + '`')) present.add(c)
    }
  }
  const missing = shipped.filter((c) => !present.has(c))
  if (missing.length) {
    fail(
      `\`${dir}\`: ${missing.length} shipped locale code(s) are absent too (${missing.join(', ')}) — ` +
        'this check is not reading the locale data it thinks it is',
    )
    continue
  }
  if (hits === 0) {
    console.log(
      `  ${dir.padEnd(14)} OK — ${scanned.length} files, ${(bytes / 1024).toFixed(0)} KB scanned, ` +
        `all ${shipped.length} shipped codes present, 0 of ${markers.length} pseudo-locale markers`,
    )
  }
}

if (process.exitCode) console.error('check-no-pseudo-locales: FAILED')
else console.log('check-no-pseudo-locales: every artefact checked is clean')
