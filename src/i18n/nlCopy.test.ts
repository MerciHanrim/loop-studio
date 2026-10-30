// docs/localization.md §L2.23 — the Dutch copy contract.
//
// SAME SHAPE AS `itCopy.test.ts`, WITH ONE HONEST CAVEAT.
//
// Italian needed a per-key WORD INTERSECTION with English because Italian is
// written almost entirely in ASCII, so no character class can see untranslated
// English. Dutch has the same problem and one more: Dutch and English are both
// West Germanic, so a word surviving translation unchanged is much weaker
// evidence here than it was there. MEASURED on this catalog: 141 distinct
// words over 531 (word, key) pairs, against Italian's 78 over 340 — and on
// review every one of the 141 is a product token, a proper noun, a declared
// loanword, or a Dutch word that is simply spelled the way English spells it
// (`water`, `moment`, `per`, `open`, `rest`).
//
// So this guard is REAL but LESS DISCRIMINATING than the Italian one, and the
// EN<->NL read-back of all 1,073 pairs is what actually carries the weight
// here. That is recorded rather than glossed over: a guard that goes green can
// mean the guard is blind, not that the catalog is clean.
//
// The whole-value contract from the Vietnamese arc is kept: an exact
// key-AND-value set of everything identical to English. A COUNT would hide a
// swap; the pairs do not. Dutch has 60 of them where Italian had 38, for the
// same Germanic reason.
//
// And the vacuity lesson is kept. The module label overlay had no English
// side — English is canonical and has no overlay — so a naive English side
// silently became `''` for the 19 module labels and every comparison against
// it passed while looking at nothing. The modules were removed in v0.29.0, but
// every row still asserts its English side is non-empty BEFORE comparing.

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
import nlCat from './locales/nl'
import { nl as nlTpl, nlFrames } from './templateLabels/nl'

const EN = en as unknown as Record<string, string>
const NL = nlCat as unknown as Record<string, string>
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

type Row = { surface: string; key: string; en: string; nl: string }

/** Every runtime string the reader can see, with BOTH sides. */
const RUNTIME: Row[] = []
for (const k of KEYS) RUNTIME.push({ surface: 'catalog', key: k, en: EN[k]!, nl: NL[k]! })
for (const [t, g] of TEMPLATES) {
  for (const n of g.nodes ?? []) {
    const label = n.data?.label
    if (label && nlTpl[t]?.[n.id]) RUNTIME.push({ surface: `template/${t}`, key: n.id, en: label, nl: nlTpl[t]![n.id]! })
  }
  for (const fr of g.frames ?? []) {
    if (fr.label && nlFrames[t]?.[fr.id]) RUNTIME.push({ surface: `frame/${t}`, key: fr.id, en: fr.label, nl: nlFrames[t]![fr.id]! })
  }
}

// ---------------------------------------------------------------- tokenizer
/** Drop ICU MACHINERY but keep ICU TEXT: the argument header (`{n, plural,`),
 *  the arm selectors (`one {`, `other {`, `=0 {`), the `#` placeholder and the
 *  plain `{slot}` references all go; the words inside the arms stay, because
 *  they are what the reader sees. */
function stripIcu(s: string): string {
  return s
    // a number format WITH a style (`{chance, number, ::percent .#}`, new with
    // the 2026-10 Gate panel) is machinery as a whole, its style included
    .replace(/\{\s*[\w.]+\s*,\s*(?:number|date|time)\s*,[^{}]*\}/g, ' ')
    .replace(/\{\s*[\w.]+\s*,\s*(?:plural|selectordinal|select|number|date|time)\s*,/g, ' ')
    .replace(/(?:^|[\s{}])(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/[{}#]/g, ' ')
}

const wordsOf = (s: string): Set<string> =>
  new Set([...stripIcu(s).matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*/gu)].map((m) => m[0].toLowerCase()))

/** Short function words and articles that are the same string in both
 *  languages by coincidence, never by translation. Excluded from the
 *  intersection because they carry no evidence either way. */
const NEUTRAL = new Set([
  'a', 'e', 'i', 'o', 'in', 'de', 'het', 'een', 'van', 'te', 'er', 'of', 'en', 'op', 'als', 'om',
  'and', 'the', 'to', 'of', 'on', 'is', 'it', 'as', 'or', 'an', 'at', 'by', 'be', 'so',
])

// ------------------------------------------------- what survives, and why
/** Every word that appears UNCHANGED on both sides of a translated string,
 *  with the reason it is allowed to. Exhaustive: a word not listed here fails.
 *
 *  Grouped so the reasons stay legible, and the groups are asserted disjoint
 *  so a word cannot be quietly justified twice. */
const SURVIVING: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['product, company and place names, never translated', [
    'loop', 'studio', 'github', 'google', 'excel', 'numbers', 'machinations', 'io', 'alex',
    'inspector', 'portugal', 'thai',
    'mac', // the frame-move hint (issue #344)
  ]],
  ['file formats, units, metrics and version tokens', [
    'csv', 'tsv', 'json', 'xlsx', 'kg', 'xp', 'p10', 'p50', 'p90', 'montecarloresult',
    'v', 'v1', 'v2', 'g1', 'mc', 'id', 'min', 'max', 'rev', 'build', 'mmo', 'gacha',
    'erp', // 2026-10 — the Coffee roastery's example note
  ]],
  ['Monte Carlo — a place name to begin with', ['monte', 'carlo']],
  // (`px`, `windows`, `iphone`, `contrast`, `home` and `end` fired only in the
  // What's new notes, and `module` only in the module strings — both removed
  // in v0.29.0)
  ['keyboard keys and axis letters, as the OS and the UI print them', [
    'ctrl', 'cmd', 'esc', 'escape', 'alt', 'backspace', 'enter', 'shift', 'delete', 'tab',
    'n', 'x', 'y', 'z', 'lv',
  ]],
  // The engine's own mini-language. `inspector.edge.flowPlaceholder` shows
  // what may be TYPED into the flow field, so translating any of it would
  // print syntax the parser rejects. The first draft of this catalog rendered
  // `all` as `alles`; that is the defect this group exists to prevent.
  ['flow / expression mini-language literals, byte-identical to `en`', [
    'all', 'd6', 's', 'r',
  ]],
  // The CSV column headers in the worked example are DATA the reader retypes.
  ['the worked example spreadsheet headers', [
    'item_id', 'item_name', 'price', 'drop_rate',
  ]],
  // `inspector.resourceType.placeholder` lists BUILTIN_RESOURCE_TYPES, which
  // the model matches byte-equal — translating one tells the reader to type a
  // value the product will not recognise. `xp` and `item` are declared
  // elsewhere for their own reasons; these three exist ONLY here.
  // `localeSurfaceCopy.test.ts` holds every catalog to the same tokens.
  ['canonical `resourceType` tokens, matched byte-equal by the model', [
    'gold', 'energy', 'player',
  ]],
  // The approved contract keeps these English: no authoritative Dutch games
  // usage exists, and a cross-locale majority is not evidence. `level` is the
  // register Dutch players actually use; `drops`, `quest(s)` and `item(s)` are
  // settled loans used as Dutch nouns. All are open review items in §L2.23.
  ['gacha and games vocabulary kept English by the approved contract', [
    'pity', 'hard', 'pickup', 'pulls', 'roll', 'banners', 'ssr', 'sr',
    'drop', 'drops', 'quest', 'quests', 'item', 'items', 'level', 'premium',
    // 2026-10 — the singular / plural forms the gacha and Early MMO example
    // notes and the new gacha Template blurbs add
    'banner', 'pull', 'ticket', 'levels',
  ]],
  // `run` is the load-bearing one: the native Dutch cognate of "run" is
  // `loop`, which is the PRODUCT NAME, so `de Lauf` / `it esecuzione` have no
  // usable Dutch counterpart. Kept as the loan Dutch technical writing uses.
  ['loanwords Dutch genuinely uses for these things', [
    'run', 'runs', 'seed', 'link', 'browser', 'server', 'desktop', 'offline', 'online',
    'app', 'live', 'menu', 'update', 'upload', 'feedback', 'account', 'benchmark',
    'budget', 'workers', 'engine', 'digest', 'timing', 'spreadsheet', 'exports',
    'import', 'help', 'hint', 'cupping', 'tickets', 'training',
  ]],
  // Not loans at all — ordinary Dutch words that happen to be spelled the way
  // English spells them. This group is why the intersection is weaker evidence
  // in Dutch than it was in Italian, and it is kept separate to say so.
  ['ordinary Dutch words spelled the same as English', [
    'parameter', 'parameters', 'project', 'document', 'model', 'label', 'labels',
    'focus', 'filters', 'type', 'route', 'diagram', 'object', 'offset', 'bytes',
    'repository', 'index', 'effect', 'conflict', 'contact', 'parallel', 'plus', 'per',
    'open', 'water', 'meter', 'moment', 'rest', 'via', 'violet', 'auto', 'zone', 'zones',
    'zoom', 'activator', 'later', 'site',
    // 2026-10 — the example notes and the workbench status bar
    'extra', 'over', 'apart', 'status',
  ]],
  // issue #297 - the storage gate and the Storage and privacy area: `computer`
  // and `privacy` are ordinary Dutch, Chrome and HTML are names
  ['the storage gate (issue #297)', ['computer', 'privacy', 'chrome', 'html']],
  // issue #300 - password protection for share links: HTTPS is a protocol name
  ['password protection for share links (issue #300)', ['https']],
  // issue #301 - the licence view: `software` is the word Dutch uses
  ['the third-party licence view (issue #301)', ['software']],
]

const SURVIVING_WORDS = new Set(SURVIVING.flatMap(([, ws]) => ws))

/** Everything whose WHOLE value is byte-identical to English, by key AND
 *  value. Exhaustive and exact: a count would let one swap for another. */
const IDENTICAL_TO_EN: ReadonlyArray<readonly [string, string]> = [
  ['catalog canvas.filter.rowLabel', 'Filters'],
  ['catalog canvas.filter.title', 'Filters'],
  ['catalog canvas.frame.color.violet', 'Violet'],
  ['catalog canvas.nodeKind.parameter', 'Parameter'],
  ['catalog dist.runs', 'runs'],
  ['catalog dist.seed', 'seed'],
  ['catalog enum.stateMode.activator', 'activator'],
  ['catalog help.contextual.hint.mc.name', 'Monte Carlo'],
  ['catalog import.delimiterTab', 'Tab'],
  ['catalog import.qs.mapping', 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}'],
  ['catalog import.review.col.parameters', 'Parameters'],
  ['catalog import.role.label', 'Label'],
  ['catalog inspector.activator.offsetLabel', 'Offset'],
  ['catalog inspector.edge.flowParam.resolved', '= {value}'],
  ['catalog inspector.ends.summary', '{from} → {to}'], // §ER18: the Ends group's summary, two names and an arrow
  ['catalog inspector.edge.flowPlaceholder', '1, all, 2D6, 1-3, 25%'],
  ['catalog inspector.expr.activatorPlaceholder', '>= 5'],
  ['catalog inspector.expr.labelPlaceholder', '+1   ·   -2   ·   =S'],
  ['catalog inspector.field.label', 'Label'],
  ['catalog inspector.field.route', 'Route'],
  // (`inspector.field.type`, `Type`, was removed in v0.29.0)
  ['catalog language.thai', 'Thai'],
  ['catalog mc.cost.parallel', 'Parallel, {workers} workers'],
  ['catalog mc.field.runs', 'runs'],
  ['catalog mc.title', 'Monte Carlo'],
  ['catalog node.default.parameter', 'Parameter'],
  ['catalog palette.parameter.name', 'Parameter'],
  ['catalog playbar.mc', 'Monte Carlo'],
  ['catalog playbar.mc.progress', 'Monte Carlo {pct}%'],
  ['catalog playbar.mc.withNote', 'Monte Carlo · {note}'],
  ['catalog playbar.seed', 'Seed'], // 2026-10: English capitalised it (`seed` → `Seed`)
  ['catalog regExpr.row.generic', '— {code}'],
  // 2026-10 — the Gate panel's three number formats
  ['catalog rel.gate.weight', '{w, number}'],
  ['catalog rel.gate.chance', '{chance, number, ::percent .#}'],
  ['catalog rel.gate.chanceBelow', '< {min, number, ::percent .#}'],
  ['catalog revChip.rev', 'rev {id}'],
  ['catalog revChip.title', 'Project {project} · {role} {revision}'],
  ['catalog theme.auto', 'Auto'],
  ['catalog theme.option.system', 'Auto'],
  ['catalog timeline.csv', 'CSV'],
  ['catalog timeline.view.live', 'Live'], // 2026-10: English changed `LIVE` → `Live`
  ['catalog toolbar.buildTitle', 'Loop Studio v{version} · build {sha}'],
  ['catalog tour.desktop.inspector.title', 'Inspector'],
  ['catalog tour.help.menuLabel', 'Help'],
  ['catalog tour.nav.position', '{n} / {total}'],
  // issue #308 - the step announcement, worded with the same full stops
  ['catalog tour.nav.announce', '{n} / {total}. {title}. {body}'],
  // 2026-10 — the workbench: ordinary Dutch words spelled as English spells
  // them, and the Run menu's Monte Carlo item
  ['catalog workbench.focus', 'Focus'],
  ['catalog workbench.run.mc', 'Monte Carlo…'],
  ['catalog workbench.status.label', 'Status'],
  ['catalog workbench.tab.model', 'Model'],
  ['catalog workbench.view.filter', 'Filters'],
  ['catalog workbench.view.focus', 'Focus'],
  ['catalog workbench.zoom.level', 'Zoom'],
  ['frame/gacha-banner-zones zone_pickup', 'Premium Pickup'],
  ['template/gacha-banner-zones pity_pickup', 'Pity'],
  ['template/gacha-banner-zones pity_standard', 'Pity'],
  ['template/gacha-banner-zones r_hit_free', 'R'],
  ['template/gacha-banner-zones r_hit_pickup', 'R'],
  ['template/gacha-banner-zones r_hit_standard', 'R'],
  ['template/gacha-banner-zones roll_gate_free', 'Roll'],
  ['template/gacha-banner-zones roll_gate_standard', 'Roll'],
  ['template/gacha-banner-zones sr_hit_free', 'SR'],
  ['template/gacha-banner-zones sr_hit_pickup', 'SR'],
  ['template/gacha-banner-zones sr_hit_standard', 'SR'],
  ['template/gacha-banner-zones ssr_hit_free', 'SSR'],
  ['template/gacha-banner-zones ssr_hit_standard', 'SSR'],
  ['template/gacha-banner-zones ticket_free', 'Tickets'],
  ['template/gacha-banner-zones ticket_pickup', 'Tickets'],
  ['template/gacha-banner-zones ticket_standard', 'Tickets'],
  // 2026-10 — the same kept gacha terms in the three new gacha Templates
  ['template/gacha-general roll', 'Roll'],
  ['template/gacha-general tickets', 'Tickets'],
  ['template/gacha-standard pity', 'Pity'],
  ['template/gacha-standard roll', 'Roll'],
  ['template/gacha-standard tickets', 'Tickets'],
  ['template/gacha-pickup pity', 'Pity'],
  ['template/gacha-pickup roll', 'Roll'],
  ['template/gacha-pickup tickets', 'Tickets'],
  ['template/mmo-progression drop', 'Drops'],
  ['template/mmo-progression level', 'Level'],
  ['template/mmo-progression xp', 'XP'],
]

// ------------------------------------------------------------------ shape
describe('nl copy — the surfaces exist and are complete', () => {
  it('has exactly the base key set', () => {
    expect(KEYS).toHaveLength(1181) // #420 follow-up: +4 (review.gate.invalidTarget / invalidContent, review.openDoc.replace.title / body); #420 PR B: +2 (revision.export.unknownKind / invalidContent); #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title); #417: −2 (toolbar.settings.button / menuLabel, the removed SettingsMenu); #392: +1 (import.error.badNode); 2026-10 restore: +16 (the `language.*` names of the restored locales); 0.29.0 workbench redesign: +158 −148 (docs/localization.md §L2.0a); 0.28.4: +3 (the three release-note lines); 0.28.3: +4 (the four release-note lines); 0.28.2: +3 (the three release-note lines); 0.28.1: +4 (the four release-note lines); 0.28.0: +3 (the three release-note lines); §ER19 Reverse: +13 (inspector.ends.reverse.*); §ER18 grips: +2 (inspector.ends.noGrip.source / target); 0.27.0: +3 (the three release-note lines); the connection Ends group (docs/edge-routing.md §ER18): +24 (inspector.ends.*, canvas.endGrip.source / target); 0.26.2: +4 (the four release-note lines); 0.26.0: +5 (the five release-note lines); the node structure: +1 (inspector.field.currentAmount, the Pool's read-only current amount); issue #344: +2 (the 0.25.0 release note is five lines, was three); issue #344 Step 3: +9 (the connection shape and bend-point strings and the keyboard bend notice); issue #344 Step 1: +3 (three 0.25.0 release-note lines); issue #344 Step 1: +1 (canvas.tidy, the Tidy to grid rail button); issue #330 PR 3: +3 (three 0.24.0 release-note lines); issue #330 PR 3: +9 (the phone Playback speed sheet); issue #330 PR 2: +3 (three 0.23.0 release-note lines); issue #330 PR 1: +5 (five 0.22.0 release-note lines); issue #301 decision 1: +4 (share.unavailable and the three 0.17.1 release-note lines); the session chip: +3 (the three 0.17.2 release-note lines); the licence screen: +12 (nine strings of the view and the three 0.18.0 release-note lines); the menu keyboard: +3 (the three 0.18.1 release-note lines); the tour announcement: +4 (tour.nav.announce and the three 0.18.2 release-note lines); the flow colour: +20 (the sixteen strings of the Colour section and the four 0.19.0 release-note lines); the flow colour views: +4 (the four 0.20.0 release-note lines); compact nodes: +3 (the three 0.21.0 release-note lines); Focus dimming: +3 (the three 0.21.1 release-note lines); value rows: +3 (the three 0.21.2 release-note lines); the edit lock: +4 (canvas.lock.name, its fixed accessible name, and the three 0.21.3 release-note lines); the locked rail and the phone search: +4 (the four 0.21.4 release-note lines)
    expect(Object.keys(NL).sort()).toEqual([...KEYS].sort())
  })

  it('covers all three runtime surfaces, at the measured sizes', () => {
    const per: Record<string, number> = {}
    for (const r of RUNTIME) per[r.surface.split('/')[0]!] = (per[r.surface.split('/')[0]!] ?? 0) + 1
    // 2026-10 — the three new gacha Templates add 69 labels and 3 frames to
    // the older five's 196 and 7; the 19 module labels left with the modules
    expect(per).toEqual({ catalog: 1181, template: 265, frame: 10 }) // #420 follow-up: +4; #420 PR B: +2; #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title); #417: −2 (toolbar.settings.*); #392: +1 (import.error.badNode)
    expect(RUNTIME).toHaveLength(1456) // #420 follow-up: +4; #420 PR B: +2; #420 PR A: +1 (share.open.notice.apply); #396: +1 (playbar.diag.title)
  })

  it('EVERY row has a non-empty ENGLISH side — the vacuity guard', () => {
    // An overlay with no English side (as the removed module overlay was)
    // silently becomes '' and every comparison below passes over nothing. The Vietnamese arc shipped that bug with green shape checks.
    const empty = RUNTIME.filter((r) => !r.en.trim()).map((r) => `${r.surface} ${r.key}`)
    expect(empty, 'a row with no English side compares against nothing').toEqual([])
  })

  it('EVERY row has a non-empty Dutch side', () => {
    const empty = RUNTIME.filter((r) => !r.nl.trim()).map((r) => `${r.surface} ${r.key}`)
    expect(empty).toEqual([])
  })
})

// -------------------------------------------------- untranslated English
describe('nl copy — no English survives except where it is declared', () => {
  it('the reason groups are disjoint, so no word is justified twice', () => {
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

  it('every word that survives translation is one of the declared ones', () => {
    const undeclared: string[] = []
    for (const r of RUNTIME) {
      const e = wordsOf(r.en)
      for (const w of wordsOf(r.nl)) {
        if (!e.has(w) || NEUTRAL.has(w) || SURVIVING_WORDS.has(w)) continue
        undeclared.push(`${r.surface} ${r.key}: "${w}" — EN=${r.en} NL=${r.nl}`)
      }
    }
    expect(undeclared, 'an English word survived translation without a declared reason').toEqual([])
  })

  it('every declared word is actually used — no stale allowance', () => {
    const used = new Set<string>()
    for (const r of RUNTIME) {
      const e = wordsOf(r.en)
      for (const w of wordsOf(r.nl)) if (e.has(w)) used.add(w)
    }
    const stale = [...SURVIVING_WORDS].filter((w) => !used.has(w)).sort()
    expect(stale, 'a declared survivor no longer appears — delete it, do not keep it').toEqual([])
  })

  it('the values identical to English are exactly the declared pairs', () => {
    const actual = RUNTIME.filter((r) => r.en === r.nl)
      .map((r) => [`${r.surface} ${r.key}`, r.nl] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
    const declared = [...IDENTICAL_TO_EN].sort((a, b) => a[0].localeCompare(b[0]))
    expect(actual).toEqual(declared)
  })
})

// ------------------------------------------------------------- plural
describe('nl copy — the plural contract', () => {
  // MEASURED through the product's own formatter: `nl` has `one` and `other`
  // only, and `one` is the integer 1 alone. Italian's `many` at multiples of
  // 1e6 has NO Dutch counterpart, so an arm that can never be selected would
  // be dead weight that also lies about the language.
  it('declares exactly `one` and `other`, never a third arm', () => {
    expect([...new Intl.PluralRules('nl').resolvedOptions().pluralCategories].sort())
      .toEqual(['one', 'other'])
  })

  it('every plural message in the catalog has exactly the two arms', () => {
    const wrong: string[] = []
    for (const k of KEYS) {
      const v = NL[k]!
      if (!/\{\s*\w+\s*,\s*plural\s*,/.test(v)) continue
      const arms = [...v.matchAll(/(?:^|[\s{}])(zero|one|two|few|many|other|=\d+)\s*\{/g)].map((m) => m[1]!)
      const uniq = [...new Set(arms)].sort()
      if (uniq.join(',') !== 'one,other') wrong.push(`${k}: ${uniq.join(',')}`)
    }
    expect(wrong, 'a Dutch plural must have exactly one+other').toEqual([])
  })

  it('has as many plural messages as the base catalog does', () => {
    const count = (c: Record<string, string>) =>
      KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(c[k]!)).length
    expect(count(NL)).toBe(count(EN))
    expect(count(EN)).toBe(21) // 2026-10: +1 (workbench.status.counts)
  })
})

// -------------------------------------------------------------- register
describe('nl copy — the address register', () => {
  // The approved style is the INFORMAL singular. Dutch is not a pro-drop
  // language: unlike Italian or Spanish, the pronoun cannot simply be left
  // out of a relative clause (`de verhouding die je instelt`), so the rule is
  // "use `je`, never `u`", not "use no pronoun at all".
  const FORMAL = /(?<![\p{L}\p{M}])(uw|u)(?![\p{L}\p{M}])/giu

  it('never addresses the reader with the formal `u` or `uw`', () => {
    const hits = RUNTIME.filter((r) => FORMAL.test(r.nl)).map((r) => `${r.surface} ${r.key}: ${r.nl}`)
    expect(hits, 'the catalog is informal singular throughout').toEqual([])
  })

  it('actually uses the informal pronoun somewhere — the rule is not vacuous', () => {
    const informal = RUNTIME.filter((r) => /(?<![\p{L}\p{M}])(je|jij|jouw)(?![\p{L}\p{M}])/iu.test(r.nl))
    expect(informal.length).toBeGreaterThan(20)
  })
})

// ----------------------------------------------------------------- script
describe('nl copy — the script stays inside the shipped font', () => {
  // docs/localization.md §L2.23 — `Ĳ`/`ĳ` (U+0132-0133) are in the latin-ext
  // FILE but outside the range `src/index.css` declares for it (Turkish only),
  // so the unranged latin face wins and has no glyph. Modern Dutch writes the
  // digraph as the two letters `i` + `j`, so this is a content rule rather
  // than a font change: no shipped Dutch string may use the ligature.
  it('uses no IJ ligature anywhere in the 1,073 runtime strings', () => {
    const hits = RUNTIME.filter((r) => /[Ĳĳ]/.test(r.nl)).map((r) => `${r.surface} ${r.key}`)
    expect(hits, 'write `ij` as two letters — the shipped face has no ligature glyph').toEqual([])
  })

  it('stays inside Latin-1 plus the punctuation the base catalog already uses', () => {
    // Anything outside this range would need a font decision, and the whole
    // point of §L2.23 is that Dutch needs none.
    const OK = /^[\p{Script=Latin}\p{Mark}\p{Nd}\p{P}\p{Zs}\p{Sm}\p{So}\n]*$/u
    const bad = RUNTIME.filter((r) => !OK.test(r.nl)).map((r) => `${r.surface} ${r.key}: ${r.nl}`)
    expect(bad).toEqual([])
  })
})

// ---------------------------------------------------------------- glossary
describe('nl copy — the approved glossary holds', () => {
  const GLOSSARY: ReadonlyArray<readonly [string, string]> = [
    ['palette.pool.name', 'Voorraad'],
    ['palette.source.name', 'Bron'],
    ['palette.drain.name', 'Afvoer'],
    ['palette.gate.name', 'Verdeler'],
    ['palette.converter.name', 'Omzetter'],
    ['palette.end.name', 'Einde'],
    ['palette.parameter.name', 'Parameter'],
    ['palette.register.name', 'Berekende waarde'],
    ['canvas.frame.defaultName', 'Groep {n}'],
    ['templates.menuLabel', 'Sjablonen'],
    // (`modules.menuLabel`, `Module invoegen`, was removed in v0.29.0)
  ]

  it('names every node kind the way the contract says', () => {
    for (const [k, want] of GLOSSARY) expect(NL[k], k).toBe(want)
  })

  it('uses the same kind names in the palette, the filter and the node defaults', () => {
    for (const kind of ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register']) {
      expect(NL[`canvas.nodeKind.${kind}`], kind).toBe(NL[`palette.${kind}.name`])
      expect(NL[`node.default.${kind}`], kind).toBe(NL[`palette.${kind}.name`])
    }
  })

  it('never calls a resource a `bron` — that word is the Source node', () => {
    // `bronnen` is the obvious Dutch plural for "resources" and it is exactly
    // the Source node's own name pluralised. `middelen` keeps the two product
    // nouns apart. Measured collision, not a style preference.
    //
    // The flow-mode enums are the ONE place the word legitimately means an
    // upstream node rather than a resource, which is why `de` and `it` also
    // use their Source-node word there (`von allen Quellen ziehen`, `tira da
    // tutte le sorgenti`). Listed by key so the exception cannot spread.
    const UPSTREAM_SENSE = new Set(['enum.flowMode.pullAny', 'enum.flowMode.pullAll'])
    const hits = KEYS.filter(
      (k) => !UPSTREAM_SENSE.has(k) && /(?<![\p{L}\p{M}])bronnen(?![\p{L}\p{M}])/iu.test(NL[k]!),
    )
    expect(hits, 'use `middelen` for resources').toEqual([])
  })

  it('keeps `Kader` for a frame and never borrows the English `frame`', () => {
    // stripIcu FIRST: `import.commitError.frame-insufficient-space` interpolates
    // a slot literally named `{frame}`, and a slot name is not prose. Testing
    // the raw value reported that key as an untranslated English word.
    const hits = KEYS.filter((k) => /(?<![\p{L}\p{M}])frames?(?![\p{L}\p{M}])/iu.test(stripIcu(NL[k]!)))
    expect(hits).toEqual([])
  })

  it('uses `teken` for a parser offset and `kolom` for a table column', () => {
    // The two senses of `{column}`. `parserLocation.test.ts` asserts the two
    // groups are disjoint and exhaustive across every locale; this pins the
    // Dutch side by key so a local edit cannot drift one into the other.
    expect(NL['import.parseError']).toContain('teken {column}')
    expect(NL['import.parseError']).not.toContain('kolom')
    for (const k of ['import.loc.tableRowColumn', 'import.loc.tableRowColumnHeader', 'import.loc.tableColumnHeader']) {
      expect(NL[k], k).toContain('kolom {column}')
    }
    for (const k of KEYS.filter((x) => x.startsWith('error.EXPR_'))) {
      expect(NL[k], k).not.toContain('kolom')
    }
  })

  it('tells the reader the feedback form is in English', () => {
    // The cross-locale contract in `localeSurfaceCopy.test.ts` requires this
    // of every non-English catalog. The first draft of this one omitted it.
    for (const k of ['tour.help.feedback', 'tour.help.feedbackAria']) {
      expect(NL[k], k).toMatch(/Engels/i)
    }
  })
})

// ------------------------------------------------- template-label collisions
describe('nl template labels — the §TLO11 classification stays sound', () => {
  // `relabelNodesForLocale` treats a node's label as OFFICIAL when the label
  // is one of that NODE ID's known strings in some locale. Two locales sharing
  // a string for the SAME id is a no-op (the target is resolved from the id).
  // What would be a real hazard is a Dutch label colliding with a DIFFERENT
  // id's official string, which widens what counts as "official" for that
  // other id and can capture a user's own rename.
  // BOTH checks are about what Dutch INTRODUCES. English already reuses one
  // label across several ids on purpose — `ticket_free`, `ticket_standard`
  // and `ticket_pickup` are all "Tickets" — and mirroring that is correct, not
  // a defect. The first draft of these two tests flagged 18 and 24 such rows;
  // it was measuring the English design, not the Dutch translation.
  it('merges no two labels that English keeps distinct', () => {
    const merged: string[] = []
    for (const [t, g] of TEMPLATES) {
      const nodes = (g.nodes ?? []).filter((n) => nlTpl[t]?.[n.id])
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!
          const b = nodes[j]!
          const enSame = (a.data?.label ?? '') === (b.data?.label ?? '')
          const nlSame = nlTpl[t]![a.id] === nlTpl[t]![b.id]
          if (nlSame && !enSame) {
            merged.push(`${t}: ${a.id} ("${a.data?.label}") and ${b.id} ("${b.data?.label}") both became "${nlTpl[t]![a.id]}"`)
          }
        }
      }
    }
    expect(merged, 'a distinction the source makes must survive translation').toEqual([])
  })

  it('no Dutch label lands on a DIFFERENT id`s English canonical', () => {
    // This is the §TLO11 hazard: `known` collects every official string per
    // id, so a Dutch label equal to some OTHER id's English label widens what
    // counts as "official" for that id and can capture a user's own rename.
    // Pairs that already share their English label are excluded — they are the
    // same string in every locale by design.
    const hits: string[] = []
    for (const [t, g] of TEMPLATES) {
      const nodes = g.nodes ?? []
      for (const n of nodes) {
        const want = nlTpl[t]?.[n.id]
        if (!want) continue
        for (const other of nodes) {
          if (other.id === n.id) continue
          const otherEn = other.data?.label ?? ''
          if (!otherEn || otherEn === (n.data?.label ?? '')) continue
          if (otherEn === want) hits.push(`${t}/${n.id} -> "${want}" is the English canonical of ${other.id}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
