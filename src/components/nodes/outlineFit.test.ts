import { describe, expect, it } from 'vitest'
import type { NodeKind } from '../../model/types'
import { type Extent, fitOutline, type OutlineGeometry, type OutlineRow } from './outlineFit'
import { NODE_MAX_W, ROW_CLEAR } from './rowFit'
import { fillSpanAt } from './silhouette'

// issue #337 — the head and rows of the five width-parametric kinds.

/** the element's least clearance to the outline at width `w`, sampled like
 *  #332's e2e (top + 1, middle, bottom − 1) */
function clear(kind: NodeKind, w: number, h: number, e: Extent): number {
  let c = Infinity
  for (const y of [e.top + 1, (e.top + e.bottom) / 2, e.bottom - 1]) {
    const s = fillSpanAt(kind, h, y, w)
    if (!s) return -Infinity
    c = Math.min(c, e.left - s[0], s[1] - e.right)
  }
  return c
}

// a node as NodeFrame measures it in the shipped layout (index.css): body
// padding 12 / 12 (Source end 22, Drain start 22, Gate 26 / 26), the 8 px chip
// and its 6 px gap, a 14 px title on 16.1 px lines
type Spec = { kind: NodeKind; titleW: number[]; rows: { key: OutlineRow['key']; w: number }[] }
function geometry({ kind, titleW, rows }: Spec): OutlineGeometry {
  const padStart = kind === 'drain' ? 22 : kind === 'gate' ? 26 : 12
  const padEnd = kind === 'source' ? 22 : kind === 'gate' ? 26 : 12
  const lh = 16.1
  const titleH = lh * titleW.length
  const rowH = rows.map((r) => (r.key === 'value' ? 20.7 : 15))
  const height = Math.max(56, Math.round(titleH + rowH.reduce((a, b) => a + b, 0) + rows.length + 16 + 8))
  const top = (height - (titleH + rowH.reduce((a, b) => a + b, 0) + rows.length)) / 2
  const longest = Math.max(...titleW, ...rows.map((r) => r.w - 14))
  const width = Math.max(kind === 'gate' ? 134 : 118, padStart + 14 + longest + padEnd)
  const centre = width / 2
  // the Gate centres everything; the others start at the body's padding
  const headStart = kind === 'gate' ? centre - (14 + Math.max(...titleW)) / 2 : padStart
  const chip: Extent = { left: headStart, right: headStart + 8, top: top + lh / 2 - 4, bottom: top + lh / 2 + 4 }
  const titleLines = titleW.map((w, i) => ({ left: headStart + 14, right: headStart + 14 + w, top: top + i * lh, bottom: top + (i + 1) * lh }))
  let y = top + titleH + 1
  const out: OutlineRow[] = rows.map((r, i) => {
    const row = { key: r.key, top: y, bottom: y + rowH[i], width: r.w, left: kind === 'gate' ? centre - r.w / 2 : padStart }
    y += rowH[i] + 1
    return row
  })
  return {
    kind, height, width, stackStart: padStart, padEnd, minWidth: kind === 'gate' ? 134 : 118,
    chip, titleLines, titleBoxStart: headStart + 14, titleOneLine: titleW.reduce((a, b) => a + b, 0), titleMax: 135, rows: out,
  }
}

const KINDS = ['pool', 'source', 'drain', 'converter', 'gate'] as const
const TITLES = [[30], [90], [135], [120, 60], [135, 135]]
const ROWS: Record<(typeof KINDS)[number], { key: OutlineRow['key']; w: number }[][]> = {
  pool: [[{ key: 'value', w: 11 }], [{ key: 'value', w: 60 }, { key: 'sub', w: 30 }], [{ key: 'value', w: 160 }]],
  source: [[{ key: 'sub', w: 96 }], [{ key: 'sub', w: 112 }]],
  drain: [[{ key: 'sub', w: 90 }], [{ key: 'sub', w: 105 }]],
  converter: [[{ key: 'sub', w: 40 }]],
  gate: [[{ key: 'sub', w: 70 }], [{ key: 'sub', w: 80 }]],
}

describe('fitOutline', () => {
  it.each(KINDS)('%s: the chip, every title line and every row keep ROW_CLEAR inside the outline', (kind) => {
    for (const titleW of TITLES) for (const rows of ROWS[kind]) {
      const g = geometry({ kind, titleW, rows })
      const f = fitOutline(g)
      const tag = `${kind} title ${titleW} rows ${rows.map((r) => r.w)}`
      expect(f.width, tag).toBeGreaterThanOrEqual(g.minWidth)
      expect(f.width, tag).toBeLessThanOrEqual(NODE_MAX_W)
      // the Gate re-centres everything in its new width
      const move = (e: Extent, dx: number): Extent => ({ ...e, left: e.left + dx, right: e.right + dx })
      const headDx = kind === 'gate' ? (f.width - g.width) / 2 : f.headShift
      for (const e of [g.chip!, ...g.titleLines]) expect(clear(kind, f.width, g.height, move(e, headDx)), tag).toBeGreaterThanOrEqual(ROW_CLEAR - 0.01)
      for (const r of g.rows) {
        const max = f.maxWidth[r.key]
        const w = Math.min(r.width, max ?? Infinity)
        const left = kind === 'gate' ? f.width / 2 - w / 2 : g.stackStart + f.start[r.key]!
        expect(clear(kind, f.width, g.height, { left, right: left + w, top: r.top, bottom: r.bottom }), tag).toBeGreaterThanOrEqual(ROW_CLEAR - 0.01)
        if (kind !== 'gate') expect(left, `${tag}: a row never starts before the title`).toBeGreaterThanOrEqual(g.titleBoxStart + f.headShift - 0.01)
      }
    }
  })

  it('starts a Pool row and a mode row exactly at the title where the outline allows it', () => {
    for (const kind of ['pool', 'source', 'drain', 'converter'] as const) {
      const g = geometry({ kind, titleW: [60], rows: ROWS[kind][0] })
      const f = fitOutline(g)
      for (const r of g.rows) expect(g.stackStart + f.start[r.key]!, kind).toBeCloseTo(g.titleBoxStart + f.headShift, 4)
    }
  })

  it('moves the head in only as far as the outline needs it', () => {
    // a Pool's chip at x 12 sits on its slant (8 px over the top): it moves in
    const pool = fitOutline(geometry({ kind: 'pool', titleW: [60], rows: ROWS.pool[0] }))
    expect(pool.headShift).toBeGreaterThan(0)
    // a Source's left side is a plain rounded edge: the chip at 12 needs 4 px
    const source = fitOutline(geometry({ kind: 'source', titleW: [60], rows: ROWS.source[0] }))
    expect(source.headShift).toBeCloseTo(4, 4)
    // the Gate is centred: no shift, only width
    expect(fitOutline(geometry({ kind: 'gate', titleW: [60], rows: ROWS.gate[0] })).headShift).toBe(0)
  })

  it('is as narrow as its content and the outline allow: one unit narrower breaks a rule or the content', () => {
    for (const kind of KINDS) for (const titleW of TITLES) for (const rows of ROWS[kind]) {
      const g = geometry({ kind, titleW, rows })
      const f = fitOutline(g)
      if (f.width <= g.minWidth || f.width >= NODE_MAX_W) continue
      const w = f.width - 1 / 64
      const headDx = kind === 'gate' ? (w - g.width) / 2 : f.headShift
      const heads = [g.chip!, ...g.titleLines].map((e) => clear(kind, w, g.height, { ...e, left: e.left + headDx, right: e.right + headDx }))
      const rowsC = g.rows.map((r) => {
        const left = kind === 'gate' ? w / 2 - r.width / 2 : g.stackStart + f.start[r.key]!
        return clear(kind, w, g.height, { left, right: left + r.width, top: r.top, bottom: r.bottom })
      })
      const contentEnd = kind === 'gate' ? 0 : Math.max(g.titleBoxStart + f.headShift + Math.min(g.titleOneLine, 135), ...g.rows.map((r) => g.stackStart + f.start[r.key]! + r.width)) + g.padEnd
      const broken = [...heads, ...rowsC].some((c) => c < ROW_CLEAR - 1e-6) || contentEnd > w + 1e-6 || (kind === 'gate' && w < 134)
      expect(broken || kind === 'gate', `${kind} ${titleW} ${rows.map((r) => r.w)} at ${f.width}`).toBe(true)
    }
  })

  it('cuts a row that would need more than the maximum width, and never passes it', () => {
    const g = geometry({ kind: 'pool', titleW: [60], rows: [{ key: 'value', w: 300 }] })
    const f = fitOutline(g)
    expect(f.width).toBe(NODE_MAX_W)
    expect(f.maxWidth.value).toBeLessThan(300)
    expect(f.maxWidth.value).toBeGreaterThan(0)
  })

  it('reads the title at its one-line width, so a node an earlier fit made narrow grows with a longer title', () => {
    const g = geometry({ kind: 'source', titleW: [60, 60], rows: ROWS.source[0] })
    // the same title on one line (120 px, under its 135 px max): the node is as wide as that needs
    const f = fitOutline({ ...g, titleOneLine: 120 })
    expect(f.width).toBeGreaterThanOrEqual(g.titleBoxStart + f.headShift + 120 + g.padEnd - 0.01)
  })
})
