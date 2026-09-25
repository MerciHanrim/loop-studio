// The CSV download boundary — `src/ui/download.ts` is the only place this
// product may build a CSV blob.
//
//   node scripts/check-csv-boundary.mjs
//
// WHY THIS GUARD EXISTS
//
// A downloaded CSV opened in Excel on Windows is decoded by GUESS, and with no
// BOM the guess is the system ANSI code page. MEASURED on a real export
// (`loop-studio-run.csv`, 4,148 bytes, valid UTF-8, first bytes 73 74 65 70 =
// `step,`): every Korean header rendered as mojibake — `레벨` came out as
// `ë ë²¨`.
//
// `charset=utf-8` on the Blob does not fix it. A downloaded file keeps no media
// type, so Excel never sees it: two of the five call sites already set it and
// were mojibake all the same. Only a BOM travels with the bytes.
//
// The reason it was missing everywhere at once is that the CSV download was not
// one thing — five components each had their own
// `new Blob([...], { type: 'text/csv...' })`, written at different times. A fix
// that changes the sites it can find leaves the one it missed to be reported by
// a user, which is how this defect was found. So the contract is not "the
// helper adds a BOM" but "nothing else can write a CSV", and that only holds if
// it is checked mechanically.
//
// Source-text driven, same idiom as the other check-*.mjs guards.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SRC = join(root, 'src')
const BOUNDARY = 'ui/download.ts'

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const rel = (f) => f.replace(/\\/g, '/').slice(SRC.replace(/\\/g, '/').length + 1)

const files = sourceFiles(SRC)
const offenders = []
for (const file of files) {
  if (rel(file) === BOUNDARY) continue
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/new Blob\([^)]*\)/g)) {
    if (/csv/i.test(m[0])) offenders.push(`${rel(file)}: ${m[0]}`)
  }
  for (const m of src.matchAll(/['"`]text\/csv[^'"`]*['"`]/g)) {
    offenders.push(`${rel(file)}: ${m[0]}`)
  }
}

// the scan must not pass by reading nothing, or by using a pattern that could
// not match the shape it is looking for
const problems = []
if (files.length < 50) problems.push(`only ${files.length} source files scanned — the walk is wrong`)
if (!files.some((f) => rel(f) === BOUNDARY)) problems.push(`${BOUNDARY} not found`)
const boundarySrc = readFileSync(join(SRC, 'ui', 'download.ts'), 'utf8')
if (!/['"`]text\/csv[^'"`]*['"`]/.test(boundarySrc)) {
  problems.push('the boundary declares no CSV media type — the pattern cannot be right')
}
if (!boundarySrc.includes('0xfeff')) {
  problems.push('the boundary adds no BOM (expected a 0xfeff code point)')
}
if (boundarySrc.includes(String.fromCharCode(0xfeff))) {
  problems.push('the boundary contains a RAW U+FEFF — write it from its code point')
}

if (problems.length) {
  console.error('check-csv-boundary: the guard itself is broken:')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

if (offenders.length) {
  console.error(
    'check-csv-boundary: a CSV must be written through `downloadCsv` in ' +
      `src/${BOUNDARY}, which is the one place the UTF-8 BOM is added.\n` +
      'Found CSV blobs built elsewhere:',
  )
  for (const o of offenders) console.error('  ' + o)
  process.exit(1)
}

console.log(
  `  ok    ${files.length} source files scanned; src/${BOUNDARY} is the only CSV writer`,
)
console.log('\ncheck-csv-boundary: ok')
