import { describe, expect, it } from 'vitest'
import { nodeDirs, nodeOnLayer, placeNode, placeZone, zoneOnLayer, type Box, type Obstacles } from './textPlacement'

const pane: Box = { x: 0, y: 0, w: 800, h: 600 }
const obs = (o: Partial<Obstacles> = {}): Obstacles => ({ pane, nodes: [], pts: [], placed: [], ...o })

describe('when a label goes on the layer (`t8`)', () => {
  it('a zone name while its 11 px chip is under 8 px on screen and at least half the zone is in view', () => {
    const zone: Box = { x: 100, y: 100, w: 200, h: 100 }
    expect(zoneOnLayer(0.72, zone, pane)).toBe(true) // 7.92 px
    expect(zoneOnLayer(8 / 11, zone, pane)).toBe(false) // 8 px
    expect(zoneOnLayer(0.5, { x: -150, y: 100, w: 200, h: 100 }, pane)).toBe(false) // a quarter in view
    expect(zoneOnLayer(0.5, { x: -100, y: 100, w: 200, h: 100 }, pane)).toBe(true) // half in view
  })
  it('the selected name while its 13 px text is under 8 px', () => {
    expect(nodeOnLayer(0.6)).toBe(true)
    expect(nodeOnLayer(8 / 13)).toBe(false)
  })
})

describe('a zone name: kept on the top border (`ztop` + `zstick` + `zprio`)', () => {
  const zone: Box = { x: 100, y: 100, w: 300, h: 200 }
  it('stands on the top border at the left when nothing is there', () => {
    const p = placeZone(zone, 80, 18, null, obs(), false)
    expect(p.slot).toEqual({ row: 0, frac: 0 })
    expect(p.at).toEqual({ x: 100, y: 82, w: 80, h: 18 })
    expect(p.fallback).toBe(false)
  })
  it('moves along the border past a node, then hangs inside it when the border is full', () => {
    const p = placeZone(zone, 80, 18, null, obs({ nodes: [{ x: 90, y: 80, w: 60, h: 30 }] }), false)
    expect(p.slot.row).toBe(0)
    expect(p.at.x).toBeGreaterThanOrEqual(150)
    const full = placeZone(zone, 80, 18, null, obs({ nodes: [{ x: 0, y: 70, w: 800, h: 25 }] }), false)
    expect(full.slot).toEqual({ row: 1, frac: 0 })
  })
  it('a kept place stays when a line passes through it, and when a node passes under it during a drag', () => {
    const kept = { row: 0 as const, frac: 0 }
    expect(placeZone(zone, 80, 18, kept, obs({ pts: [120, 90] }), false).slot).toBe(kept)
    const node = { nodes: [{ x: 110, y: 85, w: 20, h: 20 }] }
    const during = placeZone(zone, 80, 18, kept, obs(node), true)
    expect(during.slot).toBe(kept)
    expect(during.rechosen).toBe('')
    // after the drop the same cover is a reason, once
    const after = placeZone(zone, 80, 18, kept, obs(node), false)
    expect(after.rechosen).toBe('node')
    expect(after.slot).not.toEqual(kept)
  })
  it('is chosen again when it no longer fits the zone, even during a drag', () => {
    const p = placeZone({ ...zone, w: 100 }, 80, 18, { row: 0, frac: 0.5 }, obs(), true)
    expect(p.rechosen).toBe('fit')
    expect(p.at.x + p.at.w).toBeLessThanOrEqual(200.5)
  })
  it('with no free place, takes the one crossing the fewest line points and covering no node', () => {
    const pts: number[] = []
    for (let x = 100; x <= 400; x += 2) pts.push(x, 90, x, 110)
    pts.push(390, 91) // one more point at the right end
    const p = placeZone(zone, 80, 18, null, obs({ pts }), false)
    expect(p.fallback).toBe(true)
    expect(p.at.x).toBe(100)
  })
})

describe('the selected name: one, on a kept side (`nbg` + `zprio` + edge option ii)', () => {
  const body: Box = { x: 300, y: 200, w: 60, h: 40 }
  const own: Box = { x: 305, y: 205, w: 50, h: 30 }
  const ring: Box = { x: 302, y: 202, w: 56, h: 36 }
  const nodes = [own]
  it('goes below its node, 8 px out, when that is free', () => {
    const p = placeNode('a', body, own, ring, 40, 18, null, obs({ nodes }), false)
    expect(p.slot).toEqual({ id: 'a', k: 0, g: 8 })
    expect(p.at).toEqual(nodeDirs(body, 40, 18, 8)[0])
    expect(p.hidden).toBe('')
  })
  it('a kept side that covers another node: hidden during a drag (side kept), chosen again after it', () => {
    const below = nodeDirs(body, 40, 18, 8)[0]
    const other = { x: below.x, y: below.y, w: 10, h: 10 }
    const kept = { id: 'a', k: 0, g: 8 }
    const during = placeNode('a', body, own, ring, 40, 18, kept, obs({ nodes: [own, other] }), true)
    expect(during.hidden).toBe('cover-node')
    expect(during.slot).toEqual(kept)
    const after = placeNode('a', body, own, ring, 40, 18, kept, obs({ nodes: [own, other] }), false)
    expect(after.rechosen).toBe('node')
    expect(after.hidden).toBe('')
    expect(after.slot.k).not.toBe(0)
  })
  it('its node off screen: hidden, and back on the same side', () => {
    const kept = { id: 'a', k: 2, g: 8 }
    const offOwn = { ...own, x: 900 }
    const off = placeNode('a', { ...body, x: 895 }, offOwn, ring, 40, 18, kept, obs({ nodes: [offOwn] }), false)
    expect(off.hidden).toBe('offscreen')
    expect(off.slot).toEqual(kept)
    const back = placeNode('a', body, own, ring, 40, 18, off.slot, obs({ nodes }), false)
    expect(back.slot).toEqual(kept)
    expect(back.hidden).toBe('')
  })
  it('at the canvas edge: slid inward on the same side when that covers nothing, else hidden — never cut, never another side', () => {
    const edgeBody: Box = { x: 740, y: 200, w: 50, h: 40 }
    const edgeOwn: Box = { x: 745, y: 205, w: 40, h: 30 }
    const edgeRing: Box = { x: 742, y: 202, w: 46, h: 36 }
    const kept = { id: 'a', k: 0, g: 8 } // below: centred on the node, its right end past the pane
    const p = placeNode('a', edgeBody, edgeOwn, edgeRing, 120, 18, kept, obs({ nodes: [edgeOwn] }), false)
    expect(p.hidden).toBe('')
    expect(p.shifted).toBe(true)
    expect(p.slot).toEqual(kept)
    expect(p.at.x + p.at.w).toBeLessThanOrEqual(800)
    // a node where the slide would land (x 680…800), clear of the kept side itself (x 705…825):
    // hidden, the side kept
    const blocker = { x: 682, y: 250, w: 18, h: 10 }
    const q = placeNode('a', edgeBody, edgeOwn, edgeRing, 120, 18, kept, obs({ nodes: [edgeOwn, blocker] }), false)
    expect(q.hidden).toBe('edge')
    expect(q.slot).toEqual(kept)
  })
  it('a new side is never on the selection ring or on a label placed before it', () => {
    const below = nodeDirs(body, 40, 18, 8)[0]
    const p = placeNode('a', body, own, { ...ring, h: ring.h + 40 }, 40, 18, null, obs({ nodes, placed: [] }), false)
    expect(p.at).not.toEqual(below)
    const q = placeNode('a', body, own, ring, 40, 18, null, obs({ nodes, placed: [below] }), false)
    expect(q.at).not.toEqual(below)
  })
})
