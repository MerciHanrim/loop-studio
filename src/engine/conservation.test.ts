import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { converterGroups } from './converterGroups'
import { initSim, step } from './index'

// docs/specs/SEMANTICS.md §12 — the conservation invariants, checked over one
// step as FOUR separate statements (the issue #471 erratum), not as one sum:
//   1. every Pool's change equals its events, after − before = Σ in − Σ out:
//      an unreported commit clamp (I3) shows here, where one sum over all
//      Pools let a Converter's loss hide inside "net loss";
//   2. one f per Converter (I2): on every connection that moved, amount ÷ rate
//      is the same number;
//   3. a Converter's net loss is the recipe's at that f, f · (Σ need − Σ make),
//      never an amount measured from the events;
//   4. a Gate ends empty (I5): Σ in = Σ out.
// Checks 2 and 3 are stated for Pool-fed Converters. A Converter with a
// router-fed input is Phase B of #471 (the joint plan across routers): until it
// lands, its inbox is consumed at the routers' fraction and its Pool inputs at
// their own, and the sweep below says how many such Converters it drew.
//
// Issue #388 (the 2026-10-29 review): three Phase-2 paths broke I1 silently,
// with the upstream router reported as fired and no diagnostic; the sweep found
// a fourth. The first cases pin each one with the graph that reproduced it.
// Then a randomised sweep — a reproducible SAMPLE of 120 small graphs drawn
// from every activation × router kind, not an exhaustive check of their
// combinations — and (#471) three seeded families for the shapes the sweep
// never draws: two outputs into one target, a nearly full capped output, and
// two routers into one Converter.

const P = { x: 0, y: 0 }
type Act = 'automatic' | 'passive' | 'interactive' | 'onStart'
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string, activation: Act = 'automatic'): LoopNode => ({
  id, type: 'source', position: P,
  data: { kind: 'source', label: id, activation, mode: 'pushAny' },
})
const gate = (id: string, activation: Act = 'automatic', distribution: 'deterministic' | 'probabilistic' = 'deterministic', mode: Mode = 'pullAny'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation, distribution, mode },
})
const converter = (id: string, activation: Act = 'automatic', mode: Mode = 'pullAny'): LoopNode => ({
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

/** the rate a flow string means on a Converter connection (SEMANTICS.md §8;
 *  `all` → 1 per run; a percent is refused there, issue #396 → 0) */
const converterRate = (flow: string): number =>
  flow === 'all' ? 1 : flow.endsWith('%') ? 0 : Number(flow)

type Before = ReturnType<typeof initSim>
type After = ReturnType<typeof step>

/** the four checks over one step; `[]` when all hold. `multi` counts the
 *  Converters checks 2 / 3 skipped: members of a MULTI group (a Gate with two
 *  supplies), which keeps the rule it had until its design is done (#471 stays
 *  open). A Converter in a TREE group is planned with its routers (Deploy 2)
 *  and is checked like a Pool-fed one. */
function conservation(nodes: LoopNode[], edges: LoopEdge[], before: Before, after: After): { violations: string[]; multi: number } {
  const violations: string[] = []
  const byEdge = new Map(edges.map((e) => [e.id, e]))
  const moved = new Map<string, number>()
  for (const ev of after.report.events) moved.set(ev.edgeId, (moved.get(ev.edgeId) ?? 0) + ev.amount)
  const into = (id: string) => [...moved].reduce((s, [eid, a]) => s + (byEdge.get(eid)!.target === id ? a : 0), 0)
  const outOf = (id: string) => [...moved].reduce((s, [eid, a]) => s + (byEdge.get(eid)!.source === id ? a : 0), 0)
  const flowOf = (e: LoopEdge) => (e.data as { flow?: string }).flow ?? ''
  const multiMembers = new Set(converterGroups(nodes, edges).filter((g) => g.cls === 'multi').flatMap((g) => g.members))
  let multi = 0

  for (const n of nodes) {
    if (n.data.kind === 'pool') {
      // 1 — no `label` state connections in these graphs, so no Phase-0 term
      const d = (after.state.values[n.id] ?? 0) - (before.values[n.id] ?? 0) - (into(n.id) - outOf(n.id))
      if (Math.abs(d) > 1e-6) violations.push(`Pool ${n.id}: its value changed by ${d.toFixed(6)} more than its events say (an unreported clamp, I3)`)
    } else if (n.data.kind === 'gate') {
      // 4
      const d = into(n.id) - outOf(n.id)
      if (Math.abs(d) > 1e-6) violations.push(`Gate ${n.id}: took ${into(n.id).toFixed(6)} and passed on ${outOf(n.id).toFixed(6)} (I5)`)
    } else if (n.data.kind === 'converter') {
      const ins = edges.filter((e) => e.target === n.id && e.data?.kind === 'resource')
      const outs = edges.filter((e) => e.source === n.id && e.data?.kind === 'resource')
      if (multiMembers.has(n.id)) {
        multi++
        continue
      }
      // 2 — one f on the inputs; every output either moved f · rate or is
      // inert this step (a branch into a router that does not fire, or on a
      // zero-storage cycle: SEMANTICS-S.md §S4 — the Converter makes its other
      // outputs and simply does not make that one; nothing is lost)
      const fs: { e: string; f: number }[] = []
      for (const e of ins) {
        const r = converterRate(flowOf(e))
        if (r <= 0) continue // a refused percent moves nothing
        fs.push({ e: e.id, f: (moved.get(e.id) ?? 0) / r })
      }
      const f = fs[0]?.f ?? 0
      if (fs.some((x) => Math.abs(x.f - f) > 1e-6)) {
        violations.push(`Converter ${n.id}: no single f on its inputs — ${fs.map((x) => `${x.e} ${x.f.toFixed(4)}`).join(', ')} (I2)`)
      }
      let makeLive = 0
      for (const e of outs) {
        const r = converterRate(flowOf(e))
        const a = moved.get(e.id) ?? 0
        if (r <= 0 || a <= 1e-9) continue
        makeLive += r
        if (Math.abs(a / r - f) > 1e-6) violations.push(`Converter ${n.id}: output ${e.id} at f ${(a / r).toFixed(4)}, its inputs at ${f.toFixed(4)} (I2)`)
      }
      if (f > 1e-6 && makeLive === 0) violations.push(`Converter ${n.id}: took its inputs at f ${f.toFixed(4)} and produced nothing (I4)`)
      // 3 — the loss is the recipe's at f, over the outputs it made
      const need = ins.reduce((s, e) => s + converterRate(flowOf(e)), 0)
      const loss = into(n.id) - outOf(n.id)
      if (Math.abs(loss - f * (need - makeLive)) > 1e-6) {
        violations.push(`Converter ${n.id}: lost ${loss.toFixed(6)}, its recipe at f ${f.toFixed(4)} loses ${(f * (need - makeLive)).toFixed(6)} (I1)`)
      }
    }
  }
  return { violations, multi }
}

/** `expect` the four checks over `steps` steps of one graph; returns the
 *  number of multi-group Converters the checks skipped */
function holds(nodes: LoopNode[], edges: LoopEdge[], steps: number, label: string): number {
  let s = initSim(nodes)
  let multi = 0
  for (let t = 0; t < steps; t++) {
    const r = step(nodes, edges, s, 3, 2)
    const c = conservation(nodes, edges, s, r)
    multi = Math.max(multi, c.multi)
    expect(c.violations, `${label} step ${t + 1}\nnodes=${JSON.stringify(nodes.map((n) => n.data))}\nedges=${JSON.stringify(edges.map((e) => [e.source, e.target, (e.data as { flow?: string }).flow]))}`).toEqual([])
    s = r.state
  }
  return multi
}

describe('conservation — the #388 shapes', () => {
  it('A: a Gate routing into a passive Gate — the share stays upstream or reaches the Pool', () => {
    const nodes = [pool('Q', 100), gate('g1'), gate('g2', 'passive'), pool('P', 0)]
    const edges = [edge('e1', 'Q', 'g1', '5'), edge('e2', 'g1', 'g2', 'all'), edge('e3', 'g2', 'P', 'all')]
    const s0 = initSim(nodes)
    const r = step(nodes, edges, s0, 1, 2)
    expect(conservation(nodes, edges, s0, r).violations).toEqual([])
    // nothing may be handed to a router that does not fire this step
    expect(r.report.events.some((e) => e.to === 'g2')).toBe(false)
  })

  it('B: Gate → Gate → capped Pool — the second Gate is not blocked by the reservation made for it', () => {
    const nodes = [pool('Q', 100), gate('g1'), gate('g2'), pool('P', 8, 10)]
    const edges = [edge('e1', 'Q', 'g1', '5'), edge('e2', 'g1', 'g2', 'all'), edge('e3', 'g2', 'P', 'all')]
    const s0 = initSim(nodes)
    const r = step(nodes, edges, s0, 1, 2)
    expect(conservation(nodes, edges, s0, r).violations).toEqual([])
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
    expect(conservation(nodes, edges, s0, r).violations).toEqual([])
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
    expect(conservation(open, openEdges, s0, r).violations).toEqual([])
    expect(r.state.values.P).toBeCloseTo(3, 6)

    const blocked = [pool('Q', 10), pool('P', 8, 8), converter('c'), gate('g')]
    const blockedEdges = [edge('e1', 'Q', 'c', '3'), edge('e2', 'c', 'g', '3'), edge('e3', 'g', 'P', '2')]
    const b0 = initSim(blocked)
    const rb = step(blocked, blockedEdges, b0, 1, 2)
    expect(conservation(blocked, blockedEdges, b0, rb).violations).toEqual([])
    // nothing can be delivered, so the Converter must not run at all
    expect(rb.state.values.Q).toBeCloseTo(10, 6)
    expect(rb.state.fired).not.toContain('c')
  })
})

// A small deterministic PRNG for the graph generators (not the engine's RNG):
// a sweep must be reproducible from its seed so a failure names its graph.
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}
const picker = (rnd: () => number) => <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

const ACTS: Act[] = ['automatic', 'passive', 'interactive', 'onStart']
const FLOWS = ['1', '2', '3', '5', 'all']
// `50%` is on every kind of edge: a Gate / Drain reads it as the amount
// `0.5 · S[source]` (SEMANTICS.md §8), and on an edge that touches a
// Converter it is REFUSED — contributes 0 with a run diagnostic (issue #396,
// 2026-10-30), so the sweep also covers a refused edge beside live ones.
const FLOWS_WITH_PCT = [...FLOWS, '50%']

/** sweep graph `g`: 2–4 Pools, maybe a Source, 1–4 routers each with a Pool
 *  input and, for a Gate / Converter, 1–2 outputs into a later router or a Pool */
function sweepGraph(g: number): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const rnd = lcg(g * 7919)
  const pick = picker(rnd)
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
  const add = (s: string, t: string) => {
    if (s === t) return
    edges.push(edge(`e${eid++}`, s, t, pick(FLOWS_WITH_PCT)))
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
  return { nodes, edges }
}

describe('conservation — randomised sweep over activations and router kinds', () => {
  const SWEEP = Array.from({ length: 120 }, (_, i) => sweepGraph(i + 1))
  const routerFedConverters = SWEEP.reduce(
    (n, g) => n + g.nodes.filter((x) => x.data.kind === 'converter' && g.edges.some((e) => e.target === x.id && g.nodes.find((y) => y.id === e.source)?.data.kind !== 'pool')).length,
    0,
  )
  const groups = SWEEP.flatMap((g) => converterGroups(g.nodes, g.edges))
  const count = (cls: string) => groups.filter((g) => g.cls === cls).length
  SWEEP.forEach((g, i) => {
    it(`graph ${i + 1} conserves over 4 steps`, () => {
      holds(g.nodes, g.edges, 4, `graph ${i + 1}`)
    })
  })
  it(`the sweep draws ${routerFedConverters} router-fed Converters in ${count('tree')} tree, ${count('multi')} multi and ${count('split-rejoin')} refused groups; all four checks hold on the trees`, () => {
    expect(routerFedConverters).toBeGreaterThan(0) // the counts are a fact of the sample, reported here
    expect(count('tree')).toBeGreaterThan(0)
  })
})

// ── #471 — the three shapes the sweep never draws, 20 seeds each ──────────

describe('conservation — two outputs into one target (#471 V3, V3g, V3r)', () => {
  for (let s = 1; s <= 20; s++) {
    it(`seed ${s}: two outputs into one capped Pool, by a Converter, a Gate, or a Converter through a Gate, share its room`, () => {
      const rnd = lcg(s * 104729)
      const pick = picker(rnd)
      const mode = pick<Mode>(['pullAny', 'pullAll'])
      const r1 = 1 + Math.floor(rnd() * 5)
      const r2 = 1 + Math.floor(rnd() * 5)
      // the room is less than the two rates together, so the target binds
      const room = Math.max(1, Math.floor(rnd() * (r1 + r2)))
      const cap = room + Math.floor(rnd() * 10)
      const x = pool('x', cap - room, cap)
      const a = pool('a', 10 + Math.floor(rnd() * 20))
      const shape = pick(['converter', 'gate', 'converter-gate'] as const)
      let nodes: LoopNode[]
      let edges: LoopEdge[]
      if (shape === 'converter') {
        nodes = [a, converter('C', 'automatic', mode), x]
        edges = [edge('e1', 'a', 'C', String(r1 + r2)), edge('o1', 'C', 'x', String(r1)), edge('o2', 'C', 'x', String(r2))]
      } else if (shape === 'gate') {
        nodes = [a, gate('g', 'automatic', 'deterministic', mode), x]
        edges = [edge('e1', 'a', 'g', String(r1 + r2)), edge('o1', 'g', 'x', String(r1)), edge('o2', 'g', 'x', String(r2))]
      } else {
        nodes = [a, converter('C', 'automatic', mode), gate('g', 'automatic', 'deterministic', mode), x]
        edges = [edge('e1', 'a', 'C', String(r1 + r2)), edge('o1', 'C', 'g', String(r1)), edge('o2', 'C', 'g', String(r2)), edge('h1', 'g', 'x', 'all')]
      }
      holds(nodes, edges, 3, `${shape} seed ${s}`)
    })
  }
})

describe('conservation — a nearly full capped output (#471 V1)', () => {
  for (let s = 1; s <= 20; s++) {
    it(`seed ${s}: a Pool-fed Converter whose output room is short takes its inputs at the same fraction`, () => {
      const rnd = lcg(s * 15485863)
      const pick = picker(rnd)
      const mode = pick<Mode>(['pullAny', 'pullAll'])
      const nIn = 1 + Math.floor(rnd() * 3)
      const nodes: LoopNode[] = [converter('C', 'automatic', mode)]
      const edges: LoopEdge[] = []
      for (let i = 0; i < nIn; i++) {
        nodes.push(pool(`a${i}`, Math.floor(rnd() * 12)))
        edges.push(edge(`e${i}`, `a${i}`, 'C', String(1 + Math.floor(rnd() * 5))))
      }
      const make = 1 + Math.floor(rnd() * 5)
      const cap = 5 + Math.floor(rnd() * 10)
      // room strictly inside (0, make): the output binds f below 1
      const room = Math.min(cap, Math.max(0.5, Math.round(rnd() * (make - 0.5) * 2) / 2))
      nodes.push(pool('x', cap - room, cap))
      edges.push(edge('o1', 'C', 'x', String(make)))
      if (rnd() < 0.5) {
        nodes.push(pool('y', 0))
        edges.push(edge('o2', 'C', 'y', String(1 + Math.floor(rnd() * 5))))
      }
      holds(nodes, edges, 3, `seed ${s}`)
    })
  }
})

describe('conservation — two routers into one Converter (#471 V4 — a tree group, planned as one since Deploy 2)', () => {
  /** P1 → g1 → C, P2 → g2 → C, C → x: before Deploy 2 each Gate sized its
   *  delivery by the whole of what C accepts, so C received more than its
   *  recipe needed; the joint plan ties the two Gates to C's recipe */
  const diamond = (s: number) => {
    const rnd = lcg(s * 2147483647)
    const need1 = 1 + Math.floor(rnd() * 5)
    const need2 = 1 + Math.floor(rnd() * 5)
    const nodes = [pool('P1', 50), pool('P2', 50), gate('g1'), gate('g2'), converter('C'), pool('x', 0)]
    const edges = [
      edge('e1', 'P1', 'g1', String(need1 + need2)), edge('k1', 'g1', 'C', String(need1)),
      edge('e2', 'P2', 'g2', String(need1 + need2)), edge('k2', 'g2', 'C', String(need2)),
      edge('o1', 'C', 'x', String(need1 + need2)),
    ]
    return { nodes, edges, need: need1 + need2 }
  }
  for (let s = 1; s <= 20; s++) {
    it(`seed ${s}: all four checks hold — the two Gates deliver C's recipe at one f`, () => {
      const { nodes, edges } = diamond(s)
      expect(holds(nodes, edges, 2, `seed ${s}`)).toBe(0) // a tree group: nothing skipped
    })
  }
  it('a Converter fed by two routers receives no more than its recipe uses (#471 V4 — the joint plan across routers)', () => {
    for (let s = 1; s <= 20; s++) {
      const { nodes, edges, need } = diamond(s)
      const s0 = initSim(nodes)
      const r = step(nodes, edges, s0, 3, 2)
      const intoC = r.report.events.filter((e) => e.to === 'C').reduce((a, e) => a + e.amount, 0)
      const outC = r.report.events.filter((e) => e.from === 'C').reduce((a, e) => a + e.amount, 0)
      // at the output's f, the recipe used f · need; anything above it vanished
      expect(intoC - (outC / need) * need, `seed ${s}`).toBeLessThan(1e-6)
    }
  })
})
