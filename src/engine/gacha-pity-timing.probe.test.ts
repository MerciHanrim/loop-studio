// docs/example-gacha-simulator.md §GS11-D1 — the proof that a hard-pity
// counter (increments per pull, resets on SSR, forces routing at the ceiling)
// is NOT expressible with the shipped state primitives. Kept as a runnable
// tripwire: if a future engine change makes either case behave differently,
// the gacha example's hard-pity follow-up (GS10-3) should be revisited.
import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' = 'automatic'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const label = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
const trig = (id: string, s: string, t: string, delay = 0): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', delay },
})

function run(nodes: LoopNode[], edges: LoopEdge[], n: number) {
  let st: SimState = initSim(nodes)
  const rows: { step: number; v: Record<string, number>; fired: string[] }[] = [
    { step: 0, v: { ...st.values }, fired: [...st.fired] },
  ]
  for (let i = 0; i < n; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    rows.push({ step: st.step, v: { ...st.values }, fired: r.report.fired })
  }
  return rows
}

describe('§GS11-D1 — hard pity is not expressible with shipped primitives', () => {
  it('`label` is unconditional: a `pity → pity` self-`-S` pins the counter, it cannot climb', () => {
    const nodes = [source('tick'), pool('pity', 0)]
    const edges = [
      res('e_tick', 'tick', 'pity', '1'), // +1 resource per step
      label('e_reset', 'pity', 'pity', '-S'), // a "reset" — but it applies EVERY step
    ]
    const pity = run(nodes, edges, 5).map((r) => r.v.pity ?? 0)
    // a conditional reset would give 1,2,3,4,5; the unconditional label caps it at
    // the single-step increment
    expect(pity).toEqual([0, 1, 1, 1, 1, 1])
  })

  it('a `trigger → Drain` reset lands one step late: the ceiling route fires on two consecutive steps', () => {
    const CAP = 5
    const nodes = [
      source('tick'),
      pool('pity', 0),
      drain('ceiling', 'automatic'), // fires only while S[pity] >= CAP — the "forced SSR" sensor
      drain('pity_drain', 'passive'), // empties pity when triggered — the "reset"
    ]
    const edges = [
      res('e_tick', 'tick', 'pity', '1'),
      res('e_sense', 'pity', 'ceiling', '0.001'),
      act('a_sense', 'pity', 'ceiling', `>= ${CAP}`),
      res('e_drain', 'pity', 'pity_drain', '999'),
      trig('t_reset', 'ceiling', 'pity_drain', 0),
    ]
    const firedAt = run(nodes, edges, 9)
      .filter((r) => r.fired.includes('ceiling'))
      .map((r) => r.step)
    // BUG the gacha example must avoid: the forced route fires twice because the
    // reset only lands the step AFTER, and the routing activator has already read
    // the pre-reset S[pity]
    expect(firedAt.length).toBeGreaterThanOrEqual(2)
    expect(firedAt[1] - firedAt[0]).toBe(1)
  })
})
