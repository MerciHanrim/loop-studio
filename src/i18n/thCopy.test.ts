import { describe, expect, it } from 'vitest'
import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import { pluralArms, pluralBlocks } from './icuPlural'
import en from './locales/en'
import th from './locales/th'
import { moduleLabelOverlay } from './moduleLabels'
import { th as tplTh, thFrames } from './templateLabels/th'

// docs/localization.md §L2.19 — the `th` copy contracts.
//
// WHY THIS FILE LOOKS DIFFERENT FROM `trCopy.test.ts`
//
// Thai writes with NO SPACES between words. Every technique the Latin-script
// copy guards lean on — split on whitespace, look at "words", count tokens —
// is meaningless here: one Thai sentence is a single whitespace-free run. So
// the untranslated check is built on UNICODE SCRIPT RUNS instead. A character
// is judged by the script it belongs to, never by where a space is.
//
// The Turkish slot-suffix contract is deliberately NOT carried over. Thai is
// not agglutinative and has no case suffixes, so `{label}` needs no classifier
// noun in front of a suffix; what it needs is a visible BOUNDARY, which is why
// a runtime label is wrapped in `“…”`.
//
// WHAT IS DELIBERATELY NOT LOCKED
//
//   * the spelling of `ทางระบาย` for Drain. The surfaces must AGREE, and that
//     is pinned; the word itself is provisional until a native review, so
//     settling on something else later moves all the surfaces together and
//     this file keeps passing without being edited to bless a new string.
//   * `“…”` as the quotation mark. It is the Royal Institute's Thai mark and
//     is the right default, but what a screen reader does with it was never
//     measured.

const EN = en as Record<string, string>
const TH = th as Record<string, string>
const KEYS = Object.keys(EN)

/** The canonical English template labels, read from the graphs themselves so
 *  this file cannot drift from what `check:template-labels` compares against. */
type GraphDocLike = {
  nodes?: { id: string; data?: { label?: string } }[]
  frames?: { id: string; label?: string }[]
}
const EN_TPL: Record<string, Record<string, string>> = {}
for (const [id, doc] of [
  ['equilibrium', equilibriumDoc],
  ['deadlock', deadlockDoc],
  ['mmo-progression', mmoProgressionDoc],
  ['coffee-roastery', coffeeRoasteryDoc],
  ['gacha-banner-zones', gachaBannerZonesDoc],
] as [string, GraphDocLike][]) {
  const m: Record<string, string> = {}
  for (const n of doc.nodes ?? []) if (n.data?.label) m[n.id] = n.data.label
  for (const f of doc.frames ?? []) if (f.label) m[f.id] = f.label
  EN_TPL[id] = m
}

/** Every runtime string `th` ships, as `[surface, id, value]`. The three
 *  surfaces are checked TOGETHER on purpose: the `pt-BR` lesson was that a
 *  guard reading only the catalog misses what the overlays carry. */
const RUNTIME: [string, string, string][] = [
  ...KEYS.map((k) => ['catalog', k, TH[k]] as [string, string, string]),
  ...Object.entries(tplTh).flatMap(([t, map]) =>
    Object.entries(map).map(([id, v]) => ['template/' + t, id, v] as [string, string, string]),
  ),
  ...Object.entries(thFrames).flatMap(([t, map]) =>
    Object.entries(map).map(([id, v]) => ['frame/' + t, id, v] as [string, string, string]),
  ),
  ...['buffered-step', 'reward-split'].flatMap((id) =>
    Object.entries(moduleLabelOverlay(id, 'th') ?? {}).map(
      ([n, v]) => ['module/' + id, n, v] as [string, string, string],
    ),
  ),
]

/** The English counterpart of a runtime string, for the derived checks. */
const englishFor = (surface: string, id: string): string => {
  if (surface === 'catalog') return EN[id] ?? ''
  const tpl = surface.replace(/^(template|frame)\//, '')
  return EN_TPL[tpl]?.[id] ?? ''
}

// ------------------------------------------------------------------ shape
describe('th copy — the first no-space script', () => {
  it('has exactly the base key set', () => {
    expect(Object.keys(TH).sort()).toEqual(KEYS.slice().sort())
    expect(KEYS).toHaveLength(851)
  })

  it('covers all three runtime surfaces', () => {
    expect(RUNTIME.filter(([s]) => s === 'catalog')).toHaveLength(851)
    expect(RUNTIME.filter(([s]) => s.startsWith('template/'))).toHaveLength(196)
    expect(RUNTIME.filter(([s]) => s.startsWith('frame/'))).toHaveLength(7)
    expect(RUNTIME.filter(([s]) => s.startsWith('module/'))).toHaveLength(19)
  })

  it('has no empty value anywhere', () => {
    expect(RUNTIME.filter(([, , v]) => !v || !v.trim()).map(([s, k]) => s + ':' + k)).toEqual([])
  })
})

// ------------------------------------------------------------------ script
describe('only Thai, Common and Inherited scripts appear', () => {
  // Script — not "alphabet", and not a whitespace split. `Common` covers
  // digits, spaces and punctuation; `Inherited` covers the combining marks
  // that sit on a Thai base. Latin is judged separately below, because it IS
  // allowed — but only where English put it.
  const ALLOWED = /^[\p{Script=Thai}\p{Script=Common}\p{Script=Inherited}\p{Script=Latin}]*$/u

  it('no character comes from a script outside the allowed set', () => {
    const bad: string[] = []
    for (const [surface, id, v] of RUNTIME) {
      if (ALLOWED.test(v)) continue
      const offenders = [...v].filter(
        (c) => !/[\p{Script=Thai}\p{Script=Common}\p{Script=Inherited}\p{Script=Latin}]/u.test(c),
      )
      bad.push(surface + ':' + id + ' — ' + offenders.map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' '))
    }
    expect(bad).toEqual([])
  })

  it('Thai characters are actually present — the check is not vacuous', () => {
    const thai = RUNTIME.filter(([, , v]) => /\p{Script=Thai}/u.test(v))
    expect(thai.length).toBeGreaterThan(900)
  })
})

// ------------------------------------------------------------------ Latin
/** ICU syntax, then the plain slots. What remains is prose plus whatever
 *  Latin the translation deliberately kept. The arm BODIES survive — the `tr`
 *  hole was stripping whole `{…}` groups and losing the sentences inside. */
const stripIcu = (s: string) =>
  s
    .replace(/\{\s*[A-Za-z0-9_]+\s*,\s*(?:plural|select|selectordinal)\s*,/g, ' ')
    .replace(/\b(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ')
    .replace(/\boffset\s*:\s*-?\d+/g, ' ')
    .replace(/\{\s*[A-Za-z0-9_]+\s*\}/g, ' ')
    .replace(/[{}]/g, ' ')

/** Latin words, lower-cased. Split on the LETTER class, never on whitespace —
 *  `Monte-Carlo` and `JSON.` must tokenise the same on both sides. */
const latinWords = (s: string) => [...stripIcu(s).matchAll(/[A-Za-z][A-Za-z0-9]*/gu)].map((m) => m[0].toLowerCase())

/** WHY THIS IS A HARDCODED POLICY LIST AND NOT A DERIVED RULE
 *
 *  The first version of this section derived the allowance: "a Latin word in a
 *  Thai value must appear in the English original of the same key". That is a
 *  real contract and it is kept below — but on its own it has a hole big
 *  enough to drive an untranslated sentence through. Copy any fragment of the
 *  English original into the Thai value and it passes, BECAUSE the words are
 *  in the English original. Partial non-translation is exactly the failure
 *  this file exists to catch, and the derived rule is blind to it.
 *
 *  So the primary contract is two closed sets, both MEASURED then declared:
 *  which strings may carry a Latin run at all, and which words those runs may
 *  be. A long list is the right shape here — it is a translation policy, not a
 *  cache of something computable. Adding an English word to a key that is
 *  already on the key list still fails, on the vocabulary set or on the
 *  derived check behind it. */

/** Brand and product names. Never translated in any locale. */
const LATIN_BRAND = [
  'loop', 'studio', 'machinations', 'io', 'github', 'google', 'sheets',
  'excel', 'numbers', 'monte', 'carlo', 'mc', 'mmo',
]
/** File formats and the export commands named after them. `Graph JSON` and
 *  `Runs CSV` are the names of the files the product writes. */
const LATIN_FILE_FORMAT = [
  'json', 'csv', 'tsv', 'xlsx', 'graph', 'workspace', 'runs', 'series',
  'summary', 'montecarloresult',
]
/** Keyboard keys, as printed on the key. A translated key name would tell the
 *  reader to press something that is not on their keyboard. */
const LATIN_KEYBOARD = [
  'enter', 'space', 'shift', 'backspace', 'delete', 'escape', 'esc', 'alt',
  'ctrl', 'cmd', 'z',
]
/** Wire tokens: column names, model-version tags, expression syntax, share-URL
 *  fragments and the axis letters in the a11y messages. Every one of these is
 *  something the user types or the document stores verbatim. */
const LATIN_WIRE = [
  'id', 'name', 'price', 'rate', 'drop', 'item', 'n', 's', 'x', 'y', 'v',
  'v1', 'v2', 'g1', 'd6', 'all', 'p10', 'p50', 'p90', 'resource', 'state',
  'timing', 'when',
]
/** Placeholder examples and the gacha template's own proper nouns — the banner
 *  zone names and the rarity letters, which are the graph's vocabulary, not
 *  the UI's. */
const LATIN_EXAMPLE = [
  'alex', 'gold', 'energy', 'xp', 'player', 'free', 'general', 'premium',
  'standard', 'r', 'sr', 'ssr',
]
const LATIN_GROUPS: [string, string[]][] = [
  ['brand', LATIN_BRAND],
  ['file format', LATIN_FILE_FORMAT],
  ['keyboard key', LATIN_KEYBOARD],
  ['wire token', LATIN_WIRE],
  ['example', LATIN_EXAMPLE],
]
const LATIN_GLOBAL = new Set(LATIN_GROUPS.flatMap(([, g]) => g))

/** The three gacha mechanism names are allowed PER KEY, not catalog-wide.
 *  `Pity` and `Pickup` are the terms the genre uses in Thai too, but they are
 *  the vocabulary of one template — letting them float free would make
 *  `Pickup` legal in, say, a toolbar tooltip. */
const LATIN_KEY_SCOPED: Record<string, string[]> = {
  pity: [
    'catalog:templates.gachaBannerZones.blurb',
    'template/gacha-banner-zones:pity_pickup',
    'template/gacha-banner-zones:pity_standard',
    'template/gacha-banner-zones:zone2_standard_hard_pity',
    'template/gacha-banner-zones:zone3_pickup_hard_pity',
  ],
  hard: [
    'template/gacha-banner-zones:zone2_standard_hard_pity',
    'template/gacha-banner-zones:zone3_pickup_hard_pity',
  ],
  pickup: [
    'catalog:templates.gachaBannerZones.blurb',
    'frame/gacha-banner-zones:zone_pickup',
    'template/gacha-banner-zones:cmp3_hit_rate_pickup',
    'template/gacha-banner-zones:cmp4_pickup_rate_pickup',
    'template/gacha-banner-zones:missed_pickup_pickup',
    'template/gacha-banner-zones:pickup_count_pickup',
    'template/gacha-banner-zones:pickup_hit_pickup',
    'template/gacha-banner-zones:ssr_count_pickup',
    'template/gacha-banner-zones:zone3_pickup_hard_pity',
    'template/gacha-banner-zones:zone3_pickup_w_pickup',
    'template/gacha-banner-zones:zone3_pickup_w_r',
    'template/gacha-banner-zones:zone3_pickup_w_sr',
    'template/gacha-banner-zones:zone3_pickup_w_ssr',
    'template/gacha-banner-zones:zone3_pickup_w_standard',
  ],
}

/** Every runtime string that carries a Latin run at all. A string NOT on this
 *  list must be pure Thai, so a sentence left in English announces itself here
 *  before any vocabulary question is asked. */
const LATIN_KEYS = [
  'catalog:about.notAffiliated',
  'catalog:about.repo',
  'catalog:about.repoAria',
  'catalog:author.namePlaceholder',
  'catalog:autosave.exportButton',
  'catalog:canvas.frame.a11y.desc',
  'catalog:canvas.frame.a11y.descSelected',
  'catalog:canvas.frame.a11y.moved',
  'catalog:canvas.frame.a11y.resize',
  'catalog:canvas.frame.drawing',
  'catalog:canvas.regionSelect.off',
  'catalog:canvas.regionSelect.on',
  'catalog:dist.export.json.blurb',
  'catalog:dist.export.runsCsv',
  'catalog:dist.export.seriesCsv',
  'catalog:dist.export.seriesCsv.blurb',
  'catalog:dist.export.summaryCsv',
  'catalog:export.graphJson.name',
  'catalog:export.projectRevision.disclosure.body',
  'catalog:export.workspace.reject',
  'catalog:export.workspaceJson.name',
  'catalog:help.contextual.hint.mc.desc',
  'catalog:help.contextual.hint.mc.name',
  'catalog:help.contextual.intro',
  'catalog:hint.frameMove.body',
  'catalog:hint.mc.body',
  'catalog:import.error.invalidJson',
  'catalog:import.error.notLoopStudio',
  'catalog:import.ignoreLastRows',
  'catalog:import.issue.invalid-ignore-rows',
  'catalog:import.issue.ragged-row',
  'catalog:import.parseError',
  'catalog:import.parseErrorsBlockValidation',
  'catalog:import.pasteAria',
  'catalog:import.pasteDataRequired',
  'catalog:import.pastePlaceholder',
  'catalog:import.qs.download',
  'catalog:import.qs.fullGuideAria',
  'catalog:import.qs.mapping',
  'catalog:import.qs.notImported.formulas',
  'catalog:import.qs.notImported.list',
  'catalog:import.qs.sources.excel',
  'catalog:import.qs.sources.sheets',
  'catalog:import.qs.sources.summary',
  'catalog:import.refresh.exportCsv',
  'catalog:import.roleHelp.ignored',
  'catalog:inspector.edge.flowParam.hint',
  'catalog:inspector.edge.flowPlaceholder',
  'catalog:inspector.edge.note',
  'catalog:inspector.edge.type.resource',
  'catalog:inspector.edge.type.state',
  'catalog:inspector.expr.labelPlaceholder',
  'catalog:inspector.labelTiming.unsupported',
  'catalog:inspector.labelTiming.warnSForm',
  'catalog:inspector.legacy.note',
  'catalog:inspector.parameter.noPorts',
  'catalog:inspector.resourceType.placeholder',
  'catalog:mc.title',
  'catalog:mobile.more.importSub',
  'catalog:modules.promote.body',
  'catalog:modules.promote.title',
  'catalog:openhint.sub',
  'catalog:palette.parameter.description',
  'catalog:playbar.mc',
  'catalog:playbar.mc.progress',
  'catalog:playbar.mc.progress.title',
  'catalog:playbar.mc.withNote',
  'catalog:proposal.tooLarge',
  'catalog:pwa.text',
  'catalog:regExpr.insert.armed',
  'catalog:review.fail.versionMismatch',
  'catalog:review.gate.versionMismatch',
  'catalog:revision.export.tooLarge',
  'catalog:rf.edge.a11y',
  'catalog:rf.node.a11y',
  'catalog:rf.node.a11yKeyboard',
  'catalog:rf.node.moveCancelled',
  'catalog:rf.node.moved',
  'catalog:runbar.mc.cancel',
  'catalog:share.tooLarge',
  'catalog:stateExpr.label.hint.empty',
  'catalog:stateExpr.label.hint.notAnAssignment',
  'catalog:templates.gachaBannerZones.blurb',
  'catalog:templates.mmoProgression.name',
  'catalog:timeline.csv',
  'catalog:timeline.csvTitle',
  'catalog:toolbar.buildTitle',
  'catalog:toolbar.redo.title',
  'catalog:toolbar.undo.title',
  'catalog:tour.help.about',
  'catalog:tour.mobile.open.body',
  'catalog:tour.welcome.title',
  'frame/gacha-banner-zones:zone_pickup',
  'frame/gacha-banner-zones:zone_standard',
  'template/gacha-banner-zones:cmp1_hit_rate_free',
  'template/gacha-banner-zones:cmp2_hit_rate_standard',
  'template/gacha-banner-zones:cmp3_hit_rate_pickup',
  'template/gacha-banner-zones:cmp4_pickup_rate_pickup',
  'template/gacha-banner-zones:forced_ssr_standard',
  'template/gacha-banner-zones:missed_pickup_pickup',
  'template/gacha-banner-zones:pickup_count_pickup',
  'template/gacha-banner-zones:pickup_hit_pickup',
  'template/gacha-banner-zones:pity_pickup',
  'template/gacha-banner-zones:pity_standard',
  'template/gacha-banner-zones:r_count_free',
  'template/gacha-banner-zones:r_count_pickup',
  'template/gacha-banner-zones:r_count_standard',
  'template/gacha-banner-zones:r_hit_free',
  'template/gacha-banner-zones:r_hit_pickup',
  'template/gacha-banner-zones:r_hit_standard',
  'template/gacha-banner-zones:sr_count_free',
  'template/gacha-banner-zones:sr_count_pickup',
  'template/gacha-banner-zones:sr_count_standard',
  'template/gacha-banner-zones:sr_hit_free',
  'template/gacha-banner-zones:sr_hit_pickup',
  'template/gacha-banner-zones:sr_hit_standard',
  'template/gacha-banner-zones:ssr_count_free',
  'template/gacha-banner-zones:ssr_count_pickup',
  'template/gacha-banner-zones:ssr_count_standard',
  'template/gacha-banner-zones:ssr_hit_free',
  'template/gacha-banner-zones:ssr_hit_standard',
  'template/gacha-banner-zones:ssr_split_open_pickup',
  'template/gacha-banner-zones:standard_count_pickup',
  'template/gacha-banner-zones:standard_hit_pickup',
  'template/gacha-banner-zones:zone1_free_w_r',
  'template/gacha-banner-zones:zone1_free_w_sr',
  'template/gacha-banner-zones:zone1_free_w_ssr',
  'template/gacha-banner-zones:zone2_standard_hard_pity',
  'template/gacha-banner-zones:zone2_standard_w_r',
  'template/gacha-banner-zones:zone2_standard_w_sr',
  'template/gacha-banner-zones:zone2_standard_w_ssr',
  'template/gacha-banner-zones:zone3_pickup_hard_pity',
  'template/gacha-banner-zones:zone3_pickup_w_pickup',
  'template/gacha-banner-zones:zone3_pickup_w_r',
  'template/gacha-banner-zones:zone3_pickup_w_sr',
  'template/gacha-banner-zones:zone3_pickup_w_ssr',
  'template/gacha-banner-zones:zone3_pickup_w_standard',
  'template/mmo-progression:hunt_xp',
  'template/mmo-progression:quest_xp',
  'template/mmo-progression:r_efflevel',
  'template/mmo-progression:r_huntshare',
  'template/mmo-progression:xp',
  'template/mmo-progression:xp_earned',
  'template/mmo-progression:z1_xp_meter',
  'template/mmo-progression:z2_xp_meter',
  'template/mmo-progression:z3_xp_meter',
]

describe('a Latin run is declared, twice over — by key and by word', () => {
  const withLatin = RUNTIME.filter(([, , v]) => latinWords(v).length > 0).map(
    ([s, id]) => s + ':' + id,
  )

  it('the strings carrying a Latin run are exactly the declared ones', () => {
    expect(withLatin.slice().sort()).toEqual(LATIN_KEYS.slice().sort())
    expect(LATIN_KEYS).toHaveLength(146)
  })

  it('the Latin vocabulary is exactly the declared one', () => {
    const seen = new Set<string>()
    for (const [, , v] of RUNTIME) for (const w of latinWords(v)) seen.add(w)
    const declared = new Set([...LATIN_GLOBAL, ...Object.keys(LATIN_KEY_SCOPED)])
    expect([...seen].sort()).toEqual([...declared].sort())
    expect(declared.size).toBe(72)
  })

  it('the groups are disjoint, and they add up', () => {
    // Otherwise a word could be quietly moved between groups, and the reason
    // it is allowed — which is the whole content of this list — would rot.
    const counts = LATIN_GROUPS.map(([, g]) => g.length)
    expect(counts).toEqual([13, 10, 11, 23, 12])
    const all = LATIN_GROUPS.flatMap(([, g]) => g)
    expect(all).toHaveLength(LATIN_GLOBAL.size)
    for (const w of Object.keys(LATIN_KEY_SCOPED)) expect(LATIN_GLOBAL.has(w)).toBe(false)
  })

  it('a key-scoped word appears in exactly the keys that declare it', () => {
    for (const [word, keys] of Object.entries(LATIN_KEY_SCOPED)) {
      const actual = RUNTIME.filter(([, , v]) => latinWords(v).includes(word)).map(
        ([s, id]) => s + ':' + id,
      )
      expect(actual.sort(), word).toEqual(keys.slice().sort())
    }
  })

  it('and, behind that, every Latin word is in the English original of the same string', () => {
    // The SECONDARY contract. The two sets above say which words may appear at
    // all; this says they may only appear where English put them, so `Standard`
    // cannot drift from the gacha template into a tooltip that is already on
    // the key list for an unrelated reason.
    const bad: string[] = []
    for (const [surface, id, v] of RUNTIME) {
      const allowed = new Set(latinWords(englishFor(surface, id)))
      for (const w of latinWords(v)) if (!allowed.has(w)) bad.push(surface + ':' + id + ' — ' + w)
    }
    expect(bad).toEqual([])
  })

  it('the gacha mechanism names really are the English ones', () => {
    // `Pity` / `Hard pity` / `Pickup` stay English the way every other locale
    // keeps them; `drop` and `loot` are transliterated instead. Both are
    // consequences of the rule above, asserted here so the DECISION is visible.
    const g = tplTh['gacha-banner-zones']
    expect(g.pity_standard).toBe('Pity')
    expect(g.pity_pickup).toBe('Pity')
    expect(g.zone2_standard_hard_pity).toContain('Hard pity')
    expect(g.zone3_pickup_hard_pity).toContain('Hard pity')
    const mmo = tplTh['mmo-progression']
    expect(mmo.drop).toBe('ดรอป')
    expect(mmo.loot_feed).toContain('ลูท')
  })

  it('a value identical to its English original is on the declared list', () => {
    const identical = KEYS.filter((k) => EN[k] === TH[k]).sort()
    expect(identical).toEqual(
      [
        'dist.export.runsCsv',
        'dist.export.seriesCsv',
        'dist.export.summaryCsv',
        'export.graphJson.name',
        'export.workspaceJson.name',
        'help.contextual.hint.mc.name',
        'import.qs.mapping',
        'inspector.edge.flowParam.resolved',
        'inspector.edge.flowPlaceholder',
        'inspector.expr.activatorPlaceholder',
        'inspector.expr.labelPlaceholder',
        'mc.title',
        'playbar.mc',
        'playbar.mc.progress',
        'playbar.mc.withNote',
        'regExpr.row.generic',
        'timeline.csv',
        'tour.nav.position',
      ].sort(),
    )
  })
})

// ------------------------------------------------------------------ quotes
describe('the quotation mark is the Thai one', () => {
  const GUILLEMET = /[«»]/

  it('no runtime string carries a guillemet', () => {
    // `«…»` is the French / Russian mark `tr` uses. Thai punctuation does not
    // share it. Source COMMENTS that explain this are not runtime data and are
    // not read here — this walks the loaded values only.
    expect(RUNTIME.filter(([, , v]) => GUILLEMET.test(v)).map(([s, k]) => s + ':' + k)).toEqual([])
  })

  it('a label IS wrapped, so the check is not vacuous', () => {
    const wrapped = RUNTIME.filter(([, , v]) => /“[^”]*”/.test(v))
    expect(wrapped.length).toBeGreaterThan(10)
  })
})

// --------------------------------------------------- node kinds, 8 x 3 shape
describe('the eight node kinds name themselves the same way on every surface', () => {
  const KINDS = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'] as const

  it('palette, canvas and default label agree, kind by kind', () => {
    const mismatched: string[] = []
    for (const kind of KINDS) {
      const a = TH['palette.' + kind + '.name']
      const b = TH['canvas.nodeKind.' + kind]
      const c = TH['node.default.' + kind]
      if (!(a && b && c && a === b && b === c)) mismatched.push(kind + ': ' + [a, b, c].join(' | '))
    }
    expect(mismatched).toEqual([])
  })

  it('the eight names are distinct', () => {
    const names = KINDS.map((k) => TH['canvas.nodeKind.' + k])
    expect(new Set(names).size).toBe(KINDS.length)
  })
})

// ------------------------------------------------------------------ Drain
describe('Drain reads the same wherever English names it', () => {
  // The WORD is provisional (native review). What is pinned is that every
  // surface whose English original names Drain uses the SAME Thai term, so a
  // later rename moves all of them together.
  const DRAIN_KEYS = KEYS.filter((k) => /(^|[^A-Za-z])Drains?([^A-Za-z]|$)/.test(EN[k]))

  it('English names Drain in the keys this locale must keep in step', () => {
    expect(DRAIN_KEYS.sort()).toEqual(
      [
        'canvas.nodeKind.drain',
        'inspector.labelTiming.warnSourceNotRouter',
        'node.default.drain',
        'palette.drain.name',
        'tour.desktop.pieces.body',
      ].sort(),
    )
  })

  it('all of them carry the one term', () => {
    const term = TH['canvas.nodeKind.drain']
    expect(term).toBeTruthy()
    expect(DRAIN_KEYS.filter((k) => !TH[k].includes(term))).toEqual([])
  })
})

// ------------------------------------------------------------------ Register
describe('Register is a calculated value, never `บันทึก`', () => {
  // `บันทึก` is both "a record" and "save", and save is already a BUTTON
  // (`author.save`, `export.workspace.confirm`). Using it for this node kind
  // would make the kind and an action the same word — and this node stores
  // nothing, which is the property the name has to carry.
  const REGISTER_KEYS = [
    'palette.register.name',
    'canvas.nodeKind.register',
    'node.default.register',
    'inspector.register.noStore',
    'panels.empty.summary',
    'regExpr.pick.listLabel',
    'regExpr.row.wrongKind',
    'regExpr.insert.hint',
    'regExpr.insert.wrongKind',
  ]

  it('every key that names it uses the one term', () => {
    const term = TH['canvas.nodeKind.register']
    expect(REGISTER_KEYS.filter((k) => !TH[k].includes(term))).toEqual([])
  })

  it('`บันทึก` appears in none of them', () => {
    expect(REGISTER_KEYS.filter((k) => TH[k].includes('บันทึก'))).toEqual([])
  })

  it('the ban is scoped — `บันทึก` is correct Thai elsewhere', () => {
    // `author.save` and the autosave copy must stay free to use it.
    const elsewhere = KEYS.filter((k) => !REGISTER_KEYS.includes(k) && TH[k].includes('บันทึก'))
    expect(elsewhere.length).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------ plural
describe('every plural block has exactly the `other` arm', () => {
  // `Intl.PluralRules('th')` declares ONE category. A stray `one {…}` would
  // still parse and still render — ICU would simply never select it — so only
  // a check on the SELECTORS can see it.
  //
  // The walk itself lives in `icuPlural.ts`, with its fixtures. What is pinned
  // HERE is that the walk actually reached this catalog: the block count is
  // compared per key against English and asserted as a total, so a guard that
  // stops seeing blocks fails loudly instead of passing over nothing.
  const PLURAL_KEYS = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(EN[k]))

  it('the same keys carry a plural as in English', () => {
    const thPlural = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(TH[k]))
    expect(thPlural.slice().sort()).toEqual(PLURAL_KEYS.slice().sort())
  })

  it('each key has exactly as many blocks as its English original', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      const want = pluralBlocks(EN[k]).length
      const got = pluralBlocks(TH[k]).length
      if (got !== want) bad.push(k + ': en=' + want + ' th=' + got)
    }
    expect(bad).toEqual([])
  })

  it('the walk reaches 19 keys and 23 blocks', () => {
    // MEASURED. Three keys carry more than one block —
    // `import.status.counts` has three, `import.issueSummary` and
    // `import.summary` two each — so `blocks >= keys` would not have caught a
    // walker that found only the first block of a multi-block message.
    expect(PLURAL_KEYS).toHaveLength(19)
    expect(PLURAL_KEYS.reduce((n, k) => n + pluralBlocks(TH[k]).length, 0)).toBe(23)
    expect(PLURAL_KEYS.filter((k) => pluralBlocks(TH[k]).length > 1)).toHaveLength(3)
  })

  it('each block selects only `other`, and every arm keeps `#`', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      for (const block of pluralBlocks(TH[k])) {
        const arms = pluralArms(block)
        if (arms.length !== 1 || arms[0][0] !== 'other') {
          bad.push(k + ': arms ' + arms.map(([s]) => s).join(','))
        }
        for (const [sel, body] of arms) if (!body.includes('#')) bad.push(k + ': `' + sel + '` without #')
      }
    }
    expect(bad).toEqual([])
  })

  it('0, 1, 2 and a million all reach that one arm', () => {
    const pr = new Intl.PluralRules('th-TH')
    expect([0, 1, 2, 1_000_000].map((n) => pr.select(n))).toEqual(['other', 'other', 'other', 'other'])
  })
})

// ------------------------------------------------- parser position vs column
describe('a parser position is a character, a table column is a column', () => {
  const PARSER_KEYS = [
    'error.EXPR_SYNTAX.message',
    'error.EXPR_UNCLOSED_PAREN.message',
    'error.EXPR_UNCLOSED_REF.message',
    'error.EXPR_BAD_ESCAPE.message',
    'error.EXPR_NUMBER_RANGE.message',
    'error.EXPR_BAD_TOKEN.message',
    'import.parseError',
  ]
  const TABLE_KEYS = [
    'import.loc.tableColumnHeader',
    'import.loc.tableRowColumn',
    'import.loc.tableRowColumnHeader',
  ]

  it('the parser messages say `ตำแหน่งอักขระ` and never `คอลัมน์`', () => {
    for (const k of PARSER_KEYS) {
      expect(TH[k], k).toContain('ตำแหน่งอักขระ')
      expect(TH[k].includes('คอลัมน์'), k).toBe(false)
    }
  })

  it('the table messages say `คอลัมน์` and never `ตำแหน่งอักขระ`', () => {
    for (const k of TABLE_KEYS) {
      expect(TH[k], k).toContain('คอลัมน์')
      expect(TH[k].includes('ตำแหน่งอักขระ'), k).toBe(false)
    }
  })
})
