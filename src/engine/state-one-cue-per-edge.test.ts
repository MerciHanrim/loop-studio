import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

// docs/simulation-playback.md §PB4.5 — the playback travel budget gates the
// choreography per EDGE (`travelBudget.has(id)`), which is only sound if the
// engine emits at most ONE state effect per edge per step (an edge has one
// `mode`, and each mode contributes at most one `StateEvent`). This locks that
// invariant so the per-edge budget membership can never let one edge render
// several beads and push the on-screen total past `MAX_PLAYBACK_TOKENS_TOTAL`.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation: 'passive', mode: 'pullAny' },
})
const trig = (id: string, s: string, t: string, delay: number): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', delay },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
const label = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})

/** every state mode at once, some firing every step, a delayed trigger, and
 *  THREE parallel label edges between the same pair — the densest realistic
 *  single-step state load. */
const nodes: LoopNode[] = [
  source('Src'),
  pool('P', 0),
  drain('D'),
  pool('Feed', 1000),
  pool('Tank', 0, 12), // capped ⇒ a clamp rides one label event
]
const edges: LoopEdge[] = [
  res('e_sp', 'Src', 'P', '2'),
  trig('t_now', 'Src', 'D', 0), // delivers every step from step 2
  trig('t_late', 'Src', 'D', 2), // delivers on step 4
  act('a_pd', 'P', 'D', '>= 1'),
  label('l_add', 'Feed', 'Tank', '+5'),
  label('l_sub', 'Feed', 'Tank', '-2'),
  label('l_src', 'Feed', 'Tank', '+S'),
]

describe('one travelling state cue per edge per step (playback budget invariant)', () => {
  it('no report.stateEvents step ever repeats an edgeId', () => {
    let st: SimState = initSim(nodes)
    let sawMultiLabelStep = false
    for (let i = 0; i < 8; i++) {
      const r = step(nodes, edges, st, 1)
      st = r.state
      const ids = r.report.stateEvents.map((e) => e.edgeId)
      expect(new Set(ids).size, `step ${st.step} emitted duplicate edgeIds: ${ids.join(', ')}`).toBe(ids.length)
      if (ids.filter((id) => id.startsWith('l_')).length >= 3) sawMultiLabelStep = true
    }
    // the fixture really did drive several state edges in a single step
    expect(sawMultiLabelStep, 'expected a step with all three label edges active').toBe(true)
  })

  it('reversed edge order emits the same per-edge event set each step', () => {
    const fwd = collect(edges)
    const rev = collect([...edges].reverse())
    expect(rev).toEqual(fwd)
  })
})

function collect(es: LoopEdge[]): Record<string, string>[] {
  let st: SimState = initSim(nodes)
  const out: Record<string, string>[] = []
  for (let i = 0; i < 6; i++) {
    const r = step(nodes, es, st, 1)
    st = r.state
    const byEdge: Record<string, string> = {}
    for (const e of r.report.stateEvents) byEdge[e.edgeId] = e.effect.kind
    out.push(byEdge)
  }
  return out
}
