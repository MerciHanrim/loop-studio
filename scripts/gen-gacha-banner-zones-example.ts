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
// Layout round 2 (Hanrim, 2026-09-13, live-preview node-spacing review):
// stacking the 3 zones VERTICALLY wasted all the horizontal room a normal
// viewport has, so fit-to-view shrank every node to ~24px — illegible. Zones
// now sit SIDE BY SIDE below the comparison row instead, each keeping its
// own two-band (flow/control) layout. The Pickup zone also gets wider flow
// columns than Free/Standard (`COL_W_PICKUP`) — its 4-path structure packs
// more nodes into adjacent depth columns, which produced ~20px real overlaps
// at the old shared `COL_W`. The comparison row's card pitch is widened too
// — the 4 Register cards nearly touched once their labels carried an
// explicit zone tag.
//
// Layout round 3 (Hanrim, 2026-09-13, comparison-frame review): `bbox()`
// assumed every node draws at the same generic ~150×80 footprint used by the
// small flow/control nodes — wrong for the 5 wide comparison cards, which
// measure up to ~260×102px (checked directly in the browser, EN/KO/JA, at
// zoom 1 — `pulls_per_zone`/`cmp1..4_*`; a Register's box width turned out to
// be effectively LOCALE-INVARIANT, capped by its own CSS rather than growing
// with the label, so a longer translation adds wrapped lines — taller, not
// wider). The old fixed 150px assumption left the comparison frame's right
// edge ~110px short of the actual last-card edge, visibly clipping it, and a
// separate hardcoded `comparisonHeight` guess (unrelated to the frame's real
// computed height) put the zone row ~110px further down than the frame's
// real bottom, reading as a disconnected gap. Fixed: `COMPARISON_CARD_W/H`
// hold the real measured max + a small safety margin (for a future
// translation that wraps a little wider/taller than what's measured today);
// `bbox()` takes a footprint override so the comparison frame is sized from
// these instead of the generic default; the shared row sits at `y: PAD`
// (was `0`) so the frame gets an actual top margin instead of clamping it
// away; `zoneRowY` is now the comparison frame's REAL bottom edge + one PAD,
// not an independent guess.
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
const COL_W_PICKUP = 270 // wider flow-band columns for Pickup's denser 4-path structure (+80 over COL_W)
const ROW_H = 100
const PAD = 40
const BAND_GAP = 60 // between a zone's flow band and its control band
const ZONE_GAP_X = 120 // between one zone's frame and the next (zones are laid out horizontally)
const CONTROL_COLS = 3
const CARD_GAP_X = 340 // comparison-row card pitch (was 260 — cards nearly touched once labels grew)
// Real measured max card size (EN/KO/JA, zoom 1): width maxes out at ~260px
// (locale-invariant — a Register card's width is CSS-capped, longer text
// wraps instead of widening) and height at ~102px (a 2-line label). +20/+8
// safety margin for a future translation that wraps a touch wider/taller.
const COMPARISON_CARD_W = 280
const COMPARISON_CARD_H = 110

// The comparison-area ids checked FIRST and explicitly: the shared Parameter
// plus the 4 `cmpN_...` Registers all carry a real per-zone suffix (like
// every per-zone node does) but must NOT be classified into that zone — they
// sit in the shared comparison row instead (bbox() below would otherwise
// scatter them across whichever zone their suffix happens to name).
const COMPARISON_IDS = new Set([
  'pulls_per_zone',
  'cmp1_hit_rate_free',
  'cmp2_hit_rate_standard',
  'cmp3_hit_rate_pickup',
  'cmp4_pickup_rate_pickup',
])

// Checked in `zoneN_` PREFIX order FIRST: a role name can itself contain
// another zone's name as a suffix (`zone3_pickup_w_standard` ends with
// `_standard`), which used to misclassify that Parameter into Zone 2 when
// the old code OR'd a zone's prefix check with its suffix check on the same
// line. Prefix match is unambiguous for every `zoneN_`-prefixed Parameter id
// and always wins now; suffix match is only a fallback for the ids (Pool /
// Gate / Source) that carry no `zoneN_` prefix at all.
function zoneOf(id: string): ZoneKey | 'shared' {
  if (COMPARISON_IDS.has(id)) return 'shared'
  if (id.startsWith('zone1_')) return 'free'
  if (id.startsWith('zone2_')) return 'standard'
  if (id.startsWith('zone3_')) return 'pickup'
  if (id.endsWith('_free')) return 'free'
  if (id.endsWith('_standard')) return 'standard'
  if (id.endsWith('_pickup')) return 'pickup'
  return 'shared'
}

const COL_W_BY_ZONE: Record<ZoneKey, number> = { free: COL_W, standard: COL_W, pickup: COL_W_PICKUP }

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
// above everything (its own frame, not colour-matched to any zone). Sits at
// `y: PAD`, not `0`, so the frame below gets a real top margin instead of
// clamping a negative one away. ────────────────────────────────────────────
const sharedNodes = nodes.filter((n) => zoneOf(n.id) === 'shared')
const positions = new Map<string, { x: number; y: number }>()
sharedNodes.forEach((n, i) => positions.set(n.id, { x: PAD + i * CARD_GAP_X, y: PAD }))
// The comparison frame's REAL bottom edge (not a hardcoded guess) — its own
// footprint's height already includes the PAD top margin (see `bbox`'s
// `footprint` param below), so this is directly `frame.y + frame.h`.
const comparisonFrameBottom = PAD + PAD + COMPARISON_CARD_H
// A real, deliberate seam between the comparison frame and the zone row
// below it — small enough to read as connected, not zero (which would make
// the two frame borders touch) and nowhere near the old ~110px gap the
// footprint bug produced.
const COMPARISON_TO_ZONE_GAP = 30

// ── the three zones, laid out SIDE BY SIDE (not stacked — see layout round
// 2 above). Each zone keeps its own flow band (upper, depth/row-based) then
// control band (lower, a simple wrapped grid — Parameters/pity have no
// resource-edge topology among themselves worth laying out by depth). ─────
const ZONES: ZoneKey[] = ['free', 'standard', 'pickup']
// `+ PAD` is the zone's OWN top margin (bbox subtracts PAD from its first
// node's y), so the zone frame's border ends up exactly
// `COMPARISON_TO_ZONE_GAP` below the comparison frame's real bottom edge.
const zoneRowY = comparisonFrameBottom + COMPARISON_TO_ZONE_GAP + PAD

function maxFlowDepth(zone: ZoneKey): number {
  const ds = nodes.filter((n) => zoneOf(n.id) === zone && !isControlNode(n.id)).map((n) => depth.get(n.id) ?? 0)
  return ds.length > 0 ? Math.max(...ds) : 0
}

function zoneWidth(zone: ZoneKey): number {
  const colW = COL_W_BY_ZONE[zone]
  const flowWidth = (maxFlowDepth(zone) + 1) * colW
  const controlWidth = CONTROL_COLS * colW
  return Math.max(flowWidth, controlWidth) + 150 // + a node's own drawn width
}

const zoneOriginX: Record<ZoneKey, number> = { free: 0, standard: 0, pickup: 0 }
{
  let cursorX = PAD
  for (const zone of ZONES) {
    zoneOriginX[zone] = cursorX
    cursorX += zoneWidth(zone) + ZONE_GAP_X
  }
}

for (const zone of ZONES) {
  const colW = COL_W_BY_ZONE[zone]
  const originX = zoneOriginX[zone]
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
    positions.set(n.id, { x: originX + d * colW, y: zoneRowY + row * ROW_H })
    maxFlowRow = Math.max(maxFlowRow, row + 1)
  }
  const flowBandHeight = Math.max(1, maxFlowRow) * ROW_H
  const controlY = zoneRowY + flowBandHeight + BAND_GAP

  // Control band: a simple wrapped grid, widest column first (Parameters),
  // so it reads as a compact settings strip under the flow.
  controlNodes.forEach((n, i) => {
    const col = i % CONTROL_COLS
    const row = Math.floor(i / CONTROL_COLS)
    positions.set(n.id, { x: originX + col * colW, y: controlY + row * ROW_H })
  })
}

const positioned: LoopNode[] = nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } }))

// `footprint` is the assumed (width, height) beyond a node's own `position`
// used to grow the frame past its rightmost/bottommost node — the default
// (150×80) fits the small flow/control nodes elsewhere, but is too small for
// the much wider/taller comparison cards (layout round 3). Passing it in
// keeps left/top margins equal to right/bottom (both derive from the same
// PAD, since `footprint.w/h` is itself `PAD + <real max card size>` for the
// comparison call below).
function bbox(
  ids: string[],
  footprint: { w: number; h: number } = { w: 150, h: 80 },
): { x: number; y: number; w: number; h: number } {
  const ps = positioned.filter((n) => ids.includes(n.id)).map((n) => n.position)
  const minX = Math.min(...ps.map((p) => p.x)) - PAD
  const minY = Math.min(...ps.map((p) => p.y)) - PAD
  const maxX = Math.max(...ps.map((p) => p.x)) + footprint.w
  const maxY = Math.max(...ps.map((p) => p.y)) + footprint.h
  return { x: Math.max(0, minX), y: Math.max(0, minY), w: maxX - minX, h: maxY - minY }
}

const idsByZone = (zone: ZoneKey | 'shared') => positioned.filter((n) => zoneOf(n.id) === zone).map((n) => n.id)

// footprint.w/h = PAD + the real max card size, so the frame's right/bottom
// margin past the last card comes out exactly PAD too (matching its own
// left/top margin) — see the layout round 3 header note for the derivation.
const COMPARISON_FOOTPRINT = { w: PAD + COMPARISON_CARD_W, h: PAD + COMPARISON_CARD_H }

const frames: SavedFrame[] = [
  { id: 'zone_comparison', label: 'Comparison', rect: bbox(idsByZone('shared'), COMPARISON_FOOTPRINT) },
  { id: 'zone_free', label: ZONE_TITLE.free, rect: bbox(idsByZone('free')), color: 'sage' },
  { id: 'zone_standard', label: ZONE_TITLE.standard, rect: bbox(idsByZone('standard')), color: 'violet' },
  { id: 'zone_pickup', label: ZONE_TITLE.pickup, rect: bbox(idsByZone('pickup')), color: 'rose' },
]

const STEPS = PULLS_PER_ZONE + 2 // GZ3.5 round 4 — the global End's own horizon, exact
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
