import { describe, expect, it } from 'vitest'
import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import bufferedStepDoc from '../../examples/module-buffered-step.json'
import rewardSplitDoc from '../../examples/module-reward-split.json'
import { pluralArms, pluralBlocks } from './icuPlural'
import { foldForSearch } from './languageOptions'
import en from './locales/en'
import vi from './locales/vi'
import { moduleLabelOverlay } from './moduleLabels'
import { vi as tplVi, viFrames } from './templateLabels/vi'

// docs/localization.md §L2.21 — the `vi` copy contracts.
//
// WHY THIS FILE LOOKS DIFFERENT FROM `thCopy.test.ts`
//
// Thai is its own script, so a Thai catalog with an English sentence left in it
// announces itself: the characters are from the wrong script. Vietnamese is
// LATIN. `Monte Carlo` and `Pan mode off — drag empty canvas to pan` are the
// same alphabet as `Bể chứa`, so no character class, no script run and no
// "which alphabet is this" test can tell a finished translation from one that
// was never started.
//
// So the primary contract here is an EXACT KEY-AND-VALUE SET: every runtime
// string whose value equals its English original is declared below, with the
// value written out. Nothing may be identical to English without appearing in
// that list, and the list carries the string itself, so silently swapping one
// English leftover for another fails too.
//
// Behind it sit two derived contracts that catch PARTIAL non-translation — an
// English head word in front of a translated clause, which is what actually
// happened while this locale was being written:
//
//   * the exact set of strings carrying an ASCII-only word that is also in
//     their English original, and
//   * the exact vocabulary those words may come from.
//
// Both were MEASURED, then declared. The tokenizer splits on Unicode letters,
// never on the ASCII class: `sửa` is one word, not `s` + `a`, and a scan that
// gets that wrong reports forty-two phantom leaks.
//
// WHAT IS DELIBERATELY NOT LOCKED
//
//   * the spelling of `Bộ chia` for Gate, or `Giá trị tính toán` for
//     Register. The SURFACES must agree and that is pinned; the words are
//     provisional until a native review, so a later rename moves every surface
//     together and this file keeps passing without being edited to bless a new
//     string.
//   * `Pickup` staying English. It is what Vietnamese gacha players write
//     today, but that was read off other locales and the genre press, not off a
//     native reviewer. It is declared per key below, not waived script-wide.
//   * whether `hạt giống` is the right word for a random seed. It is what ru,
//     th, fr and de all do in their own languages — none of the thirteen keep
//     `seed` — and what is pinned is that ALL SIX places naming it agree.

const EN = en as Record<string, string>
const VI = vi as Record<string, string>
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

/** Every runtime string `vi` ships, as `[surface, id, value]`. The four
 *  surfaces are checked TOGETHER on purpose: the `pt-BR` lesson was that a
 *  guard reading only the catalog misses what the overlays carry, and the one
 *  English label that survived this locale's first pass — `General / Free` —
 *  was on the FRAME surface, not in the catalog at all. */
const RUNTIME: [string, string, string][] = [
  ...KEYS.map((k) => ['catalog', k, VI[k]] as [string, string, string]),
  ...Object.entries(tplVi).flatMap(([t, map]) =>
    Object.entries(map).map(([id, v]) => ['template/' + t, id, v] as [string, string, string]),
  ),
  ...Object.entries(viFrames).flatMap(([t, map]) =>
    Object.entries(map).map(([id, v]) => ['frame/' + t, id, v] as [string, string, string]),
  ),
  ...['buffered-step', 'reward-split'].flatMap((id) =>
    Object.entries(moduleLabelOverlay(id, 'vi') ?? {}).map(
      ([n, v]) => ['module/' + id, n, v] as [string, string, string],
    ),
  ),
]

/** The English counterpart of a runtime string, for the derived checks.
 *
 *  `moduleLabelOverlay(id, 'en')` returns UNDEFINED — English is the canonical
 *  and has no overlay, exactly as it has no template-label dictionary. The
 *  first version of this file forgot that and fell back to `''` for the module
 *  surface, which made every English-comparison check on those 19 labels
 *  silently VACUOUS: a value can never equal `''`, so no module label could be
 *  reported as identical to English, and no ASCII word could be reported as
 *  kept from it. The counts still passed, because the counts were counting the
 *  right number of the wrong thing. The canonical labels live in the module
 *  graphs, so they are read from there — the same way the template ones are. */
const EN_MODULE: Record<string, Record<string, string>> = {}
for (const [id, doc] of [
  ['buffered-step', bufferedStepDoc],
  ['reward-split', rewardSplitDoc],
] as [string, GraphDocLike][]) {
  const m: Record<string, string> = {}
  for (const n of doc.nodes ?? []) if (n.data?.label) m[n.id] = n.data.label
  EN_MODULE[id] = m
}

const englishFor = (surface: string, id: string): string => {
  if (surface === 'catalog') return EN[id] ?? ''
  if (surface.startsWith('module/')) return EN_MODULE[surface.slice(7)]?.[id] ?? ''
  const tpl = surface.replace(/^(template|frame)\//, '')
  return EN_TPL[tpl]?.[id] ?? ''
}

// ------------------------------------------------------------------ shape
describe('vi copy — the first locale English hides inside', () => {
  it('has exactly the base key set', () => {
    expect(Object.keys(VI).sort()).toEqual(KEYS.slice().sort())
    expect(KEYS).toHaveLength(851)
  })

  it('covers all four runtime surfaces', () => {
    expect(RUNTIME.filter(([s]) => s === 'catalog')).toHaveLength(851)
    expect(RUNTIME.filter(([s]) => s.startsWith('template/'))).toHaveLength(196)
    expect(RUNTIME.filter(([s]) => s.startsWith('frame/'))).toHaveLength(7)
    expect(RUNTIME.filter(([s]) => s.startsWith('module/'))).toHaveLength(19)
  })

  it('has no empty value anywhere', () => {
    expect(RUNTIME.filter(([, , v]) => !v || !v.trim()).map(([s, k]) => s + ':' + k)).toEqual([])
  })
})

// --------------------------------------------------------- identical to en
/** EVERY runtime string equal to its English original, with its value.
 *
 *  This is the primary contract, and the reason is in the header: with a Latin
 *  script nothing else can see an untranslated string. The first pass of this
 *  locale had NINETEEN more entries here — the `enum.*` dropdown values, both
 *  `seed` labels and the Tab delimiter — and every one of the other thirteen
 *  locales translates all nineteen. A count would have hidden that behind a
 *  number; the pairs do not.
 *
 *  Each entry is one of four things, and nothing else qualifies:
 *    · a product name (`Monte Carlo`) or a file's name (`Graph JSON`)
 *    · a placeholder or format example the user types back verbatim
 *    · a rarity letter or mechanism name the genre writes in English
 *    · a banner's proper name (`Premium Standard`), as in ru, tr and th */
const IDENTICAL_TO_EN: [string, string][] = [
  ['catalog:export.graphJson.name', 'Graph JSON'],
  ['catalog:export.workspaceJson.name', 'Workspace JSON'],
  ['catalog:help.contextual.hint.mc.name', 'Monte Carlo'],
  ['catalog:import.qs.mapping', 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}'],
  ['catalog:inspector.edge.flowParam.resolved', '= {value}'],
  ['catalog:inspector.edge.flowPlaceholder', '1, all, 2D6, 1-3, 25%'],
  ['catalog:inspector.expr.activatorPlaceholder', '>= 5'],
  ['catalog:inspector.expr.labelPlaceholder', '+1   ·   -2   ·   =S'],
  ['catalog:mc.title', 'Monte Carlo'],
  ['catalog:playbar.mc', 'Monte Carlo'],
  ['catalog:playbar.mc.progress', 'Monte Carlo {pct}%'],
  ['catalog:playbar.mc.withNote', 'Monte Carlo · {note}'],
  ['catalog:regExpr.row.generic', '— {code}'],
  ['catalog:timeline.csv', 'CSV'],
  ['catalog:tour.nav.position', '{n} / {total}'],
  ['frame/gacha-banner-zones:zone_pickup', 'Premium Pickup'],
  ['frame/gacha-banner-zones:zone_standard', 'Premium Standard'],
  ['template/gacha-banner-zones:pity_pickup', 'Pity'],
  ['template/gacha-banner-zones:pity_standard', 'Pity'],
  ['template/gacha-banner-zones:r_hit_free', 'R'],
  ['template/gacha-banner-zones:r_hit_pickup', 'R'],
  ['template/gacha-banner-zones:r_hit_standard', 'R'],
  ['template/gacha-banner-zones:sr_hit_free', 'SR'],
  ['template/gacha-banner-zones:sr_hit_pickup', 'SR'],
  ['template/gacha-banner-zones:sr_hit_standard', 'SR'],
  ['template/gacha-banner-zones:ssr_hit_free', 'SSR'],
  ['template/gacha-banner-zones:ssr_hit_standard', 'SSR'],
  ['template/mmo-progression:xp', 'XP'],
]

describe('a string identical to English is declared, with its value', () => {
  it('the set of identical strings is exactly the declared one', () => {
    const actual = RUNTIME.filter(([s, id, v]) => v === englishFor(s, id)).map(
      ([s, id, v]) => [s + ':' + id, v] as [string, string],
    )
    expect(actual.slice().sort((a, b) => a[0].localeCompare(b[0]))).toEqual(
      IDENTICAL_TO_EN.slice().sort((a, b) => a[0].localeCompare(b[0])),
    )
    expect(IDENTICAL_TO_EN).toHaveLength(28)
  })

  it('every declared pair still reads back the value it declares', () => {
    // Belt and braces: the check above compares two lists built the same way,
    // so a bug in `englishFor` could make both sides wrong together. This
    // reads the live value by id instead.
    const live = new Map(RUNTIME.map(([s, id, v]) => [s + ':' + id, v]))
    for (const [k, v] of IDENTICAL_TO_EN) expect(live.get(k), k).toBe(v)
  })

  it('the dropdown values a user reads are NOT among them', () => {
    // The nineteen that were. Named explicitly so the specific regression this
    // file was written for cannot come back quietly as "one more declaration".
    const REGRESSED = [
      'playbar.seed', 'dist.seed', 'import.delimiterTab',
      'enum.activation.passive', 'enum.activation.automatic',
      'enum.activation.onStart', 'enum.activation.interactive',
      'enum.flowMode.pullAny', 'enum.flowMode.pullAll',
      'enum.flowMode.pushAny', 'enum.flowMode.pushAll',
      'enum.distribution.deterministic', 'enum.distribution.probabilistic',
      'enum.format.int', 'enum.format.float', 'enum.format.percent',
      'enum.stateMode.trigger', 'enum.stateMode.activator', 'enum.stateMode.label',
    ]
    expect(REGRESSED).toHaveLength(19)
    expect(REGRESSED.filter((k) => VI[k] === EN[k])).toEqual([])
  })
})

// ------------------------------------------------------------ ASCII words
/** ICU syntax, then the plain slots. What remains is prose plus whatever ASCII
 *  the translation deliberately kept. The arm BODIES survive — the `tr` hole
 *  was stripping whole `{…}` groups and losing the sentences inside. */
const stripIcu = (s: string) =>
  s
    .replace(/\{\s*[A-Za-z0-9_]+\s*,\s*(?:plural|select|selectordinal)\s*,/g, ' ')
    .replace(/\b(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ')
    .replace(/\boffset\s*:\s*-?\d+/g, ' ')
    .replace(/\{\s*[A-Za-z0-9_]+\s*\}/g, ' ')
    .replace(/[{}]/g, ' ')

/** Words, split on the UNICODE letter class, then narrowed to the ones that are
 *  pure ASCII.
 *
 *  Splitting on `[A-Za-z]+` instead — which is what every previous locale's
 *  guard does, because in those scripts it is equivalent — is WRONG here and
 *  quietly so: it cuts `sửa` into `s` and `a`, `phóng to` keeps its real `to`,
 *  and the result is a list of phantom English words long enough to bury the
 *  four real ones. A Vietnamese word that carries any diacritic simply never
 *  reaches this list; the ones that survive are exactly the ambiguous set. */
const asciiWords = (s: string) =>
  [...stripIcu(s).matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*/gu)]
    .map((m) => m[0])
    .filter((w) => /^[A-Za-z][A-Za-z0-9_]*$/.test(w))
    .map((w) => w.toLowerCase())

/** Proper nouns: brands, products and one country. */
const ASCII_PROPER = [
  'loop', 'studio', 'machinations', 'io', 'github', 'google', 'sheets',
  'excel', 'numbers', 'monte', 'carlo', 'mc', 'mmo', 'brazil',
]
/** File formats and the export commands named after them. */
const ASCII_FILE_FORMAT = ['json', 'csv', 'tsv', 'xlsx', 'graph', 'workspace', 'montecarloresult']
/** Keyboard keys, as printed on the key. A translated key name would tell the
 *  reader to press something that is not on their keyboard. */
const ASCII_KEYBOARD = [
  'enter', 'space', 'shift', 'backspace', 'delete', 'escape', 'esc', 'alt',
  'ctrl', 'cmd', 'z', 'v',
]
/** Wire tokens: stored enum values, model-version tags, expression syntax,
 *  share-URL fragments and the axis letters in the a11y messages. Every one is
 *  something the user types or the document stores verbatim. `resource` and
 *  `state` are here because they are the two edge `type` values — th and ru
 *  keep them in English for the same reason, while fr and de translate them. */
const ASCII_WIRE = [
  'id', 'n', 's', 'x', 'y', 'v1', 'v2', 'g1', 'd6', 'all', 'p10', 'p50', 'p90',
  'resource', 'state', 'timing', 'when',
]
/** The spreadsheet column names in the quick-start mapping example. */
const ASCII_COLUMN = ['item_id', 'item_name', 'price', 'drop_rate']
/** Loanwords Vietnamese writes as they are: a browser `tab`, the `web`, and the
 *  two words the gacha genre uses untranslated in Vietnamese as well. */
const ASCII_LOANWORD = ['tab', 'web', 'banner', 'gacha']
/** Placeholder examples, the canonical `resourceType` tokens a user may type,
 *  the rarity letters, and the one unit. `gold` is here only because
 *  `inspector.resourceType.placeholder` lists the tokens verbatim — the mmo
 *  template's resource itself reads `Vàng`.
 *
 *  `free` and `general` were here until the full EN↔VI read-back: the gacha
 *  FRAME said `Thường / Miễn phí` while five node labels INSIDE it still said
 *  `General / Free`, so the same banner had two names. The nodes now follow the
 *  frame and neither word is kept anywhere. */
const ASCII_EXAMPLE = [
  'alex', 'gold', 'energy', 'xp', 'player', 'item',
  'premium', 'standard', 'r', 'sr', 'ssr', 'kg',
]
/** Vietnamese words that happen to be pure ASCII AND to spell an English word
 *  present in the same English original: `so sánh` (compare) against "so", and
 *  `phóng to` (zoom in) against "to". Neither is a leak; both are here so the
 *  set below can stay exact. */
const ASCII_VIETNAMESE = ['so', 'to']

const ASCII_GROUPS: [string, string[]][] = [
  ['proper noun', ASCII_PROPER],
  ['file format', ASCII_FILE_FORMAT],
  ['keyboard key', ASCII_KEYBOARD],
  ['wire token', ASCII_WIRE],
  ['column name', ASCII_COLUMN],
  ['loanword', ASCII_LOANWORD],
  ['example', ASCII_EXAMPLE],
  ['Vietnamese', ASCII_VIETNAMESE],
]
const ASCII_GLOBAL = new Set(ASCII_GROUPS.flatMap(([, g]) => g))

/** The three gacha mechanism names are allowed PER KEY, not catalog-wide.
 *  `Pity` and `Pickup` are the terms the genre uses in Vietnamese too, but they
 *  are the vocabulary of one template — letting them float free would make
 *  `Pickup` legal in, say, a toolbar tooltip. */
const ASCII_KEY_SCOPED: Record<string, string[]> = {
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

/** Every runtime string that shares an ASCII word with its English original.
 *  A string NOT on this list must have translated every word it kept, so an
 *  English head word in front of a Vietnamese clause — `activator — bật / tắt
 *  đích`, which is exactly what this locale shipped in its first pass —
 *  announces itself here before any vocabulary question is asked. */
const ASCII_KEYS = [
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
  'catalog:export.projectRevision.blurb',
  'catalog:export.projectRevision.disclosure.body',
  'catalog:export.workspace.reject',
  'catalog:export.workspaceJson.name',
  'catalog:help.contextual.hint.mc.desc',
  'catalog:help.contextual.hint.mc.name',
  'catalog:help.contextual.intro',
  'catalog:hint.frameMove.body',
  'catalog:hint.mc.body',
  'catalog:import.commitError.parameter-id-collision',
  'catalog:import.commitError.source-table-id-collision',
  'catalog:import.delimiterTab',
  'catalog:import.error.invalidJson',
  'catalog:import.error.notLoopStudio',
  'catalog:import.ignoreLastRows',
  'catalog:import.issue.duplicate-source-table-id',
  'catalog:import.issue.missing-key-column',
  'catalog:import.issue.missing-source-column-id',
  'catalog:import.issue.ragged-row',
  'catalog:import.parseError',
  'catalog:import.parseErrorsBlockValidation',
  'catalog:import.pasteAria',
  'catalog:import.pasteDataRequired',
  'catalog:import.pastePlaceholder',
  'catalog:import.qs.body',
  'catalog:import.qs.download',
  'catalog:import.qs.fullGuideAria',
  'catalog:import.qs.mapping',
  'catalog:import.qs.notImported.formulas',
  'catalog:import.qs.notImported.list',
  'catalog:import.qs.sources.excel',
  'catalog:import.qs.sources.privacy',
  'catalog:import.qs.sources.sheets',
  'catalog:import.qs.sources.summary',
  'catalog:import.refresh.exportCsv',
  'catalog:import.refreshIssue.duplicate-source-column-id',
  'catalog:import.roleHelp.ignored',
  'catalog:import.roleHelp.key',
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
  'catalog:language.portugueseBrazil',
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
  'catalog:review.differentProject',
  'catalog:review.fail.versionMismatch',
  'catalog:review.gate.versionMismatch',
  'catalog:revision.export.noSecureRandom',
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
  'catalog:templates.gachaBannerZones.name',
  'catalog:templates.mmoProgression.name',
  'catalog:timeline.csv',
  'catalog:timeline.csvTitle',
  'catalog:toolbar.buildTitle',
  'catalog:toolbar.redo.title',
  'catalog:toolbar.undo.title',
  'catalog:tour.desktop.canvas.body',
  'catalog:tour.help.about',
  'catalog:tour.help.feedbackAria',
  'catalog:tour.mobile.canvas.body',
  'catalog:tour.mobile.open.body',
  'catalog:tour.welcome.title',
  'frame/gacha-banner-zones:zone_pickup',
  'frame/gacha-banner-zones:zone_standard',
  'template/coffee-roastery:cafe_retail_demand_kg',
  'template/coffee-roastery:daily_roast_kg',
  'template/coffee-roastery:green_wholesale_kg',
  'template/coffee-roastery:online_orders',
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

describe('a kept English word is declared, twice over — by key and by word', () => {
  const sharedWith = (surface: string, id: string, v: string) => {
    const enW = new Set(asciiWords(englishFor(surface, id)))
    return [...new Set(asciiWords(v))].filter((w) => enW.has(w))
  }

  it('the strings keeping an English word are exactly the declared ones', () => {
    const actual = RUNTIME.filter(([s, id, v]) => sharedWith(s, id, v).length > 0).map(
      ([s, id]) => s + ':' + id,
    )
    expect(actual.slice().sort()).toEqual(ASCII_KEYS.slice().sort())
    expect(ASCII_KEYS).toHaveLength(166)
  })

  it('the kept vocabulary is exactly the declared one', () => {
    const seen = new Set<string>()
    for (const [s, id, v] of RUNTIME) for (const w of sharedWith(s, id, v)) seen.add(w)
    const declared = new Set([...ASCII_GLOBAL, ...Object.keys(ASCII_KEY_SCOPED)])
    expect([...seen].sort()).toEqual([...declared].sort())
    expect(declared.size).toBe(75)
  })

  it('the groups are disjoint, and they add up', () => {
    // Otherwise a word could be quietly moved between groups, and the reason it
    // is kept — which is the whole content of this list — would rot.
    expect(ASCII_GROUPS.map(([, g]) => g.length)).toEqual([14, 7, 12, 17, 4, 4, 12, 2])
    const all = ASCII_GROUPS.flatMap(([, g]) => g)
    expect(all).toHaveLength(ASCII_GLOBAL.size)
    for (const w of Object.keys(ASCII_KEY_SCOPED)) expect(ASCII_GLOBAL.has(w)).toBe(false)
  })

  it('a key-scoped word appears in exactly the keys that declare it', () => {
    for (const [word, keys] of Object.entries(ASCII_KEY_SCOPED)) {
      const actual = RUNTIME.filter(([s, id, v]) => sharedWith(s, id, v).includes(word)).map(
        ([s, id]) => s + ':' + id,
      )
      expect(actual.sort(), word).toEqual(keys.slice().sort())
    }
  })

  it('and, behind that, a declared word appears only where English put it', () => {
    // The SECONDARY contract, and the one that keeps the two lists above from
    // being a licence: `standard` cannot drift from the gacha template into a
    // tooltip that is already on the key list for an unrelated reason.
    //
    // It is scoped to the DECLARED words, which is where it differs from the
    // same check in `thCopy.test.ts`. There the rule is "no Latin word may
    // appear that English did not put there", and it can be, because Thai prose
    // contains no Latin at all. Vietnamese prose is written in ASCII whenever a
    // syllable happens to carry no diacritic — `thu`, `cho`, `khi`, `sang` —
    // and measured on this catalog the unscoped form reports 688 of them. Every
    // one is correct Vietnamese, so the unscoped rule here would not be a
    // stricter check, it would be a broken one.
    // `ASCII_VIETNAMESE` is excluded because those two words are not kept
    // English at all — asking where English put `so sánh` is meaningless.
    const declared = new Set(
      [...ASCII_GLOBAL, ...Object.keys(ASCII_KEY_SCOPED)].filter(
        (w) => !ASCII_VIETNAMESE.includes(w),
      ),
    )
    const bad: string[] = []
    for (const [surface, id, v] of RUNTIME) {
      // Vietnamese does not mark plural, so an English `banners` licenses
      // `banner` — and only that, never the other way round.
      const allowed = new Set(
        asciiWords(englishFor(surface, id)).flatMap((w) =>
          w.endsWith('s') ? [w, w.slice(0, -1)] : [w],
        ),
      )
      for (const w of asciiWords(v)) {
        if (declared.has(w) && !allowed.has(w)) bad.push(surface + ':' + id + ' — ' + w)
      }
    }
    expect(bad).toEqual([])
  })

  it('the tokenizer splits on letters, not on the ASCII class', () => {
    // The check that keeps the check honest. `[A-Za-z]+` cuts a Vietnamese word
    // at every diacritic and turns `sửa` into `s` and `a`; measured on this
    // catalog that invented 51 phantom hits and 7 phantom words, `a` alone
    // appearing in 42 strings.
    expect(asciiWords('Việc chỉnh sửa nằm trên máy tính.')).toEqual([])
    expect(asciiWords('Bộ kích hoạt — bật / tắt đích')).toEqual([])
    expect(asciiWords('activator — bật / tắt đích')).toEqual(['activator'])
    // …and what SURVIVES the fix is still Vietnamese, not English: both of
    // these are real words of `phóng to thu nhỏ` (zoom in and out). That is why
    // the check above is scoped to the declared vocabulary.
    expect(asciiWords('phóng to thu nhỏ')).toEqual(['to', 'thu'])
  })
})

// ------------------------------------------------------------------ script
describe('every character is Latin, and every string is NFC', () => {
  const ALLOWED = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u

  it('no character comes from a script outside the allowed set', () => {
    const bad: string[] = []
    for (const [surface, id, v] of RUNTIME) {
      if (ALLOWED.test(v)) continue
      const offenders = [...v].filter(
        (c) => !/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(c),
      )
      bad.push(
        surface + ':' + id + ' — ' +
          offenders.map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' '),
      )
    }
    expect(bad).toEqual([])
  })

  it('Vietnamese-specific letters are actually present — the check is not vacuous', () => {
    // `ă đ ơ ư` and the tone-mark block are what make this Vietnamese rather
    // than any other Latin locale. A pure-ASCII catalog would pass everything
    // above this line.
    const VIET = /[ăđơưẠ-ỹ]/
    expect(RUNTIME.filter(([, , v]) => VIET.test(v)).length).toBeGreaterThan(700)
  })

  it('every runtime string is NFC, on all four surfaces', () => {
    // Vietnamese is the first locale where this is load-bearing rather than
    // hygiene: `ế` can be written as one code point or as three, they render
    // identically, and only NFC-vs-NFC comparison makes a stored label, a
    // search query and a test fixture line up.
    const bad = RUNTIME.filter(([, , v]) => v.normalize('NFC') !== v).map(([s, k]) => s + ':' + k)
    expect(bad).toEqual([])
  })

  it('no runtime string carries a combining mark at all', () => {
    // Stronger than NFC, and measured: every Vietnamese letter this catalog
    // uses has a precomposed form, so a surviving U+0300..U+031B means a string
    // was pasted from a source that decomposes — the most likely way NFC breaks
    // later.
    const bad = RUNTIME.filter(([, , v]) => /\p{M}/u.test(v)).map(([s, k]) => s + ':' + k)
    expect(bad).toEqual([])
  })

  it('the native name is NFC too', () => {
    // It is the one string rendered while ANOTHER locale is active, so it never
    // goes through the vi catalog's own load path.
    expect(VI['language.vietnamese']).toBe('Tiếng Việt')
    expect(VI['language.vietnamese'].normalize('NFC')).toBe(VI['language.vietnamese'])
    expect([...VI['language.vietnamese']].some((c) => /\p{M}/u.test(c))).toBe(false)
  })
})

// ------------------------------------------------------------------ search
describe('the search surface folds NFC and NFD to the same thing', () => {
  // The picker's search is independent of the display font and of the catalog's
  // own normalisation: the string being folded is whatever an IME produced.
  // Telex and VNI both emit precomposed forms, but a paste from a decomposing
  // source does not, and `ơ`/`ư` are the interesting pair because their mark —
  // U+031B COMBINING HORN — is the one Vietnamese mark that is not a tone.
  const HORN = String.fromCharCode(0x31b)

  it('a bare `o + horn` folds like `ơ`, and `u + horn` like `ư`', () => {
    expect(foldForSearch('o' + HORN)).toBe(foldForSearch('ơ'))
    expect(foldForSearch('u' + HORN)).toBe(foldForSearch('ư'))
    expect(foldForSearch('o' + HORN)).toBe('o')
    expect(foldForSearch('u' + HORN)).toBe('u')
  })

  it('a decomposed endonym folds like the composed one', () => {
    for (const s of [VI['language.vietnamese'], 'Tiếng Đức', 'Tiếng Bồ Đào Nha']) {
      expect(foldForSearch(s.normalize('NFD')), s).toBe(foldForSearch(s.normalize('NFC')))
    }
  })

  it('`đ` folds to `d` — the one letter no mark rule reaches', () => {
    expect(foldForSearch('đ')).toBe('d')
    expect(foldForSearch('Đ')).toBe('d')
    // and it is not a mark, so NFD does not reach it either
    expect('đ'.normalize('NFD')).toBe('đ')
  })
})

// --------------------------------------------------- node kinds, 8 x 3 shape
describe('the eight node kinds name themselves the same way on every surface', () => {
  const KINDS = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'] as const

  it('palette, canvas and default label agree, kind by kind', () => {
    const mismatched: string[] = []
    for (const kind of KINDS) {
      const a = VI['palette.' + kind + '.name']
      const b = VI['canvas.nodeKind.' + kind]
      const c = VI['node.default.' + kind]
      if (!(a && b && c && a === b && b === c)) mismatched.push(kind + ': ' + [a, b, c].join(' | '))
    }
    expect(mismatched).toEqual([])
  })

  it('the eight names are distinct', () => {
    const names = KINDS.map((k) => VI['canvas.nodeKind.' + k])
    expect(new Set(names).size).toBe(KINDS.length)
  })
})

// ---------------------------------------------------------------- glossary
describe('one English noun, one Vietnamese term, everywhere English names it', () => {
  // The WORDS are provisional (native review). What is pinned is that every
  // string whose English original names a product noun carries the SAME
  // Vietnamese term, so a later rename moves all of them together.
  const GLOSSARY: [string, RegExp, string, number][] = [
    ['Pool', /(^|[^A-Za-z])Pools?([^A-Za-z]|$)/, 'Bể chứa', 20],
    ['Source', /(^|[^A-Za-z])Sources?([^A-Za-z]|$)/, 'Nguồn', 4],
    ['Drain', /(^|[^A-Za-z])Drains?([^A-Za-z]|$)/, 'Điểm xả', 5],
    ['Gate', /(^|[^A-Za-z])Gates?([^A-Za-z]|$)/, 'Bộ chia', 5],
    ['Converter', /(^|[^A-Za-z])Converters?([^A-Za-z]|$)/, 'Bộ chuyển đổi', 4],
    ['Parameter', /(^|[^A-Za-z])Parameters?([^A-Za-z]|$)/, 'Tham số', 24],
    ['Register', /(^|[^A-Za-z])Registers?([^A-Za-z]|$)/, 'Giá trị tính toán', 10],
    ['Template', /(^|[^A-Za-z])Templates?([^A-Za-z]|$)/, 'Mẫu', 3],
  ]

  it('English names each noun in the number of keys this locale must keep in step', () => {
    // Pinned so a future English edit that adds a surface cannot make the loop
    // below silently check fewer strings.
    for (const [name, re, , count] of GLOSSARY) {
      expect(KEYS.filter((k) => re.test(EN[k])), name).toHaveLength(count)
    }
  })

  it('every one of them carries the one term, on every surface', () => {
    // Case-insensitively. English capitalises a node kind wherever it names
    // one; Vietnamese capitalises a noun only at the start of a sentence, so
    // `Tham số` and `tham số` are the same term and four strings — among them
    // `import.status.counts`, where it sits inside a plural arm — correctly use
    // the lower-case form.
    //
    // Walked over RUNTIME rather than the catalog, so the 196 node labels, the
    // 7 frame titles and the 19 module labels are inside the contract too.
    const bad: string[] = []
    for (const [name, re, term] of GLOSSARY) {
      for (const [surface, id, v] of RUNTIME) {
        if (!re.test(englishFor(surface, id))) continue
        if (!v.toLowerCase().includes(term.toLowerCase())) {
          bad.push(name + ' / ' + surface + ':' + id + ': ' + v)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('and today the overlays name none of them — measured, not assumed', () => {
    // MEASURED across all 222 overlay slots: not one English template label,
    // frame title or module label names a node kind. That is why the counts
    // above are catalog counts and still describe the whole contract.
    //
    // It is asserted rather than left implicit because it is the kind of fact
    // that stops being true quietly: the moment a bundled Template ships a node
    // called `Gate`, this goes red and the check above starts requiring
    // `Bộ chia` in that label — which is the behaviour wanted, reached by
    // a failing test rather than by someone remembering.
    const named = RUNTIME.filter(([s]) => s !== 'catalog').filter(([surface, id]) =>
      GLOSSARY.some(([, re]) => re.test(englishFor(surface, id))),
    )
    expect(named.map(([s, id]) => s + ':' + id)).toEqual([])
    // non-vacuous: the overlay surfaces ARE being read, and they do have
    // English originals to test
    const overlay = RUNTIME.filter(([s]) => s !== 'catalog')
    expect(overlay).toHaveLength(222)
    expect(overlay.filter(([s, id]) => !englishFor(s, id))).toEqual([])
  })

  it('`khung vẽ` is the canvas, with five declared compressions', () => {
    // English says "empty canvas" in five status strings where Vietnamese says
    // `vùng trống` — the empty AREA — and naming the canvas again would read as
    // a translation, not as Vietnamese. Thai compresses the same five. They are
    // listed rather than waived so a sixth cannot join them quietly.
    const CANVAS = /(^|[^A-Za-z])canvas(es)?([^A-Za-z]|$)/i
    const COMPRESSED = [
      'canvas.frame.draw',
      'canvas.frame.drawing',
      'canvas.panMode.off',
      'canvas.regionSelect.off',
      'canvas.regionSelect.on',
    ]
    const missing = KEYS.filter(
      (k) => CANVAS.test(EN[k]) && !VI[k].toLowerCase().includes('khung vẽ'),
    )
    expect(missing.sort()).toEqual(COMPRESSED.slice().sort())
    for (const k of COMPRESSED) expect(VI[k], k).toContain('vùng trống')
  })
})

// ------------------------------------------------------------------ Register
describe('Register is a calculated value, never `Sổ ghi`', () => {
  // A Register STORES NOTHING — it recomputes every step — so a name built on
  // "record" or "ledger" would describe the opposite of what it does, and
  // `ghi` is already the verb in the save and export copy.
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
    const term = VI['canvas.nodeKind.register']
    expect(term).toBe('Giá trị tính toán')
    expect(REGISTER_KEYS.filter((k) => !VI[k].includes(term))).toEqual([])
  })

  it('`Sổ ghi` appears nowhere at all', () => {
    expect(RUNTIME.filter(([, , v]) => v.includes('Sổ ghi')).map(([s, k]) => s + ':' + k)).toEqual([])
  })
})

// ---------------------------------------------------------------- state mode
describe('the three state modes read the same in the enum and in the picker', () => {
  // `enum.stateMode.*` labels the stored value; `inspector.edge.mode.*` is the
  // sentence the user picks from. They are the same three things, and the first
  // pass of this locale had the enum translated while the picker still opened
  // with the English word.
  const MODES: [string, string][] = [
    ['trigger', 'kích phát'],
    ['activator', 'bộ kích hoạt'],
    ['label', 'nhãn'],
  ]

  it('the enum values are the declared Vietnamese terms', () => {
    for (const [mode, term] of MODES) expect(VI['enum.stateMode.' + mode], mode).toBe(term)
  })

  it('the picker sentence opens with the same term', () => {
    for (const [mode, term] of MODES) {
      expect(VI['inspector.edge.mode.' + mode].toLowerCase(), mode).toContain(term)
    }
  })

  it('the three terms are distinct', () => {
    expect(new Set(MODES.map(([, t]) => t)).size).toBe(3)
  })

  it('the activator preview names the activator, not a generic condition', () => {
    for (const k of [
      'inspector.activator.preview.unknown',
      'inspector.activator.preview.notParam',
      'inspector.activator.preview.nonFinite',
      'inspector.activator.preview.overflow',
    ]) {
      expect(VI[k], k).toContain('bộ kích hoạt')
    }
  })
})

// ------------------------------------------------------------------- seed
describe('a random seed is `hạt giống` on all six surfaces that name it', () => {
  // The label was translated and the tooltip beside it was not. Both render at
  // once, so the mismatch was visible in the product before it was visible to
  // any guard.
  const SEED_KEYS = KEYS.filter((k) => /(^|[^A-Za-z])[Ss]eeds?([^A-Za-z]|$)/.test(EN[k]))

  it('English names a seed in exactly six keys', () => {
    expect(SEED_KEYS.sort()).toEqual(
      [
        'dist.export.runsCsv.blurb',
        'dist.seed',
        'mc.field.baseSeed',
        'playbar.seed',
        'playbar.seed.title',
        'tour.desktop.playback.body',
      ].sort(),
    )
  })

  it('all six carry the one term, and none of them still says `seed`', () => {
    for (const k of SEED_KEYS) {
      expect(VI[k].toLowerCase(), k).toContain('hạt giống')
      expect(/(^|[^A-Za-z])seeds?([^A-Za-z]|$)/i.test(VI[k]), k).toBe(false)
    }
  })
})

// ------------------------------------------------------------------ plural
describe('every plural block has exactly the `other` arm', () => {
  // `Intl.PluralRules('vi')` declares ONE category. A stray `one {…}` would
  // still parse and still render — ICU would simply never select it — so only a
  // check on the SELECTORS can see it.
  //
  // The walk itself lives in `icuPlural.ts`, with its fixtures. What is pinned
  // HERE is that the walk actually reached this catalog: the block count is
  // compared per key against English and asserted as a total, so a guard that
  // stops seeing blocks fails loudly instead of passing over nothing.
  const PLURAL_KEYS = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(EN[k]))

  it('the same keys carry a plural as in English', () => {
    const viPlural = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(VI[k]))
    expect(viPlural.slice().sort()).toEqual(PLURAL_KEYS.slice().sort())
  })

  it('each key has exactly as many blocks as its English original', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      const want = pluralBlocks(EN[k]).length
      const got = pluralBlocks(VI[k]).length
      if (got !== want) bad.push(k + ': en=' + want + ' vi=' + got)
    }
    expect(bad).toEqual([])
  })

  it('the walk reaches 19 keys and 23 blocks', () => {
    // MEASURED. Three keys carry more than one block — `import.status.counts`
    // has three, `import.issueSummary` and `import.summary` two each — so
    // `blocks >= keys` would not have caught a walker that found only the first
    // block of a multi-block message.
    expect(PLURAL_KEYS).toHaveLength(19)
    expect(PLURAL_KEYS.reduce((n, k) => n + pluralBlocks(VI[k]).length, 0)).toBe(23)
    expect(PLURAL_KEYS.filter((k) => pluralBlocks(VI[k]).length > 1)).toHaveLength(3)
  })

  it('each block selects only `other`, and every arm keeps `#`', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      for (const block of pluralBlocks(VI[k])) {
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
    const pr = new Intl.PluralRules('vi-VN')
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

  it('the parser messages say `ký tự thứ` and never `cột`', () => {
    for (const k of PARSER_KEYS) {
      expect(VI[k], k).toContain('ký tự thứ')
      expect(VI[k].includes('cột'), k).toBe(false)
    }
  })

  it('the table messages say `cột` and never `ký tự thứ`', () => {
    for (const k of TABLE_KEYS) {
      expect(VI[k], k).toContain('cột')
      expect(VI[k].includes('ký tự thứ'), k).toBe(false)
    }
  })
})
