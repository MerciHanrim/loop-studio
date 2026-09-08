// docs/template-label-overlay.md §TLO11 — generator for the static "official
// label" index that lets the §TLO11 relabel keep working when per-locale
// template-label dicts are lazy-loaded (docs/localization.md §L4.5).
//
//   node scripts/gen-known-labels.mjs          # rewrite the generated file
//
// `relabel.ts` needs, synchronously, at the instant `activeLocale` flips:
//   • KNOWN_OFFICIAL_LABELS[nodeId] — every string that is an official label
//     for that node id in SOME shipped locale (EN canonical included), so a
//     current label can be classified as "official" (→ switch) vs "a user
//     rename" (→ keep). This must be COMPLETE regardless of which locale
//     chunks have loaded, so it is generated here at build time.
//   • AMBIGUOUS_NODE_IDS — node ids shared by two templates whose official
//     target label is NOT identical in every locale; never switched. (The CI
//     drift check in check-template-labels.mjs fails first, so this is a
//     defense-in-depth and is empty today.)
//
// The lazily-loaded dict still supplies the TARGET string for the language
// being switched TO — only the classification data is frozen here.
//
// Source-text driven (same idiom as check-template-labels.mjs) — no JSON import
// attribute, no app transpile.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const OUT = 'src/i18n/templateLabels/known.generated.ts'

// ── registry: base + shipped non-base locales (never named literally) ──
const registrySrc = read('src/i18n/registry.ts')
const BASE_LOCALE = /\bBASE_LOCALE\s*=\s*'([a-zA-Z][\w-]*)'/.exec(registrySrc)?.[1]
if (!BASE_LOCALE) {
  console.error('gen-known-labels: could not read BASE_LOCALE from src/i18n/registry.ts')
  process.exit(1)
}
const shippedBlock = /SHIPPED_LOCALES[^[]*\[([\s\S]*?)\n\]/.exec(registrySrc)?.[1] ?? ''
const NON_BASE = [...shippedBlock.matchAll(/code:\s*'([a-zA-Z][\w-]*)'/g)]
  .map((m) => m[1])
  .filter((c) => c !== BASE_LOCALE)

// ── template ids, from src/model/templates.ts ──
const templatesSrc = read('src/model/templates.ts')
const arrBody = /export const TEMPLATES[^[]*\[([\s\S]*)\n\]/.exec(templatesSrc)?.[1] ?? ''
const TEMPLATE_IDS = [...arrBody.matchAll(/^\s*id:\s*'([a-z][\w-]*)'/gm)].map((m) => m[1])
if (TEMPLATE_IDS.length === 0) {
  console.error('gen-known-labels: could not read any template id from src/model/templates.ts')
  process.exit(1)
}

// ── which non-base locales ship a template-label dictionary module ──
const dictsSrc = read('src/i18n/templateLabels/dicts.ts')
const loaderBlock = /DICT_LOADERS[^{]*\{([\s\S]*?)\n\}/.exec(dictsSrc)?.[1] ?? ''
const DICT_LOCALES = [...loaderBlock.matchAll(/^\s*'?([a-zA-Z][\w-]*)'?\s*:\s*\(\)/gm)].map(
  (m) => m[1],
)

// canonical `id -> English label` for a template, from examples/<id>.json
function canonicalLabels(tplId) {
  try {
    const doc = JSON.parse(read(`examples/${tplId}.json`))
    return new Map((doc.nodes ?? []).map((n) => [n.id, n?.data?.label]))
  } catch {
    return new Map()
  }
}

// `id -> localized label` for (template, locale) from the dict source
function localizedLabels(tplId, locale) {
  const src = read(`src/i18n/templateLabels/${locale}.ts`)
  const block = new RegExp(`'${tplId}'\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(src)
  const out = new Map()
  for (const m of (block?.[1] ?? '').matchAll(
    /^\s*([A-Za-z_$][\w$]*|'[^']+')\s*:\s*'([^']*)'/gm,
  )) {
    out.set(m[1].replace(/'/g, ''), m[2])
  }
  return out
}

// ── build the index ──
const known = new Map() // id -> Set<string>
const targetByLocale = new Map() // locale -> Map<id, label>
const ambiguous = new Set()

const addKnown = (id, label) => {
  if (label == null || label === '') return
  let s = known.get(id)
  if (!s) known.set(id, (s = new Set()))
  s.add(label)
}
const setTarget = (locale, id, label) => {
  if (label == null || label === '') return
  let m = targetByLocale.get(locale)
  if (!m) targetByLocale.set(locale, (m = new Map()))
  const prev = m.get(id)
  if (prev !== undefined && prev !== label) ambiguous.add(id)
  else m.set(id, label)
}

for (const tplId of TEMPLATE_IDS) {
  const canon = canonicalLabels(tplId)
  if (canon.size === 0) continue
  for (const [id, enLabel] of canon) {
    addKnown(id, enLabel)
    setTarget(BASE_LOCALE, id, enLabel)
  }
  for (const locale of NON_BASE) {
    if (!DICT_LOCALES.includes(locale)) continue
    const loc = localizedLabels(tplId, locale)
    for (const [id, enLabel] of canon) {
      const label = loc.get(id) ?? enLabel
      addKnown(id, label)
      setTarget(locale, id, label)
    }
  }
}

// ── emit ──
const sortedIds = [...known.keys()].sort()
const entries = sortedIds
  .map((id) => {
    const labels = [...known.get(id)].sort().map((s) => JSON.stringify(s))
    return `  ${JSON.stringify(id)}: [${labels.join(', ')}],`
  })
  .join('\n')
const ambiguousArr = [...ambiguous].sort().map((s) => JSON.stringify(s))

const banner = `// GENERATED by scripts/gen-known-labels.mjs — DO NOT EDIT.
// Run \`npm run gen:known-labels\` after changing a template graph or a
// templateLabels/<locale>.ts dict; \`npm run check:template-labels\` fails on drift.
//
// docs/template-label-overlay.md §TLO11 — the frozen "is this an official
// label" classification data, so the §TLO11 relabel survives lazy per-locale
// dicts (docs/localization.md §L4.5). The TARGET string for the language being
// switched to still comes from that language's (lazily-loaded) dict.
`

const body = `${banner}
/** node id → every string that is an official label for that id in SOME shipped
 *  locale (the ${BASE_LOCALE.toUpperCase()} canonical included). */
export const KNOWN_OFFICIAL_LABELS: Readonly<Record<string, readonly string[]>> = {
${entries}
}

/** node ids shared by two templates whose official target label is not
 *  identical across every locale — never switched (the CI drift check fails
 *  first, so this is empty today). */
export const AMBIGUOUS_NODE_IDS: readonly string[] = [${
  ambiguousArr.length ? `\n  ${ambiguousArr.join(',\n  ')},\n` : ''
}]
`

const target = resolve(root, OUT)
const prev = (() => {
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
})()

if (process.argv.includes('--check')) {
  if (prev === body) {
    console.log(`gen-known-labels: ${OUT} is up to date`)
    process.exit(0)
  }
  console.error(`gen-known-labels: ${OUT} is STALE — run \`npm run gen:known-labels\``)
  process.exit(1)
}

if (prev === body) {
  console.log(`gen-known-labels: ${OUT} already current`)
} else {
  writeFileSync(target, body)
  console.log(`gen-known-labels: wrote ${OUT} (${sortedIds.length} ids)`)
}
