// docs/gacha-pickup.md — one-off generator for examples/gacha-pickup.json,
// the pickup gacha: ONE banner with a hard pity ceiling and a pickup
// guarantee, standalone (Lumi, 2026-10-20).
//
// It reads the 3-zone comparison's shared graph builder
// (src/engine/gachaBannerZonesGraph.ts): the Premium Pickup zone, the shared
// target Parameter, the zone's two comparison Registers and the termination
// plumbing. The standalone example's run is checked by its own tests
// (src/engine/gacha-pickup.test.ts, e2e/gacha-pickup.spec.ts). What changes:
// - ids and names without the zone (the `@id` references follow);
// - the STRUCTURE, adopted as the example's basis (Lumi, 2026-10-20, "S1"):
//   the zone has four exclusive paths fed by the tickets — (counter below /
//   at the ceiling − 1) × (pickup owed 0 / 1), eight conditions. Here the
//   standard gacha's flow — ONE roll (counter below the ceiling − 1) and ONE
//   forced SSR (at it) into ONE SSR result — and after the SSR result the
//   guarantee: the pickup confirmation (a deterministic Gate, owed ≥ 1) straight
//   to the pickup SSR, or the pickup split (owed < 1, pickup / off-pickup by
//   weight). Exactly one of the two is enabled; a deterministic Gate re-splits
//   over its enabled branches (engine step.ts §S4), so the SSR goes the one
//   way. The SSR result does the SSR bookkeeping once (counter = 0, +1 pulls
//   made, +1 SSR count). 43 lines → 32. Checked: the transition table per state
//   (outcome, chance, the counter, the owed state, the ceiling hits after) is
//   the zone's, row for row, at representative and boundary counters of seven
//   input sets; the engine's runs land on its rows; the example reproduces
//   itself. NOT the zone's draws for the same seed (one roll draws where the
//   zone's two did) — not required;
// - the layout adopted in the comparison rounds (s1c): the standard gacha's
//   flow, its pity block, and under the SSR result the guarantee block, framed;
//   on the product grid (a node's x on 16, its port row y + 28 on 16), each
//   connection's faces and bends written out;
// - it opens UNLOCKED, with no `initialView`: the whole model is fitted.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PULLS_PER_ZONE, buildGachaBannerZonesGraph } from '../src/engine/gachaBannerZonesGraph'
import { serialize, type RecommendedRunConfig, type SavedFrame } from '../src/model/serialize'
import type { EdgePorts, LoopEdge, LoopNode } from '../src/model/types'

const full = buildGachaBannerZonesGraph()

// the zone's ids → the standalone example's (the four zone rolls are replaced)
const NODE_ID: Record<string, string> = {
  pulls_per_zone: 'target_pulls',
  zone3_pickup_w_ssr: 'w_ssr',
  zone3_pickup_w_sr: 'w_sr',
  zone3_pickup_w_r: 'w_r',
  zone3_pickup_hard_pity: 'hard_pity',
  zone3_pickup_w_pickup: 'w_pickup',
  zone3_pickup_w_standard: 'w_off',
  fund_pickup: 'fund_tickets',
  ticket_pickup: 'tickets',
  ssr_split_open_pickup: 'pickup_split',
  pickup_hit_pickup: 'pickup_ssr',
  standard_hit_pickup: 'off_ssr',
  sr_hit_pickup: 'sr_result',
  r_hit_pickup: 'r_result',
  pickup_count_pickup: 'pickup_count',
  standard_count_pickup: 'off_count',
  ssr_count_pickup: 'ssr_count',
  sr_count_pickup: 'sr_count',
  r_count_pickup: 'r_count',
  pulls_made_pickup: 'pulls_made',
  pity_pickup: 'pity',
  ceiling_hits_pickup: 'ceiling_hits',
  missed_pickup_pickup: 'pickup_owed',
  cmp3_hit_rate_pickup: 'ssr_hit_rate',
  cmp4_pickup_rate_pickup: 'pickup_rate',
  termination_fuel: 'completion_signal',
  all_zones_done: 'pulls_complete',
}
// the zone's lines the example keeps, with their new ids (the rest — the four
// rolls' lines and the pickup / off-pickup SSRs' own bookkeeping — go)
const EDGE_ID: Record<string, string> = {
  e_pickup_1: 'e_fund',
  e_pickup_16: 'e_split_pickup',
  e_pickup_17: 'e_split_off',
  e_pickup_24: 'e_pickup_count',
  e_pickup_25: 'e_off_count',
  e_pickup_26: 'e_sr_count',
  e_pickup_27: 'e_r_count',
  e_pickup_30: 'v_sr_pity',
  e_pickup_31: 'v_r_pity',
  e_pickup_34: 'v_sr_pull',
  e_pickup_35: 'v_r_pull',
  e_pickup_40: 'v_off_owed',
  e_pickup_41: 'v_pickup_owed',
  e_termination_fuel: 'e_completion',
  e_termination_gate_pickup: 'e_pulls_done',
}
// canonical English names (the Korean overlay: src/i18n/templateLabels/ko.ts)
const LABEL: Record<string, string> = {
  target_pulls: 'Target pulls (whole number)',
  w_ssr: 'SSR weight',
  w_sr: 'SR weight',
  w_r: 'R weight',
  hard_pity: 'Hard pity ceiling',
  w_pickup: 'Pickup weight',
  w_off: 'Off-pickup weight',
  fund_tickets: 'Fund tickets',
  tickets: 'Tickets',
  roll: 'Roll',
  forced_ssr: 'Forced SSR',
  ssr_result: 'SSR result',
  owed_route: 'Owed pickup',
  pickup_split: 'Pickup split',
  pickup_ssr: 'Pickup SSR',
  off_ssr: 'Off-pickup SSR',
  sr_result: 'SR result',
  r_result: 'R result',
  pickup_count: 'Pickup SSR count',
  off_count: 'Off-pickup SSR count',
  ssr_count: 'SSR count',
  sr_count: 'SR count',
  r_count: 'R count',
  pulls_made: 'Pulls made',
  pity: 'Pity',
  ceiling_hits: 'Ceiling hits',
  pickup_owed: 'Pickup owed',
  ssr_hit_rate: 'SSR hit rate · of target pulls',
  pickup_rate: 'Pickup rate · of target pulls',
  completion_signal: 'Completion signal',
  pulls_complete: 'Pulls complete',
}
// the symbol centres (position = centre − 28; x ≡ 12, y ≡ 0 mod 16)
const CENTRE: Record<string, [number, number]> = {
  target_pulls: [28, 96],
  w_ssr: [28, 208],
  w_sr: [28, 320],
  w_r: [28, 432],
  hard_pity: [28, 544],
  w_pickup: [28, 656],
  w_off: [28, 768],
  fund_tickets: [732, 96],
  tickets: [732, 192],
  roll: [732, 288],
  ssr_hit_rate: [1116, 96],
  pickup_rate: [1276, 96],
  // the pity block: the counter and the forced SSR on the results row, the
  // ceiling hits under the forced SSR
  pity: [156, 432],
  forced_ssr: [316, 432],
  ceiling_hits: [316, 576],
  // the results row and the counts (the SSR count beside the SSR result)
  ssr_result: [508, 432],
  sr_result: [828, 432],
  r_result: [1052, 432],
  ssr_count: [668, 544],
  sr_count: [828, 544],
  r_count: [1052, 544],
  // the guarantee block, under the SSR result: the split and the pickup
  // confirmation, the off-pickup and the pickup SSR, the owed state between
  pickup_split: [428, 608],
  owed_route: [588, 608],
  off_ssr: [428, 736],
  pickup_ssr: [588, 736],
  pickup_owed: [508, 848],
  off_count: [428, 960],
  pickup_count: [588, 960],
  // the total and the end
  pulls_made: [828, 960],
  pulls_complete: [828, 1088],
  completion_signal: [1052, 1088],
}
// each connection's faces and bends (route points, in order); a line with no
// entry is routed by the product from its kind's default faces
const ROUTE: Record<string, { ports: EdgePorts; bends?: [number, number][] }> = {
  e_fund: { ports: { source: 'bottom', target: 'top' } },
  e_tickets_roll: { ports: { source: 'bottom', target: 'top' } },
  // the roll's three branches leave its bottom as one fan, on one row
  e_roll_ssr: { ports: { source: 'bottom', target: 'top' }, bends: [[732, 352], [508, 352]] },
  e_roll_sr: { ports: { source: 'bottom', target: 'top' }, bends: [[732, 352], [828, 352]] },
  e_roll_r: { ports: { source: 'bottom', target: 'top' }, bends: [[732, 352], [1052, 352]] },
  // the pity block
  e_tickets_forced: { ports: { source: 'left', target: 'top' }, bends: [[316, 192]] },
  e_forced_into_ssr: { ports: { source: 'right', target: 'left' } },
  v_forced_ceiling: { ports: { source: 'bottom', target: 'top' } },
  c_pity_forced: { ports: { source: 'right', target: 'left' } },
  c_pity_roll: { ports: { source: 'top', target: 'left' }, bends: [[156, 288]] },
  // the counts
  e_sr_count: { ports: { source: 'bottom', target: 'top' } },
  e_r_count: { ports: { source: 'bottom', target: 'top' } },
  v_ssr_count: { ports: { source: 'right', target: 'top' }, bends: [[668, 432]] },
  // the guarantee block: the SSR result's fan into the split and the pickup
  // confirmation (y 512, above the frame's top edge and title)
  e_ssr_split: { ports: { source: 'bottom', target: 'top' }, bends: [[508, 512], [428, 512]] },
  e_ssr_owed: { ports: { source: 'bottom', target: 'top' }, bends: [[508, 512], [588, 512]] },
  e_split_off: { ports: { source: 'bottom', target: 'top' } },
  e_owed_pickup: { ports: { source: 'bottom', target: 'top' } },
  // only its end is pinned: across a row above the off-pickup SSR (700) and
  // down at x 532 into the pickup SSR's left side, so the row at y 736 left of
  // 532 stays free for the off-pickup SSR's "= 1" (2026-10-21: the router put
  // both on y 736 in Korean; a bend near the split met the English "Owed
  // pickup" on the gate's free left side, so the start is left to the router;
  // at 540 the drop ran 4 px beside the owed → owed-pickup condition)
  e_split_pickup: { ports: { source: 'right', target: 'left' }, bends: [[532, 700], [532, 736]] },
  c_owed_split: { ports: { source: 'left', target: 'left' }, bends: [[380, 848], [380, 608]] },
  // out of the owed state's right side, under the pickup SSR's name and up a
  // lane right of the pickup column (2026-10-21; the router's lane between the
  // two SSR results ran against the running "=0 / Δ−1")
  c_owed_route: { ports: { source: 'right', target: 'right' }, bends: [[556, 872], [636, 872]] },
  // the off-pickup SSR's two outputs leave its left and right sides, so its
  // bottom is free and its name goes there (2026-10-21; on its left side the
  // name was wholly outside the frame) — inside the frame in Korean; the
  // English name is 4 px wider than the room on its left (a known visual
  // exception, Lumi 2026-10-21): its count down a lane at x 356 (24 from the
  // owed → split condition's at 380, under the pity frame), its "= 1" into the
  // owed state's top
  // right along y 736, down at x 492 (its chip there, clear of the name and of
  // the "= 0" chip), into the owed state's top
  v_off_owed: { ports: { source: 'right', target: 'top' }, bends: [[492, 736], [492, 800], [508, 800]] },
  // the pickup SSR's "= 0" joins the "= 1" at the owed state's top (2026-10-21;
  // into its right side, shared with the owed → owed-pickup condition, the
  // router's lane put the running "=0 / Δ−1" over the owed state in English)
  v_pickup_owed: { ports: { source: 'bottom', target: 'top' } },
  e_off_count: { ports: { source: 'left', target: 'top' }, bends: [[356, 736], [356, 904], [428, 904]] },
  e_pickup_count: { ports: { source: 'right', target: 'top' }, bends: [[620, 736], [620, 896], [588, 896]] },
  // the counter's SR / R returns on their own lanes: down beside their
  // columns, a corridor under everything, up the far left into the counter
  v_sr_pity: { ports: { source: 'right', target: 'left' }, bends: [[892, 432], [892, 1040], [112, 1040], [112, 432]] },
  v_r_pity: { ports: { source: 'left', target: 'left' }, bends: [[988, 432], [988, 1056], [80, 1056], [80, 432]] },
  // SR's / R's +1 beside their columns into the pulls made
  v_sr_pull: { ports: { source: 'left', target: 'top' }, bends: [[768, 432], [768, 912], [828, 912]] },
  v_r_pull: { ports: { source: 'right', target: 'right' }, bends: [[1116, 432], [1116, 960]] },
  // the end
  e_pulls_done: { ports: { source: 'bottom', target: 'top' } },
  e_completion: { ports: { source: 'left', target: 'right' } },
}

const renameRefs = (s: string) => s.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (NODE_ID[id] ? `@${NODE_ID[id]}` : m))
const missing = Object.keys(NODE_ID).filter((id) => !full.nodes.some((n) => n.id === id))
if (missing.length) throw new Error(`not in the 3-zone graph: ${missing.join(', ')}`)

const XY = { x: 0, y: 0 }
const gate = (id: string, distribution: 'deterministic' | 'probabilistic'): LoopNode =>
  ({ id, type: 'gate', position: XY, data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode: 'pullAny' } }) as LoopNode
const res = (id: string, s: string, t: string, flow: string): LoopEdge =>
  ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge
const act = (id: string, s: string, t: string, expr: string): LoopEdge =>
  ({ id, source: s, target: t, type: 'loop', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr } }) as LoopEdge
const after = (id: string, s: string, t: string, expr: string): LoopEdge =>
  ({ id, source: s, target: t, type: 'loop', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' } }) as LoopEdge

// the zone's nodes the example keeps (renamed), and the four the structure adds
const kept: LoopNode[] = full.nodes
  .filter((n) => NODE_ID[n.id])
  .map((n) => {
    const data = { ...n.data } as Record<string, unknown>
    if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
    return { ...n, id: NODE_ID[n.id], data } as LoopNode
  })
const nodesRaw: LoopNode[] = [...kept, gate('roll', 'probabilistic'), gate('forced_ssr', 'deterministic'), gate('ssr_result', 'deterministic'), gate('owed_route', 'deterministic')]

const keptEdges: LoopEdge[] = (full.edges as LoopEdge[])
  .filter((e) => EDGE_ID[e.id])
  .map((e) => {
    const data = { ...e.data } as Record<string, unknown>
    if (typeof data.flow === 'string') data.flow = renameRefs(data.flow)
    if (typeof data.expr === 'string') data.expr = renameRefs(data.expr)
    return { ...e, id: EDGE_ID[e.id], source: NODE_ID[e.source], target: NODE_ID[e.target], data } as LoopEdge
  })
if (keptEdges.length !== Object.keys(EDGE_ID).length) throw new Error(`kept ${keptEdges.length} of ${Object.keys(EDGE_ID).length} zone lines`)
const edgesRaw: LoopEdge[] = [
  ...keptEdges,
  res('e_tickets_roll', 'tickets', 'roll', '1'),
  res('e_tickets_forced', 'tickets', 'forced_ssr', '1'),
  act('c_pity_roll', 'pity', 'roll', '< @hard_pity - 1'),
  act('c_pity_forced', 'pity', 'forced_ssr', '>= @hard_pity - 1'),
  res('e_roll_ssr', 'roll', 'ssr_result', '@w_ssr'),
  res('e_roll_sr', 'roll', 'sr_result', '@w_sr'),
  res('e_roll_r', 'roll', 'r_result', '@w_r'),
  res('e_forced_into_ssr', 'forced_ssr', 'ssr_result', '1'),
  res('e_ssr_owed', 'ssr_result', 'owed_route', '1'),
  res('e_ssr_split', 'ssr_result', 'pickup_split', '1'),
  act('c_owed_route', 'pickup_owed', 'owed_route', '>= 1'),
  act('c_owed_split', 'pickup_owed', 'pickup_split', '< 1'),
  res('e_owed_pickup', 'owed_route', 'pickup_ssr', '1'),
  after('v_ssr_pity', 'ssr_result', 'pity', '=0'),
  after('v_ssr_pull', 'ssr_result', 'pulls_made', '+1'),
  after('v_ssr_count', 'ssr_result', 'ssr_count', '+1'),
  after('v_forced_ceiling', 'forced_ssr', 'ceiling_hits', '+1'),
]
if (edgesRaw.length !== 32) throw new Error(`expected 32 connections, got ${edgesRaw.length}`)

// No flow colour (as the general and standard gacha, Hanrim / Lumi 2026-10-20)
const nodes: LoopNode[] = nodesRaw.map((n) => {
  const c = CENTRE[n.id]
  if (!c) throw new Error(`no position for ${n.id}`)
  if (!LABEL[n.id]) throw new Error(`no name for ${n.id}`)
  const data = { ...n.data, label: LABEL[n.id] } as Record<string, unknown>
  delete data.accent
  return { ...n, position: { x: c[0] - 28, y: c[1] - 28 }, data } as LoopNode
})
const edges: LoopEdge[] = edgesRaw.map((e) => {
  const r = ROUTE[e.id]
  const data = { ...e.data } as Record<string, unknown>
  delete data.accent
  data.route = 'orthogonal'
  if (r) data.ports = r.ports
  else delete data.ports
  if (r?.bends) data.waypoints = r.bends.map(([x, y]) => ({ x, y }))
  else delete data.waypoints
  return { ...e, data } as LoopEdge
})

// the two blocks' frames (Korean titles: koFrames)
const frameOf = (id: string, label: string, members: string[], padX: number, color: SavedFrame['color']): SavedFrame => {
  const cs = members.map((m) => CENTRE[m])
  const x = Math.min(...cs.map(([cx]) => cx)) - padX
  const y = Math.min(...cs.map(([, cy]) => cy)) - 64
  return { id, label, rect: { x, y, w: Math.max(...cs.map(([cx]) => cx)) + padX - x, h: Math.max(...cs.map(([, cy]) => cy)) + 80 - y }, color }
}
const frames: SavedFrame[] = [
  frameOf('pity_block', 'Pity ceiling', ['pity', 'forced_ssr', 'ceiling_hits'], 56, 'violet'),
  // side margin 40: with more, its title tab sat over the forced SSR → ceiling hits "+1"
  frameOf('pickup_block', 'Pickup guarantee', ['pickup_split', 'owed_route', 'off_ssr', 'pickup_ssr', 'pickup_owed'], 40, 'gold'),
]

const recommendedRunConfig: RecommendedRunConfig = {
  baseSeed: 1,
  runs: 2000,
  // the end's own horizon, exact (GZ3.5 round 4): the target, + 2
  steps: PULLS_PER_ZONE + 2,
  tracked: ['pulls_made', 'ssr_count', 'pickup_count', 'off_count', 'ceiling_hits'],
  timelineSeries: ['ssr_count', 'pickup_count'],
  canvasLocked: false,
}

const text = serialize(nodes, edges, recommendedRunConfig, undefined, undefined, 2, frames)
const outPath = fileURLToPath(new URL('../examples/gacha-pickup.json', import.meta.url))
writeFileSync(outPath, text + '\n')
console.log(`wrote ${outPath} (${nodes.length} nodes, ${edges.length} edges, ${frames.length} frames)`)
