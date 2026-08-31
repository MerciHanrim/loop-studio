// docs/localization.md §L12 #1–#2 — catalog + ICU integrity, over the WHOLE
// registry. `tsc` + `satisfies` (§L3.3) already blocks a missing/extra key; this
// adds the ICU-level checks a type cannot see. Runs in the `checks` job.
//
//   node scripts/check-i18n.mjs
//
// Per registered locale:
//   • every message PARSES as ICU
//   • no empty-string values
//   • the key set equals the base (`en`) key set exactly
//   • every plural / select / selectordinal block has an `other` arm
//   • the argument-NAME set of each message equals the base message's
//   • the argument KIND (slot / number / date / time / plural / select /
//     selectordinal) of each shared argument matches the base
//   • no rich-text tag syntax (`<tag>…</tag>`) anywhere
// Plus, against the call sites:
//   • no `t('key')` literal refers to a key absent from the base catalog
//   • every base key is referenced somewhere in src/ (no dead keys)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { validateCatalog } from '../src/i18n/validate.ts'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

// ── discover the registered locales from src/i18n/registry.ts, then load each
//    src/i18n/locales/<code>.ts. Registry-driven (§L12) — never names `ko`. ──
const registrySrc = readFileSync(resolve(root, 'src/i18n/registry.ts'), 'utf8')
const CODES = [...registrySrc.matchAll(/\bcode:\s*'([a-zA-Z][\w-]*)'/g)].map((m) => m[1])
const BASE_LOCALE = /\bBASE_LOCALE\s*=\s*'([a-zA-Z][\w-]*)'/.exec(registrySrc)?.[1]
if (!CODES.length || !BASE_LOCALE) {
  fail('could not read the locale registry (LOCALES codes / BASE_LOCALE)')
  process.exit(1)
}

const catalogs = new Map()
for (const code of CODES) {
  const mod = await import(pathToFileURL(resolve(root, `src/i18n/locales/${code}.ts`)).href)
  catalogs.set(code, mod.default)
}
const base = catalogs.get(BASE_LOCALE)
if (!base) {
  fail(`base locale "${BASE_LOCALE}" has no catalog`)
  process.exit(1)
}
const baseKeys = new Set(Object.keys(base))

// ── per-locale checks (the shared pure validator, §L12 #1) ──────────────
for (const [code, cat] of catalogs) {
  const problems = validateCatalog(base, code, cat)
  for (const p of problems) fail(p)
  if (!problems.length) {
    ok(`${code}: ${Object.keys(cat).length} keys, ICU + argument shape match ${BASE_LOCALE}`)
  }
}

// ── call-site checks (§L12 #2) ─────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const srcFiles = walk(resolve(root, 'src')).filter((p) => !/[\\/]i18n[\\/]locales[\\/]/.test(p))
const blob = srcFiles.map((p) => readFileSync(p, 'utf8')).join('\n')

// missing: every t('literal') / useT()('literal') key must exist in base
const tCallRe = /\bt\(\s*(['"])([a-zA-Z][\w.]*)\1/g
const referenced = new Set()
for (const m of blob.matchAll(tCallRe)) {
  referenced.add(m[2])
  if (!baseKeys.has(m[2])) fail(`call site uses unknown message key "${m[2]}"`)
}
// also count any bare 'key.like.this' string literal that matches a base key
// (covers MessageKey-typed maps like NODE_LABEL_KEY / LABEL_KEY)
for (const k of baseKeys) {
  if (referenced.has(k)) continue
  if (blob.includes(`'${k}'`) || blob.includes(`"${k}"`)) referenced.add(k)
}
for (const k of baseKeys) {
  if (!referenced.has(k)) fail(`dead message key "${k}" — defined in ${BASE_LOCALE} but referenced nowhere in src/`)
}
if (!failed) ok(`${referenced.size}/${baseKeys.size} base keys referenced; no unknown keys at call sites`)

if (failed) {
  console.error('\ncheck-i18n: FAILED')
  process.exit(1)
}
console.log('\ncheck-i18n: ok')
