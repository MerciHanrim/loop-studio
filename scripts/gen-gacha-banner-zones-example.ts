// docs/gacha-banner-zones.md (GZ) — one-off generator for
// examples/gacha-banner-zones.json, built from the SAME graph builder the
// engine fixture (src/engine/gacha-banner-zones.test.ts) uses, so the shipped
// Template and the tested graph can never drift apart.
//
// Layout history (rounds 1–9, 2026-09-13 … issue #344 step 4): a per-zone
// band layout computed here — resource flow in an upper band, pity /
// guarantee state and every Parameter in a lower band, the three zones side
// by side under one comparison row, every connection orthogonal, per-edge
// waypoints for the label coincidences the bands produced, and finally the
// whole placed for the grid by `placeTemplate`. That code is in the history
// of this file (`git log -- scripts/gen-gacha-banner-zones-example.ts`).
//
// Layout round 10 — the node structure (2026-10-12; share
// scratch/share/connection-editing-2/24-default-switch-verification.md §9–§10).
// Under the new node (a compact body with the name OUTSIDE it, four-side
// ports) the band layout lost four connections to one shared corridor in the
// Premium Pickup zone: `e_pickup_18`, `_21`, `_29`, `_33` could not be selected
// by a real click on the line nor on their label (other lines covered both).
// The positions below are the design study's final Gacha layout (its ELK
// top-down layering with the names beside the bodies, the frames kept, the
// label-aware moves and the computed frame separation — clean in 18 languages
// on the eleven collision counts, position hash 198232794), snapped to the
// product grid (x on 16, the port row y + 28 on 16) and carried into the
// product as plain coordinates — with the zones re-arranged as blocks (the
// comparison row with the two termination nodes on top, Free and Standard
// side by side under it, Pickup under those), since the study's side-by-side
// row (5650 px wide) no longer fit a 1280 × 800 pane even at the minimum
// zoom — each node's position, each connection's port
// FACES where they differ from the defaults (a resource leaves right / enters
// left, a state leaves bottom / enters top), and each frame's members. The
// frames' rectangles are rebuilt by `placeTemplate` around the measured boxes
// (body ∪ name, 18-language maxima, src/model/layout/templateBoxes.json); the
// comparison row sits ABOVE the zones in this layout. No waypoints: the
// guarded router routes every connection from its faces. The old coordinates
// are not a goal (Lumi, 2026-10-12); the four-connection reach regression is
// re-verified with real clicks on the shipped file.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TIMELINE_SERIES,
  GACHA_BANNER_ZONES_FLOWS,
  PULLS_PER_ZONE,
  TRACKED_POOLS,
  ZONE_TITLE,
  buildGachaBannerZonesGraph,
} from '../src/engine/gachaBannerZonesGraph'
import { withTemplateFlowColours } from '../src/engine/templateFlowColours'
import { placeTemplate } from '../src/model/layout/templatePlacement'
import { serialize, type RecommendedRunConfig, type SavedFrame } from '../src/model/serialize'
import type { EdgePorts, LoopEdge, LoopNode } from '../src/model/types'

const { nodes, edges } = buildGachaBannerZonesGraph()

// ── the layout tables (study → product, see the header) ────────────────────
const LAYOUT: Record<string, [number, number]> = {
  all_zones_done: [1040, 36],
  ceiling_hits_pickup: [1424, 2548],
  ceiling_hits_standard: [1984, 1220],
  cmp1_hit_rate_free: [208, 36],
  cmp2_hit_rate_standard: [400, 36],
  cmp3_hit_rate_pickup: [592, 36],
  cmp4_pickup_rate_pickup: [784, 36],
  forced_ssr_standard: [2080, 1028],
  fund_free: [672, 308],
  fund_pickup: [2032, 1492],
  fund_standard: [1984, 308],
  missed_pickup_pickup: [1408, 1636],
  pickup_count_pickup: [1600, 2260],
  pickup_hit_pickup: [1360, 2068],
  pity_pickup: [1376, 2260],
  pity_standard: [2048, 884],
  pulls_made_free: [640, 932],
  pulls_made_pickup: [32, 2260],
  pulls_made_standard: [1712, 1220],
  pulls_per_zone: [16, 36],
  r_count_free: [176, 1028],
  r_count_pickup: [656, 2260],
  r_count_standard: [1744, 884],
  r_hit_free: [1184, 740],
  r_hit_pickup: [1184, 2068],
  r_hit_standard: [1952, 740],
  roll_forced_open_pickup: [1408, 2404],
  roll_forced_owed_pickup: [2032, 1924],
  roll_gate_free: [672, 596],
  roll_gate_standard: [1952, 596],
  roll_normal_open_pickup: [1408, 1780],
  roll_normal_owed_pickup: [1328, 1924],
  sr_count_free: [928, 932],
  sr_count_pickup: [880, 2356],
  sr_count_standard: [2304, 884],
  sr_hit_free: [672, 740],
  sr_hit_pickup: [16, 2068],
  sr_hit_standard: [2304, 740],
  ssr_count_free: [384, 932],
  ssr_count_pickup: [928, 2260],
  ssr_count_standard: [2560, 660],
  ssr_hit_free: [400, 740],
  ssr_hit_standard: [1680, 740],
  ssr_split_open_pickup: [1712, 1924],
  standard_count_pickup: [1104, 2484],
  standard_hit_pickup: [896, 2068],
  termination_fuel: [1232, 36],
  ticket_free: [656, 452],
  ticket_pickup: [2032, 1636],
  ticket_standard: [1968, 452],
  zone1_free_w_r: [16, 596],
  zone1_free_w_sr: [16, 452],
  zone1_free_w_ssr: [16, 308],
  zone2_standard_hard_pity: [1520, 740],
  zone2_standard_w_r: [1520, 596],
  zone2_standard_w_sr: [1520, 452],
  zone2_standard_w_ssr: [1520, 308],
  zone3_pickup_hard_pity: [2336, 1924],
  zone3_pickup_w_pickup: [2336, 2068],
  zone3_pickup_w_r: [2336, 1780],
  zone3_pickup_w_sr: [2336, 1636],
  zone3_pickup_w_ssr: [2336, 1492],
  zone3_pickup_w_standard: [2336, 2260],
}

const FACES: Record<string, EdgePorts> = {
  e_free_1: { source: 'bottom', target: 'top' },
  e_free_2: { source: 'bottom', target: 'top' },
  e_free_3: { source: 'bottom', target: 'top' },
  e_free_4: { source: 'bottom', target: 'top' },
  e_free_5: { source: 'bottom', target: 'top' },
  e_free_6: { source: 'bottom', target: 'top' },
  e_free_10: { source: 'bottom', target: 'top' },
  e_free_11: { source: 'bottom', target: 'top' },
  e_pickup_1: { source: 'bottom', target: 'top' },
  e_pickup_2: { source: 'bottom', target: 'top' },
  e_pickup_3: { source: 'bottom', target: 'top' },
  e_pickup_4: { source: 'bottom', target: 'top' },
  e_pickup_5: { source: 'bottom', target: 'top' },
  e_pickup_6: { source: 'top', target: 'bottom' },
  e_pickup_8: { source: 'top', target: 'bottom' },
  e_pickup_12: { source: 'top', target: 'bottom' },
  e_pickup_14: { source: 'bottom', target: 'top' },
  e_pickup_15: { source: 'top', target: 'bottom' },
  e_pickup_16: { source: 'bottom', target: 'top' },
  e_pickup_17: { source: 'bottom', target: 'top' },
  e_pickup_18: { source: 'bottom', target: 'top' },
  e_pickup_19: { source: 'bottom', target: 'top' },
  e_pickup_20: { source: 'bottom', target: 'top' },
  e_pickup_21: { source: 'bottom', target: 'top' },
  e_pickup_22: { source: 'bottom', target: 'top' },
  e_pickup_23: { source: 'bottom', target: 'top' },
  e_pickup_24: { source: 'bottom', target: 'top' },
  e_pickup_25: { source: 'bottom', target: 'top' },
  e_pickup_26: { source: 'bottom', target: 'top' },
  e_pickup_27: { source: 'bottom', target: 'top' },
  e_pickup_40: { source: 'top', target: 'bottom' },
  e_pickup_41: { source: 'top', target: 'bottom' },
  e_standard_1: { source: 'bottom', target: 'top' },
  e_standard_2: { source: 'bottom', target: 'top' },
  e_standard_3: { source: 'bottom', target: 'top' },
  e_standard_4: { source: 'bottom', target: 'top' },
  e_standard_5: { source: 'bottom', target: 'top' },
  e_standard_6: { source: 'bottom', target: 'top' },
  e_standard_10: { source: 'bottom', target: 'top' },
  e_standard_11: { source: 'bottom', target: 'top' },
  e_standard_12: { source: 'top', target: 'bottom' },
  e_standard_16: { source: 'top', target: 'bottom' },
  e_standard_20: { source: 'bottom', target: 'top' },
  e_standard_21: { source: 'bottom', target: 'top' },
  e_termination_fuel: { source: 'bottom', target: 'top' },
}

const FRAME_MEMBERS: Record<string, string[]> = {
  zone_comparison: ['pulls_per_zone', 'cmp1_hit_rate_free', 'cmp2_hit_rate_standard', 'cmp3_hit_rate_pickup', 'cmp4_pickup_rate_pickup', 'termination_fuel', 'all_zones_done'],
  zone_free: ['fund_free', 'ticket_free', 'pulls_made_free', 'zone1_free_w_ssr', 'zone1_free_w_sr', 'zone1_free_w_r', 'sr_count_free', 'r_count_free', 'ssr_count_free', 'roll_gate_free', 'ssr_hit_free', 'sr_hit_free', 'r_hit_free'],
  zone_standard: ['fund_standard', 'ticket_standard', 'pulls_made_standard', 'zone2_standard_w_ssr', 'zone2_standard_w_sr', 'zone2_standard_w_r', 'sr_count_standard', 'r_count_standard', 'ssr_count_standard', 'roll_gate_standard', 'ssr_hit_standard', 'sr_hit_standard', 'r_hit_standard', 'pity_standard', 'zone2_standard_hard_pity', 'forced_ssr_standard', 'ceiling_hits_standard'],
  zone_pickup: ['fund_pickup', 'ticket_pickup', 'pulls_made_pickup', 'zone3_pickup_w_ssr', 'zone3_pickup_w_sr', 'zone3_pickup_w_r', 'sr_count_pickup', 'r_count_pickup', 'ssr_count_pickup', 'pity_pickup', 'zone3_pickup_hard_pity', 'ceiling_hits_pickup', 'missed_pickup_pickup', 'zone3_pickup_w_pickup', 'zone3_pickup_w_standard', 'roll_normal_open_pickup', 'roll_normal_owed_pickup', 'roll_forced_open_pickup', 'roll_forced_owed_pickup', 'ssr_split_open_pickup', 'pickup_hit_pickup', 'standard_hit_pickup', 'sr_hit_pickup', 'r_hit_pickup', 'pickup_count_pickup', 'standard_count_pickup'],
}

// every node has a position and every position names a node
for (const id of Object.keys(LAYOUT)) if (!nodes.some((n) => n.id === id)) throw new Error(`LAYOUT names an unknown node ${id}`)
const positioned: LoopNode[] = nodes.map((n) => {
  const p = LAYOUT[n.id]
  if (!p) throw new Error(`LAYOUT has no position for ${n.id}`)
  return { ...n, position: { x: p[0], y: p[1] } }
})

// every face names a connection
for (const id of Object.keys(FACES)) if (!edges.some((e) => e.id === id)) throw new Error(`FACES names an unknown connection ${id}`)
const routedEdges: LoopEdge[] = (edges as LoopEdge[]).map((e) => {
  const data = e.data
  if (!data) throw new Error(`connection ${e.id} has no data`)
  return { ...e, data: { ...data, route: 'orthogonal' as const, ...(FACES[e.id] ? { ports: FACES[e.id] } : {}) } }
})

// frames: a provisional rectangle around the members' bodies (so membership
// resolves); `placeTemplate` rebuilds it around the measured boxes
const FRAME_PAD = 40
const BODY = { w: 150, h: 56 }
function rectOf(ids: string[]): { x: number; y: number; w: number; h: number } {
  const ps = positioned.filter((n) => ids.includes(n.id)).map((n) => n.position)
  if (ps.length !== ids.length) throw new Error(`frame members missing: ${ids.filter((id) => !positioned.some((n) => n.id === id)).join(', ')}`)
  const minX = Math.min(...ps.map((p) => p.x)) - FRAME_PAD
  const minY = Math.min(...ps.map((p) => p.y)) - FRAME_PAD
  const maxX = Math.max(...ps.map((p) => p.x)) + BODY.w + FRAME_PAD
  const maxY = Math.max(...ps.map((p) => p.y)) + BODY.h + FRAME_PAD
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
const FRAME_LABEL: Record<string, string> = {
  zone_comparison: 'Comparison',
  zone_free: ZONE_TITLE.free,
  zone_standard: ZONE_TITLE.standard,
  zone_pickup: ZONE_TITLE.pickup,
}
const FRAME_COLOR: Record<string, SavedFrame['color']> = { zone_free: 'sage', zone_standard: 'violet', zone_pickup: 'rose' }
const frames: SavedFrame[] = Object.entries(FRAME_MEMBERS).map(([id, members]) => ({
  id,
  label: FRAME_LABEL[id],
  rect: rectOf(members),
  ...(FRAME_COLOR[id] ? { color: FRAME_COLOR[id] } : {}),
}))
const allMembers = Object.values(FRAME_MEMBERS).flat()
if (new Set(allMembers).size !== nodes.length || allMembers.length !== nodes.length) throw new Error('every node belongs to exactly one frame')

const STEPS = PULLS_PER_ZONE + 2 // GZ3.5 round 4 — the global End's own horizon, exact
const recommendedRunConfig: RecommendedRunConfig = {
  baseSeed: 1,
  runs: 2000,
  steps: STEPS,
  tracked: TRACKED_POOLS,
  timelineSeries: DEFAULT_TIMELINE_SERIES,
  canvasLocked: true,
}

// docs/flow-colour-and-compact-nodes.md FC-6 — each zone's flow colour, the
// same as its frame's (cosmetic data, like the routing above)
const coloured = withTemplateFlowColours(positioned, routedEdges, GACHA_BANNER_ZONES_FLOWS)
// docs/diagram-layout.md §DL5 — placed for the grid: the measured boxes keep
// every language clear of every port, the frames travel with their nodes
const placed = placeTemplate('gacha-banner-zones', { ...coloured, frames: frames.map((f) => ({ ...f, rect: { ...f.rect } })) })
const text = serialize(placed.nodes, placed.edges, recommendedRunConfig, undefined, undefined, 2, placed.frames)
const outPath = fileURLToPath(new URL('../examples/gacha-banner-zones.json', import.meta.url))
writeFileSync(outPath, text + '\n')
console.log(`wrote ${outPath} (${positioned.length} nodes, ${edges.length} edges)`)
