import coffeeRoasteryDoc from '../../examples/coffee-roastery.json'
import mmoProgressionDoc from '../../examples/mmo-progression.json'
import { defaultData } from './factory'
import {
  modelVersionForSchema,
  normalizeGraph,
  type ModelSemanticsVersion,
  type RecommendedRunConfig,
} from './serialize'
import type { LoopEdge, LoopNode, NodeData, NodeKind } from './types'

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

type XY = { x: number; y: number }

const node = (
  kind: NodeKind,
  id: string,
  label: string,
  position: XY,
  extra: Partial<NodeData> = {},
): LoopNode => ({
  id,
  type: kind,
  position,
  data: { ...defaultData(kind), label, ...extra } as NodeData,
})

const link = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow },
})

// The two acceptance diagrams from SEMANTICS.md §14, ready to drop on the canvas.
// Source ─3→ Vault(cap10) ─all→ Gate ─w2→ Refine(2→1) ─1→ Product(cap3)
//                                     └─w1→ Spill
// Equilibrium adds: Product ─1→ Consume

const baseNodes = (): LoopNode[] => [
  node('source', 'tpl-src', 'Faucet', { x: 40, y: 190 }),
  node('pool', 'tpl-vault', 'Vault', { x: 250, y: 180 }, { initial: 0, capacity: 10 }),
  node('gate', 'tpl-gate', 'Split', { x: 470, y: 180 }),
  node('converter', 'tpl-conv', 'Refine', { x: 690, y: 110 }),
  node('pool', 'tpl-prod', 'Product', { x: 910, y: 110 }, { initial: 0, capacity: 3 }),
  node('drain', 'tpl-spill', 'Spill', { x: 690, y: 300 }),
]

const baseEdges = (): LoopEdge[] => [
  link('tpl-e1', 'tpl-src', 'tpl-vault', '3'),
  link('tpl-e2', 'tpl-vault', 'tpl-gate', 'all'),
  link('tpl-e3', 'tpl-gate', 'tpl-conv', '2'),
  link('tpl-e4', 'tpl-gate', 'tpl-spill', '1'),
  link('tpl-e5', 'tpl-conv', 'tpl-prod', '1'),
]

export const TEMPLATES: Template[] = [
  {
    id: 'equilibrium',
    name: 'Flowing equilibrium',
    blurb:
      'Source feeds a vault, a gate splits 2:1 into a refiner and a drain, and a second drain bleeds the product. Settles to a steady state (Vault 3, Product 1).',
    graph: {
      nodes: [...baseNodes(), node('drain', 'tpl-consume', 'Consume', { x: 1130, y: 110 })],
      edges: [...baseEdges(), link('tpl-e6', 'tpl-prod', 'tpl-consume', '1')],
    },
  },
  {
    id: 'deadlock',
    name: 'Bottleneck deadlock',
    blurb:
      'The same system with no outlet on the product pool. It fills to capacity, the gate stalls, the vault backs up, and the source is throttled to zero — a stable frozen state.',
    graph: { nodes: baseNodes(), edges: baseEdges() },
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
