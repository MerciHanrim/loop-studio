import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { deserialize, serialize } from '../model/serialize'
import { initSim, step } from './index'

// issue #396 — `N%` on a connection that touches a Converter is REFUSED
// (Lumi, 2026-10-30). Everywhere else the flow table (SEMANTICS.md §8) reads
// `25%` as the amount `0.25 · S[sourcePool]`; a Converter reads its edges as
// per-activation rates, its out-edges and a Converter → Converter edge have no
// Pool to take a percent of, and reading the token as the bare fraction gave
// "50%" two meanings (half the Pool on a Gate, half a unit on a Converter).
// The rule: the edge contributes 0, one run diagnostic names the connection
// and the expression and says what number keeps the old behaviour, and the
// document is never rewritten. A Gate's `50%` is unchanged.

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
const gate = (id: string): LoopNode => ({
  id,
  type: 'gate',
  position: { x: 0, y: 0 },
  data: { kind: 'gate', label: id, activation: 'automatic', mode: 'pullAny', distribution: 'deterministic' } as LoopNode['data'],
})
const edge = (id: string, source: string, target: string, flow: string): LoopEdge =>
  ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

/** one step: the Pool values before and after, and the step's diagnostics */
function oneStep(nodes: LoopNode[], edges: LoopEdge[]) {
  const s0 = initSim(nodes)
  const r = step(nodes, edges, s0, 1)
  return { before: { ...s0.values }, after: { ...r.state.values }, diagnostics: r.report.diagnostics, fired: [...r.state.fired] }
}
const REFUSED = (id: string, raw: string, frac: string) =>
  `Edge "${id}" flow "${raw}" is a percent on a Converter connection; a Converter's rate cannot be a percent — contributes 0 (write ${frac} for the rate "${raw}" used to mean).`

describe('a percent flow on a Converter connection is refused (#396)', () => {
  it('input — Pool A → Converter at 50% → Pool B at 1: the edge contributes 0, the Converter has no input and moves nothing; one diagnostic names e1 and "50%"', () => {
    for (const a0 of [8, 20]) {
      const r = oneStep([pool('A', a0), converter('C'), pool('B', 0)], [edge('e1', 'A', 'C', '50%'), edge('e2', 'C', 'B', '1')])
      expect(r.after).toEqual({ A: a0, B: 0 })
      expect(r.fired).not.toContain('C')
      expect(r.diagnostics.filter((d) => d.includes('"e1"'))).toEqual([REFUSED('e1', '50%', '0.5')])
    }
  })

  it('output — Pool A (8) → Converter at 2 → Pool B at 50%: the out-edge is dead, so the Converter has no live output and pulls nothing; the diagnostic names e2', () => {
    const r = oneStep([pool('A', 8), converter('C'), pool('B', 0)], [edge('e1', 'A', 'C', '2'), edge('e2', 'C', 'B', '50%')])
    expect(r.after).toEqual({ A: 8, B: 0 })
    expect(r.diagnostics.filter((d) => d.includes('"e2"'))).toEqual([REFUSED('e2', '50%', '0.5')])
  })

  it('Converter → Converter at 50%: the hand-off edge is dead; neither Converter runs; the diagnostic names e2', () => {
    const nodes = [pool('A', 8), converter('C1'), converter('C2'), pool('B', 0)]
    const edges = [edge('e1', 'A', 'C1', '2'), edge('e2', 'C1', 'C2', '50%'), edge('e3', 'C2', 'B', '1')]
    const r = oneStep(nodes, edges)
    expect(r.after).toEqual({ A: 8, B: 0 })
    expect(r.fired).toEqual([])
    expect(r.diagnostics.filter((d) => d.includes('"e2"'))).toEqual([REFUSED('e2', '50%', '0.5')])
  })

  it('the refusal is per edge: a numeric input beside a refused one still feeds the Converter, and the diagnostic is flushed once per step', () => {
    const nodes = [pool('A', 8), pool('A2', 8), converter('C'), pool('B', 0)]
    const edges = [edge('e1', 'A', 'C', '50%'), edge('e2', 'A2', 'C', '2'), edge('e3', 'C', 'B', '1')]
    const r = oneStep(nodes, edges)
    expect(r.after).toEqual({ A: 8, A2: 6, B: 1 })
    expect(r.diagnostics.filter((d) => d.startsWith('Edge "e1"'))).toHaveLength(1)
  })

  it('the number the diagnostic names reproduces what the percent used to do: 0.5 on the same edges', () => {
    const r = oneStep([pool('A', 8), converter('C'), pool('B', 0)], [edge('e1', 'A', 'C', '0.5'), edge('e2', 'C', 'B', '1')])
    expect(r.after).toEqual({ A: 7.5, B: 1 })
    expect(r.diagnostics).toEqual([])
  })

  it('the percent text is not rewritten by a save: the document keeps "50%" through serialize / deserialize', () => {
    const nodes = [pool('A', 8), converter('C'), pool('B', 0)]
    const edges = [edge('e1', 'A', 'C', '50%'), edge('e2', 'C', 'B', '1')]
    const back = deserialize(serialize(nodes, edges))
    expect((back.edges.find((e) => e.id === 'e1')!.data as { flow?: string }).flow).toBe('50%')
  })

  it('control — a Gate still reads 50% as the amount: Pool A → Gate at 50% → Pool B pulls 0.5 · A, no diagnostic', () => {
    for (const a0 of [8, 20]) {
      const r = oneStep([pool('A', a0), gate('G'), pool('B', 0)], [edge('e1', 'A', 'G', '50%'), edge('e2', 'G', 'B', '1')])
      expect(r.after).toEqual({ A: a0 / 2, B: a0 / 2 })
      expect(r.diagnostics).toEqual([])
    }
  })
})
