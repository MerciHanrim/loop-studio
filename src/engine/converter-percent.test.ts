import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// issue #396 — reproduction on current main. What does `N%` mean on an edge
// that touches a Converter? Everywhere else the flow table (SEMANTICS.md §8)
// reads `25%` as the AMOUNT `0.25 · S[sourcePool]`; the Converter sizes its
// edges with `rateOf`, where `25%` is the bare fraction 0.25 per activation,
// whatever the source Pool holds. The probes below pin what the engine does
// today, with the Pool level varied so the two readings come apart.

const pool = (id: string, initial: number): LoopNode => ({
  id,
  type: 'pool',
  position: { x: 0, y: 0 },
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } as LoopNode['data'],
})
const converter = (id: string): LoopNode => ({
  id,
  type: 'converter',
  position: { x: 0, y: 0 },
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' } as LoopNode['data'],
})
const edge = (id: string, source: string, target: string, flow: string): LoopEdge =>
  ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

/** one step; the Pool values after it */
function oneStep(nodes: LoopNode[], edges: LoopEdge[]) {
  const s0 = initSim(nodes)
  const s1 = step(nodes, edges, s0, 1).state
  return { before: { ...s0.values }, after: { ...s1.values } }
}

describe('a percent flow on a Converter edge (#396) — current behaviour', () => {
  it('probe 1 — Pool A → Converter at 50% → Pool B at 1: the Converter pulls 0.5 whatever A holds (a rate), and emits 1', () => {
    for (const a0 of [8, 20]) {
      const { after } = oneStep([pool('A', a0), converter('C'), pool('B', 0)], [edge('e1', 'A', 'C', '50%'), edge('e2', 'C', 'B', '1')])
      expect(after.A).toBeCloseTo(a0 - 0.5, 9) // ← the rate reading: 0.5, not 0.5 · A
      expect(after.B).toBeCloseTo(1, 9)
    }
    // the amount reading (the flow table) would pull 0.5 · 8 = 4 and 0.5 · 20 = 10
  })

  it('probe 2 — Pool A (8) → Converter at 2 → Pool B at 50%: the Converter pulls 2 and emits 0.5 (a rate on an edge with no source Pool)', () => {
    const { after } = oneStep([pool('A', 8), converter('C'), pool('B', 0)], [edge('e1', 'A', 'C', '2'), edge('e2', 'C', 'B', '50%')])
    expect(after.A).toBeCloseTo(6, 9)
    expect(after.B).toBeCloseTo(0.5, 9)
    // the amount reading has no Pool behind a Converter's out-edge: `0.5 · S[C]` is 0
  })

  it('probe 3 — Converter → Converter at 50%: the hand-off is 0.5 of the first activation, not a share of what was received', () => {
    const nodes = [pool('A', 8), converter('C1'), converter('C2'), pool('B', 0)]
    const edges = [edge('e1', 'A', 'C1', '2'), edge('e2', 'C1', 'C2', '50%'), edge('e3', 'C2', 'B', '1')]
    const { after } = oneStep(nodes, edges)
    // C1 consumes 2 from A and produces 0.5 into C2's inbox; C2's inRate is 0.5,
    // so it runs at f = 1 and produces 1 into B
    expect(after.A).toBeCloseTo(6, 9)
    expect(after.B).toBeCloseTo(1, 9)
  })

  it('control — the same percent on a Gate pull is the amount: Pool A → Gate at 50% → Pool B pulls 0.5 · A', () => {
    const gate = (id: string): LoopNode => ({ id, type: 'gate', position: { x: 0, y: 0 }, data: { kind: 'gate', label: id, activation: 'automatic', mode: 'pullAny', distribution: 'deterministic' } as LoopNode['data'] })
    for (const a0 of [8, 20]) {
      const { after } = oneStep([pool('A', a0), gate('G'), pool('B', 0)], [edge('e1', 'A', 'G', '50%'), edge('e2', 'G', 'B', '1')])
      expect(after.A).toBeCloseTo(a0 / 2, 9)
      expect(after.B).toBeCloseTo(a0 / 2, 9)
    }
  })
})
