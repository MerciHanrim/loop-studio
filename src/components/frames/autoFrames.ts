import type { FrameRect } from '../../store/frameStore'

// docs/large-graph-readability-auto-frames.md (§AF, Slice 4b) — the pure
// clustering algorithm behind "Suggest frames". No store access, no React, no
// randomness. Deterministic label propagation over the WHOLE eligible drawn-edge
// graph in ONE run (disconnected components never share a label because there is
// no edge to propagate along), then merge-small / split-big / spatial-cohesion /
// overlap-resolution. Model nodes (parameter / register) never take part. Output
// is a DERIVED set — nothing here is ever serialized.
//
// GEOMETRY IS CANONICAL (§AF8 / review boundary 5): every spatial judgement —
// centre, member bbox, spatial split, overlap, ranking — uses a FIXED canonical
// node footprint, NEVER React Flow's live `measured` size. An identical
// (GraphDoc, positions) therefore yields byte-identical frames regardless of
// locale, label length, font load timing, browser, viewport / zoom, or whether
// `measured` has populated yet.

// ── tuning constants (§AF3.6 / §AF8 — all decided) ───────────────────────
/** GRAPH-LEVEL eligibility: if the whole eligible node set (non-model) is
 *  smaller than this, `Suggest frames` proposes nothing (§AF2.2). NOT a
 *  per-component gate. */
export const WORTH_IT_FLOOR = 8
/** a group smaller than this is merged into a neighbour or dropped (§AF3.6 r1);
 *  also the minimum size of either side of a spatial cut. */
export const MIN_FRAME_NODES = 3
/** a group larger than this fraction of the WHOLE eligible framed node total is
 *  split on its longer axis (§AF3.6 r2). */
export const MAX_FRAME_FRACTION = 0.55
/** a spatial split needs an empty band at least this wide (flow units). */
export const MIN_SPLIT_GAP = 120
/** at most this many auto frames for the WHOLE graph — a CEILING, not a target;
 *  the rest are DROPPED, never force-merged (§AF3.6 r4). */
export const MAX_FRAMES = 6
/** flow-unit padding around a frame's member bounding box (§AF3.6 r5). */
export const AUTO_FRAME_PAD = 24
/** a frame rect is never smaller than this in either dimension (flow units). */
export const AUTO_FRAME_MIN = 48
/** label propagation stops at a fixpoint or this many rounds (§AF3.2). */
const LP_MAX_ROUNDS = 20

/** CANONICAL node footprint (flow units). The ONLY node size the algorithm ever
 *  uses. Fixed so results never depend on live DOM `measured` dimensions
 *  (§AF8). Chosen to comfortably wrap a typical node body; the drawn frame is
 *  this footprint's bbox + `AUTO_FRAME_PAD`. */
export const CANON_NODE_W = 150
export const CANON_NODE_H = 40

// ── spatial-cohesion + overlap-resolution (§AF3.6 r3 / r4, review boundary 5) ──
/** a group is CONTAMINATED — and must be split or dropped — when the count of
 *  non-member, non-model node centres inside its member-centre bbox exceeds
 *  `max(2, floor(memberCount * 0.5))`. EVERY retained frame satisfies the
 *  negation of this (§AF3.6 / §AF3.7). */
export const foreignBudget = (memberCount: number): number =>
  Math.max(2, Math.floor(memberCount * 0.5))
/** overlap-resolution drops a candidate that covers more than this share of the
 *  SMALLER of the two rects of an already-kept frame. */
export const MAX_OVERLAP_FRAC = 0.5
/** spatial-cohesion recursion depth ceiling (each split strictly shrinks a
 *  group, so this is only a backstop). */
export const SPATIAL_MAX_DEPTH = 6

// ── inputs ──────────────────────────────────────────────────────────────
export type AFNode = {
  id: string
  kind: string
  position: { x: number; y: number }
  // present for shape compatibility with the store's node type; NEVER read.
  measured?: { width?: number | null; height?: number | null } | null
  width?: number | null
  height?: number | null
}
export type AFEdge = { source: string; target: string }

export type AutoFrameResult = {
  /** frame order ordinal, 1-based, by (rect.y, rect.x, representativeNodeId). */
  area: number
  rect: FrameRect
  /** the clustered node ids — for tests / fixture assertions / the staleness
   *  check; the RENDER layer treats a frame as a pure rectangle. */
  members: string[]
}

/** why a candidate cluster did NOT become a final frame (§AF3.7 reporting / the
 *  fixture "every retained frame is clean" assertion is the positive side). */
export type AutoFrameDrop = {
  members: string[]
  size: number
  foreign: number
  reason:
    | 'contaminated: no valid spatial gap'
    | 'contaminated: spatial recursion depth cap'
    | 'exceeds MAX_FRAME_FRACTION: not spatially separable'
    | 'overlap > MAX_OVERLAP_FRAC of a kept frame'
    | 'MAX_FRAMES ceiling reached'
}

const isModel = (kind: string): boolean => kind === 'parameter' || kind === 'register'

/** the ONE node rect the algorithm uses — canonical footprint at the node's
 *  flow position. `measured` is deliberately ignored (§AF8). */
const canonRect = (n: AFNode): FrameRect => ({
  x: n.position.x,
  y: n.position.y,
  w: CANON_NODE_W,
  h: CANON_NODE_H,
})

/** Adjacency as a MULTIGRAPH — `adj.get(a)` lists `b` once per drawn edge
 *  `a—b` (§AF3.2). Self loops and edges touching an excluded node are skipped. */
function buildAdj(nodes: AFNode[], edges: AFEdge[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }
  return adj
}

/** components over the drawn-edge graph, big-first, each id-sorted. Diagnostic
 *  only — framing is graph-level (§AF2.2). */
export function connectedComponents(nodes: AFNode[], adj: Map<string, string[]>): string[][] {
  const seen = new Set<string>()
  const comps: string[][] = []
  for (const start of nodes.map((n) => n.id).sort()) {
    if (seen.has(start)) continue
    const stack = [start]
    const c: string[] = []
    seen.add(start)
    while (stack.length) {
      const x = stack.pop()!
      for (const y of [...new Set(adj.get(x)!)].sort()) {
        if (!seen.has(y)) {
          seen.add(y)
          stack.push(y)
        }
      }
      c.push(x)
    }
    comps.push(c.sort())
  }
  return comps.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1))
}

// ── deterministic label propagation (§AF3.2 / §AF8) ──────────────────────
function labelPropagation(compIds: string[], adj: Map<string, string[]>): Map<string, string[]> {
  const order = [...compIds].sort()
  const label = new Map<string, string>(order.map((id) => [id, id]))
  for (let round = 0; round < LP_MAX_ROUNDS; round++) {
    let changed = false
    for (const id of order) {
      const freq = new Map<string, number>()
      for (const nb of adj.get(id)!) {
        const l = label.get(nb)
        if (l === undefined) continue
        freq.set(l, (freq.get(l) ?? 0) + 1)
      }
      if (freq.size === 0) continue
      let best: string | null = null
      let bestC = -1
      for (const [l, c] of [...freq].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (c > bestC) {
          bestC = c
          best = l
        }
      }
      if (best !== null && best !== label.get(id)) {
        label.set(id, best)
        changed = true
      }
    }
    if (!changed) break
  }
  const groups = new Map<string, string[]>()
  for (const id of order) {
    const l = label.get(id)!
    if (!groups.has(l)) groups.set(l, [])
    groups.get(l)!.push(id)
  }
  for (const g of groups.values()) g.sort()
  return groups
}

// ── post-pass helpers (§AF3.6) ──────────────────────────────────────────
type Group = { members: string[] }
type Centre = Map<string, { cx: number; cy: number }>

const repId = (g: Group): string => g.members[0] // members are id-sorted
const density = (g: Group, adj: Map<string, string[]>): number => {
  if (g.members.length < 2) return 0
  const set = new Set(g.members)
  let e = 0
  for (const m of g.members) for (const nb of adj.get(m)!) if (set.has(nb) && m < nb) e++
  return e / g.members.length
}

/** rule 1 — merge a group with < MIN_FRAME_NODES into the neighbour group it
 *  shares the most drawn edges with; drop it if it has no inter-group edge. */
function mergeSmall(groups: Group[], adj: Map<string, string[]>): Group[] {
  let work = groups.map((g) => ({ members: [...g.members] }))
  for (;;) {
    work.sort((a, b) => (repId(a) < repId(b) ? -1 : 1))
    const idx = work.findIndex((g) => g.members.length < MIN_FRAME_NODES)
    if (idx === -1) break
    const small = work[idx]
    let bestJ = -1
    let bestShared = 0
    let bestRep = ''
    for (let j = 0; j < work.length; j++) {
      if (j === idx) continue
      const other = new Set(work[j].members)
      let shared = 0
      for (const m of small.members) for (const nb of adj.get(m)!) if (other.has(nb)) shared++
      if (
        shared > bestShared ||
        (shared === bestShared && shared > 0 && (bestJ === -1 || repId(work[j]) < bestRep))
      ) {
        bestShared = shared
        bestJ = j
        bestRep = repId(work[j])
      }
    }
    if (bestJ === -1 || bestShared === 0) {
      work = work.filter((_, i) => i !== idx)
    } else {
      work[bestJ] = {
        members: [...work[bestJ].members, ...small.members]
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort(),
      }
      work = work.filter((_, i) => i !== idx)
    }
  }
  return work
}

/** rule 2 — split a group holding > MAX_FRAME_FRACTION of the framed total by a
 *  single spatial cut on its longer bbox axis at the widest gap; recurse ≤ 2. */
function splitBig(groups: Group[], centre: Centre, framedTotal: number, depth = 0): Group[] {
  if (framedTotal === 0) return groups
  const out: Group[] = []
  for (const g of groups) {
    if (
      depth >= 2 ||
      g.members.length / framedTotal <= MAX_FRAME_FRACTION ||
      g.members.length < 2 * MIN_FRAME_NODES
    ) {
      out.push(g)
      continue
    }
    const pts = g.members.map((id) => ({ id, ...centre.get(id)! }))
    const xs = [...pts].sort((a, b) => a.cx - b.cx || (a.id < b.id ? -1 : 1))
    const ys = [...pts].sort((a, b) => a.cy - b.cy || (a.id < b.id ? -1 : 1))
    const spanX = xs[xs.length - 1].cx - xs[0].cx
    const spanY = ys[ys.length - 1].cy - ys[0].cy
    const useX = spanX >= spanY
    const sorted = useX ? xs : ys
    const coord = (p: { cx: number; cy: number }) => (useX ? p.cx : p.cy)
    let gap = 0
    let cutAfter = -1
    let cutLow = Infinity
    for (let i = 0; i < sorted.length - 1; i++) {
      const d = coord(sorted[i + 1]) - coord(sorted[i])
      const low = coord(sorted[i])
      if (d > gap || (d === gap && low < cutLow)) {
        gap = d
        cutAfter = i
        cutLow = low
      }
    }
    if (
      gap < MIN_SPLIT_GAP ||
      cutAfter < 0 ||
      cutAfter + 1 < MIN_FRAME_NODES ||
      sorted.length - (cutAfter + 1) < MIN_FRAME_NODES
    ) {
      out.push(g)
      continue
    }
    const a: Group = { members: sorted.slice(0, cutAfter + 1).map((p) => p.id).sort() }
    const b: Group = { members: sorted.slice(cutAfter + 1).map((p) => p.id).sort() }
    out.push(...splitBig([a, b], centre, framedTotal, depth + 1))
  }
  return out
}

const memberBbox = (
  members: string[],
  centre: Centre,
): { x0: number; y0: number; x1: number; y1: number } => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const id of members) {
    const c = centre.get(id)!
    x0 = Math.min(x0, c.cx)
    y0 = Math.min(y0, c.cy)
    x1 = Math.max(x1, c.cx)
    y1 = Math.max(y1, c.cy)
  }
  return { x0, y0, x1, y1 }
}

/** non-member, non-model node centres that fall inside a group's member bbox. */
export function foreignCount(members: string[], centre: Centre, allIds: string[]): number {
  const b = memberBbox(members, centre)
  const mem = new Set(members)
  let n = 0
  for (const id of allIds) {
    if (mem.has(id)) continue
    const c = centre.get(id)
    if (!c) continue
    if (c.cx >= b.x0 && c.cx <= b.x1 && c.cy >= b.y0 && c.cy <= b.y1) n++
  }
  return n
}

const isContaminated = (foreign: number, memberCount: number): boolean =>
  foreign > foreignBudget(memberCount)

/** the deterministic bisection for a contaminated group: the axis with the
 *  larger NORMALIZED largest-gap (tie → x); within it the largest raw gap that
 *  leaves both sides ≥ MIN_FRAME_NODES and is ≥ MIN_SPLIT_GAP; gap ties →
 *  smaller lower-bound coord → smaller min id. `null` when no such gap exists. */
function bestSpatialCut(members: string[], centre: Centre): { a: string[]; b: string[] } | null {
  if (members.length < 2 * MIN_FRAME_NODES) return null
  const pts = members.map((id) => ({ id, ...centre.get(id)! }))
  const axisTry = (key: 'cx' | 'cy') => {
    const sorted = [...pts].sort((p, q) => p[key] - q[key] || (p.id < q.id ? -1 : 1))
    const span = sorted[sorted.length - 1][key] - sorted[0][key]
    const gaps: { i: number; raw: number; low: number }[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push({ i, raw: sorted[i + 1][key] - sorted[i][key], low: sorted[i][key] })
    }
    gaps.sort((g, h) => h.raw - g.raw || g.low - h.low || (sorted[g.i].id < sorted[h.i].id ? -1 : 1))
    for (const g of gaps) {
      const left = g.i + 1
      const right = sorted.length - left
      if (left >= MIN_FRAME_NODES && right >= MIN_FRAME_NODES && g.raw >= MIN_SPLIT_GAP) {
        return {
          normGap: span > 0 ? g.raw / span : 0,
          a: sorted.slice(0, left).map((p) => p.id),
          b: sorted.slice(left).map((p) => p.id),
        }
      }
    }
    return null
  }
  const cx = axisTry('cx')
  const cy = axisTry('cy')
  if (!cx && !cy) return null
  if (cx && cy) return cy.normGap > cx.normGap ? { a: cy.a, b: cy.b } : { a: cx.a, b: cx.b }
  return cx ? { a: cx.a, b: cx.b } : { a: cy!.a, b: cy!.b }
}

/** rule 3 — SPATIAL COHESION. A group whose member bbox is uncontaminated is a
 *  candidate as-is. A contaminated group is bisected at its widest spatial gap
 *  and each side re-checked. A contaminated group that CANNOT be bisected (no
 *  gap ≥ MIN_SPLIT_GAP leaving two ≥ MIN_FRAME_NODES sides) or that is still
 *  contaminated at SPATIAL_MAX_DEPTH is **DROPPED** — never kept as a final
 *  frame. Every group this returns satisfies `foreign ≤ foreignBudget(size)`. */
function spatialCohesion(
  groups: Group[],
  centre: Centre,
  allIds: string[],
  drops: AutoFrameDrop[],
  depth = 0,
): Group[] {
  const kept: Group[] = []
  for (const g of groups) {
    const foreign = foreignCount(g.members, centre, allIds)
    if (!isContaminated(foreign, g.members.length)) {
      kept.push(g)
      continue
    }
    if (depth >= SPATIAL_MAX_DEPTH) {
      drops.push({
        members: g.members,
        size: g.members.length,
        foreign,
        reason: 'contaminated: spatial recursion depth cap',
      })
      continue
    }
    const cut = bestSpatialCut(g.members, centre)
    if (!cut) {
      drops.push({
        members: g.members,
        size: g.members.length,
        foreign,
        reason: 'contaminated: no valid spatial gap',
      })
      continue
    }
    const kids = [cut.a, cut.b].map((m) => ({ members: [...m].sort() }))
    kept.push(...spatialCohesion(kids, centre, allIds, drops, depth + 1))
  }
  return kept
}

const rectArea = (r: FrameRect) => r.w * r.h
const rectOverlap = (a: FrameRect, b: FrameRect): number => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

/** rule 4 — OVERLAP RESOLUTION + the MAX_FRAMES ceiling. Rank candidates
 *  (size ↓, density ↓, min id ↑). Keep in rank order, skipping any that covers
 *  > MAX_OVERLAP_FRAC of the SMALLER rect of an already-kept frame. Stop at
 *  MAX_FRAMES. Never shrink, merge, or backfill. */
function resolveOverlap(
  candidates: { members: string[]; rect: FrameRect }[],
  adj: Map<string, string[]>,
  drops: AutoFrameDrop[],
): { members: string[]; rect: FrameRect }[] {
  const ranked = [...candidates].sort((x, y) => {
    if (y.members.length !== x.members.length) return y.members.length - x.members.length
    const dx = density({ members: x.members }, adj)
    const dy = density({ members: y.members }, adj)
    if (dy !== dx) return dy - dx
    return x.members[0] < y.members[0] ? -1 : 1
  })
  const kept: { members: string[]; rect: FrameRect }[] = []
  for (const c of ranked) {
    if (kept.length >= MAX_FRAMES) {
      drops.push({
        members: c.members,
        size: c.members.length,
        foreign: 0,
        reason: 'MAX_FRAMES ceiling reached',
      })
      continue
    }
    const clash = kept.some(
      (k) => rectOverlap(c.rect, k.rect) > MAX_OVERLAP_FRAC * Math.min(rectArea(c.rect), rectArea(k.rect)),
    )
    if (clash) {
      drops.push({
        members: c.members,
        size: c.members.length,
        foreign: 0,
        reason: 'overlap > MAX_OVERLAP_FRAC of a kept frame',
      })
      continue
    }
    kept.push(c)
  }
  return kept
}

// ── rect ────────────────────────────────────────────────────────────────
function frameRect(members: string[], rectById: Map<string, FrameRect>): FrameRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of members) {
    const r = rectById.get(id)!
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  let x = Math.round(minX - AUTO_FRAME_PAD)
  let y = Math.round(minY - AUTO_FRAME_PAD)
  let w = Math.round(maxX - minX + 2 * AUTO_FRAME_PAD)
  let h = Math.round(maxY - minY + 2 * AUTO_FRAME_PAD)
  if (w < AUTO_FRAME_MIN) {
    x = Math.round(x - (AUTO_FRAME_MIN - w) / 2)
    w = AUTO_FRAME_MIN
  }
  if (h < AUTO_FRAME_MIN) {
    y = Math.round(y - (AUTO_FRAME_MIN - h) / 2)
    h = AUTO_FRAME_MIN
  }
  return { x, y, w, h }
}

// ── the algorithm (§AF10.2) ─────────────────────────────────────────────
/** intermediate stages, for the per-stage regression tests (§AF3.6 Table A /
 *  A′ / B). Never used by the app — only `suggestFrames` is. */
export type AutoFrameStages = {
  /** raw LP + merge-small + split-big — the topology-algorithm baseline (Table A) */
  tableA: number[]
  /** groups after spatial cohesion + the S3 gate — the split-stage output (Table A′) */
  candidates: number[]
  /** final frames (Table B) */
  frames: AutoFrameResult[]
  /** every dropped candidate + its reason */
  drops: AutoFrameDrop[]
}

function pipeline(
  nodesIn: readonly AFNode[],
  edgesIn: readonly AFEdge[],
): AutoFrameStages | null {
  const nodes = nodesIn.filter((n) => !isModel(n.kind))
  if (nodes.length < WORTH_IT_FLOOR) return null

  const edges = edgesIn.map((e) => ({ source: e.source, target: e.target }))
  const adj = buildAdj(nodes, edges)
  const rectById = new Map<string, FrameRect>(nodes.map((n) => [n.id, canonRect(n)]))
  const centreById: Centre = new Map(
    nodes.map((n) => {
      const r = rectById.get(n.id)!
      return [n.id, { cx: r.x + r.w / 2, cy: r.y + r.h / 2 }]
    }),
  )
  const allIds = nodes.map((n) => n.id)
  const drops: AutoFrameDrop[] = []

  // ONE label-propagation run over every eligible node id (§AF3.2).
  const lp = labelPropagation(allIds, adj)
  let groups: Group[] = [...lp.values()].map((members) => ({ members }))
  groups = mergeSmall(groups, adj)
  const framedTotal = groups.reduce((s, g) => s + g.members.length, 0)
  groups = splitBig(groups, centreById, framedTotal)
  const tableA = groups.map((g) => g.members.length).sort((a, b) => b - a)

  // rule 3 — spatial cohesion: split or DROP every contaminated group.
  groups = spatialCohesion(groups, centreById, allIds, drops)

  // rule 3b — S3 acceptance gate: an uncontaminated survivor that STILL holds
  // more than MAX_FRAME_FRACTION of the eligible nodes (split-big recurses only
  // twice) is DROPPED rather than drawn as a mega-frame.
  const megaCap = MAX_FRAME_FRACTION * allIds.length
  groups = groups.filter((g) => {
    if (g.members.length > megaCap) {
      drops.push({
        members: g.members,
        size: g.members.length,
        foreign: foreignCount(g.members, centreById, allIds),
        reason: 'exceeds MAX_FRAME_FRACTION: not spatially separable',
      })
      return false
    }
    return true
  })
  const candidates = groups.map((g) => g.members.length).sort((a, b) => b - a)

  // rule 4 — overlap resolution + the MAX_FRAMES ceiling.
  const cand = groups
    .filter((g) => g.members.length >= MIN_FRAME_NODES)
    .map((g) => ({ members: [...g.members].sort(), rect: frameRect(g.members, rectById) }))
  const kept = resolveOverlap(cand, adj, drops)

  // §AF8 — frame order by (rect.y, rect.x, representativeNodeId)
  kept.sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.members[0] < b.members[0] ? -1 : 1),
  )
  const frames = kept.map((f, i) => ({ area: i + 1, rect: f.rect, members: f.members }))
  return { tableA, candidates, frames, drops }
}

/**
 * Deterministic: identical `(nodes, edges)` — in ANY array order, on ANY
 * browser, in ANY locale, whatever `measured` holds — yields byte-identical
 * `AutoFrameResult[]` (§AF8). Model nodes are excluded. Returns `[]` when
 * nothing is worth framing (a normal result, never an error). Every returned
 * frame satisfies the acceptance contract (§AF3.6): `foreignCount ≤
 * foreignBudget(memberCount)`, `MIN_FRAME_NODES ≤ size ≤ MAX_FRAME_FRACTION ×
 * eligibleCount`, no pair overlapping > `MAX_OVERLAP_FRAC` of the smaller rect,
 * at most `MAX_FRAMES`. A candidate that cannot is dropped — so fewer than
 * `MAX_FRAMES` frames, or none, is valid.
 */
export function suggestFrames(
  nodesIn: readonly AFNode[],
  edgesIn: readonly AFEdge[],
  dropSink?: AutoFrameDrop[],
): AutoFrameResult[] {
  const stages = pipeline(nodesIn, edgesIn)
  if (!stages) return []
  if (dropSink) dropSink.push(...stages.drops)
  return stages.frames
}

/** stage-by-stage view for the §AF3.6 regression tests. Returns `null` below
 *  the `WORTH_IT_FLOOR`. */
export function analyzeStages(
  nodesIn: readonly AFNode[],
  edgesIn: readonly AFEdge[],
): AutoFrameStages | null {
  return pipeline(nodesIn, edgesIn)
}

/** foreign-node count for a finished frame (S8 assertion helper). */
export function frameForeign(
  frame: AutoFrameResult,
  nodesIn: readonly AFNode[],
): number {
  const nonModel = nodesIn.filter((n) => !isModel(n.kind))
  const centre: Centre = new Map(
    nonModel.map((n) => [n.id, { cx: n.position.x + CANON_NODE_W / 2, cy: n.position.y + CANON_NODE_H / 2 }]),
  )
  return foreignCount(frame.members, centre, nonModel.map((n) => n.id))
}
