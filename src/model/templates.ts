import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
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
}

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

export const TEMPLATES: Template[] = [
  {
    id: 'equilibrium',
    name: 'Balanced production line',
    blurb:
      'Raw material flows in, production is split between processing and scrap, and finished goods ship out. Raw and finished inventory settle within a few steps and hold flat.',
    graph: tplGraph(equilibriumDoc),
  },
  {
    id: 'deadlock',
    name: 'Capacity deadlock',
    blurb:
      'The same line with no shipment step, so finished goods have nowhere to go. Finished inventory fills to capacity, raw inventory backs up to its ceiling, supply is throttled to zero, and the whole line stops.',
    graph: tplGraph(deadlockDoc),
  },
  // The "Early MMO progression (levels 1–15)" demo — a connected play economy.
  // The canonical graph is examples/mmo-progression.json (built + verified by
  // src/engine/mmo-progression.fixture.ts); this entry loads it, no inline copy
  // (docs/example-mmo-progression.md §EM11 / §EM12 Q5).
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
    // pane MINUS the fixed overlays (minimap bottom-right, Controls left) so
    // the framed nodes never sit under the minimap, left-aligned so the graph
    // reads from its start. `minZoom` is a READABILITY floor (above the L1
    // threshold `LOD_L1_MIN` = 0.45); tuned by eye at 1280 / 820 px. The rest
    // of the graph is one pan / minimap away. Fixed graph coords, no locale
    // branch.
    initialView: { rect: { x: 0, y: 0, width: 880, height: 360 }, minZoom: 0.6 },
  },
  // "Coffee roastery operations flow" — the first bundled Template authored at
  // schema `loop-studio/graph/2` (loop-model/2). Its five surfaced levers are
  // `resource`-edge `flow` parameter references (`@<id>`). The canonical graph is
  // examples/coffee-roastery.json (built + verified by
  // src/engine/coffee-roastery.fixture.ts); docs/example-coffee-roastery.md is
  // the settled design. Opens EDITABLE — no `canvasLocked` (§CR2.1).
  {
    id: 'coffee-roastery',
    name: 'Coffee roastery operations flow',
    blurb:
      'An operating-flow simulation for looking at how roasting, sales and stock relate, simplified: green beans arrive, some are sold on, the rest are roasted and sold through cafe / online / retail. Change five daily operating values and the stock trajectories and projected results move. A simplified simulation example — not an ERP or real-time monitoring system.',
    graph: tplGraph(coffeeRoasteryDoc),
    recommendedRunConfig: (coffeeRoasteryDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
    modelVersion: modelVersionForSchema((coffeeRoasteryDoc as { schema?: unknown }).schema) ?? 1,
  },
]
