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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

// ── every locale CATALOG FILE (src/i18n/locales/*.ts) is validated against the
//    base. A pseudo-locale whose catalog is another locale verbatim (e.g. the
//    dev-only `en-XA`) has no file and needs no separate check. Registry-driven
//    in spirit (§L12) — the loop is over the file set, never named against
//    `ko`. `BASE_LOCALE` is read from the registry source. ──
const registrySrc = readFileSync(resolve(root, 'src/i18n/registry.ts'), 'utf8')
const BASE_LOCALE = /\bBASE_LOCALE\s*=\s*'([a-zA-Z][\w-]*)'/.exec(registrySrc)?.[1]
if (!BASE_LOCALE) {
  fail('could not read BASE_LOCALE from src/i18n/registry.ts')
  process.exit(1)
}

const localesDir = resolve(root, 'src/i18n/locales')

// A locale's entry point is EITHER `locales/<code>.ts` (one flat file) OR
// `locales/<code>/index.ts` (a folder that merges its domain slices —
// ui / canvas / inspector / templates). Both forms coexist; the loop never
// names a locale literally (§L12).
const DOMAIN_FILES = ['ui', 'canvas', 'inspector', 'templates']
const entries = []
for (const name of readdirSync(localesDir)) {
  if (/\.test\.ts$/.test(name)) continue
  const p = resolve(localesDir, name)
  if (statSync(p).isDirectory()) {
    if (existsSync(resolve(p, 'index.ts'))) entries.push({ code: name, entry: resolve(p, 'index.ts'), dir: p })
  } else if (/\.ts$/.test(name)) {
    entries.push({ code: name.replace(/\.ts$/, ''), entry: p, dir: null })
  }
}
const CODES = entries.map((e) => e.code)
if (!CODES.includes(BASE_LOCALE)) {
  fail(`base locale "${BASE_LOCALE}" has no src/i18n/locales/${BASE_LOCALE}.ts or ${BASE_LOCALE}/index.ts`)
  process.exit(1)
}

// Node's raw ESM loader (this script) resolves TS with type-stripping only — it
// will not follow an extensionless relative VALUE import, which is exactly what
// `<code>/index.ts` uses to pull its slices. So for a folder locale, import the
// four self-contained domain files here and merge them the same way `index.ts`
// does (spread in ui → canvas → inspector → templates order). `tsc` already
// proves `index.ts` itself compiles and that `ko` still `satisfies MessageCatalog`.
const catalogs = new Map()
for (const { code, entry, dir } of entries) {
  let cat
  if (dir) {
    const parts = {}
    for (const d of DOMAIN_FILES) {
      parts[d] = (await import(pathToFileURL(resolve(dir, `${d}.ts`)).href)).default
    }
    cat = Object.assign({}, ...DOMAIN_FILES.map((d) => parts[d]))
    if (!existsSync(resolve(dir, 'index.ts'))) fail(`${code}: folder locale has no index.ts`)
  } else {
    cat = (await import(pathToFileURL(entry).href)).default
  }
  catalogs.set(code, cat)
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

// ── split-locale integrity (§L3.3) — for a folder locale: every key is
//    declared in EXACTLY ONE domain file, and the slices merge to the full
//    base key set. A key dropped from every slice would silently fall back to
//    `en` at runtime (§L4.4); a key in two slices is a latent merge-order bug.
const keyDeclRe = /^\s*'([a-zA-Z][\w.]*)'\s*:/gm
for (const { code, dir } of entries) {
  if (!dir) continue
  const where = new Map() // key -> [domain, …]
  for (const d of DOMAIN_FILES) {
    const dp = resolve(dir, `${d}.ts`)
    if (!existsSync(dp)) {
      fail(`${code}: missing domain file ${d}.ts`)
      continue
    }
    for (const m of readFileSync(dp, 'utf8').matchAll(keyDeclRe)) {
      where.set(m[1], [...(where.get(m[1]) ?? []), d])
    }
  }
  const dupes = [...where].filter(([, ds]) => ds.length > 1)
  for (const [k, ds] of dupes) fail(`${code}: key "${k}" declared in multiple domain files (${ds.join(', ')})`)
  const mergedCount = Object.keys(catalogs.get(code)).length
  if (mergedCount !== baseKeys.size) {
    fail(`${code}: merged catalog has ${mergedCount} keys, base has ${baseKeys.size} — a domain slice dropped or added a key`)
  } else if (!dupes.length) {
    ok(`${code}: ${DOMAIN_FILES.length} domain slices, ${where.size} keys, no cross-file duplication, merges to base`)
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
