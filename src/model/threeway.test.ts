import { describe, expect, it } from 'vitest'
import {
  buildSelectiveApply,
  canonicalContent,
  computeThreeWay,
  countThreeWayConflicts,
  validateResultGraph,
  type ThreeWayPlan,
} from './revision'
import type { LoopEdge, LoopNode } from './types'

// SEMANTICS-R.md §R7A.3 / §R7.2 — the per-hunk three-way plan and the selective
// apply builder that Slice 2 drives.

const pool = (id: string, over: Partial<LoopNode['data']> = {}, pos = { x: 0, y: 0 }): LoopNode =>
  ({
    id,
    type: 'pool',
    position: pos,
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...over },
  }) as LoopNode

const rEdge = (id: string, s: string, t: string, flow = '1'): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

const cc = (nodes: LoopNode[], edges: LoopEdge[] = []) => canonicalContent({ nodes, edges })

const hunk = (plan: ThreeWayPlan, id: string) => plan.hunks.find((h) => h.id === id)!

describe('computeThreeWay — §R7A.3 verdicts', () => {
  it('add: clean / no-op / conflict', () => {
    const base = cc([pool('a')])
    const proposed = cc([pool('a'), pool('b', { initial: 5 })])
    expect(hunk(computeThreeWay(base, cc([pool('a')]), proposed), 'b').verdict).toBe('clean')
    expect(hunk(computeThreeWay(base, cc([pool('a'), pool('b', { initial: 5 })]), proposed), 'b').verdict).toBe('noop')
    expect(hunk(computeThreeWay(base, cc([pool('a'), pool('b', { initial: 9 })]), proposed), 'b').verdict).toBe('conflict')
  })

  it('remove: clean / no-op / conflict', () => {
    const base = cc([pool('a'), pool('b')])
    const proposed = cc([pool('a')])
    expect(hunk(computeThreeWay(base, cc([pool('a'), pool('b')]), proposed), 'b').verdict).toBe('clean')
    expect(hunk(computeThreeWay(base, cc([pool('a')]), proposed), 'b').verdict).toBe('noop')
    expect(hunk(computeThreeWay(base, cc([pool('a'), pool('b', { initial: 7 })]), proposed), 'b').verdict).toBe('conflict')
  })

  it('change: per-field clean / no-op / conflict, with base/proposed/yours', () => {
    const base = cc([pool('a', { initial: 10, capacity: null })])
    const proposed = cc([pool('a', { initial: 20, capacity: null })])
    // target still at base value ⇒ clean
    let p = computeThreeWay(base, cc([pool('a', { initial: 10 })]), proposed)
    let f = hunk(p, 'a').fields!.find((x) => x.field === 'data.initial')!
    expect(f.verdict).toBe('clean')
    expect([f.base, f.proposed, f.yours]).toEqual([10, 20, 10])
    // target already at proposed value ⇒ noop
    p = computeThreeWay(base, cc([pool('a', { initial: 20 })]), proposed)
    expect(hunk(p, 'a').fields!.find((x) => x.field === 'data.initial')!.verdict).toBe('noop')
    // target at a third value ⇒ conflict, yours shown
    p = computeThreeWay(base, cc([pool('a', { initial: 15 })]), proposed)
    f = hunk(p, 'a').fields!.find((x) => x.field === 'data.initial')!
    expect(f.verdict).toBe('conflict')
    expect(f.yours).toBe(15)
    expect(p.nConf).toBe(1)
  })

  it('change whose target element was deleted ⇒ conflict, nConf counts it once', () => {
    const base = cc([pool('a', { initial: 1 }), pool('b')])
    const proposed = cc([pool('a', { initial: 2, label: 'A2' }), pool('b')])
    const p = computeThreeWay(base, cc([pool('b')]), proposed) // target deleted a
    const h = hunk(p, 'a')
    expect(h.kind).toBe('change')
    expect(h.verdict).toBe('conflict')
    expect(h.yours).toBeNull()
    expect(p.nConf).toBe(1) // once, even though two fields changed
  })

  it('nConf === countThreeWayConflicts for the same inputs', () => {
    const base = cc([pool('a', { initial: 10 }), pool('b'), pool('c')])
    const target = cc([pool('a', { initial: 15 }), pool('b', { initial: 3 })]) // a: third value, c: deleted
    const proposed = cc([pool('a', { initial: 20 }), pool('b'), pool('c', { initial: 9 })])
    expect(computeThreeWay(base, target, proposed).nConf).toBe(countThreeWayConflicts(base, target, proposed))
  })
})

describe('buildSelectiveApply — §R7.2', () => {
  const base = [pool('a', { initial: 1 }), pool('b', { initial: 1 })]
  const baseE = [rEdge('e_ab', 'a', 'b')]

  it('applies only the accepted hunks; rejected elements stay byte-identical', () => {
    const target = { nodes: [pool('a', { initial: 1 }), pool('b', { initial: 1 })], edges: [rEdge('e_ab', 'a', 'b')] }
    const proposedFull = {
      nodes: [pool('a', { initial: 9 }), pool('b', { initial: 1 }), pool('c', { initial: 5 })],
      edges: [rEdge('e_ab', 'a', 'b')],
    }
    const plan = computeThreeWay(cc(base, baseE), cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))
    // accept the new node c, but NOT the change to a
    const res = buildSelectiveApply({
      target,
      proposedFull,
      plan,
      selection: { accept: { c: true }, fieldChoices: {} },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.nodes.find((n) => n.id === 'c')).toBeTruthy()
    expect(res.nodes.find((n) => n.id === 'a')).toEqual(target.nodes[0]) // untouched, byte-identical
  })

  it('node removal: the incident edge removal is an EXPLICIT dependency (no silent cascade)', () => {
    // proposal removes node b AND (implicitly, via the proposed graph) edge e_ab
    const target = { nodes: [pool('a'), pool('b')], edges: [rEdge('e_ab', 'a', 'b')] }
    const proposedFull = { nodes: [pool('a')], edges: [] as LoopEdge[] }
    const baseC = cc(target.nodes, target.edges)
    const plan = computeThreeWay(baseC, cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))

    const nodeHunk = plan.hunks.find((h) => h.id === 'b' && h.kind === 'remove')!
    expect(nodeHunk.removeWith).toEqual(['e_ab']) // surfaced, not hidden

    // node alone ⇒ invalid (the dependency edge removal is not selected)
    expect(
      buildSelectiveApply({ target, proposedFull, plan, selection: { accept: { b: true }, fieldChoices: {} } }),
    ).toMatchObject({ ok: false, reason: 'invalid-selection' })

    // node + its dependency ⇒ clean
    const ok = buildSelectiveApply({
      target,
      proposedFull,
      plan,
      selection: { accept: { b: true, e_ab: true }, fieldChoices: {} },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.nodes.map((n) => n.id)).toEqual(['a'])
      expect(ok.edges).toEqual([])
    }
  })

  it('a target-only edge on a removed node ⇒ structural conflict (blockedBy), node cannot be removed', () => {
    const base = { nodes: [pool('a'), pool('b')], edges: [] as LoopEdge[] }
    const target = { nodes: [pool('a'), pool('b')], edges: [rEdge('e_mine', 'a', 'b')] } // e_mine is MY edge
    const proposedFull = { nodes: [pool('a')], edges: [] as LoopEdge[] } // proposal removes b
    const plan = computeThreeWay(cc(base.nodes, base.edges), cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))
    const h = plan.hunks.find((x) => x.id === 'b' && x.kind === 'remove')!
    expect(h.blockedBy).toEqual(['e_mine'])
    expect(
      buildSelectiveApply({ target, proposedFull, plan, selection: { accept: { b: true }, fieldChoices: {} } }),
    ).toMatchObject({ ok: false, reason: 'invalid-selection' })
  })

  it('an unrelated target edge is left byte-identical by a selective apply', () => {
    const base = { nodes: [pool('a'), pool('b'), pool('c')], edges: [rEdge('e_bc', 'b', 'c')] }
    const target = { nodes: [pool('a'), pool('b'), pool('c')], edges: [rEdge('e_bc', 'b', 'c'), rEdge('e_ac', 'a', 'c')] }
    const proposedFull = { nodes: [pool('a', { initial: 9 }), pool('b'), pool('c')], edges: [rEdge('e_bc', 'b', 'c')] }
    const plan = computeThreeWay(cc(base.nodes, base.edges), cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))
    // accept the change to a, nothing else
    const res = buildSelectiveApply({
      target,
      proposedFull,
      plan,
      selection: { accept: {}, fieldChoices: { a: { 'data.initial': 'proposed' } } },
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.edges.find((e) => e.id === 'e_ac')).toEqual(target.edges[1]) // untouched
  })

  it('change conflict: "take proposal" sets the proposed value, "keep mine" leaves yours', () => {
    const b = cc([pool('x', { capacity: 10 })])
    const proposedFull = { nodes: [pool('x', { capacity: 20 })], edges: [] as LoopEdge[] }
    const target = { nodes: [pool('x', { capacity: 15 })], edges: [] as LoopEdge[] }
    const plan = computeThreeWay(b, cc(target.nodes), cc(proposedFull.nodes))

    const cap = (r: ReturnType<typeof buildSelectiveApply>) =>
      r.ok ? (r.nodes[0].data as Record<string, unknown>).capacity : undefined

    const take = buildSelectiveApply({ target, proposedFull, plan, selection: { accept: {}, fieldChoices: { x: { 'data.capacity': 'proposed' } } } })
    expect(cap(take)).toBe(20)

    const keep = buildSelectiveApply({ target, proposedFull, plan, selection: { accept: {}, fieldChoices: { x: { 'data.capacity': 'yours' } } } })
    expect(cap(keep)).toBe(15)
  })

  it('change on a target-deleted element: "take proposal" re-adds it, otherwise it stays gone', () => {
    const b = cc([pool('x', { initial: 1 }), pool('y')])
    const proposedFull = { nodes: [pool('x', { initial: 2 }), pool('y')], edges: [] as LoopEdge[] }
    const target = { nodes: [pool('y')], edges: [] as LoopEdge[] } // x deleted
    const plan = computeThreeWay(b, cc(target.nodes), cc(proposedFull.nodes))

    const readd = buildSelectiveApply({ target, proposedFull, plan, selection: { accept: {}, fieldChoices: { x: { 'data.initial': 'proposed' } } } })
    expect(readd.ok && readd.nodes.some((n) => n.id === 'x')).toBe(true)

    const leave = buildSelectiveApply({ target, proposedFull, plan, selection: { accept: {}, fieldChoices: { x: { 'data.initial': 'yours' } } } })
    expect(leave.ok && leave.nodes.some((n) => n.id === 'x')).toBe(false)
  })

  it('an accepted edge whose endpoint node is not in the result ⇒ invalid-selection (before Apply)', () => {
    // proposal adds node c AND edge e_bc; user accepts only the edge
    const target = { nodes: [pool('a'), pool('b')], edges: [] as LoopEdge[] }
    const proposedFull = {
      nodes: [pool('a'), pool('b'), pool('c')],
      edges: [rEdge('e_bc', 'b', 'c')],
    }
    const plan = computeThreeWay(cc(target.nodes), cc(target.nodes), cc(proposedFull.nodes, proposedFull.edges))
    const res = buildSelectiveApply({
      target,
      proposedFull,
      plan,
      selection: { accept: { e_bc: true }, fieldChoices: {} }, // NOT accepting node c
    })
    expect(res).toMatchObject({ ok: false, reason: 'invalid-selection' })
  })
})

describe('validateResultGraph — full-GraphDoc check (Slice 2 review round 2)', () => {
  it('passes a clean graph', () => {
    expect(validateResultGraph([pool('a'), pool('b')], [rEdge('e', 'a', 'b')])).toEqual({ ok: true })
  })

  it('flags an unknown node kind and a type/kind mismatch', () => {
    const bad = { ...pool('x'), data: { ...pool('x').data, kind: 'bogus' } } as unknown as LoopNode
    const r = validateResultGraph([bad], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/unknown kind|≠ data\.kind/)
  })

  it('flags an edge with a missing endpoint', () => {
    const r = validateResultGraph([pool('a')], [rEdge('e', 'a', 'ghost')])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/target node ghost does not exist/)
  })

  it('flags a resource edge wearing a state handle (and vice-versa)', () => {
    const e = { ...rEdge('e', 'a', 'b'), sourceHandle: 'state-source' } as LoopEdge
    const r = validateResultGraph([pool('a'), pool('b')], [e])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/resource edge must not use state handles/)
  })

  it('flags a non-finite number', () => {
    const n = { ...pool('a'), position: { x: 0, y: Number.POSITIVE_INFINITY } } as LoopNode
    const r = validateResultGraph([n], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/non-finite/)
  })

  it('flags a doc that normalize would silently repair (blank handle)', () => {
    const e = { ...rEdge('e', 'a', 'b'), sourceHandle: '' } as LoopEdge
    const r = validateResultGraph([pool('a'), pool('b')], [e])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/not already normalized/)
  })
})
