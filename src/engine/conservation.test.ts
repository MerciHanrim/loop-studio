import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// docs/specs/SEMANTICS.md §12 — invariant I1, conservation: over one step,
// Σ Pool after = Σ Pool before + what Sources pushed − what Drains / Ends took
// − what Converters lost (in − out). A router (Gate / Converter) stores
// nothing and destroys nothing (I5): whatever leaves a Pool through it either
// reaches a Pool, a Drain / End, or stays where it was.
//
// Issue #388 (the 2026-10-29 review): three Phase-2 paths broke this silently,
// with the upstream router reported as fired and no diagnostic; the sweep
// below found a fourth. The first cases pin each one with the graph that
// reproduced it; the last is a randomised sweep over every activation ×
// router kind so the invariant is guarded as a whole, not only on the shapes
// already seen.

const P = { x: 0, y: 0 }
type Act = 'automatic' | 'passive' | 'interactive' | 'onStart'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string, activation: Act = 'automatic'): LoopNode => ({
  id, type: 'source', position: P,
  data: { kind: 'source', label: id, activation, mode: 'pushAny' },
})
const gate = (id: string, activation: Act = 'automatic', distribution: 'deterministic' | 'probabilistic' = 'deterministic', mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation, distribution, mode },
})
const converter = (id: string, activation: Act = 'automatic', mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id, type: 'converter', position: P,
  data: { kind: 'converter', label: id, activation, mode },
})
const drain = (id: string, activation: Act = 'automatic'): LoopNode => ({
  id, type: 'drain', position: P,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const end = (id: string, activation: Act = 'automatic'): LoopNode => ({
  id, type: 'end', position: P,
  data: { kind: 'end', label: id, activation },
})
const edge = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})

/** the I1 balance of one step: Σ pools after − (Σ pools before + pushed − drained − converter loss) */
function imbalance(nodes: LoopNode[], before: ReturnType<typeof initSim>, after: ReturnType<typeof step>): number {
  const kind = new Map(nodes.map((n) => [n.id, n.data.kind]))
  const sum = (v: Record<string, number>) => nodes.filter((n) => n.data.kind === 'pool').reduce((s, n) => s + (v[n.id] ?? 0), 0)
  let pushed = 0, drained = 0, intoConv = 0, outConv = 0
  for (const ev of after.report.events) {
    if (kind.get(ev.from) === 'source') pushed += ev.amount
    if (kind.get(ev.to) === 'drain' || kind.get(ev.to) === 'end') drained += ev.amount
    if (kind.get(ev.to) === 'converter') intoConv += ev.amount
    if (kind.get(ev.from) === 'converter') outConv += ev.amount
  }
  return sum(after.state.values) - (sum(before.values) + pushed - drained - (intoConv - outConv))
}

describe('I1 conservation — the #388 shapes', () => {
  it('A: a Gate routing into a passive Gate — the share stays upstream or reaches the Pool', () => {
    const nodes = [pool('Q', 100), gate('g1'), gate('g2', 'passive'), pool('P', 0)]
    const edges = [edge('e1', 'Q', 'g1', '5'), edge('e2', 'g1', 'g2', 'all'), edge('e3', 'g2', 'P', 'all')]
    const s0 = initSim(nodes)
    const r = step(nodes, edges, s0, 1, 2)
    expect(Math.abs(imbalance(nodes, s0, r))).toBeLessThan(1e-6)
    // nothing may be handed to a router that does not fire this step
    expect(r.report.events.some((e) => e.to === 'g2')).toBe(false)
  })

  it('B: Gate → Gate → capped Pool — the second Gate is not blocked by the reservation made for it', () => {
    const nodes = [pool('Q', 100), gate('g1'), gate('g2'), pool('P', 8, 10)]
    const edges = [edge('e1', 'Q', 'g1', '5'), edge('e2', 'g1', 'g2', 'all'), edge('e3', 'g2', 'P', 'all')]
    const s0 = initSim(nodes)
    const r = step(nodes, edges, s0, 1, 2)
    expect(Math.abs(imbalance(nodes, s0, r))).toBeLessThan(1e-6)
    // the 2 units of headroom are filled, and exactly 2 left Q
    expect(r.state.values.P).toBeCloseTo(10, 6)
    expect(r.state.values.Q).toBeCloseTo(98, 6)
  })

  it('C: a Converter settles only its own reservation — a later producer cannot over-fill through it', () => {
    // Gate a (fed 3 from Q) → Converter d (3 in → 3 out into P); Converters b
    // and c each pool-fed 5 → P; P capacity 10. Canonical order a, b, c, d.
    const nodes = [
      pool('Q', 100), pool('R', 100), pool('R2', 100), pool('P', 0, 10),
      gate('a'), converter('b'), converter('c'), converter('d'),
    ]
    const edges = [
      edge('e1', 'Q', 'a', '3'), edge('e2', 'a', 'd', 'all'), edge('e3', 'd', 'P', '3'),
      edge('e4', 'R', 'b', '5'), edge('e5', 'b', 'P', '5'),
      edge('e6', 'R2', 'c', '5'), edge('e7', 'c', 'P', '5'),
    ]
    const s0 = initSim(nodes)
    const r = step(nodes, edges, s0, 1, 2)
    expect(Math.abs(imbalance(nodes, s0, r))).toBeLessThan(1e-6)
    expect(r.state.values.P).toBeLessThanOrEqual(10 + 1e-9)
  })

  it('D: a Converter feeding a router — the hand-off is an inbox, sized by what the router can take', () => {
    // Converter c → Gate g → Pool P. Found by the sweep (graph 24): the
    // Converter wrote its output into the Gate's `working` slot (summed over
    // Pools only at commit — lost), and sized it by the Gate's `headroom`
    // (unbounded for a router), so a Gate blocked by a full Pool downstream
    // was still handed an amount it could not deliver.
    const open = [pool('Q', 10), pool('P', 0), converter('c'), gate('g')]
    const openEdges = [edge('e1', 'Q', 'c', '3'), edge('e2', 'c', 'g', '3'), edge('e3', 'g', 'P', 'all')]
    const s0 = initSim(open)
    const r = step(open, openEdges, s0, 1, 2)
    expect(Math.abs(imbalance(open, s0, r))).toBeLessThan(1e-6)
    expect(r.state.values.P).toBeCloseTo(3, 6)

    const blocked = [pool('Q', 10), pool('P', 8, 8), converter('c'), gate('g')]
    const blockedEdges = [edge('e1', 'Q', 'c', '3'), edge('e2', 'c', 'g', '3'), edge('e3', 'g', 'P', '2')]
    const b0 = initSim(blocked)
    const rb = step(blocked, blockedEdges, b0, 1, 2)
    expect(Math.abs(imbalance(blocked, b0, rb))).toBeLessThan(1e-6)
    // nothing can be delivered, so the Converter must not run at all
    expect(rb.state.values.Q).toBeCloseTo(10, 6)
    expect(rb.state.fired).not.toContain('c')
  })
})

// A small deterministic PRNG for the graph generator (not the engine's RNG):
// the sweep must be reproducible from its seed so a failure names its graph.
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

describe('I1 conservation — randomised sweep over activations and router kinds', () => {
  const ACTS: Act[] = ['automatic', 'passive', 'interactive', 'onStart']
  const FLOWS = ['1', '2', '3', '5', 'all']
  // `50%` is kept OFF every edge that touches a Converter: the Converter reads
  // its edges as per-activation RATES (`rateOf` → 0.5) where a Gate / Drain
  // reads the same edge as an AMOUNT (`0.5 · S[source]`, SEMANTICS.md §flow
  // table), so a percent edge into or out of a Converter creates or loses
  // resource today — a separate defect (issue #396), not one of #388's. The
  // restriction is lifted there.
  const FLOWS_WITH_PCT = [...FLOWS, '50%']
  for (let g = 1; g <= 120; g++) {
    it(`graph ${g} conserves over 4 steps`, () => {
      const rnd = lcg(g * 7919)
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
      const nodes: LoopNode[] = []
      const nPools = 2 + Math.floor(rnd() * 3)
      // initial ≤ capacity: an initial above the capacity is clamped at the
      // first commit, a separate finding (engine review #4), not an I1 case
      for (let i = 0; i < nPools; i++) {
        const capacity = rnd() < 0.4 ? 5 + Math.floor(rnd() * 10) : null
        const initial = Math.floor(rnd() * 20)
        nodes.push(pool(`P${i}`, capacity == null ? initial : Math.min(initial, capacity), capacity))
      }
      if (rnd() < 0.5) nodes.push(source('S0', pick(ACTS)))
      const nRouters = 1 + Math.floor(rnd() * 4)
      const routers: string[] = []
      for (let i = 0; i < nRouters; i++) {
        const k = rnd()
        const id = `R${i}`
        routers.push(id)
        if (k < 0.4) nodes.push(gate(id, pick(ACTS), rnd() < 0.3 ? 'probabilistic' : 'deterministic', rnd() < 0.2 ? 'pullAll' : 'pullAny'))
        else if (k < 0.7) nodes.push(converter(id, pick(ACTS), rnd() < 0.2 ? 'pullAll' : 'pullAny'))
        else if (k < 0.9) nodes.push(drain(id, pick(ACTS)))
        else nodes.push(end(id, pick(ACTS)))
      }
      const pools = nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id)
      const edges: LoopEdge[] = []
      let eid = 0
      const kindOf = (id: string) => nodes.find((n) => n.id === id)!.data.kind
      const add = (s: string, t: string) => {
        if (s === t) return
        const touchesConverter = kindOf(s) === 'converter' || kindOf(t) === 'converter'
        edges.push(edge(`e${eid++}`, s, t, pick(touchesConverter ? FLOWS : FLOWS_WITH_PCT)))
      }
      if (nodes.some((n) => n.id === 'S0')) add('S0', pick(pools))
      // every router gets at least one input and, for gates / converters, one output;
      // a router may feed a later router (a DAG by index) or a pool
      routers.forEach((r, i) => {
        add(pick(pools), r)
        const kind = nodes.find((n) => n.id === r)!.data.kind
        if (kind === 'gate' || kind === 'converter') {
          const outs = 1 + Math.floor(rnd() * 2)
          for (let o = 0; o < outs; o++) {
            const later = routers.slice(i + 1)
            add(r, later.length && rnd() < 0.5 ? pick(later) : pick(pools))
          }
        }
      })
      let s = initSim(nodes)
      for (let t = 0; t < 4; t++) {
        const r = step(nodes, edges, s, 3, 2)
        const d = imbalance(nodes, s, r)
        expect(Math.abs(d), `graph ${g} step ${t + 1}: imbalance ${d}\nnodes=${JSON.stringify(nodes.map((n) => n.data))}\nedges=${JSON.stringify(edges.map((e) => [e.source, e.target, (e.data as { flow?: string }).flow]))}`).toBeLessThan(1e-6)
        s = r.state
      }
    })
  }
})
