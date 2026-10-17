import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measureFacesForDrag } from './faceBatch'

// ./faceBatch (share note 58): when a connection drag begins or ends, every
// node's layout effect asks for its faces to be measured; those requests
// become ONE React Flow `updateNodeInternals` call holding every node on the
// canvas — at once for a drag's start, on the next animation frame for its
// end — a start cancels an end's frame still waiting, and a drag also ends
// when React Flow's connection ends with no node asking. What is pinned is the
// measurement calls and the nodes in them, not React Flow's own store updates
// (it makes others at a start and a release).

type Update = Map<string, { id: string; nodeElement: unknown; force: boolean }>
type Conn = { connection: { inProgress: boolean } }

/** a canvas with node elements (`undefined` is an element without a node id)
 *  and a React Flow connection state that can start and end */
function canvas(ids: (string | undefined)[]) {
  const calls: { ids: string[]; force: boolean[]; params: unknown }[] = []
  let els = ids.map((id) => ({ dataset: id === undefined ? {} : { id } }))
  let conn: Conn = { connection: { inProgress: false } }
  const listeners: ((s: Conn, prev: Conn) => void)[] = []
  const store = {
    getState: () => ({
      ...conn,
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
    subscribe: (l: (s: Conn, prev: Conn) => void) => {
      listeners.push(l)
      return () => listeners.splice(listeners.indexOf(l), 1)
    },
  }
  /** React Flow's own connection state changes (no node involved) */
  const setInProgress = (inProgress: boolean) => {
    const prev = conn
    conn = { connection: { inProgress } }
    for (const l of [...listeners]) l(conn, prev)
  }
  return { store: store as never, calls, setInProgress, setNodes: (next: string[]) => (els = next.map((id) => ({ dataset: { id } }))) }
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
})
// every test makes its own canvas (its own store), so no state is shared
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the face measurement of a drag start / end', () => {
  it('a start: the requests of every node are one measurement, at once, of every node', () => {
    const c = canvas(['a', 'b', 'c', 'd'])
    for (let i = 0; i < 4; i++) measureFacesForDrag(c.store, true)
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0]!.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(c.calls[0]!.force).toEqual([true, true, true, true])
    expect(c.calls[0]!.params).toEqual({ triggerFitView: false })
    expect(frames.size, 'nothing deferred at a start').toBe(0)
  })

  it('the requests of one start may come in separate tasks: still one measurement', async () => {
    const c = canvas(['a', 'b', 'c'])
    measureFacesForDrag(c.store, true)
    await Promise.resolve()
    measureFacesForDrag(c.store, true)
    await new Promise((r) => setTimeout(r, 0))
    measureFacesForDrag(c.store, true)
    expect(c.calls).toHaveLength(1)
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

  it('an end seen by React Flow and by the nodes is one measurement', () => {
    const c = canvas(['a', 'b'])
    c.setInProgress(true)
    measureFacesForDrag(c.store, true)
    c.setInProgress(false)
    measureFacesForDrag(c.store, false)
    measureFacesForDrag(c.store, false)
    expect(frames.size).toBe(1)
    runFrames()
    expect(c.calls).toHaveLength(2)
  })

  it("a new drag before the end's frame: that frame never measures, the start measures at once", () => {
    const c = canvas(['a', 'b'])
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, false)
    expect(frames.size).toBe(1)
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, true)
    expect(frames.size, "the end's waiting frame is cancelled").toBe(0)
    expect(c.calls).toHaveLength(2)
    runFrames()
    expect(c.calls, 'no late measurement lands on the new drag').toHaveLength(2)
    measureFacesForDrag(c.store, false)
    runFrames()
    expect(c.calls).toHaveLength(3)
  })

  it("the nodes measured are the canvas's when the measurement runs", () => {
    const c = canvas(['a', 'b'])
    measureFacesForDrag(c.store, true)
    measureFacesForDrag(c.store, false)
    c.setNodes(['a', 'b', 'n'])
    runFrames()
    expect(c.calls[1]!.ids).toEqual(['a', 'b', 'n'])
  })

  it('a drag whose end no node reported (every node gone mid-drag) is over when React Flow ends it: the next start is measured', () => {
    const c = canvas(['a', 'b'])
    c.setInProgress(true)
    measureFacesForDrag(c.store, true)
    // the nodes unmount during the drag (its insert undone): no node's layout
    // effect sees the drag end; React Flow's connection still ends
    c.setNodes([])
    c.setInProgress(false)
    runFrames()
    expect(c.calls, 'the end frame finds no node to measure').toHaveLength(1)
    c.setNodes(['n1', 'n2'])
    c.setInProgress(true)
    measureFacesForDrag(c.store, true)
    expect(c.calls).toHaveLength(2)
    expect(c.calls[1]!.ids).toEqual(['n1', 'n2'])
  })

  it("every node's own wrapper of one canvas's store is that one canvas: merged", () => {
    // useStoreApi() gives each component a new { getState, setState, subscribe }
    const c = canvas(['a', 'b', 'c'])
    const s = c.store as unknown as { getState: unknown; subscribe: unknown }
    const wrappers = [0, 1, 2].map(() => ({ getState: s.getState, subscribe: s.subscribe }) as never)
    for (const w of wrappers) measureFacesForDrag(w, true)
    expect(c.calls).toHaveLength(1)
    for (const w of wrappers) measureFacesForDrag(w, false)
    expect(frames.size).toBe(1)
    runFrames()
    expect(c.calls).toHaveLength(2)
  })

  it('two canvases are measured apart', () => {
    const one = canvas(['a'])
    const two = canvas(['x', 'y'])
    measureFacesForDrag(one.store, true)
    measureFacesForDrag(two.store, true)
    expect(one.calls.map((c) => c.ids)).toEqual([['a']])
    expect(two.calls.map((c) => c.ids)).toEqual([['x', 'y']])
    measureFacesForDrag(one.store, false)
    expect(frames.size, 'one canvas ending does not cancel nor merge the other').toBe(1)
    runFrames()
    expect(one.calls).toHaveLength(2)
    expect(two.calls).toHaveLength(1)
  })

  it('an end with no drag begun measures nothing', () => {
    const c = canvas(['a'])
    measureFacesForDrag(c.store, false)
    c.setInProgress(false)
    runFrames()
    expect(c.calls).toHaveLength(0)
  })
})
