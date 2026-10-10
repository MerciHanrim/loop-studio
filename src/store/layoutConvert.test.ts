import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useFrameStore } from './frameStore'
import { useUiStore } from './uiStore'
import { nodeOnGrid } from '../model/layout/grid'
import { deserialize, LAYOUT_VERSION, loadFromStorage, saveToStorage, serialize, STORAGE_KEY } from '../model/serialize'
import { semanticDigest } from '../model/workspace'
import { convertAutosaveLayout } from './layoutBoot'
import { convertLayout, coveredBeforeConversion, heldBeforeConversion, migrateDocument } from './layoutConvert'
import { canonicalBox } from '../components/nodes/canonicalBox'
import type { LoopNode } from '../model/types'

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

describe("the conversion keeps a saved frame's members (#337)", () => {
  // a Converter whose box as drawn when saved fit the frame, and which #337
  // draws wider: 12 + 14 + 135 + 12 = 173 px then, wider now
  const conv = (id: string, x: number, y: number) =>
    ({ id, type: 'converter', position: { x, y }, data: { kind: 'converter', label: 'Gekaufte Nahrung (Einheiten)', mode: 'pullAny' } }) as unknown as LoopNode
  const frame = { id: 'f', label: 'F', rect: { x: 0, y: 0, w: 220, h: 120 } }
  const inside = (n: { position: { x: number; y: number } }, w: number, h: number, r: { x: number; y: number; w: number; h: number }) =>
    n.position.x >= r.x && n.position.y >= r.y && n.position.x + w <= r.x + r.w && n.position.y + h <= r.y + r.h

  it('decides membership by the boxes of that time: a member #337 widened is still held whole', () => {
    const doc = { nodes: [conv('c', 24, 24)], edges: [], frames: [frame] }
    expect(heldBeforeConversion(doc)).toEqual({ f: ['c'] })
    const m = migrateDocument(doc)
    const now = canonicalBox(m.nodes[0])
    expect(now.w).toBeGreaterThan(173)
    expect(inside(m.nodes[0], now.w, now.h, m.frames![0].rect)).toBe(true)
  })

  it('a node that only reached into the frame is not held, but the frame now covers it (its centre was inside)', () => {
    // 120 + 173 / 2 = 206.5 < 220: the centre was inside, the box was not
    const doc = { nodes: [conv('c', 120, 24)], edges: [], frames: [frame] }
    expect(heldBeforeConversion(doc)).toEqual({ f: [] })
    expect(coveredBeforeConversion(doc)).toEqual({ f: ['c'] })
    const m = migrateDocument(doc)
    expect(inside(m.nodes[0], canonicalBox(m.nodes[0]).w, canonicalBox(m.nodes[0]).h, m.frames![0].rect)).toBe(true)
  })

  it('a node whose centre was outside stays outside: the frame is not grown for it', () => {
    const doc = { nodes: [conv('a', 24, 24), conv('c', 200, 24)], edges: [], frames: [{ ...frame, rect: { x: 0, y: 0, w: 230, h: 120 } }] }
    expect(coveredBeforeConversion(doc)).toEqual({ f: ['a'] })
    const m = migrateDocument(doc)
    const c = m.nodes.find((n) => n.id === 'c')!
    expect(m.frames![0].rect.x + m.frames![0].rect.w).toBeLessThanOrEqual(c.position.x)
  })

  it('keeps every frame side at least 24 px from the nodes it shows, and its own padding where it had more', () => {
    const doc = { nodes: [conv('c', 64, 40)], edges: [], frames: [{ ...frame, rect: { x: 0, y: 0, w: 400, h: 160 } }] }
    const m = migrateDocument(doc)
    const r = m.frames![0].rect
    const n = m.nodes[0]
    const b = canonicalBox(n)
    expect(n.position.x - r.x).toBeGreaterThanOrEqual(64 - 16) // its 64 px, give or take the grid
    expect(r.x + r.w - (n.position.x + b.w)).toBeGreaterThanOrEqual(24)
    expect(r.y + r.h - (n.position.y + b.h)).toBeGreaterThanOrEqual(24)
  })

  it('Tidy to grid reads the CURRENT boxes for the same rule', () => {
    const doc = { nodes: [conv('c', 24, 24)], edges: [], frames: [frame] }
    const t = convertLayout(doc)
    expect(inside(t.nodes[0], canonicalBox(t.nodes[0]).w, canonicalBox(t.nodes[0]).h, t.frames![0].rect)).toBe(true)
  })

  it('keeps the 48 x 32 clearance between nodes (one-time conversion and Tidy alike)', () => {
    const doc = { nodes: [conv('a', 0, 0), conv('b', 200, 0)], edges: [], frames: [] }
    for (const out of [migrateDocument(doc), convertLayout(doc)]) {
      const [a, b] = out.nodes
      expect(b.position.x - (a.position.x + canonicalBox(a).w)).toBeGreaterThanOrEqual(48)
    }
  })
})

describe('the route migration (§ER14.1)', () => {
  const routeOf = (id: string) => (g().edges.find((e) => e.id === id)!.data as { route?: string }).route

  it('an ordinary pre-grid document gets route "orthogonal" written on every connection', () => {
    g().loadJSON(legacyFile())
    expect(routeOf('e1')).toBe('orthogonal')
    expect(routeOf('e2')).toBe('orthogonal')
    // and it is saved that way: the file now says so explicitly
    const saved = JSON.parse(serialize(g().nodes, g().edges)) as { edges: { data: { route?: string } }[] }
    expect(saved.edges.every((e) => e.data.route === 'orthogonal')).toBe(true)
  })

  it('keeps the engine digest; only cosmetic content changes', async () => {
    const before = deserialize(legacyFile())
    g().loadJSON(legacyFile())
    expect(await semanticDigest({ nodes: g().nodes, edges: g().edges }, 1)).toBe(await semanticDigest({ nodes: before.nodes, edges: before.edges }, 1))
  })

  it('a CURRENT document keeps an absent route: it is still a curve', () => {
    g().loadJSON(serialize([pool('a', 0, 4), pool('b', 208, 4)], [flow('e1', 'a', 'b')]))
    expect(routeOf('e1')).toBeUndefined()
  })

  it('Tidy to grid re-places positions only: it never writes a route', () => {
    g().loadJSON(serialize([pool('a', 3, 7), pool('b', 205, 11)], [flow('e1', 'a', 'b')]))
    g().tidyToGrid()
    expect(routeOf('e1')).toBeUndefined()
  })

  it('a new connection is created orthogonal', () => {
    g().loadJSON(serialize([pool('a', 0, 4), pool('b', 208, 4)], []))
    g().onConnect({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' })
    expect((g().edges[0].data as { route?: string }).route).toBe('orthogonal')
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
    expect((stored.edges[0].data as { route?: string }).route).toBe('orthogonal')
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
