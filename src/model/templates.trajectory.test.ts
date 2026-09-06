import { describe, expect, it } from 'vitest'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import { initSim, step } from '../engine'
import { normalizeGraph } from './serialize'
import type { LoopEdge, LoopNode } from './types'

// The two production-line samples are the frozen SEMANTICS.md §14 Variant A /
// Variant B acceptance diagrams — only the labels carry the production framing.
// This pins that the EXTRACTED examples/*.json still reproduce the §14
// trajectory exactly (Raw material inventory = tpl-vault, Finished goods
// inventory = tpl-prod), so a relabel or a stray field change in the JSON that
// altered engine behaviour would fail here rather than silently drifting the
// user-facing sample away from the spec.

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6

function run(doc: unknown, steps: number) {
  const { nodes, edges } = normalizeGraph(
    doc as { nodes: LoopNode[]; edges: LoopEdge[] },
  )
  let st = initSim(nodes)
  const frames = [{ V: st.values['tpl-vault'], P: st.values['tpl-prod'], fired: [] as string[] }]
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st)
    st = r.state
    frames.push({
      V: st.values['tpl-vault'],
      P: st.values['tpl-prod'],
      fired: r.report.fired,
    })
  }
  return frames
}

describe('production-line samples — SEMANTICS §14 trajectory (extracted JSON)', () => {
  it('Balanced production line (equilibrium.json) settles to Raw 3 / Finished 1', () => {
    const t = run(equilibriumDoc, 6)
    // step, V (tpl-vault), P (tpl-prod)
    const expected: Array<[number, number, number]> = [
      [1, 3, 0],
      [2, 3, 1],
      [3, 3, 1],
      [4, 3, 1],
      [5, 3, 1],
      [6, 3, 1],
    ]
    for (const [s, v, p] of expected) {
      expect(near(t[s].V, v), `step ${s} Raw inventory`).toBe(true)
      expect(near(t[s].P, p), `step ${s} Finished inventory`).toBe(true)
    }
  })

  it('Capacity deadlock (deadlock.json) fills Finished to 3, backs Raw up to 10, then freezes', () => {
    const t = run(deadlockDoc, 10)
    const expected: Array<[number, number, number]> = [
      [1, 3, 0],
      [2, 3, 1],
      [3, 3, 2],
      [4, 3, 3],
      [5, 6, 3],
      [6, 9, 3],
      [7, 10, 3],
      [8, 10, 3],
      [9, 10, 3],
      [10, 10, 3],
    ]
    for (const [s, v, p] of expected) {
      expect(near(t[s].V, v), `step ${s} Raw inventory`).toBe(true)
      expect(near(t[s].P, p), `step ${s} Finished inventory`).toBe(true)
    }
    // frozen terminal state — nothing fires from step 8 on
    expect(t[8].fired).toEqual([])
    expect(t[9].fired).toEqual([])
    expect(t[10].fired).toEqual([])
  })
})
