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
// And the vacuity lesson is kept too. The module label overlay had no English
// side — English is canonical and has no overlay — so a naive English side
// silently became `''` for the 19 module labels and every comparison against
// it passed while looking at nothing. The modules were removed in v0.29.0, but
// every row here still asserts its English side is non-empty BEFORE comparing.

import { describe, expect, it } from 'vitest'

import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import gachaGeneralDoc from '../../examples/gacha-general.json'
import gachaPickupDoc from '../../examples/gacha-pickup.json'
import gachaStandardDoc from '../../examples/gacha-standard.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import en from './locales/en'
import itCat from './locales/it'
import { it as itTpl, itFrames } from './templateLabels/it'

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
  // 2026-10 — the three gacha Templates added with the workbench redesign
  ['gacha-general', gachaGeneralDoc as GraphDocLike],
  ['gacha-standard', gachaStandardDoc as GraphDocLike],
  ['gacha-pickup', gachaPickupDoc as GraphDocLike],
]
// (the bundled modules `buffered-step` / `reward-split` and their label
// overlay were removed in v0.29.0 — File ▸ Save / Insert saved structure
// replaced them — so the module surface is gone)

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
    'mac', // the frame-move hint (issue #344)
  ]],
  ['file formats, units and metric tokens', [
    'csv', 'tsv', 'json', 'xlsx', 'kg', 'xp', 'p10', 'p50', 'p90', 'montecarloresult',
    'v1', 'v2', 'g1', 'mc', 'id', 'min', 'max', 'mmo',
    'erp', // 2026-10 — the Coffee roastery's example note
  ]],
  ['Monte Carlo — an Italian place name to begin with', ['monte', 'carlo']],
  // (`px`, `home`, `tab`, `windows`, `iphone`, `copyright` and `buffer` fired
  // only in the What's new notes and the module blurbs, both removed in v0.29.0)
  ['keyboard keys, as the OS prints them', ['ctrl', 'cmd', 'esc', 'alt', 'backspace']],
  ['loanwords Italian genuinely uses for these things', [
    'file', 'link', 'browser', 'desktop', 'server', 'offline', 'online', 'app', 'menu',
    'budget', 'benchmark', 'web', 'account', 'digest', 'repository', 'formula',
    'base', 'seed', 'item', 'drop',
  ]],
  ['gacha vocabulary kept in English — §L2.22 open item 4', [
    'pity', 'hard', 'pickup', 'premium', 'standard', 'banner', 'gacha', 'roll', 'lv',
    'ssr', 'sr',
    'pull', // 2026-10 — the gacha example notes write `pull` on both sides
  ]],
  ['canonical `resourceType` tokens, listed verbatim in a placeholder', [
    'gold', 'energy', 'player',
  ]],
  ['cognates that are the correct Italian word, not a leak', [
    'america',
    'zero', // 2026-10 — the Capacity deadlock's example note
  ]],
  // 2026-10 — `come` (Italian "as") in the Coffee roastery's example note,
  // spelled like an unrelated English word in the same source sentence
  ['Italian words that only look like an English word', ['come']],
  // issue #297 - the storage gate and the Storage and privacy area: `computer`
  // and `privacy` are the words Italian uses, `area` is Italian, Chrome and
  // HTML are names
  ['the storage gate (issue #297)', ['computer', 'privacy', 'area', 'chrome', 'html']],
  // issue #300 - password protection for share links: `password` is the word
  // Italian uses, HTTPS is a protocol name
  ['password protection for share links (issue #300)', ['password', 'https']],
  // issue #301 - the licence view: `open source`, `software` and `copyright`
  // are the words Italian uses for these things
  ['the third-party licence view (issue #301)', ['open', 'source', 'software']],
]

const DECLARED = new Set(SURVIVING.flatMap(([, ws]) => ws))

// ------------------------------------------------ identical to English
/** EXACT key AND value. A count would hide a swap between two rows; the pairs
 *  do not. MEASURED, then pinned. */
const IDENTICAL_TO_EN: ReadonlyArray<readonly [string, string]> = [
  ['catalog toolbar.buildTitle', 'Loop Studio v{version} · build {sha}'],
  ['catalog toolbar.file.button', 'File'],
  ['catalog toolbar.file.menuLabel', 'File'],
  ['catalog theme.auto', 'Auto'],
  ['catalog theme.option.system', 'Auto'],
  ['catalog playbar.seed', 'Seed'], // 2026-10: English capitalised it (`seed` → `Seed`)
  ['catalog playbar.mc', 'Monte Carlo'],
  ['catalog playbar.mc.withNote', 'Monte Carlo · {note}'],
  ['catalog playbar.mc.progress', 'Monte Carlo {pct}%'],
  ['catalog timeline.csv', 'CSV'],
  ['catalog revChip.rev', 'rev {id}'],
  ['catalog mc.title', 'Monte Carlo'],
  ['catalog review.field.base', 'base'],
  ['catalog share.protect.password', 'Password'], // issue #300: the Italian word
  ['catalog dist.seed', 'seed'],
  ['catalog tour.nav.position', '{n} / {total}'],
  // issue #308 - the step announcement, worded with the same full stops
  ['catalog tour.nav.announce', '{n} / {total}. {title}. {body}'],
  ['catalog help.contextual.hint.mc.name', 'Monte Carlo'],
  ['catalog canvas.frame.areaName', 'Area {n}'],
  ['catalog inspector.edge.flowPlaceholder', '1, all, 2D6, 1-3, 25%'],
  ['catalog inspector.edge.flowParam.resolved', '= {value}'],
  ['catalog inspector.ends.summary', '{from} → {to}'], // §ER18: the Ends group's summary, two names and an arrow
  ['catalog inspector.expr.activatorPlaceholder', '>= 5'],
  ['catalog inspector.expr.labelPlaceholder', '+1   ·   -2   ·   =S'],
  ['catalog regExpr.row.generic', '— {code}'],
  ['catalog import.qs.mapping', 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}'],
  // 2026-10 — the workbench redesign: the Gate panel's three number formats,
  // the Run menu's Monte Carlo item and the zoom control (`Zoom` is the word
  // Italian uses)
  ['catalog rel.gate.weight', '{w, number}'],
  ['catalog rel.gate.chance', '{chance, number, ::percent .#}'],
  ['catalog rel.gate.chanceBelow', '< {min, number, ::percent .#}'],
  ['catalog workbench.run.mc', 'Monte Carlo…'],
  ['catalog workbench.zoom.level', 'Zoom'],
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
  // 2026-10 — the same kept gacha terms in the three new gacha Templates
  ['template/gacha-general roll', 'Roll'],
  ['template/gacha-standard roll', 'Roll'],
  ['template/gacha-standard pity', 'Pity'],
  ['template/gacha-pickup roll', 'Roll'],
  ['template/gacha-pickup pity', 'Pity'],
]

// ------------------------------------------------------------------ shape
describe('it copy — the surfaces exist and are complete', () => {
  it('has exactly the base key set', () => {
    expect(KEYS).toHaveLength(1200) // #420 item 3: +19 (recovery.*, autosave.failed.held, storage.switch.unreadable / readFailed); #420 follow-up: +4 (review.gate.invalidTarget / invalidContent, review.openDoc.replace.title / body); #420 PR B: +2 (revision.export.unknownKind / invalidContent); #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title); #417: −2 (toolbar.settings.button / menuLabel, the removed SettingsMenu); #392: +1 (import.error.badNode); 2026-10 restore: +16 (the `language.*` names of the restored locales); 0.29.0 workbench redesign: +158 −148 (docs/localization.md §L2.0a); 0.28.4: +3 (the three release-note lines); 0.28.3: +4 (the four release-note lines); 0.28.2: +3 (the three release-note lines); 0.28.1: +4 (the four release-note lines); 0.28.0: +3 (the three release-note lines); §ER19 Reverse: +13 (inspector.ends.reverse.*); §ER18 grips: +2 (inspector.ends.noGrip.source / target); 0.27.0: +3 (the three release-note lines); the connection Ends group (docs/edge-routing.md §ER18): +24 (inspector.ends.*, canvas.endGrip.source / target); 0.26.2: +4 (the four release-note lines); 0.26.0: +5 (the five release-note lines); the node structure: +1 (inspector.field.currentAmount, the Pool's read-only current amount); issue #344: +2 (the 0.25.0 release note is five lines, was three); issue #344 Step 3: +9 (the connection shape and bend-point strings and the keyboard bend notice); issue #344 Step 1: +3 (three 0.25.0 release-note lines); issue #344 Step 1: +1 (canvas.tidy, the Tidy to grid rail button); issue #330 PR 3: +3 (three 0.24.0 release-note lines); issue #330 PR 3: +9 (the phone Playback speed sheet); issue #330 PR 2: +3 (three 0.23.0 release-note lines); issue #330 PR 1: +5 (five 0.22.0 release-note lines); issue #301 decision 1: +4 (share.unavailable and the three 0.17.1 release-note lines); the session chip: +3 (the three 0.17.2 release-note lines); the licence screen: +12 (nine strings of the view and the three 0.18.0 release-note lines); the menu keyboard: +3 (the three 0.18.1 release-note lines); the tour announcement: +4 (tour.nav.announce and the three 0.18.2 release-note lines); the flow colour: +20 (the sixteen strings of the Colour section and the four 0.19.0 release-note lines); the flow colour views: +4 (the four 0.20.0 release-note lines); compact nodes: +3 (the three 0.21.0 release-note lines); Focus dimming: +3 (the three 0.21.1 release-note lines); value rows: +3 (the three 0.21.2 release-note lines); the edit lock: +4 (canvas.lock.name, its fixed accessible name, and the three 0.21.3 release-note lines); the locked rail and the phone search: +4 (the four 0.21.4 release-note lines)
    expect(Object.keys(IT).sort()).toEqual([...KEYS].sort())
  })

  it('covers all three runtime surfaces, at the measured sizes', () => {
    const per: Record<string, number> = {}
    for (const r of RUNTIME) per[r.surface.split('/')[0]!] = (per[r.surface.split('/')[0]!] ?? 0) + 1
    // 2026-10 — the five older Templates are still 196 labels and 7 frames; the
    // three new gacha Templates add 17 + 21 + 31 labels and 0 + 1 + 2 frames;
    // the 19 module labels left with the modules (v0.29.0)
    expect(per).toEqual({ catalog: 1200, template: 265, frame: 10 }) // #420 item 3: +19; #420 follow-up: +4; #420 PR B: +2; #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title); #417: −2 (toolbar.settings.*); #392: +1 (import.error.badNode)
    expect(RUNTIME).toHaveLength(1475) // #420 item 3: +19; #420 follow-up: +4; #420 PR B: +2; #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title)
  })

  it('EVERY row has a non-empty ENGLISH side — the vacuity guard', () => {
    // An overlay with no English side (as the removed module overlay was)
    // silently becomes '' and every comparison below passes over nothing.
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
  it('every runtime string is NFC, on all three surfaces', () => {
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

  // issue #308: 39 -> 40 (tour.nav.announce)
  it('the declared set is what it claims — 51 pairs, no duplicate key', () => {
    expect(IDENTICAL_TO_EN).toHaveLength(51) // 2026-10: +10 (five catalog keys, five gacha Template labels); §ER18: +1 (inspector.ends.summary)
    expect(new Set(IDENTICAL_TO_EN.map(([k]) => k)).size).toBe(51)
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
describe('it copy — one Italian word per concept, across all three surfaces', () => {
  /** [English concept, how it appears in English, the ONE Italian word]. The
   *  Italian side is a STEM where the word inflects, as `Parametr` always was:
   *  the 2026-10 strings are the first to use the plurals `Ripartitori`,
   *  `Convertitori` and `Valori calcolati`. */
  const GLOSSARY: ReadonlyArray<readonly [string, RegExp, string | RegExp]> = [
    ['Pool', /(^|[^A-Za-z])Pools?([^A-Za-z]|$)/, 'Serbatoi'],
    ['Source (the node kind)', /(^|[^A-Za-z])Source([^A-Za-z]|$)/, 'Sorgente'],
    ['Drain', /(^|[^A-Za-z])Drains?([^A-Za-z]|$)/, 'Scarico'],
    ['Gate', /(^|[^A-Za-z])Gates?([^A-Za-z]|$)/, 'Ripartitor'],
    ['Converter', /(^|[^A-Za-z])Converters?([^A-Za-z]|$)/, 'Convertitor'],
    ['Parameter', /(^|[^A-Za-z])Parameters?([^A-Za-z]|$)/, 'Parametr'],
    ['Register', /(^|[^A-Za-z])Registers?([^A-Za-z]|$)/, /valor[ei] calcolat[oi]/i],
  ]

  for (const [concept, enRe, itWord] of GLOSSARY) {
    it(`${concept} is always "${itWord}"`, () => {
      const has = (s: string) =>
        typeof itWord === 'string' ? s.toLowerCase().includes(itWord.toLowerCase()) : itWord.test(s)
      const missing = RUNTIME.filter((r) => enRe.test(r.en))
        .filter((r) => !has(r.it))
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
