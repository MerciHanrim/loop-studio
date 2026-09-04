import { beforeEach, describe, expect, it } from 'vitest'
import type { GraphDocLike } from '../model/moduleGraph'
import { serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { readModuleFile } from './moduleIO'
import { useSimStore } from './simStore'

// docs/module-system.md §MS8 — the `graphStore.insertModule` transaction:
// one atomic history entry (§MS3.5 / B5), the v1 → v2 consent gate (§MS3.4 /
// MS7-2), and "nothing changes on failure" (§MS3.6 / B4).

const g = () => useGraphStore.getState()

const pool = (id: string, over: Partial<LoopNode['data']> = {}, pos = { x: 0, y: 0 }): LoopNode =>
  ({
    id,
    type: 'pool',
    position: pos,
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...over },
  }) as LoopNode

const rEdge = (id: string, s: string, t: string, flow = '1'): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

const mod = (nodes: LoopNode[], edges: LoopEdge[] = [], modelVersion: 1 | 2 = 1): GraphDocLike => ({
  nodes,
  edges,
  modelVersion,
})

beforeEach(() => {
  g().newGraph()
  g().addNodeAt('pool', { x: 400, y: 400 })
})

describe('insertModule — one atomic transaction (§MS3.5 / B5)', () => {
  it('adds one history entry, selects only the inserted nodes, bumps simulationRev', () => {
    const pastBefore = g().past.length
    const revBefore = g().simulationRev
    const hostId = g().nodes[0].id

    const r = g().insertModule(mod([pool('m1'), pool('m2')], [rEdge('me', 'm1', 'm2', '2')]), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(g().past.length).toBe(pastBefore + 1)
    expect(g().simulationRev).toBeGreaterThan(revBefore)
    expect(g().nodes).toHaveLength(3)
    // only the two inserted nodes are selected
    const selected = g().nodes.filter((n) => n.selected).map((n) => n.id)
    expect(selected.sort()).toEqual([...r.insertedNodeIds].sort())
    expect(g().nodes.find((n) => n.id === hostId)!.selected).toBeFalsy()
    // fresh ids — none of the module's authored ids survive
    for (const old of ['m1', 'm2', 'me']) expect(g().nodes.some((n) => n.id === old)).toBe(false)
  })

  it('one undo removes every inserted node + edge and restores the prior selection; redo restores the same ids', () => {
    g().setSelection(g().nodes[0].id, null)
    const r = g().insertModule(mod([pool('a'), pool('b')], [rEdge('e', 'a', 'b')]), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const insertedIds = [...r.insertedNodeIds]

    g().undo()
    expect(g().nodes).toHaveLength(1)
    expect(g().edges).toHaveLength(0)
    for (const id of insertedIds) expect(g().nodes.some((n) => n.id === id)).toBe(false)

    g().redo()
    expect(g().nodes).toHaveLength(3)
    for (const id of insertedIds) expect(g().nodes.some((n) => n.id === id)).toBe(true)
    expect(g().nodes.filter((n) => n.selected).map((n) => n.id).sort()).toEqual([...insertedIds].sort())
  })

  it('two inserts of the same module: one undo removes ONLY the second; redo restores the second’s same ids', () => {
    const block = () => mod([pool('a'), pool('b')], [rEdge('e', 'a', 'b')])

    const first = g().insertModule(block(), { at: { x: 0, y: 0 } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstIds = [...first.insertedNodeIds]

    const second = g().insertModule(block(), { at: { x: 300, y: 300 } })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const secondIds = [...second.insertedNodeIds]

    // disjoint id sets
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
    expect(g().nodes).toHaveLength(5) // 1 host + 2 + 2

    // one undo drops the SECOND insert only
    g().undo()
    expect(g().nodes).toHaveLength(3)
    for (const id of firstIds) expect(g().nodes.some((n) => n.id === id)).toBe(true)
    for (const id of secondIds) expect(g().nodes.some((n) => n.id === id)).toBe(false)

    // redo restores the second insert with the SAME ids it first minted
    g().redo()
    expect(g().nodes).toHaveLength(5)
    for (const id of secondIds) expect(g().nodes.some((n) => n.id === id)).toBe(true)
    expect(g().nodes.filter((n) => n.selected).map((n) => n.id).sort()).toEqual([...secondIds].sort())
  })
})

describe('insertModule — v1 → v2 consent gate (§MS3.4 / MS7-2)', () => {
  it('a v2 module into a v1 host without consent changes nothing', () => {
    // the referenced parameter is inside the module, so it is self-contained
    const m = mod(
      [pool('a'), pool('b'), { id: 'rate', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'rate', value: 2 } } as LoopNode],
      [{ ...rEdge('e', 'a', 'b'), data: { kind: 'resource', flow: '@rate' } }],
      2,
    )
    g().setSelection(g().nodes[0].id, null)
    const before = {
      nodes: g().nodes,
      edges: g().edges,
      mv: g().modelVersion,
      past: g().past.length,
      sel: g().selectedNodeId,
      rev: g().simulationRev,
      frames: useFrameStore.getState().snapshot(),
    }
    const r = g().insertModule(m, { at: { x: 0, y: 0 } })
    expect(r).toEqual({ ok: false, reason: 'needs-v2-consent' })
    expect(g().nodes).toBe(before.nodes)
    expect(g().edges).toBe(before.edges)
    expect(g().modelVersion).toBe(before.mv)
    expect(g().past.length).toBe(before.past)
    expect(g().selectedNodeId).toBe(before.sel)
    expect(g().simulationRev).toBe(before.rev)
    expect(useFrameStore.getState().snapshot()).toEqual(before.frames)
  })

  it('with confirmedPromotion the promotion + insert are ONE undo unit back to a v1 document', () => {
    const m = mod(
      [pool('a'), pool('b'), { id: 'rate', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'rate', value: 2 } } as LoopNode],
      [{ ...rEdge('e', 'a', 'b'), data: { kind: 'resource', flow: '@rate' } }],
      2,
    )
    const r = g().insertModule(m, { at: { x: 0, y: 0 }, confirmedPromotion: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.promotedToV2).toBe(true)
    expect(g().modelVersion).toBe(2)
    expect(g().nodes).toHaveLength(4)

    g().undo()
    expect(g().modelVersion).toBe(1)
    expect(g().nodes).toHaveLength(1)

    g().redo()
    expect(g().modelVersion).toBe(2)
    expect(g().nodes).toHaveLength(4)
  })
})

describe('insertModule — nothing changes on failure (§MS3.6 / B4)', () => {
  it('a module with an edge incident to a parameter is refused; host graph, version, history, selection all unchanged', () => {
    g().setSelection(g().nodes[0].id, null)
    const snap = {
      nodes: g().nodes,
      edges: g().edges,
      modelVersion: g().modelVersion,
      past: g().past.length,
      sel: g().selectedNodeId,
      rev: g().simulationRev,
      frames: useFrameStore.getState().snapshot(),
    }
    const bad = mod(
      [pool('p'), { id: 'lever', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'lever', value: 1 } } as LoopNode],
      [rEdge('bad', 'p', 'lever')],
    )
    const r = g().insertModule(bad, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
    expect(g().nodes).toBe(snap.nodes)
    expect(g().edges).toBe(snap.edges)
    expect(g().modelVersion).toBe(snap.modelVersion)
    expect(g().past.length).toBe(snap.past)
    expect(g().selectedNodeId).toBe(snap.sel)
    expect(g().simulationRev).toBe(snap.rev)
    expect(useFrameStore.getState().snapshot()).toEqual(snap.frames)
    // viewport is a React Flow concern (no store) — covered in e2e
  })

  it('a broken `@ref` in a hand-made module is refused with no change', () => {
    const rev = g().simulationRev
    const past = g().past.length
    const r = g().insertModule(
      mod([{ id: 'r', type: 'register', position: { x: 0, y: 0 }, data: { kind: 'register', label: 'r', expr: '@ghost + 1' } } as LoopNode]),
      { at: { x: 0, y: 0 } },
    )
    expect(r.ok).toBe(false)
    expect(g().nodes).toHaveLength(1)
    expect(g().simulationRev).toBe(rev)
    expect(g().past.length).toBe(past)
  })
})

describe('insertModule — isolation (§MS4a-B2 / B3)', () => {
  it('leaves mcStore config and frameStore frames untouched', () => {
    const mcBefore = JSON.stringify(useMcStore.getState().config)
    const framesBefore = useFrameStore.getState().snapshot()
    const r = g().insertModule(mod([pool('a'), pool('b')], [rEdge('e', 'a', 'b')]), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(useMcStore.getState().config)).toBe(mcBefore)
    expect(useFrameStore.getState().snapshot()).toEqual(framesBefore)
  })

  it('a module FILE carrying its own recommendedRunConfig + frames: neither reaches the host', () => {
    // host has its own MC config, a non-default Timeline selection, and a frame
    useMcStore.getState().setConfig({ runs: 999, steps: 77 })
    useSimStore.getState().setTimelineSeries([g().nodes[0].id])
    useFrameStore.getState().adoptFrame({ x: 0, y: 0, w: 100, h: 100 }, 'Host zone')
    const mcBefore = JSON.stringify(useMcStore.getState().config)
    const tlBefore = JSON.stringify(useSimStore.getState().timelineSeries)
    const framesBefore = useFrameStore.getState().snapshot()

    const file = serialize(
      [pool('a'), pool('b')],
      [rEdge('e', 'a', 'b')],
      { baseSeed: 5, runs: 3, steps: 4, tracked: [] }, // the module file's own run config
      undefined,
      undefined,
      1,
      [{ id: 'mf1', label: 'Module zone', rect: { x: 10, y: 10, w: 50, h: 50 } }], // and its own frames
    )
    const read = readModuleFile(file)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.hadRunConfig).toBe(true)
    expect(read.hadFrames).toBe(true)

    const r = g().insertModule(read.module, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(useMcStore.getState().config)).toBe(mcBefore) // §MS4a-B2
    expect(JSON.stringify(useSimStore.getState().timelineSeries)).toBe(tlBefore)
    expect(useFrameStore.getState().snapshot()).toEqual(framesBefore) // §MS4a-B3
  })
})
