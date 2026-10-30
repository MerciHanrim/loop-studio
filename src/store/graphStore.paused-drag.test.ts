import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// issue #408 — reproduction on current main. A pointer drag reaches the store
// as React Flow `position` changes with `dragging: true` while the pointer
// moves, and one with `dragging: false` at release. `onNodesChange` commits a
// 'move' entry on each dragging change and leans on the 600 ms tag window to
// coalesce them; a pause longer than the window mid-drag therefore opens a
// SECOND entry at the mid-drag position. Which positions does the history
// hold after one drag with a pause, and where does one Undo put the node?

const S = () => useGraphStore.getState()
const past = () => S().past.length

type Change = { type: 'position'; id: string; position: { x: number; y: number }; dragging: boolean }
const move = (id: string, x: number, y: number, dragging = true): Change => ({ type: 'position', id, position: { x, y }, dragging })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-30T00:00:00Z'))
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
  S().addNodeAt('pool', { x: 0, y: 0 })
})
afterEach(() => vi.useRealTimers())

describe('one pointer drag with a pause longer than the coalescing window (#408)', () => {
  it('records TWO history entries, the second at the pause position; one Undo returns the node to the pause, not to the origin', () => {
    const id = S().nodes[0].id
    const origin = { ...S().nodes[0].position }
    expect(past()).toBe(1) // addNodeAt

    // the pointer moves: two dragging changes 100 ms apart
    S().onNodesChange([move(id, origin.x + 16, origin.y)])
    vi.advanceTimersByTime(100)
    S().onNodesChange([move(id, origin.x + 32, origin.y)])
    expect(past()).toBe(2) // the drag's one entry so far
    const atPause = { ...S().nodes[0].position }

    // the pointer holds still for 900 ms, button down (no change arrives)
    vi.advanceTimersByTime(900)

    // …then moves again and is released
    S().onNodesChange([move(id, origin.x + 48, origin.y)])
    vi.advanceTimersByTime(100)
    S().onNodesChange([move(id, origin.x + 64, origin.y)])
    S().onNodesChange([move(id, origin.x + 64, origin.y, false)])
    const atRelease = { ...S().nodes[0].position }
    expect(atRelease.x).toBeGreaterThan(atPause.x)

    // current behaviour (the defect): a second entry opened after the pause,
    // holding the pause position
    expect(past()).toBe(3)
    const entries = S().past.map((e) => e.nodes.find((n) => n.id === id)?.position ?? null)
    expect(entries[0]).toBeNull() // before addNodeAt: no node yet
    expect(entries[1]).toEqual(origin)
    expect(entries[2]).toEqual(atPause)

    S().undo()
    expect(S().nodes[0].position).toEqual(atPause) // ← one Undo lands mid-drag
    S().undo()
    expect(S().nodes[0].position).toEqual(origin) // the second finishes the job
  })

  it('control: the same drag without the pause is one entry, and one Undo returns to the origin', () => {
    const id = S().nodes[0].id
    const origin = { ...S().nodes[0].position }
    S().onNodesChange([move(id, origin.x + 16, origin.y)])
    vi.advanceTimersByTime(100)
    S().onNodesChange([move(id, origin.x + 32, origin.y)])
    vi.advanceTimersByTime(100)
    S().onNodesChange([move(id, origin.x + 48, origin.y)])
    S().onNodesChange([move(id, origin.x + 48, origin.y, false)])
    expect(past()).toBe(2)
    S().undo()
    expect(S().nodes[0].position).toEqual(origin)
  })
})
