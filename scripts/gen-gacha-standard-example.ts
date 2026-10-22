// docs/gacha-standard.md — one-off generator for examples/gacha-standard.json,
// the standard gacha: ONE banner with a hard-pity ceiling, standalone (Lumi,
// 2026-10-20).
//
// It reads the 3-zone comparison's shared graph builder
// (src/engine/gachaBannerZonesGraph.ts): the Premium Standard zone, the shared
// target Parameter, the zone's hit rate and the termination plumbing. The
// standalone example's run is checked by its own tests
// (src/engine/gacha-standard.test.ts, e2e/gacha-standard.spec.ts). What
// changes is what a standalone example needs:
// - ids and names without the zone (pity_standard → pity, …; the `@id`
//   references in flows, conditions and the hit rate follow);
// - ONE structural change, reviewed (Lumi, 2026-10-20): the forced SSR sends
//   its ticket INTO the SSR result, so the SSR result is the one place an SSR
//   is handled, natural or forced (its count, +1 pulls made, the counter's
//   reset). The forced SSR's own three lines (→ SSR count, +1 pulls made,
//   pity = 0) go; its +1 to the ceiling hits stays, so forced SSRs are still
//   counted apart. Over the inputs and seeds checked, every Pool's value and
//   the end are the same at every step as the zone's structure
//   (src/engine/gacha-standard.test.ts); what differs is that the SSR result
//   also fires on a forced pull (its activity cue and the flow record);
// - the layout: the one Lumi adopted (v5b, 2026-10-20) — the general gacha's
//   flow, the pity block (the counter, the forced SSR, its ceiling hits) framed
//   left of it on the results row, the counter's three returning lines on
//   their own lanes outside the main flow, the roll's three branches leaving
//   its bottom as one fan (its name on its free right side). On the product
//   grid (a node's x on 16, its port row y + 28 on 16), each connection's faces
//   and bends written out;
// - it opens UNLOCKED (the 3-zone comparison keeps its lock), with no
//   `initialView`: the whole model is fitted.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PULLS_PER_ZONE, buildGachaBannerZonesGraph } from '../src/engine/gachaBannerZonesGraph'
import { serialize, type RecommendedRunConfig, type SavedFrame } from '../src/model/serialize'
import type { EdgePorts, LoopEdge, LoopNode } from '../src/model/types'

const full = buildGachaBannerZonesGraph()

// the zone's ids → the standalone example's
const NODE_ID: Record<string, string> = {
  pulls_per_zone: 'target_pulls',
  zone2_standard_w_ssr: 'w_ssr',
  zone2_standard_w_sr: 'w_sr',
  zone2_standard_w_r: 'w_r',
  zone2_standard_hard_pity: 'hard_pity',
  fund_standard: 'fund_tickets',
  ticket_standard: 'tickets',
  roll_gate_standard: 'roll',
  ssr_hit_standard: 'ssr_result',
  sr_hit_standard: 'sr_result',
  r_hit_standard: 'r_result',
  ssr_count_standard: 'ssr_count',
  sr_count_standard: 'sr_count',
  r_count_standard: 'r_count',
  pulls_made_standard: 'pulls_made',
  pity_standard: 'pity',
  forced_ssr_standard: 'forced_ssr',
  ceiling_hits_standard: 'ceiling_hits',
  cmp2_hit_rate_standard: 'ssr_hit_rate',
  termination_fuel: 'completion_signal',
  all_zones_done: 'pulls_complete',
}
// the forced SSR's own three lines, replaced by its line into the SSR result
const MERGED_OUT = new Set(['e_standard_16', 'e_standard_19', 'e_standard_21'])
const EDGE_ID: Record<string, string> = {
  e_standard_1: 'e_fund',
  e_standard_10: 'e_tickets_roll',
  e_standard_2: 'e_roll_ssr',
  e_standard_3: 'e_roll_sr',
  e_standard_4: 'e_roll_r',
  e_standard_20: 'e_ssr_count',
  e_standard_5: 'e_sr_count',
  e_standard_6: 'e_r_count',
  e_standard_7: 'e_ssr_pull',
  e_standard_8: 'e_sr_pull',
  e_standard_9: 'e_r_pull',
  e_termination_gate_standard: 'e_pulls_done',
  e_termination_fuel: 'e_completion',
  e_standard_11: 'e_tickets_forced',
  e_standard_14: 'e_forced_ceiling',
  e_standard_13: 'e_pity_forced',
  e_standard_12: 'e_pity_roll',
  e_standard_15: 'e_ssr_pity',
  e_standard_17: 'e_sr_pity',
  e_standard_18: 'e_r_pity',
}
// canonical English names (the Korean overlay: src/i18n/templateLabels/ko.ts)
const LABEL: Record<string, string> = {
  target_pulls: 'Target pulls (whole number)',
  w_ssr: 'SSR weight',
  w_sr: 'SR weight',
  w_r: 'R weight',
  hard_pity: 'Hard pity ceiling',
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
  pity: 'Pity',
  forced_ssr: 'Forced SSR',
  ceiling_hits: 'Ceiling hits',
  ssr_hit_rate: 'SSR hit rate · of target pulls',
  completion_signal: 'Completion signal',
  pulls_complete: 'Pulls complete',
}
// the symbol centres (a node's position is its 56 px cell's top-left, the
// centre − 28): x ≡ 12 and y ≡ 0 (mod 16) put the node and its port row on
// the grid
const CENTRE: Record<string, [number, number]> = {
  // the inputs, 112 apart (a two-line name met the next input at 96)
  target_pulls: [28, 96],
  w_ssr: [28, 208],
  w_sr: [28, 320],
  w_r: [28, 432],
  hard_pity: [28, 544],
  // the general gacha's flow: the main column, the three-way split, a column
  // per result with its count under it, the total and the end below
  fund_tickets: [732, 96],
  tickets: [732, 192],
  roll: [732, 288],
  ssr_result: [508, 432],
  sr_result: [732, 432],
  r_result: [956, 432],
  ssr_count: [508, 544],
  sr_count: [732, 544],
  r_count: [956, 544],
  pulls_made: [732, 672],
  pulls_complete: [732, 800],
  completion_signal: [956, 800],
  ssr_hit_rate: [1020, 96],
  // the pity block: the counter left of the forced SSR on the results row, the
  // ceiling hits under the forced SSR
  pity: [156, 432],
  forced_ssr: [316, 432],
  ceiling_hits: [316, 576],
}
// each connection's faces and bends (route points, in order)
const ROUTE: Record<string, { ports: EdgePorts; bends?: [number, number][] }> = {
  e_fund: { ports: { source: 'bottom', target: 'top' } },
  e_tickets_roll: { ports: { source: 'bottom', target: 'top' } },
  // the roll's three branches leave its bottom as one fan, on one row
  e_roll_ssr: { ports: { source: 'bottom', target: 'top' }, bends: [[732, 352], [508, 352]] },
  e_roll_sr: { ports: { source: 'bottom', target: 'top' } },
  e_roll_r: { ports: { source: 'bottom', target: 'top' }, bends: [[732, 352], [956, 352]] },
  e_ssr_count: { ports: { source: 'bottom', target: 'top' } },
  e_sr_count: { ports: { source: 'bottom', target: 'top' } },
  e_r_count: { ports: { source: 'bottom', target: 'top' } },
  e_ssr_pull: { ports: { source: 'right', target: 'left' }, bends: [[592, 432], [592, 672]] },
  e_sr_pull: { ports: { source: 'left', target: 'top' }, bends: [[672, 432], [672, 624], [732, 624]] },
  e_r_pull: { ports: { source: 'right', target: 'right' }, bends: [[1024, 432], [1024, 672]] },
  e_pulls_done: { ports: { source: 'bottom', target: 'top' } },
  e_completion: { ports: { source: 'left', target: 'right' } },
  // the pity block: tickets into the forced SSR from above; the forced SSR
  // straight into the SSR result, its +1 down into the ceiling hits; the
  // counter's two conditions — into the forced SSR beside it, and up its own
  // column and along the roll's row into the roll's left
  e_tickets_forced: { ports: { source: 'left', target: 'top' }, bends: [[316, 192]] },
  e_forced_into_ssr: { ports: { source: 'right', target: 'left' } },
  e_forced_ceiling: { ports: { source: 'bottom', target: 'top' } },
  e_pity_forced: { ports: { source: 'right', target: 'left' } },
  e_pity_roll: { ports: { source: 'top', target: 'left' }, bends: [[156, 288]] },
  // the counter's three returns, each its own lane: down from its result,
  // along a corridor between the pulls made and the end, up the far left into
  // the counter (its bottom for the SSR's reset, its left side for SR's / R's
  // additions, on lanes 32 apart)
  e_ssr_pity: { ports: { source: 'left', target: 'bottom' }, bends: [[464, 432], [464, 720], [156, 720]] },
  e_sr_pity: { ports: { source: 'right', target: 'left' }, bends: [[800, 432], [800, 736], [112, 736], [112, 432]] },
  e_r_pity: { ports: { source: 'left', target: 'left' }, bends: [[880, 432], [880, 752], [80, 752], [80, 432]] },
}

const renameRefs = (s: string) => s.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (NODE_ID[id] ? `@${NODE_ID[id]}` : m))

const missing = Object.keys(NODE_ID).filter((id) => !full.nodes.some((n) => n.id === id))
if (missing.length) throw new Error(`not in the 3-zone graph: ${missing.join(', ')}`)

// No flow colour (as the general gacha, Hanrim / Lumi 2026-10-20): the
// 3-zone comparison colours each zone to tell the three apart; a standalone
// example has nothing to tell apart. Nodes and lines keep the neutral defaults.
const nodes: LoopNode[] = full.nodes
  .filter((n) => NODE_ID[n.id])
  .map((n) => {
    const id = NODE_ID[n.id]
    const c = CENTRE[id]
    if (!c) throw new Error(`no position for ${id}`)
    const data = { ...n.data, label: LABEL[id] } as Record<string, unknown>
    delete data.accent
    if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
    return { ...n, id, position: { x: c[0] - 28, y: c[1] - 28 }, data } as LoopNode
  })

const kept = (full.edges as LoopEdge[]).filter((e) => NODE_ID[e.source] && NODE_ID[e.target] && !MERGED_OUT.has(e.id))
const into: LoopEdge = {
  id: 'e_forced_into_ssr',
  source: 'forced_ssr_standard',
  target: 'ssr_hit_standard',
  type: 'loop',
  sourceHandle: 'out',
  targetHandle: 'in',
  data: { kind: 'resource', flow: '1' },
} as LoopEdge
const edges: LoopEdge[] = [...kept, into].map((e) => {
  const id = e.id === 'e_forced_into_ssr' ? e.id : EDGE_ID[e.id]
  if (!id) throw new Error(`no id for connection ${e.id}`)
  const r = ROUTE[id]
  if (!r) throw new Error(`no route for ${id}`)
  const data = { ...e.data } as Record<string, unknown>
  delete data.accent
  if (typeof data.flow === 'string') data.flow = renameRefs(data.flow)
  if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
  data.route = 'orthogonal'
  data.ports = r.ports
  if (r.bends) data.waypoints = r.bends.map(([x, y]) => ({ x, y }))
  else delete data.waypoints
  return { ...e, id, source: NODE_ID[e.source], target: NODE_ID[e.target], data } as LoopEdge
})
if (edges.length !== Object.keys(ROUTE).length) throw new Error(`expected ${Object.keys(ROUTE).length} connections, got ${edges.length}`)

// the pity block's frame: the counter, the forced SSR and its ceiling hits
// (the ceiling's value stays with the other inputs), a tighter side margin so
// the inputs' column stays outside. Its Korean title: koFrames.
const block = ['pity', 'forced_ssr', 'ceiling_hits'].map((id) => CENTRE[id])
const PAD_X = 56
const fx = Math.min(...block.map(([x]) => x)) - PAD_X
const fy = Math.min(...block.map(([, y]) => y)) - 64
const frames: SavedFrame[] = [
  {
    id: 'pity_block',
    label: 'Pity ceiling',
    rect: { x: fx, y: fy, w: Math.max(...block.map(([x]) => x)) + PAD_X - fx, h: Math.max(...block.map(([, y]) => y)) + 80 - fy },
    color: 'violet',
  },
]

const recommendedRunConfig: RecommendedRunConfig = {
  baseSeed: 1,
  runs: 2000,
  // the end's own horizon, exact (GZ3.5 round 4): the target, + 2
  steps: PULLS_PER_ZONE + 2,
  tracked: ['pulls_made', 'ssr_count', 'sr_count', 'r_count', 'ceiling_hits'],
  timelineSeries: ['ssr_count', 'sr_count', 'r_count'],
  canvasLocked: false,
}

const text = serialize(nodes, edges, recommendedRunConfig, undefined, undefined, 2, frames)
const outPath = fileURLToPath(new URL('../examples/gacha-standard.json', import.meta.url))
writeFileSync(outPath, text + '\n')
console.log(`wrote ${outPath} (${nodes.length} nodes, ${edges.length} edges, ${frames.length} frame)`)
