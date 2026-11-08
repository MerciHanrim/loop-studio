import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import desalinationDoc from '../../examples/desalination.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import gachaBannerZonesDoc from '../../examples/gacha-banner-zones.json'
import gachaGeneralDoc from '../../examples/gacha-general.json'
import gachaStandardDoc from '../../examples/gacha-standard.json'
import gachaPickupDoc from '../../examples/gacha-pickup.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import {
  modelVersionForSchema,
  normalizeGraph,
  readSavedFrames,
  type ModelSemanticsVersion,
  type RecommendedRunConfig,
  type SavedFrame,
} from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { readKindsAt, type ResourceKindDecl } from './kinds'
import { hasKindsTable, hasTableMeaning, hasTimetables, hasUnits } from './modelVersion'
import { readTimetables, type Timetable } from './timetable'
import { readDocTime, type DocTime } from './units'

/** docs/mmo-multilingual-layout.md §MML3 — a fixed graph-coordinate rectangle
 *  the camera frames when this Template is opened FROM THE MENU, instead of
 *  fit-all. Locale-independent (graph coords, never a label branch); the zoom
 *  that frames `rect` for the current pane is used, clamped to
 *  `[minZoom, 1.2]`. `minZoom` is a READABILITY floor (chosen by eye so the
 *  smallest supported viewport still shows legible labels), not the L1 LOD
 *  threshold. Applied once per menu-open only — not on language change, reload,
 *  Import / Share / Workspace restore, or Undo / Redo (see Canvas.tsx
 *  `pendingInitialView`). */
export type InitialView = {
  rect: { x: number; y: number; width: number; height: number }
  minZoom: number
  /** issue #344 (docs/diagram-layout.md §DL5.6) — the graph rect that must
   *  open WHOLE (the core start nodes at their widest box over the 18
   *  languages, `layout/templateBoxes.json`): the zoom is capped so it fits the
   *  pane.
   *  Above `minZoom` only; absent ⇒ the plain `rect` fit. */
  keep?: { x: number; y: number; width: number; height: number }
}

export type Template = {
  id: string
  name: string
  blurb: string
  /** `frames` (docs/large-graph-readability-saved-frames.md) — a Template MAY
   *  ship group frames (§SF2 addendum). Read once here through the same
   *  `readSavedFrames` normalisation the Import path uses, so a malformed
   *  canonical entry is dropped/repaired identically. Absent ⇒ no frames, the
   *  pre-#4A behaviour. Titles are localised by the label overlay
   *  (docs/template-label-overlay.md §TLO12). */
  graph: { nodes: LoopNode[]; edges: LoopEdge[]; frames?: SavedFrame[] }
  /** applied to the Monte-Carlo config on load, same as a file's field */
  recommendedRunConfig?: RecommendedRunConfig
  /** §MML3 — a menu-open camera framing (else the camera fits the whole graph) */
  initialView?: InitialView
  /** loop-model/2 — the model-semantics version this Template is authored in
   *  (from its file's `schema`). Absent ⇒ v1. A bundled v2 Template loads as v2
   *  as authored — not the explicit-user-promotion path (§CR2.1a). */
  modelVersion?: ModelSemanticsVersion
  /** loop-model/3 and /4 — the Template's kinds table (with its unit lists) and
   *  step length, read from its file at its declared version exactly as an
   *  Import reads them (`readKindsAt`, `readDocTime`). Absent ⇒ none. */
  kinds?: ResourceKindDecl[]
  time?: DocTime
  /** loop-model/5 — the Template's timetables, read as an Import reads them */
  timetables?: Timetable[]
  /** `false`: kept here — its node labels still follow a locale switch in a
   *  document made from it, and the developer data and checks keep reading it —
   *  but not offered in the Templates menu (desktop or phone). A Template there
   *  is a starting point whose purpose and structure are easy to grasp and that
   *  a user could rebuild; a stress fixture is not (Hanrim / Lumi, 2026-10-14). */
  menu?: false
}

// Out of the menu since 2026-11-07 (Hanrim / Lumi): beside the other Templates
// they show too little, but the files and their checks stay, and a document
// made from one keeps following the language.
// The two acceptance diagrams from SEMANTICS.md §14, framed as a production
// line. Structure and engine numbers are the frozen §14 Variant A / Variant B —
// only the node labels and menu name/blurb carry the production framing.
// Canonical graphs live in examples/equilibrium.json / examples/deadlock.json
// (extracted so the label-overlay drift check reads their ids like every other
// bundled Template); the node-label trajectory is pinned by
// src/model/templates.trajectory.test.ts. English `label`s in the JSON are the
// canonical; the KO overlay (src/i18n/templateLabels/ko.ts) seeds Korean at
// menu open. The menu name / blurb are i18n keys (src/components/templateKeys.ts).
//   Material supply ─3→ Raw inventory(cap10) ─all→ Production split ─w2→
//     Processing(2→1) ─1→ Finished goods(cap3)   └─w1→ Scrap
//   "Balanced production line" adds: Finished goods ─1→ Shipment

/** Build a Template `graph` from a canonical example doc: `normalizeGraph` for
 *  nodes/edges (unchanged), plus `frames` run through the same `readSavedFrames`
 *  §R5-1.1 normalisation the Import path uses. `frames` is attached only when the
 *  doc ships a non-empty, valid set — a frame-less doc yields `{ nodes, edges }`
 *  exactly as before (#4A). Titles are EN canonical here; the label overlay
 *  localises them at menu open (§TLO12). */
function tplGraph(doc: unknown): Template['graph'] {
  const d = doc as { nodes: LoopNode[]; edges: LoopEdge[]; frames?: unknown }
  const base = normalizeGraph({ nodes: d.nodes, edges: d.edges })
  const frames = readSavedFrames(d.frames)
  return frames.length > 0 ? { ...base, frames } : base
}

/** loop-model/3 and /4 — a Template's model version, kinds table and step
 *  length, read from its file as an Import reads them: the unit lists, the
 *  step length and the field units only at version 4 (§M4-1) */
function tplModel(doc: unknown): Pick<Template, 'modelVersion' | 'kinds' | 'time' | 'timetables'> {
  const d = doc as { schema?: unknown; kinds?: unknown; time?: unknown; timetables?: unknown }
  const modelVersion = modelVersionForSchema(d.schema) ?? 1
  const kinds = hasKindsTable(modelVersion) ? readKindsAt(d.kinds, modelVersion) : []
  const time = hasUnits(modelVersion) ? readDocTime(d.time) : undefined
  const read = hasTimetables(modelVersion) ? readTimetables(d.timetables, hasTableMeaning(modelVersion)) : null
  // a bundled file is checked by its tests: one that does not read must not ship
  if (read && !read.ok) throw new Error(`a Template's timetables do not read: ${read.problem.code}`)
  const timetables = read?.ok ? read.tables : []
  return { modelVersion, ...(kinds.length > 0 ? { kinds } : {}), ...(time ? { time } : {}), ...(timetables.length > 0 ? { timetables } : {}) }
}

export const TEMPLATES: Template[] = [
  {
    id: 'equilibrium',
    name: 'Balanced production line',
    blurb:
      'Raw material flows in, production is split between processing and scrap, and finished goods ship out. Raw and finished inventory settle within a few steps and hold flat.',
    graph: tplGraph(equilibriumDoc),
    menu: false,
  },
  {
    id: 'deadlock',
    name: 'Capacity deadlock',
    blurb:
      'The same line with no shipment step, so finished goods have nowhere to go. Finished inventory fills to capacity, raw inventory backs up to its ceiling, supply is throttled to zero, and the whole line stops.',
    graph: tplGraph(deadlockDoc),
    menu: false,
  },
  // #471 — "Seawater desalination process": a facility process flow from intake
  // to the city and the sea, in five numbered frames, at `loop-studio/graph/6`:
  // water is a conserved kind, power and each chemical are not, the rates are
  // authored per day on a 1 h step, and the engine runs on the derived per-step
  // values. The canonical graph is examples/desalination.json; its run is pinned
  // against examples/desalination.expected.json by
  // test/desalination-example.test.ts. A fixed-ratio model with example
  // assumptions, not a validated process model. A 24-hour demand table and six
  // run rules move it. Opens UNLOCKED on the five frames, two rows wide, so the
  // overview stays readable above the Timeline: about 0.31 at 1280 and 0.59 at
  // 1920. `minZoom` lets that overview fit a small window.
  // Menu place: after the two basic examples and before Coffee, so Hanrim's
  // Coffee → MMO → Gacha sequence (below, 2026-09-13) stays as decided.
  {
    id: 'desalination',
    name: 'Seawater desalination process',
    blurb:
      'A seawater reverse-osmosis plant drawn as a process flow, from intake to the city and the sea. It opens on an overview map. Numbers are example assumptions; salinity, pressure and water quality are not computed.',
    graph: tplGraph(desalinationDoc),
    ...tplModel(desalinationDoc),
    recommendedRunConfig: (desalinationDoc as { recommendedRunConfig?: RecommendedRunConfig }).recommendedRunConfig,
    initialView: { rect: { x: 10, y: 25, width: 2040, height: 1035 }, minZoom: 0.2 },
  },
  // "Coffee roastery operations flow" — the first bundled Template authored at
  // schema `loop-studio/graph/2` (loop-model/2). Its five surfaced levers are
  // `resource`-edge `flow` parameter references (`@<id>`). The canonical graph is
  // examples/coffee-roastery.json (built + verified by
  // src/engine/coffee-roastery.fixture.ts); docs/example-coffee-roastery.md is
  // the settled design. Opens EDITABLE — no `canvasLocked` (§CR2.1).
  //
  // Menu order (Hanrim, 2026-09-13): the small basic examples above, then
  // Coffee → MMO → Gacha — realistic small model → large game economy →
  // professional probability/pity verification, each entry a bigger and more
  // specialised step than the last. Coffee moved ahead of MMO (was after it);
  // template ids are unchanged, so no saved/shared file or digest is affected.
  // MMO was not listed in 0.28.1–0.29.0 (`menu: false`); since 0.30.0 it is in
  // the menu again, in this place.
  {
    id: 'coffee-roastery',
    name: 'Coffee roastery operations flow',
    blurb:
      'An operating-flow simulation for looking at how roasting, sales and stock relate, simplified: green beans arrive, some are sold on, the rest are roasted and sold through cafe / online / retail. Change five daily operating values and the stock trajectories and projected results move. A simplified simulation example — not an ERP or real-time monitoring system.',
    graph: tplGraph(coffeeRoasteryDoc),
    recommendedRunConfig: (coffeeRoasteryDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
    modelVersion: modelVersionForSchema((coffeeRoasteryDoc as { schema?: unknown }).schema) ?? 1,
    // issue #344 step 5 (docs/diagram-layout.md §DL5.5), re-placed for the node
    // structure (2026-10-12, share 23-coffee-replace.md): the START SCREEN is
    // the work flow — the four bean levers, the Supply and the Roasting & sales
    // zones and the dessert lever under them, with room for the left tool
    // column; a 1280 x 800 window opens at about 0.71 (level 1 with room, never
    // at the 0.45 edge). The Forecast metrics column is one pan to the right;
    // the whole view (Reset view) shows all three zones at about
    // 0.52 there.
    initialView: { rect: { x: -64, y: -40, width: 1344, height: 864 }, minZoom: 0.46 },
  },
  // The "Early MMO progression (levels 1–15)" demo — a connected play economy.
  // The canonical graph is examples/mmo-progression.json (built + verified by
  // src/engine/mmo-progression.fixture.ts); this entry loads it, no inline copy
  // (docs/example-mmo-progression.md §EM11 / §EM12 Q5).
  // 0.28.1 (Hanrim / Lumi, 2026-10-14) took it out of the Templates menu as a
  // developer stress / regression fixture; 0.30.0 (Hanrim / Lumi, 2026-10-24)
  // puts it back in the menu, unchanged — the same graph, start framing and
  // edit lock. #428 dropped the lock: it opens editable. It is still the largest
  // bundled graph the checks read.
  {
    id: 'mmo-progression',
    name: 'Early MMO progression (levels 1–15)',
    blurb:
      'A connected play economy: three zone lanes, probabilistic combat, categorised loot, a gold economy with repair and resupply costs, and a rising XP-per-level curve.',
    graph: tplGraph(mmoProgressionDoc),
    recommendedRunConfig: (mmoProgressionDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
    // §MML3 — this graph is ~3500 px wide; fit-all opens it as an unreadable
    // map. Frame just the FIRST steps instead — Character creation → Active
    // character → the Starter zone's landmark + encounter / first-combat
    // cluster (bbox ≈ x[40,850] × y[40,400]). Canvas.tsx fits this into the
    // pane MINUS the fixed overlays (Controls left, where shown),
    // left-aligned so the graph reads from its start. `minZoom` is a
    // READABILITY floor (above the L1 threshold `LOD_L1_MIN` = 0.45); tuned
    // by eye at 1280 / 820 px. The rest of the graph is one pan away. Fixed
    // graph coords, no locale branch.
    // issue #344 steps 4–6 (docs/diagram-layout.md §DL5.5–§DL5.6) —
    // readability first: the rect is sized for a zoom of about 1.05 at
    // 1600 x 1000 (node text >= 12 px on screen) inside the Controls rail's
    // reserved column; `keep` holds the core start nodes — Character creation,
    // Active character, Starter encounters and Starter Lv 1–5 — at their
    // widest box over the 18 languages (Thai Starter Lv 1–5, 196 px, ends at
    // 1236), so they open whole at any pane size (1.040 at 1600 x 1000);
    // later paths may start off screen (Reset view shows the whole graph)
    initialView: {
      rect: { x: 44, y: -4, width: 927, height: 368 },
      minZoom: 0.6,
      keep: { x: 48, y: 36, width: 1188, height: 200 },
    },
  },
  // docs/gacha-general.md — the general gacha: ONE banner with no pity,
  // standalone (Lumi, 2026-10-20). The canonical graph is
  // examples/gacha-general.json, built by scripts/gen-gacha-general-example.ts,
  // which reuses the 3-zone comparison's shared graph builder (its General /
  // Free zone); the standalone example's run is checked by its own tests
  // (src/engine/gacha-general.test.ts, e2e/gacha-general.spec.ts). Opens
  // UNLOCKED (a model to learn from and edit) and fitted whole: no
  // `initialView`.
  {
    id: 'gacha-general',
    name: 'General gacha',
    blurb:
      'One banner with no pity. For each ticket the roll picks SSR, SR or R by weight (chance = weight ÷ the sum of the weights), and the result counts and the pulls made add up. The SSR hit rate is computed with the target pulls as its denominator. It differs from the ratio over the pulls actually made during a run, and equals the observed hit rate once the target is reached. The completion signal is a pool holding 1; the step after the pulls made reach the target, the end takes that 1 and the run stops.',
    graph: tplGraph(gachaGeneralDoc),
    recommendedRunConfig: (gachaGeneralDoc as { recommendedRunConfig?: RecommendedRunConfig }).recommendedRunConfig,
    modelVersion: modelVersionForSchema((gachaGeneralDoc as { schema?: unknown }).schema) ?? 1,
  },
  // docs/gacha-standard.md — the standard gacha: ONE banner with a hard pity
  // ceiling, standalone (Lumi, 2026-10-20). The canonical graph is
  // examples/gacha-standard.json, built by scripts/gen-gacha-standard-example.ts
  // from the 3-zone comparison's shared graph builder (its Premium Standard
  // zone), with one reviewed structural change: the forced SSR feeds the SSR
  // result, which handles every SSR. Checked step by step against the zone's
  // structure (src/engine/gacha-standard.test.ts) and as opened from the menu
  // (e2e/gacha-standard.spec.ts). Opens UNLOCKED and fitted whole: no
  // `initialView`. Its pity block is a saved frame.
  {
    id: 'gacha-standard',
    name: 'Standard gacha',
    blurb:
      'One banner with a hard pity ceiling. The pity counter goes up by one on an SR or an R and back to 0 on an SSR; once it reaches the ceiling − 1, the next pull is a forced SSR, which goes through the same SSR result as a natural one and is also counted in the ceiling hits. The hit rate and the end are as in the General gacha.',
    graph: tplGraph(gachaStandardDoc),
    recommendedRunConfig: (gachaStandardDoc as { recommendedRunConfig?: RecommendedRunConfig }).recommendedRunConfig,
    modelVersion: modelVersionForSchema((gachaStandardDoc as { schema?: unknown }).schema) ?? 1,
  },
  // docs/gacha-pickup.md — the pickup gacha: ONE banner with a hard pity
  // ceiling and a pickup guarantee, standalone (Lumi, 2026-10-20). The
  // canonical graph is examples/gacha-pickup.json, built by
  // scripts/gen-gacha-pickup-example.ts from the 3-zone comparison's shared
  // graph builder (its Premium Pickup zone), with the adopted structure: the
  // standard gacha's flow into one SSR result, then the guarantee block (the
  // pickup confirmation when owed, else the pickup split). Its transition
  // table per state is the zone's (src/engine/gacha-pickup.test.ts); opened from
  // the menu: e2e/gacha-pickup.spec.ts. Opens UNLOCKED and fitted whole: no
  // `initialView`. Its two blocks are saved frames.
  {
    id: 'gacha-pickup',
    name: 'Pickup gacha',
    blurb:
      'One banner with a hard pity ceiling and a pickup guarantee. Every SSR, natural or forced, goes through one SSR result; while no pickup is owed, the pickup split decides pickup or off-pickup by weight, and an off-pickup SSR makes the next SSR a certain pickup. SR and R pulls keep the guarantee; the pickup SSR uses it. The hit rates and the end are as in the General gacha.',
    graph: tplGraph(gachaPickupDoc),
    recommendedRunConfig: (gachaPickupDoc as { recommendedRunConfig?: RecommendedRunConfig }).recommendedRunConfig,
    modelVersion: modelVersionForSchema((gachaPickupDoc as { schema?: unknown }).schema) ?? 1,
  },
  // docs/gacha-banner-zones.md (GZ) — the 3-zone gacha banner comparison. The
  // canonical graph is examples/gacha-banner-zones.json, built by
  // scripts/gen-gacha-banner-zones-example.ts from the SAME graph builder the
  // engine fixture (src/engine/gacha-banner-zones.test.ts) uses, so the
  // shipped Template and the tested graph can never drift apart. Opens LOCKED
  // (GZ2/GZ3 — every zone's own `recommendedRunConfig.canvasLocked`).
  {
    id: 'gacha-banner-zones',
    name: '3-zone gacha banner comparison',
    blurb:
      'Compare three banner rule sets under the same 200-pull budget: a free zone with no pity, a Premium Standard zone with a tunable hard-pity ceiling, and a Premium Pickup zone that adds a pickup-guarantee on top. Run it or Monte-Carlo it to see how pity and the guarantee reshape the outcome distribution.',
    graph: tplGraph(gachaBannerZonesDoc),
    recommendedRunConfig: (gachaBannerZonesDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
    modelVersion: modelVersionForSchema((gachaBannerZonesDoc as { schema?: unknown }).schema) ?? 1,
    // §MML3 (Hanrim, 2026-09-13, live-preview review) — the 3 zones sit side
    // by side across ~3980 graph units (docs/gacha-banner-zones.md's layout
    // round 2); at a 1280-wide pane, fitting all three at once caps out
    // around 0.2-0.3 zoom no matter how the nodes are arranged — under the
    // ~0.45 L1 readability floor MMO's own initialView is tuned against, so
    // node labels read as noise, not text. Fit-all still shows every zone (no
    // overlaps, e2e-checked) for anyone who zooms out; opened FROM THE MENU,
    // frame the comparison row + the Free zone instead — the headline numbers
    // for all 3 zones plus one fully-legible zone to read the roll/count
    // pattern from, Standard/Pickup one pan to the right away, mirroring the
    // MMO precedent's own "rest is a pan away" framing.
    //
    // Recalibrated (Hanrim/Lumi review after PR #198's comparison-frame
    // fixes): the rect below was sized against an EARLIER, narrower
    // comparison-row width. Once the frame-clipping fix (footprint sizing)
    // and the termination-plumbing strip landed, the real comparison row
    // grew to 1720 graph units wide and the Free zone frame to y:[0,810] —
    // the stale `width: 1620` rect no longer covered the row's true width,
    // so the 5th comparison card could render OUTSIDE the intended crop at
    // 1280×720 (a real regression, caught by a fresh-page, no-fitView e2e
    // test — an earlier interactive-browser zoom reading of 1.2 that seemed
    // to clear this had been a stale leftover viewport in that tab, not a
    // genuine fresh measurement). Rect now matches the CURRENT comparison
    // row + Free zone bbox exactly (1720×810) plus a small margin; `minZoom`
    // lowered from 0.6 to 0.45 (the same L1 readability floor MMO's own
    // initialView is tuned against) specifically so the floor never again
    // silently overrides the width-driven natural fit and reintroduces this
    // exact class of overflow if the layout shifts slightly in the future.
    // Fixed graph coords, no locale branch (comparison row 0-1720 + Free
    // zone 0-950 x 0-810).
    // issue #344 step 4 (§DL5.5) — the comparison frame + the Free zone frame
    // at their placed coordinates, 40 px margin: { x: -40, y: -56, width: 2080, height: 1136 }.
    // Node structure (2026-10-12, layout round 10 of the generator): the zones
    // are stacked as blocks — the comparison row (with the termination nodes)
    // on top, Free and Standard under it, Pickup below. The start keeps the
    // same idea: the comparison frame + the Free zone frame at their placed
    // coordinates (-32, -16, 1568 × 208 and -32, 256, 1408 × 896) plus a 40 px
    // margin — the headline numbers and one legible zone; Standard one pan to
    // the right, Pickup one pan down. Whole view (≈ 0.25 at 1280 × 800) and
    // start screen are judged apart; adopted by Lumi (2026-10-12).
    initialView: { rect: { x: -72, y: -56, width: 1648, height: 1248 }, minZoom: 0.45 },
  },
]

/** the Templates the menu offers (desktop and phone): every entry but the ones
 *  marked `menu: false` */
export const MENU_TEMPLATES: readonly Template[] = TEMPLATES.filter((t) => t.menu !== false)
