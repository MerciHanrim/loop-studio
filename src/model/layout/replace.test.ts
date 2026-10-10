import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../types'
import { nodeOnGrid, PORT_ROW } from './grid'
import { replaceOnGrid, type FrameLike } from './replace'

// issue #344 §DL2 — re-placing a graph on the grid: deterministic, idempotent,
// order-keeping, never creating an overlap or a frame cut

const N = (id: string, x: number, y: number): LoopNode => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id } }) as unknown as LoopNode
const E = (id: string, source: string, target: string, data: Record<string, unknown> = {}): LoopEdge =>
  ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', ...data } }) as unknown as LoopEdge
const size = () => ({ w: 120, h: 58 })
const apply = (nodes: LoopNode[], r: ReturnType<typeof replaceOnGrid>): LoopNode[] => nodes.map((n) => ({ ...n, position: r.positions[n.id] }))
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x < b.x + 120 && b.x < a.x + 120 && a.y < b.y + 58 && b.y < a.y + 58

describe('replaceOnGrid', () => {
  const nodes = [N('a', 3, 7), N('b', 205, 11), N('c', 410, 260.4), N('d', 7, 140), N('e', 129, 145)]
  const edges = [E('e1', 'a', 'b'), E('e2', 'b', 'c'), E('e3', 'd', 'e')]

  it('puts every node on the grid (left edge and port row)', () => {
    const r = replaceOnGrid(nodes, edges, [], size)
    for (const p of Object.values(r.positions)) expect(nodeOnGrid(p)).toBe(true)
  })

  it('is deterministic: the same input gives byte-identical output, in any input order', () => {
    const a = JSON.stringify(replaceOnGrid(nodes, edges, [], size))
    const b = JSON.stringify(replaceOnGrid([...nodes].reverse(), [...edges].reverse(), [], size))
    expect(b).toBe(a)
  })

  it('is idempotent: re-placing the result moves nothing', () => {
    const once = apply(nodes, replaceOnGrid(nodes, edges, [], size))
    const twice = replaceOnGrid(once, edges, [], size)
    for (const n of once) expect(twice.positions[n.id]).toEqual(n.position)
  })

  it('merges the rows of two connected nodes less than 16 px apart', () => {
    // port rows 28 → 32 and 41 → 48: 13 px apart, connected ⇒ one row
    const r = replaceOnGrid([N('p', 0, 0), N('q', 200, 13)], [E('x', 'p', 'q')], [], size)
    expect(r.positions.q.y + PORT_ROW).toBe(r.positions.p.y + PORT_ROW)
  })

  it('keeps two UNRELATED neighbours 8–16 px apart on different rows', () => {
    // port rows 28 and 37 both round to 32; unrelated and 30 px apart ⇒ the
    // lower one takes the next row
    const r = replaceOnGrid([N('p', 0, 0), N('q', 150, 9)], [], [], size)
    expect(r.positions.q.y - r.positions.p.y).toBe(16)
  })

  it('leaves those two on one row when a flow connects them', () => {
    const r = replaceOnGrid([N('p', 0, 0), N('q', 150, 9)], [E('x', 'p', 'q')], [], size)
    expect(r.positions.q.y).toBe(r.positions.p.y)
  })

  it('never creates an overlap, and keeps the left / right order', () => {
    const tight = [N('a', 0, 0), N('b', 124, 0), N('c', 246, 2)]
    const r = replaceOnGrid(tight, [], [], size)
    const ps = tight.map((n) => r.positions[n.id])
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(overlap(ps[i], ps[j])).toBe(false)
    expect(ps[0].x).toBeLessThan(ps[1].x)
    expect(ps[1].x).toBeLessThan(ps[2].x)
  })

  it('grows a frame outward to the grid and keeps every node it held inside', () => {
    const f: FrameLike = { id: 'f', rect: { x: -9, y: -21, w: 330, h: 100 } }
    const r = replaceOnGrid([N('a', 3, 7), N('b', 195, 11)], [], [f], size)
    const fr = r.frames.f
    expect(Math.abs(fr.x % 16)).toBe(0)
    expect(Math.abs(fr.y % 16)).toBe(0)
    for (const id of ['a', 'b']) {
      const p = r.positions[id]
      expect(p.x >= fr.x && p.y >= fr.y && p.x + 120 <= fr.x + fr.w && p.y + 58 <= fr.y + fr.h).toBe(true)
    }
  })

  it('holds only the nodes fully inside by default: one reaching past the edge is not taken in', () => {
    // `b` (120 wide) ends 30 px past the frame's right edge
    const f: FrameLike = { id: 'f', rect: { x: 0, y: 0, w: 290, h: 90 } }
    const r = replaceOnGrid([N('a', 16, 16), N('b', 200, 16)], [], [f], size)
    expect(r.frames.f.x + r.frames.f.w).toBeLessThan(r.positions.b.x + 120)
  })

  it("a caller's held set decides the members: the frame grows to hold each of them whole, and only them", () => {
    // the migration's case: `b` was inside as drawn when saved, its box is wider now
    const f: FrameLike = { id: 'f', rect: { x: 0, y: 0, w: 290, h: 90 } }
    const r = replaceOnGrid([N('a', 16, 16), N('b', 200, 16), N('c', 16, 200)], [], [f], size, { held: { f: ['a', 'b'] } })
    const fr = r.frames.f
    for (const id of ['a', 'b']) {
      const p = r.positions[id]
      expect(p.x >= fr.x && p.y >= fr.y && p.x + 120 <= fr.x + fr.w && p.y + 58 <= fr.y + fr.h, id).toBe(true)
    }
    expect(r.positions.c.y).toBeGreaterThanOrEqual(fr.y + fr.h)
  })

  it('snaps waypoints and drops one that lands inside a node', () => {
    const e = E('w', 'a', 'b', { route: 'orthogonal', waypoints: [{ x: 101, y: 203 }, { x: 260, y: 30 }] })
    const r = replaceOnGrid([N('a', 0, 0), N('b', 220, 0)], [e], [], size)
    expect(r.waypoints.w).toEqual([{ x: 96, y: 208 }])
  })
})
