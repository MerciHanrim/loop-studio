// Issue #301 — after a build: are the third-party notices really in what ships?
//
//   node scripts/check-third-party-notices.mjs <outDir> <web|pwa|portable>
//
// web / pwa : THIRD_PARTY_NOTICES.txt exists and its SHA-256 is the one in
//             licenses/third-party-manifest.json; Vite's own licence JSON is
//             not left in the output.
// pwa       : the service worker precaches the file, and every service-worker
//             item of licenses/registry.json has its marker in sw.js /
//             workbox-*.js - and no Workbox package is shipped that the
//             registry does not list.
// portable  : no separate file; the single HTML carries the same text in
//             <template id="third-party-notices">, escaped (no raw `<`, no
//             stray `&`), and the manifest pins the same bytes as the web
//             build's file. The real-DOM read is in e2e/portable-file.spec.ts.
// Every manifest entry's name appears in the text, and neither the text nor
// the manifest holds a local absolute path. Fails closed: a missing
// directory, file or marker is an error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_PATH, NOTICES_FILE, licenceLine, readPortableTemplate, sha256 } from './third-party-notices/core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [outDirArg, flavour] = process.argv.slice(2)
const problems = []
const ok = []
if (!outDirArg || !['web', 'pwa', 'portable'].includes(flavour)) {
  console.error('usage: node scripts/check-third-party-notices.mjs <outDir> <web|pwa|portable>')
  process.exit(2)
}
const out = path.resolve(ROOT, outDirArg)
if (!fs.existsSync(out)) {
  console.error(`  FAIL  ${outDirArg}: no such build output - build it first`)
  process.exit(1)
}
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'licenses', 'third-party-manifest.json'), 'utf8'))
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'licenses', 'registry.json'), 'utf8'))
const section = manifest.builds?.[flavour]
if (!section) problems.push(`the manifest has no '${flavour}' section`)

let text = null
if (flavour === 'portable') {
  if (fs.existsSync(path.join(out, NOTICES_FILE))) problems.push(`${NOTICES_FILE} exists beside the portable file - the portable build carries the notices inside its HTML`)
  const html = fs.readdirSync(out).filter((f) => f.endsWith('.html'))
  if (html.length !== 1) problems.push(`expected one HTML file in ${outDirArg}, found ${html.length}`)
  else {
    try {
      text = readPortableTemplate(fs.readFileSync(path.join(out, html[0]), 'utf8'))
      ok.push(`${html[0]} carries the notices as escaped text (${text.length} characters)`)
    } catch (err) {
      problems.push(`${html[0]}: ${err.message}`)
    }
  }
  // the portable file and the web build carry the same bytes
  if (section && section.noticesSha256 !== manifest.builds?.web?.noticesSha256) problems.push(`the manifest's portable notices (${section.noticesSha256.slice(0, 12)}) are not the web build's (${String(manifest.builds?.web?.noticesSha256).slice(0, 12)})`)
} else {
  const file = path.join(out, NOTICES_FILE)
  if (!fs.existsSync(file)) problems.push(`${NOTICES_FILE} is missing from ${outDirArg}`)
  else text = fs.readFileSync(file, 'utf8')
  if (fs.existsSync(path.join(out, '.vite'))) {
    const left = fs.readdirSync(path.join(out, '.vite')).filter((f) => /licen[cs]e/i.test(f))
    if (left.length) problems.push(`.vite/${left.join(', ')} is in the output - Vite's licence list must not be deployed`)
  }
}

if (text !== null && section) {
  if (sha256(text) !== section.noticesSha256) problems.push(`the notices' SHA-256 ${sha256(text).slice(0, 12)} is not the manifest's ${section.noticesSha256.slice(0, 12)}`)
  else ok.push(`the notices match the manifest (${section.entries.length} components, SHA-256 ${section.noticesSha256.slice(0, 12)})`)
  for (const e of section.entries) if (!text.includes(`${e.name} ${e.version}\nLicense: ${licenceLine(e)}\n`)) problems.push(`${e.name} ${e.version} is in the manifest but not in the notices text`)
  if (LOCAL_PATH.test(text)) problems.push(`the notices text holds a local absolute path: '${text.match(LOCAL_PATH)[0].trim()}'`)
}
if (section && LOCAL_PATH.test(JSON.stringify(section))) problems.push(`the manifest's '${flavour}' section holds a local absolute path`)

if (flavour === 'pwa') {
  const sw = path.join(out, 'sw.js')
  const wb = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /^workbox-[0-9a-f]+\.js$/.test(f)) : []
  if (!fs.existsSync(sw)) problems.push('sw.js is missing from the PWA build')
  else {
    const swText = fs.readFileSync(sw, 'utf8')
    const wbText = wb.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n')
    if (!swText.includes(`"${NOTICES_FILE}"`) && !swText.includes(`'${NOTICES_FILE}'`)) problems.push(`sw.js does not precache ${NOTICES_FILE} - it would not open offline`)
    else ok.push(`sw.js precaches ${NOTICES_FILE}`)
    for (const s of registry.serviceWorker) {
      const hay = s.evidence.file === 'sw.js' ? swText : wbText
      if (!hay.includes(s.evidence.contains)) problems.push(`${s.name}: the registry lists it for the PWA, but '${s.evidence.contains}' is not in ${s.evidence.file}`)
    }
    const listed = new Set(registry.serviceWorker.map((s) => s.name))
    for (const m of new Set([...wbText.matchAll(/workbox:([a-z-]+):/g)].map((x) => 'workbox-' + x[1]))) {
      if (!listed.has(m)) problems.push(`${m} is in the service worker but not in the registry`)
    }
    ok.push(`${registry.serviceWorker.length} service-worker items found by their markers`)
  }
}

for (const o of ok) console.log(`  ok    ${o}`)
for (const p of problems) console.error(`  FAIL  ${p}`)
if (problems.length) {
  console.error(`\n  The ${flavour} build's third-party notices are incomplete. See licenses/README.md.`)
  process.exit(1)
}
console.log(`  ok    ${flavour}: the third-party notices ship with the build`)
