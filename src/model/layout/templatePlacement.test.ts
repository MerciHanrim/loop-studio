import { describe, expect, it } from 'vitest'
import coffee from '../../../examples/coffee-roastery.json'
import deadlock from '../../../examples/deadlock.json'
import equilibrium from '../../../examples/equilibrium.json'
import gacha from '../../../examples/gacha-banner-zones.json'
import mmo from '../../../examples/mmo-progression.json'
import BOXES from './templateBoxes.json'
import { FRAME_MARGIN, TEMPLATE_GAP, placeTemplate, type TemplateName } from './templatePlacement'
import type { LoopEdge, LoopNode } from '../types'

// docs/diagram-layout.md §DL5 (issue #344 step 4) — what every shipped Template
// holds once placed: by each node's widest box over the 18 languages, no two
// nodes closer than the clearance on both axes; every saved frame holds each of
// its nodes with ≥ FRAME_MARGIN and no two frames overlap; every connection is
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
const size = (tpl: TemplateName, id: string) => {
  const b = (BOXES[tpl] as Record<string, number[]>)[id]!
  return { w: b[0]!, h: b[1]! }
}

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
        const gapX = Math.max(b.position.x - (a.position.x + A.w), a.position.x - (b.position.x + B.w))
        const gapY = Math.max(b.position.y - (a.position.y + A.h), a.position.y - (b.position.y + B.h))
        if (gapX < TEMPLATE_GAP.x && gapY < TEMPLATE_GAP.y) bad.push(`${a.id}~${b.id}`)
      }
    expect(bad).toEqual([])
  })

  it('every connection is Auto orthogonal: no bend points, no other shape', () => {
    for (const e of doc.edges) {
      expect((e.data as { route?: unknown }).route, e.id).toBe('orthogonal')
      expect((e.data as { waypoints?: unknown }).waypoints, e.id).toBeUndefined()
    }
  })

  it('every frame holds each node whose centre is in it with ≥ FRAME_MARGIN; no two frames overlap', () => {
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
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${frames[i]!.id} / ${frames[j]!.id}`).toBe(false)
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
