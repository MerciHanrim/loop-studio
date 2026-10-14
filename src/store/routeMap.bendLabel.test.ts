import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __syncFullGeneration, setRouteLabelSize } from './routeMap'

// docs/edge-routing.md §ER14.3 — a routed label keeps off its own connection's
// STORED bend points (where its bend markers sit while it is selected), in the
// first two placement passes; the last-resort passes do not, so a line with
// no free slot still has its label. Placement never depends on the selection.

type Pt = { x: number; y: number }
const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const edge = (id: string, source: string, target: string, data: Record<string, unknown> = {}, top: Record<string, unknown> = {}): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', ...data }, ...top }) as unknown as LoopEdge

const LS = { w: 24, h: 18 }
const labelBox = (c: Pt) => ({ x: c.x - LS.w / 2, y: c.y - LS.h / 2, w: LS.w, h: LS.h })
/** the bend marker as drawn (`.route-bend`, 12 × 12 flow px) — not the rule's own constant, so a test of the rule cannot pass by sharing its number */
const MARKER = 12
const bendBox = (w: Pt) => ({ x: w.x - MARKER / 2, y: w.y - MARKER / 2, w: MARKER, h: MARKER })
const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
/** the distance from `p` to the polyline */
function distToLine(points: Pt[], p: Pt): number {
  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

/** two Pools set apart diagonally, so the automatic route is a Z whose middle
 *  (the first label slot) is on its vertical stretch */
const nodes = () => [node('s', 0, 0), node('t', 480, 320)]

beforeEach(() => {
  __resetRouteCache()
  setRouteLabelSize('e', LS.w, LS.h)
})

describe('a label keeps off its own stored bend points (§ER14.3)', () => {
  it('a bend placed on the slot the label took moves the label to another slot of its own line', () => {
    const auto = __syncFullGeneration(nodes(), [edge('e', 's', 't')]).get('e')!
    expect(auto.label).not.toBeNull()
    const bend = { x: Math.round(auto.label!.x), y: Math.round(auto.label!.y) }
    __resetRouteCache(); setRouteLabelSize('e', LS.w, LS.h)
    const bent = __syncFullGeneration(nodes(), [edge('e', 's', 't', { waypoints: [bend] })]).get('e')!
    // the route still passes the bend (so the marker is on the line), and the label is off it
    expect(distToLine(bent.points, bend)).toBeLessThan(1)
    expect(bent.label).not.toBeNull()
    expect(hit(labelBox(bent.label!), bendBox(bend)), 'label over its own bend').toBe(false)
    expect(distToLine(bent.points, bent.label!), 'still on its own line').toBeLessThan(1)
  })

  it('a connection without bends keeps its label place', () => {
    const a = __syncFullGeneration(nodes(), [edge('e', 's', 't')]).get('e')!
    __resetRouteCache(); setRouteLabelSize('e', LS.w, LS.h)
    const b = __syncFullGeneration(nodes(), [edge('e', 's', 't', { waypoints: [] })]).get('e')!
    expect(b.label).toEqual(a.label)
  })

  it('selection does not move a label: the same place selected or not', () => {
    const auto = __syncFullGeneration(nodes(), [edge('e', 's', 't')]).get('e')!
    const bend = { x: Math.round(auto.label!.x), y: Math.round(auto.label!.y) }
    __resetRouteCache(); setRouteLabelSize('e', LS.w, LS.h)
    const off = __syncFullGeneration(nodes(), [edge('e', 's', 't', { waypoints: [bend] })]).get('e')!
    __resetRouteCache(); setRouteLabelSize('e', LS.w, LS.h)
    const on = __syncFullGeneration(nodes(), [edge('e', 's', 't', { waypoints: [bend] }, { selected: true })]).get('e')!
    expect(on.label).toEqual(off.label)
  })

  it('a line too short for any slot clear of its bends still gets its label (the last resort keeps it)', () => {
    // two Pools nearly touching, a bend on the short stretch between them
    const near = [node('s', 0, 0), node('t', 150, 0)]
    const auto = __syncFullGeneration(near, [edge('e', 's', 't')]).get('e')!
    const bends = auto.points.slice(1, -1).length ? auto.points.slice(1, -1) : [auto.mid]
    __resetRouteCache(); setRouteLabelSize('e', LS.w, LS.h)
    setRouteLabelSize('e', 120, 18) // wider than the line: no slot is clear of the bends
    const r = __syncFullGeneration(near, [edge('e', 's', 't', { waypoints: bends.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) })]).get('e')!
    expect(r.label, 'a label is always placed').not.toBeNull()
  })
})
