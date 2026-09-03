import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { FRAME_COLORS, hasFrames, useFrameStore } from './frameStore'

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

// docs/large-graph-readability-frame-colour.md §FC — the optional preset accent.
describe('frameStore — §FC accent colour', () => {
  beforeEach(reset)
  const R = { x: 0, y: 0, w: 100, h: 60 }

  it('a new manual frame has NO color (neutral)', () => {
    const id = useFrameStore.getState().addFrame(R)
    const f = useFrameStore.getState().frames[0]
    expect(f.color).toBeUndefined()
    expect(Object.keys(f).sort()).toEqual(['id', 'label', 'n', 'rect'])
    void id
  })

  it('setFrameColor sets, changes, and clears (null) a manual frame accent', () => {
    const id = useFrameStore.getState().addFrame(R)
    useFrameStore.getState().setFrameColor(id, 'slate')
    expect(useFrameStore.getState().frames[0].color).toBe('slate')
    useFrameStore.getState().setFrameColor(id, 'violet')
    expect(useFrameStore.getState().frames[0].color).toBe('violet')
    useFrameStore.getState().setFrameColor(id, null)
    expect(useFrameStore.getState().frames[0].color).toBeUndefined()
    // key is gone, not left as `undefined`
    expect('color' in useFrameStore.getState().frames[0]).toBe(false)
  })

  it('cycling neutral → accent → other → neutral leaves rect / label / n identical', () => {
    const id = useFrameStore.getState().addFrame({ x: 10, y: 20, w: 300, h: 200 })
    useFrameStore.getState().renameFrame(id, 'Economy')
    const before = { ...useFrameStore.getState().frames[0] }
    for (const c of ['slate', 'gold', null, 'rose', null] as const) {
      useFrameStore.getState().setFrameColor(id, c)
      const f = useFrameStore.getState().frames[0]
      expect(f.rect).toEqual(before.rect)
      expect(f.label).toBe(before.label)
      expect(f.n).toBe(before.n)
      expect(f.id).toBe(before.id)
    }
  })

  it('setFrameColor is a no-op for an unknown id', () => {
    const id = useFrameStore.getState().addFrame(R)
    const snap = useFrameStore.getState().frames
    useFrameStore.getState().setFrameColor('nope', 'sage')
    expect(useFrameStore.getState().frames).toBe(snap) // identity unchanged
    void id
  })

  it('adoptFrame(rect, label, color) creates an accented manual frame, selected, next ordinal', () => {
    useFrameStore.getState().addFrame(R) // n=1
    const id = useFrameStore.getState().adoptFrame({ x: 5, y: 5, w: 80, h: 40 }, 'Rewards', 'rose')
    const f = useFrameStore.getState().frames.find((x) => x.id === id)!
    expect(f).toMatchObject({ label: 'Rewards', color: 'rose', n: 2 })
    expect(useFrameStore.getState().selectedId).toBe(id)
  })

  it('adoptFrame WITHOUT a color creates a NEUTRAL manual frame (rename-promote path)', () => {
    const id = useFrameStore.getState().adoptFrame({ x: 0, y: 0, w: 50, h: 50 }, 'Area 3')
    const f = useFrameStore.getState().frames.find((x) => x.id === id)!
    expect(f.color).toBeUndefined()
    expect('color' in f).toBe(false)
  })

  it('clearFrames and a loadRev bump drop accented frames like any other', () => {
    const id = useFrameStore.getState().adoptFrame(R, 'x', 'violet')
    expect(useFrameStore.getState().frames[0].color).toBe('violet')
    useFrameStore.getState().clearFrames()
    expect(useFrameStore.getState().frames).toEqual([])
    const id2 = useFrameStore.getState().adoptFrame(R, 'y', 'gold')
    useGraphStore.setState({ loadRev: useGraphStore.getState().loadRev + 1 })
    expect(useFrameStore.getState().frames).toEqual([])
    void id
    void id2
  })

  it('FRAME_COLORS is the 5-entry palette, in a stable order', () => {
    expect(FRAME_COLORS).toEqual(['slate', 'sage', 'gold', 'violet', 'rose'])
  })
})
