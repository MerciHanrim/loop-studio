// docs/gacha-banner-zones.md (GZ) — one-off generator for
// examples/gacha-banner-zones.json, built from the SAME graph builder the
// engine fixture (src/engine/gacha-banner-zones.test.ts) uses, so the shipped
// Template and the tested graph can never drift apart.
//
// Layout (Hanrim, 2026-09-13, after reviewing round-3 screenshots): a bundled
// Template must read as "a 10-minute answer", not "a complex internal
// circuit" next to a Machinations-style board. Per zone, resource-flow nodes
// (tickets, gates, count Pools) sit in an UPPER band; pity/guarantee state
// and every Parameter sit in a LOWER band — so the dashed activator/afterPull
// lines cluster near the bottom instead of criss-crossing the whole frame.
// The 4 comparison Registers sit in one prominent horizontal row of their
// own, above all three zones, not a cramped stack in the corner.
//
// Run: npx tsx scripts/gen-gacha-banner-zones-example.ts

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TIMELINE_SERIES,
  PULLS_PER_ZONE,
  TRACKED_POOLS,
  ZONE_TITLE,
  buildGachaBannerZonesGraph,
  isControlNode,
  type ZoneKey,
} from '../src/engine/gachaBannerZonesGraph'
import { serialize, type RecommendedRunConfig, type SavedFrame } from '../src/model/serialize'
import type { LoopEdge, LoopNode } from '../src/model/types'

const { nodes, edges } = buildGachaBannerZonesGraph()

const COL_W = 190
const ROW_H = 100
const PAD = 40
const BAND_GAP = 60 // between a zone's flow band and its control band
const ZONE_GAP = 90 // between one zone's frame and the next

// The 5 comparison-area ids checked FIRST and explicitly: `pickup_share_pickup`
// and the 3 `hit_rate_<zone>` Registers all end with a zone suffix (like every
// per-zone node does) but must NOT be classified into that zone — they sit in
// the shared comparison row instead (bbox() below would otherwise scatter
// them across whichever zone their suffix happens to name).
const COMPARISON_IDS = new Set([
  'pulls_per_zone',
  'hit_rate_free',
  'hit_rate_standard',
  'hit_rate_pickup',
  'pickup_share_pickup',
])

function zoneOf(id: string): ZoneKey | 'shared' {
  if (COMPARISON_IDS.has(id)) return 'shared'
  // Parameter ids carry a `zoneN_<zone>_` PREFIX (paramId(), for Inputs-panel
  // sort order) rather than the `_<zone>` SUFFIX every other node id uses.
  if (id.startsWith('zone1_') || id.endsWith('_free')) return 'free'
  if (id.startsWith('zone2_') || id.endsWith('_standard')) return 'standard'
  if (id.startsWith('zone3_') || id.endsWith('_pickup')) return 'pickup'
  return 'shared'
}

const resEdges = edges.filter((e) => e.data.kind === 'resource')
const inBy = new Map<string, LoopEdge[]>()
for (const e of resEdges) {
  const list = inBy.get(e.target) ?? []
  list.push(e)
  inBy.set(e.target, list)
}

const depth = new Map<string, number>()
function depthOf(id: string, seen: Set<string>): number {
  if (depth.has(id)) return depth.get(id)!
  if (seen.has(id)) return 0 // guard against any accidental cycle
  seen.add(id)
  const ins = inBy.get(id) ?? []
  const d = ins.length === 0 ? 0 : 1 + Math.max(...ins.map((e) => depthOf(e.source, seen)))
  depth.set(id, d)
  return d
}
for (const n of nodes) depthOf(n.id, new Set())

// ── comparison row: the 4 Registers + the shared Parameter, side by side,
// above everything (its own frame, not colour-matched to any zone). ────────
const sharedNodes = nodes.filter((n) => zoneOf(n.id) === 'shared')
const positions = new Map<string, { x: number; y: number }>()
sharedNodes.forEach((n, i) => positions.set(n.id, { x: PAD + i * 260, y: 0 }))
const comparisonHeight = 140

// ── each zone: flow band (upper, depth/row-based) then control band
// (lower, a simple wrapped grid — Parameters/pity have no resource-edge
// topology among themselves worth laying out by depth). ───────────────────
const ZONES: ZoneKey[] = ['free', 'standard', 'pickup']
const CONTROL_COLS = 3
let cursorY = comparisonHeight + ZONE_GAP

for (const zone of ZONES) {
  const zoneNodes = nodes.filter((n) => zoneOf(n.id) === zone)
  const flowNodes = zoneNodes.filter((n) => !isControlNode(n.id))
  const controlNodes = zoneNodes.filter((n) => isControlNode(n.id))

  // Flow band.
  const rowByKey = new Map<string, number>()
  let maxFlowRow = 0
  for (const n of flowNodes) {
    const d = depth.get(n.id) ?? 0
    const row = rowByKey.get(String(d)) ?? 0
    rowByKey.set(String(d), row + 1)
    positions.set(n.id, { x: PAD + d * COL_W, y: cursorY + row * ROW_H })
    maxFlowRow = Math.max(maxFlowRow, row + 1)
  }
  const flowBandHeight = Math.max(1, maxFlowRow) * ROW_H
  const controlY = cursorY + flowBandHeight + BAND_GAP

  // Control band: a simple wrapped grid, widest column first (Parameters),
  // so it reads as a compact settings strip under the flow.
  controlNodes.forEach((n, i) => {
    const col = i % CONTROL_COLS
    const row = Math.floor(i / CONTROL_COLS)
    positions.set(n.id, { x: PAD + col * COL_W, y: controlY + row * ROW_H })
  })
  const controlRows = Math.ceil(controlNodes.length / CONTROL_COLS)
  const controlBandHeight = Math.max(1, controlRows) * ROW_H

  cursorY = controlY + controlBandHeight + ZONE_GAP
}

const positioned: LoopNode[] = nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } }))

function bbox(ids: string[]): { x: number; y: number; w: number; h: number } {
  const ps = positioned.filter((n) => ids.includes(n.id)).map((n) => n.position)
  const minX = Math.min(...ps.map((p) => p.x)) - PAD
  const minY = Math.min(...ps.map((p) => p.y)) - PAD
  const maxX = Math.max(...ps.map((p) => p.x)) + 150
  const maxY = Math.max(...ps.map((p) => p.y)) + 80
  return { x: Math.max(0, minX), y: Math.max(0, minY), w: maxX - minX, h: maxY - minY }
}

const idsByZone = (zone: ZoneKey | 'shared') => positioned.filter((n) => zoneOf(n.id) === zone).map((n) => n.id)

const frames: SavedFrame[] = [
  { id: 'zone_comparison', label: 'Comparison', rect: bbox(idsByZone('shared')) },
  { id: 'zone_free', label: ZONE_TITLE.free, rect: bbox(idsByZone('free')), color: 'sage' },
  { id: 'zone_standard', label: ZONE_TITLE.standard, rect: bbox(idsByZone('standard')), color: 'violet' },
  { id: 'zone_pickup', label: ZONE_TITLE.pickup, rect: bbox(idsByZone('pickup')), color: 'rose' },
]

const STEPS = PULLS_PER_ZONE + 1 // GZ3.5, exact
const recommendedRunConfig: RecommendedRunConfig = {
  baseSeed: 1,
  runs: 2000,
  steps: STEPS,
  tracked: TRACKED_POOLS,
  timelineSeries: DEFAULT_TIMELINE_SERIES,
  canvasLocked: true,
}

const text = serialize(positioned, edges as LoopEdge[], recommendedRunConfig, undefined, undefined, 2, frames)

const outPath = fileURLToPath(new URL('../examples/gacha-banner-zones.json', import.meta.url))
writeFileSync(outPath, text + '\n')
console.log(`wrote ${outPath} (${positioned.length} nodes, ${edges.length} edges)`)
