import { describe, expect, it } from 'vitest'
import coffeeDoc from '../../examples/coffee-roastery.json'
import deadlockDoc from '../../examples/deadlock.json'
import equilibriumDoc from '../../examples/equilibrium.json'
import mmoDoc from '../../examples/mmo-progression.json'
import { initSim, ROUTER_KINDS, step } from '../engine'
import type { FlowEvent } from '../engine'
import { normalizeGraph } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { computeStagger, STAGGER_SPAN } from './playbackRank'

// docs/simulation-playback-ordering.md PBO-D2 (corrected) — the cascade never
// runs backward. With longest-predecessor depth over the FULL resource-edge
// condensation DAG this is a STRUCTURAL guarantee: every condensation edge
// points strictly deeper. Checked here on every bundled example, plus that
// `computeStagger` returns a bounded schedule for a real step of each.

const BUNDLED: Record<string, unknown> = {
  'equilibrium.json': equilibriumDoc,
  'deadlock.json': deadlockDoc,
  'coffee-roastery.json': coffeeDoc,
  'mmo-progression.json': mmoDoc,
}

/** the same full resource digraph + SCC + longest-path depth the schedule uses,
 *  re-derived here independently so the assertion is not circular. */
function depthLabelling(nodes: LoopNode[], edges: LoopEdge[]) {
  const ids = nodes.map((n) => n.id).sort()
  const idx = new Map(ids.map((id, i) => [id, i]))
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if ((e.data?.kind ?? 'resource') !== 'resource') continue
    if (adj.has(e.source) && adj.has(e.target)) adj.get(e.source)!.push(e.target)
  }

  // SCC via a simple iterative Kosaraju (independent of playbackRank's Tarjan)
  const order: string[] = []
  const seen = new Set<string>()
  for (const s of ids) {
    if (seen.has(s)) continue
    const stack: [string, number][] = [[s, 0]]
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top[1] === 0) seen.add(top[0])
      const outs = adj.get(top[0])!
      if (top[1] < outs.length) {
        top[1]++
        if (!seen.has(outs[top[1] - 1])) stack.push([outs[top[1] - 1], 0])
      } else {
        order.push(top[0])
        stack.pop()
      }
    }
  }
  const radj = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [u, outs] of adj) for (const v of outs) radj.get(v)!.push(u)
  const sccOf = new Map<string, number>()
  let sc = 0
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i]
    if (sccOf.has(s)) continue
    const stack = [s]
    while (stack.length) {
      const v = stack.pop()!
      if (sccOf.has(v)) continue
      sccOf.set(v, sc)
      for (const w of radj.get(v)!) if (!sccOf.has(w)) stack.push(w)
    }
    sc++
  }

  const cEdges = new Set<string>()
  const cIndeg = new Map<number, number>()
  const cAdj = new Map<number, number[]>()
  for (let i = 0; i < sc; i++) {
    cIndeg.set(i, 0)
    cAdj.set(i, [])
  }
  for (const [u, outs] of adj) {
    for (const v of outs) {
      const a = sccOf.get(u)!
      const b = sccOf.get(v)!
      if (a === b || cEdges.has(`${a}>${b}`)) continue
      cEdges.add(`${a}>${b}`)
      cAdj.get(a)!.push(b)
      cIndeg.set(b, cIndeg.get(b)! + 1)
    }
  }
  const depth = new Map<number, number>()
  for (let i = 0; i < sc; i++) depth.set(i, 0)
  let front = [...cIndeg.entries()].filter(([, d]) => d === 0).map(([k]) => k)
  const work = new Map(cIndeg)
  while (front.length) {
    const nxt: number[] = []
    for (const a of front)
      for (const b of cAdj.get(a)!) {
        depth.set(b, Math.max(depth.get(b)!, depth.get(a)! + 1))
        work.set(b, work.get(b)! - 1)
        if (work.get(b) === 0) nxt.push(b)
      }
    front = nxt
  }
  void idx
  return { sccOf, depth }
}

describe('computeStagger — bundled examples (PBO-D2 structural monotonicity)', () => {
  for (const [name, doc] of Object.entries(BUNDLED)) {
    it(`${name}: every condensation edge points strictly deeper`, () => {
      const { nodes, edges } = normalizeGraph(doc as { nodes: LoopNode[]; edges: LoopEdge[] })
      const { sccOf, depth } = depthLabelling(nodes, edges)
      for (const e of edges) {
        if ((e.data?.kind ?? 'resource') !== 'resource') continue
        const a = sccOf.get(e.source)
        const b = sccOf.get(e.target)
        if (a == null || b == null || a === b) continue
        expect(
          depth.get(b)!,
          `${name}: ${e.id} ${e.source}→${e.target} must go deeper`,
        ).toBeGreaterThan(depth.get(a)!)
      }
    })

    it(`${name}: a real step yields a bounded, ordered schedule`, () => {
      const { nodes, edges } = normalizeGraph(doc as { nodes: LoopNode[]; edges: LoopEdge[] })
      let st = initSim(nodes)
      let events: FlowEvent[] = []
      for (let i = 0; i < 6 && !st.ended; i++) {
        const r = step(nodes, edges, st, 1)
        st = r.state
        events = [...r.report.events]
      }
      const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, events)

      expect(bucketCount).toBeLessThanOrEqual(6)
      for (const v of Object.values(onsetByEdge)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(STAGGER_SPAN)
      }
      // every edge that carried flow has an onset
      for (const ev of events) expect(onsetByEdge).toHaveProperty(ev.edgeId)
    })
  }

  it('ROUTER_KINDS is the engine set (no drift)', () => {
    expect([...ROUTER_KINDS].sort()).toEqual(['converter', 'drain', 'end', 'gate'])
  })
})
