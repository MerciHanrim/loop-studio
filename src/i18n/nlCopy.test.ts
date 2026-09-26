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
// And the vacuity lesson is kept. `moduleLabelOverlay(id, 'en')` returns
// undefined — English is canonical and has no overlay — so a naive English
// side silently becomes `''` for the 19 module labels and every comparison
// against it passes while looking at nothing. Every row asserts its English
// side is non-empty BEFORE comparing.

import { describe, expect, it } from 'vitest'

import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import bufferedStepDoc from '../../examples/module-buffered-step.json'
import rewardSplitDoc from '../../examples/module-reward-split.json'
import en from './locales/en'
import nlCat from './locales/nl'
import { nl as nlTpl, nlFrames } from './templateLabels/nl'
import { moduleLabelOverlay } from './moduleLabels'

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
]
const MODULES: ReadonlyArray<readonly [string, GraphDocLike]> = [
  ['buffered-step', bufferedStepDoc as GraphDocLike],
  ['reward-split', rewardSplitDoc as GraphDocLike],
]

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
for (const [m, g] of MODULES) {
  const ov = moduleLabelOverlay(m, 'nl')
  for (const n of g.nodes ?? []) {
    const label = n.data?.label
    if (label && ov?.[n.id]) RUNTIME.push({ surface: `module/${m}`, key: n.id, en: label, nl: ov[n.id]! })
  }
}

// ---------------------------------------------------------------- tokenizer
/** Drop ICU MACHINERY but keep ICU TEXT: the argument header (`{n, plural,`),
 *  the arm selectors (`one {`, `other {`, `=0 {`), the `#` placeholder and the
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
  ]],
  ['file formats, units, metrics and version tokens', [
    'csv', 'tsv', 'json', 'xlsx', 'kg', 'xp', 'p10', 'p50', 'p90', 'montecarloresult',
    'v', 'v1', 'v2', 'g1', 'mc', 'id', 'min', 'max', 'rev', 'build', 'mmo', 'gacha',
  ]],
  ['Monte Carlo — a place name to begin with', ['monte', 'carlo']],
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
    'parameter', 'parameters', 'project', 'document', 'model', 'module', 'label', 'labels',
    'focus', 'filters', 'type', 'route', 'diagram', 'object', 'offset', 'bytes',
    'repository', 'index', 'effect', 'conflict', 'contact', 'parallel', 'plus', 'per',
    'open', 'water', 'meter', 'moment', 'rest', 'via', 'violet', 'auto', 'zone', 'zones',
    'zoom', 'activator',
  ]],
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
  ['catalog inspector.edge.flowPlaceholder', '1, all, 2D6, 1-3, 25%'],
  ['catalog inspector.expr.activatorPlaceholder', '>= 5'],
  ['catalog inspector.expr.labelPlaceholder', '+1   ·   -2   ·   =S'],
  ['catalog inspector.field.label', 'Label'],
  ['catalog inspector.field.route', 'Route'],
  ['catalog inspector.field.type', 'Type'],
  ['catalog language.thai', 'Thai'],
  ['catalog mc.cost.parallel', 'Parallel, {workers} workers'],
  ['catalog mc.field.runs', 'runs'],
  ['catalog mc.title', 'Monte Carlo'],
  ['catalog node.default.parameter', 'Parameter'],
  ['catalog palette.parameter.name', 'Parameter'],
  ['catalog playbar.mc', 'Monte Carlo'],
  ['catalog playbar.mc.progress', 'Monte Carlo {pct}%'],
  ['catalog playbar.mc.withNote', 'Monte Carlo · {note}'],
  ['catalog playbar.seed', 'seed'],
  ['catalog regExpr.row.generic', '— {code}'],
  ['catalog revChip.rev', 'rev {id}'],
  ['catalog revChip.title', 'Project {project} · {role} {revision}'],
  ['catalog theme.auto', '◐ Auto'],
  ['catalog theme.option.system', 'Auto'],
  ['catalog timeline.csv', 'CSV'],
  ['catalog timeline.view.live', 'LIVE'],
  ['catalog toolbar.buildTitle', 'Loop Studio v{version} · build {sha}'],
  ['catalog tour.desktop.inspector.title', 'Inspector'],
  ['catalog tour.help.menuLabel', 'Help'],
  ['catalog tour.nav.position', '{n} / {total}'],
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
  ['template/mmo-progression drop', 'Drops'],
  ['template/mmo-progression level', 'Level'],
  ['template/mmo-progression xp', 'XP'],
]

// ------------------------------------------------------------------ shape
describe('nl copy — the surfaces exist and are complete', () => {
  it('has exactly the base key set', () => {
    expect(KEYS).toHaveLength(851)
    expect(Object.keys(NL).sort()).toEqual([...KEYS].sort())
  })

  it('covers all four runtime surfaces, at the measured sizes', () => {
    const per: Record<string, number> = {}
    for (const r of RUNTIME) per[r.surface.split('/')[0]!] = (per[r.surface.split('/')[0]!] ?? 0) + 1
    expect(per).toEqual({ catalog: 851, template: 196, frame: 7, module: 19 })
    expect(RUNTIME).toHaveLength(1073)
  })

  it('EVERY row has a non-empty ENGLISH side — the vacuity guard', () => {
    // `moduleLabelOverlay(id, 'en')` is undefined, so an English side read
    // that way silently becomes '' and every comparison below passes over
    // nothing. The Vietnamese arc shipped that bug with green shape checks.
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
    expect(count(EN)).toBe(19)
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
    ['modules.menuLabel', 'Module invoegen'],
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
