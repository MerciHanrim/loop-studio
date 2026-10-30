import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../model/serialize'
import type { LoopNode } from '../model/types'
import { t } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { invalidTargetText, reviewModel } from '../ui/revisionActions'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import { applyPendingProposal, classifyPendingProposal, routeImport, type PendingProposal } from './revisionIO'

// #420 follow-up — the paths #445 left: Review / Apply, undo / redo, boot. Each
// met the same node of an unknown kind (the canonical projection refuses it with
// `InvalidRevisionContentError`) at a different point:
//  - Review threw during the overlay's render (the whole UI went blank) and
//    Apply threw out of its click, before changing anything;
//  - undo / redo threw AFTER the graph and the history had moved, leaving the
//    project header unrestored and `dirty` stale ("unchanged");
//  - boot threw at `projectStore` module load: the app could not start, and the
//    stored record made every reload fail the same way.
// Rule (Lumi): Review shows a refusal naming the node and Apply refuses for the
// same reason before changing anything, however often it is pressed; undo /
// redo restore graph, history AND header, the session dirty; boot keeps the
// graph and the valid header, dirty; fixing the node brings the normal digest
// comparison back. A valid document behaves as before.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const WIDGET = { id: 'w', type: 'widget', position: { x: 0, y: 200 }, data: { kind: 'widget', label: 'Wonder' } } as unknown as LoopNode
const WIDGET_NODE = { id: 'w', label: 'Wonder', kind: 'widget' }

let seq = 0
const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`
let mem: MemStorage

function promote(): void {
  const p = useProjectStore.getState().planRevision({ now: '2026-10-30T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
}
/** a proposal of the open project, routed as the importer routes a file */
async function pendingProposal(): Promise<PendingProposal> {
  const pp = useProjectStore.getState().planProposal({ now: '2026-10-30T01:00:00Z', mint })
  if (!('text' in pp) || !pp.ok) throw new Error('proposal plan')
  const routed = await routeImport(pp.text)
  if (routed.kind !== 'proposal') throw new Error(`routed as ${routed.kind}`)
  return routed
}
const addBadNode = () => useGraphStore.setState({ nodes: [...useGraphStore.getState().nodes, WIDGET] }, false)
const kinds = () => useGraphStore.getState().nodes.map((n) => (n.data as { kind: string }).kind).sort()
const history = () => ({ past: useGraphStore.getState().past.length, future: useGraphStore.getState().future.length })

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Review and Apply onto an open document that cannot be projected', () => {
  it('Review gets the invalid-target gate naming the node; the text names it too', async () => {
    promote()
    const p = await pendingProposal()
    addBadNode()
    expect(classifyPendingProposal(p)).toEqual({ ok: false, reason: 'invalid-target', node: WIDGET_NODE })
    const m = reviewModel(p) // threw during the overlay's render before
    expect(m.gate).toBe('invalid-target')
    expect(m.invalidNode).toEqual(WIDGET_NODE)
    expect(m.classification).toBeUndefined()
    expect(invalidTargetText(m.invalidNode)).toBe(t('review.gate.invalidTarget', { node: isolateAuto('Wonder'), kind: isolateAuto('widget') }))
    expect(invalidTargetText(undefined)).toBe(t('review.gate.invalidContent'))
  })

  it('Apply refuses for the same reason before changing anything, and pressing it again refuses again', async () => {
    promote()
    const p = await pendingProposal()
    addBadNode()
    const before = {
      nodes: useGraphStore.getState().nodes,
      rev: useGraphStore.getState().simulationRev,
      history: history(),
      open: useProjectStore.getState().open,
      saved: mem.getItem(STORAGE_KEY),
    }
    for (const opts of [{}, { confirmed: true }, { confirmed: true }]) {
      expect(applyPendingProposal(p, opts)).toEqual({ ok: false, reason: 'invalid-target', node: WIDGET_NODE })
    }
    expect(useGraphStore.getState().nodes).toBe(before.nodes)
    expect(useGraphStore.getState().simulationRev).toBe(before.rev)
    expect(history()).toEqual(before.history)
    expect(useProjectStore.getState().open).toBe(before.open)
    expect(mem.getItem(STORAGE_KEY)).toBe(before.saved)
  })

  it('a valid document reviews and applies as before (exact, one new revision)', async () => {
    promote()
    const p = await pendingProposal()
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'exact' })
    expect(reviewModel(p).gate).toBe('ok')
    const r0 = useProjectStore.getState().open!.revisionId
    const res = applyPendingProposal(p)
    expect(res.ok).toBe(true)
    expect(useProjectStore.getState().open!.revisionId).not.toBe(r0)
  })
})

describe('undo / redo onto a state that cannot be projected', () => {
  it('redo restores graph, history AND header, and the session is dirty; undo back to the valid state is clean again', () => {
    promote()
    const pool = useGraphStore.getState().nodes[0]
    const open = useProjectStore.getState().open
    useGraphStore.getState().updateNodeData(pool.id, { kind: 'widget' } as never) // one history entry that makes the node unknown
    useGraphStore.getState().undo()
    expect(kinds()).toEqual(['pool'])
    expect(() => useGraphStore.getState().redo()).not.toThrow() // threw after the graph had moved
    expect(kinds()).toEqual(['widget'])
    expect(history()).toEqual({ past: 2, future: 0 })
    expect(useProjectStore.getState().open).toEqual(open) // the header the entry carries is restored
    expect(useProjectStore.getState().dirty).toBe(true) // never "unchanged"
    expect(() => useGraphStore.getState().undo()).not.toThrow()
    expect(kinds()).toEqual(['pool'])
    expect(useProjectStore.getState().dirty).toBe(false) // the normal comparison is back
  })

  it('undo of a later edit, landing on a state that still holds the bad node, restores and marks dirty', () => {
    promote()
    const pool = useGraphStore.getState().nodes[0]
    useGraphStore.getState().updateNodeData(pool.id, { kind: 'widget' } as never)
    useGraphStore.getState().addNodeAt('source', { x: 200, y: 0 })
    expect(() => useGraphStore.getState().undo()).not.toThrow()
    expect(kinds()).toEqual(['widget'])
    expect(history()).toEqual({ past: 2, future: 1 })
    expect(useProjectStore.getState().open).not.toBeNull()
    expect(useProjectStore.getState().dirty).toBe(true)
  })
})

describe('boot with a stored document that cannot be projected and a valid project header', () => {
  it('starts: the graph and the header are kept, the session dirty; removing the node makes it clean again', async () => {
    promote()
    const rec = JSON.parse(mem.getItem(STORAGE_KEY)!) as Record<string, unknown>
    const header = rec.project as { revisionId: string }
    expect(header).toBeTruthy()
    rec.nodes = [...(rec.nodes as unknown[]), WIDGET]
    mem.setItem(STORAGE_KEY, JSON.stringify(rec))

    vi.resetModules()
    // a fresh module graph has a fresh storage port, and a fresh port starts
    // shut: open it the way the boot module does (as `hintStore.test.ts`)
    const port = await import('../storage/storagePort')
    port.storageSession.use('personal')
    const g = await import('./graphStore')
    const ps = await import('./projectStore') // threw at module load before
    expect(g.useGraphStore.getState().nodes.map((n) => n.id)).toContain('w')
    expect(ps.useProjectStore.getState().open?.revisionId).toBe(header.revisionId)
    expect(ps.useProjectStore.getState().dirty).toBe(true)

    g.useGraphStore.setState({ nodes: g.useGraphStore.getState().nodes.filter((n) => n.id !== 'w') }, false)
    ps.useProjectStore.getState().refreshDirty()
    expect(ps.useProjectStore.getState().dirty).toBe(false)
  })
})
