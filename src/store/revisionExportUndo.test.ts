import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalContent, digestOfCanonical } from '../model/revision'
import { STORAGE_KEY } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import { applyPendingProposal, routeImport, type PendingProposal } from './revisionIO'

// SEMANTICS-R.md §R2 — "The baseline update is not a graph-content change and
// not a normal undo entry — undo/redo never moves the `revisionId` (it moves
// content, which then re-derives `dirty` against the unchanged baseline)."
//
// Whole-code review of 2026-11-15, finding S1: every history entry carries the
// project header of its moment (that is how one Undo takes back an Apply,
// graph and header), and `Export → Project revision` moved the header without
// touching the entries taken before it. Ctrl+Z after an export put the older
// header back:
//   • a plain document, edited, exported, undone: no project any more (no
//     chip, no autosaved header, also after a reload), and the next export
//     began ANOTHER project than the file just written;
//   • revision r1, edited, exported as r2, undone: the session on r1 again,
//     and the next export a child of r1, a sibling of r2.
// Redo did the same from an entry undone before the export.

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
const G = () => useGraphStore.getState()
const P = () => useProjectStore.getState()
const live = () => digestOfCanonical(canonicalContent({ nodes: G().nodes, edges: G().edges }))
const autosaveHeader = () => {
  const raw = mem.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw).project ?? null) : null
}
/** what the session says it is, with `dirty` re-derived as the app's debounce does */
const session = () => {
  P().refreshDirty()
  const o = P().open
  return o
    ? { project: o.projectId, revision: o.revisionId, parent: o.parentId, lineage: o.lineage, dirty: P().dirty, nodes: G().nodes.length, autosaved: autosaveHeader()?.revisionId ?? null }
    : { project: null, revision: null, parent: null, lineage: null, dirty: P().dirty, nodes: G().nodes.length, autosaved: autosaveHeader()?.revisionId ?? null }
}
const edit = (x: number) => G().addNodeAt('pool', { x, y: 0 })
let clock = 0
/** plan + commit, as Export ▸ Project revision does once the file is written */
function exportRevision(): string {
  const p = P().planRevision({ now: `2026-11-15T00:00:${String(clock++).padStart(2, '0')}Z`, mint })
  if (!p.ok) throw new Error('plan refused')
  expect(P().commitRevisionExport(p.plan)).toBe('committed')
  return P().open!.revisionId
}
/** the header the NEXT export would write, without committing it */
function nextExport() {
  const p = P().planRevision({ now: '2026-11-15T01:00:00Z', mint })
  if (!p.ok) throw new Error('plan refused')
  return { project: p.plan.pendingHeader.projectId, revision: p.plan.pendingHeader.revisionId, parent: p.plan.pendingHeader.parentId }
}

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  clock = 0
  G().newGraph()
  G().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
})

describe('undo / redo after Export ▸ Project revision never moves the revision (§R2, S1)', () => {
  it('a plain document, edited, exported: Undo keeps the project the export began, and marks it unsaved', () => {
    edit(200)
    const r1 = exportRevision()
    const project = P().open!.projectId
    expect(session()).toMatchObject({ project, revision: r1, parent: null, dirty: false, nodes: 2, autosaved: r1 })

    G().undo() // the edit made BEFORE the export
    // was: no project at all, and an autosave record with no header
    expect(session()).toMatchObject({ project, revision: r1, parent: null, dirty: true, nodes: 1, autosaved: r1 })
    // was: another project, with no parent
    expect(nextExport()).toMatchObject({ project, parent: r1 })

    G().redo()
    expect(session()).toMatchObject({ project, revision: r1, dirty: false, nodes: 2, autosaved: r1 })
    expect(nextExport(), 'not dirty: the same revision again').toMatchObject({ project, revision: r1 })
  })

  it('revision r1, edited, exported as r2: Undo stays on r2 (was: back on r1)', () => {
    const r1 = exportRevision()
    edit(200)
    const r2 = exportRevision()
    expect(r2).not.toBe(r1)
    G().undo()
    expect(session()).toMatchObject({ revision: r2, parent: r1, dirty: true, nodes: 1, autosaved: r2 })
    G().redo()
    expect(session()).toMatchObject({ revision: r2, parent: r1, dirty: false, nodes: 2, autosaved: r2 })
  })

  it('two edits, export r2, one Undo: the next export is a child of r2 (was: of r1, a sibling of r2)', () => {
    const r1 = exportRevision()
    edit(200)
    edit(400)
    const r2 = exportRevision()
    G().undo()
    expect(session()).toMatchObject({ revision: r2, dirty: true, nodes: 2 })
    const next = nextExport()
    expect(next.parent).toBe(r2)
    expect(next.revision).not.toBe(r2)
    expect(next.revision).not.toBe(r1)
  })

  it('an entry undone BEFORE the export: Redo across the export stays on the new revision too', () => {
    const r1 = exportRevision()
    edit(200) // A
    edit(400) // B
    G().undo() // at A, unsaved; B waits in the redo branch with r1's header
    const r2 = exportRevision() // A is r2
    expect(session()).toMatchObject({ revision: r2, parent: r1, dirty: false, nodes: 2 })
    G().redo() // B
    // was: r1 again, shown as unsaved, with r2 nowhere in the session
    expect(session()).toMatchObject({ revision: r2, parent: r1, dirty: true, nodes: 3, autosaved: r2 })
    G().undo() // A, the content r2 was written from
    expect(session()).toMatchObject({ revision: r2, dirty: false, nodes: 2 })
    G().undo() // before A
    expect(session()).toMatchObject({ revision: r2, dirty: true, nodes: 1 })
  })

  it('an edit made AFTER the export and undone: the revision stands, saved again (unchanged)', () => {
    const r1 = exportRevision()
    edit(200)
    expect(session()).toMatchObject({ revision: r1, dirty: true })
    G().undo()
    expect(session()).toMatchObject({ revision: r1, dirty: false, nodes: 1 })
  })

  it('a long walk: three edits, export, then every Undo and Redo keeps the id, the parent and the lineage; only `dirty` follows the content', () => {
    const r1 = exportRevision()
    edit(200)
    edit(400)
    edit(600)
    const r2 = exportRevision()
    const at = { project: P().open!.projectId, revision: r2, parent: r1, lineage: P().open!.lineage }
    const exported = live()
    // ↓ undo, ↑ redo: down to the first content, up to the last, and a few turns between
    const walk = ['u', 'u', 'u', 'r', 'r', 'u', 'r', 'r', 'u', 'u', 'u', 'r', 'u', 'r', 'r', 'r'] as const
    const seen: number[] = []
    for (const [i, move] of walk.entries()) {
      if (move === 'u') G().undo()
      else G().redo()
      const s = session()
      seen.push(s.nodes)
      expect({ project: s.project, revision: s.revision, parent: s.parent, lineage: s.lineage }, `after move ${i + 1} (${move})`).toEqual(at)
      expect(s.dirty, `dirty after move ${i + 1} (${move}), ${s.nodes} nodes`).toBe(live() !== exported)
      expect(s.autosaved, `the autosaved header after move ${i + 1}`).toBe(r2)
    }
    // the walk did move the content, all the way down and back up
    expect(seen).toEqual([3, 2, 1, 2, 3, 2, 3, 4, 3, 2, 1, 2, 1, 2, 3, 4])
    expect(session()).toMatchObject({ ...at, dirty: false, nodes: 4 })
    expect(nextExport(), 'back on the exported content: the same revision again').toMatchObject({ revision: r2 })
  })

  it('two exports with edits between them: every Undo is on the LAST revision', () => {
    const r1 = exportRevision()
    edit(200)
    const r2 = exportRevision()
    edit(400)
    const r3 = exportRevision()
    expect(P().open).toMatchObject({ revisionId: r3, parentId: r2 })
    G().undo() // r2's content
    expect(session()).toMatchObject({ revision: r3, parent: r2, dirty: true, nodes: 2 })
    G().undo() // r1's content
    expect(session()).toMatchObject({ revision: r3, parent: r2, dirty: true, nodes: 1 })
    expect(nextExport().parent).toBe(r3)
    G().redo()
    G().redo()
    expect(session()).toMatchObject({ revision: r3, parent: r2, dirty: false, nodes: 3 })
    expect(r1).not.toBe(r3)
  })

  it('an unchanged re-export changes nothing in the session, the history included', () => {
    const r1 = exportRevision()
    edit(200)
    G().undo() // saved again; the edit waits in the redo branch
    const before = { past: G().past, future: G().future }
    expect(exportRevision(), 'not dirty: the same revision').toBe(r1)
    expect(G().past).toBe(before.past)
    expect(G().future).toBe(before.future)
    G().redo()
    expect(session()).toMatchObject({ revision: r1, dirty: true, nodes: 2 })
  })
})

// ── an Apply in the history (§R7.3: one Undo takes back graph AND header) ──
const extraPool = {
  id: 'p_added',
  type: 'pool',
  position: { x: 40, y: 40 },
  data: { kind: 'pool', label: 'Added', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
}
/** a proposal on the open revision that adds one Pool, applied */
async function applyAddedPool(): Promise<void> {
  const res = P().planProposal({ now: 'p', mint })
  if (!('text' in res) || !res.ok) throw new Error('proposal plan')
  const f = JSON.parse(res.text) as Record<string, unknown>
  ;(f.nodes as unknown[]).push(extraPool)
  ;(f.project as Record<string, unknown>).contentDigest = digestOfCanonical(canonicalContent({ nodes: f.nodes as never, edges: f.edges as never }))
  const routed = await routeImport(JSON.stringify(f))
  if (routed.kind !== 'proposal') throw new Error(`expected proposal, got ${routed.kind}`)
  const r = applyPendingProposal(routed as PendingProposal)
  if (!r.ok) throw new Error(`apply failed: ${r.reason}`)
}

describe('an Apply and an export in one history', () => {
  it('with no export after it, an Apply is undone and redone with its header, as before', async () => {
    const r0 = exportRevision()
    await applyAddedPool()
    const rA = P().open!.revisionId
    expect(rA).not.toBe(r0)
    G().undo()
    expect(P().open).toMatchObject({ revisionId: r0 })
    expect(P().open!.appliedProposal).toBeUndefined()
    G().redo()
    expect(P().open).toMatchObject({ revisionId: rA, parentId: r0 })
    expect(P().open!.appliedProposal).toBeDefined()
  })

  it('an export AFTER the Apply is the baseline of the Apply’s entry too: undoing past it stays on the exported revision', async () => {
    const r0 = exportRevision()
    await applyAddedPool()
    const rA = P().open!.revisionId
    edit(200)
    const rB = exportRevision()
    expect(P().open).toMatchObject({ revisionId: rB, parentId: rA })
    G().undo() // the edit
    expect(session()).toMatchObject({ revision: rB, parent: rA, dirty: true })
    G().undo() // the Apply's content goes, the exported revision stays
    expect(G().nodes.some((n) => n.id === 'p_added')).toBe(false)
    expect(session()).toMatchObject({ revision: rB, parent: rA, dirty: true })
    expect(nextExport().parent).toBe(rB)
    G().redo()
    G().redo()
    expect(session()).toMatchObject({ revision: rB, parent: rA, dirty: false })
    expect(r0).not.toBe(rB)
  })

  it('an Apply undone, then an unchanged re-export: Redo is still that Apply, header and record', async () => {
    const r0 = exportRevision()
    await applyAddedPool()
    const rA = P().open!.revisionId
    G().undo() // on r0, saved
    expect(exportRevision(), 'not dirty: r0 again').toBe(r0)
    G().redo()
    expect(P().open).toMatchObject({ revisionId: rA, parentId: r0 })
    expect(P().open!.appliedProposal).toBeDefined()
    expect(G().nodes.some((n) => n.id === 'p_added')).toBe(true)
  })
})
