import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initSim, step } from '../src/engine'
import { canonicalContent, digestOfCanonical, readRevisionSideAndProject } from '../src/model/revision'
import { deserialize } from '../src/model/serialize'
import { useDataImportStore } from '../src/store/dataImportStore'
import { useFrameStore } from '../src/store/frameStore'
import { useGraphStore } from '../src/store/graphStore'
import { useMcStore } from '../src/store/mcStore'
import { useProjectStore } from '../src/store/projectStore'
import {
  applyPendingProposal,
  classifyPendingProposal,
  openPendingProposalAsDocument,
  routeImport,
  threeWayForPending,
} from '../src/store/revisionIO'
import { useSimStore } from '../src/store/simStore'

// v0.10.0 legacy-envelope fixtures — see examples/revision-legacy-v0.10.0/README.md.
// These files are REAL v0.10.0 output (v1 envelope `schema`, v2 digest) and
// are never regenerated: the point is to pin how the current reader recovers
// exactly that shape, and only that shape.

const DIR = resolve(import.meta.dirname, '..', 'examples', 'revision-legacy-v0.10.0')
const read = (name: string): string => readFileSync(resolve(DIR, name), 'utf8')
const LR0 = read('LR0.json')
const LP0 = read('LP0.json')
const LP1 = read('LP1.json')
const V1_FIXTURE = readFileSync(resolve(import.meta.dirname, '..', 'examples', 'revision', 'base.revision.json'), 'utf8')

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
  useMcStore.getState().clear()
  useGraphStore.getState().newGraph()
  useSimStore.getState().reset()
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
})

/** identical to projectStore's own liveDigest(): nodes + edges + the on-screen
 *  saved frames + data-import records, projected at the live model version */
const liveDigest = () => {
  const g = useGraphStore.getState()
  return digestOfCanonical(
    canonicalContent(
      { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot(), dataImports: useDataImportStore.getState().snapshot() },
      { modelVersion: g.modelVersion },
    ),
  )
}

describe('the fixtures really are the v0.10.0 shape', () => {
  it('declare the v1 envelope but carry a v2-projected digest', () => {
    for (const text of [LR0, LP0, LP1]) {
      const f = JSON.parse(text)
      expect(f.schema).toBe('loop-studio/graph')
      expect(f.project.meta.tool).toBe('loop-studio/0.10.0')
      const v1 = digestOfCanonical(canonicalContent({ nodes: f.nodes, edges: f.edges, frames: f.frames }, { modelVersion: 1 }))
      const v2 = digestOfCanonical(canonicalContent({ nodes: f.nodes, edges: f.edges, frames: f.frames }, { modelVersion: 2 }))
      expect(f.project.contentDigest).toBe(v2)
      expect(f.project.contentDigest).not.toBe(v1)
    }
    // the proposals' first-creation base was projected as v1 by the same bug
    for (const text of [LP0, LP1]) {
      const f = JSON.parse(text)
      expect(f.project.base.content.modelSemantics).toBeUndefined()
      expect(f.project.base.contentDigest).toBe(digestOfCanonical(f.project.base.content))
    }
    // and they DO use @parameter references — the content that v1 would misread
    expect(JSON.parse(LR0).edges.some((e: { data: { flow?: string } }) => e.data.flow?.startsWith('@'))).toBe(true)
  })
})

describe('LR0 — a legacy v2 Project revision', () => {
  it('routes as a revision, loads as v2, adopts the header, is not dirty', async () => {
    const r = await routeImport(LR0)
    expect(r.kind).toBe('revision')
    if (r.kind !== 'revision') return
    expect(r.legacyV2Recovered).toBe(true)
    expect(r.project.revisionId).toBe(JSON.parse(LR0).project.revisionId)
    const g = useGraphStore.getState()
    expect(g.modelVersion).toBe(2)
    const open = useProjectStore.getState().open
    expect(open?.revisionId).toBe(r.project.revisionId)
    expect(open?.baselineDigest).toBe(liveDigest())
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
    // the autosave record + a re-export now carry the CORRECT envelope
    expect(JSON.parse(g.exportJSON()).schema).toBe('loop-studio/graph/2')
  })

  it('the engine resolves its @parameter flows (v2), not the v1 literal-1 fallback', async () => {
    await routeImport(LR0)
    const g = useGraphStore.getState()
    const asLoaded = step(g.nodes, g.edges, initSim(g.nodes), 1, g.modelVersion)
    const asV2 = step(g.nodes, g.edges, initSim(g.nodes), 1, 2)
    const asV1 = step(g.nodes, g.edges, initSim(g.nodes), 1, 1)
    expect(asLoaded.state.values).toEqual(asV2.state.values)
    expect(asLoaded.state.values).not.toEqual(asV1.state.values)
  })

  it('a re-export of the recovered document writes the v2 envelope with a matching digest', async () => {
    await routeImport(LR0)
    const plan = useProjectStore.getState().planRevision({ now: 'n' })
    if (!plan.ok) throw new Error('plan')
    const f = JSON.parse(plan.text)
    expect(f.schema).toBe('loop-studio/graph/2')
    expect(f.project.contentDigest).toBe(
      digestOfCanonical(canonicalContent({ nodes: f.nodes, edges: f.edges, frames: f.frames }, { modelVersion: 2 })),
    )
    // and that re-export round-trips WITHOUT the recovery path
    useGraphStore.getState().newGraph()
    useProjectStore.getState().clear()
    const r2 = await routeImport(plan.text)
    expect(r2.kind).toBe('revision')
    if (r2.kind === 'revision') expect(r2.legacyV2Recovered).toBe(false)
    expect(useGraphStore.getState().modelVersion).toBe(2)
  })
})

describe('the recovery is narrow', () => {
  it('a legacy file whose graph was ALSO edited (digest matches neither projection) is still dropped', async () => {
    const f = JSON.parse(LR0)
    const p = f.nodes.find((n: { data: { kind: string } }) => n.data.kind === 'parameter')
    p.data.value = p.data.value + 100
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).toBe('project-dropped')
    if (r.kind === 'project-dropped') expect(r.warning).toMatch(/does not match its graph/i)
    expect(useProjectStore.getState().open).toBeNull()
  })

  it('a legacy file with NO contentDigest has no proof — it loads as the declared v1, header kept, no promotion', async () => {
    const f = JSON.parse(LR0)
    delete f.project.contentDigest
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).toBe('revision')
    if (r.kind === 'revision') expect(r.legacyV2Recovered).toBe(false)
    expect(useGraphStore.getState().modelVersion).toBe(1)
  })

  it('a declared-v2 file never enters the recovery branch', () => {
    const f = JSON.parse(LR0)
    f.schema = 'loop-studio/graph/2'
    const parsed = deserialize(JSON.stringify(f))
    const r = readRevisionSideAndProject(
      { nodes: parsed.nodes, edges: parsed.edges, frames: parsed.frames, dataImports: parsed.dataImports, rawDataImportSignal: parsed.hasRawDataImportSignal },
      f.project,
      parsed.modelVersion,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.legacyV2Recovered).toBe(false)
      expect(r.modelVersion).toBe(2)
    }
  })

  it('a genuine v1 revision file: same routing, same digest strictness as before', async () => {
    const r = await routeImport(V1_FIXTURE)
    expect(r.kind).toBe('revision')
    if (r.kind === 'revision') expect(r.legacyV2Recovered).toBe(false)
    expect(useGraphStore.getState().modelVersion).toBe(1)
    expect(useProjectStore.getState().open?.revisionId).toBe(JSON.parse(V1_FIXTURE).project.revisionId)

    // tamper engine content (a resource flow), keep the header ⇒ dropped, exactly as today
    const f = JSON.parse(V1_FIXTURE)
    const e = f.edges.find((x: { data: { kind: string } }) => x.data.kind === 'resource')
    e.data.flow = '99'
    useGraphStore.getState().newGraph()
    useProjectStore.getState().clear()
    const r2 = await routeImport(JSON.stringify(f))
    expect(r2.kind).toBe('project-dropped')
    expect(useProjectStore.getState().open).toBeNull()
  })
})

describe('LP0 / LP1 — legacy v2 proposals onto the recovered LR0', () => {
  it('LP0 (unmodified): routes as a v2 proposal, classifies `unknown` (never auto-`exact`), applies keeping v2', async () => {
    await routeImport(LR0)
    const r = await routeImport(LP0)
    expect(r.kind).toBe('proposal')
    if (r.kind !== 'proposal') return
    expect(r.sameProject).toBe(true)
    expect(r.modelVersion).toBe(2)
    expect(r.legacyV2Recovered).toBe(true)
    // the v1-projected base is read verbatim, NOT lifted ⇒ not `exact`
    expect(classifyPendingProposal(r)).toEqual({ ok: true, classification: 'unknown' })
    // so a whole Apply needs the confirmation gate first
    const gated = applyPendingProposal(r)
    expect(gated.ok).toBe(false)
    if (!gated.ok) expect(gated.reason).toBe('needs-confirmation')
    const a = applyPendingProposal(r, { confirmed: true })
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.classification).toBe('unknown')
    expect(useGraphStore.getState().modelVersion).toBe(2)
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(useProjectStore.getState().open?.appliedProposal?.proposalId).toBe(r.project.revisionId)
  })

  it('LP1 (edited): the three-way shows the Parameter change; Apply lands it at v2', async () => {
    await routeImport(LR0)
    const before = useGraphStore.getState().nodes.find((n) => n.id === 'cafe_retail_demand_kg')!
    expect((before.data as { value: number }).value).toBe(6)
    const r = await routeImport(LP1)
    expect(r.kind).toBe('proposal')
    if (r.kind !== 'proposal') return
    const plan = threeWayForPending(r)
    const hunk = plan.hunks.find((h) => h.id === 'cafe_retail_demand_kg')
    expect(hunk?.kind).toBe('change')
    const a = applyPendingProposal(r, { confirmed: true })
    expect(a.ok).toBe(true)
    const after = useGraphStore.getState().nodes.find((n) => n.id === 'cafe_retail_demand_kg')!
    expect((after.data as { value: number }).value).toBe(7)
    expect(useGraphStore.getState().modelVersion).toBe(2)
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('Open as a document preserves the proposal\'s (recovered) v2 version', async () => {
    const r = await routeImport(LP0)
    expect(r.kind).toBe('proposal')
    if (r.kind !== 'proposal') return
    openPendingProposalAsDocument(r)
    expect(useGraphStore.getState().modelVersion).toBe(2)
    expect(useProjectStore.getState().open?.role).toBe('proposal')
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('a legacy v2 proposal onto a v1 document is refused (version-mismatch), nothing mutated', async () => {
    // a v1 project with the SAME projectId, so only the version gate can refuse
    await routeImport(LR0)
    const proj = useProjectStore.getState().open!
    useGraphStore.getState().newGraph()
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    useProjectStore.setState({ open: { ...proj, baselineDigest: liveDigest() }, dirty: false })
    expect(useGraphStore.getState().modelVersion).toBe(1)
    const sig = JSON.stringify(useGraphStore.getState().nodes.map((n) => n.id))
    const rev = useGraphStore.getState().simulationRev
    const r = await routeImport(LP0)
    expect(r.kind).toBe('proposal')
    if (r.kind !== 'proposal') return
    expect(classifyPendingProposal(r)).toEqual({ ok: false, reason: 'version-mismatch' })
    const a = applyPendingProposal(r, { confirmed: true })
    expect(a).toEqual({ ok: false, reason: 'version-mismatch' })
    expect(JSON.stringify(useGraphStore.getState().nodes.map((n) => n.id))).toBe(sig)
    expect(useGraphStore.getState().simulationRev).toBe(rev)
    expect(useGraphStore.getState().modelVersion).toBe(1)
  })
})
