import { describe, expect, it } from 'vitest'
import { GRID, nodeOnGrid, PORT_ROW, snapNodePosition, snapPoint, snapPortY, snapRectOutward, snapX } from './grid'

// issue #344 §DL1 — the grid and the port row

describe('the layout grid', () => {
  it('is 16 px with the port row 28 px below the top', () => {
    expect(GRID).toBe(16)
    expect(PORT_ROW).toBe(28)
  })

  it('snaps a left edge to the nearest grid line, never to -0', () => {
    expect(snapX(7.9)).toBe(0)
    expect(snapX(8)).toBe(16)
    expect(snapX(-7.9)).toBe(0)
    expect(Object.is(snapX(-7.9), -0)).toBe(false)
    expect(snapX(1240)).toBe(1248)
  })

  it('snaps the PORT ROW, so a stored y on the grid is 16k − 28', () => {
    for (const y of [-40, -1, 0, 3.5, 4, 11.9, 12, 100, 1530]) {
      const s = snapPortY(y)
      expect(Math.abs((s + PORT_ROW) % GRID)).toBe(0)
      expect(Math.abs(s - y)).toBeLessThanOrEqual(GRID / 2)
    }
    expect(snapPortY(4)).toBe(4) // 4 + 28 = 32
    expect(snapNodePosition({ x: 41, y: 40 })).toEqual({ x: 48, y: 36 })
  })

  it('tells a node position on the grid from one off it', () => {
    expect(nodeOnGrid({ x: 32, y: 4 })).toBe(true)
    expect(nodeOnGrid({ x: 32, y: 0 })).toBe(false)
    expect(nodeOnGrid({ x: 33, y: 4 })).toBe(false)
  })

  it('snaps a point to the grid and grows a rect outward to it', () => {
    expect(snapPoint({ x: 9, y: 23 })).toEqual({ x: 16, y: 16 })
    expect(snapRectOutward({ x: 5, y: 17, w: 30, h: 30 })).toEqual({ x: 0, y: 16, w: 48, h: 32 })
    expect(snapRectOutward({ x: 16, y: 32, w: 64, h: 48 })).toEqual({ x: 16, y: 32, w: 64, h: 48 })
  })
})
