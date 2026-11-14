import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initSim, step } from '../src/engine/step'
import type { SimState } from '../src/engine/types'
import { refusingKindFindings } from '../src/model/kinds'
import { phaseAt, type DocPhase } from '../src/model/phases'
import { displayRational } from '../src/model/rational'
import { canonicalContent, digestOfCanonical, type HunkSelection, type ThreeWayPlan } from '../src/model/revision'
import { runFindings } from '../src/model/runRule'
import { deserialize } from '../src/model/serialize'
import { timetableFindings } from '../src/model/timetable'
import type { LoopEdge } from '../src/model/types'
import '../src/store/editPolicy'
import { useGraphStore } from '../src/store/graphStore'
import { useProjectStore } from '../src/store/projectStore'
import { applyPendingProposal, classifyPendingProposal, defaultGraphChoicesForPending, diagnosticsForPending, phaseTimingForPending, routeImport, threeWayForPending, type PendingProposal } from '../src/store/revisionIO'

// SEMANTICS-R14.md (#558) — the kinds table, the step length and the timetables as lines
// of "choose changes", through the app's own Apply, with the coffee roasting batch as the
// open document: one conserved kind in kg with the rate unit "kg per min", a 1 min step,
// six timetables, seven phases.
//
// What a chosen Apply can do besides what its lines say, and what is said before it:
//   - a value in a unit the result reads another way than its own side: REFUSED;
//   - a run the checks would newly refuse: told with the lines that resolve it, allowed;
//   - a table read from the other side, either way round: told with both plans, allowed.

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

type Doc = { nodes: any[]; edges: any[]; kinds: any[]; time: any; timetables: any[]; phases: any[]; project: any }
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** a proposal file made from the open document and changed by `edit`, its digest honest */
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

/** the selection the review starts with: every clean element change, and the graph-level defaults */
function defaults(p: PendingProposal, plan: ThreeWayPlan = threeWayForPending(p)): HunkSelection {
  const accept: Record<string, boolean> = {}
  const fieldChoices: Record<string, Record<string, 'proposed' | 'yours'>> = {}
  for (const h of plan.hunks) {
    if (h.kind === 'change') fieldChoices[h.id] = Object.fromEntries((h.fields ?? []).filter((f) => f.verdict === 'clean').map((f) => [f.field, 'proposed' as const]))
    else if (h.verdict === 'clean') accept[h.id] = true
  }
  return { accept, fieldChoices, frames: 'yours', ...defaultGraphChoicesForPending(p, plan) }
}
const diag = (p: PendingProposal, sel: HunkSelection) => diagnosticsForPending(p, threeWayForPending(p), sel)!.findings

/** the refusals the run bars would show for the open document */
function refusals(): string[] {
  const s = g()
  return [
    ...timetableFindings(s.nodes, s.edges, s.timetables, s.kinds, s.time).map((f) => `table ${f.code} ${f.tableId}`),
    ...runFindings(s.nodes, s.edges, s.timetables, s.kinds, s.time, s.modelVersion).map((f) => `rule ${f.code} ${f.stage}`),
    ...refusingKindFindings(s.nodes, s.edges, s.kinds, s.modelVersion, s.time).map((f) => `kind ${f.cls}`),
  ]
}
/** the run of the open document to its end: the last step taken and the two Pools the cases read */
function run() {
  const s = g()
  const opts = { kinds: s.kinds, time: s.time, timetables: s.timetables }
  let st: SimState = initSim(s.nodes, opts)
  const moved: Record<string, number>[] = []
  for (let k = 1; k <= 45 && !st.ended; k++) {
    const r = step(s.nodes, s.edges as LoopEdge[], st, 1, s.modelVersion, opts)
    const at: Record<string, number> = {}
    for (const e of r.report.events) at[e.edgeId] = (at[e.edgeId] ?? 0) + e.amount
    moved.push(at)
    st = r.state
  }
  const round = (x: number) => Math.round(x * 1e6) / 1e6
  return { lastStep: st.step, roasted: round(st.values.roasted_beans ?? 0), hopper: round(st.values.bean_hopper ?? 0), moved: (edge: string, k: number) => round(moved[k - 1]?.[edge] ?? 0) }
}
const table = (id: string) => g().timetables.find((t) => t.id === id)
const dryingRate = () => table('moisture')!.points[1]![1]
const spans = () => g().phases.filter((p) => p.id === 'roast_drying' || p.id === 'roast_browning').map((p) => `${p.label} ${p.from}–${p.to}`)
const show = (r: { num: bigint; den: bigint }) => displayRational(r).text

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  seq = 0
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  g().loadJSON(COFFEE)
  const p = useProjectStore.getState().planRevision({ now: '2026-11-13T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
  expect(refusals()).toEqual([])
  expect(run()).toMatchObject({ lastStep: 19, roasted: 44.64 })
})

// ── the edits the cases share ─────────────────────────────────────────────────

/** #557's case: the drying / browning boundary of the three release tables from minute 5 to 7, and the phases with it */
const moveBoundary = (f: Doc) => {
  for (const t of f.timetables) if (['moisture', 'volatiles', 'chaff'].includes(t.id)) t.points = t.points.map((p: [string, string]) => (p[0] === '5' ? ['7', p[1]] : p))
  f.phases = f.phases.map((p: DocPhase) => (p.id === 'roast_drying' ? { ...p, to: 7 } : p.id === 'roast_browning' ? { ...p, from: 8 } : p))
}
/** T3: the drying release slowed (1.2 → 1.0), and the drop / discharge schedules and the four lines after the drum raised to match (44.64 → 45.44) */
const slowerDrying = (f: Doc) => {
  const t = f.timetables.find((x) => x.id === 'moisture')
  t.points = t.points.map((p: [string, string]) => (p[1] === '1.2' ? [p[0], '1.0'] : p))
  for (const id of ['drop', 'discharge']) {
    const s = f.timetables.find((x) => x.id === id)
    s.points = s.points.map((p: [string, string]) => (p[1] === '44.64' ? [p[0], '45.44'] : p))
  }
  for (const id of ['e_drum_drop', 'e_drop_cooler', 'e_cooler_discharge', 'e_discharge_roasted']) f.edges.find((e) => e.id === id).data.flow = '45.44'
}
const LINES_AFTER_DRUM = ['e_cooler_discharge', 'e_discharge_roasted', 'e_drop_cooler', 'e_drum_drop']

describe('the three lines: offered, pre-selected when clean, taken whole', () => {
  it('a proposal that moved its tables and its phases: both lines are clean and pre-selected, and the chosen Apply is the whole proposal', async () => {
    const p = await proposal(moveBoundary)
    const plan = threeWayForPending(p)
    expect(plan.timetables?.verdict).toBe('clean')
    expect(plan.kinds).toBeUndefined()
    expect(plan.time).toBeUndefined()
    const sel = defaults(p, plan)
    expect(sel).toMatchObject({ timetables: 'proposed', phases: 'proposed', kinds: 'yours', time: 'yours' })
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: sel.phases, timetables: sel.timetables, time: sel.time })).toBeNull()
    expect(diag(p, sel)).toEqual({ unitMisreads: [], newRefusals: [], tableSplits: [] })

    const undoBefore = g().past.length
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(table('moisture')!.points[2]![0]).toBe('7')
    expect(spans()).toEqual(['Drying 2–7', 'Browning 8–9'])
    expect(useProjectStore.getState().dirty).toBe(false)
    // one undo entry takes the tables and the phases back together
    expect(g().past.length).toBe(undoBefore + 1)
    g().undo()
    expect(table('moisture')!.points[2]![0]).toBe('5')
    expect(spans()).toEqual(['Drying 2–5', 'Browning 6–9'])
  })

  it('the tables left, the phases taken: the notice of SEMANTICS-R13 §R13-6, now by the user’s own choice', async () => {
    const p = await proposal(moveBoundary)
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'proposed', timetables: 'yours' })).toBe('phases-only')
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'yours', timetables: 'proposed' })).toBe('timing-only')
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'yours', timetables: 'yours' })).toBeNull()
  })

  it('a step length: one line, and the phases, which count steps, are pre-selected with it', async () => {
    const p = await proposal((f) => {
      f.time.step = { value: 30, unit: 's' }
      f.phases = f.phases.map((x: DocPhase) => ({ ...x, from: x.from * 2 - 1, to: x.to * 2 }))
    })
    const plan = threeWayForPending(p)
    expect(plan.time).toMatchObject({ verdict: 'clean', yours: { step: { value: 1, unit: 'min' } }, proposed: { step: { value: 30, unit: 's' } } })
    const sel = defaults(p, plan)
    expect(sel).toMatchObject({ time: 'proposed', phases: 'proposed' })
    // the step length alone is timing: the names without it, or it without the names, is a split
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'proposed', time: 'yours' })).toBe('phases-only')
    expect(phaseTimingForPending(p, { mode: 'hunks', phases: 'yours', time: 'proposed' })).toBe('timing-only')

    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(g().time).toMatchObject({ step: { value: 30, unit: 's' }, display: 'min' })
    expect(refusals()).toEqual([])
    expect(run()).toMatchObject({ lastStep: 38, roasted: 44.64 })
    expect([6, 12, 20].map((k) => phaseAt(g().phases, k)?.label)).toEqual(['Drying', 'Browning', 'Development'])
    g().undo()
    expect(g().time).toMatchObject({ step: { value: 1, unit: 'min' } })
    expect(run().lastStep).toBe(19)
  })

  it('a kinds table: one line, taken whole', async () => {
    const p = await proposal((f) => {
      f.kinds[0].units = [{ name: 'bag', factor: '60' }]
    })
    const plan = threeWayForPending(p)
    expect(plan.kinds?.verdict).toBe('clean')
    const sel = defaults(p, plan)
    expect(sel.kinds).toBe('proposed')
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(g().kinds[0]!.units).toEqual([{ name: 'bag', factor: '60' }])
    g().undo()
    expect(g().kinds[0]!.units).toBeUndefined()
  })

  it('keeping every line of a proposal that changed only those lines changes nothing, and is refused as no effective change', async () => {
    const p = await proposal(moveBoundary)
    expect(applyPendingProposal(p, { selection: { accept: {}, fieldChoices: {}, timetables: 'yours', phases: 'yours' } })).toMatchObject({ ok: false, reason: 'no-effective-change' })
  })
})

describe('a unit the open document changed differently is a conflict', () => {
  /** the user's own edit of the moisture table, after the proposal was made from the base */
  const editMine = () => useGraphStore.setState({ timetables: g().timetables.map((t) => (t.id === 'moisture' ? { ...t, points: t.points.map((x) => (x[1] === '1.2' ? [x[0], '1.1'] : x)) as [string, string][] } : t)) })

  it('the timetables line is not pre-selected, and neither are the phases that would then land on other timing', async () => {
    const p = await proposal(moveBoundary)
    editMine()
    const plan = threeWayForPending(p)
    expect(plan.timetables?.verdict).toBe('conflict')
    expect(plan.nConf).toBe(1)
    const sel = defaults(p, plan)
    expect(sel).toMatchObject({ timetables: 'yours', phases: 'yours' })
    // taking it is the user's to choose: the proposal's whole set replaces theirs, with no merge per table
    expect(applyPendingProposal(p, { selection: { ...sel, timetables: 'proposed', phases: 'proposed' } }).ok).toBe(true)
    expect(dryingRate()).toBe('1.2')
    expect(table('moisture')!.points[2]![0]).toBe('7')
  })

  it('a whole Apply over it counts the conflict and asks first', async () => {
    const p = await proposal(moveBoundary)
    editMine()
    expect(classifyPendingProposal(p)).toEqual({ ok: true, classification: 'divergent' })
    expect(applyPendingProposal(p)).toMatchObject({ ok: false, reason: 'needs-confirmation', classification: 'divergent' })
    expect(dryingRate()).toBe('1.1')
    expect(applyPendingProposal(p, { confirmed: true }).ok).toBe(true)
    expect(dryingRate()).toBe('1.2')
  })

  it('the open document already holds the proposed unit: there is no line to choose', async () => {
    const p = await proposal(moveBoundary)
    useGraphStore.setState({ timetables: deserialize(p.proposedText).timetables })
    expect(threeWayForPending(p).timetables?.verdict).toBe('noop')
    expect(defaults(p).timetables).toBe('yours')
  })
})

describe('a value read in another unit is refused', () => {
  /** K2: the amount unit "bag" (60 kg) declared, and the hopper's 54 kg written as 0.9 bag */
  const bags = (f: Doc) => {
    f.kinds[0].units = [{ name: 'bag', factor: '60' }]
    const d = f.nodes.find((n) => n.id === 'bean_hopper').data
    d.initial = 0.9
    d.unit = 'bag'
  }
  const hopperAtStart = () => initSim(g().nodes, { kinds: g().kinds, time: g().time }).values.bean_hopper

  it('with the defaults the value and its unit’s declaration come together: 54 kg', async () => {
    const p = await proposal(bags)
    const sel = defaults(p)
    expect(sel.kinds).toBe('proposed')
    expect(diag(p, sel).unitMisreads).toEqual([])
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(hopperAtStart()).toBe(54)
    expect(run()).toMatchObject({ lastStep: 19, roasted: 44.64 })
  })

  it('the value without the declaration would read 0.9 bag as 0.9 kg: named before the Apply, refused by it, nothing changed', async () => {
    const p = await proposal(bags)
    const sel: HunkSelection = { ...defaults(p), kinds: 'yours' }
    expect(diag(p, sel).unitMisreads).toEqual([{ elementType: 'node', id: 'bean_hopper', unit: 'bag', origin: 'proposed' }])
    const before = g().past.length
    const res = applyPendingProposal(p, { selection: sel })
    expect(res).toMatchObject({ ok: false, reason: 'invalid-selection', unitMisreads: [{ elementType: 'node', id: 'bean_hopper', unit: 'bag', origin: 'proposed' }] })
    expect(g().past.length).toBe(before)
    expect((g().nodes.find((n) => n.id === 'bean_hopper')!.data as { initial: number; unit?: string })).toMatchObject({ initial: 54 })
    expect(hopperAtStart()).toBe(54)
  })

  it('a line in a rate unit only the proposal declares is refused the same way, before the run could give another reason', async () => {
    // K1: "g per min" declared, and the two chaff lines written as 80 g per min (the same 0.08 kg per min)
    const p = await proposal((f) => {
      f.kinds[0].rateUnits.push({ name: 'g per min', factor: '0.001', per: 'min' })
      for (const id of ['e_drum_chaff', 'e_chaff_released']) Object.assign(f.edges.find((e) => e.id === id).data, { flow: '80', unit: 'g per min' })
    })
    const sel: HunkSelection = { ...defaults(p), kinds: 'yours' }
    expect(diag(p, sel).unitMisreads).toEqual([
      { elementType: 'edge', id: 'e_chaff_released', unit: 'g per min', origin: 'proposed' },
      { elementType: 'edge', id: 'e_drum_chaff', unit: 'g per min', origin: 'proposed' },
    ])
    expect(applyPendingProposal(p, { selection: sel })).toMatchObject({ ok: false, reason: 'invalid-selection' })
    expect(applyPendingProposal(p, { selection: defaults(p) }).ok).toBe(true)
    expect(refusals()).toEqual([])
    expect(run()).toMatchObject({ lastStep: 19, roasted: 44.64 })
  })

  it('the other way round: a kinds table that redefines a unit the kept values are written in', async () => {
    // the proposal reads "kg per min" as 60 times as much; no value of the open document was written for that
    const p = await proposal((f) => {
      f.kinds[0].rateUnits[0].factor = '60'
      f.edges.find((e) => e.id === 'e_drum_chaff').data.flow = '0.09'
    })
    // the kinds table taken and the proposal's line kept back: the kept line, in the same unit, would be read 60 times over
    const sel: HunkSelection = { ...defaults(p), fieldChoices: {} }
    expect(sel.kinds).toBe('proposed')
    const found = diag(p, sel).unitMisreads
    expect(found).toEqual([{ elementType: 'edge', id: 'e_drum_chaff', unit: 'kg per min', origin: 'yours' }])
    expect(applyPendingProposal(p, { selection: sel })).toMatchObject({ ok: false, reason: 'invalid-selection' })
    // a value both sides hold alike is on the proposal's side too, and reads as the proposal reads it
    expect(diag(p, defaults(p)).unitMisreads).toEqual([])
  })

  it('a value and a unit the user puts together field by field are the user’s own, and are not judged', async () => {
    const p = await proposal(bags)
    const sel: HunkSelection = { ...defaults(p), kinds: 'yours', fieldChoices: { bean_hopper: { 'data.initial': 'proposed', 'data.unit': 'yours' } } }
    expect(diag(p, sel).unitMisreads).toEqual([])
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(hopperAtStart()).toBe(0.9)
  })
})

describe('a run the checks would newly refuse is told, with the line that resolves it, and allowed', () => {
  it('a line that reads a table only the proposal holds', async () => {
    // T1
    const p = await proposal((f) => {
      const t = copy(f.timetables.find((x) => x.id === 'moisture'))
      Object.assign(t, { id: 'moisture_slow', label: 'Moisture release, slow' })
      f.timetables.push(t)
      f.edges.find((e) => e.id === 'e_drum_steam').data.flow = '~moisture_slow'
    })
    expect(diag(p, defaults(p)).newRefusals).toEqual([])
    const sel: HunkSelection = { ...defaults(p), timetables: 'yours' }
    expect(diag(p, sel).newRefusals).toEqual([{ from: 'timetable', finding: { code: 'unknown-table', edgeId: 'e_drum_steam', tableId: 'moisture_slow' }, resolvedBy: ['timetables'] }])
    // allowed: the document then says why it cannot run, and one Undo takes it back
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(refusals()).toEqual(['table unknown-table moisture_slow'])
    g().undo()
    expect(refusals()).toEqual([])
  })

  it('a rule that names a table only the proposal holds', async () => {
    // T2
    const p = await proposal((f) => {
      const t = copy(f.timetables.find((x) => x.id === 'chaff'))
      Object.assign(t, { id: 'chaff_late', label: 'Chaff release, late' })
      f.timetables.push(t)
      f.nodes.find((n) => n.id === 'chaff_release').data.run.table = 'chaff_late'
    })
    const sel: HunkSelection = { ...defaults(p), timetables: 'yours' }
    expect(diag(p, sel).newRefusals).toEqual([{ from: 'rule', finding: { code: 'unknown-table', stage: 'chaff_release' }, resolvedBy: ['timetables'] }])
  })

  it('the proposal’s tables in a unit only its kinds table declares: the kinds line resolves it', async () => {
    const p = await proposal((f) => {
      f.kinds[0].rateUnits.push({ name: 'g per min', factor: '0.001', per: 'min' })
      const t = f.timetables.find((x) => x.id === 'chaff')
      t.unit = 'g per min'
      t.points = t.points.map((x: [string, string]) => [x[0], String(Number(x[1]) * 1000)])
    })
    const sel: HunkSelection = { ...defaults(p), kinds: 'yours' }
    expect(diag(p, sel).newRefusals).toEqual([{ from: 'rule', finding: { code: 'bad-unit', stage: 'chaff_release' }, resolvedBy: ['kinds'] }])
    expect(diag(p, defaults(p)).newRefusals).toEqual([])
  })

  it('a refusal the open document already has is not told again', async () => {
    const p = await proposal((f) => {
      f.nodes.find((n) => n.id === 'roast_drum').data.label = 'Drum'
    })
    // the open document is then broken by hand: its steam line names a table it does not hold
    useGraphStore.setState({ edges: g().edges.map((e) => (e.id === 'e_drum_steam' ? ({ ...e, data: { ...e.data, flow: '~nowhere' } } as LoopEdge) : e)) })
    expect(refusals()).toEqual(['table unknown-table nowhere'])
    expect(diag(p, defaults(p)).newRefusals).toEqual([])
    expect(applyPendingProposal(p, { selection: defaults(p) }).ok).toBe(true)
  })
})

describe('a table read from the other side is told with both plans, either way round', () => {
  it('lines taken, tables kept: the taken lines read the open document’s drop and discharge schedules', async () => {
    // T3
    const p = await proposal(slowerDrying)
    const sel: HunkSelection = { ...defaults(p), timetables: 'yours' }
    const found = diag(p, sel)
    expect(found.unitMisreads).toEqual([])
    expect(found.newRefusals).toEqual([])
    // the moisture table changed too, and no taken line reads it: it is not named
    expect(found.tableSplits.map((s) => [s.tableId, s.direction, s.readers.map((r) => r.id).sort()])).toEqual([
      ['discharge', 'taken', ['e_cooler_discharge', 'e_discharge_roasted']],
      ['drop', 'taken', ['e_drop_cooler', 'e_drum_drop']],
    ])
    const drop = found.tableSplits.find((s) => s.tableId === 'drop')!.amounts!
    expect({ unit: drop.unit, lastStep: drop.lastStep, theirs: show(drop.theirs), yours: show(drop.yours), firstStep: drop.firstStep, theirsAt: show(drop.theirsAt), yoursAt: show(drop.yoursAt) }).toEqual({
      unit: 'kg',
      lastStep: 19,
      theirs: '45.44',
      yours: '44.64',
      firstStep: 14,
      theirsAt: '45.44',
      yoursAt: '44.64',
    })
    // and the run is what the warning said: the line says 45.44, the open document's table moves 44.64
    expect(applyPendingProposal(p, { selection: sel }).ok).toBe(true)
    expect(refusals()).toEqual([])
    expect((g().edges.find((e) => e.id === 'e_drum_drop')!.data as { flow: string }).flow).toBe('45.44')
    const r = run()
    expect(r.moved('e_drum_drop', 14)).toBe(44.64)
    expect(r.roasted).toBe(44.64)
  })

  it('tables taken, lines kept: the kept lines read the proposal’s schedules', async () => {
    // the reverse of T3
    const p = await proposal(slowerDrying)
    const sel: HunkSelection = { ...defaults(p), fieldChoices: {} }
    expect(sel.timetables).toBe('proposed')
    const found = diag(p, sel)
    expect(found.tableSplits.map((s) => [s.tableId, s.direction, s.readers.map((r) => r.id).sort()])).toEqual([
      ['discharge', 'kept', ['e_cooler_discharge', 'e_discharge_roasted']],
      ['drop', 'kept', ['e_drop_cooler', 'e_drum_drop']],
    ])
    const drop = found.tableSplits.find((s) => s.tableId === 'drop')!.amounts!
    // the same two plans, named by whose they are, not by which one the result holds
    expect([show(drop.theirs), show(drop.yours), drop.firstStep]).toEqual(['45.44', '44.64', 14])
  })

  it('tables taken under lines the proposal did not touch is the proposal itself: nothing to tell', async () => {
    // #557's case: every line that reads the three release tables is the same on both sides
    const p = await proposal(moveBoundary)
    expect(diag(p, defaults(p)).tableSplits).toEqual([])
    expect(diag(p, { ...defaults(p), phases: 'yours' }).tableSplits).toEqual([])
  })

  it('both taken, or both kept: no split', async () => {
    const p = await proposal(slowerDrying)
    expect(diag(p, defaults(p)).tableSplits).toEqual([])
    expect(applyPendingProposal(p, { selection: defaults(p) }).ok).toBe(true)
    expect(run()).toMatchObject({ lastStep: 19, roasted: 45.44 })
  })

  it('a table that differs only in its label or its source is the same table to the run', async () => {
    const p = await proposal((f) => {
      f.timetables.find((x) => x.id === 'drop').label = 'Drop plan'
      f.edges.find((e) => e.id === 'e_drum_drop').data.accent = '#000000'
      f.edges.find((e) => e.id === 'e_drop_cooler').data.flow = '44.64'
    })
    expect(diag(p, { ...defaults(p), timetables: 'yours' }).tableSplits).toEqual([])
  })

  it('a line whose colour alone was taken does not read the table for the run', async () => {
    const p = await proposal((f) => {
      const s = f.timetables.find((x) => x.id === 'drop')
      s.points = s.points.map((x: [string, string]) => (x[1] === '44.64' ? [x[0], '40'] : x))
      f.edges.find((e) => e.id === 'e_drum_drop').data.accent = '#000000'
    })
    expect(threeWayForPending(p).hunks.map((h) => h.id)).toEqual(['e_drum_drop'])
    expect(diag(p, { ...defaults(p), timetables: 'yours' }).tableSplits).toEqual([])
  })
})

describe('the lines after the drum, for the record of the cases', () => {
  it('are the four the proposal changes', async () => {
    const p = await proposal(slowerDrying)
    expect(threeWayForPending(p).hunks.map((h) => h.id).sort()).toEqual(LINES_AFTER_DRUM)
  })
})
