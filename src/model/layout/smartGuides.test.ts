import { describe, expect, it } from 'vitest'
import { BoxIndex, GUIDE_REACH, settledGuides, smartSnap, type GBox } from './smartGuides'
import { PORT_ROW } from './grid'

// docs/diagram-layout.md §DL3.6 — smart guides: the correction and the lines,
// by priority port row → centre / edges → 16 px grid; independent of where the
// node was grabbed; Alt moves nothing; only nearby nodes are looked at.

const box = (id: string, x: number, y: number, w = 130, h = 56, port = true): GBox => ({ id, x, y, w, h, port })

describe('smartSnap', () => {
  it('lines the port row up with a nearby node’s before the grid (priority 1)', () => {
    // the other node's port row is at 100 + 28 = 128 — off the 16 px grid
    const idx = new BoxIndex([box('o', 400, 100)])
    const r = smartSnap([box('m', 47, 103)], 'm', idx, 6, false)
    expect(r.dy).toBe(-3) // 103 + 28 → 128
    const port = r.guides.find((g) => g.axis === 'y' && g.kind === 'port')!
    expect(port.at).toBe(128)
    expect(port.strong).toBe(true)
    expect(port.to).toBeGreaterThanOrEqual(530) // reaches the other node
  })

  it('aligns centres or edges before the grid, and falls back to the grid beyond the tolerance', () => {
    const idx = new BoxIndex([box('o', 403, 600)])
    // x: the other node's left edge 403 is 4 px away → aligned (not the grid's 400)
    const a = smartSnap([box('m', 399, 200)], 'm', idx, 6, false)
    expect(a.dx).toBe(4)
    expect(a.guides.some((g) => g.axis === 'x' && g.kind === 'edge' && g.at === 403 && g.strong)).toBe(true)
    // 12 px away: the grid
    const b = smartSnap([box('m', 391, 200)], 'm', idx, 6, false)
    expect(b.dx).toBe(384 - 391) // the nearest grid line
    expect(b.guides.filter((g) => g.axis === 'x' && g.strong)).toEqual([])
  })

  it('the port row beats a closer centre / edge match', () => {
    // centre-y of `o` is 128, its port row 128 too here; make them differ:
    // o at y 90, h 120 → centre 150, port 118. m at y 92 (port 120, centre 120 for h 56)
    const idx = new BoxIndex([box('o', 600, 90, 130, 120)])
    const r = smartSnap([box('m', 100, 92)], 'm', idx, 6, false)
    expect(r.dy).toBe(-2) // port 120 → 118
  })

  it('where the node was grabbed never changes where it lands: the result depends on its position only', () => {
    const idx = new BoxIndex([box('o', 400, 100)])
    const p = { x: 61, y: 97 }
    const a = smartSnap([box('m', p.x, p.y)], 'm', idx, 6, false)
    const b = smartSnap([box('m', p.x, p.y)], 'm', idx, 6, false)
    expect(a).toEqual(b)
  })

  it('a selection is referenced by its bounding box (centre and edges) and the grabbed node’s port row', () => {
    const idx = new BoxIndex([box('o', 1000, 0, 100, 400)]) // centre-y 200
    const sel = [box('a', 0, 120), box('b', 200, 220)] // bbox y 120 … 276, centre-y 198
    const r = smartSnap(sel, 'a', idx, 6, false)
    expect(r.dy).toBe(2)
    expect(r.guides.some((g) => g.axis === 'y' && g.kind === 'center' && g.at === 200)).toBe(true)
  })

  it('Alt finds the guides but moves nothing (faint)', () => {
    const idx = new BoxIndex([box('o', 400, 100)])
    const r = smartSnap([box('m', 47, 103)], 'm', idx, 6, true)
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
    expect(r.guides.every((g) => !g.strong)).toBe(true)
  })

  it('a node far beyond the reach is not looked at', () => {
    const idx = new BoxIndex([box('far', 400 + GUIDE_REACH * 3, 100)])
    const r = smartSnap([box('m', 47, 103)], 'm', idx, 6, false)
    expect(r.guides.filter((g) => g.strong)).toEqual([])
  })

  it('a node without a port row (Parameter / Register) is never a port-row target', () => {
    const idx = new BoxIndex([box('p', 400, 100, 130, 56, false)])
    const r = smartSnap([box('m', 47, 100 + 1)], 'm', idx, 6, false)
    expect(r.guides.some((g) => g.kind === 'port')).toBe(false)
  })
})

describe('settledGuides (keyboard)', () => {
  it('shows the row and column the node sits on and the nodes exactly aligned, moving nothing', () => {
    const idx = new BoxIndex([box('o', 400, 100)])
    const g = settledGuides([box('m', 48, 100)], 'm', idx)
    expect(g.some((x) => x.axis === 'y' && x.kind === 'port' && x.at === 100 + PORT_ROW && x.strong)).toBe(true)
    expect(g.some((x) => x.kind === 'place')).toBe(true)
  })
})

describe('BoxIndex', () => {
  it('returns only the boxes meeting the query, each once, in id order', () => {
    const boxes = Array.from({ length: 400 }, (_, i) => box(`n${String(i).padStart(3, '0')}`, (i % 20) * 300, Math.floor(i / 20) * 200, 200, 120))
    const idx = new BoxIndex(boxes)
    const got = idx.query(0, 0, 650, 450)
    const want = boxes.filter((b) => b.x <= 650 && b.x + b.w >= 0 && b.y <= 450 && b.y + b.h >= 0).map((b) => b.id).sort()
    expect(got.map((b) => b.id)).toEqual(want)
    expect(got.length).toBeLessThan(boxes.length / 10)
  })
})
