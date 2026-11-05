// The numbers of Help ▸ How a step fills and empties a Pool, read from the engine.
import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './step'

const node = (id: string, kind: string, extra: object = {}) =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, activation: 'automatic', ...extra } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string) =>
  ({ id, source, target, data: { kind: 'resource', flow } }) as unknown as LoopEdge

function tank(nodes: LoopNode[], edges: LoopEdge[], steps: number) {
  let st = initSim(nodes)
  const out: { tank: number; moved: Record<string, number> }[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1, 2)
    st = r.state
    out.push({ tank: st.values.t, moved: Object.fromEntries(r.report.events.map((e) => [e.edgeId, e.amount])) })
  }
  return out
}

describe('the order inside a step', () => {
  it('a tank of 3000 that is filled and gives 800 reads 2200 at the end of each step', () => {
    const run = tank([node('s', 'source'), node('t', 'pool', { initial: 2200, capacity: 3000 }), node('d', 'drain')], [line('in', 's', 't', '5000'), line('out', 't', 'd', '800')], 3)
    expect(run.map((r) => r.tank)).toEqual([2200, 2200, 2200])
    expect(run[0].moved).toEqual({ in: 800, out: 800 }) // it fills to 3000 first, then gives
  })

  it('a tank that receives 360 while a demand asks 800 reads 360, and gives last step’s 360', () => {
    const run = tank([node('s', 'source'), node('t', 'pool', { initial: 0 }), node('d', 'drain')], [line('in', 's', 't', '360'), line('out', 't', 'd', '800')], 3)
    expect(run.map((r) => r.tank)).toEqual([360, 360, 360])
    expect(run[0].moved).toEqual({ in: 360 }) // what arrived this step waits for the next
    expect(run[1].moved).toEqual({ in: 360, out: 360 })
  })
})
