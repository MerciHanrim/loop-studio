import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import type { SimState } from '../src/engine/types'
import { kindFindings, refusingKindFindings } from '../src/model/kinds'
import { add, cmp, displayRational, div, fromInt, mul, parseDecimal, sub, toDouble, type Rational } from '../src/model/rational'
import { runFindings } from '../src/model/runRule'
import { runWarnings } from '../src/model/runWarnings'
import { deserialize } from '../src/model/serialize'
import { exactPlan, timetableRateFactor, type Timetable } from '../src/model/timetable'
import type { LoopEdge } from '../src/model/types'

// `examples/coffee-roasting-batch.json`: one batch of coffee from the hopper through the drum
// and the cooling tray to roasted beans, one minute per step. Coffee mass is one conserved
// kind, and six timetables set the time:
//
//   step 1        charge      54 kg of green beans go into the drum
//   steps 2-13    roasting    12 minutes: drying 2-5, browning 6-9, development 10-13;
//                             water vapour, volatiles and chaff leave the drum each minute
//   step 14       drop        the beans go into the cooling tray
//   steps 15-18   cooling     4 minutes: the beans stay in the tray and nothing moves
//   step 19       discharge   the beans leave the tray as roasted beans
//   step 20       not run     the discharge table has ended, so the run ends
//
// Charge, drop and discharge each take a step because the engine moves an amount once per
// step. They are a modelling step, not roasting or cooling time.
//
// EVERY NUMBER IS AN EXAMPLE ASSUMPTION: the 54 kg batch, the fractions behind the totals
// and the release rates per phase. None is a measurement, a typical plant value or a
// validated prediction. The cooling steps show time passing only: no temperature is
// computed. Gas and heat (burner, afterburner, stack, cooling air) are not in the model.
//
// The check has two parts, kept apart:
//   - the FORMULA, in exact rationals from the tables alone: the kinds add up to 54 kg at
//     every step, and the totals are the mass balance of the assumptions;
//   - the ENGINE, in doubles: every value of every step lies within TOLERANCE of the exact
//     path. It is a tolerance on this document's 19 steps, not a bound on the engine.
//
// Regenerate after a deliberate change:  GEN_COFFEE_ROASTING=1 npm test -- coffee-roasting-batch

const DIR = resolve(import.meta.dirname, '..', 'examples')
const GEN = !!process.env.GEN_COFFEE_ROASTING
/** the last step the tables cover */
const LAST = 19
/** how far an engine value may lie from the exact one, in kg */
const TOLERANCE = 1e-9
const POOLS = ['bean_hopper', 'roast_drum', 'cooling_tray', 'roasted_beans', 'released_chaff']
/** the two Drains keep no state, so what they took is added up from the step events */
const DRAINS = { water_vapour: 'e_drum_steam', volatiles_out: 'e_drum_voc' } as const
const PLACES = [...POOLS, ...Object.keys(DRAINS)]
const PHASES = [
  { name: 'drying', from: 2, to: 5 },
  { name: 'browning', from: 6, to: 9 },
  { name: 'development', from: 10, to: 13 },
] as const
/** the example assumptions behind the totals: moisture on a dry basis, then the shares of
 *  the dry mass lost as volatiles and as chaff */
const ASSUMED = { batch: '54', moistureDryBasis: '0.125', volatilesOfDry: '0.06', chaffOfDry: '0.01' }

const ZERO = fromInt(0)
const ONE = fromInt(1)
const dec = (s: string): Rational => parseDecimal(s)!
const show = (r: Rational) => displayRational(r).text
const sum = (rs: Rational[]) => rs.reduce(add, ZERO)
const min = (a: Rational, b: Rational) => (cmp(a, b) <= 0 ? a : b)

const readDoc = () => deserialize(readFileSync(resolve(DIR, 'coffee-roasting-batch.json'), 'utf8'))

function model() {
  const doc = readDoc()
  const { nodes, edges, kinds, time, timetables, modelVersion } = doc
  const coffee = kinds.find((k) => k.name === 'coffee mass')!
  const table = (id: string) => timetables.find((t) => t.id === id)!
  const plan = (id: string, k: number): Rational => exactPlan(table(id), k, timetableRateFactor(table(id), coffee, time)!, time!)
  const line = (id: string) => edges.find((e) => e.id === id)! as LoopEdge
  /** a constant line's exact amount per step: every one is in kg per min on a 1 min step */
  const rate = (id: string): Rational => dec(String((line(id).data as { flow: string }).flow))
  return { doc, nodes, edges: edges as LoopEdge[], kinds, time, timetables, modelVersion, coffee, plan, line, rate }
}

/** a ruled stage's fraction at step k (SEMANTICS-M6.md §M6-4): the table's amount over the
 *  rated line's, at most 1 */
const fraction = (m: ReturnType<typeof model>, tableId: string, rated: string, k: number) => min(ONE, div(m.plan(tableId, k), m.rate(rated)))

/** the exact path, from the tables' rationals alone. Every taker reads what its Pool held
 *  when the step began, and a premise that fails throws: the path is then not this one. */
function exactPath(m: ReturnType<typeof model>) {
  const s: Record<string, Rational> = Object.fromEntries(PLACES.map((p) => [p, ZERO]))
  s.bean_hopper = dec(ASSUMED.batch)
  const rows = [{ ...s }]
  const moved: Record<string, Rational>[] = [{}]
  for (let k = 1; k <= LAST; k++) {
    const charge = mul(fraction(m, 'charge', 'e_hopper_charge', k), m.rate('e_hopper_charge'))
    const chaff = mul(fraction(m, 'chaff', 'e_drum_chaff', k), m.rate('e_drum_chaff'))
    const drop = mul(fraction(m, 'drop', 'e_drum_drop', k), m.rate('e_drum_drop'))
    const discharge = mul(fraction(m, 'discharge', 'e_cooler_discharge', k), m.rate('e_cooler_discharge'))
    const moisture = m.plan('moisture', k)
    const volatiles = m.plan('volatiles', k)
    const start = { ...s }
    const asked = { bean_hopper: charge, roast_drum: sum([moisture, volatiles, chaff, drop]), cooling_tray: discharge }
    for (const [pool, want] of Object.entries(asked)) {
      if (cmp(start[pool]!, want) < 0) throw new Error(`step ${k}: ${pool} holds ${show(start[pool]!)} and is asked for ${show(want)}`)
    }
    s.bean_hopper = sub(start.bean_hopper!, charge)
    s.roast_drum = sub(add(start.roast_drum!, charge), asked.roast_drum)
    s.water_vapour = add(start.water_vapour!, moisture)
    s.volatiles_out = add(start.volatiles_out!, volatiles)
    s.released_chaff = add(start.released_chaff!, chaff)
    s.cooling_tray = sub(add(start.cooling_tray!, drop), discharge)
    s.roasted_beans = add(start.roasted_beans!, discharge)
    rows.push({ ...s })
    moved.push({ charge, moisture, volatiles, chaff, drop, discharge })
  }
  return { rows, moved }
}

type EngineRow = {
  step: number
  consumed: boolean
  ended: boolean
  values: Record<string, number>
  events: Record<string, number>
  runs: { stage: string; target: number; moved: number; state: string }[]
  diagnostics: string[]
  notices: unknown[]
}

/** steps 1 to 20 through the real engine, the Drains added up from the events */
function engineRun(m: ReturnType<typeof model>, edges: LoopEdge[] = m.edges): EngineRow[] {
  const opts = { kinds: m.kinds, time: m.time, timetables: m.timetables }
  let st: SimState = initSim(m.nodes, opts)
  const taken: Record<string, number> = { water_vapour: 0, volatiles_out: 0 }
  const rows: EngineRow[] = []
  for (let k = 1; k <= LAST + 1; k++) {
    const r = step(m.nodes, edges, st, 1, m.modelVersion, opts)
    const events: Record<string, number> = {}
    for (const e of r.report.events) events[e.edgeId] = (events[e.edgeId] ?? 0) + e.amount
    for (const [drain, edge] of Object.entries(DRAINS)) taken[drain]! += events[edge] ?? 0
    rows.push({
      step: k,
      consumed: r.state.step === k,
      ended: r.state.ended,
      values: { ...Object.fromEntries(POOLS.map((p) => [p, r.state.values[p] ?? 0])), ...taken },
      events,
      runs: (r.report.runs ?? []).map((g) => ({ stage: g.members[0]!, target: g.target, moved: g.moved, state: g.state })),
      diagnostics: r.report.diagnostics,
      notices: r.report.notices,
    })
    st = r.state
  }
  return rows
}

function derive() {
  const m = model()
  const { rows } = exactPath(m)
  const run = engineRun(m)
  const largest = Math.max(...run.slice(0, LAST).flatMap((r) => PLACES.map((p) => Math.abs(r.values[p]! - toDouble(rows[r.step]![p]!)))))
  const phaseSum = (id: string, from: number, to: number) => show(sum(Array.from({ length: to - from + 1 }, (_, i) => m.plan(id, from + i))))
  return {
    $about:
      'examples/coffee-roasting-batch.json run through the real engine for 19 steps of one minute: charge at step 1, 12 minutes of roasting in steps 2-13, drop at step 14, 4 minutes of cooling in steps 15-18, discharge at step 19. Re-derived and pinned by test/coffee-roasting-batch.test.ts. Every number is an example assumption, not a measurement, a typical plant value or a validated prediction. The cooling steps show time passing only: no temperature is computed. Gas and heat are not in the model.',
    modelVersion: m.modelVersion,
    time: m.time,
    assumptions: ASSUMED,
    findings: {
      kinds: kindFindings(m.nodes, m.edges, m.kinds, m.modelVersion, m.time).length,
      rules: runFindings(m.nodes, m.edges, m.timetables, m.kinds, m.time, m.modelVersion).length,
      warnings: m.nodes.flatMap((n) => runWarnings(m.nodes, m.edges, m.timetables, m.kinds, m.time, n.id)).length,
    },
    phases: PHASES.map((p) => ({ ...p, waterVapour: phaseSum('moisture', p.from, p.to), volatiles: phaseSum('volatiles', p.from, p.to), chaff: phaseSum('chaff', p.from, p.to) })),
    engine: { tolerance: TOLERANCE, largestDifference: largest },
    checkpoints: rows.map((row, k) => ({
      step: k,
      exact: Object.fromEntries(PLACES.map((p) => [p, show(row[p]!)])),
      ...(k > 0 ? { engine: run[k - 1]!.values } : {}),
    })),
    end: { step: LAST + 1, consumed: run[LAST]!.consumed, ended: run[LAST]!.ended, notices: run[LAST]!.notices },
  }
}

describe('the coffee roasting batch example', () => {
  const m = model()
  const { rows, moved } = exactPath(m)
  const run = engineRun(m)

  it('reads as a loop-model/6 document with nothing refused, and says its numbers are assumptions', () => {
    expect(m.modelVersion).toBe(6)
    expect(m.time).toEqual({ step: { value: 1, unit: 'min' }, display: 'min' })
    expect(m.kinds).toEqual([expect.objectContaining({ name: 'coffee mass', conserved: true, baseUnit: 'kg' })])
    expect(kindFindings(m.nodes, m.edges, m.kinds, m.modelVersion, m.time)).toEqual([])
    expect(runFindings(m.nodes, m.edges, m.timetables, m.kinds, m.time, m.modelVersion)).toEqual([])
    expect(m.nodes.flatMap((n) => runWarnings(m.nodes, m.edges, m.timetables, m.kinds, m.time, n.id))).toEqual([])
    expect(m.timetables.map((t) => t.id)).toEqual(['charge', 'moisture', 'volatiles', 'chaff', 'drop', 'discharge'])
    for (const t of m.timetables as Timetable[]) {
      expect(t.source).toBe('Example assumption, not measured data')
      expect(t.end).toBe(String(LAST))
      // only the last table ends the run, so the message names it
      expect(t.after).toBe(t.id === 'discharge' ? 'stop' : 'zero')
    }
    // every constant line is in kg per min on a 1 min step, so its text is its amount per step
    for (const e of m.edges) expect((e.data as { unit?: string }).unit).toBe('kg per min')
    // no gas or heat equipment is drawn: the model holds the bean mass path only
    expect(m.nodes.map((n) => n.id).sort()).toEqual([...PLACES, 'charge_drum', 'chaff_release', 'discharge_beans', 'drop_beans'].sort())
  })

  it('the formula closes in exact rationals: the kinds add up to 54 kg at every step', () => {
    for (const row of rows) expect(show(sum(PLACES.map((p) => row[p]!)))).toBe('54')
    expect(rows).toHaveLength(LAST + 1)
  })

  it('the totals are the mass balance of the example assumptions', () => {
    const batch = dec(ASSUMED.batch)
    const dry = div(batch, add(ONE, dec(ASSUMED.moistureDryBasis)))
    const water = sub(batch, dry)
    const volatiles = mul(dry, dec(ASSUMED.volatilesOfDry))
    const chaff = mul(dry, dec(ASSUMED.chaffOfDry))
    const roasted = sub(sub(dry, volatiles), chaff)
    expect([dry, water, volatiles, chaff, roasted].map(show)).toEqual(['48', '6', '2.88', '0.48', '44.64'])
    const end = rows[LAST]!
    expect(cmp(end.water_vapour!, water)).toBe(0)
    expect(cmp(end.volatiles_out!, volatiles)).toBe(0)
    expect(cmp(end.released_chaff!, chaff)).toBe(0)
    expect(cmp(end.roasted_beans!, roasted)).toBe(0)
    for (const p of ['bean_hopper', 'roast_drum', 'cooling_tray']) expect(end[p]!.num).toBe(0n)
    // the per-phase tables add up to those totals
    const over = (id: string) => sum(PHASES.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, i) => m.plan(id, p.from + i))))
    expect([over('moisture'), over('volatiles'), over('chaff')].map(show)).toEqual(['6', '2.88', '0.48'])
  })

  it('the steps are the ones the note names: charge, 12 minutes of roasting, drop, 4 minutes of cooling, discharge', () => {
    const z = (r: Rational | undefined) => r === undefined || r.num === 0n
    for (let k = 1; k <= LAST; k++) {
      const mv = moved[k]!
      const roasting = k >= 2 && k <= 13
      expect(z(mv.charge), `charge at step ${k}`).toBe(k !== 1)
      expect(z(mv.drop), `drop at step ${k}`).toBe(k !== 14)
      expect(z(mv.discharge), `discharge at step ${k}`).toBe(k !== 19)
      // mass leaves the drum in every roasting step, and in no other
      expect(z(mv.moisture) && z(mv.volatiles), `release at step ${k}`).toBe(!roasting)
      expect(z(mv.chaff), `chaff at step ${k}`).toBe(!(k >= 2 && k <= 9))
    }
    // where the 44.64 kg is: in the drum when roasting ends, in the tray through the
    // cooling steps, in Roasted beans after the discharge
    expect(show(rows[13]!.roast_drum!)).toBe('44.64')
    for (let k = 14; k <= 18; k++) expect(show(rows[k]!.cooling_tray!)).toBe('44.64')
    expect(show(rows[19]!.roasted_beans!)).toBe('44.64')
  })

  it('the engine follows the exact path inside the tolerance, with no notice in the 19 steps', () => {
    for (let k = 1; k <= LAST; k++) {
      const row = run[k - 1]!
      expect(row.consumed, `step ${k} ran`).toBe(true)
      for (const p of PLACES) expect(Math.abs(row.values[p]! - toDouble(rows[k]![p]!)), `${p} at step ${k}`).toBeLessThan(TOLERANCE)
      expect(Math.abs(PLACES.reduce((a, p) => a + row.values[p]!, 0) - 54), `the sum at step ${k}`).toBeLessThan(TOLERANCE)
      expect(row.diagnostics).toEqual([])
      expect(row.notices).toEqual([])
    }
  })

  it('each run rule moves what its table says on its steps, and nothing on any other', () => {
    const ruled = [
      { stage: 'charge_drum', take: 'e_hopper_charge', make: 'e_charge_drum', key: 'charge' },
      { stage: 'chaff_release', take: 'e_drum_chaff', make: 'e_chaff_released', key: 'chaff' },
      { stage: 'drop_beans', take: 'e_drum_drop', make: 'e_drop_cooler', key: 'drop' },
      { stage: 'discharge_beans', take: 'e_cooler_discharge', make: 'e_discharge_roasted', key: 'discharge' },
    ]
    for (let k = 1; k <= LAST; k++) {
      const row = run[k - 1]!
      for (const r of ruled) {
        const want = toDouble(moved[k]![r.key]!)
        const group = row.runs.find((g) => g.stage === r.stage)!
        if (want === 0) {
          expect(r.take in row.events, `${r.take} at step ${k}`).toBe(false)
          expect(r.make in row.events, `${r.make} at step ${k}`).toBe(false)
          expect(group.state).toBe('off')
        } else {
          expect(Math.abs(row.events[r.take]! - want), `${r.take} at step ${k}`).toBeLessThan(TOLERANCE)
          expect(Math.abs(row.events[r.make]! - want), `${r.make} at step ${k}`).toBeLessThan(TOLERANCE)
          expect(group.state).toBe('met')
        }
      }
    }
    // the chaff rule at half and at full rate: 0.04 kg in drying, 0.08 kg in browning
    expect(run[1]!.events.e_drum_chaff).toBe(0.04)
    expect(run[5]!.events.e_drum_chaff).toBe(0.08)
    // nothing moves while the beans cool
    for (let k = 15; k <= 18; k++) expect(run[k - 1]!.events).toEqual({})
    // the drop and the discharge leave nothing behind
    expect(run[13]!.values.roast_drum).toBe(0)
    expect(run[18]!.values.cooling_tray).toBe(0)
  })

  it('the run ends before step 20, and the message names the discharge table', () => {
    const after = run[LAST]!
    expect(after.consumed).toBe(false)
    expect(after.ended).toBe(true)
    expect(after.events).toEqual({})
    expect(after.notices).toEqual([{ kind: 'timetableEnded', tableId: 'discharge', label: 'Discharge schedule' }])
  })

  it('a chaff release that would put out more chaff than it takes is refused, and nothing moves', () => {
    const edges = structuredClone(m.edges)
    ;(edges.find((e) => e.id === 'e_chaff_released')!.data as { flow: string }).flow = '0.09'
    expect(refusingKindFindings(m.nodes, edges, m.kinds, m.modelVersion, m.time).length).toBeGreaterThan(0)
    const first = engineRun(m, edges)[0]!
    expect(first.consumed).toBe(false)
    expect(first.events).toEqual({})
  })

  it('the phases the document names are the ones its timetables make, in the note’s words', () => {
    // docs/run-phases.md — a phase is the author's name for a span of steps, not a value
    // the engine reads; here the spans are checked against the tables that set the time.
    // Every time a table changes its rate, or ends, is a boundary; with one minute per
    // step, the span after boundary a up to boundary b is the steps a + 1 to b.
    const { timetables, phases, time } = readDoc()
    expect(time?.step).toEqual({ value: 1, unit: 'min' })
    expect(timetables.every((x) => x.timeUnit === 'min')).toBe(true)
    const times = [...new Set(timetables.flatMap((x) => [...x.points.map((p) => Number(p[0])), Number(x.end)]))].sort((a, b) => a - b)
    expect(times.every(Number.isInteger)).toBe(true)
    const spans = times.slice(1).map((b, i) => [times[i]! + 1, b])
    expect(spans).toEqual([[1, 1], [2, 5], [6, 9], [10, 13], [14, 14], [15, 18], [19, 19]])
    expect(phases.map((p) => [p.from, p.to])).toEqual(spans)
    expect(phases.map((p) => p.label)).toEqual(['Charge', 'Drying', 'Browning', 'Development', 'Drop', 'Cooling', 'Discharge'])
    // the three roasting phases are the ones this file's release rates are checked by
    expect(phases.slice(1, 4).map((p) => ({ name: p.label.toLowerCase(), from: p.from, to: p.to }))).toEqual(PHASES.map((p) => ({ ...p })))
    expect(phases.at(-1)!.to).toBe(LAST)
  })

  it('matches the pinned oracle', () => {
    const got = derive()
    if (GEN) writeFileSync(resolve(DIR, 'coffee-roasting-batch.expected.json'), JSON.stringify(got, null, 2) + '\n')
    const want = JSON.parse(readFileSync(resolve(DIR, 'coffee-roasting-batch.expected.json'), 'utf8'))
    expect(JSON.parse(JSON.stringify(got))).toEqual(want)
  })
})
