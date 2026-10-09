import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useFrameStore } from './frameStore'
import { useUiStore } from './uiStore'
import { nodeOnGrid } from '../model/layout/grid'
import { deserialize, LAYOUT_VERSION, loadFromStorage, saveToStorage, serialize, STORAGE_KEY } from '../model/serialize'
import { semanticDigest } from '../model/workspace'
import { convertAutosaveLayout } from './layoutBoot'
import { convertLayout } from './layoutConvert'

// issue #344 §DL2.8 / §DL2.10 — the one-time conversion of an older layout
// and Tidy to grid

const g = () => useGraphStore.getState()
const pool = (id: string, x: number, y: number) =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, initial: 0, capacity: null, mode: 'pullAny', activation: 'passive' } }) as never
const flow = (id: string, s: string, t: string) =>
  ({ id, source: s, target: t, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }) as never

/** a file as written before the grid: no `layoutVersion` */
const legacyFile = (): string => {
  const doc = JSON.parse(serialize([pool('a', 3, 7), pool('b', 205, 11), pool('c', 418, 260.4)], [flow('e1', 'a', 'b'), flow('e2', 'b', 'c')]))
  delete doc.layoutVersion
  return JSON.stringify(doc)
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  g().newGraph()
})

describe('layoutVersion in the file', () => {
  it('is written on every save, and an older file reads as 0', () => {
    expect(JSON.parse(serialize([], [])).layoutVersion).toBe(LAYOUT_VERSION)
    expect(deserialize(legacyFile()).layoutVersion).toBe(0)
    expect(deserialize(serialize([], [])).layoutVersion).toBe(LAYOUT_VERSION)
  })
})

describe('the one-time conversion', () => {
  it('re-places a legacy file on the grid when it is opened, with no undo entry', () => {
    g().loadJSON(legacyFile())
    for (const n of g().nodes) expect(nodeOnGrid(n.position)).toBe(true)
    expect(g().canUndo).toBe(false)
  })

  it('never changes the engine digest', async () => {
    const before = deserialize(legacyFile())
    g().loadJSON(legacyFile())
    expect(await semanticDigest({ nodes: g().nodes, edges: g().edges }, 1)).toBe(await semanticDigest({ nodes: before.nodes, edges: before.edges }, 1))
  })

  it('runs once: the saved document reopens unchanged', () => {
    g().loadJSON(legacyFile())
    const saved = serialize(g().nodes, g().edges)
    const positions = g().nodes.map((n) => n.position)
    g().loadJSON(saved)
    expect(g().nodes.map((n) => n.position)).toEqual(positions)
  })

  it('keeps a free (off-grid) position in a CURRENT document', () => {
    const current = serialize([pool('a', 3, 7)], [])
    g().loadJSON(current)
    expect(g().nodes[0].position).toEqual({ x: 3, y: 7 })
  })

  it('does not move a Template (loadGraph)', () => {
    g().loadGraph({ nodes: [pool('t', 3, 7)], edges: [] }, { canvasLocked: false })
    expect(g().nodes[0].position).toEqual({ x: 3, y: 7 })
  })

  it('is deterministic and idempotent', () => {
    const d = deserialize(legacyFile())
    const a = convertLayout({ nodes: d.nodes, edges: d.edges, frames: [] })
    const b = convertLayout({ nodes: d.nodes, edges: d.edges, frames: [] })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    const again = convertLayout(a)
    expect(again.nodes.map((n) => n.position)).toEqual(a.nodes.map((n) => n.position))
  })
})

describe('the autosave record at boot', () => {
  class MemStorage {
    m = new Map<string, string>()
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
    setItem(k: string, v: string) { this.m.set(k, String(v)) }
    removeItem(k: string) { this.m.delete(k) }
    clear() { this.m.clear() }
    key(i: number) { return [...this.m.keys()][i] ?? null }
    get length() { return this.m.size }
  }
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** write a pre-grid autosave record, optionally with a Project header */
  const writeLegacyRecord = (project?: unknown) => {
    saveToStorage([pool('a', 3, 7), pool('b', 205, 11)], [flow('e1', 'a', 'b')], project)
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    delete rec.layoutVersion
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec))
  }

  it('is re-placed once, and stamped current', () => {
    writeLegacyRecord()
    convertAutosaveLayout()
    const stored = loadFromStorage()!
    for (const n of stored.nodes) expect(nodeOnGrid(n.position)).toBe(true)
    expect(stored.layoutVersion).toBe(LAYOUT_VERSION)
  })

  it('keeps its layout when it carries a Project header — a revision is never re-placed automatically', () => {
    writeLegacyRecord({ projectId: 'p', revisionId: 'r', role: 'revision' })
    const before = localStorage.getItem(STORAGE_KEY)
    convertAutosaveLayout()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })
})

describe('Tidy to grid', () => {
  it('re-places the current document as ONE undo step', () => {
    g().loadJSON(serialize([pool('a', 3, 7), pool('b', 205, 11)], []))
    expect(g().canUndo).toBe(false)
    expect(g().tidyToGrid()).toBe(2)
    for (const n of g().nodes) expect(nodeOnGrid(n.position)).toBe(true)
    expect(g().canUndo).toBe(true)
    g().undo()
    expect(g().nodes.map((n) => n.position)).toEqual([{ x: 3, y: 7 }, { x: 205, y: 11 }])
    expect(g().canUndo).toBe(false)
  })

  it('moves frames with it in the same step', () => {
    g().loadJSON(serialize([pool('a', 3, 7)], [], undefined, undefined, undefined, 1, [{ id: 'f', label: 'F', rect: { x: -9, y: -21, w: 200, h: 120 } }]))
    g().tidyToGrid()
    const rect = useFrameStore.getState().frames[0].rect
    expect(Math.abs(rect.x % 16)).toBe(0)
    g().undo()
    expect(useFrameStore.getState().frames[0].rect).toEqual({ x: -9, y: -21, w: 200, h: 120 })
  })

  it('makes no entry when nothing would move', () => {
    g().loadJSON(serialize([pool('a', 32, 4)], []))
    expect(g().tidyToGrid()).toBe(0)
    expect(g().canUndo).toBe(false)
  })

  it('is refused while the canvas is locked', () => {
    g().loadJSON(serialize([pool('a', 3, 7)], []))
    useUiStore.getState().setCanvasLocked(true)
    expect(g().tidyToGrid()).toBe(0)
    expect(g().nodes[0].position).toEqual({ x: 3, y: 7 })
  })
})
