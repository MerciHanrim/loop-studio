import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { hasFrames, useFrameStore } from './frameStore'

// docs/large-graph-readability.md §LGR6 — the transient group-frame store.
// Session-only, no membership, no undo, no persistence; reset on a graph swap.

const reset = () => useFrameStore.setState({ frames: [], toolArmed: false, selectedId: null, nextN: 1 })

describe('frameStore — creation / label / lifecycle', () => {
  beforeEach(reset)

  it('the tool is one-shot: armed, then disarmed by the first addFrame', () => {
    useFrameStore.getState().armTool()
    expect(useFrameStore.getState().toolArmed).toBe(true)
    const id = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 100, h: 100 })
    expect(useFrameStore.getState().toolArmed).toBe(false)
    expect(useFrameStore.getState().selectedId).toBe(id)
  })

  it('frames carry { id, n, label:"", rect } and nothing else — no membership', () => {
    const id = useFrameStore.getState().addFrame({ x: 5, y: 6, w: 70, h: 80 })
    const f = useFrameStore.getState().frames[0]
    expect(Object.keys(f).sort()).toEqual(['id', 'label', 'n', 'rect'])
    expect(f).toMatchObject({ id, n: 1, label: '', rect: { x: 5, y: 6, w: 70, h: 80 } })
  })

  it('the `Group N` ordinal increments and is NOT reused after a delete', () => {
    const a = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    const b = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    expect(useFrameStore.getState().frames.map((f) => f.n)).toEqual([1, 2])
    useFrameStore.getState().removeFrame(a)
    const c = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    expect(useFrameStore.getState().frames.map((f) => f.n)).toEqual([2, 3])
    void b
    void c
  })

  it('duplicate labels are allowed; identity is the id', () => {
    const a = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    const b = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().renameFrame(a, 'Loop')
    useFrameStore.getState().renameFrame(b, 'Loop')
    const [fa, fb] = useFrameStore.getState().frames
    expect(fa.label).toBe('Loop')
    expect(fb.label).toBe('Loop')
    expect(fa.id).not.toBe(fb.id)
  })

  it('resize changes only the rect and never the creation order', () => {
    const a = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    const b = useFrameStore.getState().addFrame({ x: 200, y: 0, w: 50, h: 50 })
    useFrameStore.getState().resizeFrame(a, { x: -10, y: -10, w: 400, h: 400 })
    expect(useFrameStore.getState().frames.map((f) => f.id)).toEqual([a, b]) // order kept
    expect(useFrameStore.getState().frames[0].rect).toEqual({ x: -10, y: -10, w: 400, h: 400 })
  })

  it('removeFrame clears the selection iff it was the removed one', () => {
    const a = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    const b = useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().selectFrame(b)
    useFrameStore.getState().removeFrame(a)
    expect(useFrameStore.getState().selectedId).toBe(b)
    useFrameStore.getState().removeFrame(b)
    expect(useFrameStore.getState().selectedId).toBe(null)
  })

  it('clearFrames empties everything and resets the ordinal to 1', () => {
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().clearFrames()
    expect(useFrameStore.getState().frames).toEqual([])
    expect(useFrameStore.getState().nextN).toBe(1)
    expect(hasFrames(useFrameStore.getState())).toBe(false)
  })
})

describe('frameStore — a whole-graph swap drops every frame (§LGR3.4)', () => {
  beforeEach(reset)

  it('a `loadRev` bump clears the frames and the ordinal', () => {
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    expect(useFrameStore.getState().frames).toHaveLength(2)
    // the subscription in frameStore watches graphStore.loadRev
    useGraphStore.setState({ loadRev: useGraphStore.getState().loadRev + 1 })
    expect(useFrameStore.getState().frames).toEqual([])
    expect(useFrameStore.getState().nextN).toBe(1)
  })
})
