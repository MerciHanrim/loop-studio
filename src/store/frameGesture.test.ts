import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore } from './graphStore'
import { useFrameStore } from './frameStore'
import type { LoopNode } from '../model/types'

// docs/large-graph-readability-saved-frames.md §SF11.1 "Move" (2026-09-20) —
// a frame-move gesture is an explicit TRANSACTION over the graph history:
//   pointer-down  → `captureGestureSnapshot()` (the pre-gesture graph + frames)
//   every move    → silent writes (`applyGesturePositions`, `setRectsSilently`)
//   pointer-up    → `pushGestureEntry(snapshot)` ONCE, only if something moved
//   Esc / cancel  → the silent writes put the origin back; NO entry.
// It never leans on the 600 ms tag coalescing, so a drag that pauses is still
// exactly one entry; nodes moving with the frame never bump `simulationRev`.

const G = () => useGraphStore.getState()
const Fr = () => useFrameStore.getState()
const N = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, measured: { width: 150, height: 40 }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode

describe('frame-move gesture transaction', () => {
  beforeEach(() => {
    G().newGraph()
    useFrameStore.setState({ frames: [], toolArmed: false, selectedId: null, nextN: 1 })
    useGraphStore.setState({
      nodes: [N('a', 0, 0), N('b', 260, 0), N('d', 780, 0)],
      edges: [
        { id: 'ab', type: 'loop', source: 'a', target: 'b', data: { kind: 'resource', flow: '1', route: 'orthogonal', waypoints: [{ x: 200, y: 80 }] } },
      ] as never,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('one gesture = exactly ONE entry, even with a > 600 ms pause between moves; undo restores frame + nodes + waypoints together', () => {
    vi.useFakeTimers()
    const id = Fr().addFrame({ x: -20, y: -20, w: 440, h: 100 })
    useGraphStore.setState({ past: [], future: [], canUndo: false })
    const rev = G().simulationRev
    const snap = G().captureGestureSnapshot()
    Fr().setRectsSilently({ [id]: { x: -10, y: -10, w: 440, h: 100 } })
    G().applyGesturePositions({ a: { x: 10, y: 10 }, b: { x: 270, y: 10 } }, { ab: [{ x: 210, y: 90 }] })
    vi.advanceTimersByTime(900) // the user paused mid-drag
    Fr().setRectsSilently({ [id]: { x: 30, y: 20, w: 440, h: 100 } })
    G().applyGesturePositions({ a: { x: 50, y: 40 }, b: { x: 310, y: 40 } }, { ab: [{ x: 250, y: 120 }] })
    expect(G().past.length, 'silent writes push nothing').toBe(0)
    G().pushGestureEntry(snap)
    expect(G().past.length).toBe(1)
    expect(G().canUndo).toBe(true)
    expect(G().future).toEqual([])
    expect(G().simulationRev, 'carried nodes never touch the engine').toBe(rev)
    G().undo()
    expect(Fr().frames[0].rect).toEqual({ x: -20, y: -20, w: 440, h: 100 })
    expect(G().nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(G().nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 260, y: 0 })
    expect((G().edges[0].data as { waypoints: unknown }).waypoints).toEqual([{ x: 200, y: 80 }])
    G().redo()
    expect(Fr().frames[0].rect).toEqual({ x: 30, y: 20, w: 440, h: 100 })
    expect(G().nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 310, y: 40 })
  })

  it('a cancelled gesture (Esc / pointercancel) restores the origin through the same silent writes and leaves past / future untouched', () => {
    const id = Fr().addFrame({ x: -20, y: -20, w: 440, h: 100 })
    G().commitHistory('') // a second entry, so `future` can be non-empty
    G().undo()
    const past = G().past.length
    const future = G().future.length
    expect(future).toBe(1)
    G().captureGestureSnapshot()
    Fr().setRectsSilently({ [id]: { x: 100, y: 100, w: 440, h: 100 } })
    G().applyGesturePositions({ a: { x: 120, y: 120 } }, {})
    // cancel: put the origin back, push nothing
    Fr().setRectsSilently({ [id]: { x: -20, y: -20, w: 440, h: 100 } })
    G().applyGesturePositions({ a: { x: 0, y: 0 } }, {})
    expect(Fr().frames[0].rect).toEqual({ x: -20, y: -20, w: 440, h: 100 })
    expect(G().nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(G().past.length).toBe(past)
    expect(G().future.length, 'a cancelled gesture does not discard the redo branch').toBe(future)
  })

  it('a click / unmoved drag pushes nothing (the caller only pushes when something moved)', () => {
    Fr().addFrame({ x: -20, y: -20, w: 440, h: 100 })
    useGraphStore.setState({ past: [], future: [] })
    G().captureGestureSnapshot()
    expect(G().past.length).toBe(0)
  })

  it('promoting an auto frame inside the transaction: the new frame + the carried nodes are ONE entry; undo removes the frame and puts the nodes back', () => {
    useGraphStore.setState({ past: [], future: [] })
    const snap = G().captureGestureSnapshot()
    G().applyGesturePositions({ a: { x: 40, y: 40 }, b: { x: 300, y: 40 } }, {})
    const id = Fr().adoptFrameSilently({ x: 20, y: 20, w: 440, h: 100 }, '')
    expect(G().past.length, 'a silent promote is not its own entry').toBe(0)
    G().pushGestureEntry(snap)
    expect(G().past.length).toBe(1)
    expect(Fr().frames.map((f) => f.id)).toEqual([id])
    G().undo()
    expect(Fr().frames).toEqual([])
    expect(G().nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 0, y: 0 })
  })

  it('applyGesturePositions only touches the listed nodes / edges and keeps every other field', () => {
    G().applyGesturePositions({ a: { x: 5, y: 5 } }, {})
    const a = G().nodes.find((n) => n.id === 'a')!
    const d = G().nodes.find((n) => n.id === 'd')!
    expect(a.position).toEqual({ x: 5, y: 5 })
    expect((a.data as { label: string }).label).toBe('a')
    expect(d.position).toEqual({ x: 780, y: 0 })
    expect((G().edges[0].data as { waypoints: unknown }).waypoints).toEqual([{ x: 200, y: 80 }])
  })

  it('the wire shape after a gesture is still { id, label, rect, color? } — no members ever appear', () => {
    const id = Fr().addFrame({ x: -20, y: -20, w: 440, h: 100 })
    const snap = G().captureGestureSnapshot()
    Fr().setRectsSilently({ [id]: { x: 0, y: 0, w: 440, h: 100 } })
    G().applyGesturePositions({ a: { x: 20, y: 20 } }, {})
    G().pushGestureEntry(snap)
    const doc = JSON.parse(G().exportJSON()) as { frames: Record<string, unknown>[] }
    expect(doc.frames).toHaveLength(1)
    expect(Object.keys(doc.frames[0]).sort()).toEqual(['id', 'label', 'rect'])
    expect(Object.keys(Fr().snapshot()[0]).sort()).toEqual(['id', 'label', 'rect'])
  })
})
