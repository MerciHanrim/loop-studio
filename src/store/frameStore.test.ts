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

describe('frameStore — a whole-graph swap loads / clears the saved frames (§SF6)', () => {
  beforeEach(reset)

  it('`newGraph` clears the frames and the ordinal (empty canvas has none)', () => {
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    useFrameStore.getState().addFrame({ x: 0, y: 0, w: 50, h: 50 })
    expect(useFrameStore.getState().frames).toHaveLength(2)
    useGraphStore.getState().newGraph()
    expect(useFrameStore.getState().frames).toEqual([])
    expect(useFrameStore.getState().nextN).toBe(1)
  })

  it('`loadDoc` REPLACES the frame set from the doc; `n` re-derived from order', () => {
    useFrameStore.getState().addFrame({ x: 9, y: 9, w: 9, h: 9 }) // stale session frame
    useGraphStore.getState().loadDoc({ nodes: [], edges: [] }, 1, [
      { id: 'a', label: 'One', rect: { x: 1, y: 2, w: 100, h: 50 } },
      { id: 'b', label: 'Two', rect: { x: 3, y: 4, w: 60, h: 40 }, color: 'gold' },
    ])
    const fs = useFrameStore.getState()
    expect(fs.frames.map((f) => [f.id, f.label, f.n, f.color])).toEqual([
      ['a', 'One', 1, undefined],
      ['b', 'Two', 2, 'gold'],
    ])
    expect(fs.nextN).toBe(3)
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

  it('clearFrames and a whole-graph swap drop accented frames like any other', () => {
    const id = useFrameStore.getState().adoptFrame(R, 'x', 'violet')
    expect(useFrameStore.getState().frames[0].color).toBe('violet')
    useFrameStore.getState().clearFrames()
    expect(useFrameStore.getState().frames).toEqual([])
    const id2 = useFrameStore.getState().adoptFrame(R, 'y', 'gold')
    useGraphStore.getState().newGraph()
    expect(useFrameStore.getState().frames).toEqual([])
    void id
    void id2
  })

  it('FRAME_COLORS is the 5-entry palette, in a stable order', () => {
    expect(FRAME_COLORS).toEqual(['slate', 'sage', 'gold', 'violet', 'rose'])
  })
})

// ── LGR Slice 5 — §SF11 undo units (Option A) ──────────────────────────────
describe('frameStore — §SF11.1 undo units', () => {
  const G = () => useGraphStore.getState()
  beforeEach(() => {
    G().newGraph() // clears frames + history
    reset()
    useGraphStore.setState({ past: [], future: [], canUndo: false, canRedo: false })
  })
  const R = (x = 0) => ({ x, y: 0, w: 80, h: 40 })
  const pastLen = () => G().past.length

  it('create = ONE entry; undo removes the frame, redo restores it', () => {
    const id = useFrameStore.getState().addFrame(R())
    expect(pastLen()).toBe(1)
    expect(G().canUndo).toBe(true)
    G().undo()
    expect(useFrameStore.getState().frames).toEqual([])
    G().redo()
    expect(useFrameStore.getState().frames.map((f) => f.id)).toEqual([id])
  })

  it('rename commit = ONE entry; an unchanged rename = NO entry', () => {
    const id = useFrameStore.getState().addFrame(R())
    useGraphStore.setState({ past: [] })
    useFrameStore.getState().renameFrame(id, 'Economy')
    expect(pastLen()).toBe(1)
    useFrameStore.getState().renameFrame(id, 'Economy') // same value
    expect(pastLen()).toBe(1)
    G().undo()
    expect(useFrameStore.getState().frames[0].label).toBe('')
  })

  it('a resize GESTURE (many calls, one tick) = ONE entry; unchanged = NONE', () => {
    const id = useFrameStore.getState().addFrame(R())
    useGraphStore.setState({ past: [] })
    useFrameStore.getState().resizeFrame(id, { x: 0, y: 0, w: 120, h: 40 })
    useFrameStore.getState().resizeFrame(id, { x: 0, y: 0, w: 160, h: 60 })
    useFrameStore.getState().resizeFrame(id, { x: 0, y: 0, w: 200, h: 90 })
    expect(pastLen()).toBe(1) // coalesced
    useFrameStore.getState().resizeFrame(id, { x: 0, y: 0, w: 200, h: 90 }) // no change
    expect(pastLen()).toBe(1)
    G().undo()
    expect(useFrameStore.getState().frames[0].rect).toEqual(R()) // back to the original
  })

  it('colour set / change / Neutral = ONE entry each; re-picking the current = NONE', () => {
    const id = useFrameStore.getState().addFrame(R())
    useGraphStore.setState({ past: [] })
    useFrameStore.getState().setFrameColor(id, 'slate')
    useFrameStore.getState().setFrameColor(id, 'slate') // no-op
    useFrameStore.getState().setFrameColor(id, 'rose')
    useFrameStore.getState().setFrameColor(id, null) // → neutral
    expect(pastLen()).toBe(3)
    G().undo() // back to rose
    expect(useFrameStore.getState().frames[0].color).toBe('rose')
  })

  it('delete = ONE entry per frame; undo restores it whole', () => {
    const a = useFrameStore.getState().addFrame(R(0))
    useFrameStore.getState().renameFrame(a, 'Keep me')
    useFrameStore.getState().setFrameColor(a, 'gold')
    useGraphStore.setState({ past: [] })
    useFrameStore.getState().removeFrame(a)
    expect(pastLen()).toBe(1)
    G().undo()
    expect(useFrameStore.getState().frames[0]).toMatchObject({ id: a, label: 'Keep me', color: 'gold' })
  })

  it('`Clear all frames` = exactly ONE atomic entry; one undo brings back all N', () => {
    useFrameStore.getState().addFrame(R(0))
    useFrameStore.getState().addFrame(R(100))
    useFrameStore.getState().addFrame(R(200))
    useGraphStore.setState({ past: [] })
    useFrameStore.getState().clearFrames()
    expect(pastLen()).toBe(1) // NOT 3
    expect(useFrameStore.getState().frames).toEqual([])
    G().undo()
    expect(useFrameStore.getState().frames).toHaveLength(3)
  })

  it('promote = ONE entry; undo removes ONLY the manual frame (§SF11.2)', () => {
    // simulate an auto frame being promoted by a rename/resize/colour commit
    useGraphStore.setState({ past: [] })
    const mid = useFrameStore.getState().adoptFrame(R(), 'Rewards', 'rose')
    expect(pastLen()).toBe(1)
    expect(useFrameStore.getState().frames.find((f) => f.id === mid)?.color).toBe('rose')
    G().undo()
    expect(useFrameStore.getState().frames).toEqual([]) // manual frame gone
    G().redo()
    expect(useFrameStore.getState().frames.find((f) => f.id === mid)).toMatchObject({ label: 'Rewards', color: 'rose' })
  })

  it('a frame op undo/redo never touches nodes / edges', () => {
    G().addNodeAt('pool', { x: 0, y: 0 })
    const nodesBefore = JSON.stringify(G().nodes)
    useFrameStore.getState().addFrame(R())
    useFrameStore.getState().setFrameColor(useFrameStore.getState().frames[0].id, 'violet')
    G().undo()
    G().undo()
    G().redo()
    expect(JSON.stringify(G().nodes)).toBe(nodesBefore)
  })
})
