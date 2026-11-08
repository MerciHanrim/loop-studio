import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { canonicalContent, digestOfCanonical } from '../src/model/revision'
import { deserialize, serialize } from '../src/model/serialize'
import { exactDouble, toDouble } from '../src/model/rational'
import { canonicalTimetable, stepRates, timetableRateAt, timetableRateFactor, type Timetable } from '../src/model/timetable'
import type { LoopEdge, LoopNode } from '../src/model/types'

// #519, SEMANTICS-M7.md — a table that says what a supply can give, not what it must
// move. The case is the one that raised the issue: a planned outage on Grid feed B of
// the desalination Template, 1.225 MW with 0 MW for 12 hours. The electrical panel is
// usually full, so a plan table reports a shortfall at most steps although nothing is
// short. Read as `available`, the same table moves exactly the same amounts and raises
// no shortfall; the outage still stops reverse osmosis.

const DIR = resolve(import.meta.dirname, '..', 'examples')
const STEPS = 720
const LINE = 'e_gridB_panelB'
const OUTAGE: Timetable = {
  id: 'grid_b',
  label: 'Grid feed B',
  source: 'Example assumption: a 12-hour planned outage',
  unit: 'MW',
  timeUnit: 'h',
  read: 'hold',
  end: '720',
  after: 'hold',
  points: [['0', '1.225'], ['300', '0'], ['312', '1.225']],
}

/** the Template with Grid feed B reading the outage table, as `means` says */
function outageDoc(means: 'plan' | 'available' | undefined) {
  const doc = deserialize(readFileSync(resolve(DIR, 'desalination.json'), 'utf8'))
  const edges = doc.edges.map((e) => (e.id === LINE ? ({ ...e, data: { ...e.data, flow: '~grid_b', unit: undefined } } as LoopEdge) : e))
  const table = means === undefined ? OUTAGE : { ...OUTAGE, means }
  return { ...doc, edges, timetables: [...doc.timetables, table] }
}

function run(doc: ReturnType<typeof outageDoc>) {
  const opts = { kinds: doc.kinds, time: doc.time, timetables: doc.timetables }
  let st = initSim(doc.nodes as LoopNode[], opts)
  const unmet: { step: number; edgeId: string }[] = []
  const roStopped: number[] = []
  const values: string[] = []
  const lines: string[] = []
  for (let k = 1; k <= STEPS; k++) {
    const r = step(doc.nodes as LoopNode[], doc.edges as LoopEdge[], st, 1, 7, opts)
    expect(r.report.diagnostics).toEqual([])
    st = r.state
    for (const n of r.report.notices) if (n.kind === 'timetableUnmet') unmet.push({ step: k, edgeId: n.edgeId })
    if (r.report.runs?.find((g) => g.members.includes('ro'))?.moved === 0) roStopped.push(k)
    values.push(JSON.stringify(st.values))
    lines.push(JSON.stringify(r.report.timetableLines ?? []))
  }
  return { unmet, roStopped, values, lines }
}

describe('a table of what a supply can give (#519)', () => {
  const plan = run(outageDoc('plan'))
  const available = run(outageDoc('available'))

  it('read as a plan, the outage reports a shortfall on Grid feed B at most steps, although the panel is only full', () => {
    // measured on main 78a1beb5 before the change: 632 of 720 steps, the first at 19. The
    // issue's 642 came from another outage table and is not this measurement.
    const onGrid = plan.unmet.filter((u) => u.edgeId === LINE)
    expect(onGrid).toHaveLength(632)
    expect(onGrid[0]!.step).toBe(19)
  })

  it('read as available, the same table reports no shortfall on Grid feed B', () => {
    expect(available.unmet.filter((u) => u.edgeId === LINE)).toEqual([])
  })

  it('the outage still stops reverse osmosis, on the same steps', () => {
    expect(available.roStopped.length).toBeGreaterThan(0)
    expect(available.roStopped).toEqual(plan.roStopped)
  })

  it('every amount is bit for bit the same as the plan run: only the accounting differs', () => {
    expect(available.values).toEqual(plan.values)
    expect(available.lines).toEqual(plan.lines)
  })

  it('every other shortfall is still reported: the city demand plan keeps its notices', () => {
    const other = (u: { edgeId: string }[]) => u.filter((x) => x.edgeId !== LINE)
    expect(other(available.unmet)).toEqual(other(plan.unmet))
  })

  it('`plan` written out reads the same as no `means`', () => {
    const a = run(outageDoc(undefined))
    expect(a.unmet).toEqual(plan.unmet)
    expect(a.values).toEqual(plan.values)
  })
})

describe('the strip reads a step on one basis (#530 review)', () => {
  // a linear table from 0 to 2 per hour over the first hour, then 2; nothing clamps
  const RAMP: Timetable = { id: 'ramp', label: 'Ramp', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'linear', end: '1', after: 'hold', means: 'available', points: [['0', '0'], ['1', '2']] }
  const kinds = [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }]
  const time = { step: { value: 1, unit: 'h' as const } }
  const nodes = [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'tank', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'water' } },
  ] as unknown as LoopNode[]
  const edges = [{ id: 'e', source: 'src', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '~ramp' } }] as unknown as LoopEdge[]
  const opts = { kinds: kinds as never, time, timetables: [RAMP] }

  it('a linear table moved in full reads the same available and moved rate at every step, and not the rate at an instant', () => {
    const factor = timetableRateFactor(RAMP, kinds[0] as never, time)!
    let st = initSim(nodes, opts)
    const read: { available: number; moved: number }[] = []
    for (let k = 1; k <= 3; k++) {
      const r = step(nodes, edges, st, 1, 7, opts)
      expect(r.report.diagnostics).toEqual([])
      st = r.state
      read.push(stepRates(RAMP, factor, time, r.report.timetableLines![0]!))
    }
    // step 1 averages the ramp, 1; steps 2 and 3 hold 2
    expect(read).toEqual([{ available: 1, moved: 1 }, { available: 2, moved: 2 }, { available: 2, moved: 2 }])
    // the old reading put the instant's rate beside the step's: near the end of step 1, 1.9
    expect(toDouble(timetableRateAt(RAMP, exactDouble(0.95)))).toBeCloseTo(1.9, 12)
  })
})

/** the revision digest of a written file, as a saved revision would carry it */
function revisionDigestOf(text: string): string {
  const d = deserialize(text)
  return digestOfCanonical(canonicalContent(d, { modelVersion: d.modelVersion }))
}

describe('the meaning survives a file (#519)', () => {
  // the Template's own delivery tables are `available` (#533) and need version 7; a file
  // before version 7 keeps them as plans here, so the outage table is the only meaning
  // these writes test
  const write = (means: 'plan' | 'available' | undefined, version: 5 | 6 | 7) => {
    const d = outageDoc(means)
    const tables = version >= 7 ? d.timetables : d.timetables.map((t) => (t.id === OUTAGE.id ? t : { ...t, means: undefined }))
    return serialize(d.nodes, d.edges, d.recommendedRunConfig, undefined, d.project, version, d.frames, d.dataImports, d.kinds, d.time, tables)
  }

  it('an available table is written on `loop-studio/graph/7` and reads back as available', () => {
    const text = write('available', 7)
    expect(JSON.parse(text).schema).toBe('loop-studio/graph/7')
    const back = deserialize(text)
    expect(back.modelVersion).toBe(7)
    expect(back.timetables.find((t) => t.id === 'grid_b')?.means).toBe('available')
  })

  it('writing an available table below version 7 is refused, never silently dropped', () => {
    expect(() => write('available', 6)).toThrow(/version 7/)
  })

  it('a plan table keeps its bytes: no `means` key is written, at version 6 or 7', () => {
    expect(write('plan', 6)).toBe(write(undefined, 6))
    expect(write('plan', 6)).not.toContain('"means"')
  })

  it('a `means` key on a file before version 7 is not read', () => {
    const text = write(undefined, 6).replace('"after": "hold",', '"after": "hold",\n      "means": "available",')
    expect(text).toContain('"means"')
    expect(deserialize(text).timetables.find((t) => t.id === 'grid_b')?.means).toBeUndefined()
  })

  it('a plan table keeps its canonical form, so its revision digest and Monte Carlo table digest; an available one differs', () => {
    const asPlan = JSON.stringify(canonicalTimetable({ ...OUTAGE, means: 'plan' } as unknown as Timetable))
    expect(asPlan).toBe(JSON.stringify(canonicalTimetable(OUTAGE)))
    expect(asPlan).not.toContain('means')
    expect(JSON.stringify(canonicalTimetable({ ...OUTAGE, means: 'available' }))).not.toBe(asPlan)
    // the revision digest reads the same canonical tables (src/model/revision.ts)
    const plan6 = write('plan', 6)
    const none6 = write(undefined, 6)
    expect(revisionDigestOf(plan6)).toBe(revisionDigestOf(none6))
    expect(revisionDigestOf(write('available', 7))).not.toBe(revisionDigestOf(write('plan', 7)))
  })

  it('an unknown meaning refuses the file, with the table named', () => {
    const text = write('available', 7).replace('"means": "available"', '"means": "maybe"')
    expect(() => deserialize(text)).toThrow()
  })
})
