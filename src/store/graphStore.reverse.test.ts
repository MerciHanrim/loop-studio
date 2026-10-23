import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'
import { reversedEdge, reverseVerdict } from '../model/reverse'
import type { LoopEdge, LoopNode } from '../model/types'

// docs/edge-routing.md §ER19 — reversing a connection's direction: the one
// check, the one change, its history and its run.

const S = () => useGraphStore.getState()
const rev = () => S().simulationRev
const edge = (id: string) => S().edges.find((e) => e.id === id)!
const past = () => S().past.length

const node = (id: string, kind: string): LoopNode => ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id } }) as unknown as LoopNode
const res = (id: string, source: string, target: string, data: object = {}): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...data } }) as unknown as LoopEdge
const st = (id: string, source: string, target: string, data: object): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', expr: '', ...data } }) as unknown as LoopEdge

const NODES = [node('src', 'source'), node('p1', 'pool'), node('p2', 'pool'), node('g', 'gate'), node('c', 'converter'), node('d', 'drain'), node('end', 'end')]

describe('reversedEdge — what a reversal changes', () => {
  it('swaps the ends and their sides, reverses the bends, keeps the id, handles and every data field', () => {
    const e = res('e', 'p1', 'p2', { flow: '25%', accent: '#638EA5', resourceType: 'gold', route: 'orthogonal', waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }], ports: { target: 'top' } })
    const r = reversedEdge(e)
    expect([r.id, r.source, r.target, r.sourceHandle, r.targetHandle]).toEqual(['e', 'p2', 'p1', 'out', 'in'])
    // the old target arrived at the top of p2: the new source leaves p2 from the top; p1 kept its right side
    expect(r.data).toEqual({ kind: 'resource', flow: '25%', accent: '#638EA5', resourceType: 'gold', route: 'orthogonal', waypoints: [{ x: 3, y: 4 }, { x: 1, y: 2 }], ports: { source: 'top', target: 'right' } })
  })

  it('a default connection stores both swapped sides; reversing twice is the connection as it was', () => {
    const e = res('e', 'p1', 'p2')
    expect((reversedEdge(e).data as { ports?: unknown }).ports).toEqual({ source: 'left', target: 'right' })
    expect(reversedEdge(reversedEdge(e))).toEqual(e)
    const s = st('s', 'p1', 'g', { mode: 'trigger' })
    expect((reversedEdge(s).data as { ports?: unknown }).ports).toEqual({ source: 'top', target: 'bottom' })
    expect(reversedEdge(reversedEdge(s))).toEqual(s)
  })
})

describe('reverseVerdict — resource connections: ports and the drawing rule', () => {
  const v = (e: LoopEdge, more: LoopEdge[] = []) => reverseVerdict(NODES, [e, ...more], e.id)
  it('accepts a reversal between nodes that have both ports', () => {
    expect(v(res('e', 'p1', 'g'))).toEqual({ ok: true, same: false, nodeChanged: true })
    expect(v(res('e', 'c', 'p1'))).toEqual({ ok: true, same: false, nodeChanged: true })
  })
  it('refuses a Source as the new target (no input) and a Drain or an End as the new source (no output)', () => {
    expect(v(res('e', 'src', 'p1'))).toEqual({ ok: false, reason: 'noInput', end: 'target', node: 'src' })
    expect(v(res('e', 'p1', 'd'))).toEqual({ ok: false, reason: 'noOutput', end: 'source', node: 'd' })
    expect(v(res('e', 'g', 'end'))).toEqual({ ok: false, reason: 'noOutput', end: 'source', node: 'end' })
  })
  it('refuses a result that repeats another connection drawn the same way', () => {
    expect(v(res('e', 'p1', 'p2'), [res('back', 'p2', 'p1')])).toEqual({ ok: false, reason: 'duplicate', end: 'source', node: 'p2' })
    // a state connection the other way is not the same handles
    expect(v(res('e', 'p1', 'p2'), [st('s', 'p2', 'p1', { mode: 'trigger' })]).ok).toBe(true)
  })
  it('leaves a loop of routers or a probabilistic Gate weight to the engine (Lumi, 2026-10-14)', () => {
    // g → c reversed closes c → g beside g → c: a loop with no Pool, still accepted
    expect(reverseVerdict(NODES, [res('e', 'g', 'c'), res('k', 'g', 'c', { flow: '2' })], 'e').ok).toBe(true)
  })
})

describe('reverseVerdict — state connections: judged on the result by the engine rules', () => {
  const v = (e: LoopEdge, more: LoopEdge[] = []) => reverseVerdict(NODES, [e, ...more], e.id)
  it('a trigger: any nodes', () => {
    expect(v(st('s', 'src', 'd', { mode: 'trigger' })).ok).toBe(true)
  })
  it('an activator needs a Pool source after the reversal', () => {
    expect(v(st('s', 'p1', 'g', { mode: 'activator', expr: '>= 1' }))).toEqual({ ok: false, reason: 'activatorSource', end: 'source', node: 'g' })
    // one with no effect today (a Gate source) that works reversed is accepted
    expect(v(st('s', 'g', 'p1', { mode: 'activator', expr: '>= 1' })).ok).toBe(true)
  })
  it('an "Always" label needs a Pool at both ends', () => {
    expect(v(st('s', 'p1', 'p2', { mode: 'label', expr: '+1' })).ok).toBe(true)
    expect(v(st('s', 'p1', 'g', { mode: 'label', expr: '+1' }))).toEqual({ ok: false, reason: 'labelPool', end: 'source', node: 'g' })
    expect(v(st('s', 'g', 'p1', { mode: 'label', expr: '+1', timing: 'phase0' }))).toEqual({ ok: false, reason: 'labelPool', end: 'target', node: 'g' })
  })
  it('a "When the source fires" label needs a router source and a Pool target: a working one is always refused', () => {
    const fired = { mode: 'label', expr: '+1', timing: 'afterPull', when: 'source-fired' }
    expect(v(st('s', 'g', 'p1', fired))).toEqual({ ok: false, reason: 'labelRouterSource', end: 'source', node: 'p1' })
    expect(v(st('s', 'g', 'c', fired))).toEqual({ ok: false, reason: 'labelTarget', end: 'target', node: 'g' })
    expect(v(st('s', 'p1', 'c', fired)).ok, 'no effect today, works reversed').toBe(true)
  })
  it('a mode or a timing that never has an effect is refused', () => {
    expect(v(st('s', 'p1', 'p2', { mode: 'node', expr: '+1' }))).toEqual({ ok: false, reason: 'stateMode', end: 'source', node: 'p2' })
    expect(v(st('s', 'p1', 'p2', { mode: 'label', expr: '+1', timing: 'phase0', when: 'source-fired' }))).toMatchObject({ ok: false, reason: 'stateMode' })
  })
  it('ports, then the repeat, then the state rule', () => {
    const act = st('s', 'p1', 'g', { mode: 'activator', expr: '>= 1' })
    expect(v(act, [st('t', 'g', 'p1', { mode: 'label', expr: '+1', timing: 'afterPull', when: 'source-fired' })])).toMatchObject({ ok: false, reason: 'duplicate' })
  })
})

/** Pool a, Pool b, Source s, Drain d; a → b resource with an amount, a colour and two user bends */
function graph() {
  S().newGraph()
  for (const [k, x] of [['pool', 0], ['pool', 320], ['source', 0], ['drain', 640]] as const) S().addNodeAt(k, { x, y: k === 'pool' ? 0 : 300 })
  const [a, b, s, d] = S().nodes.map((n) => n.id)
  S().onConnect({ source: a!, target: b!, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  const e = S().edges[0]!.id
  S().setEdgeData(e, { ...(edge(e).data as object), flow: '3', accent: '#638EA5' } as never)
  S().setEdgeRouting(e, { route: 'orthogonal', waypoints: [{ x: 160, y: 120 }, { x: 200, y: 120 }] })
  return { a: a!, b: b!, s: s!, d: d!, e }
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
})

describe('reverseEdge — the store action', () => {
  it('one undo step, the run reset; undo and redo restore each side exactly', () => {
    const { a, b, e } = graph()
    const before = edge(e)
    const r0 = rev()
    const p0 = past()
    expect(S().reverseEdge(e)).toEqual({ ok: true, same: false, nodeChanged: true })
    const after = edge(e)
    expect([after.id, after.source, after.target, after.sourceHandle, after.targetHandle]).toEqual([e, b, a, 'out', 'in'])
    expect(after.data).toEqual({ ...(before.data as object), waypoints: [{ x: 200, y: 120 }, { x: 160, y: 120 }], ports: { source: 'left', target: 'right' } })
    expect(rev()).toBe(r0 + 1)
    expect(past()).toBe(p0 + 1)
    S().undo()
    expect(edge(e)).toEqual(before)
    expect(rev(), 'undoing a reversal is a model change too').toBe(r0 + 2)
    S().redo()
    expect(edge(e)).toEqual(after)
  })

  it('refused: the reason, nothing recorded, the run kept', () => {
    const { s, a, d, b } = graph()
    S().onConnect({ source: s, target: a, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    S().onConnect({ source: b, target: d, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    const fromSource = S().edges.find((x) => x.source === s)!.id
    const intoDrain = S().edges.find((x) => x.target === d)!.id
    const r0 = rev()
    const p0 = past()
    expect(S().reverseEdge(fromSource)).toEqual({ ok: false, reason: 'noInput', end: 'target', node: s })
    expect(S().reverseEdge(intoDrain)).toEqual({ ok: false, reason: 'noOutput', end: 'source', node: d })
    expect([rev(), past()]).toEqual([r0, p0])
  })

  it('under the edit lock: nothing', () => {
    const { e } = graph()
    const before = edge(e)
    const p0 = past()
    useUiStore.getState().setCanvasLocked(true)
    expect(S().reverseEdge(e)).toBeNull()
    expect(edge(e)).toBe(before)
    expect(past()).toBe(p0)
  })

  it('a self-loop keeps its node: its sides swap, the run is kept', () => {
    const { a, e } = graph()
    S().moveEdgeEnds(e, { target: { node: a, face: 'top' } })
    const r0 = rev()
    const v = S().reverseEdge(e)
    expect(v).toEqual({ ok: true, same: false, nodeChanged: false })
    expect((edge(e).data as { ports?: unknown }).ports).toEqual({ source: 'top', target: 'right' })
    expect(rev()).toBe(r0)
  })
})
