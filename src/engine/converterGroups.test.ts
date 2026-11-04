import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { deserialize } from '../model/serialize'
import { converterGroups, refusedGroups } from './converterGroups'

// Issue #471, Deploy 2 — the classification of Converter groups by structure
// (SEMANTICS.md §6 erratum, part 2): tree / split-rejoin / multi, over the
// full graph (the refusal before a run) and over a live subset (what `step`
// plans). The shapes are the design's G1–G4 and G7 (version-and-cr2-design,
// §2.3) plus the bundled documents, which must all be trees.

const P = { x: 0, y: 0 }
const pool = (id: string): LoopNode => ({ id, type: 'pool', position: P, data: { kind: 'pool', label: id, activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } })
const conv = (id: string): LoopNode => ({ id, type: 'converter', position: P, data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' } })
const gate = (id: string): LoopNode => ({ id, type: 'gate', position: P, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } })
const res = (id: string, source: string, target: string, flow = '1'): LoopEdge => ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

describe('converterGroups — the design shapes', () => {
  it('G1: Gate → Converter beside a Pool input is one tree group', () => {
    const nodes = [pool('a'), pool('b'), gate('g'), conv('C'), pool('x')]
    const edges = [res('e1', 'a', 'g'), res('g1', 'g', 'C'), res('e2', 'b', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, edges)).toEqual([{ members: ['C', 'g'], cls: 'tree', split: null, join: null, multiGates: [], hasConverter: true }])
    expect(refusedGroups(nodes, edges)).toEqual([])
  })

  // #476 — the multi-supply plan applies to every Gate with two supplies, with or without a Converter behind it
  it('a Gate with two supplies and no Converter behind it is a multi group of Gates only (planned, never refused)', () => {
    const nodes = [pool('a'), gate('g0'), pool('b'), gate('g1'), gate('g2'), pool('y')]
    const oneRouterOwnPool = [res('e1', 'a', 'g0'), res('g01', 'g0', 'g1'), res('e2', 'b', 'g1'), res('o1', 'g1', 'y')]
    expect(converterGroups(nodes, oneRouterOwnPool)).toEqual([{ members: ['g0', 'g1'], cls: 'multi', split: null, join: null, multiGates: ['g1'], hasConverter: false }])
    const twoRouters = [res('e1', 'a', 'g0'), res('g01', 'g0', 'g1'), res('e2', 'b', 'g2'), res('g21', 'g2', 'g1'), res('o1', 'g1', 'y')]
    expect(converterGroups(nodes, twoRouters)[0]).toMatchObject({ members: ['g0', 'g1', 'g2'], cls: 'multi', multiGates: ['g1'], hasConverter: false })
    expect(refusedGroups(nodes, twoRouters)).toEqual([])
    // a split of Gates that meets again at a Gate is not refused (a Gate merges what arrives); `step` plans it as one group (#471, erratum part 4)
    const gateDiamond = [res('e1', 'a', 'g0'), res('g01', 'g0', 'g1'), res('g02', 'g0', 'g2'), res('g21', 'g2', 'g1'), res('o1', 'g1', 'y')]
    expect(converterGroups(nodes, gateDiamond)[0]).toMatchObject({ cls: 'split-rejoin', split: 'g0', join: 'g1', hasConverter: false })
    expect(refusedGroups(nodes, gateDiamond)).toEqual([])
  })

  it('two multi-supply Gates in one group — meeting at one Converter, or in a chain — are one multi group with both Gates listed', () => {
    const nodes = [pool('a'), pool('b'), pool('p'), pool('r'), gate('g0'), gate('g1'), gate('h0'), gate('h1'), conv('C'), pool('x')]
    const joint = [
      res('e1', 'a', 'g0'), res('g01', 'g0', 'g1'), res('e2', 'p', 'g1'),
      res('e3', 'b', 'h0'), res('h01', 'h0', 'h1'), res('e4', 'r', 'h1'),
      res('k1', 'g1', 'C'), res('k2', 'h1', 'C'), res('o1', 'C', 'x'),
    ]
    expect(converterGroups(nodes, joint)[0]).toMatchObject({ cls: 'multi', multiGates: ['g1', 'h1'], hasConverter: true })
    expect(refusedGroups(nodes, joint)).toEqual([])
    const chain = [
      res('e1', 'a', 'g0'), res('g01', 'g0', 'g1'), res('e2', 'p', 'g1'),
      res('g1h', 'g1', 'h1'), res('e4', 'r', 'h1'),
      res('k2', 'h1', 'C'), res('o1', 'C', 'x'),
    ]
    expect(converterGroups(nodes, chain)[0]).toMatchObject({ cls: 'multi', multiGates: ['g1', 'h1'], hasConverter: true })
  })

  it('G2: one Pool feeding the Gate and the Converter is still a tree (a Pool is not a member)', () => {
    const nodes = [pool('b'), gate('g'), conv('C'), pool('x')]
    const edges = [res('e1', 'b', 'g'), res('g1', 'g', 'C'), res('e2', 'b', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, edges).map((g) => g.cls)).toEqual(['tree'])
  })

  it('G3: a Gate splitting into two Converters is a tree', () => {
    const nodes = [pool('a'), pool('b1'), pool('b2'), gate('g'), conv('C1'), conv('C2'), pool('x1'), pool('x2')]
    const edges = [res('e1', 'a', 'g'), res('g1', 'g', 'C1'), res('g2', 'g', 'C2'), res('f1', 'b1', 'C1'), res('f2', 'b2', 'C2'), res('o1', 'C1', 'x1'), res('o2', 'C2', 'x2')]
    const [g] = converterGroups(nodes, edges)
    expect(g.cls).toBe('tree')
    expect(g.members).toEqual(['C1', 'C2', 'g'])
  })

  it('two Gates into one Converter (the diamond) is a tree', () => {
    const nodes = [pool('P1'), pool('P2'), gate('g1'), gate('g2'), conv('C'), pool('x')]
    const edges = [res('e1', 'P1', 'g1'), res('k1', 'g1', 'C'), res('e2', 'P2', 'g2'), res('k2', 'g2', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, edges).map((g) => g.cls)).toEqual(['tree'])
  })

  it('G4: a split that rejoins names the split and the first join', () => {
    const nodes = [pool('a'), gate('g0'), gate('g1'), gate('g2'), conv('C'), pool('x'), pool('y')]
    const edges = [res('e0', 'a', 'g0'), res('h1', 'g0', 'g1'), res('h2', 'g0', 'g2'), res('k1', 'g1', 'C'), res('k2', 'g1', 'y'), res('k3', 'g2', 'C'), res('o1', 'C', 'x')]
    const [g] = converterGroups(nodes, edges)
    expect(g).toMatchObject({ cls: 'split-rejoin', split: 'g0', join: 'C', members: ['C', 'g0', 'g1', 'g2'] })
    expect(refusedGroups(nodes, edges)).toHaveLength(1)
    // agreeing fractions (g1's second branch removed) — the rule is on structure
    expect(converterGroups(nodes, edges.filter((e) => e.id !== 'k2'))[0].cls).toBe('split-rejoin')
  })

  it('connections between the same two routers count once (rev 3): two from one Gate into one Converter, or into one Gate, are one path', () => {
    const nodes = [pool('a'), gate('g'), gate('h'), conv('C'), pool('x')]
    const twoIntoC = [res('e1', 'a', 'g'), res('k1', 'g', 'C'), res('k2', 'g', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, twoIntoC)[0]).toMatchObject({ cls: 'tree', split: null, join: null })
    expect(refusedGroups(nodes, twoIntoC)).toEqual([])
    const twoIntoH = [res('e1', 'a', 'g'), res('k1', 'g', 'h'), res('k2', 'g', 'h'), res('m1', 'h', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, twoIntoH)[0].cls).toBe('tree')
    // a second connection that reaches the Converter THROUGH another router is still a rejoin
    const viaH = [res('e1', 'a', 'g'), res('k1', 'g', 'C'), res('k2', 'g', 'h'), res('m1', 'h', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, viaH)[0]).toMatchObject({ cls: 'split-rejoin', split: 'g', join: 'C' })
  })

  it('G7: a Gate fed by a router AND its own Pool is multi, as is a Gate fed by two routers', () => {
    const nodes = [pool('a'), pool('p'), conv('B'), gate('g'), conv('C'), pool('q'), pool('x')]
    const edges = [res('e0', 'p', 'B'), res('b1', 'B', 'g'), res('e1', 'a', 'g'), res('k1', 'g', 'C'), res('e2', 'q', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes, edges)[0]).toMatchObject({ cls: 'multi', multiGates: ['g'] })
    const nodes2 = [pool('p'), pool('r'), conv('B'), conv('D'), gate('g'), conv('C'), pool('x')]
    const edges2 = [res('e0', 'p', 'B'), res('e1', 'r', 'D'), res('b1', 'B', 'g'), res('d1', 'D', 'g'), res('k1', 'g', 'C'), res('o1', 'C', 'x')]
    expect(converterGroups(nodes2, edges2)[0]).toMatchObject({ cls: 'multi', multiGates: ['g'] })
    expect(refusedGroups(nodes2, edges2)).toEqual([]) // multi is not refused (unresolved, #471 stays open)
  })

  it('no group without a router-fed Converter: Gate → Gate chains, Converter → Gate, Pool-fed Converters', () => {
    const nodes = [pool('a'), gate('g'), gate('h'), conv('C'), pool('x')]
    expect(converterGroups(nodes, [res('e1', 'a', 'g'), res('k1', 'g', 'h'), res('h1', 'h', 'x')])).toEqual([])
    expect(converterGroups(nodes, [res('e1', 'a', 'C'), res('k1', 'C', 'g'), res('h1', 'g', 'x')])).toEqual([])
  })

  it('a live filter narrows the group: the subset of a tree is a tree, and a dropped connection can end the group', () => {
    const nodes = [pool('a'), pool('b1'), pool('b2'), gate('g'), conv('C1'), conv('C2'), pool('x1'), pool('x2')]
    const edges = [res('e1', 'a', 'g'), res('g1', 'g', 'C1'), res('g2', 'g', 'C2'), res('f1', 'b1', 'C1'), res('f2', 'b2', 'C2'), res('o1', 'C1', 'x1'), res('o2', 'C2', 'x2')]
    expect(converterGroups(nodes, edges, (e) => e.id !== 'g2')[0]).toMatchObject({ cls: 'tree', members: ['C1', 'g'] })
    expect(converterGroups(nodes, edges, (e) => e.id !== 'g1' && e.id !== 'g2')).toEqual([])
  })

  it('state connections and connections to model nodes are not part of a group', () => {
    const nodes = [pool('a'), gate('g'), conv('C'), pool('x')]
    const edges = [res('e1', 'a', 'g'), res('g1', 'g', 'C'), res('o1', 'C', 'x'), { ...res('s1', 'C', 'g'), data: { kind: 'state', mode: 'trigger' } } as unknown as LoopEdge]
    expect(converterGroups(nodes, edges)[0]).toMatchObject({ cls: 'tree', members: ['C', 'g'] })
  })
})

const EXAMPLE_TEXT = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('converterGroups — the bundled documents', () => {
  const files = Object.keys(EXAMPLE_TEXT).filter((f) => !f.endsWith('.expected.json')).sort()
  it.each(files)('%s: every group with a Converter is a tree (nothing bundled is refused)', (f: string) => {
    let doc: ReturnType<typeof deserialize>
    try {
      doc = deserialize(EXAMPLE_TEXT[f])
    } catch {
      return // not a graph document
    }
    const groups = converterGroups(doc.nodes, doc.edges).filter((g) => g.hasConverter)
    expect(groups.map((g) => g.cls)).toEqual(groups.map(() => 'tree'))
    expect(refusedGroups(doc.nodes, doc.edges)).toEqual([])
  })
  it('the documents with Converter groups are the three known ones, all trees; the Gate-only multi groups are the gacha merges (#476)', () => {
    const groupsOf = (f: string) => {
      try {
        const doc = deserialize(EXAMPLE_TEXT[f])
        return converterGroups(doc.nodes, doc.edges)
      } catch {
        return []
      }
    }
    const name = (f: string) => f.split('/').pop()
    expect(files.filter((f) => groupsOf(f).some((g) => g.hasConverter)).map(name)).toEqual(['deadlock.json', 'equilibrium.json', 'mmo-progression.json'])
    const gateOnly = files.filter((f) => groupsOf(f).some((g) => !g.hasConverter))
    expect(gateOnly.map(name)).toEqual(['gacha-banner-zones.json', 'gacha-pickup.json', 'gacha-standard.json'])
  })
})
