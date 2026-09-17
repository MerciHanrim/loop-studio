// docs/edge-routing.md §ER3 — the input corpus every router test runs on.
//
// Three sources, all deterministic and reproducible from data already in the
// repo (so the golden fixture stores OUTPUTS only, never the 60–96-obstacle
// inputs):
//
//   1. `exampleCases`  — every orthogonal edge of every bundled example, built
//      EXACTLY the way `src/store/routeMap.ts` `rebuild` builds it, with the
//      real MEASURED node sizes captured from the running app
//      (`fixtures/routes/measured-node-sizes.json`). This is the corpus a user
//      actually sees.
//   2. `boundaryCases` — hand-written inputs that sit ON the decision
//      boundaries of the router: the wide-channel ruler threshold (2·ROUTE_PAD),
//      COORD_EPS rounding either side of zero, endpoints inside / touching an
//      inflated obstacle, every special case (same-side / self-loop /
//      degenerate), both `fallback-lz` escapes, invalid waypoints, parallel fans.
//   3. `randomCases`   — seeded random layouts, for coverage a fixture cannot
//      enumerate. Used by the differential test only.
//
// Test-only module: never imported by the app.
import { Position } from '@xyflow/react'
import { readFileSync } from 'node:fs'
import type { Box, Pt, RouteInput } from '../src/components/edges/orthogonalRoute'

const DEFAULT_W = 130
const DEFAULT_H = 64
/** must match ROUTE_PAD in the router; duplicated so a change to it is visible here */
const PAD = 12

export type Case = { name: string; input: RouteInput }

type RawNode = { id: string; position: { x: number; y: number } }
type RawEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: { route?: string; waypoints?: Pt[] }
}
type RawDoc = { nodes: RawNode[]; edges: RawEdge[] }

const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T

/** measured width/height per node, captured once from the running app */
const MEASURED = readJson<Record<string, Record<string, [number, number]>>>(
  './fixtures/routes/measured-node-sizes.json',
)

/** the bundled examples that carry `route: "orthogonal"` edges */
export const ORTHO_EXAMPLES = ['gacha-banner-zones', 'mmo-progression', 'playback-choreography'] as const

// ── replication of src/store/routeMap.ts `rebuild` ──────────────────────────
const handlePos = (h: string | null | undefined, fallback: Position): Position =>
  h === 'in'
    ? Position.Left
    : h === 'out'
      ? Position.Right
      : h === 'state-target'
        ? Position.Top
        : h === 'state-source'
          ? Position.Bottom
          : fallback

const handlePoint = (n: RawNode, w: number, h: number, pos: Position): Pt => {
  const { x, y } = n.position
  switch (pos) {
    case Position.Left:
      return { x, y: y + h / 2 }
    case Position.Right:
      return { x: x + w, y: y + h / 2 }
    case Position.Top:
      return { x: x + w / 2, y }
    default:
      return { x: x + w / 2, y: y + h }
  }
}

const parallelKey = (e: RawEdge): string => {
  const a = `${e.source}:${e.sourceHandle ?? ''}`
  const b = `${e.target}:${e.targetHandle ?? ''}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function inputsFromDoc(prefix: string, doc: RawDoc, sizes: Record<string, [number, number]>): Case[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const sizeOf = (id: string): [number, number] => sizes[id] ?? [DEFAULT_W, DEFAULT_H]
  const boxOf = (n: RawNode): Box => {
    const [w, h] = sizeOf(n.id)
    return { id: n.id, x: n.position.x, y: n.position.y, w, h }
  }
  const ortho = doc.edges
    .filter((e) => e.data?.route === 'orthogonal')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const groups = new Map<string, string[]>()
  for (const e of ortho) {
    const k = parallelKey(e)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(e.id)
  }
  const out: Case[] = []
  for (const e of ortho) {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) continue
    const sPos = handlePos(e.sourceHandle, Position.Right)
    const tPos = handlePos(e.targetHandle, Position.Left)
    const [sw, sh] = sizeOf(s.id)
    const [tw, th] = sizeOf(t.id)
    const set = groups.get(parallelKey(e))!
    out.push({
      name: `${prefix}#${e.id}`,
      input: {
        edgeId: e.id,
        source: handlePoint(s, sw, sh, sPos),
        target: handlePoint(t, tw, th, tPos),
        sourcePosition: sPos,
        targetPosition: tPos,
        obstacles: doc.nodes.filter((n) => n.id !== e.source && n.id !== e.target).map(boxOf),
        waypoints: Array.isArray(e.data?.waypoints) ? e.data.waypoints : [],
        parallelIndex: set.indexOf(e.id),
        parallelCount: set.length,
        selfLoop: e.source === e.target,
      },
    })
  }
  return out
}

/** every orthogonal edge of one bundled example, as the app routes it */
export function exampleCases(graph: (typeof ORTHO_EXAMPLES)[number]): Case[] {
  const doc = readJson<RawDoc>(`../examples/${graph}.json`)
  return inputsFromDoc(graph, doc, MEASURED[graph] ?? {})
}

/** mmo-progression with EVERY edge forced orthogonal — 144 edges over 97 nodes,
 *  the heaviest routing load the app can be put under (differential only). */
export function stressCases(): Case[] {
  const doc = readJson<RawDoc>('../examples/mmo-progression.json')
  for (const e of doc.edges) e.data = { ...(e.data ?? {}), route: 'orthogonal' }
  return inputsFromDoc('STRESS-mmo-all-orthogonal', doc, MEASURED['mmo-progression'] ?? {})
}

// ── boundary corpus ─────────────────────────────────────────────────────────
const base = (over: Partial<RouteInput> = {}): RouteInput => ({
  edgeId: 'e',
  source: { x: 0, y: 0 },
  target: { x: 300, y: 160 },
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  obstacles: [],
  waypoints: [],
  parallelIndex: 0,
  parallelCount: 1,
  selfLoop: false,
  ...over,
})
const box = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h })

export function boundaryCases(): Case[] {
  const cases: Case[] = []
  const add = (name: string, over: Partial<RouteInput>) =>
    cases.push({ name: `boundary/${name}`, input: base(over) })

  // — the special cases (§ER3.6)
  add('same-side/right', { target: { x: 0, y: 120 }, targetPosition: Position.Right })
  add('same-side/left', { sourcePosition: Position.Left, target: { x: 0, y: 120 }, targetPosition: Position.Left })
  add('same-side/top', { sourcePosition: Position.Top, target: { x: 120, y: 0 }, targetPosition: Position.Top })
  add('same-side/bottom', { sourcePosition: Position.Bottom, target: { x: 120, y: 0 }, targetPosition: Position.Bottom })
  add('degenerate/coincident', { target: { x: 0, y: 0 } })
  add('degenerate/within-eps', { target: { x: 0.0004, y: -0.0004 } })
  add('self-loop/right-to-top', { selfLoop: true, source: { x: 130, y: 32 }, target: { x: 65, y: 0 }, targetPosition: Position.Top })
  add('self-loop/bottom-to-left', {
    selfLoop: true,
    source: { x: 65, y: 64 },
    sourcePosition: Position.Bottom,
    target: { x: 0, y: 32 },
    targetPosition: Position.Left,
  })

  // — the fallback-lz escapes
  add('fallback/endpoints-swallowed', { target: { x: 120, y: 0 }, obstacles: [box('wall', -80, -80, 320, 160)] })
  add('fallback/target-walled-in', {
    target: { x: 300, y: 0 },
    obstacles: [box('n', 240, -120, 120, 100), box('s', 240, 40, 120, 100), box('e', 360, -120, 40, 260), box('w', 200, -120, 20, 260)],
  })
  add('fallback/corridor-blocked-both-ends', {
    target: { x: 400, y: 0 },
    obstacles: [box('a', 100, -200, 40, 190), box('b', 100, 10, 40, 190), box('c', 260, -200, 40, 190), box('d', 260, 10, 40, 190)],
  })

  // — the wide-channel ruler threshold: a gap > 2·ROUTE_PAD inserts a midpoint
  const chan = (gap: number) => ({
    target: { x: 420, y: 0 },
    obstacles: [box('l', 160, -150, 60, 300), box('r', 160 + 60 + gap, -150, 60, 300)],
  })
  add('ruler/channel-gap-exactly-2pad', chan(2 * PAD))
  add('ruler/channel-gap-just-under-2pad', chan(2 * PAD - 0.002))
  add('ruler/channel-gap-just-over-2pad', chan(2 * PAD + 0.002))
  add('ruler/channel-gap-wide', chan(2 * PAD + 40))

  // — COORD_EPS rounding, symmetric about zero
  add('eps/half-eps-up', { source: { x: 0.0005, y: 0.0005 }, target: { x: 120.0005, y: 40.0005 } })
  add('eps/half-eps-down', {
    source: { x: -0.0005, y: -0.0005 },
    target: { x: -120.0005, y: -40.0005 },
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  })
  add('eps/long-fraction', {
    source: { x: 0.499997, y: 0.333333 },
    target: { x: 199.99997, y: 83.333333 },
    obstacles: [box('o', 80.12345, 20.6789, 33.5, 41.25)],
  })
  add('negative/all-negative-quadrant', {
    source: { x: -400, y: -300 },
    target: { x: -100, y: -140 },
    obstacles: [box('o', -280, -340, 60, 120)],
  })

  // — obstacle geometry edge cases
  add('obstacle/zero-size', { obstacles: [box('z', 150, 40, 0, 0)] })
  add('obstacle/zero-width-tall', { obstacles: [box('z', 150, -100, 0, 300)] })
  add('obstacle/overlapping-pair', { obstacles: [box('a', 120, 20, 80, 60), box('b', 160, 40, 80, 60)] })
  add('obstacle/identical-duplicates', { obstacles: [box('a', 120, 20, 80, 60), box('b', 120, 20, 80, 60)] })
  add('obstacle/edge-exactly-on-endpoint', { obstacles: [box('a', PAD, -50, 80, 100)] })
  add('obstacle/inflated-edge-touches-endpoint', { obstacles: [box('a', 0, -50, 80, 100), box('b', 200, -50, 40, 100)] })
  add('obstacle/source-inside-inflated', { obstacles: [box('a', -20, -20, 60, 60)] })
  add('obstacle/target-inside-inflated', { obstacles: [box('a', 280, 140, 60, 60)] })
  add('obstacle/dense-3x3-grid', {
    target: { x: 520, y: 320 },
    obstacles: [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => box(`g${i}${j}`, 100 + i * 150, 40 + j * 110, 70, 50))),
  })
  add('obstacle/many-small-lattice', {
    target: { x: 900, y: 500 },
    obstacles: Array.from({ length: 40 }, (_, k) => box(`s${k}`, 60 + (k % 8) * 100, 40 + Math.floor(k / 8) * 95, 46, 38)),
  })

  // — waypoints (§ER4)
  add('waypoint/single-valid', { waypoints: [{ x: 150, y: -80 }] })
  add('waypoint/two-valid', { waypoints: [{ x: 120, y: -80 }, { x: 240, y: 240 }] })
  add('waypoint/collinear-with-endpoints', { target: { x: 300, y: 0 }, waypoints: [{ x: 150, y: 0 }] })
  add('waypoint/invalid-inside-obstacle', { obstacles: [box('o', 120, -40, 80, 100)], waypoints: [{ x: 160, y: 10 }] })
  add('waypoint/on-inflated-boundary', { obstacles: [box('o', 120, -40, 80, 100)], waypoints: [{ x: 120 - PAD, y: 10 }] })
  add('waypoint/backwards-order', { waypoints: [{ x: 260, y: 120 }, { x: 60, y: -60 }] })

  // — the wide-channel rule measured on the RULER LINES, which is where it
  //   actually applies: the rulers are the INFLATED box edges, so two boxes
  //   whose raw gap is G leave a ruler gap of G − 2·ROUTE_PAD. A midpoint line
  //   is inserted only when that ruler gap is strictly greater than 2·ROUTE_PAD.
  //   These three sit on, just under and just over that threshold.
  const rulerChan = (rulerGap: number) => ({
    source: { x: 0, y: 0 },
    target: { x: 84 + rulerGap + 60 + 60, y: 24 },
    obstacles: [
      box('l', 24, -240, 60, 240),
      box('lb', 24, 60, 60, 240),
      box('r', 84 + rulerGap + 24, -240, 60, 240),
      box('rb', 84 + rulerGap + 24, 60, 60, 240),
    ],
  })
  add('ruler/ruler-gap-exactly-2pad', rulerChan(2 * PAD))
  add('ruler/ruler-gap-just-under-2pad', rulerChan(2 * PAD - 0.002))
  add('ruler/ruler-gap-just-over-2pad', rulerChan(2 * PAD + 0.002))
  add('ruler/ruler-gap-double', rulerChan(4 * PAD))

  // — exact ties. On an integer lattice whose spacing is a multiple of
  //   ROUTE_PAD the inflated edges coincide with the lattice, so several routes
  //   share the same length AND the same bend count. Which one is drawn is then
  //   decided ONLY by the A* pick order (f, then g, then x, then y) — these
  //   cases are what makes that order observable.
  const lattice = (n: number, step: number, span: number) => ({
    source: { x: 0, y: 0 },
    target: { x: span, y: span },
    obstacles: Array.from({ length: n * n }, (_, k) =>
      box(`t${k}`, step * (1 + 2 * (k % n)), step * (1 + 2 * Math.floor(k / n)), step, step),
    ),
  })
  add('tie/lattice-3x3-step12', lattice(3, 12, 144))
  add('tie/lattice-3x3-step24', lattice(3, 24, 288))
  add('tie/lattice-4x4-step36', lattice(4, 36, 576))
  add('tie/symmetric-about-diagonal', {
    target: { x: 240, y: 240 },
    obstacles: [box('a', 72, 72, 96, 96), box('b', 0, 240, 48, 48), box('c', 240, 0, 48, 48)],
  })
  add('tie/equal-cost-corridors', {
    target: { x: 360, y: 0 },
    obstacles: [box('u', 120, -156, 120, 120), box('d', 120, 36, 120, 120)],
  })

  // — parallel fans (§ER3.7)
  const fans: readonly (readonly [number, number])[] = [[0, 2], [1, 2], [0, 4], [3, 4], [2, 5]]
  for (const [i, n] of fans)
    add(`parallel/${i}-of-${n}`, { parallelIndex: i, parallelCount: n, obstacles: [box('o', 140, 20, 60, 60)] })

  // — handle-direction combinations
  add('handles/top-to-bottom', { sourcePosition: Position.Top, target: { x: 40, y: -200 }, targetPosition: Position.Bottom })
  add('handles/bottom-to-top', { sourcePosition: Position.Bottom, target: { x: 40, y: 200 }, targetPosition: Position.Top })
  add('handles/right-to-top', { targetPosition: Position.Top })
  add('handles/bottom-to-left', { sourcePosition: Position.Bottom })
  add('handles/target-left-of-source', { target: { x: -300, y: -160 } })

  // — scale
  add('long/far-apart', { target: { x: 4000, y: 2400 }, obstacles: [box('o', 1800, 900, 200, 200)] })

  return cases
}

// ── seeded random corpus (differential only) ────────────────────────────────
/** mulberry32 — small, fast, fully reproducible from the seed */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POSITIONS = [Position.Left, Position.Right, Position.Top, Position.Bottom] as const

/** random layouts that deliberately straddle the router's decision boundaries:
 *  coordinates land on and just off the ruler lines, obstacles overlap and
 *  degenerate, endpoints sometimes sit inside an inflated box, waypoints are
 *  sometimes invalid. */
export function randomCases(seed: number, count: number): Case[] {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const out: Case[] = []
  for (let k = 0; k < count; k++) {
    const nObs = Math.floor(r() * 12)
    const obstacles: Box[] = []
    for (let i = 0; i < nObs; i++) {
      // snap some obstacles onto multiples of ROUTE_PAD, jitter others by ~COORD_EPS
      const snap = r() < 0.4
      const jitter = r() < 0.3 ? (r() - 0.5) * 0.002 : 0
      const x = (snap ? Math.round((r() * 800 - 200) / PAD) * PAD : r() * 800 - 200) + jitter
      const y = (snap ? Math.round((r() * 500 - 150) / PAD) * PAD : r() * 500 - 150) + jitter
      const w = r() < 0.08 ? 0 : 20 + r() * 160
      const h = r() < 0.08 ? 0 : 20 + r() * 110
      obstacles.push({ id: `o${i}`, x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) })
    }
    const source = { x: +(r() * 700 - 150).toFixed(4), y: +(r() * 400 - 120).toFixed(4) }
    const target = { x: +(r() * 700 - 150).toFixed(4), y: +(r() * 400 - 120).toFixed(4) }
    const nWp = r() < 0.55 ? 0 : 1 + Math.floor(r() * 2)
    const waypoints: Pt[] = []
    for (let i = 0; i < nWp; i++)
      waypoints.push({ x: +(r() * 700 - 150).toFixed(4), y: +(r() * 400 - 120).toFixed(4) })
    const parallelCount = 1 + Math.floor(r() * 4)
    out.push({
      name: `random/${seed}/${k}`,
      input: {
        edgeId: `r${k}`,
        source,
        target,
        sourcePosition: pick(POSITIONS),
        targetPosition: pick(POSITIONS),
        obstacles,
        waypoints,
        parallelIndex: Math.floor(r() * parallelCount),
        parallelCount,
        selfLoop: r() < 0.05,
      },
    })
  }
  return out
}

/** Layouts on an exact integer lattice whose spacing is a multiple of
 *  ROUTE_PAD. Everything — obstacle corners, obstacle sizes, endpoints — lands
 *  on the lattice, so the inflated box edges coincide with each other and with
 *  the endpoints. That is what produces the two things fractional coordinates
 *  almost never produce, and what a byte-identity claim has to cover:
 *
 *    • EXACT f/g ties between competing routes, so the A* pick order
 *      (f, then g, then x, then y) decides the drawn path;
 *    • ruler gaps that land EXACTLY on the 2·ROUTE_PAD wide-channel threshold.
 *
 *  (Verified by mutation: swapping the x/y tie-break, or nudging the
 *  wide-channel threshold by 0.01 %, changes routes in this corpus and in no
 *  other — see the differential test's header.) */
export function latticeCases(seed: number, count: number): Case[] {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const STEPS = [12, 24, 36, 48, 60] as const
  const out: Case[] = []
  for (let k = 0; k < count; k++) {
    const step = pick(STEPS)
    const cell = (lo: number, hi: number) => step * (lo + Math.floor(r() * (hi - lo)))
    const nObs = 1 + Math.floor(r() * 9)
    const obstacles: Box[] = []
    for (let i = 0; i < nObs; i++)
      obstacles.push({
        id: `o${i}`,
        x: cell(-3, 12),
        y: cell(-3, 9),
        w: step * (1 + Math.floor(r() * 4)),
        h: step * (1 + Math.floor(r() * 3)),
      })
    const nWp = r() < 0.75 ? 0 : 1 + Math.floor(r() * 2)
    const waypoints: Pt[] = []
    for (let i = 0; i < nWp; i++) waypoints.push({ x: cell(-3, 12), y: cell(-3, 9) })
    const parallelCount = 1 + Math.floor(r() * 3)
    out.push({
      name: `lattice/${seed}/${k}`,
      input: {
        edgeId: `l${k}`,
        source: { x: cell(-3, 12), y: cell(-3, 9) },
        target: { x: cell(-3, 12), y: cell(-3, 9) },
        sourcePosition: pick(POSITIONS),
        targetPosition: pick(POSITIONS),
        obstacles,
        waypoints,
        parallelIndex: Math.floor(r() * parallelCount),
        parallelCount,
        selfLoop: r() < 0.04,
      },
    })
  }
  return out
}

/** every case the golden fixture pins: the real corpus + the boundaries. */
export function goldenCases(): Case[] {
  return [...ORTHO_EXAMPLES.flatMap((g) => exampleCases(g)), ...boundaryCases()]
}
