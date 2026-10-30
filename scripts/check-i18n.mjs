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
//   • a folder locale merges exactly the base's slices, in the base's order,
//     and holds no other slice file — the slice list is read from
//     `en/index.ts`, never kept here (issue #414; `catalog-slices.mjs`)
// Plus, against the call sites:
//   • no `t('key')` literal refers to a key absent from the base catalog
//   • every base key is referenced somewhere in src/ (no dead keys)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { validateCatalog } from '../src/i18n/validate.ts'
import { sliceKeys } from './catalog-source.mjs'
import { catalogSlices } from './catalog-slices.mjs'

const root = resolve(import.meta.dirname, '..')
// issue #414 — the two trees the check reads, overridable so a test can point
// the SAME script at a fixture (a locale folder with a sixth slice, a stray
// file, a different merge order) and watch it fail; the product run sets
// neither.
const localesDir = resolve(root, process.env.LOOP_I18N_LOCALES_DIR ?? 'src/i18n/locales')
const callSiteDir = resolve(root, process.env.LOOP_I18N_SRC_DIR ?? 'src')
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

// A locale's entry point is EITHER `locales/<code>.ts` (one flat file) OR
// `locales/<code>/index.ts` (a folder that merges its domain slices). Both
// forms coexist; the loop never names a locale literally (§L12).
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

// issue #414 — the slice list is READ from the base locale's `index.ts` (the
// real merge: its relative default imports, in spread order), never carried
// here by hand. A slice added to `en/index.ts` is therefore part of every
// check below the moment it exists; a slice this parser cannot read is a stop.
const baseEntry = entries.find((e) => e.code === BASE_LOCALE)
if (!baseEntry.dir) {
  fail(`base locale "${BASE_LOCALE}" must be a folder locale (locales/${BASE_LOCALE}/index.ts) so its slices can be read`)
  process.exit(1)
}
let DOMAIN_FILES
try {
  DOMAIN_FILES = catalogSlices(baseEntry.entry)
} catch (e) {
  fail(`${BASE_LOCALE}: ${e.message}`)
  process.exit(1)
}
ok(`${BASE_LOCALE}/index.ts merges ${DOMAIN_FILES.length} slices: ${DOMAIN_FILES.join(', ')}`)

// Node's raw ESM loader (this script) resolves TS with type-stripping only — it
// will not follow an extensionless relative VALUE import, which is exactly what
// `<code>/index.ts` uses to pull its slices. So for a folder locale, import the
// slices here and merge them the same way `index.ts` does (spread in the
// base's order). `tsc` already proves `index.ts` itself compiles and that every
// locale still `satisfies MessageCatalog`. Before the merge, every folder
// locale's OWN `index.ts` must merge exactly the base's slices in the base's
// order, and must have no other `.ts` file beside them (a slice nothing merges
// is a translation that never ships).
const catalogs = new Map()
for (const { code, entry, dir } of entries) {
  let cat
  if (dir) {
    let own
    try {
      own = catalogSlices(entry)
    } catch (e) {
      fail(`${code}: ${e.message}`)
      continue
    }
    if (own.join(',') !== DOMAIN_FILES.join(',')) {
      fail(`${code}: index.ts merges [${own.join(', ')}] but ${BASE_LOCALE}/index.ts merges [${DOMAIN_FILES.join(', ')}] (same slices, same order)`)
      continue
    }
    for (const name of readdirSync(dir)) {
      if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || name === 'index.ts') continue
      const slice = name.replace(/\.ts$/, '')
      if (!DOMAIN_FILES.includes(slice)) fail(`${code}: ${name} is not a slice ${BASE_LOCALE}/index.ts merges — nothing ships it`)
    }
    let missing = false
    for (const d of DOMAIN_FILES) {
      if (!existsSync(resolve(dir, `${d}.ts`))) {
        fail(`${code}: missing domain file ${d}.ts`)
        missing = true
      }
    }
    if (missing) continue
    const parts = {}
    for (const d of DOMAIN_FILES) {
      parts[d] = (await import(pathToFileURL(resolve(dir, `${d}.ts`)).href)).default
    }
    cat = Object.assign({}, ...DOMAIN_FILES.map((d) => parts[d]))
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
//
//    Keys are enumerated with the TypeScript parser (`./catalog-source.mjs`),
//    not a text regex. The regex this replaced could not see a key containing a
//    HYPHEN, so 46 of the base catalog's 852 keys — every `import.issue.*` and
//    friends — were outside the duplication guard entirely while it printed
//    "no cross-file duplication". A parser that fails closed is the only way
//    this sentence means what it says.
for (const { code, dir } of entries) {
  if (!dir || !catalogs.has(code)) continue
  const where = new Map() // key -> [domain, …]
  let unreadable = false
  for (const d of DOMAIN_FILES) {
    const dp = resolve(dir, `${d}.ts`)
    if (!existsSync(dp)) {
      fail(`${code}: missing domain file ${d}.ts`)
      unreadable = true
      continue
    }
    let keys
    try {
      keys = sliceKeys(dp)
    } catch (e) {
      // a slice we cannot enumerate is a STOP, never a shorter list
      fail(`${code}: ${e.message}`)
      unreadable = true
      continue
    }
    for (const k of keys) where.set(k, [...(where.get(k) ?? []), d])
  }
  if (unreadable) continue
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

const srcFiles = walk(callSiteDir).filter((p) => !/[\\/]i18n[\\/]locales[\\/]/.test(p) && !p.startsWith(localesDir))
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
