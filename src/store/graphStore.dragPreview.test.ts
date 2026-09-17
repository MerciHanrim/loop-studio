import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdgeData } from '../model/types'
import { useGraphStore } from './graphStore'
import { __resetRouteCache, __routeGenCount, currentRouteMap } from './routeMap'

// docs/edge-routing-drag-preview.md — the drag-time route preview slice.
// §DP4: it starts on the first `dragging: true` position change (capturing
// the canonical map of the layout BEFORE the change), survives further moves
// and `select` changes, and ends — in the same update — on the drop, a
// removal, any edge change, undo, a document load, or `endDragPreview`
// (focus loss). §DP3.4 / DP-INV-4: no generation per move after the first,
// one at termination, and that one equals a cold recompute (DP-INV-2).
// DP-INV-3: nothing of it reaches the serialised document.

type Change = Parameters<ReturnType<typeof useGraphStore.getState>['onNodesChange']>[0][number]

const g = () => useGraphStore.getState()
const move = (id: string, x: number, y: number, dragging: boolean): Change => ({
  type: 'position',
  id,
  position: { x, y },
  dragging,
})

/** source → pool → drain, both edges orthogonal, plus a free obstacle */
function setup() {
  g().newGraph()
  g().addNodeAt('source', { x: 0, y: 0 })
  g().addNodeAt('pool', { x: 300, y: 120 })
  g().addNodeAt('drain', { x: 600, y: 0 })
  g().addNodeAt('pool', { x: 300, y: -300 })
  const [s, p, d, obst] = g().nodes
  g().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  g().onConnect({ source: p.id, target: d.id, sourceHandle: 'out', targetHandle: 'in' })
  const [e1, e2] = g().edges
  g().setEdgeData(e1.id, { ...e1.data, route: 'orthogonal' } as LoopEdgeData)
  g().setEdgeData(e2.id, { ...e2.data, route: 'orthogonal' } as LoopEdgeData)
  // the render before a gesture would have built this generation
  currentRouteMap(g().nodes, g().edges)
  return { s: s.id, p: p.id, d: d.id, obst: obst.id, e1: e1.id, e2: e2.id }
}

const routesOf = (map: ReadonlyMap<string, { d: string }>) =>
  Object.fromEntries([...map.entries()].map(([id, r]) => [id, r.d]))

beforeEach(() => {
  __resetRouteCache()
  g().newGraph()
})

describe('dragPreview — lifecycle', () => {
  it('is null outside a gesture and starts on the first dragging:true change with the pre-change map', () => {
    const ids = setup()
    expect(g().dragPreview).toBeNull()
    const before = currentRouteMap(g().nodes, g().edges)
    const gen = __routeGenCount()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    const pv = g().dragPreview
    expect(pv).not.toBeNull()
    expect([...pv!.nodeIds]).toEqual([ids.p])
    expect(pv!.frozenMap).toBe(before) // the OBJECT, not a re-derived map
    expect(pv!.baseEdges).toBe(g().edges)
    expect(__routeGenCount()).toBe(gen) // a warm cache: no generation at start
    expect(g().nodes.find((n) => n.id === ids.p)!.position).toEqual({ x: 320, y: 130 })
  })

  it('further moves keep the same frozen map and build no generation; a select change is neutral', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    const pv = g().dragPreview!
    const gen = __routeGenCount()
    g().onNodesChange([move(ids.p, 340, 140, true)])
    g().onNodesChange([{ type: 'select', id: ids.p, selected: true }])
    g().onNodesChange([move(ids.p, 360, 150, true), { type: 'select', id: ids.s, selected: false }])
    expect(g().dragPreview!.frozenMap).toBe(pv.frozenMap)
    expect(__routeGenCount()).toBe(gen)
  })

  it('a multi-select drag accumulates every dragged id', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    g().onNodesChange([move(ids.p, 330, 130, true), move(ids.s, 10, 0, true)])
    expect([...g().dragPreview!.nodeIds].sort()).toEqual([ids.p, ids.s].sort())
  })

  it('the drop clears the preview in the same update; the next generation equals a cold recompute', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    g().onNodesChange([move(ids.p, 400, 200, true)])
    const gen = __routeGenCount()
    g().onNodesChange([move(ids.p, 400, 200, false)])
    expect(g().dragPreview).toBeNull()
    const after = currentRouteMap(g().nodes, g().edges)
    expect(__routeGenCount()).toBe(gen + 1)
    __resetRouteCache()
    const cold = currentRouteMap(g().nodes, g().edges)
    expect(routesOf(after)).toEqual(routesOf(cold))
    // the route really moved with the node (the frozen one was not kept)
    expect(after.get(ids.e1)!.d).not.toBe(g().dragPreview?.frozenMap.get(ids.e1)?.d ?? '')
  })

  it('a press-and-release without movement still terminates and still matches a cold recompute (≤ 1 generation)', () => {
    const ids = setup()
    const p0 = g().nodes.find((n) => n.id === ids.p)!.position
    const gen = __routeGenCount()
    g().onNodesChange([move(ids.p, p0.x, p0.y, true), move(ids.p, p0.x, p0.y, false)])
    expect(g().dragPreview).toBeNull()
    const after = currentRouteMap(g().nodes, g().edges)
    expect(__routeGenCount() - gen).toBeLessThanOrEqual(1)
    __resetRouteCache()
    expect(routesOf(after)).toEqual(routesOf(currentRouteMap(g().nodes, g().edges)))
  })
})

describe('dragPreview — every other termination', () => {
  it('a remove change and removeNode of a dragged node clear it', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    g().onNodesChange([{ type: 'remove', id: ids.obst }])
    expect(g().dragPreview).toBeNull()

    g().onNodesChange([move(ids.p, 330, 130, true)])
    expect(g().dragPreview).not.toBeNull()
    g().removeNode(ids.p)
    expect(g().dragPreview).toBeNull()
  })

  it('any edge replacement clears it: setEdgeData, onConnect, removeEdge, onEdgesChange', () => {
    const ids = setup()
    const start = () => {
      g().onNodesChange([move(ids.p, 320, 130, true)])
      expect(g().dragPreview).not.toBeNull()
    }
    start()
    const e1 = g().edges.find((e) => e.id === ids.e1)!
    g().setEdgeData(ids.e1, { ...e1.data, route: undefined } as LoopEdgeData)
    expect(g().dragPreview).toBeNull()

    start()
    g().onConnect({ source: ids.s, target: ids.d, sourceHandle: 'out', targetHandle: 'in' })
    expect(g().dragPreview).toBeNull()

    start()
    g().removeEdge(ids.e2)
    expect(g().dragPreview).toBeNull()

    start()
    g().onEdgesChange([{ type: 'select', id: ids.e1, selected: true }])
    expect(g().dragPreview).toBeNull() // applyEdgeChanges returns a new array ⇒ edge identity changed
  })

  it('undo, newGraph and loadDoc clear it', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    g().undo()
    expect(g().dragPreview).toBeNull()

    setup()
    const ids2 = { p: g().nodes[1].id }
    g().onNodesChange([move(ids2.p, 320, 130, true)])
    expect(g().dragPreview).not.toBeNull()
    g().loadDoc({ nodes: g().nodes, edges: g().edges })
    expect(g().dragPreview).toBeNull()

    setup()
    g().onNodesChange([move(g().nodes[1].id, 320, 130, true)])
    g().newGraph()
    expect(g().dragPreview).toBeNull()
  })

  it('endDragPreview: a no-op without a preview; with one it clears and closes the move-history tag', () => {
    const ids = setup()
    // history is capped (HISTORY_MAX), so entries are compared by identity of
    // the newest one: a push changes it, a coalesced move does not
    const newest = () => g().past[g().past.length - 1]
    const h0 = newest()
    g().endDragPreview()
    expect(newest()).toBe(h0)

    g().onNodesChange([move(ids.p, 320, 130, true)])
    const h1 = newest()
    expect(h1).not.toBe(h0) // the gesture's one history entry
    g().onNodesChange([move(ids.p, 330, 130, true)])
    expect(newest()).toBe(h1) // coalesced within COALESCE_MS
    g().endDragPreview()
    expect(g().dragPreview).toBeNull()
    // the resumed gesture is a NEW segment and a NEW undo step
    g().onNodesChange([move(ids.p, 340, 130, true)])
    expect(g().dragPreview).not.toBeNull()
    expect(newest()).not.toBe(h1)
  })
})

describe('dragPreview — never persisted', () => {
  it('the exported document carries no preview and equals the post-drop export apart from nothing', () => {
    const ids = setup()
    g().onNodesChange([move(ids.p, 320, 130, true)])
    const during = g().exportJSON()
    expect(during).not.toContain('dragPreview')
    expect(during).not.toContain('frozenMap')
    g().onNodesChange([move(ids.p, 320, 130, false)])
    const after = g().exportJSON()
    expect(after).toBe(during)
  })
})
