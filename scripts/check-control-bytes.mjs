// Fail closed on raw control bytes in tracked TEXT files.
//
// Why this exists. Three source files carried real `0x00` / `0x07` / `0x1f` /
// `0x7f` bytes where the TEXT of an escape was meant - an authoring channel ate
// the backslash and wrote the byte itself. There was no runtime effect (they sat
// in a comment and in two string literals that behave identically), but git and
// grep classify such a file as BINARY, so it silently vanishes from content
// searches. That nearly hid the number-coercion site during the pt-BR audit: the
// harm is to the tooling, not to the product, which is exactly why nothing else
// caught it.
//
// What counts as allowed, precisely:
//
//   allowed  : TAB (0x09), LF (0x0A), CR (0x0D) - ordinary whitespace
//   rejected : every other C0 byte (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) and DEL (0x7F)
//
// Binary assets are excluded ONLY by an explicit `.gitattributes` rule
// (`attr/-text`, e.g. `*.png binary`). Two exclusions that look reasonable are
// deliberately NOT used, because each one silently skips the very file that
// needs checking:
//
//   `i/-text` reports the blob in the INDEX, which is still the old content
//   while a fix is in progress - so it skips the file being repaired.
//
//   `w/-text` is git SNIFFING the working tree, and what git sniffs for is a
//   NUL. Keying on it means a file containing a NUL is skipped for containing
//   exactly the byte this check exists to find. Measured: injecting a NUL into
//   a `.ts` file passed until this was narrowed.
//
// The attribute is necessary but NOT sufficient: see BINARY_EXTENSIONS below.
// A tracked binary file with no attribute rule is therefore reported rather than
// skipped. That is the intended direction: declare it in `.gitattributes`.
// The list comes from `git ls-files`, so untracked scratch output is never
// scanned.
//
// FAILS CLOSED: if the file list cannot be obtained, or a file cannot be read,
// the check errors instead of reporting success over an empty set.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const ALLOWED = new Set([0x09, 0x0a, 0x0d])
const isBad = (c) => (c < 0x20 && !ALLOWED.has(c)) || c === 0x7f

const NAMES = new Map([
  [0x00, 'NUL'], [0x07, 'BEL'], [0x08, 'BS'], [0x0b, 'VT'], [0x0c, 'FF'],
  [0x1b, 'ESC'], [0x1f, 'US'], [0x7f, 'DEL'],
])
const name = (c) => NAMES.get(c) ?? `0x${c.toString(16).padStart(2, '0')}`

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

let files
try {
  files = git(['ls-files', '-z']).split('\0').filter(Boolean)
} catch (err) {
  console.error('check-control-bytes: could not list tracked files -', err.message)
  process.exit(1)
}
if (files.length === 0) {
  console.error('check-control-bytes: the tracked file list is EMPTY, which cannot be right')
  process.exit(1)
}

// Which tracked paths carry an explicit binary attribute.
const declaredBinary = new Set()
try {
  const out = git(['ls-files', '-z', '--eol'])
  for (const row of out.split('\0').filter(Boolean)) {
    // rows look like: i/-text w/-text attr/-text   path
    const tab = row.lastIndexOf('\t')
    if (tab < 0) continue
    const flags = row.slice(0, tab)
    const path = row.slice(tab + 1)
    // `attr/` ONLY - see the note above on why `i/` and `w/` must not count
    if (/(^|\s)attr\/(binary|-text)(\s|$)/.test(flags)) declaredBinary.add(path)
  }
} catch (err) {
  console.error('check-control-bytes: could not read text/binary attributes -', err.message)
  process.exit(1)
}

// The attribute alone is not enough to be skipped, or the check has an opt-out:
// marking a `.ts` file `binary` in `.gitattributes` would hide a NUL in it
// again. A file is skipped only when it ALSO has an extension on this list, so
// the set of things that can ever be invisible is fixed here rather than in
// `.gitattributes`. Adding a new kind of binary asset is meant to require
// updating this line deliberately.
const BINARY_EXTENSIONS = new Set(['.png'])
const extensionOf = (p) => {
  const dot = p.lastIndexOf('.')
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return dot > slash ? p.slice(dot).toLowerCase() : ''
}

const findings = []
const misdeclared = []
let scanned = 0
let skipped = 0

for (const file of files) {
  if (declaredBinary.has(file)) {
    if (BINARY_EXTENSIONS.has(extensionOf(file))) {
      skipped++
      continue
    }
    // Declared binary but not an allowed binary type. This is the opt-out the
    // check must refuse: report it AND still scan the bytes.
    misdeclared.push(file)
  }
  let buf
  try {
    buf = readFileSync(resolve(root, file))
  } catch (err) {
    console.error(`check-control-bytes: could not read ${file} - ${err.message}`)
    process.exit(1)
  }
  // every tracked file without an explicit binary attribute is scanned, NUL
  // included - see the note at the top
  scanned++
  let line = 1
  let lineStart = 0
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c === 0x0a) {
      line++
      lineStart = i + 1
      continue
    }
    if (isBad(c)) findings.push({ file, line, column: i - lineStart + 1, byte: c })
  }
}

if (misdeclared.length > 0) {
  console.error(
    `check-control-bytes: ${misdeclared.length} file(s) carry a DISALLOWED binary attribute ` +
      'on a text source\n',
  )
  for (const f of misdeclared) {
    console.error(`  ${f}  — marked binary in .gitattributes, but ${extensionOf(f) || '(no extension)'} is not an allowed binary type`)
  }
  console.error(
    `\nOnly these extensions may be declared binary: ${[...BINARY_EXTENSIONS].join(', ')}.` +
      '\nMarking a text source binary would hide a control byte in it from this check.' +
      '\nIf a genuinely new kind of binary asset is being added, add its extension to' +
      '\nBINARY_EXTENSIONS in this file, deliberately.',
  )
  process.exit(1)
}

if (findings.length > 0) {
  console.error(`check-control-bytes: ${findings.length} raw control byte(s) in tracked text files\n`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}:${f.column}  ${name(f.byte)}`)
  }
  console.error(
    '\nWrite the ESCAPE, not the byte. In a string literal use the \\xNN form; in a' +
      '\ncomment write the characters. A file holding one of these is classified as' +
      '\nbinary and disappears from grep and from git diff.',
  )
  process.exit(1)
}

console.log(
  `check-control-bytes: ${scanned} text file(s) clean, ${skipped} binary file(s) skipped ` +
    '(allowed: TAB, LF, CR)',
)
