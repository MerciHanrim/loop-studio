import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anyUnchecked, type DocPhase } from '../src/model/phases'
import { canonicalContent, digestOfCanonical, REVISION_SEMANTICS, type HunkSelection } from '../src/model/revision'
import { deserialize, loadFromStorage } from '../src/model/serialize'
import { semanticDigest } from '../src/model/workspace'
import '../src/store/editPolicy'
import { flushAutosave, useGraphStore } from '../src/store/graphStore'
import { useProjectStore } from '../src/store/projectStore'
import { applyPendingProposal, classifyPendingProposal, defaultGraphChoicesForPending, phaseTimingForPending, routeImport, threeWayForPending, type PendingProposal } from '../src/store/revisionIO'
import { useUiStore } from '../src/store/uiStore'

// SEMANTICS-R15.md (#558, second PR) — the mark that stays in the document after an Apply
// that left the phase names and the timing on different sides, through the app's own
// Apply, save, reopen and undo. The open document is the coffee roasting batch: Drying is
// steps 2–5 and Browning 6–9, and its release tables change rate at minute 5.
//
// SET by an Apply for which the review showed the notice of SEMANTICS-R14.md §R14-4.
// CLEARED by: the Undo of that Apply; an Apply that takes phases and timing together from
// a side without the mark; the phases being removed; the reader's own "I checked the
// phases and the timetables".

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

type Doc = { nodes: any[]; edges: any[]; kinds: any[]; time: any; timetables: any[]; phases?: any[]; project: any }
function proposalFile(edit: (f: Doc) => void): string {
  const res = useProjectStore.getState().planProposal({ now: '2026-11-14T00:00:00Z', mint })
  if (!('text' in res) || !res.ok) throw new Error('proposal plan')
  const f = JSON.parse(res.text) as Doc
  edit(f)
  const d = deserialize(JSON.stringify(f))
  f.project.contentDigest = digestOfCanonical(
    canonicalContent({ nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, dataImports: d.dataImports, kinds: d.kinds, time: d.time, timetables: d.timetables, phases: d.phases }, { modelVersion: d.modelVersion }),
  )
  return JSON.stringify(f)
}
async function proposal(edit: (f: Doc) => void): Promise<PendingProposal> {
  const r = await routeImport(proposalFile(edit))
  if (r.kind !== 'proposal') throw new Error(`expected proposal, got ${r.kind}`)
  return r
}
const chosen = (p: PendingProposal, over: Partial<HunkSelection> = {}): HunkSelection => ({ accept: {}, fieldChoices: {}, frames: 'yours', ...defaultGraphChoicesForPending(p, threeWayForPending(p)), ...over })

/** the boundary of the three release tables from minute 5 to `at` */
const moveTables = (at: string) => (f: Doc) => {
  for (const t of f.timetables) if (['moisture', 'volatiles', 'chaff'].includes(t.id)) t.points = t.points.map((p: [string, string]) => (p[0] === '5' ? [at, p[1]] : p))
}
/** the Drying / Browning phases moved with it */
const movePhases = (f: Doc) => {
  f.phases = f.phases!.map((p: DocPhase) => (p.id === 'roast_drying' ? { ...p, to: 7 } : p.id === 'roast_browning' ? { ...p, from: 8 } : p))
}
const both = (f: Doc) => {
  moveTables('7')(f)
  movePhases(f)
}

const marks = () => g().phases.map((p) => p.unchecked === true)
const ALL = [true, true, true, true, true, true, true]
const NONE = [false, false, false, false, false, false, false]
const drying = () => {
  const p = g().phases.find((x) => x.id === 'roast_drying')!
  return `${p.from}–${p.to}`
}
const boundary = () => g().timetables.find((x) => x.id === 'moisture')!.points[2]![0]

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  seq = 0
  useUiStore.getState().setCanvasLocked(false)
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  g().loadJSON(COFFEE)
  const p = useProjectStore.getState().planRevision({ now: '2026-11-13T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
  expect(marks()).toEqual(NONE)
})

describe('the mark is set by an Apply that leaves names and timing on different sides', () => {
  it('a whole Apply of a proposal whose author moved the tables and left the phases', async () => {
    const p = await proposal(moveTables('7'))
    expect(phaseTimingForPending(p, { mode: 'whole' })).toBe('timing-only')
    expect(applyPendingProposal(p).ok).toBe(true)
    expect([boundary(), drying()]).toEqual(['7', '2–5'])
    expect(marks()).toEqual(ALL)
    // the applied content, mark included, is the new baseline
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('a chosen Apply that takes the phases and keeps the tables', async () => {
    const p = await proposal(both)
    const sel = chosen(p, { timetables: 'yours', phases: 'proposed' })
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: sel.phases, timetables: sel.timetables, time: sel.time })).toBe('phases-only')
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect([boundary(), drying()]).toEqual(['5', '2–7'])
    expect(marks()).toEqual(ALL)
  })

  it('a chosen Apply that takes the tables and keeps the phases: the kept phases are marked, since it is their timing that moved', async () => {
    const p = await proposal(both)
    const sel = chosen(p, { timetables: 'proposed', phases: 'yours' })
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect([boundary(), drying()]).toEqual(['7', '2–5'])
    expect(marks()).toEqual(ALL)
  })

  it('is not set when names and timing come together, whole or chosen, nor by an Apply that touches neither', async () => {
    const p = await proposal(both)
    expect(applyPendingProposal(p).ok).toBe(true)
    expect(marks()).toEqual(NONE)
    g().undo()
    expect(applyPendingProposal(p, { selection: chosen(p) }).ok).toBe(true)
    expect([boundary(), drying(), marks()]).toEqual(['7', '2–7', NONE])
    g().undo()
    const label = await proposal((f) => {
      f.nodes.find((n) => n.id === 'roast_drum').data.label = 'Drum'
    })
    expect(applyPendingProposal(label).ok).toBe(true)
    expect(marks()).toEqual(NONE)
  })
})

describe('where the mark goes with the document', () => {
  /** the stale case: the proposal's phases on the open document's tables */
  const split = async () => {
    const p = await proposal(both)
    expect(applyPendingProposal(p, { selection: chosen(p, { timetables: 'yours', phases: 'proposed' }) }).ok).toBe(true)
    expect(marks()).toEqual(ALL)
  }

  it('a saved file carries it on every phase, and opening the file brings it back', async () => {
    await split()
    const text = g().exportJSON()
    const file = JSON.parse(text)
    expect(file.phases.map((p: DocPhase) => p.unchecked)).toEqual(ALL)
    expect(Object.keys(file.phases[0])).toEqual(['id', 'label', 'from', 'to', 'unchecked'])
    g().newGraph()
    expect(g().phases).toEqual([])
    g().loadJSON(text)
    expect([drying(), marks()]).toEqual(['2–7', ALL])
  })

  it('the autosave record carries it: a reload reads the mark', async () => {
    await split()
    expect(loadFromStorage()?.phases?.map((p) => p.unchecked === true)).toEqual(ALL)
  })

  it('a project revision file carries it inside its digest and declares /15; it opens as that revision, marked', async () => {
    await split()
    const plan = useProjectStore.getState().planRevision({ now: '2026-11-14T01:00:00Z', mint })
    if (!plan.ok) throw new Error('revision plan')
    const file = JSON.parse(plan.text)
    expect(REVISION_SEMANTICS).toBe('loop-revision/15')
    expect(file.project.semantics).toBe('loop-revision/15')
    expect(file.phases.every((p: DocPhase) => p.unchecked === true)).toBe(true)
    // a file whose mark was taken off after its digest was written is not this revision any more
    const tampered = JSON.parse(plan.text)
    for (const ph of tampered.phases) delete ph.unchecked
    expect((await routeImport(JSON.stringify(tampered))).kind).not.toBe('revision')
    const opened = await routeImport(plan.text)
    expect(opened.kind).toBe('revision')
    expect(marks()).toEqual(ALL)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('the run does not read it: the engine digest is the same with and without', async () => {
    const engine = () => semanticDigest({ nodes: g().nodes, edges: g().edges, kinds: g().kinds, time: g().time, timetables: g().timetables }, g().modelVersion)
    const before = await engine()
    await split()
    g().undo()
    const clean = await engine()
    g().redo()
    expect(await engine()).toBe(clean)
    expect(clean).toBe(before)
  })
})

describe('the mark is cleared', () => {
  const split = async () => {
    const p = await proposal(both)
    expect(applyPendingProposal(p, { selection: chosen(p, { timetables: 'yours', phases: 'proposed' }) }).ok).toBe(true)
    expect(marks()).toEqual(ALL)
    return p
  }

  it('1. by the Undo of the Apply that set it, and comes back with Redo', async () => {
    await split()
    g().undo()
    expect([drying(), marks()]).toEqual(['2–5', NONE])
    g().redo()
    expect([drying(), marks()]).toEqual(['2–7', ALL])
  })

  it('2. by an Apply that takes phases and timing together from a side without the mark', async () => {
    const first = await split()
    // the same proposal again, this time with its tables: the proposal's phases on the proposal's timing
    expect(threeWayForPending(first).phases?.verdict).toBe('conflict') // the open phases now differ from the base by the mark
    const sel = chosen(first, { timetables: 'proposed', phases: 'proposed' })
    expect(phaseTimingForPending(first, { mode: 'hunks', phases: sel.phases, timetables: sel.timetables, time: sel.time })).toBeNull()
    expect(applyPendingProposal(first, { selection: sel }).ok).toBe(true)
    expect([boundary(), drying(), marks()]).toEqual(['7', '2–7', NONE])
    // one Undo takes that Apply back, to the marked document
    g().undo()
    expect([boundary(), marks()]).toEqual(['5', ALL])
  })

  it('2. and by a whole Apply of such a proposal', async () => {
    const first = await split()
    expect(classifyPendingProposal(first)).toEqual({ ok: true, classification: 'divergent' })
    expect(applyPendingProposal(first, { confirmed: true }).ok).toBe(true)
    expect([boundary(), drying(), marks()]).toEqual(['7', '2–7', NONE])
  })

  it('it stays through an Apply that takes neither, and through one that moves the timing again', async () => {
    await split()
    const label = await proposal((f) => {
      f.nodes.find((n) => n.id === 'roast_drum').data.label = 'Drum'
    })
    expect(applyPendingProposal(label).ok).toBe(true)
    expect(marks()).toEqual(ALL)
    const again = await proposal(moveTables('6'))
    expect(applyPendingProposal(again).ok).toBe(true)
    expect([boundary(), marks()]).toEqual(['6', ALL])
  })

  it('3. when the phases are removed: there is nothing left to be marked', async () => {
    await split()
    const p = await proposal((f) => {
      delete f.phases
    })
    expect(applyPendingProposal(p).ok).toBe(true)
    expect(g().phases).toEqual([])
    expect(anyUnchecked(g().phases)).toBe(false)
  })

  describe('4. by the reader’s own "I checked the phases and the timetables"', () => {
    it('takes the mark off every phase, as one undo entry, and makes the open revision dirty', async () => {
      await split()
      const undoBefore = g().past.length
      const rev = g().simulationRev
      expect(g().confirmPhasesChecked()).toBe(true)
      expect([drying(), marks()]).toEqual(['2–7', NONE])
      expect(g().past.length).toBe(undoBefore + 1)
      // a phase is nothing the run reads: a run under way goes on
      expect(g().simulationRev).toBe(rev)
      useProjectStore.getState().refreshDirty()
      expect(useProjectStore.getState().dirty).toBe(true)
      // nothing left to confirm
      expect(g().confirmPhasesChecked()).toBe(false)
    })

    it('Undo brings the mark back and Redo takes it off again', async () => {
      await split()
      g().confirmPhasesChecked()
      g().undo()
      expect([drying(), marks()]).toEqual(['2–7', ALL])
      g().redo()
      expect(marks()).toEqual(NONE)
      // and two Undos go back past the Apply itself
      g().undo()
      g().undo()
      expect([drying(), marks()]).toEqual(['2–5', NONE])
    })

    it('saved and opened again after it, the document is not marked: a file, the autosave record and a revision file', async () => {
      await split()
      g().confirmPhasesChecked()
      const text = g().exportJSON()
      expect(JSON.parse(text).phases.some((p: DocPhase) => 'unchecked' in p)).toBe(false)
      // the autosave of an edit is debounced: the record still holds the mark until it is written,
      // as after any edit, and holds none once it is
      expect(loadFromStorage()?.phases?.some((p) => p.unchecked === true)).toBe(true)
      flushAutosave()
      expect(loadFromStorage()?.phases?.some((p) => p.unchecked === true)).toBe(false)
      const plan = useProjectStore.getState().planRevision({ now: '2026-11-14T02:00:00Z', mint })
      if (!plan.ok) throw new Error('revision plan')
      expect(JSON.parse(plan.text).phases.some((p: DocPhase) => 'unchecked' in p)).toBe(false)
      g().newGraph()
      g().loadJSON(text)
      expect([drying(), marks()]).toEqual(['2–7', NONE])
      expect((await routeImport(plan.text)).kind).toBe('revision')
      expect(marks()).toEqual(NONE)
    })

    it('is refused while the edit lock is on, and nothing changes', async () => {
      await split()
      useUiStore.getState().setCanvasLocked(true)
      const undoBefore = g().past.length
      expect(g().confirmPhasesChecked()).toBe(false)
      expect(marks()).toEqual(ALL)
      expect(g().past.length).toBe(undoBefore)
      useUiStore.getState().setCanvasLocked(false)
      expect(g().confirmPhasesChecked()).toBe(true)
    })

    it('does nothing in a document with no mark', () => {
      const undoBefore = g().past.length
      expect(g().confirmPhasesChecked()).toBe(false)
      expect(g().past.length).toBe(undoBefore)
    })
  })
})

describe('the mark is content of the phases unit in a review', () => {
  /** a proposal whose own phases carry the mark and that changes nothing else */
  const marked = (f: Doc) => {
    f.phases = f.phases!.map((p: DocPhase) => ({ ...p, unchecked: true }))
  }

  it('a proposal that differs only in the mark is a change of the phases: one clean line, not "no changes"', async () => {
    const p = await proposal(marked)
    const plan = threeWayForPending(p)
    expect(plan.phases?.verdict).toBe('clean')
    expect(plan.hunks).toEqual([])
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'exact' })
  })

  it('a whole Apply brings the proposal’s mark; keeping the phases in a chosen Apply does not', async () => {
    const p = await proposal(marked)
    expect(applyPendingProposal(p).ok).toBe(true)
    expect(marks()).toEqual(ALL)
    g().undo()
    expect(applyPendingProposal(p, { selection: chosen(p, { phases: 'yours' }) })).toMatchObject({ ok: false, reason: 'no-effective-change' })
    expect(marks()).toEqual(NONE)
  })

  it('a marked document that is sent on as a proposal keeps the mark on the way', async () => {
    const stale = await proposal(both)
    expect(applyPendingProposal(stale, { selection: chosen(stale, { timetables: 'yours', phases: 'proposed' }) }).ok).toBe(true)
    const res = useProjectStore.getState().planProposal({ now: '2026-11-14T03:00:00Z', mint })
    if (!('text' in res) || !res.ok) throw new Error('proposal plan')
    expect(JSON.parse(res.text).phases.every((x: DocPhase) => x.unchecked === true)).toBe(true)
    expect(JSON.parse(res.text).project.semantics).toBe('loop-revision/15')
  })
})
