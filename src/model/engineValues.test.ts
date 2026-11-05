import { describe, expect, it } from 'vitest'
import { initSim, step } from '../engine/step'
import { applyUnits } from './engineValues'
import { deserialize } from './serialize'

// SEMANTICS-M4.md §M4-2.1 — a rate reaches the engine as the double nearest its
// exact value. The derived graph carries it as a flow string, and `parseFlow`
// reads plain digits only: any other text runs as 1, with no message. `String`
// writes exponent text below 1e-6 and from 1e21, so those rates ran as 1 per step.

const doc = (lines: { source: string; target: string; flow: string; unit?: string }[], stepValue: number, stepUnit: string) =>
  deserialize(
    JSON.stringify({
      schema: 'loop-studio/graph/4',
      version: 1,
      nodes: [
        { id: 'sea', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Sea', activation: 'automatic' } },
        { id: 'tank', type: 'pool', position: { x: 1, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 1000, capacity: null, resourceType: 'water', activation: 'passive' } },
        { id: 'pump', type: 'converter', position: { x: 2, y: 0 }, data: { kind: 'converter', label: 'Pump', activation: 'automatic', mode: 'pullAll' } },
        { id: 'store', type: 'pool', position: { x: 3, y: 0 }, data: { kind: 'pool', label: 'Store', initial: 0, capacity: null, resourceType: 'water', activation: 'passive' } },
        { id: 'city', type: 'drain', position: { x: 4, y: 0 }, data: { kind: 'drain', label: 'City', activation: 'automatic' } },
      ],
      edges: lines.map((l, i) => ({ id: `e${i}`, source: l.source, target: l.target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: l.flow, unit: l.unit ?? 'CMD' } })),
      kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMD', factor: '1', per: 'd' }] }],
      time: { step: { value: stepValue, unit: stepUnit } },
    }),
  )

const first = (d: ReturnType<typeof doc>) => {
  const o = { kinds: d.kinds, time: d.time }
  return step(d.nodes, d.edges, initSim(d.nodes, o), 1, d.modelVersion, o)
}
const moved = (d: ReturnType<typeof doc>, edgeId = 'e0') => first(d).report.events.find((e) => e.edgeId === edgeId)?.amount ?? 0
const derivedFlow = (d: ReturnType<typeof doc>) => (applyUnits(d.nodes, d.edges, d.kinds, d.time).edges[0].data as { flow: string }).flow

describe('a rate with a unit reaches the engine as its own value', () => {
  it.each([
    ['0.0001', 1, 'h', 0.0001 / 24],
    ['0.00003', 1, 'h', 0.00003 / 24],
    ['0.00002', 1, 'h', 0.00002 / 24],
    ['0.00001', 1, 'h', 0.00001 / 24],
    ['0.1', 1, 's', 0.1 / 86400],
    ['0.01', 1, 's', 0.01 / 86400],
    ['0.001', 1, 's', 0.001 / 86400],
  ])('%s CMD at a step of %s %s', (flow, value, unit, want) => {
    const d = doc([{ source: 'tank', target: 'city', flow }], value, unit)
    expect(moved(d)).toBeCloseTo(want, 15)
    expect(moved(d)).toBeLessThan(0.001)
  })

  it('reaches a Converter the same way, and the recipe still runs at both ends', () => {
    const d = doc([{ source: 'tank', target: 'pump', flow: '0.00002' }, { source: 'pump', target: 'store', flow: '0.00002' }], 1, 'h')
    const r = first(d)
    expect(r.report.diagnostics).toEqual([])
    const want = 0.00002 / 24
    expect(r.report.events.map((e) => e.amount)).toEqual([expect.closeTo(want, 15), expect.closeTo(want, 15)])
    expect(r.state.values.store).toBeCloseTo(want, 15)
  })

  it('reads a rate of 1e21 or more per step as itself, not as 1', () => {
    const d = doc([{ source: 'sea', target: 'tank', flow: `24${'0'.repeat(21)}` }], 1, 'h')
    expect(derivedFlow(d)).toMatch(/^\d+$/)
    expect(moved(d)).toBe(1e21)
  })

  it('writes plain digits for any size, and the digits read back as the same double', () => {
    for (const [flow, value, unit] of [['0.00002', 1, 'h'], ['0.001', 1, 's'], ['21000', 1, 'h'], ['0.1', 1, 'h'], [`24${'0'.repeat(25)}`, 1, 'h']] as const) {
      const d = doc([{ source: 'tank', target: 'city', flow }], value, unit)
      const text = derivedFlow(d)
      expect(text).toMatch(/^\d+(\.\d+)?$/)
    }
    const small = doc([{ source: 'tank', target: 'city', flow: '0.00002' }], 1, 'h')
    // the nearest double of the exact 1 / 1200000, which `0.00002 / 24` in doubles is not
    expect(Number(derivedFlow(small))).toBe(8.333333333333333e-7)
  })

  it('leaves a value String already wrote plainly unchanged', () => {
    const d = doc([{ source: 'tank', target: 'city', flow: '21000' }], 1, 'h')
    expect(derivedFlow(d)).toBe(String(21000 / 24))
  })

  it('does not throw on a rate past the range of a double, and the run refuses it', () => {
    const d = doc([{ source: 'tank', target: 'city', flow: `1${'0'.repeat(400)}` }], 1, 'h')
    expect(() => applyUnits(d.nodes, d.edges, d.kinds, d.time)).not.toThrow()
    const r = first(d)
    expect(r.report.events).toEqual([])
    expect(r.report.diagnostics).not.toEqual([])
  })

  it('moves nothing below the engine floor of 1e-9 per step, and never 1', () => {
    const d = doc([{ source: 'tank', target: 'city', flow: '0.00001' }], 1, 's')
    const r = first(d)
    expect(r.report.events).toEqual([])
    expect(r.state.values.tank).toBe(1000)
  })
})
