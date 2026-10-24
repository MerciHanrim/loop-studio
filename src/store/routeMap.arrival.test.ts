import { afterEach, describe, expect, it } from 'vitest'
import generalDoc from '../../examples/gacha-general.json'
import { ARROW_ROOM, CORNER_R, type Pt } from '../components/edges/orthogonalRoute'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __syncFullGeneration } from './routeMap'

// docs/edge-routing.md §ER14.3 / §ER16.3 — how a line ARRIVES, checked on the
// drawn line (`points`, the simplified polyline the path is drawn from), not on
// the router's internal stub (`stubs`). The case is a bundled Template, as
// stored (its bend points are not moved): the General gacha's SR result →
// Pulls made (`e_sr_pull`), whose last bend point is on the target's top stub,
// 4 px above the port. The route used to fold back along the stub; `simplify`
// dropped the fold and 4 px were drawn, less than the arrowhead needs.
// Node has no text measurement, so the outside names and labels are not the
// browser's and a coordinate can differ by a few px; the shape checked here is
// the same.

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

describe('arrival on the drawn line — the General gacha Template, bend points as stored', () => {
  it('`e_sr_pull` (last bend point 4 px above the top port): the drawn last run enters downward, covers the whole stub and leaves the arrowhead its room', () => {
    const doc = generalDoc as unknown as Doc
    const r = __syncFullGeneration(doc.nodes, doc.edges).get('e_sr_pull')!
    const pts = r.points
    const run = lastRun(pts)
    const detail = JSON.stringify({ points: pts, stubs: r.stubs })
    // every stored bend point is still on the drawn line
    const wps = (doc.edges.find((e) => e.id === 'e_sr_pull')!.data as { waypoints: Pt[] }).waypoints
    for (const w of wps) expect.soft(onLine(pts, w), `bend point ${JSON.stringify(w)} on the line: ${detail}`).toBe(true)
    // into the top port: downward
    expect.soft(run.dir, detail).toEqual({ x: 0, y: 1 })
    // no fold hidden by `simplify`: the stub end is on the drawn last run
    expect.soft(onSegment(run.from, pts[pts.length - 1], r.stubs[2]), `stub end on the last run: ${detail}`).toBe(true)
    // the arrowhead sits on a straight run
    expect.soft(run.straight, `straight last run: ${detail}`).toBeGreaterThanOrEqual(ARROW_ROOM)
  })
})
