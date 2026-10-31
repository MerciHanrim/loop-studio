import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// #420 item (4) — one Undo entry per FIELD (Lumi, 2026-10-31). Rapid edits to
// the same field of the same node or connection are one entry; the 600 ms
// window restarts at every edit, as before. Confirming a different field makes
// a new entry, however soon after. One call that changes several fields at
// once is one action, one entry; a connection passes its whole `data`, so the
// fields are the before / after difference. Before: the tag was per node /
// per connection, so a label edit and then a capacity edit within 600 ms were
// one entry and one Undo took both away.

const S = () => useGraphStore.getState()
const past = () => S().past.length
const node = (id: string) => S().nodes.find((n) => n.id === id)!.data as unknown as Record<string, unknown>
const edge = (id: string) => S().edges.find((e) => e.id === id)!.data as unknown as Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'))
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
})
afterEach(() => vi.useRealTimers())

function pool(): string {
  S().addNodeAt('pool', { x: 0, y: 0 })
  vi.advanceTimersByTime(1000) // the add is its own entry, well outside the window
  return S().nodes.at(-1)!.id
}

function flow(): string {
  S().addNodeAt('pool', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 300, y: 0 })
  const [a, b] = S().nodes
  expect(S().onConnect({ source: a!.id, target: b!.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')).toEqual({ ok: true })
  vi.advanceTimersByTime(1000)
  return S().edges[0]!.id
}

describe('a node: one entry per field', () => {
  it('name, then capacity within the window: two entries; one Undo takes back only the capacity', () => {
    const id = pool()
    const before = past()
    const label0 = node(id).label
    const capacity0 = node(id).capacity
    S().updateNodeData(id, { label: 'Gold' })
    vi.advanceTimersByTime(200)
    S().updateNodeData(id, { capacity: 50 })
    expect(past()).toBe(before + 2)
    S().undo()
    expect(node(id).label).toBe('Gold')
    expect(node(id).capacity).toBe(capacity0)
    S().undo()
    expect(node(id).label).toBe(label0)
  })

  it('typing in one field is one entry, and the window restarts at every keystroke', () => {
    const id = pool()
    const before = past()
    const label0 = node(id).label
    for (const text of ['G', 'Go', 'Gol', 'Gold']) {
      S().updateNodeData(id, { label: text })
      vi.advanceTimersByTime(500) // each gap inside 600 ms; 2 s in all
    }
    expect(past()).toBe(before + 1)
    S().undo()
    expect(node(id).label).toBe(label0)
  })

  it('the same field after the window has passed: a new entry', () => {
    const id = pool()
    const before = past()
    S().updateNodeData(id, { label: 'Gold' })
    vi.advanceTimersByTime(700)
    S().updateNodeData(id, { label: 'Silver' })
    expect(past()).toBe(before + 2)
  })

  it('back to the first field after another: a new entry again', () => {
    const id = pool()
    const before = past()
    S().updateNodeData(id, { label: 'Gold' })
    S().updateNodeData(id, { capacity: 50 })
    S().updateNodeData(id, { label: 'Golden' })
    expect(past()).toBe(before + 3)
    S().undo()
    expect([node(id).label, node(id).capacity]).toEqual(['Gold', 50])
  })

  it('one call that changes two fields is one entry; the next field edit is its own', () => {
    const id = pool()
    const before = past()
    const initial0 = node(id).initial
    const capacity0 = node(id).capacity
    S().updateNodeData(id, { initial: 3, capacity: 9 })
    vi.advanceTimersByTime(100)
    S().updateNodeData(id, { capacity: 12 })
    expect(past()).toBe(before + 2)
    S().undo()
    expect([node(id).initial, node(id).capacity]).toEqual([3, 9])
    S().undo()
    expect([node(id).initial, node(id).capacity]).toEqual([initial0, capacity0])
  })

  it('a call that changes nothing records nothing', () => {
    const id = pool()
    const before = past()
    S().updateNodeData(id, { label: node(id).label })
    expect(past()).toBe(before)
  })

  it('a hand label edit on an auto-composed Parameter: the keystrokes are one entry, and Undo restores the text and the auto-composed flag together', () => {
    S().addNodeAt('parameter', { x: 0, y: 0 })
    const id = S().nodes.at(-1)!.id
    S().updateNodeData(id, { label: 'Pity', labelAutoComposed: true })
    vi.advanceTimersByTime(1000)
    const before = past()
    // what the Inspector sends: the first keystroke detaches the label, the rest only type
    S().updateNodeData(id, { label: 'PityX', labelAutoComposed: false })
    vi.advanceTimersByTime(100)
    S().updateNodeData(id, { label: 'PityXY' })
    expect(past()).toBe(before + 1)
    S().undo()
    expect([node(id).label, node(id).labelAutoComposed]).toEqual(['Pity', true])
  })
})

describe('a connection: the fields are the difference of its whole data', () => {
  it('flow, then resource type within the window: two entries; one Undo takes back only the resource type', () => {
    const id = flow()
    const before = past()
    const flow0 = edge(id).flow
    S().setEdgeData(id, { ...edge(id), flow: '3' } as never)
    vi.advanceTimersByTime(200)
    S().setEdgeData(id, { ...edge(id), resourceType: 'gold' } as never)
    expect(past()).toBe(before + 2)
    S().undo()
    expect([edge(id).flow, edge(id).resourceType]).toEqual(['3', undefined])
    S().undo()
    expect(edge(id).flow).toBe(flow0)
  })

  it('typing a flow is one entry', () => {
    const id = flow()
    const before = past()
    for (const text of ['1', '1-', '1-3']) {
      S().setEdgeData(id, { ...edge(id), flow: text } as never)
      vi.advanceTimersByTime(300)
    }
    expect(past()).toBe(before + 1)
  })

  it('the whole data passed again unchanged records nothing', () => {
    const id = flow()
    const before = past()
    S().setEdgeData(id, { ...edge(id) } as never)
    expect(past()).toBe(before)
  })
})
