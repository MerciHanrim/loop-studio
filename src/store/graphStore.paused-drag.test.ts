import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// issue #408 — a node pointer drag is ONE undo transaction (Lumi, 2026-10-30).
// The Canvas calls `beginNodeDrag` at React Flow's drag start and `endNodeDrag`
// at its stop; in between, the `position` changes with `dragging: true` reach
// `onNodesChange` as before but record no 'move' entry. The stop pushes one
// entry, the pre-drag snapshot, only when a position really changed. The
// 600 ms tag window never splits a drag any more. Outside the transaction
// (another path sending the same changes) the per-change commit stands.

const S = () => useGraphStore.getState()
const past = () => S().past.length
const pos = (id: string) => ({ ...S().nodes.find((n) => n.id === id)!.position })

type Change = { type: 'position'; id: string; position: { x: number; y: number }; dragging: boolean }
const move = (id: string, x: number, y: number, dragging = true): Change => ({ type: 'position', id, position: { x, y }, dragging })

/** the pointer sequence of the reproduction: two moves, a hold longer than the
 *  window, two moves, release */
function pausedDrag(id: string, origin: { x: number; y: number }) {
  S().onNodesChange([move(id, origin.x + 16, origin.y)])
  vi.advanceTimersByTime(100)
  S().onNodesChange([move(id, origin.x + 32, origin.y)])
  vi.advanceTimersByTime(900)
  S().onNodesChange([move(id, origin.x + 48, origin.y)])
  vi.advanceTimersByTime(100)
  S().onNodesChange([move(id, origin.x + 64, origin.y)])
  S().onNodesChange([move(id, origin.x + 64, origin.y, false)])
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-30T00:00:00Z'))
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
  S().addNodeAt('pool', { x: 0, y: 0 })
})
afterEach(() => vi.useRealTimers())

describe('a node pointer drag is one undo transaction (#408)', () => {
  it('a drag with a pause longer than the window: ONE entry at the stop, and one Undo returns to the origin', () => {
    const id = S().nodes[0].id
    const origin = pos(id)
    const before = past()

    S().beginNodeDrag()
    pausedDrag(id, origin)
    expect(past()).toBe(before) // nothing recorded while the pointer is down
    expect(pos(id).x).toBeGreaterThan(origin.x + 48)
    S().endNodeDrag()
    expect(past()).toBe(before + 1)

    S().undo()
    expect(pos(id)).toEqual(origin)
    expect(S().canUndo).toBe(true) // the addNodeAt entry is still there; the drag did not eat it
    S().redo()
    expect(pos(id).x).toBeGreaterThan(origin.x + 48)
  })

  it('the node and selection callbacks overlap: two begins and two ends for one gesture record one entry', () => {
    const id = S().nodes[0].id
    const origin = pos(id)
    const before = past()
    S().beginNodeDrag()
    S().beginNodeDrag() // the selection start for the same gesture
    pausedDrag(id, origin)
    S().endNodeDrag()
    S().endNodeDrag() // the selection stop
    expect(past()).toBe(before + 1)
    S().undo()
    expect(pos(id)).toEqual(origin)
  })

  it('a drag that returns to its origin records nothing', () => {
    const id = S().nodes[0].id
    const origin = pos(id)
    const before = past()
    S().beginNodeDrag()
    S().onNodesChange([move(id, origin.x + 32, origin.y)])
    vi.advanceTimersByTime(900)
    S().onNodesChange([move(id, origin.x, origin.y)])
    S().onNodesChange([move(id, origin.x, origin.y, false)])
    S().endNodeDrag()
    expect(past()).toBe(before)
    expect(pos(id)).toEqual(origin)
  })

  it('a multi-selection drag: every moved node is in the one entry, and one Undo restores them all', () => {
    S().addNodeAt('source', { x: 0, y: 160 })
    const [a, b] = S().nodes.map((n) => n.id)
    const oa = pos(a)
    const ob = pos(b)
    const before = past()
    S().beginNodeDrag()
    S().onNodesChange([move(a, oa.x + 16, oa.y), move(b, ob.x + 16, ob.y)])
    vi.advanceTimersByTime(900)
    S().onNodesChange([move(a, oa.x + 48, oa.y), move(b, ob.x + 48, ob.y)])
    S().onNodesChange([move(a, oa.x + 48, oa.y, false), move(b, ob.x + 48, ob.y, false)])
    S().endNodeDrag()
    expect(past()).toBe(before + 1)
    S().undo()
    expect([pos(a), pos(b)]).toEqual([oa, ob])
  })

  it('under the edit lock the drag opens no transaction and records nothing', () => {
    const id = S().nodes[0].id
    const origin = pos(id)
    const before = past()
    useUiStore.getState().setCanvasLocked(true)
    S().beginNodeDrag()
    pausedDrag(id, origin) // the lock drops the position changes too
    S().endNodeDrag()
    expect(past()).toBe(before)
    expect(pos(id)).toEqual(origin)
  })

  it('a stop with no open transaction is a no-op', () => {
    const before = past()
    S().endNodeDrag()
    expect(past()).toBe(before)
  })

  it('entering another document mid-drag drops the transaction: the stop pushes nothing into the new document', () => {
    const id = S().nodes[0].id
    const origin = pos(id)
    S().beginNodeDrag()
    S().onNodesChange([move(id, origin.x + 32, origin.y)])
    S().newGraph()
    expect(past()).toBe(0)
    S().endNodeDrag()
    expect(past()).toBe(0)
  })

  describe('outside the transaction the per-change commit is unchanged (another path sending dragging changes)', () => {
    it('a continuous sequence is one entry; a sequence with a gap longer than the window is still two, as before', () => {
      const id = S().nodes[0].id
      const origin = pos(id)
      const before = past()
      S().onNodesChange([move(id, origin.x + 16, origin.y)])
      vi.advanceTimersByTime(100)
      S().onNodesChange([move(id, origin.x + 32, origin.y)])
      S().onNodesChange([move(id, origin.x + 32, origin.y, false)])
      expect(past()).toBe(before + 1)

      vi.advanceTimersByTime(1000)
      const o2 = pos(id)
      pausedDrag(id, o2)
      expect(past()).toBe(before + 3) // the window split it: this path is not the Canvas's drag
    })
  })
})
