// docs/localization.md §L2.22 — the Italian copy contract.
//
// WHY THIS FILE HAS A DIFFERENT SHAPE FROM `viCopy.test.ts`.
//
// Vietnamese was the first Latin-script locale, and its guard declared every
// ASCII word the translation keeps — workable there because Vietnamese is
// diacritic-dense, so a pure-ASCII run is unusual enough to enumerate (688
// words, scoped to a declared vocabulary).
//
// Italian is written almost entirely in ASCII. MEASURED on this catalog: 1,292
// distinct ASCII words. Declaring them would mean declaring the language, and
// a guard that lists the whole vocabulary asserts nothing.
//
// The shape that DOES work between two Latin languages is a per-key WORD
// INTERSECTION with the English source. A word that survives translation
// completely unchanged is one of four things — a proper noun, a unit or format
// token, a deliberate loanword, or an untranslated leak — and the first three
// are finite and declarable while the fourth is the defect. MEASURED before
// this file was written: 78 distinct words over 340 (word, key) pairs, which
// is a set a reader can actually check.
//
// The whole-value contract from the Vietnamese arc is kept as-is: an exact
// key-AND-value set of everything identical to English. A COUNT would hide a
// swap; the pairs do not.
//
// And the vacuity lesson is kept too. `moduleLabelOverlay(id, 'en')` returns
// undefined — English is canonical and has no overlay — so a naive English
// side silently becomes `''` for the 19 module labels and every comparison
// against it passes while looking at nothing. Every row here asserts its
// English side is non-empty BEFORE comparing.

import { describe, expect, it } from 'vitest'

import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import bufferedStepDoc from '../../examples/module-buffered-step.json'
import rewardSplitDoc from '../../examples/module-reward-split.json'
import en from './locales/en'
import itCat from './locales/it'
import { it as itTpl, itFrames } from './templateLabels/it'
import { moduleLabelOverlay } from './moduleLabels'

const EN = en as unknown as Record<string, string>
const IT = itCat as unknown as Record<string, string>
const KEYS = Object.keys(EN)

type GraphDocLike = {
  nodes?: { id: string; data?: { label?: string } }[]
  frames?: { id: string; label?: string }[]
}

const TEMPLATES: ReadonlyArray<readonly [string, GraphDocLike]> = [
  ['equilibrium', equilibriumDoc as GraphDocLike],
  ['deadlock', deadlockDoc as GraphDocLike],
  ['coffee-roastery', coffeeRoasteryDoc as GraphDocLike],
  ['mmo-progression', mmoProgressionDoc as GraphDocLike],
  ['gacha-banner-zones', gachaBannerZonesDoc as GraphDocLike],
]
const MODULES: ReadonlyArray<readonly [string, GraphDocLike]> = [
  ['buffered-step', bufferedStepDoc as GraphDocLike],
  ['reward-split', rewardSplitDoc as GraphDocLike],
]

type Row = { surface: string; key: string; en: string; it: string }

/** Every runtime string the reader can see, with BOTH sides. */
const RUNTIME: Row[] = []
for (const k of KEYS) RUNTIME.push({ surface: 'catalog', key: k, en: EN[k]!, it: IT[k]! })
for (const [t, g] of TEMPLATES) {
  for (const n of g.nodes ?? []) {
    const label = n.data?.label
    if (label && itTpl[t]?.[n.id]) RUNTIME.push({ surface: `template/${t}`, key: n.id, en: label, it: itTpl[t]![n.id]! })
  }
  for (const fr of g.frames ?? []) {
    if (fr.label && itFrames[t]?.[fr.id]) RUNTIME.push({ surface: `frame/${t}`, key: fr.id, en: fr.label, it: itFrames[t]![fr.id]! })
  }
}
for (const [m, g] of MODULES) {
  const ov = moduleLabelOverlay(m, 'it')
  for (const n of g.nodes ?? []) {
    const label = n.data?.label
    if (label && ov?.[n.id]) RUNTIME.push({ surface: `module/${m}`, key: n.id, en: label, it: ov[n.id]! })
  }
}

// ---------------------------------------------------------------- tokenizer
/** Drop ICU MACHINERY but keep ICU TEXT: the argument header (`{n, plural,`),
 *  the arm selectors (`one {`, `many {`, `=0 {`), the `#` placeholder and the
 *  plain `{slot}` references all go; the words inside the arms stay, because
 *  they are what the reader sees. */
function stripIcu(s: string): string {
  return s
    .replace(/\{\s*[\w.]+\s*,\s*(?:plural|selectordinal|select|number|date|time)\s*,/g, ' ')
    .replace(/(?:^|[\s{}])(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/[{}#]/g, ' ')
}

const wordsOf = (s: string): Set<string> =>
  new Set([...stripIcu(s).matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*/gu)].map((m) => m[0].toLowerCase()))

/** Two-letter-or-shorter function words and articles that are the same string
 *  in both languages by coincidence, never by translation. Excluded from the
 *  intersection because they carry no evidence either way. */
const NEUTRAL = new Set([
  'a', 'e', 'i', 'o', 'in', 'la', 'le', 'il', 'di', 'da', 'un', 'no', 'non', 'per', 'con', 'al',
  'and', 'the', 'to', 'of', 'on', 'is', 'it', 'as', 'or', 'an', 'at', 'by', 'be', 'so',
])

// ------------------------------------------------- what survives, and why
/** Every word that appears UNCHANGED on both sides of a translated string,
 *  with the reason it is allowed to. Exhaustive: a word not listed here fails.
 *
 *  Grouped so the reasons stay legible, and the groups are asserted disjoint
 *  so a word cannot be quietly justified twice. */
const SURVIVING: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['product and company names, never translated', [
    'loop', 'studio', 'github', 'google', 'sheets', 'excel', 'numbers', 'machinations', 'io', 'alex',
  ]],
  ['file formats, units and metric tokens', [
    'csv', 'tsv', 'json', 'xlsx', 'kg', 'xp', 'p10', 'p50', 'p90', 'montecarloresult',
    'v1', 'v2', 'g1', 'mc', 'id', 'min', 'max', 'mmo',
  ]],
  ['Monte Carlo — an Italian place name to begin with', ['monte', 'carlo']],
  ['keyboard keys, as the OS prints them', ['ctrl', 'cmd', 'esc', 'alt', 'backspace']],
  ['loanwords Italian genuinely uses for these things', [
    'file', 'link', 'browser', 'desktop', 'server', 'offline', 'online', 'app', 'menu',
    'budget', 'buffer', 'benchmark', 'web', 'account', 'digest', 'repository', 'formula',
    'base', 'seed', 'item', 'drop',
  ]],
  ['gacha vocabulary kept in English — §L2.22 open item 4', [
    'pity', 'hard', 'pickup', 'premium', 'standard', 'banner', 'gacha', 'roll', 'lv',
    'ssr', 'sr',
  ]],
  ['canonical `resourceType` tokens, listed verbatim in a placeholder', [
    'gold', 'energy', 'player',
  ]],
  ['cognates that are the correct Italian word, not a leak', ['america']],
]

const DECLARED = new Set(SURVIVING.flatMap(([, ws]) => ws))

// ------------------------------------------------ identical to English
/** EXACT key AND value. A count would hide a swap between two rows; the pairs
 *  do not. MEASURED, then pinned. */
const IDENTICAL_TO_EN: ReadonlyArray<readonly [string, string]> = [
  ['catalog toolbar.buildTitle', 'Loop Studio v{version} · build {sha}'],
  ['catalog toolbar.file.button', 'File ▾'],
  ['catalog toolbar.file.menuLabel', 'File'],
  ['catalog theme.auto', '◐ Auto'],
  ['catalog theme.option.system', 'Auto'],
  ['catalog playbar.seed', 'seed'],
  ['catalog playbar.mc', 'Monte Carlo'],
  ['catalog playbar.mc.withNote', 'Monte Carlo · {note}'],
  ['catalog playbar.mc.progress', 'Monte Carlo {pct}%'],
  ['catalog timeline.csv', 'CSV'],
  ['catalog revChip.rev', 'rev {id}'],
  ['catalog mc.title', 'Monte Carlo'],
  ['catalog review.field.base', 'base'],
  ['catalog dist.seed', 'seed'],
  ['catalog tour.nav.position', '{n} / {total}'],
  ['catalog help.contextual.hint.mc.name', 'Monte Carlo'],
  ['catalog canvas.frame.areaName', 'Area {n}'],
  ['catalog inspector.edge.flowPlaceholder', '1, all, 2D6, 1-3, 25%'],
  ['catalog inspector.edge.flowParam.resolved', '= {value}'],
  ['catalog inspector.expr.activatorPlaceholder', '>= 5'],
  ['catalog inspector.expr.labelPlaceholder', '+1   ·   -2   ·   =S'],
  ['catalog regExpr.row.generic', '— {code}'],
  ['catalog import.qs.mapping', 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}'],
  ['template/mmo-progression xp', 'XP'],
  ['template/gacha-banner-zones roll_gate_free', 'Roll'],
  ['template/gacha-banner-zones ssr_hit_free', 'SSR'],
  ['template/gacha-banner-zones sr_hit_free', 'SR'],
  ['template/gacha-banner-zones r_hit_free', 'R'],
  ['template/gacha-banner-zones roll_gate_standard', 'Roll'],
  ['template/gacha-banner-zones ssr_hit_standard', 'SSR'],
  ['template/gacha-banner-zones sr_hit_standard', 'SR'],
  ['template/gacha-banner-zones r_hit_standard', 'R'],
  ['template/gacha-banner-zones pity_standard', 'Pity'],
  ['template/gacha-banner-zones pity_pickup', 'Pity'],
  ['template/gacha-banner-zones sr_hit_pickup', 'SR'],
  ['template/gacha-banner-zones r_hit_pickup', 'R'],
  ['frame/gacha-banner-zones zone_standard', 'Premium Standard'],
  ['frame/gacha-banner-zones zone_pickup', 'Premium Pickup'],
]

// ------------------------------------------------------------------ shape
describe('it copy — the surfaces exist and are complete', () => {
  it('has exactly the base key set', () => {
    expect(KEYS).toHaveLength(850)
    expect(Object.keys(IT).sort()).toEqual([...KEYS].sort())
  })

  it('covers all four runtime surfaces, at the measured sizes', () => {
    const per: Record<string, number> = {}
    for (const r of RUNTIME) per[r.surface.split('/')[0]!] = (per[r.surface.split('/')[0]!] ?? 0) + 1
    expect(per).toEqual({ catalog: 850, template: 196, frame: 7, module: 19 })
    expect(RUNTIME).toHaveLength(1072)
  })

  it('EVERY row has a non-empty ENGLISH side — the vacuity guard', () => {
    // `moduleLabelOverlay(id, 'en')` is undefined, so an English side read that
    // way silently becomes '' and every comparison below passes over nothing.
    // The Vietnamese arc shipped that bug with green shape assertions.
    const empty = RUNTIME.filter((r) => !r.en.trim()).map((r) => `${r.surface} ${r.key}`)
    expect(empty, 'a row with no English side compares against nothing').toEqual([])
  })

  it('EVERY row has a non-empty Italian side', () => {
    const empty = RUNTIME.filter((r) => !r.it.trim()).map((r) => `${r.surface} ${r.key}`)
    expect(empty).toEqual([])
  })
})

// -------------------------------------------------------------------- NFC
describe('it copy — normalisation', () => {
  it('every runtime string is NFC, on all four surfaces', () => {
    const bad = RUNTIME.filter((r) => r.it.normalize('NFC') !== r.it).map((r) => `${r.surface} ${r.key}`)
    expect(bad, 'Italian accents must be precomposed').toEqual([])
  })

  it('uses the typographic apostrophe, never the ASCII one, in prose', () => {
    // Italian elides constantly (`l'espressione`), so the apostrophe shows up
    // in roughly a third of the catalog. Mixing U+2019 and U+0027 would be
    // visible in the product, so it is pinned rather than left to chance.
    const bad = RUNTIME.filter((r) => /\w'\w/.test(r.it)).map((r) => `${r.surface} ${r.key}: ${r.it}`)
    expect(bad, 'use U+2019, not U+0027').toEqual([])
  })
})

// ----------------------------------------------------------------- plural
describe('it copy — the three-arm plural', () => {
  const plurals = RUNTIME.filter((r) => r.it.includes(', plural,'))

  it('the catalog actually has plural messages to check', () => {
    expect(plurals.length).toBeGreaterThan(10)
  })

  it('every plural message writes one, many AND other — never English two-arm', () => {
    // `Intl.PluralRules('it').resolvedOptions().pluralCategories` is
    // ['one','many','other']. `many` selects a non-zero integer multiple of
    // 1,000,000 and nothing else, so it is unreachable through this product's
    // own limits — but a missing arm is a silent fallthrough, and the English
    // source has no `many` at all, so copying its shape is the likely mistake.
    const missing: string[] = []
    for (const r of plurals) {
      for (const arm of [' one {', ' many {', ' other {']) {
        if (!r.it.includes(arm)) missing.push(`${r.surface} ${r.key}: no${arm.trim()} arm`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the declared categories are exactly what Intl says', () => {
    expect([...new Intl.PluralRules('it').resolvedOptions().pluralCategories].sort()).toEqual([
      'many', 'one', 'other',
    ])
  })

  it('`many` fires where it was measured to, through Intl itself', () => {
    const pr = new Intl.PluralRules('it')
    expect(pr.select(1)).toBe('one')
    expect(pr.select(0)).toBe('other')
    expect(pr.select(999_999)).toBe('other')
    expect(pr.select(1_000_000)).toBe('many')
    expect(pr.select(1_000_001)).toBe('other')
    expect(pr.select(2_000_000)).toBe('many')
  })
})

// --------------------------------------------------- identical to English
describe('it copy — what is identical to English, exactly', () => {
  const actual = RUNTIME.filter((r) => r.en === r.it).map((r) => [`${r.surface} ${r.key}`, r.it] as const)

  it('is exactly the declared key/value set', () => {
    expect([...actual].sort()).toEqual([...IDENTICAL_TO_EN].sort())
  })

  it('the declared set is what it claims — 38 pairs, no duplicate key', () => {
    expect(IDENTICAL_TO_EN).toHaveLength(38)
    expect(new Set(IDENTICAL_TO_EN.map(([k]) => k)).size).toBe(38)
  })
})

// ---------------------------------------------- the word intersection
describe('it copy — every word that survives EN → IT unchanged is declared', () => {
  const surviving = new Map<string, string[]>()
  for (const r of RUNTIME) {
    if (r.en === r.it) continue // covered by its own contract above
    const ew = wordsOf(r.en)
    for (const w of wordsOf(r.it)) {
      if (!ew.has(w) || NEUTRAL.has(w) || w.length < 2) continue
      if (!surviving.has(w)) surviving.set(w, [])
      surviving.get(w)!.push(`${r.surface} ${r.key}`)
    }
  }

  it('the intersection is non-empty — the tokenizer is doing something', () => {
    expect(surviving.size).toBeGreaterThan(20)
  })

  it('no word survives that is not declared with a reason', () => {
    const undeclared = [...surviving.entries()]
      .filter(([w]) => !DECLARED.has(w))
      .map(([w, keys]) => `${w} (${keys.length}) e.g. ${keys[0]}`)
    expect(undeclared, 'an undeclared survivor is an untranslated English word').toEqual([])
  })

  it('no declared word is dead — every one is actually load-bearing', () => {
    const dead = [...DECLARED].filter((w) => !surviving.has(w))
    expect(dead, 'a declared word that never fires is stale').toEqual([])
  })

  it('the reason groups are disjoint, so nothing is justified twice', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const [, ws] of SURVIVING) {
      for (const w of ws) {
        if (seen.has(w)) dupes.push(w)
        seen.add(w)
      }
    }
    expect(dupes).toEqual([])
  })
})

// --------------------------------------------------------------- glossary
describe('it copy — one Italian word per concept, across all four surfaces', () => {
  /** [English concept, how it appears in English, the ONE Italian word] */
  const GLOSSARY: ReadonlyArray<readonly [string, RegExp, string]> = [
    ['Pool', /(^|[^A-Za-z])Pools?([^A-Za-z]|$)/, 'Serbatoi'],
    ['Source (the node kind)', /(^|[^A-Za-z])Source([^A-Za-z]|$)/, 'Sorgente'],
    ['Drain', /(^|[^A-Za-z])Drains?([^A-Za-z]|$)/, 'Scarico'],
    ['Gate', /(^|[^A-Za-z])Gates?([^A-Za-z]|$)/, 'Ripartitore'],
    ['Converter', /(^|[^A-Za-z])Converters?([^A-Za-z]|$)/, 'Convertitore'],
    ['Parameter', /(^|[^A-Za-z])Parameters?([^A-Za-z]|$)/, 'Parametr'],
    ['Register', /(^|[^A-Za-z])Registers?([^A-Za-z]|$)/, 'Valore calcolato'],
  ]

  for (const [concept, enRe, itWord] of GLOSSARY) {
    it(`${concept} is always "${itWord}"`, () => {
      const missing = RUNTIME.filter((r) => enRe.test(r.en))
        .filter((r) => !r.it.toLowerCase().includes(itWord.toLowerCase()))
        .map((r) => `${r.surface} ${r.key}: ${r.it}`)
      expect(missing, `${concept} must read "${itWord}" everywhere`).toEqual([])
    })
  }

  it('Register is never "Registro" — it stores nothing', () => {
    const bad = RUNTIME.filter((r) => /\bRegistr[oi]\b/.test(r.it)).map((r) => `${r.surface} ${r.key}`)
    expect(bad, '`Registro` is a ledger and implies storage').toEqual([])
  })

  it('Gate is never "Cancello" — that is a door, and a port', () => {
    const bad = RUNTIME.filter((r) => /\bCancell[oi]\b/i.test(r.it)).map((r) => `${r.surface} ${r.key}`)
    expect(bad).toEqual([])
  })

  it('the five English-kept gacha terms are still English, by key', () => {
    // The word intersection CANNOT see `Pull`: English writes `Pulls per zone`
    // and Italian `Pull per zona`, so the tokens differ (`pulls` vs `pull`) and
    // nothing survives unchanged. Pinning the keys is what actually holds the
    // §L2.22 open-item-4 decision in place, and it goes red the day somebody
    // translates one of them without deciding to.
    const KEPT: ReadonlyArray<readonly [string, RegExp]> = [
      ['template/gacha-banner-zones pulls_per_zone', /^Pull\b/],
      ['template/gacha-banner-zones pulls_made_free', /^Pull\b/],
      ['template/gacha-banner-zones pity_standard', /^Pity$/],
      ['template/gacha-banner-zones zone2_standard_hard_pity', /Hard pity/],
      ['template/gacha-banner-zones roll_gate_free', /^Roll$/],
      ['frame/gacha-banner-zones zone_pickup', /Pickup/],
      ['catalog templates.gachaBannerZones.name', /\bbanner\b/],
    ]
    const wrong: string[] = []
    for (const [id, re] of KEPT) {
      const row = RUNTIME.find((r) => `${r.surface} ${r.key}` === id)
      expect(row, `${id} must exist — this list goes stale otherwise`).toBeDefined()
      if (row && !re.test(row.it)) wrong.push(`${id}: ${row.it}`)
    }
    expect(wrong, 'these stay English until a native reader says otherwise').toEqual([])
  })

  it('Canvas and Workspace never collide', () => {
    // `area di disegno` is the canvas; `spazio di lavoro` is the workspace.
    // One word for both would make the export dialog unreadable.
    const canvasRows = RUNTIME.filter((r) => /\bcanvas\b/i.test(r.en))
    expect(canvasRows.length).toBeGreaterThan(10)
    const wrong = canvasRows.filter((r) => !/area di disegno/i.test(r.it)).map((r) => `${r.surface} ${r.key}: ${r.it}`)
    expect(wrong).toEqual([])

    const wsRows = RUNTIME.filter((r) => /\bworkspace\b/i.test(r.en))
    expect(wsRows.length).toBeGreaterThan(4)
    const wsWrong = wsRows.filter((r) => !/spazio di lavoro/i.test(r.it)).map((r) => `${r.surface} ${r.key}: ${r.it}`)
    expect(wsWrong).toEqual([])
  })
})
