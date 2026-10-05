// Issue #301 - the third-party notices: pure functions, tested in
// `scripts/third-party-notices.test.mjs` on made-up packages. The Vite plugin
// (`vite-plugin.mjs`) gathers the facts from a real build and calls these.
//
// What a notice entry is: one shipped package at one version, with its SPDX
// expression, the full text of every licence file (and NOTICE file) it ships
// with, and its copyright lines. Nothing is fetched: everything is read from
// `node_modules` and the repository, so the same commit gives the same bytes.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** licences a package may have without a person reviewing it */
export const ALLOWED = ['MIT', 'ISC', 'BSD-3-Clause', 'OFL-1.1']
/** licences that are allowed only for an entry the registry marks as reviewed */
export const REVIEW_REQUIRED = ['Apache-2.0']
/** never allowed automatically, whatever the registry says */
export const DENIED = /(^|[^A-Z])(A?GPL|LGPL|SSPL|BUSL|EUPL|CC-BY-NC|CC-BY-SA)/i

const LICENCE_FILE = /^(licen[cs]e|copying)(\.[a-z0-9]+|[-_].*)?$/i
const NOTICE_FILE = /^notice(\.[a-z0-9]+)?$/i

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
/** CRLF and CR become LF; trailing whitespace at the end goes; one final LF */
export const normaliseText = (text) => text.replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n'

/**
 * An SPDX expression, as far as the notices need it: one identifier, or one
 * level of `A OR B` / `A AND B`. Anything else - missing, UNKNOWN, "SEE LICENSE
 * IN", nested or mixed operators - is `null`, and the caller fails.
 */
export function parseSpdx(expr) {
  if (typeof expr !== 'string') return null
  const e = expr.trim().replace(/^\((.*)\)$/, '$1').trim()
  if (!e || /^(unknown|unlicensed|none)$/i.test(e) || /^see licen[cs]e/i.test(e)) return null
  const ID = /^[A-Za-z0-9.+-]+$/
  if (ID.test(e)) return { op: null, ids: [e] }
  for (const op of ['OR', 'AND']) {
    const parts = e.split(new RegExp(`\\s+${op}\\s+`))
    if (parts.length > 1 && parts.every((p) => ID.test(p.trim()))) return { op, ids: parts.map((p) => p.trim()) }
  }
  return null
}

/**
 * Is this entry's licence acceptable? `entry.spdx` is the package's expression;
 * `review` is what the registry says about it: `{ reviewed: true }` for a
 * licence that needs a person, `{ choice: 'MIT' }` for an OR expression.
 * Returns the problems; empty means acceptable.
 */
export function judgeLicence(entry, review = {}) {
  const who = `${entry.name}@${entry.version}`
  const parsed = parseSpdx(entry.spdx)
  if (!parsed) return [`${who}: licence '${entry.spdx ?? ''}' is missing, UNKNOWN or not a supported SPDX expression`]
  if (parsed.ids.some((id) => DENIED.test(id))) return [`${who}: ${entry.spdx} is never allowed automatically - it needs a manual review outside this check`]
  const ok = (id) => ALLOWED.includes(id) || (REVIEW_REQUIRED.includes(id) && review.reviewed === true)
  const why = (id) => (REVIEW_REQUIRED.includes(id) ? `${id} is allowed only for an entry the registry marks as reviewed` : `${id} is not in the allow-list (${ALLOWED.join(', ')})`)
  if (parsed.op === 'OR') {
    if (!review.choice) return [`${who}: '${entry.spdx}' offers a choice and the registry records none`]
    if (!parsed.ids.includes(review.choice)) return [`${who}: the registry chooses ${review.choice}, which '${entry.spdx}' does not offer`]
    return ok(review.choice) ? [] : [`${who}: the chosen licence ${why(review.choice)}`]
  }
  return parsed.ids.filter((id) => !ok(id)).map((id) => `${who}: ${why(id)}`)
}

/** copyright lines of a licence text, without the licences' own boilerplate */
export function copyrightLines(text) {
  const out = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!/^(copyright\b|\(c\)|©)/i.test(l)) continue
    if (/copyright (notice|holder|owner|statement|and license|license|law)/i.test(l)) continue
    if (/\[(yyyy|year)\]|\[name of copyright owner\]|<year>|\{yyyy\}/i.test(l)) continue
    if (/^copyright\s*$/i.test(l)) continue
    if (!out.includes(l)) out.push(l)
  }
  return out
}

/**
 * Read one package directory: name, version, SPDX, licence and NOTICE files
 * (full text, normalised), copyright lines. `files` names the licence files
 * explicitly when the registry says so (e.g. rolldown's THIRD-PARTY-LICENSE).
 */
export function readPackage(dir, { files = null } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const names = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())
  const pick = files ?? names.filter((f) => LICENCE_FILE.test(f)).sort()
  const licenceFiles = pick.map((f) => {
    if (!names.includes(f)) throw new Error(`${pkg.name}: ${f} is not in the package`)
    const text = normaliseText(fs.readFileSync(path.join(dir, f), 'utf8'))
    return { file: f, sha256: sha256(text), text }
  })
  const noticeFiles = names.filter((f) => NOTICE_FILE.test(f)).sort().map((f) => {
    const text = normaliseText(fs.readFileSync(path.join(dir, f), 'utf8'))
    return { file: f, sha256: sha256(text), text }
  })
  const spdx = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? null
  return { name: pkg.name, version: pkg.version, spdx, licenceFiles, noticeFiles, copyright: licenceFiles.flatMap((l) => copyrightLines(l.text)).filter((c, i, a) => a.indexOf(c) === i) }
}

/** the package directory a module id belongs to (the innermost node_modules), or null */
export function packageDirOf(id) {
  const p = id.split('?')[0].split(path.sep).join('/')
  const i = p.lastIndexOf('/node_modules/')
  if (i < 0) return null
  const rest = p.slice(i + '/node_modules/'.length).split('/')
  const name = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0]
  return p.slice(0, i + '/node_modules/'.length) + name
}

/**
 * The installed directory of `name` at exactly `version`: `node_modules/<name>`,
 * or one level down (`node_modules/<pkg>/node_modules/<name>`, the way npm
 * nests a second version). Null when no copy has that version.
 */
export function findPackageDir(root, name, version) {
  const nm = path.join(root, 'node_modules')
  const isIt = (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version === version
    } catch {
      return false
    }
  }
  const direct = path.join(nm, ...name.split('/'))
  if (isIt(direct)) return direct
  for (const a of fs.readdirSync(nm)) {
    const parents = a.startsWith('@') ? fs.readdirSync(path.join(nm, a)).map((b) => path.join(nm, a, b)) : [path.join(nm, a)]
    for (const parent of parents) {
      const nested = path.join(parent, 'node_modules', ...name.split('/'))
      if (isIt(nested)) return nested
    }
  }
  return null
}

/**
 * A build's notices text rebuilt from its manifest section and the installed
 * packages, without the bundler - what the dev server serves (it has no module
 * graph to read). Every package is found by name AND version, every licence
 * and NOTICE file must have the SHA-256 the manifest pins, and the whole text
 * must have the manifest's `noticesSha256`. Throws on any difference: the dev
 * text is the build's text or nothing.
 */
export function noticesFromManifest(section, root) {
  const entries = section.entries.map((m) => {
    const who = `${m.name}@${m.version}`
    const dir = findPackageDir(root, m.name, m.version)
    if (!dir) throw new Error(`${who}: not installed at that version`)
    const p = readPackage(dir, { files: m.licenceFiles.map((f) => f.file) })
    const licenceFiles = p.licenceFiles.map((l, i) => {
      if (l.sha256 !== m.licenceFiles[i].sha256) throw new Error(`${who}: ${l.file} is not the text the manifest pins`)
      return { ...l, ...(m.licenceFiles[i].covers !== undefined ? { covers: m.licenceFiles[i].covers } : {}) }
    })
    if (JSON.stringify(p.noticeFiles.map((n) => ({ file: n.file, sha256: n.sha256 }))) !== JSON.stringify(m.noticeFiles)) throw new Error(`${who}: its NOTICE files are not the ones the manifest pins`)
    return {
      name: m.name,
      version: m.version,
      spdx: m.spdx,
      ...(m.licenceSummary !== undefined ? { licenceSummary: m.licenceSummary } : {}),
      source: m.source,
      licenceFiles,
      noticeFiles: p.noticeFiles,
      copyright: m.copyright,
    }
  })
  const text = renderNotices(entries)
  if (sha256(text) !== section.noticesSha256) throw new Error(`the rebuilt notices (SHA-256 ${sha256(text).slice(0, 12)}) are not the manifest's (${section.noticesSha256.slice(0, 12)})`)
  return text
}

/** every problem with a set of entries: licence, licence text, copyright */
export function checkEntries(entries, reviews = {}) {
  const problems = []
  for (const e of entries) {
    const who = `${e.name}@${e.version}`
    problems.push(...judgeLicence(e, reviews[e.name] ?? {}))
    if (!e.licenceFiles.length) problems.push(`${who}: no licence file - the full licence text is required`)
    if (!e.copyright.length) problems.push(`${who}: no copyright line found and none recorded in the registry`)
    if (e.provenance === 'unresolved') problems.push(`${who}: provenance is marked unresolved`)
    if (e.licenceSummary !== undefined && !(typeof e.licenceSummary === 'string' && e.licenceSummary.startsWith(`${e.spdx} + `))) problems.push(`${who}: the licence summary '${e.licenceSummary}' must read '${e.spdx} + ...'`)
  }
  return problems
}

/** the manifest record of one build: what the check compares, no full texts */
export function manifestSection(entries, noticesText) {
  return {
    entries: entries.map((e) => ({
      name: e.name,
      version: e.version,
      spdx: e.spdx,
      ...(e.licenceSummary !== undefined ? { licenceSummary: e.licenceSummary } : {}),
      source: e.source,
      licenceFiles: e.licenceFiles.map((l) => ({ file: l.file, sha256: l.sha256, ...(l.covers !== undefined ? { covers: l.covers } : {}) })),
      noticeFiles: e.noticeFiles.map((l) => ({ file: l.file, sha256: l.sha256 })),
      copyright: e.copyright,
    })),
    noticesSha256: sha256(noticesText),
  }
}

/** human-readable differences between the committed section and this build's */
export function diffSection(expected, actual) {
  if (!expected) return ['this build has no section in the manifest']
  const out = []
  const key = (e) => `${e.name}@${e.version}`
  const exp = new Map(expected.entries.map((e) => [key(e), e]))
  const act = new Map(actual.entries.map((e) => [key(e), e]))
  for (const k of act.keys()) if (!exp.has(k)) out.push(`+ ${k} is shipped but not in the manifest`)
  for (const k of exp.keys()) if (!act.has(k)) out.push(`- ${k} is in the manifest but not shipped`)
  for (const [k, a] of act) {
    const e = exp.get(k)
    if (!e) continue
    for (const f of ['spdx', 'licenceSummary', 'source']) if (e[f] !== a[f]) out.push(`~ ${k}: ${f} ${JSON.stringify(e[f])} -> ${JSON.stringify(a[f])}`)
    if (JSON.stringify(e.licenceFiles) !== JSON.stringify(a.licenceFiles)) out.push(`~ ${k}: licence files or their SHA-256 changed`)
    if (JSON.stringify(e.noticeFiles) !== JSON.stringify(a.noticeFiles)) out.push(`~ ${k}: NOTICE files changed (${e.noticeFiles.length} -> ${a.noticeFiles.length})`)
    if (JSON.stringify(e.copyright) !== JSON.stringify(a.copyright)) out.push(`~ ${k}: copyright lines changed`)
  }
  if (!out.length && expected.noticesSha256 !== actual.noticesSha256) out.push(`~ the notices text changed (SHA-256 ${expected.noticesSha256.slice(0, 12)} -> ${actual.noticesSha256.slice(0, 12)})`)
  return out
}

export const NOTICES_HEADER = [
  'Loop Studio',
  'Copyright © 2026 Hanrim. All rights reserved.',
  '',
  'Third-party open-source licenses',
  '',
  'Loop Studio includes the third-party software listed below. Each component',
  'is provided under its own license, which is reproduced in full. A license',
  'text that several components share is printed once, at its first use.',
].join('\n')

/**
 * What the notices say on an entry's `License:` line: its SPDX licence, or
 * the registry's summary for a component whose licence file also carries the
 * licences of code it bundles ("MIT + bundled third-party notices").
 */
export const licenceLine = (e) => e.licenceSummary ?? e.spdx

/** the THIRD_PARTY_NOTICES.txt text: sorted, LF, each distinct text once */
export function renderNotices(entries) {
  const sorted = [...entries].sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1))
  const printed = new Map()
  const blocks = [NOTICES_HEADER, '', `${sorted.length} components:`, ...sorted.map((e) => `  - ${e.name} ${e.version} (${licenceLine(e)})`)]
  for (const e of sorted) {
    blocks.push('', '='.repeat(78), `${e.name} ${e.version}`, `License: ${licenceLine(e)}`, `Included as: ${e.source}`)
    for (const c of e.copyright) blocks.push(c)
    for (const f of [...e.licenceFiles, ...e.noticeFiles]) {
      blocks.push('', `--- ${f.file}${f.covers ? ` (${f.covers})` : ''} ---`)
      if (printed.has(f.sha256)) blocks.push(`(identical to ${printed.get(f.sha256)} above)`)
      else {
        printed.set(f.sha256, `${e.name} ${e.version} ${f.file}`)
        blocks.push(f.text.replace(/\n$/, ''))
      }
    }
  }
  return normaliseText(blocks.join('\n'))
}

// The portable build carries the notices as TEXT inside an HTML <template>.
// The contract, for this build step and for any screen that shows the notices
// (#301's licence screen included):
//   - writing: `&`, `<` and `>` become `&amp;`, `&lt;` and `&gt;`. The escaped
//     text then holds no `<`, and an HTML tokenizer only leaves its data state
//     at a `<`: whatever a licence text says, it cannot close the template,
//     open a <script> or add any other element;
//   - the text holds no U+0000 and no CR, the two characters an HTML parser
//     drops or rewrites in text, so the DOM gives back the exact bytes of
//     THIRD_PARTY_NOTICES.txt;
//   - reading: `template.content.textContent` (a <template>'s children live in
//     its `content` fragment), shown as text - a React text child or
//     `textContent` - and NEVER through `innerHTML` or
//     `dangerouslySetInnerHTML`. Licence texts are third-party input; they are
//     never rendered as HTML.
export const PORTABLE_TEMPLATE_ID = 'third-party-notices'
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'
export const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** the inverse of `escapeHtml` only: one pass, so `&amp;lt;` stays `&lt;` */
export const unescapeHtml = (t) => t.replace(/&(amp|lt|gt);/g, (_m, n) => ({ amp: '&', lt: '<', gt: '>' })[n])

/** the portable build's `<template>` element holding the notices text */
export function portableTemplate(text) {
  const found = [text.indexOf('\u0000'), text.indexOf('\r')].filter((i) => i >= 0)
  const bad = found.length ? Math.min(...found) : -1
  if (bad >= 0) throw new Error(`the notices text holds U+${text.charCodeAt(bad).toString(16).toUpperCase().padStart(4, '0')} at index ${bad}, which an HTML parser would drop or rewrite`)
  return `<template id="${PORTABLE_TEMPLATE_ID}">${escapeHtml(text)}</template>`
}

/**
 * The portable HTML with the notices template added before its closing
 * `</body>` - the LAST one, since the inlined scripts before it may hold the
 * same characters. Slicing, not `String.replace`, so `$&` or `$'` in a licence
 * text stay literal.
 */
export function injectPortableTemplate(html, text) {
  const at = html.lastIndexOf('</body>')
  if (at < 0) throw new Error('the HTML has no </body>')
  if (html.includes(`id="${PORTABLE_TEMPLATE_ID}"`)) throw new Error(`the HTML already has an element with id="${PORTABLE_TEMPLATE_ID}"`)
  return `${html.slice(0, at)}${portableTemplate(text)}\n${html.slice(at)}`
}

/**
 * The notices text back out of a portable HTML file, as a browser would give
 * it. Throws unless there is exactly one such template and its content is
 * what `portableTemplate` writes: no raw `<`, no `&` other than the three
 * escapes, no U+0000 or CR.
 */
export function readPortableTemplate(html) {
  const open = `<template id="${PORTABLE_TEMPLATE_ID}">`
  const count = html.split(open).length - 1
  if (count !== 1) throw new Error(`expected one <template id="${PORTABLE_TEMPLATE_ID}">, found ${count}`)
  const start = html.indexOf(open) + open.length
  const end = html.indexOf('</template>', start)
  if (end < 0) throw new Error(`<template id="${PORTABLE_TEMPLATE_ID}"> is not closed`)
  const inner = html.slice(start, end)
  if (inner.includes('<')) throw new Error(`<template id="${PORTABLE_TEMPLATE_ID}"> holds a raw '<' - the text is not escaped`)
  if (/&(?!(amp|lt|gt);)/.test(inner)) throw new Error(`<template id="${PORTABLE_TEMPLATE_ID}"> holds an '&' that is not one of the three escapes`)
  if (inner.includes('\u0000') || inner.includes('\r')) throw new Error(`<template id="${PORTABLE_TEMPLATE_ID}"> holds U+0000 or CR`)
  return unescapeHtml(inner)
}

/** an absolute path of the machine that built it: never in the manifest or the notices */
export const LOCAL_PATH = /(^|[\s"'(=:,])([A-Za-z]:[\\/]|\\\\[A-Za-z0-9]|\/(Users|home|root|tmp|private|mnt|opt|var\/folders|runner|github\/workspace)\/)/
