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

  it('node removal: an incident edge removal is a dependent — resolved by removing OR retargeting it', () => {
    // proposal removes node b AND (via the proposed graph) edge e_ab
    const target = { nodes: [pool('a'), pool('b')], edges: [rEdge('e_ab', 'a', 'b')] }
    const proposedFull = { nodes: [pool('a')], edges: [] as LoopEdge[] }
    const baseC = cc(target.nodes, target.edges)
    const plan = computeThreeWay(baseC, cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))

    const nodeHunk = plan.hunks.find((h) => h.id === 'b' && h.kind === 'remove')!
    expect(nodeHunk.dependents).toEqual(['e_ab']) // surfaced, not hidden
    expect(nodeHunk.blockedBy).toBeUndefined()

    // node alone ⇒ invalid (the edge still references b)
    expect(
      buildSelectiveApply({ target, proposedFull, plan, selection: { accept: { b: true }, fieldChoices: {} } }),
    ).toMatchObject({ ok: false, reason: 'invalid-selection' })

    // node + its dependent removal ⇒ clean
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

  it('node removal: a RETARGET of the incident edge satisfies the dependency (§ round 3)', () => {
    // base: e_xb : a → b ; proposal removes b and retargets e_xb to c
    const base = { nodes: [pool('a'), pool('b'), pool('c')], edges: [rEdge('e_xb', 'a', 'b')] }
    const target = { nodes: [pool('a'), pool('b'), pool('c')], edges: [rEdge('e_xb', 'a', 'b')] }
    const proposedFull = { nodes: [pool('a'), pool('c')], edges: [rEdge('e_xb', 'a', 'c')] } // b gone, edge → c
    const plan = computeThreeWay(cc(base.nodes, base.edges), cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))

    const nodeHunk = plan.hunks.find((h) => h.id === 'b' && h.kind === 'remove')!
    expect(nodeHunk.dependents).toEqual(['e_xb']) // the retarget change hunk
    expect(nodeHunk.blockedBy).toBeUndefined()

    // node alone (edge still → b) ⇒ invalid
    expect(
      buildSelectiveApply({ target, proposedFull, plan, selection: { accept: { b: true }, fieldChoices: {} } }),
    ).toMatchObject({ ok: false, reason: 'invalid-selection' })

    // node + the retarget field ⇒ valid: edge now points at c
    const ok = buildSelectiveApply({
      target,
      proposedFull,
      plan,
      selection: { accept: { b: true }, fieldChoices: { e_xb: { target: 'proposed' } } },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.nodes.map((n) => n.id).sort()).toEqual(['a', 'c'])
      expect(ok.edges[0].target).toBe('c')
    }
  })

  it('a target-only edge on a removed node ⇒ structural conflict: blockedBy, verdict conflict, feeds nConf ⇒ divergent', () => {
    const base = { nodes: [pool('a'), pool('b')], edges: [] as LoopEdge[] }
    const target = { nodes: [pool('a'), pool('b')], edges: [rEdge('e_mine', 'a', 'b')] } // e_mine is MY edge
    const proposedFull = { nodes: [pool('a')], edges: [] as LoopEdge[] } // proposal removes b
    const plan = computeThreeWay(cc(base.nodes, base.edges), cc(target.nodes, target.edges), cc(proposedFull.nodes, proposedFull.edges))
    const h = plan.hunks.find((x) => x.id === 'b' && x.kind === 'remove')!
    expect(h.blockedBy).toEqual(['e_mine'])
    expect(h.verdict).toBe('conflict')
    expect(plan.nConf).toBeGreaterThanOrEqual(1) // ⇒ classification is `divergent`, not `unknown`
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

// ── SEMANTICS-R5.md §R5-6 — the graph-level `frames` hunk ────────────────────
describe('computeThreeWay / buildSelectiveApply — the `frames` hunk (§R5-6)', () => {
  const F1 = [{ id: 'f1', label: 'Zone A', rect: { x: 0, y: 0, w: 100, h: 60 } }]
  const F2 = [
    { id: 'f1', label: 'Zone A', rect: { x: 0, y: 0, w: 100, h: 60 } },
    { id: 'f2', label: 'Zone B', rect: { x: 200, y: 0, w: 80, h: 40 }, color: 'rose' as const },
  ]
  const ccf = (frames: unknown, nodes: LoopNode[] = [pool('a')]) =>
    canonicalContent({ nodes, edges: [], frames: frames as never })

  it('no hunk when base and proposed `frames` are equal', () => {
    expect(computeThreeWay(ccf(F1), ccf(F1), ccf(F1)).frames).toBeUndefined()
    expect(computeThreeWay(cc([pool('a')]), cc([pool('a')]), cc([pool('a')])).frames).toBeUndefined()
  })

  it('verdict clean / noop / conflict against the target, and only `conflict` feeds nConf', () => {
    // proposal adds frames; target still frame-free ⇒ clean
    const clean = computeThreeWay(cc([pool('a')]), cc([pool('a')]), ccf(F2))
    expect(clean.frames).toMatchObject({ kind: 'frames', verdict: 'clean', base: null })
    expect(clean.frames?.proposed).toHaveLength(2)
    expect(clean.nConf).toBe(0)

    // target already holds the proposed array ⇒ noop
    expect(computeThreeWay(cc([pool('a')]), ccf(F2), ccf(F2)).frames?.verdict).toBe('noop')

    // target holds a THIRD array (local relabel) ⇒ conflict, +1 nConf
    const mine = ccf([{ ...F2[0], label: 'Zone A (mine)' }, F2[1]])
    const conflict = computeThreeWay(ccf(F2), mine, ccf(F1))
    expect(conflict.frames?.verdict).toBe('conflict')
    expect(conflict.nConf).toBe(1)
  })

  it('the frames hunk is independent of node/edge hunks and their nConf', () => {
    const base = cc([pool('a', { initial: 1 })])
    const target = cc([pool('a', { initial: 2 })]) // local edit
    const proposed = ccf(F1, [pool('a', { initial: 3 })]) // their edit + frames
    const p = computeThreeWay(base, target, proposed)
    expect(p.frames?.verdict).toBe('clean') // target frame-free == base
    expect(p.nConf).toBe(1) // ONLY the data.initial conflict — frames clean adds nothing
  })

  it('buildSelectiveApply: select ⇒ whole proposed array (deep-cloned); deselect ⇒ undefined (keep target)', () => {
    const plan = computeThreeWay(cc([pool('a')]), cc([pool('a')]), ccf(F2))
    const taken = buildSelectiveApply({
      target: { nodes: [pool('a')], edges: [] },
      proposedFull: { nodes: [pool('a')], edges: [], frames: F2 },
      plan,
      selection: { accept: {}, fieldChoices: {}, frames: 'proposed' },
    })
    expect(taken.ok && taken.frames).toEqual(F2)
    expect(taken.ok && taken.frames).not.toBe(F2)

    const kept = buildSelectiveApply({
      target: { nodes: [pool('a')], edges: [] },
      proposedFull: { nodes: [pool('a')], edges: [], frames: F2 },
      plan,
      selection: { accept: {}, fieldChoices: {} }, // frames absent ⇒ 'yours'
    })
    expect(kept.ok && kept.frames).toBeUndefined()
  })

  it('buildSelectiveApply: selecting the hunk when the proposal has NO frames = an explicit empty array (clear all)', () => {
    const plan = computeThreeWay(ccf(F2), ccf(F2), cc([pool('a')]))
    const cleared = buildSelectiveApply({
      target: { nodes: [pool('a')], edges: [] },
      proposedFull: { nodes: [pool('a')], edges: [] }, // no frames
      plan,
      selection: { accept: {}, fieldChoices: {}, frames: 'proposed' },
    })
    expect(cleared.ok && cleared.frames).toEqual([])
  })

  it('buildSelectiveApply: the frames choice never touches nodes / edges', () => {
    const plan = computeThreeWay(cc([pool('a')]), cc([pool('a')]), ccf(F2))
    const r = buildSelectiveApply({
      target: { nodes: [pool('a'), pool('b')], edges: [rEdge('e', 'a', 'b')] },
      proposedFull: { nodes: [pool('a'), pool('b')], edges: [rEdge('e', 'a', 'b')], frames: F2 },
      plan,
      selection: { accept: {}, fieldChoices: {}, frames: 'proposed' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.nodes.map((n) => n.id)).toEqual(['a', 'b'])
      expect(r.edges.map((e) => e.id)).toEqual(['e'])
    }
  })

  it('countThreeWayConflicts includes a frames conflict', () => {
    const mine = canonicalContent({ nodes: [pool('a')], edges: [], frames: [{ id: 'f1', label: 'M', rect: { x: 0, y: 0, w: 9, h: 9 } }] as never })
    expect(countThreeWayConflicts(ccf(F1), mine, ccf(F2))).toBe(1)
  })
})
