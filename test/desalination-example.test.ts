import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { kindFindings, refusingKindFindings, resolveKinds } from '../src/model/kinds'
import { add, cmp, displayRational, div, exactDouble, fromInt, mul, rational, sub, toDouble, type Rational } from '../src/model/rational'
import { runFindings, ruleOf } from '../src/model/runRule'
import { runWarnings } from '../src/model/runWarnings'
import { deserialize } from '../src/model/serialize'
import { timetableRef } from '../src/model/timetable'
import { currentAmountText, engineValue, fieldRational, poolKindName, resolveFieldUnit } from '../src/model/units'
import type { LoopEdge, LoopNode } from '../src/model/types'

// `examples/desalination.json` — the bundled seawater desalination process example, a
// fixed-ratio flow model driven by one 24-hour demand table and six run rules, its six
// chemical tanks refilled by a delivery every 14 days (#533). This test re-derives every
// value in `examples/desalination.expected.json` from the graph through the REAL engine,
// over the 90 days (2,160 steps) the example note names, and pins them exactly. The run
// repeats the same day of demand: seasons, changing seawater and maintenance are not in
// the model, so nothing here speaks for them.
//
// The water check has two parts, both in exact rationals:
//   • every step closes: S(t) − S(t−1) − (In − City − Outfall − Cake) stays within β;
//   • the run closes: S(n) − (S(0) + Σ In − Σ Out) stays within n β.
//
// β IS AN EXPERIMENTAL BOUND. It is a hand derivation from the order of operations in
// `step()`, checked on this one document, and it covers the error observed over 2,160
// steps. It is not a proof, and no product text may call it a guarantee. Its premises are
// tested at every step, and a failed premise fails the test: it never widens β.
//
// Regenerate after a deliberate change:  GEN_DESALINATION=1 npm test -- desalination-example

const DIR = resolve(import.meta.dirname, '..', 'examples')
const GEN = !!process.env.GEN_DESALINATION
/** the run the note names: 90 days at a 1 h step */
const STEPS = 2160
/** what a failure is run for, and the tampered balance: 30 days are enough to show it */
const FAIL_STEPS = 720
const CHECKPOINTS = [1, 24, 168, 720, 2160]
const BOUND_AT = [24, 168, 720, 2160]
/** the six chemical tanks, and the delivery Source of each (`<tank>Del`) */
const CHEMICALS = ['naocl', 'coag', 'anti', 'lime', 'naocl2', 'adj']
const PERIOD_STEPS = 14 * 24
/** unit roundoff of IEEE-754 binary64: |fl(x ± y) − (x ± y)| ≤ u·|x ± y| */
const U = rational(1n, 2n ** 53n)
const ONE = fromInt(1)
const ZERO = fromInt(0)
const IN_LINES = ['e_sea_basin']
const OUT_LINES = ['e_dpump_city', 'e_adjust_outfall', 'e_dewater_cake']
const EXITS = ['city', 'outfall', 'cake']
/** the engine's floor: an amount at or under it moves nothing and raises no event */
const FLOOR = 1e-9

const abs = (r: Rational): Rational => (r.num < 0n ? rational(-r.num, r.den) : r)
const le = (a: Rational, b: Rational) => cmp(a, b) <= 0
const show = (r: Rational) => displayRational(r).text
const sci = (r: Rational) => toDouble(r).toExponential(6)
const sum = (rs: Rational[]) => rs.reduce(add, ZERO)

const readDoc = () => deserialize(readFileSync(resolve(DIR, 'desalination.json'), 'utf8'))

/** the document's water model, and β from it, before anything runs */
function model() {
  const doc = readDoc()
  const { nodes, edges, kinds, time, timetables, modelVersion } = doc
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const edgeKind = resolveKinds(nodes, edges).edgeKind
  const resource = edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  const rateOf = (e: LoopEdge) => {
    const d = e.data as { flow: string; unit?: string }
    return engineValue(d.flow, resolveFieldUnit(d.unit, declOf.get(edgeKind.get(e.id) ?? ''), time, 'rate'), time)
  }
  const water = resource.filter((e) => edgeKind.get(e.id) === 'water')
  const rate = new Map(water.map((e) => [e.id, rateOf(e)]))
  const r = (e: LoopEdge) => exactDouble(rate.get(e.id)!)
  const pools = nodes.filter((n) => n.data.kind === 'pool' && poolKindName(n.data) === 'water')
  const converters = nodes.filter((n) => n.data.kind === 'converter').map((n) => n.id)
  const capacity = new Map(pools.map((p) => {
    const d = p.data as { capacity: number; unit?: string }
    return [p.id, engineValue(d.capacity, resolveFieldUnit(d.unit, declOf.get('water'), time, 'stock'), time)]
  }))

  // κ: how far an input's fraction can lie below the group's number F. η: how far a
  // member's own fraction can lie below F. A member recomputes its fraction from what
  // arrived, so both grow along a chain. The steps are in README § 8.
  const gamma = (k: number) => (k === 0 ? ZERO : div(mul(fromInt(k), U), sub(ONE, mul(fromInt(k), U))))
  const inputs = (id: string) => resource.filter((e) => e.target === id)
  const eta = new Map<string, Rational>()
  const kappa = new Map<string, Rational>()
  const solve = (id: string): Rational => {
    const hit = eta.get(id)
    if (hit) return hit
    let k = U
    for (const e of inputs(id)) {
      if (!converters.includes(e.source)) continue
      const via = sub(ONE, mul(sub(ONE, solve(e.source)), sub(ONE, U)))
      if (cmp(via, k) > 0) k = via
    }
    const g = gamma(inputs(id).length - 1)
    const value = sub(ONE, div(mul(mul(sub(ONE, k), sub(ONE, g)), sub(ONE, U)), add(ONE, g)))
    kappa.set(id, k)
    eta.set(id, value)
    return value
  }
  const memberTerm = new Map<string, Rational>()
  for (const id of converters) {
    const sIn = sum(water.filter((e) => e.target === id).map(r))
    const sOut = sum(water.filter((e) => e.source === id).map(r))
    if (sIn.num === 0n && sOut.num === 0n) continue
    const rho = sub(mul(add(ONE, solve(id)), add(ONE, U)), ONE)
    memberTerm.set(id, add(abs(sub(sOut, sIn)), add(mul(rho, sOut), mul(kappa.get(id)!, sIn))))
  }
  const poolTerm = new Map(pools.map((p) => {
    const lines = water.filter((e) => e.source === p.id || e.target === p.id)
    const inflow = sum(lines.filter((e) => e.target === p.id).map(r))
    const H = mul(add(exactDouble(capacity.get(p.id)!), inflow), add(ONE, rational(1n, 2n ** 40n)))
    return [p.id, mul(mul(fromInt(lines.length), U), H)]
  }))
  const beta = add(sum([...memberTerm.values()]), sum([...poolTerm.values()]))
  return { doc, nodes, edges, kinds, time, timetables, modelVersion, declOf, edgeKind, water, rate, pools, converters, capacity, memberTerm, poolTerm, kappa, eta, beta }
}

type Tamper = { step: number; add: number }

/** the run under the two checks. `tamper` adds to one step's balance, and `leaveOut`
 *  drops a line from it, to show the check can fail. */
function balanceRun(tamper?: Tamper, leaveOut?: string, steps = STEPS) {
  const m = model()
  const { nodes, edges, kinds, time, timetables, modelVersion, water, rate, pools, capacity, memberTerm, beta } = m
  const opts = { kinds, time, timetables }
  let st = initSim(nodes, opts)
  const waterIds = new Set(water.map((e) => e.id))
  const stock = () => sum(pools.map((p) => exactDouble(st.values[p.id] ?? 0)))
  const S0 = stock()
  let net = ZERO
  let worstStep = ZERO
  let worstRun = ZERO
  let closed = 0
  let worstMember = 0
  const premises = {
    noGateAndTreeGroups: !nodes.some((n) => n.data.kind === 'gate'),
    noTableOnWaterAndNoStateLine: water.every((e) => timetableRef(String((e.data as { flow?: unknown }).flow)) === null) && edges.every((e) => (e.data?.kind ?? 'resource') === 'resource'),
    waterEntersAndLeavesByNamedLines: water.every((e) => (nodes.find((n) => n.id === e.source)!.data.kind === 'source' ? IN_LINES.includes(e.id) : true) && (nodes.find((n) => n.id === e.target)!.data.kind === 'drain' ? OUT_LINES.includes(e.id) : true)),
    amountsAboveTheFloor: true,
    membersMoveWhole: true,
    oneEventPerLine: true,
    noAmountAboveItsRate: true,
    stocksStrictlyInside: true,
    noDiagnostic: true,
  }
  const at = new Map<number, { r: Rational; max: Rational }>()
  for (let t = 1; t <= steps; t++) {
    const before = stock()
    const res = step(nodes, edges as LoopEdge[], st, 1, modelVersion, opts)
    if (res.report.diagnostics.length > 0) premises.noDiagnostic = false
    st = res.state
    const amountOf = (id: string) => sum(res.report.events.filter((e) => e.edgeId === id).map((e) => exactDouble(e.amount)))
    const inflow = sum(IN_LINES.map(amountOf))
    const outflow = sum(OUT_LINES.filter((id) => id !== leaveOut).map(amountOf))
    const shift = t === tamper?.step ? exactDouble(tamper.add) : ZERO
    const stepNet = add(sub(inflow, outflow), shift)
    const e = abs(sub(sub(stock(), before), stepNet))
    net = add(net, stepNet)
    const r = sub(stock(), add(S0, net))
    if (cmp(e, worstStep) > 0) worstStep = e
    if (cmp(abs(r), worstRun) > 0) worstRun = abs(r)
    if (le(e, beta)) closed++
    if (BOUND_AT.includes(t)) at.set(t, { r, max: worstRun })
    for (const p of pools) {
      const v = st.values[p.id] ?? 0
      if (v <= FLOOR || v >= capacity.get(p.id)!) premises.stocksStrictlyInside = false
    }
    const seen = new Set<string>()
    for (const ev of res.report.events) {
      if (!waterIds.has(ev.edgeId)) continue
      if (seen.has(ev.edgeId)) premises.oneEventPerLine = false
      seen.add(ev.edgeId)
      if (ev.amount > rate.get(ev.edgeId)! * (1 + 2 ** -52)) premises.noAmountAboveItsRate = false
      if (ev.amount <= FLOOR) premises.amountsAboveTheFloor = false
    }
    for (const [id, term] of memberTerm) {
      const ins = water.filter((x) => x.target === id)
      const outs = water.filter((x) => x.source === id)
      const moved = [...ins, ...outs].map((x) => seen.has(x.id))
      if (moved.some(Boolean) && !moved.every(Boolean)) premises.membersMoveWhole = false
      worstMember = Math.max(worstMember, toDouble(abs(sub(sum(outs.map((x) => amountOf(x.id))), sum(ins.map((x) => amountOf(x.id)))))) / toDouble(term))
    }
  }
  return { closed, worstStep, worstRun, worstMember, premises, at, beta, m }
}

function derive() {
  const run = balanceRun()
  const { nodes, edges, kinds, time, timetables, modelVersion, declOf, edgeKind, pools, kappa, eta, memberTerm, poolTerm, beta } = run.m

  // ── the fields: authored → exact per step → engine double → rounding ──
  const fields: Record<string, unknown>[] = []
  const exactOf = new Map<string, Rational>()
  const startOf = new Map<string, Rational>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const d = n.data as { initial: number; capacity: number | null; unit?: string }
    const fu = resolveFieldUnit(d.unit, declOf.get(poolKindName(d) ?? ''), time, 'stock')
    for (const [f, v] of [['initial', d.initial], ['capacity', d.capacity]] as const) {
      if (v == null) continue
      const exact = fieldRational(v, fu, time)!
      const eng = engineValue(v, fu, time)
      if (f === 'initial') startOf.set(n.id, exact)
      fields.push({ field: `${n.id}.${f}`, authored: d.unit ? `${v} ${d.unit}` : String(v), exactPerStep: show(exact), engine: eng, roundingError: show(sub(exactDouble(eng), exact)) })
    }
  }
  for (const e of edges) {
    const d = e.data as { flow: string; unit?: string }
    const k = edgeKind.get(e.id) ?? null
    // a delivery line reads its table: no constant to derive
    const table = timetableRef(d.flow)
    if (table !== null) {
      fields.push({ field: e.id, kind: k, authored: `${d.flow} ${d.unit}`, table })
      continue
    }
    const fu = resolveFieldUnit(d.unit, k ? declOf.get(k) : undefined, time, 'rate')
    const exact = fieldRational(d.flow, fu, time)!
    const eng = engineValue(d.flow, fu, time)
    exactOf.set(e.id, exact)
    fields.push({ field: e.id, kind: k, authored: d.unit ? `${d.flow} ${d.unit}` : d.flow, exactPerStep: show(exact), engine: eng, roundingError: show(sub(exactDouble(eng), exact)) })
  }

  // ── the run ──
  const opts = { kinds, time, timetables }
  let st = initSim(nodes, opts)
  let diagnostics = 0
  const notices: Record<string, number> = {}
  const fired = new Map<string, number>()
  const seaIdle: number[] = []
  const byLine = new Map<string, number>()
  const checkpoints: Record<string, unknown>[] = []
  const stocks = new Map(pools.map((p) => [p.id, [Infinity, -Infinity]]))
  const runs = new Map<string, number[]>()
  const fuProduct = resolveFieldUnit('L', declOf.get('water'), time, 'stock')
  for (let t = 1; t <= STEPS; t++) {
    const r = step(nodes, edges as LoopEdge[], st, 1, modelVersion, opts)
    st = r.state
    diagnostics += r.report.diagnostics.length
    for (const n of r.report.notices ?? []) notices[n.kind] = (notices[n.kind] ?? 0) + 1
    for (const f of r.report.fired) fired.set(f, (fired.get(f) ?? 0) + 1)
    if (![...r.report.fired].includes('sea')) seaIdle.push(t)
    for (const e of r.report.events) byLine.set(e.edgeId, (byLine.get(e.edgeId) ?? 0) + e.amount)
    for (const g of r.report.runs ?? []) {
      const was = runs.get(g.members[0]!) ?? [Infinity, -Infinity]
      runs.set(g.members[0]!, [Math.min(was[0]!, g.moved), Math.max(was[1]!, g.moved)])
    }
    for (const p of pools) {
      const v = st.values[p.id] ?? 0
      const w = stocks.get(p.id)!
      stocks.set(p.id, [Math.min(w[0]!, v), Math.max(w[1]!, v)])
    }
    if (CHECKPOINTS.includes(t)) {
      checkpoints.push({ step: t, values: { ...st.values }, productWaterShown: currentAmountText(st.values.product, 1500000, 'L', fuProduct, time) })
    }
  }
  const amount = (id: string) => byLine.get(id) ?? 0
  const round4 = (x: number) => Math.round(x * 1e4) / 1e4

  // ── energy: computed from the run, under the file's example assumptions ──
  const gridLines = edges.filter((e) => /^grid[ABC]$/.test(e.source)).map((e) => e.id)
  const grid = gridLines.reduce((s, id) => s + amount(id), 0)
  const panels = ['panelA', 'panelB', 'panelC', 'recovered']
  const stored = panels.reduce((s, id) => s + (st.values[id] ?? 0) - toDouble(startOf.get(id)!), 0)
  const delivered = amount('e_dpump_city')
  const energy = { gridKwh: round4(grid), usedKwh: round4(grid - stored), deliveredM3: round4(delivered), gridKwhPerM3: round4(grid / delivered), usedKwhPerM3: round4((grid - stored) / delivered) }

  // ── the chemicals: each tank's start, plus what its delivery brought, less what its
  //    line moved, against what is left ──
  const chemicals = edges
    .filter((e) => !['water', 'power'].includes(edgeKind.get(e.id) ?? '') && CHEMICALS.includes(e.source))
    .map((e) => {
      const left = st.values[e.source] ?? 0
      const delivered = edges.filter((x) => x.target === e.source).reduce((s, x) => s + amount(x.id), 0)
      return { tank: e.source, kind: edgeKind.get(e.id), kgPerDay: show(mul(exactOf.get(e.id)!, fromInt(24))), moved: round4(amount(e.id)), delivered: round4(delivered), engineLeft: left, difference: Math.abs(toDouble(startOf.get(e.source)!) + delivered - amount(e.id) - left) }
    })
  // what the city's curve asks over the run, from the table itself (`hold`, CMD, 24 h)
  const demand = timetables.find((t) => t.id === 'demand')!
  const hourly = demand.points.map(([, v]) => Number(v) / 24)
  const demandM3 = round4(Array.from({ length: STEPS }, (_, k) => hourly[k % 24]!).reduce((s, x) => s + x, 0))

  // ── the shipped kinds contract on the shapes it refuses ──
  const variant = (id: string, patch: Record<string, string | undefined>) => edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) as LoopEdge[]
  const refused = (es: LoopEdge[]) => {
    const f = refusingKindFindings(nodes, es, kinds, modelVersion, time)
    const r = step(nodes, es, initSim(nodes, opts), 1, modelVersion, opts)
    return { findings: f.map((x) => x.cls), moved: r.report.events.length, diagnostic: r.report.diagnostics[0] ?? null }
  }

  return {
    $about:
      'examples/desalination.json run through the real engine for 2160 steps (90 days at a 1 h step), the same 24-hour demand every day, the chemical tanks refilled every 14 days. Re-derived and pinned by test/desalination-example.test.ts. A fixed-ratio flow model: its plant size, demand curve, stage power, doses, deliveries and pump size are example assumptions, not measured or design data.',
    $bound: {
      status: 'EXPERIMENTAL: a hand derivation from the order of operations in step(), checked on this document. It covers the error observed over 2160 steps. It is not a proof.',
      formula: 'β = Σ_m (δ_m + ρ_m Σ r_out + κ_m Σ r_in) + Σ_p k_p u H_p; every step |e(t)| ≤ β, the run |r(n)| ≤ n β',
      open: 'Not settled: the weighted mean over inputs of different kinds, whether a fraction can pass F by another path, and the count of additions with two router inputs.',
    },
    modelVersion,
    time,
    authoredBalance: { finding: kindFindings(nodes, edges, kinds, modelVersion, time).length === 0 ? 'none' : 'broken', recoveryPercent: show(mul(div(exactOf.get('e_ro_permeate')!, exactOf.get('e_hp_ro')!), fromInt(100))) },
    fields,
    run: { steps: STEPS, seed: 1, diagnostics, notices, findings: runFindings(nodes, edges, timetables, kinds, time, modelVersion).length, warnings: nodes.flatMap((n) => runWarnings(nodes, edges, timetables, kinds, time, n.id)).length, rules: nodes.filter((n) => ruleOf(n) !== null).length, seaIdle, fired: Object.fromEntries([...fired].sort(([a], [b]) => (a < b ? -1 : 1))) },
    ranges: {
      stocks: Object.fromEntries([...stocks].map(([id, [lo, hi]]) => [id, [round4(lo!), round4(hi!)]])),
      runs: Object.fromEntries([...runs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, [lo, hi]]) => [id, [round4(lo!), round4(hi!)]])),
    },
    checkpoints,
    experimentalBound: {
      beta: sci(beta),
      stepsClosed: run.closed,
      largestStepError: sci(run.worstStep),
      largestShareOfBeta: Number((toDouble(run.worstStep) / toDouble(beta)).toPrecision(3)),
      largestMemberShare: Number(run.worstMember.toPrecision(3)),
      premises: run.premises,
      atSteps: BOUND_AT.map((n) => {
        const a = run.at.get(n)!
        const b = mul(fromInt(n), beta)
        return { steps: n, residual: sci(a.r), maxResidualSoFar: sci(a.max), bound: sci(b), withinBound: le(a.max, b), shareOfBound: Number((toDouble(a.max) / toDouble(b)).toPrecision(3)) }
      }),
      chain: Object.fromEntries([...eta].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, v]) => [id, { kappaInU: Math.round(toDouble(div(kappa.get(id)!, U))), etaInU: Math.round(toDouble(div(v, U))) }])),
      terms: { members: Object.fromEntries([...memberTerm].map(([k, v]) => [k, sci(v)])), pools: Object.fromEntries([...poolTerm].map(([k, v]) => [k, sci(v)])) },
    },
    energy,
    demandM3,
    chemicals,
    contract: { wrongRatio: refused(variant('e_ro_permeate', { flow: '9500' })), allOnFeed: refused(variant('e_hp_ro', { flow: 'all', unit: undefined })) },
  }
}

// ── what a failure does, written before it was measured ──
// Each changes one thing in the document and runs FAIL_STEPS (720) steps through the
// real engine. Nothing may be lost silently: at every step the water Pools equal the
// start plus intake minus what left, to rounding, and no stock passes its limits.
function failure(change: (nodes: LoopNode[], edges: LoopEdge[], tables: { points: [string, string][] }[]) => void) {
  const doc = readDoc()
  const nodes = structuredClone(doc.nodes)
  const edges = structuredClone(doc.edges) as LoopEdge[]
  const timetables = structuredClone(doc.timetables)
  change(nodes, edges, timetables)
  const opts = { kinds: doc.kinds, time: doc.time, timetables }
  const water = nodes.filter((n) => n.data.kind === 'pool' && poolKindName(n.data) === 'water').map((n) => n.id)
  const total = (v: Record<string, number>) => water.reduce((s, id) => s + (v[id] ?? 0), 0)
  let st = initSim(nodes, opts)
  const start = total(st.values)
  let intake = 0
  let left = 0
  let worst = 0
  let lastDelivery = 0
  let negative = false
  const fired = new Map<string, number>()
  for (let t = 1; t <= FAIL_STEPS; t++) {
    const r = step(nodes, edges, st, 1, doc.modelVersion, opts)
    st = r.state
    for (const f of r.report.fired) fired.set(f, (fired.get(f) ?? 0) + 1)
    for (const e of r.report.events) {
      if (e.from === 'sea') intake += e.amount
      if (EXITS.includes(e.to)) left += e.amount
      if (e.to === 'city' && e.amount > 0) lastDelivery = t
    }
    worst = Math.max(worst, Math.abs(total(st.values) - (start + intake - left)))
    for (const v of Object.values(st.values)) if (v < -1e-9) negative = true
  }
  return { worst, negative, values: st.values, fired, lastDelivery, left, intake }
}
const nodeOf = (nodes: LoopNode[], id: string) => nodes.find((n) => n.id === id)!
const edgeOf = (edges: LoopEdge[], id: string) => edges.find((e) => e.id === id)!

describe('examples/desalination.json — the bundled desalination process example (#471)', () => {
  const got = derive()
  if (GEN) writeFileSync(resolve(DIR, 'desalination.expected.json'), JSON.stringify(got, null, 2) + '\n')
  const want = JSON.parse(readFileSync(resolve(DIR, 'desalination.expected.json'), 'utf8')) as ReturnType<typeof derive>

  it('reproduces desalination.expected.json exactly: fields, the 2160-step run, the checkpoints, the bound', () => {
    expect(JSON.parse(JSON.stringify(got))).toEqual(want)
  })

  it('every authored recipe balances exactly, the run raises no diagnostic, notice, finding or warning, and every stage runs every step of the 90 days', () => {
    expect(got.authoredBalance).toEqual({ finding: 'none', recoveryPercent: '45' })
    expect(got.run).toMatchObject({ diagnostics: 0, notices: {}, findings: 0, warnings: 0, rules: 6 })
    // 21 nodes of the plant, and the six deliveries
    expect(Object.keys(got.run.fired)).toHaveLength(27)
    // the basin starts full, so the sea has nowhere to go on the first step, and only then
    expect(got.run.seaIdle).toEqual([1])
    for (const [id, n] of Object.entries(got.run.fired)) {
      // a delivery moves only on a 14th day, and only while its tank has room
      if (id.endsWith('Del')) expect(n, id).toBeGreaterThan(0)
      else expect(n, id).toBe(id === 'sea' ? STEPS - 1 : STEPS)
    }
  })

  it('demand is met in full over the 90 days, and no group stops', () => {
    // 223,500 m³ a month: what the curve asks, three times
    expect(got.demandM3).toBe(670500)
    expect(got.energy.deliveredM3).toBeCloseTo(got.demandM3, 6)
    for (const [id, [lo]] of Object.entries(got.ranges.runs)) expect(lo, id).toBeGreaterThan(0)
  })

  it('every tank moves, so the day shows, and stays well inside its limits', () => {
    const [low, high] = got.ranges.stocks.product!
    expect(high! - low!).toBeGreaterThan(1000)
    expect(low).toBeGreaterThan(0)
    expect(high).toBeLessThan(6000)
  })

  it('EXPERIMENTAL BOUND: every step closes within β and the run within n β, with every premise holding at every step', () => {
    const b = got.experimentalBound
    expect(b.stepsClosed).toBe(STEPS)
    expect(Object.values(b.premises).every(Boolean), JSON.stringify(b.premises)).toBe(true)
    expect(b.largestMemberShare).toBeLessThanOrEqual(1)
    for (const a of b.atSteps) expect(a.withinBound, `${a.steps} steps: ${a.maxResidualSoFar} vs ${a.bound}`).toBe(true)
  })

  it('the check can fail: a changed amount or a line left out does not close', () => {
    expect(balanceRun({ step: 300, add: 1e-6 }, undefined, FAIL_STEPS).closed).toBe(FAIL_STEPS - 1)
    expect(balanceRun({ step: 300, add: 1e-10 }, undefined, FAIL_STEPS).closed).toBe(FAIL_STEPS - 1)
    expect(balanceRun(undefined, 'e_dewater_cake', FAIL_STEPS).closed).toBe(0)
  }, 60_000)

  it('error builds along a chain: the last member of the RO group needs more than the first', () => {
    const { chain } = got.experimentalBound
    expect(chain.cartridge!.etaInU).toBeLessThan(chain.turbine!.etaInU)
  })

  it('the energy is a computed result of the example assumptions, inside the reported range', () => {
    expect(got.energy.gridKwhPerM3).toBeGreaterThan(3.5)
    expect(got.energy.gridKwhPerM3).toBeLessThan(4.5)
    expect(got.energy.usedKwhPerM3).toBeLessThan(got.energy.gridKwhPerM3)
    // the figure `help.examples.desalination.p6` gives: "about 4.03 kWh per m³ delivered"
    expect(got.energy.gridKwhPerM3.toFixed(2)).toBe('4.03')
  })

  it('each chemical tank closes: its start, plus what its deliveries brought, less what its line moved, is what is left', () => {
    expect(got.chemicals.map((c) => c.tank)).toEqual(CHEMICALS)
    for (const c of got.chemicals) {
      expect(c.difference, c.tank).toBeLessThan(1e-6)
      expect(c.delivered, c.tank).toBeGreaterThan(0)
      expect(c.engineLeft, c.tank).toBeGreaterThan(0)
    }
  })

  it('the Properties panel shows the product water in its authored unit', () => {
    for (const c of got.checkpoints) expect(c.productWaterShown).toMatch(/^(≈ )?[\d.]+ L$/)
  })

  it('a wrong recovery ratio and `all` on a water line are refused before the run', () => {
    expect(got.contract.wrongRatio).toMatchObject({ findings: ['broken'], moved: 0 })
    // the line joins two Converters, so each of them reports it
    expect(got.contract.allOnFeed).toMatchObject({ findings: ['notComputable', 'notComputable'], moved: 0 })
  })

  describe('failures lose nothing silently', () => {
    it('an empty chemical tank with no delivery stops its stage, and the plant downstream runs out and stops', () => {
      const r = failure((nodes, edges) => {
        (nodeOf(nodes, 'naocl').data as { initial: number }).initial = 0
        edges.splice(edges.findIndex((e) => e.id === 'e_naoclDel_naocl'), 1)
      })
      expect(r.fired.get('screen') ?? 0).toBe(0)
      expect(r.lastDelivery).toBeGreaterThan(0)
      expect(r.lastDelivery).toBeLessThan(FAIL_STEPS)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.basin).toBeLessThanOrEqual(12000)
    })

    it('a cut grid feed stops the pumps it feeds once its panel is empty, and water backs up without being lost', () => {
      const r = failure((_, edges) => { (edgeOf(edges, 'e_gridB_panelB').data as { flow: string }).flow = '0' })
      expect(r.fired.get('hp') ?? 0).toBeLessThan(10)
      expect(r.lastDelivery).toBeLessThan(FAIL_STEPS)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.filtered).toBeLessThanOrEqual(12000)
    })

    it('with no demand the rules stop the plant at its levels, and nothing is lost', () => {
      const r = failure((_n, _e, tables) => { for (const p of tables[0]!.points) p[1] = '0' })
      expect(r.lastDelivery).toBe(0)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.product).toBeLessThanOrEqual(4400 + 1e-6)
    })

    it('a full tank holds what it can, stays within its capacity, and the water upstream waits', () => {
      // no demand, and Polish on a full run with no rule, so it fills the product tank
      const r = failure((nodes, _e, tables) => {
        for (const p of tables[0]!.points) p[1] = '0'
        delete (nodeOf(nodes, 'remin').data as { run?: unknown }).run
      })
      expect(r.fired.get('screen') ?? 0, 'the run was not refused').toBeGreaterThan(0)
      expect(r.lastDelivery).toBe(0)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.product).toBeLessThanOrEqual(6000)
      expect(r.values.permeate).toBeLessThanOrEqual(6000)
      expect(r.fired.get('disinfect')).toBeLessThan(FAIL_STEPS)
    })
  })
})

// #533 — `help.examples.desalination.p9`, pinned against the engine: the Template is checked
// over 90 days of the same 24-hour demand, and each chemical tank, capped at its start, is
// refilled by a delivery on every 14th day that brings 14 days of the tank's dose; only
// what fits goes in (an `available` table, graph/7).
describe('the deliveries the example note describes (#533)', () => {
  const doc = readDoc()
  const opts = { kinds: doc.kinds, time: doc.time, timetables: doc.timetables }
  const edges = doc.edges as LoopEdge[]
  const lineInto = (tank: string) => edges.filter((e) => e.target === tank)
  const dataOf = (id: string) => doc.nodes.find((n) => n.id === id)!.data as { kind: string; initial: number; capacity: number | null }
  /** the tank's dose: its draw line's kg per day */
  const doseOf = (tank: string) => Number((edges.find((e) => e.source === tank)!.data as { flow: string }).flow)
  let st = initSim(doc.nodes, opts)
  const low = new Map(CHEMICALS.map((t) => [t, Infinity]))
  const high = new Map(CHEMICALS.map((t) => [t, -Infinity]))
  const afterDelivery: { step: number; tank: string; left: number; room: number }[] = []
  const brought = new Map(CHEMICALS.map((t) => [t, 0]))
  for (let k = 1; k <= STEPS; k++) {
    const r = step(doc.nodes, edges, st, 1, doc.modelVersion, opts)
    st = r.state
    for (const e of r.report.events) if (e.from.endsWith('Del')) brought.set(e.to, brought.get(e.to)! + e.amount)
    for (const t of CHEMICALS) {
      low.set(t, Math.min(low.get(t)!, st.values[t]!))
      high.set(t, Math.max(high.get(t)!, st.values[t]!))
      // the last step of each 14th day: what a step's draw leaves below the cap
      // (a tank with no cap has no room to measure: NaN, which fails the check below)
      if (k % PERIOD_STEPS === 0) afterDelivery.push({ step: k, tank: t, left: st.values[t]!, room: (dataOf(t).capacity ?? NaN) - st.values[t]! })
    }
  }

  it('each chemical tank is capped at its start and fed by one delivery line that reads its own table', () => {
    expect(doc.modelVersion).toBe(7)
    for (const t of CHEMICALS) {
      expect(dataOf(t).capacity, t).toBe(dataOf(t).initial)
      const into = lineInto(t)
      expect(into.map((e) => e.source), t).toEqual([`${t}Del`])
      expect(dataOf(`${t}Del`).kind, t).toBe('source')
      const table = doc.timetables.find((x) => x.id === timetableRef(String((into[0]!.data as { flow: string }).flow)))!
      // a delivery on every 14th day, of 14 days of the tank's dose; only what fits goes in
      expect(table, t).toMatchObject({ unit: 'kg per day', timeUnit: 'd', read: 'hold', after: 'repeat', end: '14', means: 'available' })
      expect(table.points, t).toEqual([['0', '0'], ['13', String(doseOf(t) * 14)]])
    }
  })

  it('a delivery fills its tank: at the end of each 14th day the tank is within one step of its cap', () => {
    expect(afterDelivery).toHaveLength((STEPS / PERIOD_STEPS | 0) * CHEMICALS.length)
    for (const a of afterDelivery) expect(a.room, `${a.tank} at step ${a.step}`).toBeLessThanOrEqual(doseOf(a.tank) / 24 + 1e-9)
  })

  it('only what fits goes in: no tank passes its cap, and the deliveries bring less than they could', () => {
    for (const t of CHEMICALS) {
      expect(high.get(t)!, t).toBeLessThanOrEqual(dataOf(t).capacity!)
      const could = (STEPS / PERIOD_STEPS | 0) * doseOf(t) * 14
      expect(brought.get(t)!, t).toBeGreaterThan(0)
      expect(brought.get(t)!, t).toBeLessThan(could)
    }
  })

  it('between deliveries each tank falls and keeps more than 70 % of its cap', () => {
    for (const t of CHEMICALS) {
      expect(low.get(t)!, t).toBeLessThan(dataOf(t).capacity! - doseOf(t))
      expect(low.get(t)! / dataOf(t).capacity!, t).toBeGreaterThan(0.7)
    }
  })

  // what the deliveries prevent: the stop before #533, measured on main 9d5d0186 and matched
  // point for point by a run CSV of the app (steps 1005–1404). The tank still holds 0.30 then:
  // it is short of a step's need, not empty (Lumi, #535).
  it('without its deliveries the plant stops about 48 days in: Discharge adjustment first (step 1161), then Reverse osmosis, then the Delivery pump', () => {
    const noDelivery = edges.filter((e) => !e.source.endsWith('Del'))
    const converters = doc.nodes.filter((n) => n.data.kind === 'converter').map((n) => n.id)
    let s = initSim(doc.nodes, opts)
    const firstMiss = new Map<string, number>()
    for (let k = 1; k <= 1240; k++) {
      const r = step(doc.nodes, noDelivery, s, 1, doc.modelVersion, opts)
      s = r.state
      for (const c of converters) if (!r.report.fired.includes(c) && !firstMiss.has(c)) firstMiss.set(c, k)
    }
    const first = Math.min(...firstMiss.values())
    expect(first).toBe(1161)
    expect([...firstMiss].filter(([, k]) => k === first).map(([c]) => c)).toEqual(['adjust'])
    expect(Math.floor(first / 24)).toBe(48)
    expect(firstMiss.get('ro')).toBe(1172)
    expect(firstMiss.get('dpump')).toBe(1181)
  })
})
