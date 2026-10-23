import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { connectKindOf, connectVerdict, drawnEdge, kindChangeVerdict, rekindedEdge } from './connectKind'
import { faceOf } from './ports'

// The workbench, direction B (Lumi, 2026-10-19): a connection's kind is chosen,
// never inferred from the handle that took a press; a face point is a position.

const node = (id: string, type: string): LoopNode => ({ id, type, position: { x: 0, y: 0 }, data: { kind: type, label: id } }) as unknown as LoopNode
const NODES = [node('src', 'source'), node('a', 'pool'), node('b', 'pool'), node('g', 'gate'), node('d', 'drain'), node('p', 'parameter')]

describe('connectVerdict — the chosen kind decides, the ports and the kind’s rule refuse', () => {
  it('a flow needs an output at its start and an input at its end', () => {
    expect(connectVerdict(NODES, [], 'flow', { source: 'a', target: 'b' })).toEqual({ ok: true })
    expect(connectVerdict(NODES, [], 'flow', { source: 'd', target: 'a' })).toEqual({ ok: false, reason: 'noOutput', end: 'source', node: 'd' })
    expect(connectVerdict(NODES, [], 'flow', { source: 'a', target: 'src' })).toEqual({ ok: false, reason: 'noInput', end: 'target', node: 'src' })
    expect(connectVerdict(NODES, [], 'flow', { source: 'p', target: 'a' })).toEqual({ ok: false, reason: 'noPorts', end: 'source', node: 'p' })
  })

  it('a condition needs a Pool as its source; a value change a Pool at both ends', () => {
    expect(connectVerdict(NODES, [], 'condition', { source: 'a', target: 'g' })).toEqual({ ok: true })
    expect(connectVerdict(NODES, [], 'condition', { source: 'g', target: 'a' })).toEqual({ ok: false, reason: 'conditionSource', end: 'source', node: 'g' })
    expect(connectVerdict(NODES, [], 'change', { source: 'a', target: 'b' })).toEqual({ ok: true })
    expect(connectVerdict(NODES, [], 'change', { source: 'a', target: 'g' })).toEqual({ ok: false, reason: 'changePool', end: 'target', node: 'g' })
  })

  it('a trigger connects any two flow nodes — so a Gate → Pool state connection can still be drawn', () => {
    expect(connectVerdict(NODES, [], 'trigger', { source: 'g', target: 'a' })).toEqual({ ok: true })
    expect((drawnEdge('t', 'trigger', { source: 'g', target: 'a' }).data as { mode?: string }).mode).toBe('trigger')
    expect(connectVerdict(NODES, [], 'trigger', { source: 'p', target: 'a' })).toEqual({ ok: false, reason: 'noPorts', end: 'source', node: 'p' })
  })

  it('the same two ends of the same kind again are refused; another kind between them is not', () => {
    const flow = drawnEdge('e1', 'flow', { source: 'a', target: 'b' })
    expect(connectVerdict(NODES, [flow], 'flow', { source: 'a', target: 'b' })).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: 'b' })
    expect(connectVerdict(NODES, [flow], 'change', { source: 'a', target: 'b' })).toEqual({ ok: true })
  })

  it('never answers with another kind: a refused flow stays refused whatever handle it was dropped on', () => {
    // a drop on a state handle of a Drain does not turn a flow into a state connection
    expect(connectVerdict(NODES, [], 'flow', { source: 'd', target: 'a', sourceHandle: 'state-source', targetHandle: 'state-target' }).ok).toBe(false)
  })
})

describe('drawnEdge — the kind’s own handles; each face from its own handle', () => {
  it('a flow rides out / in; a face point is only where it attaches', () => {
    const e = drawnEdge('e', 'flow', { source: 'a', target: 'b', sourceHandle: 'out@bottom', targetHandle: 'in' })
    expect([e.sourceHandle, e.targetHandle, e.data?.kind]).toEqual(['out', 'in', 'resource'])
    expect([faceOf(e, 'source'), faceOf(e, 'target')]).toEqual(['bottom', 'left'])
  })

  it('a condition and a value change ride the state handles, with their mode and an empty expression', () => {
    const c = drawnEdge('c', 'condition', { source: 'a', target: 'g', sourceHandle: 'state-source@right', targetHandle: 'state-target' })
    expect([c.sourceHandle, c.targetHandle, (c.data as { mode?: string }).mode, (c.data as { expr?: string }).expr]).toEqual(['state-source', 'state-target', 'activator', ''])
    expect([faceOf(c, 'source'), faceOf(c, 'target')]).toEqual(['right', 'top'])
    expect((drawnEdge('v', 'change', { source: 'a', target: 'b' }).data as { mode?: string }).mode).toBe('label')
    expect(connectKindOf(c)).toBe('condition')
  })
})

describe('rekindedEdge — a kind change keeps the line', () => {
  const flow: LoopEdge = {
    id: 'e',
    source: 'a',
    target: 'b',
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'loop',
    data: { kind: 'resource', flow: '3', route: 'orthogonal', waypoints: [{ x: 10, y: 20 }], accent: '#A78243', ports: { source: 'bottom' } },
  } as unknown as LoopEdge

  it('rewrites the handles to the kind and keeps route, bends, colour and the faces actually used', () => {
    const c = rekindedEdge(flow, 'change')
    expect([c.sourceHandle, c.targetHandle]).toEqual(['state-source', 'state-target'])
    const d = c.data as Record<string, unknown>
    expect([d.kind, d.mode, d.route, d.waypoints, d.accent]).toEqual(['state', 'label', 'orthogonal', [{ x: 10, y: 20 }], '#A78243'])
    // the faces: bottom (the state default now, so not stored) and left (stored)
    expect([faceOf(c, 'source'), faceOf(c, 'target')]).toEqual(['bottom', 'left'])
    expect(d.flow, 'a flow’s amount is not a value change’s field').toBeUndefined()
    // and back: the same faces, a fresh amount
    const f = rekindedEdge(c, 'flow')
    expect([f.sourceHandle, f.targetHandle, faceOf(f, 'source'), faceOf(f, 'target')]).toEqual(['out', 'in', 'bottom', 'left'])
    expect((f.data as Record<string, unknown>).accent).toBe('#A78243')
  })

  it('a change within state keeps the expression', () => {
    const c = rekindedEdge({ ...flow, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+2', route: 'orthogonal' } } as unknown as LoopEdge, 'condition')
    expect((c.data as Record<string, unknown>).expr).toBe('+2')
  })

  it('kindChangeVerdict uses the drawing rules and never counts the connection against itself', () => {
    expect(kindChangeVerdict(NODES, [flow], 'e', 'flow')).toEqual({ ok: true })
    expect(kindChangeVerdict(NODES, [flow], 'e', 'change')).toEqual({ ok: true })
    const toGate = { ...flow, target: 'g' } as LoopEdge
    expect(kindChangeVerdict(NODES, [toGate], 'e', 'change')).toEqual({ ok: false, reason: 'changePool', end: 'target', node: 'g' })
  })

  // 2026-10-20 (Lumi): the duplicate rule compares the stored HANDLES; the
  // connection itself is left out, and a change is refused only when the
  // changed connection would repeat ANOTHER one by that rule
  describe('kindChangeVerdict and parallel connections (the duplicate rule is the handles)', () => {
    const st = (id: string, mode: string, expr = ''): LoopEdge =>
      ({ id, source: 'a', target: 'b', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode, expr } }) as unknown as LoopEdge
    const m1 = st('m1', 'label', '+S')
    const m2 = st('m2', 'label', '-1')

    it('two parallel state connections: each may change between the state kinds (the handles stay)', () => {
      for (const k of ['condition', 'trigger', 'change'] as const) {
        expect(kindChangeVerdict(NODES, [m1, m2], 'm1', k), k).toEqual({ ok: true })
        expect(kindChangeVerdict(NODES, [m1, m2], 'm2', k), k).toEqual({ ok: true })
      }
    })

    it('flow ↔ state is refused only when it would repeat another connection on the new handles', () => {
      const fl = { ...flow, id: 'f' } as LoopEdge
      // a state connection beside an existing flow between the same Pools → a flow repeats it
      expect(kindChangeVerdict(NODES, [m1, fl], 'm1', 'flow')).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: 'b' })
      // with no flow there, the same change is allowed — the parallel state connection does not count
      expect(kindChangeVerdict(NODES, [m1, m2], 'm1', 'flow')).toEqual({ ok: true })
      // a flow beside a state connection → a state kind repeats it on the state handles
      expect(kindChangeVerdict(NODES, [fl, m1], 'f', 'condition')).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: 'b' })
      expect(kindChangeVerdict(NODES, [fl], 'f', 'condition')).toEqual({ ok: true })
    })

    it('the connection itself is never compared with itself', () => {
      expect(kindChangeVerdict(NODES, [m1], 'm1', 'change')).toEqual({ ok: true })
      expect(kindChangeVerdict(NODES, [m1], 'm1', 'flow')).toEqual({ ok: true })
      expect(kindChangeVerdict(NODES, [{ ...flow, id: 'f' } as LoopEdge], 'f', 'flow')).toEqual({ ok: true })
    })

    it('drawing keeps the rule: a second state connection on the same handles is refused, a flow beside it is not', () => {
      expect(connectVerdict(NODES, [m1], 'trigger', { source: 'a', target: 'b' })).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: 'b' })
      expect(connectVerdict(NODES, [m1], 'flow', { source: 'a', target: 'b' })).toEqual({ ok: true })
    })
  })
})
