import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { phaseAt, type DocPhase } from '../src/model/phases'
import { displayRational } from '../src/model/rational'
import { canonicalContent, digestOfCanonical } from '../src/model/revision'
import { runFindings } from '../src/model/runRule'
import { deserialize } from '../src/model/serialize'
import { exactPlan, timetableRateFactor } from '../src/model/timetable'
import { semanticDigest } from '../src/model/workspace'
import '../src/store/editPolicy'
import { useGraphStore } from '../src/store/graphStore'
import { useProjectStore } from '../src/store/projectStore'
import { applyPendingProposal, classifyPendingProposal, openPendingProposalAsDocument, phaseTimingForPending, routeImport, threeWayForPending, type PendingProposal } from '../src/store/revisionIO'

// SEMANTICS-R13.md — the phases of a run through the app's own revision Apply, with the
// coffee roasting batch as the open document (Drying 2–5, Browning 6–9; its release tables
// change rate at minute 5).
//
// The case that started this (Lumi, 2026-11-14): a proposal moves the drying / browning
// boundary from minute 5 to minute 7. When the Apply kept the open document's phases,
// steps 6 and 7 were named Browning while the tables released at the drying rates. Now the
// phases are revision content: a whole Apply takes the proposal's with its tables, the
// review can say when names and timing would come from different sides, and one Undo
// takes both back.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
let seq = 0
const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`
const COFFEE = readFileSync(resolve(import.meta.dirname, '..', 'examples', 'coffee-roasting-batch.json'), 'utf8')
const g = () => useGraphStore.getState()

/** the open document at step k: what its moisture table releases, and the phase its `phases` name */
function at(k: number) {
  const s = g()
  const coffee = s.kinds.find((x) => x.name === 'coffee mass')!
  const t = s.timetables.find((x) => x.id === 'moisture')!
  return { moisture: displayRational(exactPlan(t, k, timetableRateFactor(t, coffee, s.time)!, s.time!)).text, phase: phaseAt(s.phases, k)?.label ?? null }
}
/** the minute at which the open document's release tables go from the drying to the browning rate */
const boundary = () => g().timetables.find((x) => x.id === 'moisture')!.points[2]![0]
const spans = (phases: readonly DocPhase[] = g().phases) => phases.filter((p) => p.id === 'roast_drying' || p.id === 'roast_browning').map((p) => `${p.label} ${p.from}–${p.to}`)
const OLD = ['Drying 2–5', 'Browning 6–9']
const NEW = ['Drying 2–7', 'Browning 8–9']

type Change = { tables?: boolean; phases?: boolean; rename?: boolean; label?: boolean }
/** a proposal file made from the open document, with its digest honest */
function proposalFile(change: Change): string {
  const res = useProjectStore.getState().planProposal({ now: '2026-11-14T00:00:00Z', mint })
  if (!('text' in res) || !res.ok) throw new Error('proposal plan')
  const f = JSON.parse(res.text)
  if (change.tables) {
    for (const t of f.timetables) if (['moisture', 'volatiles', 'chaff'].includes(t.id)) t.points = t.points.map((p: [string, string]) => (p[0] === '5' ? ['7', p[1]] : p))
  }
  if (change.phases) f.phases = f.phases.map((p: DocPhase) => (p.id === 'roast_drying' ? { ...p, to: 7 } : p.id === 'roast_browning' ? { ...p, from: 8 } : p))
  if (change.rename) f.phases = f.phases.map((p: DocPhase) => (p.id === 'roast_browning' ? { ...p, label: 'Maillard' } : p))
  if (change.label) f.nodes.find((n: { id: string }) => n.id === 'roast_drum').data.label = 'Drum'
  const d = deserialize(JSON.stringify(f))
  f.project.contentDigest = digestOfCanonical(
    canonicalContent({ nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, dataImports: d.dataImports, kinds: d.kinds, time: d.time, timetables: d.timetables, phases: d.phases }, { modelVersion: d.modelVersion }),
  )
  return JSON.stringify(f)
}
async function proposal(change: Change): Promise<PendingProposal> {
  const r = await routeImport(proposalFile(change))
  if (r.kind !== 'proposal') throw new Error(`expected proposal, got ${r.kind}`)
  return r
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  seq = 0
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  g().loadJSON(COFFEE)
  const p = useProjectStore.getState().planRevision({ now: '2026-11-13T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
  expect(spans()).toEqual(OLD)
  expect(boundary()).toBe('5')
})

describe('a revision file with phases', () => {
  it('declares the current semantics (/14, which includes the phases of /13), carries the phases inside its content digest, and is read as a proposal of this project', async () => {
    const text = proposalFile({ tables: true, phases: true })
    const f = JSON.parse(text)
    expect(f.project.semantics).toBe('loop-revision/14')
    expect(spans(f.phases)).toEqual(NEW)
    const p = await proposal({ tables: true, phases: true })
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'exact' })
    // a file whose phases were changed after its digest was written is not accepted as this proposal
    f.phases[1].label = 'Tampered'
    const r = await routeImport(JSON.stringify(f))
    expect(r.kind).not.toBe('proposal')
  })
})

describe('whole Apply', () => {
  it('takes the proposal’s phases with its tables: step 6 is Drying at the drying rate, and one Undo takes both back', async () => {
    expect(at(6)).toEqual({ moisture: '0.25', phase: 'Browning' })
    const p = await proposal({ tables: true, phases: true })
    // nothing would be split, so the review has nothing to say
    expect(phaseTimingForPending(p, { mode: 'whole' })).toBeNull()
    const undoBefore = g().past.length
    expect(applyPendingProposal(p).ok).toBe(true)
    expect(boundary()).toBe('7')
    expect(spans()).toEqual(NEW)
    expect([at(5), at(6), at(7), at(8)]).toEqual([
      { moisture: '1.2', phase: 'Drying' },
      { moisture: '1.2', phase: 'Drying' },
      { moisture: '1.2', phase: 'Drying' },
      { moisture: '0.25', phase: 'Browning' },
    ])
    const s = g()
    expect(runFindings(s.nodes, s.edges, s.timetables, s.kinds, s.time, s.modelVersion)).toEqual([])
    // the applied content is the new baseline: not dirty, and exactly one undo entry
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(g().past.length).toBe(undoBefore + 1)

    g().undo()
    expect(boundary()).toBe('5')
    expect(spans()).toEqual(OLD)
    expect(at(6)).toEqual({ moisture: '0.25', phase: 'Browning' })
    g().redo()
    expect(boundary()).toBe('7')
    expect(spans()).toEqual(NEW)
  })

  it('the proposer moved the tables and left the phases: the review is told, and the names do go stale as it says', async () => {
    const p = await proposal({ tables: true })
    // no `phases` hunk to offer: the proposal's phases are the base's
    expect(threeWayForPending(p).phases).toBeUndefined()
    expect(phaseTimingForPending(p, { mode: 'whole' })).toBe('timing-only')
    expect(applyPendingProposal(p).ok).toBe(true)
    expect(boundary()).toBe('7')
    expect(spans()).toEqual(OLD)
    // what the notice said would happen: steps 6 and 7 named Browning at the drying rate
    expect([at(6), at(7), at(8)]).toEqual([
      { moisture: '1.2', phase: 'Browning' },
      { moisture: '1.2', phase: 'Browning' },
      { moisture: '0.25', phase: 'Browning' },
    ])
  })

  it('a proposal that removes the phases clears them, and Undo brings them back', async () => {
    const res = useProjectStore.getState().planProposal({ now: '2026-11-14T00:00:00Z', mint })
    if (!('text' in res) || !res.ok) throw new Error('proposal plan')
    const f = JSON.parse(res.text)
    delete f.phases
    const d = deserialize(JSON.stringify(f))
    f.project.contentDigest = digestOfCanonical(canonicalContent({ nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, kinds: d.kinds, time: d.time, timetables: d.timetables }, { modelVersion: d.modelVersion }))
    const r = await routeImport(JSON.stringify(f))
    if (r.kind !== 'proposal') throw new Error('expected proposal')
    expect(applyPendingProposal(r).ok).toBe(true)
    expect(g().phases).toEqual([])
    g().undo()
    expect(spans()).toEqual(OLD)
  })

  it('a target whose phases the user changed differently is a conflict: the whole Apply asks first', async () => {
    const p = await proposal({ phases: true })
    useGraphStore.setState({ phases: g().phases.map((x) => (x.id === 'roast_drying' ? { ...x, to: 4 } : x.id === 'roast_browning' ? { ...x, from: 5 } : x)) })
    expect(threeWayForPending(p).phases?.verdict).toBe('conflict')
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'divergent' })
    expect(applyPendingProposal(p)).toMatchObject({ ok: false, reason: 'needs-confirmation' })
    expect(spans()).toEqual(['Drying 2–4', 'Browning 5–9'])
    expect(applyPendingProposal(p, { confirmed: true }).ok).toBe(true)
    expect(spans()).toEqual(NEW)
  })
})

describe('choosing changes', () => {
  // the timetables and the step length are lines of their own since SEMANTICS-R14.md
  // (`test/revision-choose-units.test.ts`); here they are left with the open document

  it('the user keeps their phases and their tables: nothing of the timing or the names changes, so nothing goes stale and nothing is said', async () => {
    const p = await proposal({ tables: true, phases: true, label: true })
    expect(threeWayForPending(p).phases).toMatchObject({ verdict: 'clean' })
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'yours' })).toBeNull()
    const res = applyPendingProposal(p, { selection: { accept: {}, fieldChoices: { roast_drum: { 'data.label': 'proposed' } }, phases: 'yours' } })
    expect(res.ok).toBe(true)
    expect(g().nodes.find((n) => n.id === 'roast_drum')!.data.label).toBe('Drum')
    expect(boundary()).toBe('5') // the tables were not taken
    expect(spans()).toEqual(OLD) // and the phases were kept
    expect(at(6)).toEqual({ moisture: '0.25', phase: 'Browning' })
  })

  it('the user takes the proposal’s phases onto their own tables: the review is told, and the names do go stale as it says', async () => {
    const p = await proposal({ tables: true, phases: true })
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'proposed' })).toBe('phases-only')
    const undoBefore = g().past.length
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: {}, phases: 'proposed' } }).ok).toBe(true)
    expect(boundary()).toBe('5')
    expect(spans()).toEqual(NEW)
    // steps 6 and 7: the proposal's name on this document's tables
    expect([at(6), at(7)]).toEqual([
      { moisture: '0.25', phase: 'Drying' },
      { moisture: '0.25', phase: 'Drying' },
    ])
    expect(g().past.length).toBe(undoBefore + 1)
    g().undo()
    expect(spans()).toEqual(OLD)
  })

  it('a proposal that only renames a phase: taking it splits nothing, applies as one undo entry, and resets no table', async () => {
    const p = await proposal({ rename: true })
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'proposed' })).toBeNull()
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: {}, phases: 'proposed' } }).ok).toBe(true)
    expect(g().phases.find((x) => x.id === 'roast_browning')!.label).toBe('Maillard')
    expect(boundary()).toBe('5')
    expect(useProjectStore.getState().dirty).toBe(false)
    g().undo()
    expect(g().phases.find((x) => x.id === 'roast_browning')!.label).toBe('Browning')
  })

  it('keeping the phases of a phases-only proposal changes nothing, and is refused as no effective change', async () => {
    const p = await proposal({ rename: true })
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: {}, phases: 'yours' } })).toMatchObject({ ok: false, reason: 'no-effective-change' })
    expect(g().phases.find((x) => x.id === 'roast_browning')!.label).toBe('Browning')
  })
})

describe('opening a proposal as a document', () => {
  it('brings the proposal’s own phases with its tables', async () => {
    const p = await proposal({ tables: true, phases: true })
    openPendingProposalAsDocument(p)
    expect(boundary()).toBe('7')
    expect(spans()).toEqual(NEW)
    expect(at(6)).toEqual({ moisture: '1.2', phase: 'Drying' })
    expect(useProjectStore.getState().dirty).toBe(false)
  })
})

describe('the open project and the phases', () => {
  it('a change of the phases makes the open revision dirty, and the engine digest does not move', async () => {
    const engine = async () => semanticDigest({ nodes: g().nodes, edges: g().edges, kinds: g().kinds, time: g().time, timetables: g().timetables }, g().modelVersion)
    const before = await engine()
    useGraphStore.setState({ phases: g().phases.map((x) => (x.id === 'roast_browning' ? { ...x, label: 'Maillard' } : x)) })
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(true)
    expect(await engine()).toBe(before)
  })
})
