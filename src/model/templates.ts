import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import {
  modelVersionForSchema,
  normalizeGraph,
  type ModelSemanticsVersion,
  type RecommendedRunConfig,
} from './serialize'
import type { LoopEdge, LoopNode } from './types'

export type Template = {
  id: string
  name: string
  blurb: string
  graph: { nodes: LoopNode[]; edges: LoopEdge[] }
  /** applied to the Monte-Carlo config on load, same as a file's field */
  recommendedRunConfig?: RecommendedRunConfig
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

export const TEMPLATES: Template[] = [
  {
    id: 'equilibrium',
    name: 'Balanced production line',
    blurb:
      'Raw material flows in, production is split between processing and scrap, and finished goods ship out. Raw and finished inventory settle within a few steps and hold flat.',
    graph: normalizeGraph(
      equilibriumDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] },
    ),
  },
  {
    id: 'deadlock',
    name: 'Capacity deadlock',
    blurb:
      'The same line with no shipment step, so finished goods have nowhere to go. Finished inventory fills to capacity, raw inventory backs up to its ceiling, supply is throttled to zero, and the whole line stops.',
    graph: normalizeGraph(deadlockDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] }),
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
    graph: normalizeGraph(mmoProgressionDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] }),
    recommendedRunConfig: (mmoProgressionDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
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
    graph: normalizeGraph(
      coffeeRoasteryDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] },
    ),
    recommendedRunConfig: (coffeeRoasteryDoc as { recommendedRunConfig?: RecommendedRunConfig })
      .recommendedRunConfig,
    modelVersion: modelVersionForSchema((coffeeRoasteryDoc as { schema?: unknown }).schema) ?? 1,
  },
]
