import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// issue #419 item 1 (Lumi, 2026-10-30) — an ended state is a fixed point of
// `step`: the step count and the values do not change, nothing fires, and the
// report carries no events and no diagnostics. SEMANTICS.md §6: "if `ended` was
// set, the run stops". Before: `step` started from `let ended = prev.ended` and
// ran every phase, so Pool 100 → End at 10 gave 90, then 80, then 70.

const P = { x: 0, y: 0 }
const pool = (id: string, initial: number): LoopNode => ({
  id,
  type: 'pool',
  position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id,
  type: 'source',
  position: P,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const end = (id: string): LoopNode => ({
  id,
  type: 'end',
  position: P,
  data: { kind: 'end', label: id, activation: 'automatic' },
})
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  data: { kind: 'resource', flow },
})

// Source ─1→ Pool R (0) and Pool Q (100) ─10→ End: step 1 ends the run; a step
// after that would otherwise push 1 more into R and pull 10 more out of Q
const nodes = [source('S'), pool('R', 0), pool('Q', 100), end('E')]
const edges = [edge('eS', 'S', 'R', '1'), edge('eE', 'Q', 'E', '10')]

describe('step() on an ended state (#419 item 1)', () => {
  it('step 1 reaches the End: Q 90, R 1, ended, End fired', () => {
    const r1 = step(nodes, edges, initSim(nodes))
    expect(r1.state).toMatchObject({ step: 1, ended: true, values: { Q: 90, R: 1 } })
    expect(r1.state.fired).toEqual(['E', 'S'])
    expect(r1.report.events).toHaveLength(2)
  })

  it('a further step is a fixed point: same step, same values, nothing fired, an empty report', () => {
    const r1 = step(nodes, edges, initSim(nodes))
    const r2 = step(nodes, edges, r1.state)
    expect(r2.state.step).toBe(1)
    expect(r2.state.values).toEqual({ Q: 90, R: 1 })
    expect(r2.state.ended).toBe(true)
    expect(r2.state.fired).toEqual([])
    expect(r2.state.triggerQueue).toEqual([])
    expect(r2.report).toEqual({ events: [], activated: [], fired: [], stateEvents: [], diagnostics: [] })
    // and it stays there — the Source never pushes again, Q never drains again
    const r3 = step(nodes, edges, r2.state, 7, 2)
    expect(r3.state).toEqual(r2.state)
    expect(r3.report.events).toEqual([])
  })
})
