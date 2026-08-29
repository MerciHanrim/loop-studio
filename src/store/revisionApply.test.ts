import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalContent, digestOfCanonical } from '../model/revision'
import { STORAGE_KEY } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import {
  applyPendingProposal,
  classifyPendingProposal,
  openPendingProposalAsDocument,
  routeImport,
  type PendingProposal,
} from './revisionIO'
import { useSimStore } from './simStore'

// ── Map-backed localStorage (vitest env is `node`) ─────────────────────────
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

const live = () => {
  const g = useGraphStore.getState()
  return digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
}
const autosaveHeader = () => {
  const raw = mem.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw).project ?? null) : null
}
const graphSig = () => {
  const g = useGraphStore.getState()
  return JSON.stringify(
    g.nodes.map((n) => [n.id, n.type]).concat(g.edges.map((e) => [e.id, 'e'])),
  )
}

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
})

/** promote the current graph to a committed root revision; return its id. */
function promote(now = '2026-09-09T00:00:00Z'): string {
  const p = useProjectStore.getState().planRevision({ now, mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
  return useProjectStore.getState().open!.revisionId
}

/** a proposal file whose top-level graph has been edited away from its pinned
 *  base (a real "edited proposal"); `project.contentDigest` is kept honest so
 *  the router accepts it. */
function editedProposalFile(mutate: (f: Record<string, unknown>) => void): string {
  const res = useProjectStore.getState().planProposal({ now: 'p', mint })
  if (!('text' in res) || !res.ok) throw new Error('proposal plan')
  const f = JSON.parse(res.text) as Record<string, unknown>
  mutate(f)
  ;(f.project as Record<string, unknown>).contentDigest = digestOfCanonical(
    canonicalContent({ nodes: f.nodes as never, edges: f.edges as never }),
  )
  return JSON.stringify(f)
}

const extraPool = {
  id: 'p_added',
  type: 'pool',
  position: { x: 40, y: 40 },
  data: { kind: 'pool', label: 'Added', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
}

async function importProposal(text: string): Promise<PendingProposal> {
  const r = await routeImport(text)
  if (r.kind !== 'proposal') throw new Error(`expected proposal, got ${r.kind}`)
  return r
}

describe('Apply — classification (§R7A.2)', () => {
  it('target IS the base, content-verified ⇒ exact', async () => {
    promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    const c = classifyPendingProposal(p)
    expect(c).toEqual({ ok: true, classification: 'exact' })
  })

  it('target edited, no overlap with the proposal ⇒ unknown ancestry', async () => {
    promote()
    // a proposal that adds p_added
    const text = editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool))
    // meanwhile the open doc gains an UNRELATED node
    useGraphStore.getState().addNodeAt('drain', { x: 999, y: 999 })
    const p = await importProposal(text)
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'unknown' })
  })

  it('target edited the SAME id differently ⇒ divergent', async () => {
    promote()
    // proposal renames the seeded pool to "Prop"
    const seededId = useGraphStore.getState().nodes[0].id
    const text = editedProposalFile((f) => {
      const n = (f.nodes as Array<Record<string, unknown>>).find((x) => x.id === seededId)!
      ;(n.data as Record<string, unknown>).initial = 7
    })
    // the open doc sets a THIRD value on the same field
    useGraphStore.getState().updateNodeData(seededId, { initial: 99 })
    const p = await importProposal(text)
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'divergent' })
  })

  it('proposal for a different project ⇒ wrong-project (no classification)', async () => {
    promote()
    const text = editedProposalFile((f) => {
      ;(f.project as Record<string, unknown>).projectId = 'proj_' + 'Z'.repeat(26)
      ;(f.nodes as unknown[]).push(extraPool)
    })
    const p = await importProposal(text)
    expect(classifyPendingProposal(p)).toEqual({ ok: false, reason: 'wrong-project' })
  })

  it('no open project ⇒ no-target', async () => {
    promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    useProjectStore.setState({ open: null, dirty: false })
    expect(classifyPendingProposal(p)).toEqual({ ok: false, reason: 'no-target' })
  })
})

describe('Apply — whole-proposal (§R7 / §R7.1 / §R7.3)', () => {
  it('exact ⇒ applies with no confirmation: new revision id, appliedProposal recorded, parent = target', async () => {
    const r0 = promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    const simRevBefore = useGraphStore.getState().simulationRev

    const res = applyPendingProposal(p) // no `confirmed`
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.classification).toBe('exact')

    const open = useProjectStore.getState().open!
    expect(open.revisionId).toBe(res.newRevisionId)
    expect(open.revisionId).not.toBe(r0)
    expect(open.parentId).toBe(r0)
    expect(open.role).toBe('revision')
    expect(open.appliedProposal).toEqual({
      proposalId: p.project.revisionId,
      baseId: p.base.revisionId,
      baseDigest: p.base.contentDigest,
    })
    // content adopted verbatim
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
    expect(open.baselineDigest).toBe(live())
    expect(useProjectStore.getState().dirty).toBe(false)
    // §R7.3 — exactly one simulationRev bump, sim reset
    expect(useGraphStore.getState().simulationRev).toBe(simRevBefore + 1)
    expect(useSimStore.getState().stepIndex).toBe(0)
    expect(useSimStore.getState().status).not.toBe('running')
    // header persisted in the SAME record
    expect(autosaveHeader().revisionId).toBe(open.revisionId)
    expect(autosaveHeader().appliedProposal.proposalId).toBe(p.project.revisionId)
  })

  it('non-exact whole Apply without consent ⇒ needs-confirmation, ZERO state change', async () => {
    promote()
    const text = editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool))
    useGraphStore.getState().addNodeAt('drain', { x: 999, y: 999 }) // diverge
    const p = await importProposal(text)

    const sigBefore = graphSig()
    const openBefore = { ...useProjectStore.getState().open! }
    const simRevBefore = useGraphStore.getState().simulationRev

    const res = applyPendingProposal(p)
    expect(res).toEqual({ ok: false, reason: 'needs-confirmation', classification: 'unknown' })
    expect(graphSig()).toBe(sigBefore)
    expect(useProjectStore.getState().open).toEqual(openBefore)
    expect(useGraphStore.getState().simulationRev).toBe(simRevBefore)
  })

  it('non-exact WITH consent ⇒ applies; graph replaced verbatim by the proposal', async () => {
    const r0 = promote()
    const text = editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool))
    useGraphStore.getState().addNodeAt('drain', { x: 999, y: 999 })
    const p = await importProposal(text)

    const res = applyPendingProposal(p, { confirmed: true })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.classification).toBe('unknown')
    // the diverging 'drain' is gone — proposal graph adopted whole
    expect(useGraphStore.getState().nodes.some((n) => n.type === 'drain')).toBe(false)
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
    expect(useProjectStore.getState().open!.parentId).toBe(r0)
  })

  it('wrong project ⇒ refused, nothing changes', async () => {
    promote()
    const p = await importProposal(
      editedProposalFile((f) => {
        ;(f.project as Record<string, unknown>).projectId = 'proj_' + 'Z'.repeat(26)
        ;(f.nodes as unknown[]).push(extraPool)
      }),
    )
    const sigBefore = graphSig()
    const openBefore = { ...useProjectStore.getState().open! }
    expect(applyPendingProposal(p, { confirmed: true })).toEqual({ ok: false, reason: 'wrong-project' })
    expect(graphSig()).toBe(sigBefore)
    expect(useProjectStore.getState().open).toEqual(openBefore)
  })

  it('no open target ⇒ refused', async () => {
    promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    useProjectStore.setState({ open: null, dirty: false })
    expect(applyPendingProposal(p, { confirmed: true })).toEqual({ ok: false, reason: 'no-target' })
  })
})

describe('Apply — one undo restores graph AND project header together (§R7.3)', () => {
  it('undo after Apply reverts the graph and the open revision; redo re-applies both', async () => {
    const r0 = promote()
    const preSig = graphSig()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))

    const res = applyPendingProposal(p)
    expect(res.ok && res.classification).toBe('exact')
    const applied = useProjectStore.getState().open!.revisionId
    expect(applied).not.toBe(r0)

    // ── a single undo ──
    useGraphStore.getState().undo()
    expect(graphSig()).toBe(preSig) // graph back
    expect(useProjectStore.getState().open!.revisionId).toBe(r0) // header back
    expect(useProjectStore.getState().open!.appliedProposal).toBeUndefined()
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(autosaveHeader().revisionId).toBe(r0)

    // ── redo ──
    useGraphStore.getState().redo()
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
    expect(useProjectStore.getState().open!.revisionId).toBe(applied)
    expect(autosaveHeader().revisionId).toBe(applied)
  })

  it('an unrelated undo (no Apply outstanding) does not move the header', async () => {
    promote()
    const before = useProjectStore.getState().open!.revisionId
    useGraphStore.getState().addNodeAt('gate', { x: 7, y: 7 })
    useGraphStore.getState().undo()
    expect(useProjectStore.getState().open!.revisionId).toBe(before)
  })
})

describe('Open as a document (§R10.5) — no apply, base pinned for re-export (§R6)', () => {
  it('adopts the proposed graph, role becomes proposal, re-export keeps the ORIGINAL base', async () => {
    const r0 = promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    const proposalRev = p.project.revisionId

    openPendingProposalAsDocument(p)

    const open = useProjectStore.getState().open!
    expect(open.role).toBe('proposal')
    expect(open.revisionId).toBe(proposalRev)
    expect(open.pinnedBase!.revisionId).toBe(r0)
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
    expect(useProjectStore.getState().dirty).toBe(false)

    // edit further, then re-export the proposal
    useGraphStore.getState().addNodeAt('source', { x: -50, y: 0 })
    const re = useProjectStore.getState().planProposal({ now: 'p2', mint })
    expect('text' in re && re.ok).toBe(true)
    if (!('text' in re) || !re.ok) return
    const f = JSON.parse(re.text)
    expect(f.project.base.revisionId).toBe(r0) // pinned — NOT the edited content
    expect(f.project.base.contentDigest).toBe(p.base.contentDigest)
    expect(f.project.parentId).toBe(r0)
  })

  it('Open as a document works even with no open project (anonymous target)', async () => {
    promote()
    const p = await importProposal(editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)))
    useProjectStore.setState({ open: null, dirty: false })
    openPendingProposalAsDocument(p)
    expect(useProjectStore.getState().open!.role).toBe('proposal')
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
  })
})

describe('plain Graph / Workspace Export never carries a project header', () => {
  it('exportJSON on an open project emits no `project` key', () => {
    promote()
    const text = useGraphStore.getState().exportJSON()
    expect(JSON.parse(text).project).toBeUndefined()
  })
})
