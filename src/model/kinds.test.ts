import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { kindFindings, kindFindingEdgeId, kindFindingNodeId, readKinds, refusingKindFindings, resolveKinds } from './kinds'

// loop-model/3 (#471, kinds-units-design.md rev 3 §6) — the kinds table read,
// the K1 resolution and the D1 findings, per connection and per Pool. The
// engine-side rows (what runs, what is refused, the boundary outflow) are in
// src/engine/kinds.test.ts.

const XY = { x: 0, y: 0 }
const pool = (id: string, resourceType?: string): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...(resourceType ? { resourceType } : {}) } as LoopNode['data'],
})
const node = (id: string, kind: 'source' | 'drain' | 'end' | 'gate' | 'converter'): LoopNode => ({
  id, type: kind, position: XY,
  data: { kind, label: id, activation: kind === 'source' ? 'automatic' : 'passive', mode: kind === 'source' ? 'pushAny' : 'pullAny' } as unknown as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow = '1', resourceType?: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow, ...(resourceType ? { resourceType } : {}) } as LoopEdge['data'],
})
const WATER = [{ name: 'water', conserved: true }]
const BOTH = [{ name: 'water', conserved: true }, { name: 'power', conserved: false }]

describe('readKinds — the §M3-1 defensive read', () => {
  it('keeps well-formed entries in file order, normalises names, dedupes, drops the rest', () => {
    expect(readKinds(undefined)).toEqual([])
    expect(readKinds({})).toEqual([])
    expect(
      readKinds([
        { name: ' water ', conserved: true, baseUnit: ' m³ ' },
        { name: 'power', conserved: 'yes', baseUnit: 7 },
        { name: 'water', conserved: false },
        { name: '', conserved: true },
        'water',
        { name: 'heat', conserved: true, baseUnit: 'x'.repeat(33) },
      ]),
    ).toEqual([
      { name: 'water', conserved: true, baseUnit: 'm³' },
      { name: 'power', conserved: false },
      { name: 'heat', conserved: true },
    ])
  })
})

describe('resolveKinds — K1 (design §3.1)', () => {
  it('a Pool end decides; an annotation on a Pool-less line decides; a Gate propagates one kind to a fixpoint through a chain', () => {
    const nodes = [pool('w', 'water'), node('src', 'source'), node('g1', 'gate'), node('g2', 'gate'), node('g3', 'gate'), node('d', 'drain'), node('cv', 'converter'), node('evap', 'drain')]
    const edges = [
      res('e1', 'src', 'g1'), // Source → Gate: by propagation
      res('e2', 'g1', 'w'), // Gate → Pool: by the Pool
      res('e3', 'w', 'g2'),
      res('e4', 'g2', 'g3'), // Gate → Gate: by propagation
      res('e5', 'g3', 'd'), // Gate → Drain: by propagation
      res('e6', 'w', 'cv', '100'),
      res('e7', 'cv', 'evap', '2', 'water'), // Converter → Drain: by annotation
      res('e8', 'cv', 'd', '98'), // Converter → Drain, nothing: undetermined
    ]
    const r = resolveKinds(nodes, edges)
    expect([...r.edgeKind.entries()]).toEqual([
      ['e1', 'water'], ['e2', 'water'], ['e3', 'water'], ['e4', 'water'], ['e5', 'water'], ['e6', 'water'], ['e7', 'water'], ['e8', null],
    ])
    expect(r.how.get('e1')).toBe('gate')
    expect(r.how.get('e2')).toBe('pool')
    expect(r.how.get('e4')).toBe('gate')
    expect(r.how.get('e7')).toBe('annotation')
    expect(r.how.get('e8')).toBe('none')
    expect(r.conflicts).toEqual([])
    expect(r.gateKinds.get('g3')).toEqual(['water'])
  })

  it('conflicts: two Pool ends, an annotation against its Pool, a Gate between kinds; a mixing Gate propagates nothing', () => {
    const nodes = [pool('w', 'water'), pool('p', 'power'), pool('u'), node('g', 'gate'), node('d', 'drain')]
    const edges = [res('a', 'w', 'p'), res('b', 'w', 'u', '1', 'Energy'), res('c', 'w', 'g'), res('d', 'g', 'p'), res('e', 'g', 'd')]
    const r = resolveKinds(nodes, edges)
    expect(r.conflicts).toEqual([
      { kind: 'poolEnds', edgeId: 'a', kinds: ['water', 'power'] },
      { kind: 'annotation', edgeId: 'b', nodeId: 'w', edgeKind: 'Energy', poolKind: 'water' },
      { kind: 'poolNoKind', edgeId: 'b', nodeId: 'u', edgeKind: 'water' }, // review 3: water into a Pool that declares none
      { kind: 'gateMixes', nodeId: 'g', kinds: ['power', 'water'] },
    ])
    expect(r.edgeKind.get('b')).toBe('water') // the Pool wins over the note
    expect(r.edgeKind.get('e')).toBeNull() // the mixing Gate gave the Drain line nothing
  })

  it('review 1 — a Pool with no kind leaves its line undetermined even when the line is annotated: the annotation is read on Pool-less lines only', () => {
    const nodes = [pool('u'), node('cv', 'converter'), pool('w', 'water'), node('d', 'drain')]
    const edges = [res('a', 'u', 'cv', '1', 'water'), res('b', 'cv', 'w', '1'), res('c', 'cv', 'd', '1', 'water')]
    const r = resolveKinds(nodes, edges)
    expect(r.edgeKind.get('a')).toBeNull() // a Pool end, no kind: the annotation does not count
    expect(r.how.get('a')).toBe('none')
    expect(r.edgeKind.get('c')).toBe('water') // no Pool end: the annotation counts
    expect(r.how.get('c')).toBe('annotation')
    expect(r.conflicts).toEqual([])
    // and so the Converter's water balance is not computable on that line
    expect(kindFindings(nodes, edges, WATER, 3)).toEqual([
      { cls: 'notComputable', converterId: 'cv', edgeId: 'a', reason: 'noKind', rate: '1', kind: null, refuses: true },
    ])
  })

  it('review 2 — a Gate chain fed two kinds from its ends: the contested line stays undetermined and both Gates mix, whichever Gate id sorts first', () => {
    // w(water) → L → m → R → p(power), each Gate also feeding a Drain line
    const mk = (L: string, R: string) => {
      const nodes = [pool('w', 'water'), pool('p', 'power'), node(L, 'gate'), node(R, 'gate'), node('d', 'drain')]
      const edges = [res('e_w', 'w', L), res('m', L, R), res('e_p', R, 'p'), res('x', L, 'd'), res('y', R, 'd')]
      return resolveKinds(nodes, edges)
    }
    for (const [L, R] of [['a', 'z'], ['z', 'a']] as const) {
      const r = mk(L, R)
      expect(r.edgeKind.get('m')).toBeNull()
      expect(r.how.get('m')).toBe('none')
      expect(r.edgeKind.get('x')).toBeNull() // a mixing Gate propagates nothing
      expect(r.edgeKind.get('y')).toBeNull()
      expect(r.conflicts).toEqual([
        { kind: 'gateMixes', nodeId: 'a', kinds: ['power', 'water'] },
        { kind: 'gateMixes', nodeId: 'z', kinds: ['power', 'water'] },
      ])
    }
    // with a Gate in the middle the two kinds meet there: the outer lines are determined, only the middle Gate mixes
    const mk3 = (L: string, M: string, R: string) => {
      const nodes = [pool('w', 'water'), pool('p', 'power'), node(L, 'gate'), node(M, 'gate'), node(R, 'gate')]
      const edges = [res('e_w', 'w', L), res('m1', L, M), res('m2', M, R), res('e_p', R, 'p')]
      return resolveKinds(nodes, edges)
    }
    for (const [L, M, R] of [['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'c', 'a']] as const) {
      const r = mk3(L, M, R)
      expect(r.edgeKind.get('m1')).toBe('water')
      expect(r.edgeKind.get('m2')).toBe('power')
      expect(r.conflicts).toEqual([{ kind: 'gateMixes', nodeId: M, kinds: ['power', 'water'] }])
    }
  })

  it('review 3 — a determined kind at a Pool that declares none is a conflict: through a Gate, directly from a typed Pool, and out of an untyped Pool; it names the Pool', () => {
    // w(water) → g → u, and the Gate's Drain line; w → u2 directly; u3 → w directly
    const nodes = [pool('w', 'water'), node('g', 'gate'), pool('u'), pool('u2'), pool('u3'), node('d', 'drain')]
    const edges = [res('a', 'w', 'g'), res('b', 'g', 'u'), res('c', 'g', 'd'), res('e', 'w', 'u2'), res('f', 'u3', 'w')]
    const r = resolveKinds(nodes, edges)
    expect(r.edgeKind.get('b')).toBe('water') // rule 3 reached it: the Gate carries water on every line
    expect(r.how.get('b')).toBe('gate')
    expect(r.edgeKind.get('e')).toBe('water') // rule 1, from the typed end
    expect(r.conflicts).toEqual([
      { kind: 'poolNoKind', edgeId: 'b', nodeId: 'u', edgeKind: 'water' },
      { kind: 'poolNoKind', edgeId: 'e', nodeId: 'u2', edgeKind: 'water' },
      { kind: 'poolNoKind', edgeId: 'f', nodeId: 'u3', edgeKind: 'water' },
    ])
    const f = kindFindings(nodes, edges, WATER, 3)
    expect(f.map((x) => x.refuses)).toEqual([true, true, true])
    expect(kindFindingNodeId(f[0])).toBe('u') // the Pool to give a kind
    expect(kindFindingEdgeId(f[0])).toBe('b')
    expect(kindFindings(nodes, edges, [{ name: 'water', conserved: false }], 3).map((x) => x.refuses)).toEqual([false, false, false])
    // two untyped Pools through a Gate, or an untyped Pool on an undetermined line, conflict nowhere (nothing determined reaches them)
    expect(resolveKinds([pool('p'), node('g', 'gate'), pool('q'), node('cv', 'converter')], [res('x', 'p', 'g'), res('y', 'g', 'q'), res('z', 'q', 'cv')]).conflicts).toEqual([])
  })

  it('an untyped document resolves nothing and conflicts nowhere', () => {
    const nodes = [pool('a'), pool('b'), node('g', 'gate')]
    const r = resolveKinds(nodes, [res('x', 'a', 'g'), res('y', 'g', 'b')])
    expect([...r.edgeKind.values()]).toEqual([null, null])
    expect(r.conflicts).toEqual([])
  })
})

// the desalination plant of the verification (rev 3): sea → RO ← power; RO → permeate + brine
const plant = (feedFlow: string, permeate: string, brine: string, extra: LoopEdge[] = []) => {
  const nodes = [pool('sea', 'water'), pool('power', 'power'), node('ro', 'converter'), pool('permeate', 'water'), pool('brine', 'water'), node('evap', 'drain')]
  const edges = [res('e_feed_ro', 'sea', 'ro', feedFlow), res('e_power_ro', 'power', 'ro', '30'), res('e_ro_perm', 'ro', 'permeate', permeate), res('e_ro_brine', 'ro', 'brine', brine), ...extra]
  return { nodes, edges }
}

describe('kindFindings — C1 + D1 (design §6)', () => {
  it('row 1 — A: water 100 + power 30 → 45 + 55, water conserved, power not: no finding', () => {
    const { nodes, edges } = plant('100', '45', '55')
    expect(kindFindings(nodes, edges, BOTH, 3)).toEqual([])
  })

  it('row 2 — C: water 100 → 50 + 55: broken, +5, refuses', () => {
    const { nodes, edges } = plant('100', '50', '55')
    expect(kindFindings(nodes, edges, WATER, 3)).toEqual([{ cls: 'broken', converterId: 'ro', kind: 'water', inRate: 100, outRate: 105, refuses: true }])
  })

  it('row 3 — R6: `all` on the feed line: ONE not-computable finding on that line, no derived 100 ≠ 0', () => {
    const { nodes, edges } = plant('all', '45', '55')
    const f = kindFindings(nodes, edges, WATER, 3)
    expect(f).toEqual([{ cls: 'notComputable', converterId: 'ro', edgeId: 'e_feed_ro', reason: 'rate', rate: 'all', kind: 'water', refuses: true }])
    expect(f.some((x) => x.cls === 'broken')).toBe(false)
    expect(kindFindingEdgeId(f[0])).toBe('e_feed_ro')
    expect(kindFindingNodeId(f[0])).toBe('ro')
  })

  it('rows 5 and 6 — an evaporation line counts as an output when it has a kind; without one the balance is not computable', () => {
    const typed = plant('100', '45', '53', [res('e_ro_evap', 'ro', 'evap', '2', 'water')])
    expect(kindFindings(typed.nodes, typed.edges, WATER, 3)).toEqual([])
    const untyped = plant('100', '45', '53', [res('e_ro_evap', 'ro', 'evap', '2')])
    expect(kindFindings(untyped.nodes, untyped.edges, WATER, 3)).toEqual([
      { cls: 'notComputable', converterId: 'ro', edgeId: 'e_ro_evap', reason: 'noKind', rate: '2', kind: null, refuses: true },
    ])
  })

  it('row 7 — energy declared conserved, a pump with 30 in and nothing out: broken', () => {
    const nodes = [pool('grid', 'energy'), node('pump', 'converter'), pool('w', 'water'), pool('w2', 'water')]
    const edges = [res('a', 'grid', 'pump', '30'), res('b', 'w', 'pump', '10'), res('c', 'pump', 'w2', '10')]
    expect(kindFindings(nodes, edges, [{ name: 'energy', conserved: true }, { name: 'water', conserved: true }], 3)).toEqual([
      { cls: 'broken', converterId: 'pump', kind: 'energy', inRate: 30, outRate: 0, refuses: true },
    ])
  })

  it('row 10 — no kinds table: no refusal; only a non-numeric Converter rate stays a (non-refusing) finding', () => {
    const { nodes, edges } = plant('100', '50', '55')
    expect(kindFindings(nodes, edges, [], 3)).toEqual([])
    expect(refusingKindFindings(nodes, edges, [], 3)).toEqual([])
    const r6 = plant('all', '45', '55')
    expect(kindFindings(r6.nodes, r6.edges, [], 3)).toEqual([{ cls: 'notComputable', converterId: 'ro', edgeId: 'e_feed_ro', reason: 'rate', rate: 'all', kind: 'water', refuses: false }])
    expect(refusingKindFindings(r6.nodes, r6.edges, [], 3)).toEqual([])
  })

  it('rows 11 and 12 — an annotation against its Pool refuses when the kind is conserved, is a finding only when it is not', () => {
    const nodes = [pool('w', 'water'), pool('u')]
    const edges = [res('b', 'w', 'u', '1', 'Energy')]
    const conflict = { kind: 'annotation', edgeId: 'b', nodeId: 'w', edgeKind: 'Energy', poolKind: 'water' }
    const noKind = { kind: 'poolNoKind', edgeId: 'b', nodeId: 'u', edgeKind: 'water' } // review 3: the same line carries water into a Pool that declares none
    expect(kindFindings(nodes, edges, WATER, 3)).toEqual([{ cls: 'conflict', conflict, refuses: true }, { cls: 'conflict', conflict: noKind, refuses: true }])
    expect(kindFindings(nodes, edges, [{ name: 'water', conserved: false }], 3)).toEqual([{ cls: 'conflict', conflict, refuses: false }, { cls: 'conflict', conflict: noKind, refuses: false }])
  })

  it('rows 13 and 14 — a Gate between water and energy refuses when water is conserved; two untyped Pools through a Gate are nothing', () => {
    const nodes = [pool('w', 'water'), pool('p', 'energy'), node('g', 'gate'), pool('a'), pool('b'), node('g2', 'gate')]
    const edges = [res('c', 'w', 'g'), res('d', 'g', 'p'), res('x', 'a', 'g2'), res('y', 'g2', 'b')]
    expect(kindFindings(nodes, edges, WATER, 3)).toEqual([{ cls: 'conflict', conflict: { kind: 'gateMixes', nodeId: 'g', kinds: ['energy', 'water'] }, refuses: true }])
    expect(kindFindingNodeId(kindFindings(nodes, edges, WATER, 3)[0])).toBe('g')
  })

  it('row 16 — Converter → Gate → Pools of two kinds: a conflict at the Gate, refused', () => {
    const nodes = [pool('sea', 'water'), node('ro', 'converter'), node('g', 'gate'), pool('w', 'water'), pool('p', 'power')]
    const edges = [res('a', 'sea', 'ro', '10'), res('b', 'ro', 'g', '10'), res('c', 'g', 'w', '5'), res('d', 'g', 'p', '5')]
    const f = kindFindings(nodes, edges, WATER, 3)
    expect(f[0]).toEqual({ cls: 'conflict', conflict: { kind: 'gateMixes', nodeId: 'g', kinds: ['power', 'water'] }, refuses: true })
  })

  it('row 17 — a Gate chain fed by one water Pool ending in a Drain: every line is water, no finding', () => {
    const nodes = [pool('w', 'water'), node('g1', 'gate'), node('g2', 'gate'), node('g3', 'gate'), node('d', 'drain')]
    const edges = [res('a', 'w', 'g1'), res('b', 'g1', 'g2'), res('c', 'g2', 'g3'), res('d', 'g3', 'd')]
    expect(kindFindings(nodes, edges, WATER, 3)).toEqual([])
    expect([...resolveKinds(nodes, edges).edgeKind.values()]).toEqual(['water', 'water', 'water', 'water'])
  })

  it('row 20 — the MMO shape with currency declared conserved: every involved Converter is not computable first (an untyped line)', () => {
    const nodes = [pool('gold', 'currency'), node('resupply', 'converter'), pool('water_units'), pool('food')]
    const edges = [res('a', 'gold', 'resupply', '6'), res('b', 'resupply', 'water_units', '8'), res('c', 'resupply', 'food', '8')]
    const f = kindFindings(nodes, edges, [{ name: 'currency', conserved: true }], 3)
    expect(f.map((x) => x.cls)).toEqual(['notComputable', 'notComputable'])
    expect(f.every((x) => x.refuses)).toBe(true)
  })

  it('row 22 — a Parameter in a rate is resolved before the check: @p = 50 breaks the balance, @p = 45 keeps it', () => {
    const param = (id: string, value: number): LoopNode => ({ id, type: 'parameter', position: XY, data: { kind: 'parameter', label: id, value } as unknown as LoopNode['data'] })
    const mk = (v: number) => {
      const { nodes, edges } = plant('100', '@p', '55')
      return { nodes: [...nodes, param('p', v)], edges }
    }
    expect(kindFindings(mk(45).nodes, mk(45).edges, WATER, 3)).toEqual([])
    expect(kindFindings(mk(50).nodes, mk(50).edges, WATER, 3)).toEqual([{ cls: 'broken', converterId: 'ro', kind: 'water', inRate: 100, outRate: 105, refuses: true }])
  })
})
