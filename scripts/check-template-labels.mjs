// docs/template-label-overlay.md §TLO7 — the template label-overlay drift check.
// Runs in the `checks` job.
//
//   node scripts/check-template-labels.mjs
//
// The rule is completeness-CONDITIONAL, per (Template, non-base locale):
//   • NO dictionary at all  → OK, IF the template id is on the locale's
//     EN-fallback allow-list; otherwise FAIL (missing dictionary).
//   • A dictionary present   → it must be COMPLETE for that template:
//       - missing:  every user-facing canonical node id has an entry
//                   (unless on that (template, locale) label allow-list);
//       - stale:    every dictionary key is a CURRENT canonical node id;
//       - duplicate: no node id keyed twice in the source `<locale>.ts`;
//       - empty:    no blank label value.
//
// Source-text driven (like check-mobile-query.mjs) so it needs no JSON-import
// attribute. Canonical node ids for a Template that HAS a dictionary come from
// its `examples/<id>.json`.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)
const read = (p) => readFileSync(resolve(root, p), 'utf8')

// ── registry: base locale + shipped non-base locales (never named literally) ──
const registrySrc = read('src/i18n/registry.ts')
const BASE_LOCALE = /\bBASE_LOCALE\s*=\s*'([a-zA-Z][\w-]*)'/.exec(registrySrc)?.[1]
if (!BASE_LOCALE) {
  fail('could not read BASE_LOCALE from src/i18n/registry.ts')
  process.exit(1)
}
const shippedBlock = /SHIPPED_LOCALES[^[]*\[([\s\S]*?)\n\]/.exec(registrySrc)?.[1] ?? ''
const NON_BASE = [...shippedBlock.matchAll(/code:\s*'([a-zA-Z][\w-]*)'/g)]
  .map((m) => m[1])
  .filter((c) => c !== BASE_LOCALE)
ok(`base = ${BASE_LOCALE}; non-base = ${NON_BASE.join(', ') || '(none)'}`)

// ── the TEMPLATES id list, from src/model/templates.ts source ──
const templatesSrc = read('src/model/templates.ts')
const arrBody = /export const TEMPLATES[^[]*\[([\s\S]*)\n\]/.exec(templatesSrc)?.[1] ?? ''
const TEMPLATE_IDS = [...arrBody.matchAll(/^\s*id:\s*'([a-z][\w-]*)'/gm)].map((m) => m[1])
if (TEMPLATE_IDS.length === 0) {
  fail('could not read any template id from src/model/templates.ts')
  process.exit(1)
}
ok(`templates: ${TEMPLATE_IDS.join(', ')}`)

// ── the overlay registration, from src/i18n/templateLabels/index.ts source ──
const overlaySrc = read('src/i18n/templateLabels/index.ts')
// EN_FALLBACK_TEMPLATES = { ko: ['equilibrium', 'deadlock'] }
const enFallback = {}
const efBlock = /EN_FALLBACK_TEMPLATES[^{]*\{([\s\S]*?)\n\}/.exec(overlaySrc)?.[1] ?? ''
for (const m of efBlock.matchAll(/([a-zA-Z][\w-]*)\s*:\s*\[([^\]]*)\]/g)) {
  enFallback[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
// DICTS = { ko }  →  which locales have a dictionary module
const dictLocales = [
  ...(/DICTS[^{]*\{([^}]*)\}/.exec(overlaySrc)?.[1] ?? '').matchAll(/\b([a-zA-Z][\w-]*)\b/g),
].map((m) => m[1])

// node ids with no user-facing label — exempt from "missing". Empty today.
const NO_LABEL_NODE_IDS = new Set()

// canonical node ids for a template that has a dictionary
function canonicalIds(tplId) {
  const p = resolve(root, `examples/${tplId}.json`)
  let doc
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
  return (doc.nodes ?? []).map((n) => n.id)
}

for (const locale of NON_BASE) {
  if (!dictLocales.includes(locale)) {
    // no dictionary module for this locale at all → every template is EN
    ok(`${locale}: no dictionary module — every template opens in English`)
    continue
  }
  const dictSrc = read(`src/i18n/templateLabels/${locale}.ts`)

  for (const tplId of TEMPLATE_IDS) {
    // does the source have a `'<tplId>': { … }` block?
    const block = new RegExp(`'${tplId}'\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(dictSrc)
    const allowMissingDict = (enFallback[locale] ?? []).includes(tplId)

    if (!block) {
      if (allowMissingDict) {
        ok(`${tplId} / ${locale}: no dictionary — EN fallback (allow-listed)`)
      } else {
        fail(
          `${tplId} / ${locale}: no dictionary block and not on ` +
            `EN_FALLBACK_TEMPLATES['${locale}'] — add one or allow-list the id (§TLO2.1)`,
        )
      }
      continue
    }

    const body = block[1]
    const keyMatches = [...body.matchAll(/^\s*([A-Za-z_$][\w$]*|'[^']+')\s*:\s*'([^']*)'/gm)]
    const ids = keyMatches.map((m) => m[1].replace(/'/g, ''))
    const values = keyMatches.map((m) => m[2])

    // duplicate
    const seen = new Set()
    const dup = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
    if (dup.length) fail(`${tplId} / ${locale}: duplicate key(s): ${[...new Set(dup)].join(', ')}`)

    // empty value
    const emptyIdx = values.flatMap((v, i) => (v.trim() ? [] : [ids[i]]))
    if (emptyIdx.length) fail(`${tplId} / ${locale}: empty label value for: ${emptyIdx.join(', ')}`)

    const canon = canonicalIds(tplId)
    if (!canon) {
      fail(
        `${tplId} / ${locale}: has a dictionary but no examples/${tplId}.json to check ids against`,
      )
      continue
    }
    const canonSet = new Set(canon)
    const keySet = new Set(ids)

    const missing = canon.filter((id) => !keySet.has(id) && !NO_LABEL_NODE_IDS.has(id))
    if (missing.length) fail(`${tplId} / ${locale}: missing label for: ${missing.join(', ')}`)

    const stale = ids.filter((id) => !canonSet.has(id))
    if (stale.length) fail(`${tplId} / ${locale}: stale key(s) — no such canonical node: ${stale.join(', ')}`)

    if (!missing.length && !stale.length && !dup.length && !emptyIdx.length) {
      ok(`${tplId} / ${locale}: ${ids.length} labels, complete`)
    }
  }
}

// the overlay function must not translate anything but `label` — guard the
// source against an accidental `resourceType` / `expr` write in the apply loop
if (/\.data\s*(?:as[^)]*)?\)?\.(resourceType|expr|unit)\s*=/.test(overlaySrc)) {
  fail('src/i18n/templateLabels/index.ts writes a non-label field — overlay is label-only (§TLO-D4)')
}

// keep the void reference so an unused import never trips lint if edited later
void pathToFileURL

if (failed) {
  console.error('\ncheck-template-labels: FAILED')
  process.exit(1)
}
console.log('\ncheck-template-labels: ok')
