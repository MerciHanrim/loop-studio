import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// issue #419 item 2 (Lumi, 2026-10-30) — a push-all Source with a non-Pool
// target reports every such edge and still moves nothing (atomic). Before, the
// atomic check `continue`d before the per-edge loop that reports a non-Pool
// target, so the Source was a silent no-op on all of its edges while the
// `pushAny` twin in the same graph pushed to the Pool and reported the Drain.

const P = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id,
  type: 'pool',
  position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string, mode: 'pushAny' | 'pushAll'): LoopNode => ({
  id,
  type: 'source',
  position: P,
  data: { kind: 'source', label: id, activation: 'automatic', mode },
})
const drain = (id: string): LoopNode => ({
  id,
  type: 'drain',
  position: P,
  data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' },
})
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  data: { kind: 'resource', flow },
})

describe('push-all Source with a non-Pool target (#419 item 2)', () => {
  it('reports the Drain edge by id, Source and target, and moves nothing on any edge', () => {
    const nodes = [source('S', 'pushAll'), pool('P'), drain('D')]
    const edges = [edge('eP', 'S', 'P', '2'), edge('eD', 'S', 'D', '2')]
    const r = step(nodes, edges, initSim(nodes))
    expect(r.state.values.P).toBe(0)
    expect(r.report.events).toEqual([])
    expect(r.report.fired).toEqual([])
    expect(r.report.diagnostics).toHaveLength(1)
    expect(r.report.diagnostics[0]).toContain('Edge "eD"')
    expect(r.report.diagnostics[0]).toContain('Source "S"')
    expect(r.report.diagnostics[0]).toContain('drain "D"')
    expect(r.report.diagnostics[0]).toContain('push-all Source moves nothing')
    // the same every step — one line per step, never silent again
    const r2 = step(nodes, edges, r.state)
    expect(r2.report.diagnostics).toHaveLength(1)
    expect(r2.state.values.P).toBe(0)
  })

  it('two non-Pool targets: one line per edge', () => {
    const nodes = [source('S', 'pushAll'), pool('P'), drain('D1'), drain('D2')]
    const edges = [edge('e1', 'S', 'P', '1'), edge('e2', 'S', 'D1', '1'), edge('e3', 'S', 'D2', '1')]
    const r = step(nodes, edges, initSim(nodes))
    expect(r.report.diagnostics.map((d) => d.slice(0, 9))).toEqual(['Edge "e2"', 'Edge "e3"'])
    expect(r.state.values.P).toBe(0)
  })

  it('the pushAny twin, for contrast: pushes to the Pool and reports the Drain edge its own way', () => {
    const nodes = [source('S', 'pushAny'), pool('P'), drain('D')]
    const edges = [edge('eP', 'S', 'P', '2'), edge('eD', 'S', 'D', '2')]
    const r = step(nodes, edges, initSim(nodes))
    expect(r.state.values.P).toBe(2)
    expect(r.report.diagnostics).toEqual(['Source "S" pushes to a non-Pool; ignored in Engine A.'])
  })

  it('push-all with only Pool targets is unchanged: all or nothing, no diagnostic', () => {
    const nodes = [source('S', 'pushAll'), pool('A'), pool('B', 0, 1)]
    const edges = [edge('eA', 'S', 'A', '2'), edge('eB', 'S', 'B', '2')]
    const r = step(nodes, edges, initSim(nodes)) // B has headroom 1 < 2 ⇒ nothing
    expect(r.state.values).toEqual({ A: 0, B: 0 })
    expect(r.report.diagnostics).toEqual([])
    const ok = step(nodes, [edge('eA', 'S', 'A', '2'), edge('eB', 'S', 'B', '1')], initSim(nodes))
    expect(ok.state.values).toEqual({ A: 2, B: 1 })
    expect(ok.report.diagnostics).toEqual([])
  })
})
