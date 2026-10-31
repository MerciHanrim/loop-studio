import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// #420 follow-up to #449 (Lumi, 2026-10-31) — a data edit that changes no field
// does NOTHING. #449 stopped it recording an Undo entry, but the call still
// replaced the data, reset the run and saved: passing a connection's unchanged
// data reset the run with no Undo entry to explain it. Now `updateNodeData` and
// `setEdgeData` return before any state change, run reset or save when no field
// differs.

const S = () => useGraphStore.getState()
const node = (id: string) => S().nodes.find((n) => n.id === id)!.data as unknown as Record<string, unknown>
const edge = (id: string) => S().edges.find((e) => e.id === id)!.data as unknown as Record<string, unknown>

/** what a no-op must leave alone: history, the run, the arrays and any pending save */
function snapshot() {
  return { past: S().past.length, rev: S().simulationRev, nodes: S().nodes, edges: S().edges, timers: vi.getTimerCount() }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'))
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
  S().addNodeAt('pool', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 300, y: 0 })
  const [a, b] = S().nodes
  expect(S().onConnect({ source: a!.id, target: b!.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')).toEqual({ ok: true })
  vi.advanceTimersByTime(1000) // the setup's own autosave has run
})
afterEach(() => vi.useRealTimers())

describe('a data edit that changes no field does nothing', () => {
  it('a connection: its unchanged data passed again keeps the run, records no Undo entry and saves nothing', () => {
    const id = S().edges[0]!.id
    const before = snapshot()
    S().setEdgeData(id, { ...edge(id) } as never)
    expect(snapshot()).toEqual(before)
  })

  it('a node: a patch of its current values keeps the run, records no Undo entry and saves nothing', () => {
    const id = S().nodes[0]!.id
    const before = snapshot()
    S().updateNodeData(id, { initial: node(id).initial, capacity: node(id).capacity })
    expect(snapshot()).toEqual(before)
  })

  it('a node: an unchanged label alone does nothing either', () => {
    const id = S().nodes[0]!.id
    const before = snapshot()
    S().updateNodeData(id, { label: node(id).label })
    expect(snapshot()).toEqual(before)
  })

  it('controls: a real change still resets the run, records one entry and saves', () => {
    const e = S().edges[0]!.id
    const n = S().nodes[0]!.id
    const before = snapshot()
    S().setEdgeData(e, { ...edge(e), flow: '3' } as never)
    S().updateNodeData(n, { initial: 4 })
    const after = snapshot()
    expect(after.past).toBe(before.past + 2)
    expect(after.rev).toBeGreaterThan(before.rev)
    expect(after.timers).toBeGreaterThan(before.timers) // the autosave is scheduled
  })
})
