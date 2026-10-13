import mmoDoc from '../../examples/mmo-progression.json'
import stateDoc from '../../examples/state-verification.json'
import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { deserialize, serialize } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'
import { duplicateOf, endMoveVerdict, portRefusal } from '../model/endMove'

// docs/edge-routing.md §ER18 — moving an existing connection's end: the one
// check, the one change, its history and its run.

const S = () => useGraphStore.getState()
const rev = () => S().simulationRev
const edge = (id: string) => S().edges.find((e) => e.id === id)!
const past = () => S().past.length

/** Source a, Pool b, Pool c, Drain d, Parameter p; a → b resource with a
 *  colour, an amount and a user bend */
function graph() {
  S().newGraph()
  for (const [k, x] of [['source', 0], ['pool', 320], ['pool', 640], ['drain', 960], ['parameter', 0]] as const) S().addNodeAt(k, { x, y: k === 'parameter' ? 300 : 0 })
  const [a, b, c, d, p] = S().nodes.map((n) => n.id)
  S().onConnect({ source: a!, target: b!, sourceHandle: 'out', targetHandle: 'in' })
  const e = S().edges[0]!.id
  S().setEdgeData(e, { ...(edge(e).data as object), flow: '3', accent: '#638EA5' } as never)
  S().setEdgeRouting(e, { route: 'orthogonal', waypoints: [{ x: 224, y: 120 }] })
  return { a: a!, b: b!, c: c!, d: d!, p: p!, e }
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
})

describe('portRefusal — the port a connection needs at an end', () => {
  it('resource: a Source has no input, a Drain and an End no output; state: every node of the flow; a Parameter or Register none', () => {
    expect(portRefusal('source', 'resource', 'target')).toBe('noInput')
    expect(portRefusal('drain', 'resource', 'source')).toBe('noOutput')
    expect(portRefusal('end', 'resource', 'source')).toBe('noOutput')
    for (const k of ['pool', 'gate', 'converter']) {
      expect(portRefusal(k, 'resource', 'source')).toBeNull()
      expect(portRefusal(k, 'resource', 'target')).toBeNull()
    }
    for (const k of ['source', 'drain', 'end', 'pool', 'gate', 'converter']) expect(portRefusal(k, 'state', 'source')).toBeNull()
    expect(portRefusal('parameter', 'state', 'target')).toBe('noPorts')
    expect(portRefusal('register', 'resource', 'source')).toBe('noPorts')
  })
})

describe('moveEdgeEnds — a side of the same node', () => {
  it('changes only the side: id, kind, handles, amount, colour, shape and bends are kept; the run is kept; one undo step', () => {
    const { e, b } = graph()
    const before = edge(e)
    const r0 = rev()
    const p0 = past()
    const v = S().moveEdgeEnds(e, { target: { node: b, face: 'top' } })
    expect(v).toEqual({ ok: true, same: false, nodeChanged: false })
    const after = edge(e)
    expect(after.id).toBe(before.id)
    expect([after.source, after.target, after.sourceHandle, after.targetHandle]).toEqual([before.source, before.target, 'out', 'in'])
    expect(after.data).toEqual({ ...(before.data as object), ports: { target: 'top' } })
    expect(rev(), 'a side is drawing: the run is kept').toBe(r0)
    expect(past()).toBe(p0 + 1)
    S().undo()
    expect(edge(e).data).toEqual(before.data)
    expect(rev(), 'undoing a side-only move keeps the run too').toBe(r0)
    S().redo()
    expect((edge(e).data as { ports?: unknown }).ports).toEqual({ target: 'top' })
  })

  it('back to the default side stores no side (the canonical form)', () => {
    const { e, b } = graph()
    S().moveEdgeEnds(e, { target: { node: b, face: 'top' } })
    S().moveEdgeEnds(e, { target: { node: b, face: 'left' } })
    expect('ports' in (edge(e).data as object)).toBe(false)
  })
})

describe('moveEdgeEnds — another node', () => {
  it('moves the end, keeps every data field and the user bend, resets the run, one undo step', () => {
    const { e, c } = graph()
    const before = edge(e)
    const r0 = rev()
    const p0 = past()
    const v = S().moveEdgeEnds(e, { target: { node: c, face: 'top' } })
    expect(v).toEqual({ ok: true, same: false, nodeChanged: true })
    expect(edge(e).target).toBe(c)
    expect(edge(e).data).toEqual({ ...(before.data as object), ports: { target: 'top' } })
    expect((edge(e).data as { waypoints?: unknown }).waypoints, 'the user bend is never removed').toEqual([{ x: 224, y: 120 }])
    expect(rev()).toBe(r0 + 1)
    expect(past()).toBe(p0 + 1)
    S().undo()
    expect(edge(e).target).toBe(before.target)
    expect(edge(e).data).toEqual(before.data)
  })

  it('both ends in one move is one undo step', () => {
    const { e, b, c } = graph()
    const p0 = past()
    S().moveEdgeEnds(e, { source: { node: b, face: 'bottom' }, target: { node: c, face: 'left' } })
    expect([edge(e).source, edge(e).target]).toEqual([b, c])
    expect((edge(e).data as { ports?: unknown }).ports).toEqual({ source: 'bottom' })
    expect(past()).toBe(p0 + 1)
  })
})

describe('moveEdgeEnds — refused, the same, locked: nothing recorded, the run kept', () => {
  it('a node without the port: the reason, and nothing changes', () => {
    const { e, a, d, p } = graph()
    const before = edge(e)
    const r0 = rev()
    const p0 = past()
    expect(S().moveEdgeEnds(e, { target: { node: a, face: 'left' } })).toEqual({ ok: false, reason: 'noInput', end: 'target', node: a })
    expect(S().moveEdgeEnds(e, { source: { node: d, face: 'right' } })).toEqual({ ok: false, reason: 'noOutput', end: 'source', node: d })
    expect(S().moveEdgeEnds(e, { target: { node: p, face: 'left' } })).toEqual({ ok: false, reason: 'noPorts', end: 'target', node: p })
    expect(edge(e)).toBe(before)
    expect([rev(), past()]).toEqual([r0, p0])
  })

  it('the same ends as now: ok and same, nothing recorded', () => {
    const { e, a, b } = graph()
    const p0 = past()
    const r0 = rev()
    expect(S().moveEdgeEnds(e, { source: { node: a, face: 'right' }, target: { node: b, face: 'left' } })).toEqual({ ok: true, same: true, nodeChanged: false })
    expect([rev(), past()]).toEqual([r0, p0])
  })

  it('under the edit lock: nothing', () => {
    const { e, c } = graph()
    useUiStore.getState().setCanvasLocked(true)
    const before = edge(e)
    expect(S().moveEdgeEnds(e, { target: { node: c, face: 'left' } })).toBeNull()
    expect(edge(e)).toBe(before)
  })
})

describe('the duplicate rule — the drawing rule, only when a node changes, never against itself', () => {
  it('moving onto a pair already joined with the same handles is refused; a side change on a parallel connection is not', () => {
    const { e, a, c } = graph()
    // a second connection a → c (resource, out / in)
    S().onConnect({ source: a, target: c, sourceHandle: 'out', targetHandle: 'in' })
    const other = S().edges.find((x) => x.target === c)!.id
    const p0 = past()
    expect(S().moveEdgeEnds(e, { target: { node: c, face: 'top' } })).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: c })
    expect(past()).toBe(p0)
    // a side change of `other` (its pair a → c is unchanged): never a duplicate
    expect(S().moveEdgeEnds(other, { target: { node: c, face: 'bottom' } })?.ok).toBe(true)
  })

  it('parallel connections as the examples hold them (two state connections, the same ends and handles): each can change its side', () => {
    const { b, c } = graph()
    S().onConnect({ source: b, target: c, sourceHandle: 'state-source', targetHandle: 'state-target' })
    const s1 = S().edges[S().edges.length - 1]!
    // the second one as a file brings it (drawing would refuse it)
    useGraphStore.setState({ edges: [...S().edges, { ...s1, id: 's2' }] })
    expect(S().moveEdgeEnds('s2', { source: { node: b, face: 'right' } })?.ok).toBe(true)
    expect(S().moveEdgeEnds(s1.id, { target: { node: c, face: 'left' } })?.ok).toBe(true)
  })

  it('a resource and a state connection between the same nodes differ in handles: not duplicates', () => {
    const { e, a, b } = graph()
    expect(duplicateOf(S().edges, { source: a, target: b, sourceHandle: 'state-source', targetHandle: 'state-target' })).toBeUndefined()
    expect(duplicateOf(S().edges, { source: a, target: b, sourceHandle: 'out', targetHandle: 'in' })?.id).toBe(e)
    expect(duplicateOf(S().edges, { source: a, target: b, sourceHandle: 'out', targetHandle: 'in' }, e)).toBeUndefined()
  })

  it('a refused drawing of a duplicate records nothing and keeps the run', () => {
    const { a, b } = graph()
    const n0 = S().edges.length
    const p0 = past()
    const r0 = rev()
    S().onConnect({ source: a, target: b, sourceHandle: 'out@top', targetHandle: 'in' })
    expect(S().edges.length).toBe(n0)
    expect([rev(), past()]).toEqual([r0, p0])
  })

  it('a self-loop is allowed, as when drawing', () => {
    const { e, b } = graph()
    expect(endMoveVerdict(S().nodes, S().edges, e, { source: { node: b, face: 'right' } }).ok).toBe(true)
  })
})

describe('the duplicate rule on the shipped examples (their parallel connections)', () => {
  const load = (file: string) => {
    const text = JSON.stringify(file === 'mmo-progression.json' ? mmoDoc : stateDoc)
    S().loadJSON(text)
    // the MMO example opens locked (its own `canvasLocked`); unlock as a user does
    useUiStore.getState().setCanvasLocked(false)
  }

  it('state-verification: two state connections with the same ends and handles each change side; neither may move onto the other pair by node', () => {
    load('state-verification.json')
    const a = edge('t_pd_a')
    const b = edge('t_pd_b')
    expect([a.source, a.target, a.sourceHandle, a.targetHandle]).toEqual([b.source, b.target, b.sourceHandle, b.targetHandle])
    // 1. a side-only change is never a duplicate, though its twin has the same ends and handles
    expect(S().moveEdgeEnds('t_pd_a', { source: { node: a.source, face: 'right' } })?.ok).toBe(true)
    expect(S().moveEdgeEnds('t_pd_b', { target: { node: b.target, face: 'left' } })?.ok).toBe(true)
  })

  it('MMO: a resource and a state connection between the same two nodes are not duplicates of each other', () => {
    load('mmo-progression.json')
    const res = edge('e_repair_wear_in')
    const st = edge('a_repair_wear')
    expect([res.source, res.target]).toEqual([st.source, st.target])
    // 2. the moved connection never counts against itself, and a different kind is a different channel
    expect(duplicateOf(S().edges, res, res.id)).toBeUndefined()
    expect(duplicateOf(S().edges, st, st.id)).toBeUndefined()
    expect(S().moveEdgeEnds(res.id, { target: { node: res.target, face: 'top' } })?.ok).toBe(true)
  })

  it('MMO: moving one of the `_lo` / `_hi` pair onto the other end node by a node change keeps the drawing rule', () => {
    load('mmo-progression.json')
    const lo = edge('a_z2_xp_meter_lo')
    const hi = edge('a_z2_xp_meter_hi')
    expect([lo.source, lo.target]).toEqual([hi.source, hi.target])
    // 3. a side change of either is allowed
    expect(S().moveEdgeEnds(lo.id, { target: { node: lo.target, face: 'left' } })?.ok).toBe(true)
    // 4. a node change that lands on a pair joined with the same handles is refused, with the reason, recording nothing
    const other = S().edges.find((e) => e.source === lo.source && e.target !== lo.target && e.sourceHandle === lo.sourceHandle && e.targetHandle === lo.targetHandle)!
    const p0 = past()
    const v = S().moveEdgeEnds(lo.id, { target: { node: other.target, face: 'top' } })
    expect(v).toEqual({ ok: false, reason: 'duplicate', end: 'target', node: other.target })
    expect(past()).toBe(p0)
  })
})

describe('save and reopen', () => {
  it('a moved end and side survive serialize → deserialize', () => {
    const { e, c } = graph()
    S().moveEdgeEnds(e, { target: { node: c, face: 'bottom' } })
    const back = deserialize(serialize(S().nodes, S().edges)).edges.find((x) => x.id === e)!
    expect(back.target).toBe(c)
    expect(back.data).toEqual(edge(e).data)
  })
})
