import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useUiStore } from './uiStore'
import { serialize } from '../model/serialize'

// Issue #334 — a whole-document replacement is a document BOUNDARY: the undo
// history starts empty, and the new document's lock is written once, as its
// final value, in the same pass as the swap (no unlock-then-relock).

const g = () => useGraphStore.getState()
const lock = (v: boolean) => useUiStore.getState().setCanvasLocked(v)
const pool = (id: string) =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id } }) as never

/** every value the lock takes from here on */
function watchLock() {
  const seen: boolean[] = []
  const stop = useUiStore.subscribe((s, prev) => {
    if (s.canvasLocked !== prev.canvasLocked) seen.push(s.canvasLocked)
  })
  return { seen, stop }
}

/** a session with history in both directions */
function edited() {
  lock(false)
  g().newGraph()
  g().addNodeAt('pool', { x: 0, y: 0 })
  g().addNodeAt('pool', { x: 100, y: 0 })
  g().undo()
  expect(g().canUndo).toBe(true)
  expect(g().canRedo).toBe(true)
}

const lockedFile = serialize([pool('a')], [], { canvasLocked: true })
const plainFile = serialize([pool('a')], [])

const boundaries: [string, (locked: boolean) => void][] = [
  ['File → New', () => g().newGraph()],
  ['a Template (loadGraph)', (locked) => g().loadGraph({ nodes: [pool('t')], edges: [] }, { canvasLocked: locked })],
  ['a file (loadJSON)', (locked) => g().loadJSON(locked ? lockedFile : plainFile)],
  ['another document (loadDoc)', (locked) => g().loadDoc({ nodes: [pool('d')], edges: [] }, { mode: 'document-boundary', canvasLocked: locked })],
]

beforeEach(() => lock(false))

describe('document boundary — the history starts empty', () => {
  for (const [name, swap] of boundaries) {
    it(`${name}: Undo and Redo are disabled, and Undo cannot reach the previous document`, () => {
      edited()
      swap(false)
      expect(g().past).toEqual([])
      expect(g().future).toEqual([])
      expect(g().canUndo).toBe(false)
      expect(g().canRedo).toBe(false)
      const nodes = g().nodes
      g().undo()
      expect(g().nodes).toBe(nodes)
    })
  }

  it('a revision Apply is NOT a boundary: one undo entry back to the document before it', () => {
    edited()
    const before = g().nodes
    const depth = g().past.length
    g().loadDoc({ nodes: [pool('applied')], edges: [] }, { mode: 'revision-apply' })
    expect(g().past).toHaveLength(depth + 1)
    expect(g().canRedo).toBe(false)
    g().undo()
    expect(g().nodes).toBe(before)
  })
})

describe('document boundary — the lock is the new document\'s, written once', () => {
  it('File → New unlocks a locked session', () => {
    edited()
    lock(true)
    const w = watchLock()
    g().newGraph()
    w.stop()
    expect(useUiStore.getState().canvasLocked).toBe(false)
    expect(w.seen).toEqual([false])
  })

  for (const [name, swap] of boundaries.slice(1)) {
    it(`${name} that is locked opens locked, with no unlocked moment in between`, () => {
      edited()
      lock(true)
      const w = watchLock()
      swap(true)
      w.stop()
      expect(useUiStore.getState().canvasLocked).toBe(true)
      expect(w.seen).toEqual([]) // never unlocked, not even for a moment
    })

    it(`${name} that is locked, opened from an unlocked session, locks exactly once`, () => {
      edited()
      const w = watchLock()
      swap(true)
      w.stop()
      expect(w.seen).toEqual([true])
    })

    it(`${name} without a lock, opened from a locked session, unlocks exactly once`, () => {
      edited()
      lock(true)
      const w = watchLock()
      swap(false)
      w.stop()
      expect(useUiStore.getState().canvasLocked).toBe(false)
      expect(w.seen).toEqual([false])
    })
  }

  it('the caller\'s applyRecommended after the swap finds the lock already set (no second write)', () => {
    edited()
    const w = watchLock()
    const rrc = g().loadJSON(lockedFile)
    useMcStore.getState().applyRecommended(rrc)
    w.stop()
    expect(w.seen).toEqual([true])
  })

  it('a boundary is allowed while locked (it replaces the document, it does not edit it)', () => {
    edited()
    lock(true)
    g().loadGraph({ nodes: [pool('t1'), pool('t2')], edges: [] }, { canvasLocked: false })
    expect(g().nodes.map((n) => n.id)).toEqual(['t1', 't2'])
  })
})
