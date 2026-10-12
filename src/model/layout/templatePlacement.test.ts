import { describe, expect, it } from 'vitest'
import coffee from '../../../examples/coffee-roastery.json'
import deadlock from '../../../examples/deadlock.json'
import equilibrium from '../../../examples/equilibrium.json'
import gacha from '../../../examples/gacha-banner-zones.json'
import mmo from '../../../examples/mmo-progression.json'
import BOXES from './templateBoxes.json'
import { FRAME_GAP, FRAME_MARGIN, gapFor, placeTemplate, placeWithBoxes, readBox, type TemplateName } from './templatePlacement'
import type { LoopEdge, LoopNode } from '../types'

// docs/diagram-layout.md §DL5 (issue #344 step 4) — what every shipped Template
// holds once placed: by each node's widest box over the 18 languages, no two
// nodes closer than the clearance on both axes; every saved frame holds each of
// its nodes with ≥ FRAME_MARGIN and two frames keep ≥ FRAME_GAP; every connection is
// Auto orthogonal (no Manual exception is needed); and placing a shipped file
// again changes nothing it has already settled.

type Doc = { nodes: LoopNode[]; edges: LoopEdge[]; frames?: { id: string; rect: { x: number; y: number; w: number; h: number } }[] }
const SHIPPED: [TemplateName, Doc][] = [
  ['equilibrium', equilibrium as unknown as Doc],
  ['deadlock', deadlock as unknown as Doc],
  ['coffee-roastery', coffee as unknown as Doc],
  ['gacha-banner-zones', gacha as unknown as Doc],
  ['mmo-progression', mmo as unknown as Doc],
]
// the whole box (body ∪ outside name under the node structure), with its origin
// relative to the node position (`readBox`: 2- or 6-number entries)
const size = (tpl: TemplateName, id: string) => readBox((BOXES[tpl] as Record<string, number[]>)[id]!)

describe.each(SHIPPED)('%s as shipped', (tpl, doc) => {
  it('every node has a measured widest box', () => {
    for (const n of doc.nodes) expect((BOXES[tpl] as Record<string, unknown>)[n.id], n.id).toBeDefined()
  })

  it('no two nodes are closer than the clearance on both axes (by their widest boxes)', () => {
    const bad: string[] = []
    for (let i = 0; i < doc.nodes.length; i++)
      for (let j = i + 1; j < doc.nodes.length; j++) {
        const a = doc.nodes[i]!
        const b = doc.nodes[j]!
        const A = size(tpl, a.id)
        const B = size(tpl, b.id)
        const ax = a.position.x + A.dx, ay = a.position.y + A.dy, bx = b.position.x + B.dx, by = b.position.y + B.dy
        const gapX = Math.max(bx - (ax + A.w), ax - (bx + B.w))
        const gapY = Math.max(by - (ay + A.h), ay - (by + B.h))
        // the Template's own clearance (`TEMPLATE_GAPS`): a Template placed by
        // hand under the node structure may declare 0 — then only an overlap of
        // the widest boxes counts
        const gap = gapFor(tpl)
        if (gapX < gap.x && gapY < gap.y) bad.push(`${a.id}~${b.id}`)
      }
    expect(bad).toEqual([])
  })

  it('every connection is Auto orthogonal: no bend points, no other shape', () => {
    for (const e of doc.edges) {
      expect((e.data as { route?: unknown }).route, e.id).toBe('orthogonal')
      expect((e.data as { waypoints?: unknown }).waypoints, e.id).toBeUndefined()
    }
  })

  it('every frame holds each node whose centre is in it with ≥ FRAME_MARGIN; two frames keep ≥ FRAME_GAP between them', () => {
    const frames = doc.frames ?? []
    for (const f of frames) {
      for (const n of doc.nodes) {
        const s = size(tpl, n.id)
        const cx = n.position.x + s.w / 2
        const cy = n.position.y + s.h / 2
        if (cx < f.rect.x || cx > f.rect.x + f.rect.w || cy < f.rect.y || cy > f.rect.y + f.rect.h) continue
        expect(n.position.x - f.rect.x, `${f.id} ${n.id} left`).toBeGreaterThanOrEqual(FRAME_MARGIN)
        expect(n.position.y - f.rect.y, `${f.id} ${n.id} top`).toBeGreaterThanOrEqual(FRAME_MARGIN)
        expect(f.rect.x + f.rect.w - (n.position.x + s.w), `${f.id} ${n.id} right`).toBeGreaterThanOrEqual(FRAME_MARGIN)
        expect(f.rect.y + f.rect.h - (n.position.y + s.h), `${f.id} ${n.id} bottom`).toBeGreaterThanOrEqual(FRAME_MARGIN)
      }
    }
    for (let i = 0; i < frames.length; i++)
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i]!.rect
        const b = frames[j]!.rect
        const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
        expect(gap, `${frames[i]!.id} / ${frames[j]!.id}`).toBeGreaterThanOrEqual(FRAME_GAP)
      }
  })

  it('placing it again keeps every route Auto and every node in its order', () => {
    const again = placeTemplate(tpl, structuredClone(doc))
    for (const e of again.edges) expect((e.data as { route?: unknown }).route).toBe('orthogonal')
    // no left/right or above/below order reversed (ties may stay ties)
    const pos = new Map(again.nodes.map((n) => [n.id, n.position]))
    for (const a of doc.nodes)
      for (const b of doc.nodes) {
        if (a.position.x < b.position.x) expect(pos.get(a.id)!.x <= pos.get(b.id)!.x, `${a.id} left of ${b.id}`).toBe(true)
        if (a.position.y < b.position.y) expect(pos.get(a.id)!.y <= pos.get(b.id)!.y, `${a.id} above ${b.id}`).toBe(true)
      }
  })
})

// Node structure (Lumi, 2026-10-12): a measured box may START before the node
// position — a name above or left of the body — and membership is the BODY's,
// never the whole box's. Checked with boxes given directly (`placeWithBoxes`).
describe('a box with a name above or left of the body', () => {
  const node = (id: string, x: number, y: number): LoopNode => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id } } as unknown as LoopNode)
  // body 88 × 56 at the position; a one-line name 12 below is a 150 × 84 box from (0, 0);
  // a name ABOVE makes the box start 28 above the position; a name LEFT makes it start 162 left
  const BELOW = [150, 84, 0, 0, 88, 56], ABOVE = [150, 84, 0, -28, 88, 56], LEFT = [250, 56, -162, 0, 88, 56]

  it('the frame grows to cover a name ABOVE a member body, and the member set is decided by the body', () => {
    // the frame is authored tight around the BODY of a (24 px margin); a's name hangs above it
    const a = node('a', 240, 164), b = node('b', 480, 164)
    const frame = { id: 'f', rect: { x: 216, y: 140, w: 136, h: 104 } }
    const r = placeWithBoxes('t', { a: ABOVE, b: BELOW }, { x: 0, y: 0 }, { nodes: [a, b], edges: [], frames: [frame] })
    const f = r.frames![0]!.rect
    // a stays a member (its body centre was inside) and the rebuilt frame reaches above its name
    expect(f.y).toBeLessThanOrEqual(164 - 28 - FRAME_MARGIN)
    expect(f.y + f.h).toBeGreaterThanOrEqual(164 + 84 - 28 + FRAME_MARGIN - 16) // snapped outward from the box bottom + margin
    // b's BODY centre (524, 192) is outside the authored frame: not a member, the frame does not reach it
    expect(f.x + f.w).toBeLessThan(480)
  })

  it('a tall name ABOVE does not make a node a member whose body centre is outside the frame', () => {
    // c sits right under the frame: its body centre (284, 332) is below the frame's bottom (300), but the
    // centre of its whole box (body + a 28 px name above) would be at y 318 — still outside, so test the
    // other way round: a frame that holds the NAME's half but not the body's centre keeps c out
    const c = node('c', 240, 304)
    const frame = { id: 'f', rect: { x: 216, y: 200, w: 200, h: 112 } } // bottom 312: covers the name (276–304) and 8 px of the body
    const r = placeWithBoxes('t', { c: ABOVE }, { x: 0, y: 0 }, { nodes: [c], edges: [], frames: [frame] })
    // no member ⇒ the authored rect snapped outward to the grid, nothing grown for c:
    // its box (276 … 360) would have pulled the bottom to ≥ 384 had it counted
    expect(r.frames![0]!.rect).toEqual({ x: 208, y: 192, w: 208, h: 128 })
    expect(r.frames![0]!.rect.y + r.frames![0]!.rect.h).toBeLessThan(304 + 56)
  })

  it('a name LEFT of the body counts for the clearance: bodies 56 px apart are pushed apart when the name would cover the neighbour', () => {
    const e = node('e', 48, 164), d = node('d', 192, 164) // d's body starts 56 px right of e's body end, but d's name starts 162 px left of d
    const r = placeWithBoxes('t', { e: BELOW, d: LEFT }, { x: 0, y: 0 }, { nodes: [e, d], edges: [], frames: [] })
    const dx = r.nodes.find((n) => n.id === 'd')!.position.x
    // d's box (dx − 162 … dx + 88) must clear e's box (48 … 198)
    expect(dx - 162).toBeGreaterThanOrEqual(198)
    expect(r.nodes.find((n) => n.id === 'e')!.position.x).toBe(48)
  })

  it('readBox: a two-number entry is today\x27s body at the position; a six-number entry carries the offset and the body', () => {
    expect(readBox([180, 70])).toEqual({ w: 180, h: 70, dx: 0, dy: 0, bw: 180, bh: 70 })
    expect(readBox([150, 101, 0, -44, 168, 56])).toEqual({ w: 150, h: 101, dx: 0, dy: -44, bw: 168, bh: 56 })
  })
})
