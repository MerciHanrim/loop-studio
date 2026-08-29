import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalContent, digestOfCanonical } from '../model/revision'
import { STORAGE_KEY } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import {
  applyPendingProposal,
  classifyPendingProposal,
  currentTargetDigest,
  openPendingProposalAsDocument,
  routeImport,
  threeWayForPending,
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
    expect(res).toMatchObject({ ok: false, reason: 'needs-confirmation', classification: 'unknown' })
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

// ── review round 3 — history sidecar, re-check at Apply ───────────────────

/** a proposal whose base is the CURRENTLY-open revision (so it classifies
 *  `exact` against an untouched target). */
async function proposalForOpen(mut: (f: Record<string, unknown>) => void): Promise<PendingProposal> {
  return importProposal(editedProposalFile(mut))
}
const applyOk = (p: PendingProposal, opts?: { confirmed?: boolean }) => {
  const r = applyPendingProposal(p, opts)
  if (!r.ok) throw new Error(`apply failed: ${r.reason}`)
  return r
}
const rev = () => useProjectStore.getState().open!.revisionId

describe('history sidecar — the project header is carried per undo frame (§R7.3)', () => {
  it('Apply → plain edit → Undo edit → Undo Apply → Redo Apply keeps the header lineage', async () => {
    const r0 = promote()
    applyOk(await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool)))
    const rA = rev()
    expect(rA).not.toBe(r0)

    useGraphStore.getState().addNodeAt('gate', { x: 1, y: 1 }) // plain edit, header unchanged
    expect(rev()).toBe(rA)

    useGraphStore.getState().undo() // undo the edit
    expect(rev()).toBe(rA)
    expect(useGraphStore.getState().nodes.some((n) => n.type === 'gate')).toBe(false)

    useGraphStore.getState().undo() // undo the Apply
    expect(useProjectStore.getState().open!.revisionId).toBe(r0)
    expect(useProjectStore.getState().open!.appliedProposal).toBeUndefined()
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(false)

    useGraphStore.getState().redo() // redo the Apply
    expect(rev()).toBe(rA)
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_added')).toBe(true)
    expect(autosaveHeader().revisionId).toBe(rA)
  })

  it('Apply A → Apply B → Undo B → Undo A → Redo A → Redo B', async () => {
    const r0 = promote()
    applyOk(await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool)))
    const rA = rev()
    applyOk(
      await proposalForOpen((f) =>
        (f.nodes as unknown[]).push({ ...extraPool, id: 'p_added2', data: { ...extraPool.data, label: 'Two' } }),
      ),
    )
    const rB = rev()
    expect(new Set([r0, rA, rB]).size).toBe(3)

    useGraphStore.getState().undo()
    expect(rev()).toBe(rA)
    useGraphStore.getState().undo()
    expect(useProjectStore.getState().open!.revisionId).toBe(r0)
    useGraphStore.getState().redo()
    expect(rev()).toBe(rA)
    useGraphStore.getState().redo()
    expect(rev()).toBe(rB)
    expect(autosaveHeader().revisionId).toBe(rB)
  })

  it('Undo an Apply, then a new edit ⇒ redo branch (and its header) is discarded', async () => {
    const r0 = promote()
    applyOk(await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool)))
    expect(rev()).not.toBe(r0)

    useGraphStore.getState().undo() // back to r0
    expect(useProjectStore.getState().open!.revisionId).toBe(r0)

    useGraphStore.getState().addNodeAt('gate', { x: 2, y: 2 }) // fork a new branch
    expect(useGraphStore.getState().canRedo).toBe(false)
    expect(useProjectStore.getState().open!.revisionId).toBe(r0) // header stays on the new branch
  })
})

describe('Apply re-checks everything at the click, not the Review-time class', () => {
  it('a target edited after an `exact` Review ⇒ Apply now needs confirmation', async () => {
    promote()
    const p = await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool))
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'exact' })

    useGraphStore.getState().addNodeAt('gate', { x: 9, y: 9 }) // diverge AFTER the Review opened
    const res = applyPendingProposal(p) // no `confirmed`
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('needs-confirmation')
    expect(res.classification).not.toBe('exact')
  })

  it('the open project cleared while the Review is up ⇒ Apply refused, zero change', async () => {
    promote()
    const p = await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool))
    const sig = graphSig()
    useProjectStore.setState({ open: null, dirty: false })

    expect(applyPendingProposal(p, { confirmed: true })).toEqual({ ok: false, reason: 'no-target' })
    expect(graphSig()).toBe(sig)
  })

  it('a proposal payload tampered after import ⇒ payload-invalid, zero change', async () => {
    promote()
    const p = await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool))
    const sig = graphSig()
    p.base = { ...p.base, contentDigest: 'f'.repeat(64) } // digest no longer matches base.content

    expect(applyPendingProposal(p, { confirmed: true })).toEqual({ ok: false, reason: 'payload-invalid' })
    expect(graphSig()).toBe(sig)
  })

  it('expectTargetDigest guards the confirmed apply against a target that moved again', async () => {
    promote()
    const p = await proposalForOpen((f) => (f.nodes as unknown[]).push(extraPool))
    useGraphStore.getState().addNodeAt('gate', { x: 1, y: 1 })

    const first = applyPendingProposal(p)
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.reason).toBe('needs-confirmation')
    const armedDigest = first.targetDigest!

    useGraphStore.getState().addNodeAt('source', { x: 2, y: 2 }) // target moves again

    const stale = applyPendingProposal(p, { confirmed: true, expectTargetDigest: armedDigest })
    expect(stale).toMatchObject({ ok: false, reason: 'target-moved' })

    // re-arm against the fresh digest ⇒ applies
    const freshDigest = (applyPendingProposal(p) as { targetDigest: string }).targetDigest
    const done = applyPendingProposal(p, { confirmed: true, expectTargetDigest: freshDigest })
    expect(done.ok).toBe(true)
  })
})

// ── Slice 2 — per-hunk selective apply (§R7.2 / §R7A.3) ───────────────────

const seededId = () => useGraphStore.getState().nodes[0].id
const nodeInitial = (id: string) =>
  (useGraphStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>).initial

describe('per-hunk selective apply (§R7.2)', () => {
  it('applies only the accepted hunks; the rest of the graph is byte-identical; one atomic step', async () => {
    const r0 = promote()
    const sid = seededId()
    const p = await importProposal(
      editedProposalFile((f) => {
        ;(f.nodes as unknown[]).push(extraPool) // add p_added
        const s = (f.nodes as Array<Record<string, unknown>>).find((n) => n.id === sid)!
        ;(s.data as Record<string, unknown>).initial = 42 // change seeded.initial 0 -> 42
      }),
    )
    const plan = threeWayForPending(p)
    expect(new Set(plan.hunks.map((h) => `${h.kind}:${h.id}`))).toEqual(
      new Set([`add:${extraPool.id}`, `change:${sid}`]),
    )

    const beforeSeeded = JSON.stringify(useGraphStore.getState().nodes.find((n) => n.id === sid))
    const simRevBefore = useGraphStore.getState().simulationRev

    // accept ONLY the add, not the change
    const res = applyPendingProposal(p, { selection: { accept: { [extraPool.id]: true }, fieldChoices: {} } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.partial).toBe(true)
    expect(res.newRevisionId).not.toBe(r0)

    expect(useGraphStore.getState().nodes.some((n) => n.id === extraPool.id)).toBe(true)
    expect(nodeInitial(sid)).toBe(0) // the change hunk was NOT applied
    // the seeded node is byte-identical (nothing but the accepted add touched it)
    expect(JSON.stringify(useGraphStore.getState().nodes.find((n) => n.id === sid))).toBe(beforeSeeded)

    // §R7.3 atomicity
    expect(useGraphStore.getState().simulationRev).toBe(simRevBefore + 1)
    expect(useSimStore.getState().stepIndex).toBe(0)
    const open = useProjectStore.getState().open!
    expect(open.parentId).toBe(r0)
    expect(open.appliedProposal!.baseId).toBe(r0)

    // one undo restores the pre-apply graph AND header
    useGraphStore.getState().undo()
    expect(useGraphStore.getState().nodes.some((n) => n.id === extraPool.id)).toBe(false)
    expect(useProjectStore.getState().open!.revisionId).toBe(r0)
  })

  it('per-hunk apply needs no whole-loss confirmation even on a divergent base', async () => {
    const r0 = promote()
    const sid = seededId()
    const p = await importProposal(
      editedProposalFile((f) => {
        const s = (f.nodes as Array<Record<string, unknown>>).find((n) => n.id === sid)!
        ;(s.data as Record<string, unknown>).initial = 20
      }),
    )
    // diverge the target in the SAME field ⇒ whole-apply would be `divergent`
    useGraphStore.getState().updateNodeData(sid, { initial: 15 })
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'divergent' })

    // per-hunk apply proceeds on the selection alone — no `confirmed`
    const res = applyPendingProposal(p, {
      selection: { accept: {}, fieldChoices: { [sid]: { 'data.initial': 'proposed' } } },
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.newRevisionId).not.toBe(r0)
    expect(nodeInitial(sid)).toBe(20)
  })

  it('conflict: "keep mine" leaves yours, "take proposal" takes theirs (vec 10)', async () => {
    promote()
    const sid = seededId()
    const p = await importProposal(
      editedProposalFile((f) => {
        const s = (f.nodes as Array<Record<string, unknown>>).find((n) => n.id === sid)!
        ;(s.data as Record<string, unknown>).initial = 20
      }),
    )
    useGraphStore.getState().updateNodeData(sid, { initial: 15 }) // a third value
    const field = threeWayForPending(p).hunks.find((h) => h.id === sid)!.fields!.find((x) => x.field === 'data.initial')!
    expect([field.base, field.proposed, field.yours, field.verdict]).toEqual([0, 20, 15, 'conflict'])

    // keep mine on the ONLY change ⇒ no effective change, no revision minted
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: { [sid]: { 'data.initial': 'yours' } } } }))
      .toEqual({ ok: false, reason: 'no-effective-change' })
    expect(nodeInitial(sid)).toBe(15)

    // take proposal ⇒ applied
    const res = applyPendingProposal(p, { selection: { accept: {}, fieldChoices: { [sid]: { 'data.initial': 'proposed' } } } })
    expect(res.ok).toBe(true)
    expect(nodeInitial(sid)).toBe(20)
  })

  it('a picked field combination that makes an invalid GraphDoc is blocked with reasons, zero change', async () => {
    promote()
    // seed: pool 'p' —resource→ drain (so there is an edge to mutate)
    useGraphStore.getState().addNodeAt('drain', { x: 300, y: 0 })
    const [n0, n1] = useGraphStore.getState().nodes
    useGraphStore.getState().onConnect({ source: n0.id, target: n1.id, sourceHandle: 'out', targetHandle: 'in' })
    const eid = useGraphStore.getState().edges[0].id
    promote('b') // re-commit with the edge

    const p = await importProposal(
      editedProposalFile((f) => {
        // flip the edge's kind to "state" but LEAVE its resource handles ⇒ an
        // edge that is only valid after normalize would repair it
        const e = (f.edges as Array<Record<string, unknown>>).find((x) => x.id === eid)!
        ;(e.data as Record<string, unknown>).kind = 'state'
      }),
    )
    const sig = graphSig()
    const rev = useGraphStore.getState().simulationRev
    const res = applyPendingProposal(p, {
      selection: { accept: {}, fieldChoices: { [eid]: { 'data.kind': 'proposed' } } },
    })
    expect(res).toMatchObject({ ok: false, reason: 'invalid-selection' })
    expect('reasons' in res && res.reasons!.length).toBeGreaterThan(0)
    expect(graphSig()).toBe(sig)
    expect(useGraphStore.getState().simulationRev).toBe(rev)
  })

  it('a stale selection against a moved target is refused (target-moved), not silently reused', async () => {
    promote()
    const sid = seededId()
    const p = await importProposal(
      editedProposalFile((f) => {
        const s = (f.nodes as Array<Record<string, unknown>>).find((n) => n.id === sid)!
        ;(s.data as Record<string, unknown>).initial = 20
      }),
    )
    const staleDigest = currentTargetDigest()
    // the target moves after the selection was built
    useGraphStore.getState().addNodeAt('gate', { x: 9, y: 9 })
    const sig = graphSig()

    const res = applyPendingProposal(p, {
      selection: { accept: {}, fieldChoices: { [sid]: { 'data.initial': 'proposed' } } },
      expectTargetDigest: staleDigest,
    })
    expect(res).toMatchObject({ ok: false, reason: 'target-moved' })
    expect(graphSig()).toBe(sig)

    // re-computed against the current target ⇒ applies
    const ok = applyPendingProposal(p, {
      selection: { accept: {}, fieldChoices: { [sid]: { 'data.initial': 'proposed' } } },
      expectTargetDigest: currentTargetDigest(),
    })
    expect(ok.ok).toBe(true)
    expect(nodeInitial(sid)).toBe(20)
  })

  it('a selection of only no-ops ⇒ no-effective-change (no revision / undo / simulationRev)', async () => {
    promote()
    const p = await importProposal(
      editedProposalFile((f) => (f.nodes as unknown[]).push(extraPool)), // one clean add
    )
    const rev = useGraphStore.getState().simulationRev
    const canUndo = useGraphStore.getState().canUndo
    // accept NOTHING
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: {} } }))
      .toEqual({ ok: false, reason: 'no-effective-change' })
    expect(useGraphStore.getState().simulationRev).toBe(rev)
    expect(useGraphStore.getState().canUndo).toBe(canUndo)
  })

  it('an invalid selection (accepted edge, endpoint node not accepted) is refused with zero change', async () => {
    promote()
    const sid = seededId()
    const p = await importProposal(
      editedProposalFile((f) => {
        ;(f.nodes as unknown[]).push({ ...extraPool, id: 'c' })
        ;(f.edges as unknown[]).push({
          id: 'e_xc',
          type: 'loop',
          source: sid,
          target: 'c',
          sourceHandle: 'out',
          targetHandle: 'in',
          data: { kind: 'resource', flow: '1' },
        })
      }),
    )
    const sig = graphSig()
    const rev = useGraphStore.getState().simulationRev
    const res = applyPendingProposal(p, { selection: { accept: { e_xc: true }, fieldChoices: {} } }) // NOT accepting node c
    expect(res).toMatchObject({ ok: false, reason: 'invalid-selection' })
    expect('detail' in res && res.detail).toBeTruthy() // a concrete reason
    expect(graphSig()).toBe(sig)
    expect(useGraphStore.getState().simulationRev).toBe(rev) // untouched
  })

  it('structural conflict: a local edge onto a proposal-removed node ⇒ divergent, whole-apply confirms, selective remove refused (§ round 3)', async () => {
    // base r0: pool ─ drain, NO edge
    useGraphStore.getState().addNodeAt('drain', { x: 300, y: 0 })
    const [poolN, drainN] = useGraphStore.getState().nodes
    promote() // r0

    const p = await importProposal(
      editedProposalFile((f) => {
        // proposal removes the drain node (and, since there is no edge yet, nothing else)
        f.nodes = (f.nodes as Array<{ id: string }>).filter((n) => n.id !== drainN.id)
      }),
    )
    // NOW add a local edge onto the node the proposal removes
    useGraphStore.getState().onConnect({ source: poolN.id, target: drainN.id, sourceHandle: 'out', targetHandle: 'in' })
    const eid = useGraphStore.getState().edges[0].id

    // three-way: the node-remove hunk is blocked, structurally
    const plan = threeWayForPending(p)
    const nh = plan.hunks.find((h) => h.id === drainN.id && h.kind === 'remove')!
    expect(nh.blockedBy).toEqual([eid])
    expect(plan.nConf).toBeGreaterThanOrEqual(1)

    // classification is divergent — NOT "unknown ancestry / no field conflicts"
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'divergent' })

    // whole-apply needs the §R7A.4 confirmation
    expect(applyPendingProposal(p)).toMatchObject({ ok: false, reason: 'needs-confirmation', classification: 'divergent' })

    // selective removal of the node is refused
    const sig = graphSig()
    expect(applyPendingProposal(p, { selection: { accept: { [drainN.id]: true }, fieldChoices: {} } })).toMatchObject({
      ok: false,
      reason: 'invalid-selection',
    })
    expect(graphSig()).toBe(sig)
  })

  it('node removal dependency is satisfied by RETARGETing the incident edge (§ round 3)', async () => {
    // base r0: source ─e→ pool(mid) , plus a spare drain to retarget onto
    useGraphStore.getState().newGraph()
    useGraphStore.getState().addNodeAt('source', { x: 0, y: 0 })
    useGraphStore.getState().addNodeAt('pool', { x: 200, y: 0 })
    useGraphStore.getState().addNodeAt('drain', { x: 400, y: 0 })
    const [s, mid, d] = useGraphStore.getState().nodes
    useGraphStore.getState().onConnect({ source: s.id, target: mid.id, sourceHandle: 'out', targetHandle: 'in' })
    const eid = useGraphStore.getState().edges[0].id
    promote()
    const r0 = useProjectStore.getState().open!.revisionId

    const p = await importProposal(
      editedProposalFile((f) => {
        // proposal removes `mid` and retargets the edge s→mid to s→d
        f.nodes = (f.nodes as Array<{ id: string }>).filter((n) => n.id !== mid.id)
        const e = (f.edges as Array<Record<string, unknown>>).find((x) => x.id === eid)!
        e.target = d.id
      }),
    )
    const nh = threeWayForPending(p).hunks.find((h) => h.id === mid.id && h.kind === 'remove')!
    expect(nh.dependents).toEqual([eid])
    expect(nh.blockedBy).toBeUndefined()

    // node alone ⇒ invalid (edge still → mid)
    expect(
      applyPendingProposal(p, { selection: { accept: { [mid.id]: true }, fieldChoices: {} } }),
    ).toMatchObject({ ok: false, reason: 'invalid-selection' })

    // node + the edge's endpoint retarget ⇒ valid
    const ok = applyPendingProposal(p, {
      selection: { accept: { [mid.id]: true }, fieldChoices: { [eid]: { target: 'proposed' } } },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.newRevisionId).not.toBe(r0)
    const g = useGraphStore.getState()
    expect(g.nodes.some((n) => n.id === mid.id)).toBe(false)
    expect(g.edges.find((e) => e.id === eid)!.target).toBe(d.id)
  })
})
