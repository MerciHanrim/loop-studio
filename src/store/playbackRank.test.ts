import { describe, expect, it } from 'vitest'
import equilibriumDoc from '../../examples/equilibrium.json'
import { initSim, step } from '../engine'
import type { FlowEvent } from '../engine'
import { normalizeGraph } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { computeStagger, STAGGER_MAX_BUCKETS, STAGGER_SPAN } from './playbackRank'

// docs/simulation-playback-ordering.md §PBO1 / §PBO2 — the ordered-cascade
// schedule is a pure function of the step-start graph + `report.events`.

const N = (id: string, kind: LoopNode['data']['kind']): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id } }) as unknown as LoopNode
const E = (id: string, source: string, target: string): LoopEdge =>
  ({ id, source, target, type: 'loop', data: { kind: 'resource', flow: '1' } }) as unknown as LoopEdge
const EV = (edgeId: string, from: string, to: string, amount = 1): FlowEvent => ({
  edgeId,
  from,
  to,
  amount,
})

describe('computeStagger — ordering source', () => {
  it('Balanced production line: onsets cascade supply → split → process → finished → shipment; the scrap branch shares the split onset', () => {
    const { nodes, edges } = normalizeGraph(
      equilibriumDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] },
    )
    // run to steady state so every stage carries flow (incl. prod → consume)
    let st = initSim(nodes)
    let events: FlowEvent[] = []
    for (let i = 0; i < 8; i++) {
      const r = step(nodes, edges, st, 1)
      st = r.state
      events = [...r.report.events]
    }
    // sanity: the steady step touches all six edges
    expect(new Set(events.map((e) => e.edgeId))).toEqual(
      new Set(['tpl-e1', 'tpl-e2', 'tpl-e3', 'tpl-e4', 'tpl-e5', 'tpl-e6']),
    )

    const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, events)

    // §PBO11 order — non-decreasing along supply → split → process → finished → shipment
    expect(onsetByEdge['tpl-e1']).toBe(0) // supply (Phase 1)
    expect(onsetByEdge['tpl-e2']).toBeGreaterThan(onsetByEdge['tpl-e1'])
    expect(onsetByEdge['tpl-e3']).toBe(onsetByEdge['tpl-e2']) // split input + its process branch
    expect(onsetByEdge['tpl-e4']).toBe(onsetByEdge['tpl-e3']) // scrap branch departs WITH process
    expect(onsetByEdge['tpl-e5']).toBeGreaterThan(onsetByEdge['tpl-e3']) // converter → finished
    expect(onsetByEdge['tpl-e6']).toBeGreaterThan(onsetByEdge['tpl-e5']) // finished → shipment

    // bounded window
    for (const v of Object.values(onsetByEdge)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(STAGGER_SPAN)
    }
    expect(bucketCount).toBe(4) // P1 · {split+branches} · {converter} · {shipment}
  })

  it('a graph with a single active event → one bucket, onset 0', () => {
    const nodes = [N('src', 'source'), N('p', 'pool')]
    const edges = [E('e', 'src', 'p')]
    const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, [EV('e', 'src', 'p')])
    expect(bucketCount).toBe(1)
    expect(onsetByEdge['e']).toBe(0)
  })

  it('a one-chain graph with multiple processing stages still gets multiple buckets', () => {
    const nodes = [
      N('src', 'source'),
      N('p1', 'pool'),
      N('g', 'gate'),
      N('p2', 'pool'),
      N('c', 'converter'),
      N('p3', 'pool'),
      N('d', 'drain'),
    ]
    const edges = [
      E('e1', 'src', 'p1'),
      E('e2', 'p1', 'g'),
      E('e3', 'g', 'p2'),
      E('e4', 'p2', 'c'),
      E('e5', 'c', 'p3'),
      E('e6', 'p3', 'd'),
    ]
    const events = [
      EV('e1', 'src', 'p1'),
      EV('e2', 'p1', 'g'),
      EV('e3', 'g', 'p2'),
      EV('e4', 'p2', 'c'),
      EV('e5', 'c', 'p3'),
      EV('e6', 'p3', 'd'),
    ]
    const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, events)
    expect(bucketCount).toBe(4) // P1 · g · c · d
    expect(onsetByEdge['e1']).toBe(0)
    expect(onsetByEdge['e2']).toBeGreaterThan(0) // gate
    expect(onsetByEdge['e4']).toBeGreaterThan(onsetByEdge['e2']) // converter deeper
    expect(onsetByEdge['e6']).toBeGreaterThan(onsetByEdge['e4']) // drain deepest
    expect(onsetByEdge['e6']).toBe(STAGGER_SPAN)
  })
})

describe('computeStagger — SCC handling (§PBO1 / PBO-D3)', () => {
  // a feedback loop THROUGH pools: p1 → g → p2 → c → p1
  const nodes = [
    N('src', 'source'),
    N('p1', 'pool'),
    N('g', 'gate'),
    N('p2', 'pool'),
    N('c', 'converter'),
    N('d', 'drain'),
  ]
  const edges = [
    E('e_src', 'src', 'p1'),
    E('e_p1g', 'p1', 'g'),
    E('e_gp2', 'g', 'p2'),
    E('e_p2c', 'p2', 'c'),
    E('e_cp1', 'c', 'p1'), // closes the cycle
    E('e_gd', 'g', 'd'),
  ]
  const events = [
    EV('e_src', 'src', 'p1', 5),
    EV('e_p1g', 'p1', 'g', 3),
    EV('e_gp2', 'g', 'p2', 2),
    EV('e_p2c', 'p2', 'c', 2),
    EV('e_cp1', 'c', 'p1', 2),
    EV('e_gd', 'g', 'd', 1),
  ]

  it('every event whose routing node is in one SCC shares an onset; no invented intra-SCC order', () => {
    const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, events)
    const sccOnset = onsetByEdge['e_p1g']
    // all five cycle-touching edges (routing node g or c, both in the SCC)
    for (const id of ['e_p1g', 'e_gp2', 'e_p2c', 'e_cp1', 'e_gd'])
      expect(onsetByEdge[id]).toBe(sccOnset)
    expect(onsetByEdge['e_src']).toBe(0) // Phase 1
    expect(sccOnset).toBe(STAGGER_SPAN) // B = 2 → the SCC bucket is the last
    expect(bucketCount).toBe(2)
  })

  it('terminates and computes once for a cyclic graph (PBO-INV-7)', () => {
    const w = globalThis as unknown as { __staggerComputes?: number }
    const before = w.__staggerComputes ?? 0
    expect(() => computeStagger(nodes, edges, events)).not.toThrow()
    expect((w.__staggerComputes ?? 0) - before).toBe(1)
  })
})

describe('computeStagger — longest-predecessor depth, not shortest (§PBO1)', () => {
  it('a downstream node reached by both a short and a long path ranks after the whole long path', () => {
    // src → a → g → pm → c → pe → d   (long)   AND   a → d   (short-circuit)
    const nodes = [
      N('src', 'source'),
      N('a', 'pool'),
      N('g', 'gate'),
      N('pm', 'pool'),
      N('c', 'converter'),
      N('pe', 'pool'),
      N('d', 'drain'),
    ]
    const edges = [
      E('e_sa', 'src', 'a'),
      E('e_ag', 'a', 'g'),
      E('e_gpm', 'g', 'pm'),
      E('e_pmc', 'pm', 'c'),
      E('e_cpe', 'c', 'pe'),
      E('e_ped', 'pe', 'd'),
      E('e_ad', 'a', 'd'), // short-circuit straight to the drain
    ]
    const events = [
      EV('e_sa', 'src', 'a'),
      EV('e_ag', 'a', 'g'),
      EV('e_gpm', 'g', 'pm'),
      EV('e_pmc', 'pm', 'c'),
      EV('e_cpe', 'c', 'pe'),
      EV('e_ped', 'pe', 'd'),
      EV('e_ad', 'a', 'd'),
    ]
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    // gate < converter < drain, and BOTH drain edges share the deepest onset
    expect(onsetByEdge['e_ag']).toBeGreaterThan(0)
    expect(onsetByEdge['e_pmc']).toBeGreaterThan(onsetByEdge['e_ag'])
    expect(onsetByEdge['e_ped']).toBeGreaterThan(onsetByEdge['e_pmc'])
    expect(onsetByEdge['e_ad']).toBe(onsetByEdge['e_ped']) // short path does NOT rank the drain early
  })
})

describe('computeStagger — per-edge onset stability (§PBO2)', () => {
  it('when an edge carries several events the FIRST one fixes its onset', () => {
    // an edge always has one (from, to), so repeated events share a routing
    // node — the first-wins guard is defensive; assert it holds regardless.
    const nodes = [N('src', 'source'), N('p', 'pool'), N('g', 'gate'), N('d', 'drain')]
    const edges = [E('e1', 'src', 'p'), E('e2', 'p', 'g'), E('e3', 'g', 'd')]
    const events = [
      EV('e1', 'src', 'p'),
      EV('e2', 'p', 'g', 2),
      EV('e2', 'p', 'g', 1), // second transfer on the same edge
      EV('e3', 'g', 'd'),
    ]
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    expect(Object.keys(onsetByEdge).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(onsetByEdge['e2']).toBeGreaterThan(0)
    // e3 is a push OUT of the gate (routing node = `from` = g, PBO-D2), so it
    // shares the gate's bucket with e2's pull INTO the gate — one routing subject
    expect(onsetByEdge['e3']).toBe(onsetByEdge['e2'])
  })
})

describe('computeStagger — degenerate input', () => {
  it('no events → empty schedule', () => {
    expect(computeStagger([N('src', 'source')], [], [])).toEqual({
      onsetByEdge: {},
      bucketCount: 0,
    })
  })

  it('folds ranks past the cap into the last bucket', () => {
    // a straight chain of 10 gates → 11 distinct groups, clamped to the cap
    const nodes: LoopNode[] = [N('src', 'source'), N('p0', 'pool')]
    const edges: LoopEdge[] = [E('e0', 'src', 'p0')]
    const events: FlowEvent[] = [EV('e0', 'src', 'p0')]
    let prev = 'p0'
    for (let i = 1; i <= 10; i++) {
      const g = `g${i}`
      const p = `p${i}`
      nodes.push(N(g, 'gate'), N(p, 'pool'))
      edges.push(E(`eg${i}`, prev, g), E(`ep${i}`, g, p))
      events.push(EV(`eg${i}`, prev, g), EV(`ep${i}`, g, p))
      prev = p
    }
    const { onsetByEdge, bucketCount } = computeStagger(nodes, edges, events)
    expect(bucketCount).toBe(STAGGER_MAX_BUCKETS)
    expect(Math.max(...Object.values(onsetByEdge))).toBe(STAGGER_SPAN)
    // the deep gates all collapse onto the final onset
    expect(onsetByEdge['eg10']).toBe(STAGGER_SPAN)
    expect(onsetByEdge['eg9']).toBe(STAGGER_SPAN)
  })
})
