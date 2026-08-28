import { MarkerType } from '@xyflow/react'
import { defaultData } from '../model/factory'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'

// Builder for examples/risky-factory.json — the hands-on "try every feature"
// demo graph. Not a precision oracle (that stays engine-b-verification.*); a
// smoke test pins only its structural invariants.
//
// One connected economy:
//   Ore Source (2D6) → Ore Stock (cap 50)
//        └─ Ore Router (deterministic 4:1) ─┬─ Refined Ore (cap 12)
//                                           └─ Tailings (cap 15) → Waste Drain (1-3)
//   Energy Source (1-3) → Energy Pool (cap 20)
//   Refined Ore 3 + Energy 1 ─ Assembly Converter ─→ Components (cap 30), 2 Parts
//        └─ Quality Gate (probabilistic 17:2:1) ─┬─ Finished Goods (cap 25) → Sales Drain (1-3)
//                                                ├─ Scrap Pool (cap 12) → Recycler (2→1)
//                                                │        └─ Salvage Pool (cap 10) → Salvage Drain (1)
//                                                └─ Critical Defect (End)
//
// Exercises: 2D6 / 1-3 random flow, Pool capacity + back-pressure, a
// deterministic Gate's proportional split, a two-input Converter scaling down
// on a short input, a probabilistic Gate's single-branch routing, an ordinary
// Drain vs a probabilistic End, seed reproducibility, multi-Pool tracking,
// p10–p90 bands, and a populated termination sparkline.

type NodeSpec = {
  id: string
  kind: NodeKind
  label: string
  at: [number, number]
  initial?: number
  capacity?: number | null
  distribution?: 'deterministic' | 'probabilistic'
}

const NODES: NodeSpec[] = [
  // upstream: ore + energy feed
  { id: 'ore_source', kind: 'source', label: 'Ore Source', at: [0, 40] },
  { id: 'ore_stock', kind: 'pool', label: 'Ore Stock', at: [200, 40], initial: 8, capacity: 50 },
  { id: 'ore_router', kind: 'gate', label: 'Ore Router', at: [400, 40], distribution: 'deterministic' },
  { id: 'refined_ore', kind: 'pool', label: 'Refined Ore', at: [600, -40], initial: 0, capacity: 12 },
  { id: 'tailings', kind: 'pool', label: 'Tailings', at: [600, 150], initial: 0, capacity: 15 },
  { id: 'waste_drain', kind: 'drain', label: 'Waste Drain', at: [400, 150] },
  { id: 'energy_source', kind: 'source', label: 'Energy Source', at: [200, 260] },
  { id: 'energy_pool', kind: 'pool', label: 'Energy Pool', at: [400, 260], initial: 6, capacity: 20 },

  // assembly
  { id: 'assembly', kind: 'converter', label: 'Assembly Converter', at: [820, 60] },
  { id: 'components', kind: 'pool', label: 'Components', at: [1040, 60], initial: 0, capacity: 30 },
  { id: 'quality_gate', kind: 'gate', label: 'Quality Gate', at: [1240, 60], distribution: 'probabilistic' },

  // downstream: sell / recycle / fail
  { id: 'finished', kind: 'pool', label: 'Finished Goods', at: [1460, -40], initial: 0, capacity: 25 },
  { id: 'sales_drain', kind: 'drain', label: 'Sales Drain', at: [1680, -40] },
  { id: 'scrap', kind: 'pool', label: 'Scrap Pool', at: [1460, 150], initial: 0, capacity: 12 },
  { id: 'recycler', kind: 'converter', label: 'Recycler', at: [1680, 150] },
  { id: 'salvage', kind: 'pool', label: 'Salvage Pool', at: [1880, 150], initial: 0, capacity: 10 },
  { id: 'salvage_drain', kind: 'drain', label: 'Salvage Drain', at: [2080, 150] },
  { id: 'end_defect', kind: 'end', label: 'Critical Defect', at: [1460, 320] },
]

type EdgeSpec = [id: string, source: string, target: string, flow: string]

const EDGES: EdgeSpec[] = [
  ['e_ore_in', 'ore_source', 'ore_stock', '2D6'],
  ['e_ore_route', 'ore_stock', 'ore_router', '6'],
  ['e_route_refine', 'ore_router', 'refined_ore', '4'], // deterministic split weight
  ['e_route_tail', 'ore_router', 'tailings', '1'], //        weight ⇒ 4 : 1
  ['e_tail_waste', 'tailings', 'waste_drain', '1-3'],

  ['e_energy_in', 'energy_source', 'energy_pool', '1-3'],

  ['e_refine_asm', 'refined_ore', 'assembly', '3'], // converter intake: 3 ore
  ['e_energy_asm', 'energy_pool', 'assembly', '1'], //                 + 1 energy
  ['e_asm_comp', 'assembly', 'components', '2'], //     produces 2 parts

  ['e_comp_qc', 'components', 'quality_gate', '4'],
  ['e_qc_finished', 'quality_gate', 'finished', '17'], // probabilistic weights
  ['e_qc_scrap', 'quality_gate', 'scrap', '3'], //        17 : 3 : 1
  ['e_qc_end', 'quality_gate', 'end_defect', '1'],

  ['e_fin_sales', 'finished', 'sales_drain', '1-3'],
  ['e_scrap_rec', 'scrap', 'recycler', '2'], //  recycler intake 2
  ['e_rec_salvage', 'recycler', 'salvage', '1'], // → 1 salvage (2 : 1)
  ['e_salvage_out', 'salvage', 'salvage_drain', '1'],
]

export function buildRiskyFactory(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes: LoopNode[] = NODES.map((s) => {
    const data = { ...defaultData(s.kind), label: s.label } as LoopNode['data']
    if (s.initial !== undefined && data.kind === 'pool') data.initial = s.initial
    if (s.capacity !== undefined && data.kind === 'pool') data.capacity = s.capacity
    if (s.distribution && data.kind === 'gate') data.distribution = s.distribution
    return { id: s.id, type: s.kind, position: { x: s.at[0], y: s.at[1] }, data }
  })

  const edges: LoopEdge[] = EDGES.map(([id, source, target, flow]) => ({
    id,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'loop',
    data: { kind: 'resource', flow },
    markerEnd: { type: MarkerType.ArrowClosed },
  }))

  return { nodes, edges }
}

/** The Monte-Carlo settings the README walks through. */
export const RISKY_FACTORY_MC = {
  baseSeed: 1,
  runs: 500,
  steps: 40,
  tracked: ['ore_stock', 'energy_pool', 'components', 'finished', 'scrap', 'salvage'],
}
