import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { useGraphStore } from './graphStore'
import { __resetRouteCache, currentRouteGeneration, routeDiagnostics, setRouteLabelSize, setRouteRunFormSize } from './routeMap'

// issue #617 item 6 — the layout signature holds everything a generation reads:
// a chip that now prints a unit (the end-room pass reads it) and a Value change
// that is no longer one (the run-form groups read `kind` and `mode`) each give a
// new generation, on the paths that change them in the app.

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const flow = (id: string, s: string, t: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '21000', route: 'orthogonal', unit: 'CMD' } }) as unknown as LoopEdge
const change = (id: string, s: string, t: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+1' } }) as unknown as LoopEdge

beforeEach(() => {
  __resetRouteCache()
})

describe('#617 item 6 — what the layout signature leaves out', () => {
  it('a chip that starts printing its unit, at the same size, is placed again (LoopEdge reports it with setRouteLabelSize)', () => {
    const nodes = [node('a', 0, 0), node('b', 170, 0)]
    const edges = [flow('e', 'a', 'b')]
    setRouteLabelSize('e', 90, 19, false)
    expect(currentRouteGeneration(nodes, edges).map.get('e')!.beside).toBeUndefined()
    // the same size, now printing its unit: the end-room pass moves it off its short line
    setRouteLabelSize('e', 90, 19, true)
    const after = currentRouteGeneration(nodes, edges).map.get('e')!
    expect(after.beside).toBeDefined()
    // the same as a generation computed from scratch for this input
    __resetRouteCache()
    setRouteLabelSize('e', 90, 19, true)
    expect(currentRouteGeneration(nodes, edges).map.get('e')!.label).toEqual(after.label)
  })

  it('a Value change made a Trigger in the Inspector (setEdgeKind) leaves its group, and the labels are placed again', () => {
    const nodes = [node('feed', 0, 0), node('tank', 640, 0)]
    useGraphStore.setState({ nodes: nodes as never, edges: [change('m1', 'feed', 'tank'), change('m2', 'feed', 'tank')] as never, canvasLocked: false } as never)
    for (const id of ['m1', 'm2']) {
      setRouteLabelSize(id, 30, 19)
      setRouteRunFormSize(id, 160, 43)
    }
    const g0 = useGraphStore.getState()
    currentRouteGeneration(g0.nodes, g0.edges)
    expect(routeDiagnostics().runForm.groups).toBe(1)

    const verdict = useGraphStore.getState().setEdgeKind('m2', 'trigger' as never)
    const g1 = useGraphStore.getState()
    const m2 = g1.edges.find((e) => e.id === 'm2')!
    expect((m2.data as { mode?: string }).mode, JSON.stringify(verdict)).toBe('trigger')
    // the ends and handles are unchanged: nothing else in the signature moved
    expect([m2.sourceHandle, m2.targetHandle]).toEqual(['state-source', 'state-target'])
    const after = currentRouteGeneration(g1.nodes, g1.edges)
    expect(routeDiagnostics().runForm.groups).toBe(0)
    // the same as a generation computed from scratch for this input (Curved lines:
    // their chips are the generation's free slots)
    const m1 = after.free.get('m1')
    expect(m1).toBeDefined()
    __resetRouteCache()
    for (const id of ['m1', 'm2']) {
      setRouteLabelSize(id, 30, 19)
      setRouteRunFormSize(id, 160, 43)
    }
    expect(currentRouteGeneration(g1.nodes, g1.edges).free.get('m1')).toEqual(m1)
  })
})
