import { beforeEach, describe, expect, it } from 'vitest'
import { faceOf } from '../model/ports'
import { useGraphStore } from './graphStore'

// The workbench, direction B (Lumi, 2026-10-19): drawing takes the CHOSEN kind
// and a kind change keeps the line, rewrites the handles and is one undo step.

const S = () => useGraphStore.getState()
const data = (id: string) => S().edges.find((e) => e.id === id)!.data as Record<string, unknown>
const edge = (id: string) => S().edges.find((e) => e.id === id)!

function pools() {
  S().newGraph()
  S().addNodeAt('pool', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 200, y: 0 })
  S().addNodeAt('gate', { x: 400, y: 0 })
  const [a, b, g] = S().nodes
  return { a: a!.id, b: b!.id, g: g!.id }
}

beforeEach(() => S().newGraph())

describe('drawing takes the chosen kind', () => {
  it('a state handle does not make a flow a state connection, and a face is only a position', () => {
    const { a, b } = pools()
    const v = S().onConnect({ source: a, target: b, sourceHandle: 'out@bottom', targetHandle: 'in' }, 'flow')
    expect(v).toEqual({ ok: true })
    const e = S().edges[0]!
    expect([e.sourceHandle, e.targetHandle, (e.data as { kind?: string }).kind, faceOf(e, 'source')]).toEqual(['out', 'in', 'resource', 'bottom'])
  })

  it('a refused drawing makes nothing, records nothing, resets no run, and is not made as another kind', () => {
    const { a, g } = pools()
    const past = S().past.length
    const rev = S().simulationRev
    const v = S().onConnect({ source: a, target: g, sourceHandle: 'state-source', targetHandle: 'state-target' }, 'change')
    expect(v).toMatchObject({ ok: false, reason: 'changePool', end: 'target', node: g })
    expect(S().edges).toHaveLength(0)
    expect([S().past.length, S().simulationRev]).toEqual([past, rev])
  })
})

describe('setEdgeKind', () => {
  it('rewrites the handles, keeps route, bends, colour and faces, and is ONE undo step', () => {
    const { a, b } = pools()
    S().onConnect({ source: a, target: b, sourceHandle: 'out@bottom', targetHandle: 'in@top' }, 'flow')
    const id = S().edges[0]!.id
    S().setEdgeRouting(id, { route: 'orthogonal', waypoints: [{ x: 100, y: 120 }] })
    S().setAccent([], [id], '#A78243')
    const past = S().past.length
    expect(S().setEdgeKind(id, 'change')).toEqual({ ok: true })
    const e = edge(id)
    expect([e.sourceHandle, e.targetHandle]).toEqual(['state-source', 'state-target'])
    expect([data(id).kind, data(id).mode, data(id).route, data(id).waypoints, data(id).accent]).toEqual(['state', 'label', 'orthogonal', [{ x: 100, y: 120 }], '#A78243'])
    expect([faceOf(e, 'source'), faceOf(e, 'target')]).toEqual(['bottom', 'top'])
    expect(S().past.length).toBe(past + 1)
    S().undo()
    expect([edge(id).sourceHandle, data(id).kind, data(id).accent, faceOf(edge(id), 'source')]).toEqual(['out', 'resource', '#A78243', 'bottom'])
  })

  it('a kind the ends cannot take is refused with its reason, and nothing changes', () => {
    const { a, g } = pools()
    S().onConnect({ source: a, target: g, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    const id = S().edges[0]!.id
    const before = JSON.stringify(edge(id))
    const past = S().past.length
    expect(S().setEdgeKind(id, 'change')).toMatchObject({ ok: false, reason: 'changePool', node: g })
    expect([JSON.stringify(edge(id)), S().past.length]).toEqual([before, past])
  })

  // 2026-10-20 (label-timing e2e): the change was judged as a NEW drawing, with
  // the kind's default data, so a Value change kept "when the source fires"
  // was refused at a Gate as if it applied always
  it('judged as the connection would be: a Gate-sourced Value change applied when the source fires goes to Trigger and back, its timing kept', () => {
    const { b, g } = pools()
    S().loadDoc(
      {
        nodes: S().nodes,
        edges: [{ id: 'm', source: g, target: b, sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+2', timing: 'afterPull', when: 'source-fired' } }] as never,
      },
      { mode: 'document-boundary', canvasLocked: false },
    )
    expect(S().setEdgeKind('m', 'trigger')).toEqual({ ok: true })
    expect(S().setEdgeKind('m', 'change')).toEqual({ ok: true })
    expect([data('m').mode, data('m').expr, data('m').timing, data('m').when]).toEqual(['label', '+2', 'afterPull', 'source-fired'])
  })

  it('and an always-applied Value change still cannot start at a Gate', () => {
    const { b, g } = pools()
    S().loadDoc(
      {
        nodes: S().nodes,
        edges: [{ id: 't', source: g, target: b, sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'trigger', expr: '' } }] as never,
      },
      { mode: 'document-boundary', canvasLocked: false },
    )
    expect(S().setEdgeKind('t', 'change')).toMatchObject({ ok: false, reason: 'changePool' })
    expect(data('t').mode).toBe('trigger')
  })
})
