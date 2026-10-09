import { describe, expect, it } from 'vitest'
import { type Box, CONV_MARK, CONV_MARK_AFTER, CONV_MARK_GAP, CONV_MARK_INSET, converterOutline, convMarkSpot, markFits } from './convMark'
import { arriveTauOf } from './nodeCues'
import { BEAT_ARRIVE, BEAT_SETTLE } from '../../store/simStore'

// issue #330 PR 2 — the conversion mark's spot inside a Converter

const dist = (px: number, py: number, [[ax, ay], [bx, by]]: readonly (readonly [number, number])[]) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const overlaps = (x: number, y: number, b: Box) =>
  !(x + CONV_MARK <= b.left - CONV_MARK_GAP || x >= b.right + CONV_MARK_GAP || y + CONV_MARK <= b.top - CONV_MARK_GAP || y >= b.bottom + CONV_MARK_GAP)

// a typical one-line Converter at the compact floor: title on the first line,
// the mode text under it
const W = 118
const H = 56
const title: Box = { left: 26, top: 12, right: 97, bottom: 29 }
const mode: Box = { left: 12, top: 30, right: 52.8, bottom: 45 }
const chip: Box = { left: 12, top: 16.5, right: 20, bottom: 24.5 }

describe('convMarkSpot', () => {
  it('finds a spot inside the outline by the inset and clear of every text box', () => {
    const s = convMarkSpot(W, H, [title, mode, chip], mode)!
    expect(s).not.toBeNull()
    const segs = converterOutline(W, H)
    // an independent check: every point of the square's edge, every 0.25 px
    for (let i = 0; i <= 4 * CONV_MARK; i++) {
      const t = i / 4
      for (const [px, py] of [[s.x + t, s.y], [s.x + t, s.y + CONV_MARK], [s.x, s.y + t], [s.x + CONV_MARK, s.y + t]]) {
        for (const seg of segs) expect(dist(px, py, seg)).toBeGreaterThanOrEqual(CONV_MARK_INSET - 0.13)
      }
    }
    for (const b of [title, mode, chip]) expect(overlaps(s.x, s.y, b)).toBe(false)
  })

  it('is the free spot nearest the end of the mode text', () => {
    const text = [title, mode, chip]
    const s = convMarkSpot(W, H, text, mode)!
    const tx = mode.right + CONV_MARK_AFTER
    const ty = (mode.top + mode.bottom) / 2 - CONV_MARK / 2
    const best = Math.hypot(s.x - tx, s.y - ty)
    const segs = converterOutline(W, H)
    for (let y = 0; y <= H - CONV_MARK; y += 0.5) {
      for (let x = 0; x <= W - CONV_MARK; x += 0.5) {
        if (Math.hypot(x - tx, y - ty) >= best - 1e-9) continue
        expect(text.some((b) => overlaps(x, y, b)) || !markFits(x, y, segs)).toBe(true)
      }
    }
  })

  it('follows the mode text: a longer mode moves the spot along', () => {
    const a = convMarkSpot(160, H, [title, mode, chip], mode)!
    const longer = { ...mode, right: 70 }
    const b = convMarkSpot(160, H, [title, longer, chip], longer)!
    expect(b.x).toBeGreaterThan(a.x)
  })

  it('is the same for the same input (no drift between reads)', () => {
    expect(convMarkSpot(W, H, [title, mode, chip], mode)).toEqual(convMarkSpot(W, H, [title, mode, chip], mode))
  })

  it('returns null when no spot is free', () => {
    const all: Box = { left: 0, top: 0, right: W, bottom: H }
    expect(convMarkSpot(W, H, [all], all)).toBeNull()
  })

  it('never accepts a square that reaches into the outline band', () => {
    // flush against the bottom edge (y = H − 8), well inside horizontally
    expect(markFits(W / 2 - CONV_MARK / 2, H - 8 - CONV_MARK - 2, converterOutline(W, H))).toBe(false)
    // outside the shape entirely
    expect(markFits(-20, -20, converterOutline(W, H))).toBe(false)
  })
})

describe('arriveTauOf', () => {
  it('is the τ a connection reaches its arrive beat, on its own local τ', () => {
    expect(arriveTauOf(0)).toBe(BEAT_ARRIVE)
    const o = 0.3
    // LoopEdge: local τ = (τ − o) / (SETTLE − o)
    expect((arriveTauOf(o) - o) / (BEAT_SETTLE - o)).toBeCloseTo(BEAT_ARRIVE, 12)
    expect(arriveTauOf(o)).toBeLessThan(BEAT_SETTLE)
  })
})
