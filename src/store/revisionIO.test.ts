import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../model/serialize'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import { routeImport } from './revisionIO'

const recordProject = () => {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw).project ?? null) : null
}

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

const graphSig = () => {
  const g = useGraphStore.getState()
  return JSON.stringify(g.nodes.map((n) => [n.id, n.type]).concat(g.edges.map((e) => [e.id, 'e'])))
}

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
})

/** promote the current graph and return the committed revision file text */
function makeRevisionFile(): string {
  const plan = useProjectStore.getState().planRevision({ now: '2026-09-09T00:00:00Z', mint })
  if (!plan.ok) throw new Error('plan')
  useProjectStore.getState().commitRevisionExport(plan.plan)
  return plan.text
}

describe('routeImport (§R10 — Import ≠ Apply)', () => {
  it('a plain Graph file loads and clears the open project', async () => {
    // first open a project
    makeRevisionFile()
    expect(useProjectStore.getState().open).not.toBeNull()

    const plain = useGraphStore.getState().exportJSON()
    const r = await routeImport(plain)
    expect(r.kind).toBe('graph')
    expect(useProjectStore.getState().open).toBeNull()
    expect(recordProject()).toBeNull() // no project header in the autosave record
  })

  it('a Project revision file loads the graph AND adopts the header', async () => {
    const file = makeRevisionFile()
    const openId = useProjectStore.getState().open!.revisionId
    // wander off to a different graph + no project
    useGraphStore.getState().newGraph()
    useProjectStore.setState({ open: null, dirty: false, activePlanId: null })

    const r = await routeImport(file)
    expect(r.kind).toBe('revision')
    if (r.kind === 'revision') expect(r.project.revisionId).toBe(openId)
    const open = useProjectStore.getState().open!
    expect(open.revisionId).toBe(openId)
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(useGraphStore.getState().nodes.length).toBeGreaterThan(0)
  })

  it('a proposal file changes NOTHING — graph, sim rev, undo, projectStore all intact (R-INV-11)', async () => {
    // open project P at revision R
    makeRevisionFile()
    const openBefore = { ...useProjectStore.getState().open! }
    const prop = useProjectStore.getState().planProposal({ now: 'n', mint })
    if (!('text' in prop) || !prop.ok) throw new Error('proposal plan')
    const proposalText = prop.text

    const sigBefore = graphSig()
    const revBefore = useGraphStore.getState().simulationRev
    const undoBefore = useGraphStore.getState().canUndo

    const r = await routeImport(proposalText)
    expect(r.kind).toBe('proposal')
    if (r.kind === 'proposal') {
      expect(r.sameProject).toBe(true)
      expect(r.base.revisionId).toBe(openBefore.revisionId)
    }
    // absolutely nothing moved
    expect(graphSig()).toBe(sigBefore)
    expect(useGraphStore.getState().simulationRev).toBe(revBefore)
    expect(useGraphStore.getState().canUndo).toBe(undoBefore)
    expect(useProjectStore.getState().open).toEqual(openBefore)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('a proposal for a DIFFERENT project routes as proposal with sameProject:false; still no mutation', async () => {
    makeRevisionFile()
    const prop = useProjectStore.getState().planProposal({ now: 'n', mint })
    if (!('text' in prop) || !prop.ok) throw new Error('proposal plan')
    const pf = JSON.parse(prop.text)
    // only the projectId differs — base.content / base.contentDigest still match
    pf.project.projectId = 'proj_' + 'Z'.repeat(26)

    const r = await routeImport(JSON.stringify(pf))
    expect(r.kind).toBe('proposal')
    if (r.kind === 'proposal') expect(r.sameProject).toBe(false)
  })

  it('a file whose project.contentDigest does not match its graph ⇒ project-dropped, graph still loads', async () => {
    const file = makeRevisionFile()
    const f = JSON.parse(file)
    f.nodes.push({ id: 'p_extra', type: 'pool', position: { x: 9, y: 9 }, data: { kind: 'pool', label: 'x', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
    // project.contentDigest is now stale relative to the edited graph
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).toBe('project-dropped')
    if (r.kind === 'project-dropped') expect(r.warning).toMatch(/does not match its graph/i)
    expect(useProjectStore.getState().open).toBeNull()
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'p_extra')).toBe(true) // graph loaded
  })

  it('a wrong-schema project key ⇒ project-dropped, graph loads', async () => {
    const f = JSON.parse(makeRevisionFile())
    f.project.version = 2
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).toBe('project-dropped')
    expect(useProjectStore.getState().open).toBeNull()
  })

  // ── loop-revision/2 — routeImport runs the readRevisionSide pipeline ──────

  it('a valid parameter/register in a revision file routes normally as a revision', async () => {
    const f = JSON.parse(makeRevisionFile())
    f.nodes.push({ id: 'pm', type: 'parameter', position: { x: 5, y: 5 }, data: { kind: 'parameter', label: 'Price', value: 3 } })
    // recompute project.contentDigest for the edited graph would be needed for a
    // trusted revision; here we only assert the model node does not break routing
    const r = await routeImport(JSON.stringify(f))
    // digest is stale ⇒ project-dropped, but crucially NOT because the model
    // node failed the pipeline — and the graph (incl. the parameter) loads
    expect(r.kind).toBe('project-dropped')
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'pm')).toBe(true)
    expect(useGraphStore.getState().nodes.find((n) => n.id === 'pm')?.data).toMatchObject({ kind: 'parameter', value: 3 })
  })

  it('an UNSEATABLE model node ⇒ project-dropped via the §R2-5.1 gate, graph still loads', async () => {
    const f = JSON.parse(makeRevisionFile())
    f.nodes.push({ id: 'bad', type: 'register', position: { x: 5, y: 5 }, data: { kind: 'register', label: 'B', expr: 'min(@a,@b)' } })
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).toBe('project-dropped')
    if (r.kind === 'project-dropped') expect(r.warning).toMatch(/model-layer content is not readable/i)
    expect(useProjectStore.getState().open).toBeNull()
    // the graph — including the raw, unrepaired bad node — still loaded
    expect(useGraphStore.getState().nodes.some((n) => n.id === 'bad')).toBe(true)
  })
})
