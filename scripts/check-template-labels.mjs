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

import { spawnSync } from 'node:child_process'
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

// ── the overlay registration, from src/i18n/templateLabels/ source ──
const overlaySrc = read('src/i18n/templateLabels/index.ts')
const dictsSrc = read('src/i18n/templateLabels/dicts.ts')
// EN_FALLBACK_TEMPLATES = { ko: ['equilibrium', 'deadlock'] }
const enFallback = {}
const efBlock = /EN_FALLBACK_TEMPLATES[^{]*\{([\s\S]*?)\n\}/.exec(overlaySrc)?.[1] ?? ''
for (const m of efBlock.matchAll(/([a-zA-Z][\w-]*)\s*:\s*\[([^\]]*)\]/g)) {
  enFallback[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
// DICT_LOADERS = { ja: () => …, ko: () => … }  →  locales with a dictionary chunk
const loaderBlock = /DICT_LOADERS[^{]*\{([\s\S]*?)\n\}/.exec(dictsSrc)?.[1] ?? ''
const dictLocales = [...loaderBlock.matchAll(/^\s*'?([a-zA-Z][\w-]*)'?\s*:\s*\(\)/gm)].map(
  (m) => m[1],
)

// node ids with no user-facing label — exempt from "missing". Empty today.
const NO_LABEL_NODE_IDS = new Set()

// §TLO12 — frame constants, mirrored from src/model/serialize.ts. A CANONICAL
// example file must be clean AS WRITTEN (readSavedFrames returns it unchanged) —
// it may not lean on the runtime defensive repair.
const SF_FRAMES_MAX = 200
const SF_LABEL_MAX = 120
const SF_FRAME_COLORS = new Set(['slate', 'sage', 'gold', 'violet', 'rose'])

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

// canonical `id -> English label` map for a template
function canonicalLabels(tplId) {
  const p = resolve(root, `examples/${tplId}.json`)
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8'))
    return new Map((doc.nodes ?? []).map((n) => [n.id, n?.data?.label]))
  } catch {
    return new Map()
  }
}

// ── §TLO12 — group-frame TITLE overlay checks ─────────────────────────────

// raw `doc.frames` of a template, or null if the file has no frames key
function canonicalFramesRaw(tplId) {
  try {
    const doc = JSON.parse(readFileSync(resolve(root, `examples/${tplId}.json`), 'utf8'))
    return Array.isArray(doc.frames) ? doc.frames : null
  } catch {
    return null
  }
}

// the `export const <locale>Frames = { … }` slice → `'<tplId>': { … }` block
function frameDictEntries(locale, tplId) {
  const src = read(`src/i18n/templateLabels/${locale}.ts`)
  const start = src.search(new RegExp(`export const ${locale}Frames\\b`))
  if (start < 0) return null // no frame dict at all for this locale
  const rest = src.slice(start)
  const nextExport = rest.slice(1).search(/\nexport const /)
  const slice = nextExport < 0 ? rest : rest.slice(0, nextExport + 1)
  const block = new RegExp(`'${tplId}'\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(slice)
  if (!block) return { present: false, ids: [], values: [] }
  const kv = [...block[1].matchAll(/^\s*([A-Za-z_$][\w$]*|'[^']+')\s*:\s*'([^']*)'/gm)]
  return { present: true, ids: kv.map((m) => m[1].replace(/'/g, '')), values: kv.map((m) => m[2]) }
}

// A canonical example's `frames` must be clean AS AUTHORED (§R5-1.1 would
// otherwise silently repair a dup id / bad rect on load).
function checkFrameShapes() {
  for (const tplId of TEMPLATE_IDS) {
    const raw = canonicalFramesRaw(tplId)
    if (raw == null) continue // no frames key — fine
    if (raw.length > SF_FRAMES_MAX)
      fail(`${tplId}: ${raw.length} frames exceeds SF_FRAMES_MAX (${SF_FRAMES_MAX})`)
    const seen = new Set()
    raw.forEach((f, i) => {
      const at = `${tplId} frames[${i}]`
      if (typeof f !== 'object' || f == null || Array.isArray(f)) return fail(`${at}: not an object`)
      if (typeof f.id !== 'string' || f.id === '') fail(`${at}: id must be a non-empty string`)
      else if (seen.has(f.id)) fail(`${at}: duplicate id '${f.id}'`)
      else seen.add(f.id)
      if (typeof f.label !== 'string') fail(`${at}: label must be a string`)
      else if (f.label.length > SF_LABEL_MAX) fail(`${at}: label longer than ${SF_LABEL_MAX}`)
      const r = f.rect
      if (typeof r !== 'object' || r == null) fail(`${at}: rect must be an object`)
      else {
        for (const k of ['x', 'y']) {
          if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) fail(`${at}: rect.${k} must be finite`)
        }
        for (const k of ['w', 'h']) {
          if (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || r[k] <= 0)
            fail(`${at}: rect.${k} must be a positive finite number`)
        }
      }
      if (f.color !== undefined && !SF_FRAME_COLORS.has(f.color))
        fail(`${at}: color '${f.color}' is not a palette id`)
    })
  }
}

// Per (template, dict-shipping locale): a frame-less template must have NO (or an
// empty) frame dict; a template WITH frames must have a dict whose id set EQUALS
// the canonical frame-id set exactly — no missing / stale / duplicate / empty.
function checkFrameTranslations() {
  for (const locale of NON_BASE) {
    if (!dictLocales.includes(locale)) continue
    for (const tplId of TEMPLATE_IDS) {
      const raw = canonicalFramesRaw(tplId)
      const canonIds = raw ? raw.map((f) => f.id) : []
      const entry = frameDictEntries(locale, tplId)

      if (canonIds.length === 0) {
        if (entry?.present && entry.ids.length > 0) {
          fail(`${tplId} / ${locale}: frame dict has ${entry.ids.length} entr(y/ies) but the template ships no frames`)
        } else {
          ok(`${tplId} / ${locale}: no frames — no frame dict (as expected)`)
        }
        continue
      }

      if (!entry || !entry.present) {
        fail(`${tplId} / ${locale}: template ships ${canonIds.length} frame(s) but there is no ${locale}Frames['${tplId}'] block (§TLO12)`)
        continue
      }

      const seen = new Set()
      const dup = entry.ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
      if (dup.length) fail(`${tplId} / ${locale}: duplicate frame key(s): ${[...new Set(dup)].join(', ')}`)
      const empty = entry.values.flatMap((v, i) => (v.trim() ? [] : [entry.ids[i]]))
      if (empty.length) fail(`${tplId} / ${locale}: empty frame title for: ${empty.join(', ')}`)
      const canonSet = new Set(canonIds)
      const keySet = new Set(entry.ids)
      const missing = canonIds.filter((id) => !keySet.has(id))
      if (missing.length) fail(`${tplId} / ${locale}: missing frame title for: ${missing.join(', ')}`)
      const stale = entry.ids.filter((id) => !canonSet.has(id))
      if (stale.length) fail(`${tplId} / ${locale}: stale frame key(s) — no such canonical frame: ${stale.join(', ')}`)

      if (!dup.length && !empty.length && !missing.length && !stale.length)
        ok(`${tplId} / ${locale}: ${entry.ids.length} frame title(s), complete`)
    }
  }
}

// §TLO12 drift — `relabelFramesForLocale` keys ONLY on frame id, so a frame id
// shared by two templates must resolve to the SAME official title in every
// locale, or it could never be switched. Fail if a shared id diverges.
function checkSharedFrameIdTargets() {
  const raw = {} // locale -> id -> { title, template }
  const record = (locale, id, title, tplId) => {
    if (title == null || title === '') return
    ;(raw[locale] ??= {})
    const prev = raw[locale][id]
    if (prev && prev.title !== title) {
      fail(
        `shared frame id '${id}' resolves to different ${locale} titles — ` +
          `'${prev.template}' → "${prev.title}" vs '${tplId}' → "${title}" (§TLO12)`,
      )
    } else if (!prev) {
      raw[locale][id] = { title, template: tplId }
    }
  }
  for (const tplId of TEMPLATE_IDS) {
    const framesRaw = canonicalFramesRaw(tplId)
    if (!framesRaw || framesRaw.length === 0) continue
    for (const f of framesRaw) record(BASE_LOCALE, f.id, f.label, tplId)
    for (const locale of NON_BASE) {
      if (!dictLocales.includes(locale)) continue
      const entry = frameDictEntries(locale, tplId)
      const m = new Map((entry?.ids ?? []).map((id, i) => [id, entry.values[i]]))
      for (const f of framesRaw) record(locale, f.id, m.get(f.id) ?? f.label, tplId)
    }
  }
}

// §TLO11 drift contract — the safe locale-switch (src/i18n/templateLabels/
// relabel.ts) keys ONLY on node id, so a node id shared by two templates must
// resolve to the SAME official label in every locale, or that id could never be
// switched. Fail loudly if a shared id diverges (EN canonical or any dict).
function checkSharedIdTargets() {
  const raw = {} // locale -> id -> { label, template }
  const record = (locale, id, label, tplId) => {
    if (label == null || label === '') return
    ;(raw[locale] ??= {})
    const prev = raw[locale][id]
    if (prev && prev.label !== label) {
      fail(
        `shared node id '${id}' resolves to different ${locale} labels — ` +
          `'${prev.template}' → "${prev.label}" vs '${tplId}' → "${label}" (§TLO11)`,
      )
    } else if (!prev) {
      raw[locale][id] = { label, template: tplId }
    }
  }
  for (const tplId of TEMPLATE_IDS) {
    const canon = canonicalLabels(tplId)
    if (canon.size === 0) continue
    for (const [id, enLabel] of canon) record(BASE_LOCALE, id, enLabel, tplId)
    for (const locale of NON_BASE) {
      if (!dictLocales.includes(locale)) continue
      const dictSrc = read(`src/i18n/templateLabels/${locale}.ts`)
      const block = new RegExp(`'${tplId}'\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(dictSrc)
      const entries = new Map(
        [
          ...(block?.[1] ?? '').matchAll(
            /^\s*([A-Za-z_$][\w$]*|'[^']+')\s*:\s*'([^']*)'/gm,
          ),
        ].map((m) => [m[1].replace(/'/g, ''), m[2]]),
      )
      for (const [id, enLabel] of canon) {
        record(locale, id, entries.get(id) ?? enLabel, tplId)
      }
    }
  }
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

checkSharedIdTargets()
checkFrameShapes()
checkFrameTranslations()
checkSharedFrameIdTargets()

// the overlay function must not translate anything but `label` — guard the
// source against an accidental `resourceType` / `expr` write in the apply loop
if (/\.data\s*(?:as[^)]*)?\)?\.(resourceType|expr|unit)\s*=/.test(overlaySrc)) {
  fail('src/i18n/templateLabels/index.ts writes a non-label field — overlay is label-only (§TLO-D4)')
}

// ── docs/localization.md §L4.5 — the static `known.generated.ts` seed that lets
// the §TLO11 relabel work with lazy per-locale dicts must be in sync with the
// template graphs + every dict. `--check` re-derives it in memory and diffs.
{
  const r = spawnSync(process.execPath, [resolve(root, 'scripts/gen-known-labels.mjs'), '--check'], {
    encoding: 'utf8',
  })
  if (r.status === 0) {
    ok('known.generated.ts is in sync')
  } else {
    fail((r.stdout + r.stderr).trim() || 'known.generated.ts is stale — run `npm run gen:known-labels`')
  }
}

// keep the void reference so an unused import never trips lint if edited later
void pathToFileURL

if (failed) {
  console.error('\ncheck-template-labels: FAILED')
  process.exit(1)
}
console.log('\ncheck-template-labels: ok')
