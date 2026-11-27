import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import mmoDoc from '../../examples/mmo-progression.json'
import desalDoc from '../../examples/desalination.json'
import { __polyHits, __resetRouteCache, bendRejection, chipBoxesOf, currentRouteGeneration, routeDiagnostics, setNodeNameBox, setRouteLabelSize } from './routeMap'

// issue #617 items 1, 3, 4 and 5 — where a label meets a line, where a chip beside
// its line is, what a label round may trade, and where a bend point may be stored

type Pt = { x: number; y: number }
type Box = { id: string; x: number; y: number; w: number; h: number }
const box = (x: number, y: number, w: number, h: number): Box => ({ id: 'b', x, y, w, h })

/** the test the route map used before #617 item 1: each segment's bounding box */
const bboxHits = (pts: Pt[], b: Box): boolean => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const c = pts[i]
    if (Math.max(a.x, c.x) > b.x && Math.min(a.x, c.x) < b.x + b.w && Math.max(a.y, c.y) > b.y && Math.min(a.y, c.y) < b.y + b.h) return true
  }
  return false
}

describe('#617 item 1 — a line meets a box only where the line itself enters it', () => {
  it('a diagonal segment whose bounding box holds the box, clear of the line, does not meet it', () => {
    const diag = [{ x: 0, y: 0 }, { x: 300, y: 200 }]
    const off = box(200, 20, 60, 16) // the line is at y ≈ 133–173 there
    expect(bboxHits(diag, off)).toBe(true) // what was counted
    expect(__polyHits(diag, off)).toBe(false)
  })

  it('a diagonal segment through the box meets it, and one that only touches a corner does not', () => {
    const diag = [{ x: 0, y: 0 }, { x: 300, y: 200 }]
    expect(__polyHits(diag, box(140, 80, 30, 30))).toBe(true)
    // the corner (150, 100) is on the line; the box lies to its lower right
    expect(__polyHits([{ x: 0, y: 0 }, { x: 150, y: 100 }], box(150, 100, 20, 20))).toBe(false)
  })

  it('control: for orthogonal routes the answer is the bounding-box one (every case of a seeded grid)', () => {
    let seed = 617
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return Math.floor((seed / 2147483648) * n)
    }
    let hits = 0
    for (let i = 0; i < 4000; i++) {
      const pts: Pt[] = [{ x: rnd(40) * 5, y: rnd(40) * 5 }]
      for (let k = 0; k < 4; k++) {
        const last = pts[pts.length - 1]
        pts.push(k % 2 === 0 ? { x: rnd(40) * 5, y: last.y } : { x: last.x, y: rnd(40) * 5 })
      }
      const b = box(rnd(40) * 5, rnd(40) * 5, 5 + rnd(10) * 5, 5 + rnd(6) * 5)
      const want = bboxHits(pts, b)
      if (want) hits++
      expect(__polyHits(pts, b)).toBe(want)
    }
    expect(hits).toBeGreaterThan(400) // both answers are exercised
  })
})

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const flow = (id: string, s: string, t: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } }) as unknown as LoopEdge

describe('#617 item 5 — a bend point on a node’s outside name is refused before it is stored', () => {
  const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 200, 200)]
  const edges = [flow('e', 'a', 'b')]
  beforeEach(() => {
    __resetRouteCache()
    // each name below its node, as the outside structure publishes it
    for (const n of nodes) setNodeNameBox(n.id, { dx: -20, dy: 64, w: 96, h: 16 })
  })
  afterEach(() => {
    for (const n of nodes) setNodeNameBox(n.id, null)
  })

  it('on another node’s name', () => {
    expect(bendRejection(nodes, edges, 'e', { x: 228, y: 272 })).toBe('name')
  })

  it('on its own end node’s name, which the router also goes round', () => {
    expect(bendRejection(nodes, edges, 'e', { x: 28, y: 72 })).toBe('name')
  })

  it('controls: clear of every node and name it is accepted; in a body it is still "node"', () => {
    expect(bendRejection(nodes, edges, 'e', { x: 228, y: 120 })).toBeNull()
    expect(bendRejection(nodes, edges, 'e', { x: 228, y: 228 })).toBe('node')
  })

  it('without a published name (the other structure) the same point is accepted', () => {
    setNodeNameBox('c', null)
    expect(bendRejection(nodes, edges, 'e', { x: 228, y: 272 })).toBeNull()
  })
})

describe('#617 item 3 — a chip beside its line is taken where it is drawn', () => {
  beforeEach(() => {
    __resetRouteCache()
  })

  const desal = (w: number, h: number) => {
    const nodes = (desalDoc as unknown as { nodes: LoopNode[] }).nodes
    const edges = (desalDoc as unknown as { edges: LoopEdge[] }).edges
    for (const e of edges) setRouteLabelSize(e.id, w, h, !!(e.data as { unit?: string }).unit)
    const gen = currentRouteGeneration(nodes, edges)
    const drawn = new Map(chipBoxesOf(gen).map((b) => [b.id, b]))
    const crosses = (route: string, chip: string) => __polyHits(gen.map.get(route)!.points, drawn.get(`label:${chip}`)!)
    return { gen, drawn, crosses }
  }

  it('desalination, every chip 90 × 19: a read connection goes round a beside chip as drawn', () => {
    const { gen, crosses } = desal(90, 19)
    // the chip this is about is beside its line (stored by the near edge)
    expect(gen.map.get('e_backwash_thick')?.beside?.side).toBe('up')
    expect(crosses('read:thick', 'e_backwash_thick')).toBe(false)
  })

  it('desalination, every chip 80 × 18: a read connection keeps a detour only when it crosses fewer of every chip', () => {
    // read:filter and read:remin could go round their beside chips only by crossing other chips
    // (e_coag_filter; e_lime_remin and e_naocl2_disinfect): no such detour is kept
    const { drawn, gen } = desal(80, 18)
    const count = (route: string) => [...drawn.values()].filter((b) => __polyHits(gen.map.get(route)!.points, b)).length
    expect(count('read:filter')).toBeLessThanOrEqual(1)
    expect(count('read:remin')).toBeLessThanOrEqual(1)
  })
})

describe('#617 item 4 — a label round keeps a detour only when it crosses fewer of every placed label', () => {
  beforeEach(() => {
    __resetRouteCache()
  })

  it('MMO progression, every chip 72 × 18: no detour kept that crosses as many placed labels as before, or more', () => {
    const nodes = (mmoDoc as unknown as { nodes: LoopNode[] }).nodes
    const edges = (mmoDoc as unknown as { edges: LoopEdge[] }).edges
    for (const e of edges) setRouteLabelSize(e.id, 72, 18)
    currentRouteGeneration(nodes, edges)
    const rounds = routeDiagnostics().runForm.labelRounds ?? []
    const accepted = rounds.filter((r) => r.outcome === 'accepted')
    expect(accepted.length).toBeGreaterThan(0) // the rounds do keep detours here
    expect(accepted.filter((r) => (r.after ?? 0) >= r.before).map((r) => `${r.id}@${r.round} ${r.before}->${r.after}`)).toEqual([])
  })
})
