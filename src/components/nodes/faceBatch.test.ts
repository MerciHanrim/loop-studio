import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetFaceBatchForTests, measureFacesForDrag } from './faceBatch'

// ./faceBatch (share note 58): when a connection drag begins or ends, every
// node's layout effect asks for its faces to be measured; the requests of one
// commit become ONE React Flow `updateNodeInternals` call holding every node
// on the canvas — at once for a start, on the next animation frame for an end
// — and a start cancels an end's measurement still waiting. What is pinned is
// the measurement calls and the nodes in them, not React Flow's own store
// updates (it makes others at a start and a release).

type Update = Map<string, { id: string; nodeElement: unknown; force: boolean }>

/** a canvas with node elements; `undefined` is an element without a node id */
function canvas(ids: (string | undefined)[]) {
  const calls: { ids: string[]; force: boolean[]; params: unknown }[] = []
  let els = ids.map((id) => ({ dataset: id === undefined ? {} : { id } }))
  const store = {
    getState: () => ({
      domNode: {
        querySelectorAll: (sel: string) => {
          expect(sel).toBe('.react-flow__node')
          return els
        },
      },
      updateNodeInternals: (updates: Update, params: unknown) => {
        calls.push({ ids: [...updates.keys()], force: [...updates.values()].map((u) => u.force), params })
      },
    }),
  }
  return { store: store as never, calls, setNodes: (next: string[]) => (els = next.map((id) => ({ dataset: { id } }))) }
}

/** animation frames run by hand */
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
const runFrames = () => {
  const due = [...frames.entries()]
  frames.clear()
  for (const [, cb] of due) cb(0)
}

beforeEach(() => {
  frames.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  __resetFaceBatchForTests()
})
afterEach(() => {
  __resetFaceBatchForTests()
  vi.unstubAllGlobals()
})

describe('the face measurement of a drag start / end', () => {
  it('a start: the requests of every node in the commit are one measurement, at once, of every node', () => {
    const c = canvas(['a', 'b', 'c', 'd'])
    // four nodes' layout effects in one commit
    for (let i = 0; i < 4; i++) measureFacesForDrag(c.store, true)
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0]!.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(c.calls[0]!.force).toEqual([true, true, true, true])
    expect(c.calls[0]!.params).toEqual({ triggerFitView: false })
    expect(frames.size, 'nothing deferred at a start').toBe(0)
  })

  it('an element without a node id is not measured', () => {
    const c = canvas(['a', undefined, 'b'])
    measureFacesForDrag(c.store, true)
    expect(c.calls[0]!.ids).toEqual(['a', 'b'])
  })

  it('an end: nothing at once; one measurement of every node on the next animation frame', () => {
    const c = canvas(['a', 'b', 'c'])
    measureFacesForDrag(c.store, true)
    for (let i = 0; i < 3; i++) measureFacesForDrag(c.store, false)
    expect(c.calls, 'the end measures nothing at once').toHaveLength(1)
    expect(frames.size).toBe(1)
    runFrames()
    expect(c.calls).toHaveLength(2)
    expect(c.calls[1]!.ids).toEqual(['a', 'b', 'c'])
    runFrames()
    expect(c.calls, 'one frame, one measurement').toHaveLength(2)
  })

  it('a new drag before the end\'s frame: that frame never measures, the start measures at once', () => {
    const c = canvas(['a', 'b'])
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, false)
    expect(frames.size).toBe(1)
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, true)
    expect(frames.size, 'the end\'s waiting frame is cancelled').toBe(0)
    expect(c.calls).toHaveLength(2)
    runFrames()
    expect(c.calls, 'no late measurement lands on the new drag').toHaveLength(2)
    // that drag's own end is measured as usual
    measureFacesForDrag(c.store, false)
    runFrames()
    expect(c.calls).toHaveLength(3)
  })

  it('the nodes measured are the canvas\'s when the measurement runs', () => {
    const c = canvas(['a', 'b'])
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, false)
    c.setNodes(['a', 'b', 'n'])
    runFrames()
    expect(c.calls[1]!.ids).toEqual(['a', 'b', 'n'])
  })

  it('an end with no drag begun measures nothing', () => {
    const c = canvas(['a'])
    measureFacesForDrag(c.store, false)
    runFrames()
    expect(c.calls).toHaveLength(0)
  })
})
