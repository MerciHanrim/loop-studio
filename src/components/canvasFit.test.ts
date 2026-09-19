import { describe, expect, it } from 'vitest'
import { viewportForRect as viewportForRectOrNull } from './canvasFit'

const viewportForRect = (...args: Parameters<typeof viewportForRectOrNull>) => viewportForRectOrNull(...args)!

// docs/data-import.md §DI17 / docs/mmo-multilingual-layout.md §MML3 — one pure
// "fit this rect into the usable pane" computation, shared by the Canvas's
// Template initial view and the import wizard's post-commit view. The Canvas
// path must stay byte-identical to the inline code it replaces.

const PANE = { width: 1280, height: 720 }
const NO_MM = { left: 44, right: 0, bottom: 0, top: 0 }
const MM = { left: 44, right: 224, bottom: 176, top: 0 }

describe('viewportForRect', () => {
  it('a small rect fits at the ceiling zoom, left-aligned next to the Controls, vertically centred', () => {
    const v = viewportForRect({ x: 100, y: 50, width: 300, height: 100 }, PANE, NO_MM, { floor: 0.5, ceil: 1.2 })
    expect(v.zoom).toBe(1.2)
    expect(v.x).toBeCloseTo(44 + 8 - 100 * 1.2)
    // usableH = 720 -> centre at 360 -> minus rect centre (100) * zoom
    expect(v.y).toBeCloseTo(720 / 2 - (50 + 50) * 1.2)
  })

  it('reproduces the Canvas initial-view formula with the minimap insets (Template fit)', () => {
    const rect = { x: 0, y: 0, width: 2000, height: 900 }
    const v = viewportForRect(rect, PANE, MM, { floor: 0.35, ceil: 1.2 })
    const usableW = 1280 - 44 - 224
    const usableH = 720 - 176
    const rectW = Math.min(rect.width, (usableW - 8) / 0.35)
    const zoom = Math.min(1.2, Math.max(0.35, Math.min(usableW / (rectW * 1.06), usableH / (rect.height * 1.06))))
    expect(v.zoom).toBeCloseTo(zoom)
    expect(v.x).toBeCloseTo(44 + 8 - rect.x * zoom)
    const contentH = rect.height * zoom
    expect(v.y).toBeCloseTo(contentH <= usableH ? usableH / 2 - rect.height / 2 * zoom : 12 - rect.y * zoom)
  })

  it('a rect too large for the floor zoom is NOT shrunk further: zoom stays at the floor and the top-left corner is anchored', () => {
    const rect = { x: 500, y: 300, width: 40_000, height: 30_000 }
    const v = viewportForRect(rect, PANE, NO_MM, { floor: 0.5, ceil: 1 })
    expect(v.zoom).toBe(0.5)
    expect(v.x).toBeCloseTo(44 + 8 - 500 * 0.5)
    expect(v.y).toBeCloseTo(0 + 12 - 300 * 0.5)
  })

  it('a top inset (the canvas hint slot) shifts both the centring band and the top anchor down', () => {
    const small = viewportForRect({ x: 0, y: 0, width: 300, height: 100 }, PANE, { ...NO_MM, top: 56 }, { floor: 0.5, ceil: 1 })
    expect(small.y).toBeCloseTo(56 + (720 - 56) / 2 - 50 * 1)
    const tall = viewportForRect({ x: 0, y: 0, width: 300, height: 5000 }, PANE, { ...NO_MM, top: 56 }, { floor: 0.5, ceil: 1 })
    expect(tall.zoom).toBe(0.5)
    expect(tall.y).toBeCloseTo(56 + 12)
  })

  it('never exceeds the ceiling and never goes under the floor', () => {
    const tiny = viewportForRect({ x: 0, y: 0, width: 10, height: 10 }, PANE, NO_MM, { floor: 0.5, ceil: 1 })
    expect(tiny.zoom).toBe(1)
    const huge = viewportForRect({ x: 0, y: 0, width: 1e6, height: 1e6 }, PANE, NO_MM, { floor: 0.5, ceil: 1 })
    expect(huge.zoom).toBe(0.5)
  })

  it('a degenerate pane returns null so the caller can fall back to fitView', () => {
    expect(viewportForRectOrNull({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, NO_MM, { floor: 0.5, ceil: 1 })).toBeNull()
  })
})
