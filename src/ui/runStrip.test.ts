import { describe, expect, it } from 'vitest'
import { compareStripPlace, runStripPath, stripPlace } from './runStrip'

describe('where a strip stands', () => {
  const frames = [{ rect: { x: 0, y: 0, w: 100, h: 100 } }, { rect: { x: 200, y: 0, w: 100, h: 100 } }]
  const at = (id: string, x: number, y: number) => stripPlace({ id, position: { x, y } }, frames)
  const order = (...places: ReturnType<typeof at>[]) => [...places].sort(compareStripPlace).map((p) => p[3])

  it('follows the frames’ order, not the id', () => {
    expect(order(at('a', 250, 10), at('z', 10, 90))).toEqual(['z', 'a'])
  })

  it('goes top to bottom, then left to right, inside a frame', () => {
    expect(order(at('low', 10, 60), at('right', 60, 10), at('left', 10, 10))).toEqual(['left', 'right', 'low'])
  })

  it('puts a stage in no frame after every frame', () => {
    expect(order(at('out', -50, -50), at('in', 250, 90))).toEqual(['in', 'out'])
  })

  it('reads position alone in a document with no frames, and the id settles a tie', () => {
    const plain = (id: string, x: number, y: number) => stripPlace({ id, position: { x, y } }, [])
    expect([plain('b', 5, 5), plain('a', 5, 5), plain('c', 0, 9)].sort(compareStripPlace).map((p) => p[3])).toEqual(['a', 'b', 'c'])
  })
})

const x = (step: number) => step * 10
const y = (v: number) => 100 - v * 100

describe('a run strip’s path', () => {
  it('is stairs: a step holds its value across the whole step', () => {
    const path = runStripPath([{ step: 1, value: 0.5 }, { step: 2, value: 0.25 }], x, y, 0)
    expect(path).toBe('M0 50.00 H10 V50.00 H20 V75.00')
  })

  it('starts a new stretch after a step with no report, and draws no line across it', () => {
    const path = runStripPath([{ step: 1, value: 1 }, { step: 2, value: null }, { step: 3, value: 1 }], x, y, 0)
    expect(path.match(/M/g)).toHaveLength(2)
  })

  it('keeps a column’s lowest and highest, so one stopped step in a long run shows', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ step: i + 1, value: i === 500 ? 0 : 1 }))
    const path = runStripPath(points, (s) => s / 100, y, 0)
    expect(path).toContain('V100.00')
    expect(path.length).toBeLessThan(600)
  })

  it('leaves out what lies before the view', () => {
    expect(runStripPath([{ step: 1, value: 1 }, { step: 5, value: 0.5 }], x, y, 4)).toBe('M40 50.00 H50 V50.00')
  })

  it('is empty with nothing to draw', () => {
    expect(runStripPath([{ step: 1, value: null }], x, y, 0)).toBe('')
  })
})
