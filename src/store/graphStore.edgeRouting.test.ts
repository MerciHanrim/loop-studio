import { beforeEach, describe, expect, it, vi } from 'vitest'
import './editPolicy'
import { deserialize, serialize } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// issue #344 step 3 (docs/diagram-layout.md §DL4, SEMANTICS-R10.md) — a shape or
// bend-point edit is ONE undo entry, never merged with the next, never a
// simulation change, and refused while the canvas is locked.

const S = () => useGraphStore.getState()
const rev = () => S().simulationRev
const dataOf = (id: string) => S().edges.find((e) => e.id === id)!.data as Record<string, unknown>

function two() {
  S().newGraph()
  S().addNodeAt('source', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 320, y: 0 })
  const [a, b] = S().nodes
  S().onConnect({ source: a!.id, target: b!.id, sourceHandle: 'out', targetHandle: 'in' })
  return S().edges[0]!.id
}

const WP = [{ x: 224, y: 32 }]

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
})

describe('setEdgeRouting', () => {
  it('a new connection is Auto orthogonal; every shape writes the stored form of SEMANTICS-R10.md', () => {
    const e = two()
    expect(dataOf(e).route).toBe('orthogonal')
    expect('waypoints' in dataOf(e)).toBe(false)
    S().setEdgeRouting(e, { route: 'orthogonal', waypoints: WP })
    expect(dataOf(e).waypoints).toEqual(WP)
    S().setEdgeRouting(e, {})
    expect('route' in dataOf(e)).toBe(false)
    expect('waypoints' in dataOf(e)).toBe(false)
    S().setEdgeRouting(e, { route: 'straight', waypoints: WP })
    expect(dataOf(e).route).toBe('straight')
    expect('waypoints' in dataOf(e), 'Straight takes no bend points').toBe(false)
  })

  it('each edit is one undo entry, even two in quick succession, and none bumps the run', () => {
    const e = two()
    const r = rev()
    const past = S().past.length
    S().setEdgeRouting(e, { route: 'orthogonal', waypoints: WP })
    S().setEdgeRouting(e, { route: 'orthogonal', waypoints: [{ x: 240, y: 32 }] })
    S().setEdgeRouting(e, { route: 'orthogonal' }) // Reset to automatic
    expect(S().past.length).toBe(past + 3)
    expect(rev()).toBe(r)
    S().undo()
    expect(dataOf(e).waypoints).toEqual([{ x: 240, y: 32 }])
    S().undo()
    expect(dataOf(e).waypoints).toEqual(WP)
    S().undo()
    expect('waypoints' in dataOf(e)).toBe(false)
    S().redo()
    expect(dataOf(e).waypoints).toEqual(WP)
    expect(rev()).toBe(r)
  })

  it('an edit that changes nothing adds no entry', () => {
    const e = two()
    const past = S().past.length
    S().setEdgeRouting(e, { route: 'orthogonal' })
    S().setEdgeRouting(e, { route: 'orthogonal', waypoints: [] })
    expect(S().past.length).toBe(past)
  })

  it('the stored key order is the reader’s, so a save and reload is byte-identical', () => {
    const e = two()
    S().setAccent([], [e], '#638EA5')
    S().setEdgeRouting(e, { route: 'orthogonal', waypoints: WP })
    expect(Object.keys(dataOf(e)).slice(-3)).toEqual(['route', 'waypoints', 'accent'])
    const file = serialize(S().nodes, S().edges)
    const back = deserialize(file)
    expect(serialize(back.nodes, back.edges)).toBe(file)
  })

  it('is refused while the canvas is locked, and so is the silent gesture form', () => {
    const e = two()
    const before = JSON.stringify(S().edges)
    const past = S().past.length
    useUiStore.getState().setCanvasLocked(true)
    S().setEdgeRouting(e, { route: 'straight' })
    S().setEdgeRoutingSilently(e, { route: 'orthogonal', waypoints: WP })
    expect(JSON.stringify(S().edges)).toBe(before)
    expect(S().past.length).toBe(past)
  })

  it('the silent form changes the edge with no entry; the gesture entry restores the start in one undo', () => {
    const e = two()
    const past = S().past.length
    const snap = S().captureGestureSnapshot()
    S().setEdgeRoutingSilently(e, { route: 'orthogonal', waypoints: WP })
    S().setEdgeRoutingSilently(e, { route: 'orthogonal', waypoints: [{ x: 256, y: 48 }] })
    expect(S().past.length).toBe(past)
    S().pushGestureEntry(snap)
    expect(S().past.length).toBe(past + 1)
    S().undo()
    expect('waypoints' in dataOf(e)).toBe(false)
  })
})

describe('the record label rule (§ER15.1)', () => {
  const loadRecord = (e: string) => {
    const g = S()
    S().loadDoc({ nodes: g.nodes, edges: g.edges.map((x) => (x.id === e ? { ...x, data: { kind: 'resource', flow: '1' } as never } : x)) }, { mode: 'document-boundary', canvasLocked: false, recordLabels: true })
  }

  it('a record keeps its rule until a shape edit, which ends it in the same undo entry', () => {
    const e = two()
    loadRecord(e)
    expect(S().recordLabels).toBe(true)
    S().setEdgeRouting(e, { route: 'straight' })
    expect(S().recordLabels).toBe(false)
    S().undo()
    expect(S().recordLabels).toBe(true)
    expect('route' in dataOf(e)).toBe(false)
    S().redo()
    expect(S().recordLabels).toBe(false)
  })

  it('Tidy to grid ends it, even on a record already on the grid; undo brings it back', () => {
    const e = two()
    loadRecord(e)
    S().tidyToGrid()
    expect(S().recordLabels).toBe(false)
    S().undo()
    expect(S().recordLabels).toBe(true)
  })

  it('another document, New and a Template start on the current rule', () => {
    const e = two()
    loadRecord(e)
    S().newGraph()
    expect(S().recordLabels).toBe(false)
  })

  it('the autosaved Project header carries the rule as labelLayoutVersion (0 record, 1 current); layoutVersion stays the layout', async () => {
    const { flushAutosave, setAutosaveProjectHeader } = await import('./graphStore')
    const { STORAGE_KEY, LAYOUT_VERSION } = await import('../model/serialize')
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size },
    })
    try {
      const e = two()
      loadRecord(e)
      setAutosaveProjectHeader({ schema: 'loop-revision/1', version: 1, role: 'revision' })
      S().setAccent([], [e], '#638EA5') // any edit schedules a write
      flushAutosave()
      const rec = JSON.parse(m.get(STORAGE_KEY)!)
      expect(rec.project.labelLayoutVersion).toBe(0)
      expect(rec.layoutVersion).toBe(LAYOUT_VERSION)
      S().setEdgeRouting(e, { route: 'orthogonal' })
      flushAutosave()
      const cur = JSON.parse(m.get(STORAGE_KEY)!)
      expect(cur.project.labelLayoutVersion).toBe(1)
      expect(cur.layoutVersion).toBe(LAYOUT_VERSION)
      // an ordinary document has no header, so no key
      setAutosaveProjectHeader(null)
      S().newGraph()
      flushAutosave()
      expect(JSON.parse(m.get(STORAGE_KEY)!).project).toBeUndefined()
    } finally {
      setAutosaveProjectHeader(null)
      vi.unstubAllGlobals()
    }
  })

  it('a reload restores the rule from that header: absent (an older autosave) or 0 = record, 1 = current; no header or a proposal = current', async () => {
    const { bootRecordLabels } = await import('./graphStore')
    expect(bootRecordLabels({ schema: 'loop-revision/1', role: 'revision' })).toBe(true)
    expect(bootRecordLabels({ schema: 'loop-revision/1', role: 'revision', labelLayoutVersion: 0 })).toBe(true)
    expect(bootRecordLabels({ schema: 'loop-revision/1', role: 'revision', labelLayoutVersion: 1 })).toBe(false)
    expect(bootRecordLabels(null)).toBe(false)
    expect(bootRecordLabels({ schema: 'loop-revision/1', role: 'proposal' })).toBe(false)
  })
})

describe('the header semantics decide a record (§R10-6)', () => {
  it('a header declaring /10 or later is current; absent, earlier or malformed is a record', async () => {
    const { declaredSemantics, recordKeepsLabels } = await import('../model/revision')
    expect(recordKeepsLabels({ semantics: 'loop-revision/10' })).toBe(false)
    expect(recordKeepsLabels({ semantics: 'loop-revision/11' })).toBe(false)
    expect(recordKeepsLabels({ semantics: 'loop-revision/9' })).toBe(true)
    expect(recordKeepsLabels({})).toBe(true)
    expect(recordKeepsLabels({ semantics: 'loop-revision/x' })).toBe(true)
    expect(declaredSemantics({ semantics: ' loop-revision/10' })).toBe(0)
  })

  it('every revision and proposal this build writes declares loop-revision/10, outside the digest; a /10 record without a straight connection is still /10', async () => {
    const { readProject, REVISION_SEMANTICS } = await import('../model/revision')
    const e = two()
    expect(dataOf(e).route).toBe('orthogonal') // no straight connection anywhere
    const { useProjectStore } = await import('./projectStore')
    const r = useProjectStore.getState().planRevision()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const file = JSON.parse(r.text)
    expect(file.project.semantics).toBe(REVISION_SEMANTICS)
    const read = readProject(file.project)
    expect(read.ok && read.project.semantics).toBe('loop-revision/10')
  })
})
