import { describe, expect, it } from 'vitest'
import { badgeClearOfEnds, planBadgePlaces, type PlanEdge, type PlanMark } from './badgePlan'
import { badgeBoxAt, overlaps, type Box } from './playbackBadge'

const W = 24
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 })
const line = (x0: number, y0: number, x1: number, y1: number, n = 200) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }))

const SRC = box(0, 0, 100, 64)
const edge = (id: string, pts: { x: number; y: number }[], target: Box, fan = 'src|right'): PlanEdge => ({ id, fan, pts, from: 'src', to: id + '-t', source: SRC, target })

describe('badgeClearOfEnds — the whole box outside BOTH end bodies', () => {
  it('is false while the box meets either body, true once clear, and touching is clear', () => {
    const tgt = box(300, 0, 400, 64)
    expect(badgeClearOfEnds(box(90, 10, 110, 23), SRC, tgt)).toBe(false)
    expect(badgeClearOfEnds(box(290, 10, 310, 23), SRC, tgt)).toBe(false)
    expect(badgeClearOfEnds(box(150, 10, 174, 23), SRC, tgt)).toBe(true)
    expect(badgeClearOfEnds(box(100, 10, 124, 23), SRC, tgt)).toBe(true)
  })
})

describe('planBadgePlaces', () => {
  it('a lone connection with nothing around keeps today’s place, up-right', () => {
    const plan = planBadgePlaces([edge('e', line(100, 32, 300, 32), box(300, 0, 400, 64))], [], W)
    expect(plan.get('e')).toBe('up-right')
  })

  it('two connections leaving one port side by side get places whose badges never meet', () => {
    // a fan: both leave (100, 32) and run 6 px apart to the right, then part
    const a = [...line(100, 32, 260, 29), ...line(260, 29, 400, -120)]
    const b = [...line(100, 32, 260, 35), ...line(260, 35, 400, 180)]
    const edges = [edge('a', a, box(400, -150, 500, -86)), edge('b', b, box(400, 150, 500, 214))]
    const plan = planBadgePlaces(edges, [], W)
    expect(plan.get('a')).not.toBe(plan.get('b'))
    // at every common fraction, the two shown badges are apart
    for (let k = 0; k <= 100; k++) {
      const boxes = edges.map((e) => {
        const p = e.pts[Math.round((k / 100) * (e.pts.length - 1))]!
        const bx = badgeBoxAt(p.x, p.y, W, plan.get(e.id)!)
        return badgeClearOfEnds(bx, e.source, e.target) ? bx : null
      })
      if (boxes[0] && boxes[1]) expect(overlaps(boxes[0], boxes[1])).toBe(false)
    }
  })

  it('a place that would cover another node’s name is avoided', () => {
    const name: PlanMark = { ...box(160, 0, 240, 16), node: 'other', kind: 'name' }
    const plan = planBadgePlaces([edge('e', line(100, 32, 300, 32), box(300, 0, 400, 64))], [name], W)
    expect(plan.get('e')!.startsWith('down')).toBe(true)
  })

  it('is deterministic and fixed by the layout alone', () => {
    const a = [...line(100, 32, 260, 29), ...line(260, 29, 400, -120)]
    const b = [...line(100, 32, 260, 35), ...line(260, 35, 400, 180)]
    const mk = () => [edge('b', b, box(400, 150, 500, 214)), edge('a', a, box(400, -150, 500, -86))]
    expect([...planBadgePlaces(mk(), [], W)].sort()).toEqual([...planBadgePlaces(mk().reverse(), [], W)].sort())
  })
})
