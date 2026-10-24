import { afterEach, describe, expect, it } from 'vitest'
import pickupDoc from '../../examples/gacha-pickup.json'
import { ARROW_ROOM, CORNER_R, PARALLEL_GAP, type Pt } from '../components/edges/orthogonalRoute'
import type { LoopEdge, LoopNode } from '../model/types'
import { __planFans, __resetRouteCache, __syncFullGeneration, currentRouteMap, routeDiagnostics } from './routeMap'

// docs/edge-routing.md §ER14.3 — a fan member's slot (side, branch length) is
// measured from where its route goes next: its bend point next to that end,
// else its far end. When that puts two or more members level with the port,
// the far ends decide. The case is a bundled Template, as stored: the Pickup
// gacha's SR result → Pulls made (`v_sr_pull`), whose last bend point is on
// the port's line just past the stub, while its far end sent it in from the
// side, so it stepped aside and back and left that bend point off the line.
// Node has no text measurement, so the outside names and labels are not the
// browser's and a coordinate can differ by a few px; the shapes are the same.

type Doc = { nodes: LoopNode[]; edges: LoopEdge[] }
afterEach(() => __resetRouteCache())

const EPS = 1e-6
const onSegment = (a: Pt, b: Pt, p: Pt): boolean =>
  (Math.abs(a.x - b.x) < EPS && Math.abs(p.x - a.x) < EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS) ||
  (Math.abs(a.y - b.y) < EPS && Math.abs(p.y - a.y) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS)
const onLine = (pts: Pt[], p: Pt): boolean => pts.some((_, i) => i > 0 && onSegment(pts[i - 1], pts[i], p))

/** the drawn line's last run: its length, its direction, and how much of it
 *  stays straight once the corner before it is rounded (`pointsToPath`) */
function lastRun(pts: Pt[]) {
  const n = pts.length
  const a = pts[n - 2]
  const b = pts[n - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const prev = n >= 3 ? Math.hypot(a.x - pts[n - 3].x, a.y - pts[n - 3].y) : Infinity
  const rad = Math.min(CORNER_R, len / 2, prev / 2)
  const rounded = !(rad < CORNER_R - 1e-3 && (len < 2 * CORNER_R || prev < 2 * CORNER_R)) && n >= 3
  return { from: a, len, dir: { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }, straight: len - (rounded ? rad : 0) }
}

/** pairs of parallel segments of two lines that run beside each other (more
 *  than 1 px of common extent) closer than `gap`, but not on one line */
function beside(a: Pt[], b: Pt[], gap: number): string[] {
  const out: string[] = []
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [a0, a1, b0, b1] = [a[i - 1], a[i], b[j - 1], b[j]]
      const aH = Math.abs(a0.y - a1.y) < EPS
      const bH = Math.abs(b0.y - b1.y) < EPS
      if (aH !== bH) continue
      const d = aH ? Math.abs(a0.y - b0.y) : Math.abs(a0.x - b0.x)
      const [alo, ahi] = aH ? [Math.min(a0.x, a1.x), Math.max(a0.x, a1.x)] : [Math.min(a0.y, a1.y), Math.max(a0.y, a1.y)]
      const [blo, bhi] = aH ? [Math.min(b0.x, b1.x), Math.max(b0.x, b1.x)] : [Math.min(b0.y, b1.y), Math.max(b0.y, b1.y)]
      const common = Math.min(ahi, bhi) - Math.max(alo, blo)
      if (d > EPS && d < gap - EPS && common > 1) out.push(`${aH ? 'horizontal' : 'vertical'} ${+d.toFixed(3)} px apart for ${+common.toFixed(3)} px`)
    }
  }
  return out
}

describe('arrival on the drawn line — the Pickup gacha Template, bend points as stored', () => {
  it('`v_sr_pull` (last bend point on the port’s line, past the fan’s branch): it runs straight from that point into the port — no step aside', () => {
    const doc = pickupDoc as unknown as Doc
    const routes = __syncFullGeneration(doc.nodes, doc.edges)
    const r = routes.get('v_sr_pull')!
    const pts = r.points
    const run = lastRun(pts)
    const wps = (doc.edges.find((e) => e.id === 'v_sr_pull')!.data as { waypoints: Pt[] }).waypoints
    const detail = JSON.stringify({ points: pts, stubs: r.stubs })
    for (const w of wps) expect.soft(onLine(pts, w), `bend point ${JSON.stringify(w)} on the line: ${detail}`).toBe(true)
    expect.soft(run.dir, detail).toEqual({ x: 0, y: 1 })
    expect.soft(onSegment(run.from, pts[pts.length - 1], r.stubs[2]), `branch point on the last run: ${detail}`).toBe(true)
    expect.soft(run.straight, `straight last run: ${detail}`).toBeGreaterThanOrEqual(ARROW_ROOM)
    // the last bend point is on the port's line: nothing between it and the port
    expect.soft(pts[pts.length - 2], `the last run starts at the bend point: ${detail}`).toEqual(wps[wps.length - 1])
  })

  it('`v_sr_pull` and its fan sibling `v_ssr_pull` (no bend points) do not run beside each other closer than the parallel gap', () => {
    const doc = pickupDoc as unknown as Doc
    const routes = __syncFullGeneration(doc.nodes, doc.edges)
    const a = routes.get('v_sr_pull')!.points
    const b = routes.get('v_ssr_pull')!
    expect.soft(beside(a, b.points, PARALLEL_GAP), JSON.stringify({ v_sr_pull: a, v_ssr_pull: b.points })).toEqual([])
    // the sibling keeps the arrowhead's room too
    expect.soft(lastRun(b.points).straight, JSON.stringify(b.points)).toBeGreaterThanOrEqual(ARROW_ROOM)
  })
})

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const state = (id: string, source: string, target: string, extra: { ports?: { source?: string; target?: string }; waypoints?: Pt[] } = {}): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', label: '+1', route: 'orthogonal', ...extra } }) as unknown as LoopEdge

// m's top port is reached from a (left) and b (right); c sits further left
const fanNodes = [node('m', 400, 400), node('a', 0, 0), node('b', 800, 0), node('c', -300, 0)]
/** m's top port, read from a route into it */
const topPort = (): Pt => {
  const pts = currentRouteMap(fanNodes, [state('probe', 'a', 'm')]).get('probe')!.points
  __resetRouteCache()
  return pts[pts.length - 1]
}

describe('fan slots from the next bend point', () => {
  it('a fan with no bend points: the far ends decide, as before', () => {
    const ends = __planFans(fanNodes, [state('ea', 'a', 'm'), state('eb', 'b', 'm'), state('ec', 'c', 'm')]).ends
    // a and c both on the left: the one reaching further out (c) branches nearer the node
    expect([ends.ea.tgt, ends.eb.tgt, ends.ec.tgt]).toEqual([{ len: 16, side: -1 }, { len: 16, side: 1 }, { len: 8, side: -1 }])
  })

  it('same face, two arrivals: the one whose last bend point is level with the port goes straight in; the other keeps its side', () => {
    const port = topPort()
    const level = state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: port.y - 40 }, { x: port.x, y: port.y - 40 }] })
    const ends = __planFans(fanNodes, [level, state('e2', 'c', 'm')]).ends
    expect([ends.e1.tgt?.side, ends.e2.tgt?.side]).toEqual([0, -1])
    const r = currentRouteMap(fanNodes, [level, state('e2', 'c', 'm')]).get('e1')!.points
    expect(r.slice(-2), JSON.stringify(r)).toEqual([{ x: port.x, y: port.y - 40 }, port])
  })

  it('the line going straight in has its last bend point 20 px out: a sibling branching toward the side that line comes from keeps `PARALLEL_GAP` from that row', () => {
    const port = topPort()
    const row = port.y - 20
    const edges = [state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: row }, { x: port.x, y: row }] }), state('e2', 'c', 'm')]
    const ends = __planFans(fanNodes, edges).ends
    expect([ends.e1.tgt, ends.e2.tgt]).toEqual([{ len: 16, side: 0 }, { len: 20 - PARALLEL_GAP, side: -1 }])
    const routes = currentRouteMap(fanNodes, edges)
    const a = routes.get('e1')!.points
    const b = routes.get('e2')!.points
    expect(beside(a, b, PARALLEL_GAP), JSON.stringify({ e1: a, e2: b })).toEqual([])
    expect(lastRun(b).straight).toBeGreaterThanOrEqual(ARROW_ROOM)
  })

  it('a sibling on the OTHER side keeps its branch', () => {
    const port = topPort()
    const row = port.y - 20
    const edges = [state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: row }, { x: port.x, y: row }] }), state('e2', 'b', 'm')]
    expect(__planFans(fanNodes, edges).ends.e2.tgt).toEqual({ len: 16, side: 1 })
  })

  it('a sibling is never pulled in under the arrowhead’s room (the bend point 17 px out): it keeps its branch', () => {
    const port = topPort()
    const row = port.y - 17
    const edges = [state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: row }, { x: port.x, y: row }] }), state('e2', 'c', 'm')]
    expect(__planFans(fanNodes, edges).ends.e2.tgt).toEqual({ len: 16, side: -1 })
  })

  it('two members level with the port by their bend points (a shared trunk): the far ends decide, as before', () => {
    const port = topPort()
    const trunk = { x: port.x, y: port.y - 40 }
    const edges = [state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: trunk.y }, trunk] }), state('e2', 'b', 'm', { waypoints: [{ x: port.x + 200, y: trunk.y }, trunk] })]
    const ends = __planFans(fanNodes, edges).ends
    expect([ends.e1.tgt, ends.e2.tgt]).toEqual([{ len: 16, side: -1 }, { len: 16, side: 1 }])
  })

  it('the slots and the routes do not depend on the order the connections are stored in', () => {
    const port = topPort()
    const edges = [
      state('e1', 'a', 'm', { waypoints: [{ x: port.x - 200, y: port.y - 40 }, { x: port.x, y: port.y - 40 }] }),
      state('e2', 'c', 'm'),
      state('e3', 'b', 'm'),
    ]
    const plain = __planFans(fanNodes, edges)
    const reversed = __planFans(fanNodes, [...edges].reverse())
    expect(reversed).toEqual(plain)
    const a = currentRouteMap(fanNodes, edges)
    __resetRouteCache()
    const b = currentRouteMap(fanNodes, [...edges].reverse())
    for (const e of edges) expect(b.get(e.id)!.d, e.id).toBe(a.get(e.id)!.d)
  })

  it('a node with an arriving and a leaving state line on one face (share note 54): its state target is still one fan across faces, and no two lines run together', () => {
    const port = topPort()
    const edges = [
      state('in_top', 'a', 'm', { waypoints: [{ x: port.x - 200, y: port.y - 40 }, { x: port.x, y: port.y - 40 }] }),
      state('in_bottom', 'c', 'm', { ports: { target: 'bottom' } }),
      state('out_top', 'm', 'b', { ports: { source: 'top' } }),
    ]
    const p = __planFans(fanNodes, edges)
    // the two arrivals (top, bottom) are one fan; the one departure is alone on its handle
    expect([p.fans.in_top.tgt, p.fans.in_bottom.tgt, p.fans.out_top.src]).toEqual([true, true, false])
    currentRouteMap(fanNodes, edges)
    expect(routeDiagnostics().fanOverlaps).toEqual([])
    expect(__planFans(fanNodes, [...edges].reverse())).toEqual(p)
  })
})
