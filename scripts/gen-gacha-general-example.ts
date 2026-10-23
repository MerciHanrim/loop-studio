// docs/gacha-general.md — one-off generator for examples/gacha-general.json,
// the general gacha: ONE banner with no pity, standalone (Lumi, 2026-10-20).
//
// It reuses the 3-zone comparison's shared graph builder
// (src/engine/gachaBannerZonesGraph.ts): the General / Free zone, the shared
// target Parameter, the zone's hit rate and the termination plumbing. The
// standalone example's run is checked by its own tests
// (src/engine/gacha-general.test.ts, e2e/gacha-general.spec.ts). What
// changes is what a standalone example needs:
// - ids and names without the zone (pulls_per_zone → target_pulls, …; the
//   `@id` references in flows, conditions and the hit rate follow);
// - the layout: the compact comparison layout Lumi adopted on 2026-10-20 (the
//   main column, the three-way split, a column per result with its count
//   under it, the +1 lines outside the counts, the total and the end below),
//   on the product grid (a node's x on 16, its port row y + 28 on 16), each
//   connection's faces and bends written out. No `placeTemplate`: the
//   positions are the reviewed ones;
// - it opens UNLOCKED, a model to learn from and edit (the 3-zone comparison
//   keeps its lock), with no `initialView`: the whole model is fitted.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PULLS_PER_ZONE, buildGachaBannerZonesGraph } from '../src/engine/gachaBannerZonesGraph'
import { serialize, type RecommendedRunConfig } from '../src/model/serialize'
import type { EdgePorts, LoopEdge, LoopNode } from '../src/model/types'

const full = buildGachaBannerZonesGraph()

// the zone's ids → the standalone example's
const NODE_ID: Record<string, string> = {
  pulls_per_zone: 'target_pulls',
  zone1_free_w_ssr: 'w_ssr',
  zone1_free_w_sr: 'w_sr',
  zone1_free_w_r: 'w_r',
  fund_free: 'fund_tickets',
  ticket_free: 'tickets',
  roll_gate_free: 'roll',
  ssr_hit_free: 'ssr_result',
  sr_hit_free: 'sr_result',
  r_hit_free: 'r_result',
  ssr_count_free: 'ssr_count',
  sr_count_free: 'sr_count',
  r_count_free: 'r_count',
  pulls_made_free: 'pulls_made',
  cmp1_hit_rate_free: 'ssr_hit_rate',
  termination_fuel: 'completion_signal',
  all_zones_done: 'pulls_complete',
}
const EDGE_ID: Record<string, string> = {
  e_free_1: 'e_fund',
  e_free_10: 'e_tickets_roll',
  e_free_2: 'e_roll_ssr',
  e_free_3: 'e_roll_sr',
  e_free_4: 'e_roll_r',
  e_free_11: 'e_ssr_count',
  e_free_5: 'e_sr_count',
  e_free_6: 'e_r_count',
  e_free_7: 'e_ssr_pull',
  e_free_8: 'e_sr_pull',
  e_free_9: 'e_r_pull',
  e_termination_gate_free: 'e_pulls_done',
  e_termination_fuel: 'e_completion',
}
// canonical English names (the Korean overlay: src/i18n/templateLabels/ko.ts)
const LABEL: Record<string, string> = {
  target_pulls: 'Target pulls (whole number)',
  w_ssr: 'SSR weight',
  w_sr: 'SR weight',
  w_r: 'R weight',
  fund_tickets: 'Fund tickets',
  tickets: 'Tickets',
  roll: 'Roll',
  ssr_result: 'SSR result',
  sr_result: 'SR result',
  r_result: 'R result',
  ssr_count: 'SSR count',
  sr_count: 'SR count',
  r_count: 'R count',
  pulls_made: 'Pulls made',
  ssr_hit_rate: 'SSR hit rate · of target pulls',
  completion_signal: 'Completion signal',
  pulls_complete: 'Pulls complete',
}
// the symbol centres (a node's position is its 56 px cell's top-left, the
// centre − 28): x ≡ 12 and y ≡ 0 (mod 16) put the node and its port row on
// the grid
const CENTRE: Record<string, [number, number]> = {
  target_pulls: [60, 96],
  w_ssr: [60, 192],
  w_sr: [60, 288],
  w_r: [60, 384],
  fund_tickets: [476, 96],
  tickets: [476, 192],
  roll: [476, 288],
  ssr_result: [252, 400],
  sr_result: [476, 400],
  r_result: [700, 400],
  ssr_count: [252, 496],
  sr_count: [476, 496],
  r_count: [700, 496],
  pulls_made: [476, 608],
  pulls_complete: [476, 720],
  completion_signal: [700, 720],
  ssr_hit_rate: [764, 96],
}
// each connection's faces and bends (route points, in order)
const ROUTE: Record<string, { ports: EdgePorts; bends?: [number, number][] }> = {
  e_fund: { ports: { source: 'bottom', target: 'top' } },
  e_tickets_roll: { ports: { source: 'bottom', target: 'top' } },
  e_roll_ssr: { ports: { source: 'left', target: 'top' }, bends: [[252, 288]] },
  e_roll_sr: { ports: { source: 'bottom', target: 'top' } },
  e_roll_r: { ports: { source: 'right', target: 'top' }, bends: [[700, 288]] },
  e_ssr_count: { ports: { source: 'bottom', target: 'top' } },
  e_sr_count: { ports: { source: 'bottom', target: 'top' } },
  e_r_count: { ports: { source: 'bottom', target: 'top' } },
  // the +1 lines leave each result on the side its name does not take and run
  // outside the counts; the middle one comes in from above
  e_ssr_pull: { ports: { source: 'left', target: 'left' }, bends: [[192, 400], [192, 608]] },
  e_sr_pull: { ports: { source: 'left', target: 'top' }, bends: [[416, 400], [416, 576], [476, 576]] },
  e_r_pull: { ports: { source: 'right', target: 'right' }, bends: [[768, 400], [768, 608]] },
  e_pulls_done: { ports: { source: 'bottom', target: 'top' } },
  e_completion: { ports: { source: 'left', target: 'right' } },
}

const renameRefs = (s: string) => s.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (NODE_ID[id] ? `@${NODE_ID[id]}` : m))

const nodes: LoopNode[] = full.nodes
  .filter((n) => NODE_ID[n.id])
  .map((n) => {
    const id = NODE_ID[n.id]
    const c = CENTRE[id]
    if (!c) throw new Error(`no position for ${id}`)
    const data = { ...n.data, label: LABEL[id] } as Record<string, unknown>
    if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
    return { ...n, id, position: { x: c[0] - 28, y: c[1] - 28 }, data } as LoopNode
  })
const missing = Object.keys(NODE_ID).filter((id) => !full.nodes.some((n) => n.id === id))
if (missing.length) throw new Error(`not in the 3-zone graph: ${missing.join(', ')}`)

const edges: LoopEdge[] = (full.edges as LoopEdge[])
  .filter((e) => NODE_ID[e.source] && NODE_ID[e.target])
  .map((e) => {
    const id = EDGE_ID[e.id]
    if (!id) throw new Error(`no id for connection ${e.id}`)
    const r = ROUTE[id]
    const data = { ...e.data } as Record<string, unknown>
    if (typeof data.flow === 'string') data.flow = renameRefs(data.flow)
    if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
    data.route = 'orthogonal'
    data.ports = r.ports
    if (r.bends) data.waypoints = r.bends.map(([x, y]) => ({ x, y }))
    return { ...e, id, source: NODE_ID[e.source], target: NODE_ID[e.target], data } as LoopEdge
  })
if (edges.length !== Object.keys(EDGE_ID).length) throw new Error(`expected ${Object.keys(EDGE_ID).length} connections, got ${edges.length}`)

// No flow colour (Hanrim / Lumi, 2026-10-20): the 3-zone comparison colours
// each zone to tell the three apart; a standalone example has nothing to tell
// apart, and a colour there could read as a state or a chance. Nodes and lines
// keep the neutral defaults.
const coloured = { nodes, edges }

const recommendedRunConfig: RecommendedRunConfig = {
  baseSeed: 1,
  runs: 2000,
  // the end's own horizon, exact (GZ3.5 round 4): the target, + 2
  steps: PULLS_PER_ZONE + 2,
  tracked: ['pulls_made', 'ssr_count', 'sr_count', 'r_count'],
  timelineSeries: ['ssr_count', 'sr_count', 'r_count'],
  canvasLocked: false,
}

const text = serialize(coloured.nodes, coloured.edges, recommendedRunConfig, undefined, undefined, 2)
const outPath = fileURLToPath(new URL('../examples/gacha-general.json', import.meta.url))
writeFileSync(outPath, text + '\n')
console.log(`wrote ${outPath} (${nodes.length} nodes, ${edges.length} edges)`)
