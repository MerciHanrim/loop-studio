import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalContent, digestOfCanonical } from '../model/revision'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'

// ── a Map-backed localStorage (vitest env is `node`) ───────────────────────
class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
let mem: MemStorage

let seq = 0
const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`

const liveDigest = () => {
  const g = useGraphStore.getState()
  return digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
}

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false })
})

const PROJ_KEY = 'loop-studio:project:v1'

describe('projectStore — promote & the two-phase Export (§R2.1 / §R3)', () => {
  it('no open project ⇒ planRevision promotes: mints proj + root rev; commit sets the baseline + autosaves', () => {
    const plan = useProjectStore.getState().planRevision({ now: '2026-09-09T00:00:00Z', mint })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    // phase 1 built a file but committed NOTHING
    expect(useProjectStore.getState().open).toBeNull()
    expect(mem.getItem(PROJ_KEY)).toBeNull()

    const file = JSON.parse(plan.text)
    expect(file.project.projectId).toMatch(/^proj_0*0$/)
    expect(file.project.parentId).toBeNull()
    expect(file.project.role).toBe('revision')
    expect(file.project.contentDigest).toBe(liveDigest())

    // phase 2 — the download was dispatched
    useProjectStore.getState().commitRevisionExport(plan.pendingHeader)
    const open = useProjectStore.getState().open!
    expect(open.projectId).toBe(file.project.projectId)
    expect(open.revisionId).toBe(file.project.revisionId)
    expect(open.baselineDigest).toBe(liveDigest())
    expect(useProjectStore.getState().dirty).toBe(false)
    // autosaved header carries the new revision, no base.content / workspace
    const saved = JSON.parse(mem.getItem(PROJ_KEY)!)
    expect(saved).toMatchObject({ schema: 'loop-revision/1', version: 1, revisionId: open.revisionId, role: 'revision' })
    expect(saved.base).toBeUndefined()
  })

  it('not dirty ⇒ re-export reproduces the same revisionId and byte-identical text', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    const rev1 = useProjectStore.getState().open!.revisionId

    const p2 = useProjectStore.getState().planRevision({ now: 'DIFFERENT', mint })
    if (!p2.ok) throw new Error('p2')
    expect(p2.pendingHeader.revisionId).toBe(rev1)
    expect(p2.text).toBe(p1.text) // `now` irrelevant on the not-dirty path
    useProjectStore.getState().commitRevisionExport(p2.pendingHeader)
    expect(useProjectStore.getState().open!.revisionId).toBe(rev1)
  })

  it('dirty ⇒ new revisionId (parent = prior), baseline + autosave advance, dirty clears', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    const rev1 = useProjectStore.getState().open!.revisionId

    // edit the graph
    useGraphStore.getState().addNodeAt('gate', { x: 100, y: 0 })
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(true)

    const p2 = useProjectStore.getState().planRevision({ now: '2026-10-10T00:00:00Z', mint })
    if (!p2.ok) throw new Error('p2')
    expect(p2.pendingHeader.revisionId).not.toBe(rev1)
    expect(p2.pendingHeader.parentId).toBe(rev1)
    expect(p2.pendingHeader.lineage).toEqual([rev1])
    useProjectStore.getState().commitRevisionExport(p2.pendingHeader)

    const open = useProjectStore.getState().open!
    expect(open.revisionId).toBe(p2.pendingHeader.revisionId)
    expect(open.baselineDigest).toBe(liveDigest())
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(JSON.parse(mem.getItem(PROJ_KEY)!).revisionId).toBe(open.revisionId)
  })

  it('graph changes AFTER planning ⇒ commit records the exported snapshot; the doc is dirty again (§R2.1 clarification)', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    useGraphStore.getState().addNodeAt('drain', { x: 50, y: 0 })
    useProjectStore.getState().refreshDirty()

    const p2 = useProjectStore.getState().planRevision({ now: 'b', mint })
    if (!p2.ok) throw new Error('p2')
    const snapshotDigest = p2.pendingHeader.baselineDigest
    // ...user keeps editing while the save dialog is open...
    useGraphStore.getState().addNodeAt('source', { x: -50, y: 0 })

    useProjectStore.getState().commitRevisionExport(p2.pendingHeader)
    const open = useProjectStore.getState().open!
    expect(open.baselineDigest).toBe(snapshotDigest) // what was written, not the live graph
    expect(open.baselineDigest).not.toBe(liveDigest())
    expect(useProjectStore.getState().dirty).toBe(true) // §R2.1 — re-dirty
  })
})

describe('projectStore — failure atomicity (§R2.1 / R-INV-2a)', () => {
  it('cancel (commit never called) ⇒ baseline / autosave / dirty unchanged', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    const before = { ...useProjectStore.getState().open! }
    const savedBefore = mem.getItem(PROJ_KEY)

    useGraphStore.getState().addNodeAt('gate', { x: 1, y: 1 })
    useProjectStore.getState().refreshDirty()
    const plan = useProjectStore.getState().planRevision({ now: 'b', mint })
    expect(plan.ok).toBe(true)
    // user hits Cancel in the save dialog — commit is simply not called
    expect(useProjectStore.getState().open).toEqual(before)
    expect(mem.getItem(PROJ_KEY)).toBe(savedBefore)
    expect(useProjectStore.getState().dirty).toBe(true)
  })

  it('over the byte cap ⇒ { ok:false } and no state touched', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    const before = { ...useProjectStore.getState().open! }

    const plan = useProjectStore.getState().planRevision({ now: 'b', mint, maxBytes: 20 })
    expect(plan).toMatchObject({ ok: false, reason: 'too-large' })
    expect(useProjectStore.getState().open).toEqual(before)
  })

  it('secure-RNG failure on the promote path ⇒ planRevision throws, nothing committed', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => useProjectStore.getState().planRevision({ now: 'a' })).toThrow()
    expect(useProjectStore.getState().open).toBeNull()
    expect(mem.getItem(PROJ_KEY)).toBeNull()
    vi.stubGlobal('crypto', undefined) // afterEach unstubs
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', mem)
  })
})

describe('projectStore — Make a proposal never touches the origin (§R6)', () => {
  it('dirty origin ⇒ { ok:false, reason:"dirty-origin" }, session unchanged', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    useGraphStore.getState().addNodeAt('gate', { x: 9, y: 9 })
    useProjectStore.getState().refreshDirty()
    const before = { ...useProjectStore.getState().open! }
    const savedBefore = mem.getItem(PROJ_KEY)

    const res = useProjectStore.getState().planProposal({ now: 'b', mint })
    expect(res).toEqual({ ok: false, reason: 'dirty-origin' })
    expect(useProjectStore.getState().open).toEqual(before)
    expect(mem.getItem(PROJ_KEY)).toBe(savedBefore)
    expect(useProjectStore.getState().dirty).toBe(true)
  })

  it('no open project ⇒ { ok:false, reason:"no-project" }', () => {
    expect(useProjectStore.getState().planProposal({ now: 'a', mint })).toEqual({ ok: false, reason: 'no-project' })
  })

  it('clean origin ⇒ a proposal file, and open / dirty / autosave are untouched', () => {
    const p1 = useProjectStore.getState().planRevision({ now: 'a', mint })
    if (!p1.ok) throw new Error('p1')
    useProjectStore.getState().commitRevisionExport(p1.pendingHeader)
    const before = { ...useProjectStore.getState().open! }
    const savedBefore = mem.getItem(PROJ_KEY)

    const res = useProjectStore.getState().planProposal({ now: 'b', mint })
    expect(res).toHaveProperty('ok', true)
    if ('text' in res && res.ok) {
      const file = JSON.parse(res.text)
      expect(file.project.role).toBe('proposal')
      expect(file.project.base.revisionId).toBe(before.revisionId)
    }
    expect(useProjectStore.getState().open).toEqual(before)
    expect(mem.getItem(PROJ_KEY)).toBe(savedBefore)
    expect(useProjectStore.getState().dirty).toBe(false)
  })
})

describe('projectStore — open a revision / clear', () => {
  it('openRevisionFromFile adopts the header + clean baseline; clear() wipes it', () => {
    useProjectStore.getState().openRevisionFromFile(
      {
        schema: 'loop-revision/1', version: 1,
        projectId: 'proj_' + '0'.repeat(26), revisionId: 'rev_' + '1'.repeat(26),
        parentId: null, role: 'revision', lineage: [], meta: { title: 'X' },
      },
      liveDigest(),
    )
    const open = useProjectStore.getState().open!
    expect(open.projectId).toBe('proj_' + '0'.repeat(26))
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(JSON.parse(mem.getItem(PROJ_KEY)!).revisionId).toBe(open.revisionId)

    useProjectStore.getState().clear()
    expect(useProjectStore.getState().open).toBeNull()
    expect(mem.getItem(PROJ_KEY)).toBeNull()
  })
})
