import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { kindFindings, refusingKindFindings, resolveKinds } from '../src/model/kinds'
import { add, cmp, displayRational, div, equals, exactDouble, fromInt, mul, rational, sub, toDouble, type Rational } from '../src/model/rational'
import { deserialize } from '../src/model/serialize'
import { currentAmountText, engineValue, fieldRational, poolKindName, resolveFieldUnit } from '../src/model/units'
import type { LoopEdge, LoopNode } from '../src/model/types'

// `examples/desalination.json` — the bundled seawater desalination process
// example (#471), a fixed-ratio flow model in the kinds, units and step-length
// contract. This test re-derives every value in
// `examples/desalination.expected.json` from the graph through the REAL engine
// (initSim / step with its kinds table and step length, as Play runs it) and
// pins them exactly, then checks the water balance against an a-priori
// floating-point bound at 24, 168 and 720 steps.
//
// Two layers are kept apart:
//   • the AUTHORED recipes (per day) balance exactly in rationals — the kinds
//     check finds nothing;
//   • the ENGINE runs on doubles (per 1 h step). Its residual
//       r(n) = Σ water Pools(n) − (W₀ + Σ intake − Σ drained)
//     is computed EXACTLY here (every double as its exact binary value, every
//     sum a rational), so the check adds no rounding of its own; what is left
//     is the engine's.
//
// Regenerate after a deliberate change:  GEN_DESALINATION=1 npm test -- desalination-example

const DIR = resolve(import.meta.dirname, '..', 'examples')
const GEN = !!process.env.GEN_DESALINATION
const STEPS = 720
const CHECKPOINTS = [1, 24, 168, 720]
const BOUND_AT = [24, 168, 720]
/** unit roundoff of IEEE-754 binary64: |fl(x ± y) − (x ± y)| ≤ u·|x ± y| */
const U = rational(1n, 2n ** 53n)
const EXITS = ['city', 'outfall', 'cake']

const abs = (r: Rational): Rational => (r.num < 0n ? rational(-r.num, r.den) : r)
/** a non-negative rational rounded UP to a multiple of 2⁻¹²⁰ — keeps the
 *  envelope's denominators bounded (each step would otherwise multiply them by
 *  about 2⁵²) while only ever widening the bound, so it stays an upper bound */
const GRID = 2n ** 120n
const up = (r: Rational): Rational => rational((r.num * GRID + r.den - 1n) / r.den, GRID)
const le = (a: Rational, b: Rational) => cmp(a, b) <= 0
const show = (r: Rational) => displayRational(r).text
const sci = (r: Rational) => toDouble(r).toExponential(6)
const sum = (rs: Rational[]) => rs.reduce(add, fromInt(0))

const readDoc = () => deserialize(readFileSync(resolve(DIR, 'desalination.json'), 'utf8'))

function derive() {
  const doc = readDoc()
  const { nodes, edges, kinds, time, modelVersion } = doc
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const edgeKind = resolveKinds(nodes, edges).edgeKind

  // ── the fields: authored → exact per step → engine double → rounding ──
  const fields: Record<string, unknown>[] = []
  const exactOf = new Map<string, Rational>()
  const engineOf = new Map<string, number>()
  const startOf = new Map<string, Rational>()
  const capOf = new Map<string, Rational>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const d = n.data as { initial: number; capacity: number | null; unit?: string }
    const fu = resolveFieldUnit(d.unit, declOf.get(poolKindName(d) ?? ''), time, 'stock')
    for (const [f, v] of [['initial', d.initial], ['capacity', d.capacity]] as const) {
      if (v == null) continue
      const exact = fieldRational(v, fu, time)!
      const eng = engineValue(v, fu, time)
      if (f === 'initial') startOf.set(n.id, exact)
      else capOf.set(n.id, exact)
      fields.push({ field: `${n.id}.${f}`, authored: d.unit ? `${v} ${d.unit}` : String(v), exactPerStep: show(exact), engine: eng, roundingError: show(sub(exactDouble(eng), exact)) })
    }
  }
  for (const e of edges) {
    const d = e.data as { flow: string; unit?: string }
    const k = edgeKind.get(e.id) ?? null
    const fu = resolveFieldUnit(d.unit, k ? declOf.get(k) : undefined, time, 'rate')
    const exact = fieldRational(d.flow, fu, time)!
    const eng = engineValue(d.flow, fu, time)
    exactOf.set(e.id, exact)
    engineOf.set(e.id, eng)
    fields.push({ field: e.id, kind: k, authored: d.unit ? `${d.flow} ${d.unit}` : d.flow, exactPerStep: show(exact), engine: eng, roundingError: show(sub(exactDouble(eng), exact)) })
  }
  const waterEdges = edges.filter((e) => edgeKind.get(e.id) === 'water')
  const rho = (id: string) => sub(exactDouble(engineOf.get(id)!), exactOf.get(id)!)

  // δ — what the doubles of a Converter's water rates do not sum to: per run,
  // exact. A run of the whole chain adds at most Σ |δ_c| of water that the
  // authored recipes do not have.
  const converters = nodes.filter((n) => n.data.kind === 'converter').map((n) => n.id)
  const deltaOf = (c: string) => {
    const ins = waterEdges.filter((e) => e.target === c).map((e) => exactDouble(engineOf.get(e.id)!))
    const outs = waterEdges.filter((e) => e.source === c).map((e) => exactDouble(engineOf.get(e.id)!))
    return sub(sum(outs), sum(ins))
  }
  const delta = sum(converters.map((c) => abs(deltaOf(c))))

  // ── the water Pools, as the proof reads them ──
  const pools = nodes.filter((n) => n.data.kind === 'pool' && poolKindName(n.data) === 'water').map((n) => {
    const ins = waterEdges.filter((e) => e.target === n.id).map((e) => e.id)
    const outs = waterEdges.filter((e) => e.source === n.id).map((e) => e.id)
    return {
      id: n.id, ins, outs,
      S: startOf.get(n.id)!, cap: capOf.get(n.id)!,
      /** every amount the Pool takes in a step, with its representation error */
      a: add(sum(ins.map((id) => exactOf.get(id)!)), sum(ins.map((id) => abs(rho(id))))),
      /** every amount it gives */
      out: add(sum(outs.map((id) => exactOf.get(id)!)), sum(outs.map((id) => abs(rho(id))))),
      /** the drift of one step, from representation alone */
      drift: abs(sub(sum(ins.map(rho)), sum(outs.map(rho)))),
      updates: ins.length + outs.length,
      steady: equals(sum(ins.map((id) => exactOf.get(id)!)), sum(outs.map((id) => exactOf.get(id)!))),
    }
  })

  // ── the run ──
  const opts = { kinds, time }
  let st = initSim(nodes, opts)
  const W = (v: Record<string, number>) => pools.reduce<Rational>((s, p) => add(s, exactDouble(v[p.id] ?? 0)), fromInt(0))
  const W0 = W(st.values)
  let intake = fromInt(0)
  let drained = fromInt(0)
  let maxR = fromInt(0)
  let diagnostics = 0
  let notices = 0
  const fired = new Map<string, number>()
  const checkpoints: Record<string, unknown>[] = []
  const residualAt = new Map<number, { r: Rational; max: Rational }>()
  const fuProduct = resolveFieldUnit('L', declOf.get('water'), time, 'stock')
  // ── the bound, with a state-error envelope ──
  // An update's rounding is at most u × |its exact result|, and that result is
  // made from the ACTUAL stock, not the ideal one. So each water Pool carries an
  // envelope D: a proven bound on |actual stock − exact model stock| at the end
  // of every step. Every Pool is steady in the exact model, so its exact stock
  // is S at every step, and
  //   D′ = D + |Σρ_in − Σρ_out| + k u (S + D + a)
  // where a holds every inflow with its |ρ| and k is the Pool's updates in a
  // step: S + D + a bounds every partial result, in any update order.
  // B(n) = n Σ|δ_c| + Σ_t Σ_pools k u (S + D_{t−1} + a). The run then checks, at
  // every step, that each actual stock is inside S ± D — the envelope is a
  // claim the test verifies, not an assumption.
  const env = new Map(pools.map((p) => [p.id, fromInt(0)])) // the initials are exact doubles
  let roundSum = fromInt(0)
  let envelopeHeld = true
  let preconditionsHeld = true
  let maxEnvelopeShare = 0
  const boundAt = new Map<number, Rational>()
  const envelopeAt = new Map<number, Record<string, string>>()
  for (let t = 1; t <= STEPS; t++) {
    for (const p of pools) {
      const D = env.get(p.id)!
      // the proof's preconditions for step t, from the model and the envelope at
      // the step's START only (no value of the run is read here): under H(t−1)
      // the Pool can give its whole outflow, and its whole inflow fits
      if (!le(p.out, sub(p.S, D))) preconditionsHeld = false
      if (!le(add(add(p.S, D), p.a), p.cap)) preconditionsHeld = false
      const r_t = up(mul(mul(fromInt(p.updates), U), add(add(p.S, D), p.a)))
      roundSum = up(add(roundSum, r_t))
      env.set(p.id, up(add(add(D, p.drift), r_t)))
    }
    const r = step(nodes, edges as LoopEdge[], st, 1, modelVersion, opts)
    st = r.state
    diagnostics += r.report.diagnostics.length
    notices += (r.report.notices ?? []).length
    for (const f of r.report.fired) fired.set(f, (fired.get(f) ?? 0) + 1)
    for (const e of r.report.events) {
      if (e.from === 'sea') intake = add(intake, exactDouble(e.amount))
      if (EXITS.includes(e.to)) drained = add(drained, exactDouble(e.amount))
    }
    const res = sub(W(st.values), add(W0, sub(intake, drained)))
    if (!le(abs(res), maxR)) maxR = abs(res)
    for (const p of pools) {
      const dev = abs(sub(exactDouble(st.values[p.id] ?? 0), p.S))
      const D = env.get(p.id)!
      if (!le(dev, D)) envelopeHeld = false
      if (D.num !== 0n) maxEnvelopeShare = Math.max(maxEnvelopeShare, toDouble(dev) / toDouble(D))
    }
    if (BOUND_AT.includes(t)) {
      residualAt.set(t, { r: res, max: maxR })
      boundAt.set(t, add(mul(fromInt(t), delta), roundSum))
      envelopeAt.set(t, Object.fromEntries(pools.map((p) => [p.id, sci(env.get(p.id)!)])))
    }
    if (CHECKPOINTS.includes(t)) {
      checkpoints.push({
        step: t,
        values: { ...st.values },
        intakeTotal: toDouble(intake),
        drainedTotal: toDouble(drained),
        productWaterShown: currentAmountText(st.values.product, 1500000, 'L', fuProduct, time),
      })
    }
  }
  const balance = BOUND_AT.map((n) => {
    const m = residualAt.get(n)!
    const b = boundAt.get(n)!
    return { steps: n, residual: sci(m.r), maxResidualSoFar: sci(m.max), bound: sci(b), withinBound: le(m.max, b), shareOfBound: Number((toDouble(m.max) / toDouble(b)).toPrecision(3)), envelope: envelopeAt.get(n) }
  })

  // ── energy, from the authored rates alone ──
  const perDay = (ids: string[]) => mul(sum(ids.map((id) => exactOf.get(id)!)), fromInt(24))
  const gridLines = edges.filter((e) => /^grid[ABC]$/.test(e.source)).map((e) => e.id)
  const delivered = perDay(['e_dpump_city'])
  const energy = { gridKwhPerDay: show(perDay(gridLines)), deliveredM3PerDay: show(delivered), kwhPerM3: show(div(perDay(gridLines), delivered)) }

  // ── the chemicals: each tank's fall against dose × time ──
  const chemicals = edges
    .filter((e) => !['water', 'power'].includes(edgeKind.get(e.id) ?? ''))
    .map((e) => {
      const left = st.values[e.source] ?? 0
      const expected = sub(startOf.get(e.source)!, mul(exactOf.get(e.id)!, fromInt(STEPS)))
      return { tank: e.source, kind: edgeKind.get(e.id), kgPerDay: show(mul(exactOf.get(e.id)!, fromInt(24))), exactLeft: show(expected), engineLeft: left, difference: Math.abs(left - toDouble(expected)) }
    })

  // ── the shipped kinds contract on the shapes it refuses ──
  const variant = (id: string, patch: Record<string, string | undefined>) => edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) as LoopEdge[]
  const refused = (es: LoopEdge[]) => {
    const f = refusingKindFindings(nodes, es, kinds, modelVersion, time)
    const r = step(nodes, es, initSim(nodes, opts), 1, modelVersion, opts)
    return { findings: f.map((x) => x.cls), moved: r.report.events.length, diagnostic: r.report.diagnostics[0] ?? null }
  }

  return {
    $about:
      'examples/desalination.json run through the real engine for 720 steps (30 days at a 1 h step). Re-derived and pinned by test/desalination-example.test.ts. A fixed-ratio flow model: its plant size, stage power and doses are example assumptions, not design data.',
    $bound: {
      formula: 'B(n) = n × Σ|δ_c| + Σ_{t ≤ n} Σ_{water Pools} k u × (S + D_{t−1} + a)',
      u: 'unit roundoff of binary64, 2^-53: each addition or subtraction rounds by at most u times its exact result (IEEE-754 round to nearest)',
      delta: `Σ over Converters of |Σ double(out) − Σ double(in)|, per run, exact: ${show(delta)} m³; counted for every step`,
      updates: 'every event amount is applied to a Pool by exactly one addition (into it) or one subtraction (out of it) in src/engine/step.ts; k is the number of water connections at the Pool',
      envelope: 'D bounds |actual stock − exact model stock| at the end of a step: D′ = D + |Σρ_in − Σρ_out| + k u (S + D + a)',
      proof: 'By induction on t. H(t): at the end of step t every actual water stock lies within S ± D(t). H(0): the initials are exact doubles and D(0) = 0. Step: under H(t−1) the preconditions, computed from the model and D alone, give each Pool its whole outflow and fit its whole inflow, so every connection moves its double, and each update rounds by at most u × (S + D + a).',
      exact: 'every water Pool is steady in the exact model: its authored inflows sum exactly to its authored outflows, so its exact stock is S at every step',
      notCounted: 'amounts that are copies of a value round nothing; the residual is summed in exact rationals, so the check itself adds no rounding',
      why: 'every term is derived from the model, the field doubles and IEEE-754 rounding before the run, never from the measured error; B grows with n',
    },
    envelope: {
      everyPoolSteadyInTheExactModel: pools.every((p) => p.steady),
      proofPreconditionsHeldAtEveryStep: preconditionsHeld,
      corroboration: { actualInsideEnvelopeAtEveryStep: envelopeHeld, largestShareOfEnvelope: Number(maxEnvelopeShare.toPrecision(3)) },
    },
    modelVersion,
    time,
    authoredBalance: { finding: kindFindings(nodes, edges, kinds, modelVersion, time).length === 0 ? 'none' : 'broken', recoveryPercent: show(mul(div(exactOf.get('e_ro_permeate')!, exactOf.get('e_hp_ro')!), fromInt(100))) },
    fields,
    run: { steps: STEPS, seed: 1, diagnostics, notices, maxResidual: sci(maxR), fired: Object.fromEntries([...fired].sort(([a], [b]) => (a < b ? -1 : 1))) },
    checkpoints,
    balance,
    energy,
    chemicals,
    contract: { wrongRatio: refused(variant('e_ro_permeate', { flow: '9500' })), allOnFeed: refused(variant('e_hp_ro', { flow: 'all', unit: undefined })) },
  }
}

// ── what a failure does, written before it was measured ──
// Each changes one thing in the document and runs 720 steps through the real
// engine. Nothing may be lost silently: at every step the water Pools equal the
// start plus intake minus what left, to rounding, and no stock passes its limits.
function failure(change: (nodes: LoopNode[], edges: LoopEdge[]) => void) {
  const doc = readDoc()
  const nodes = structuredClone(doc.nodes)
  const edges = structuredClone(doc.edges) as LoopEdge[]
  change(nodes, edges)
  const opts = { kinds: doc.kinds, time: doc.time }
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
  for (let t = 1; t <= STEPS; t++) {
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

  it('reproduces desalination.expected.json exactly: fields, the 720-step run, the checkpoints, the bound', () => {
    expect(JSON.parse(JSON.stringify(got))).toEqual(want)
  })

  it('every authored recipe balances exactly, the run raises no diagnostic or notice, and every stage runs every step', () => {
    expect(got.authoredBalance).toEqual({ finding: 'none', recoveryPercent: '45' })
    expect(got.run).toMatchObject({ diagnostics: 0, notices: 0 })
    expect(Object.keys(got.run.fired)).toHaveLength(21)
    for (const [id, n] of Object.entries(got.run.fired)) expect(n, id).toBe(STEPS)
  })

  it('the engine residual stays inside the a-priori bound at 24, 168 and 720 steps, and the bound grows with the steps', () => {
    expect(got.balance.map((b) => b.steps)).toEqual(BOUND_AT)
    for (const b of got.balance) expect(b.withinBound, `${b.steps} steps: ${b.maxResidualSoFar} vs ${b.bound}`).toBe(true)
    const bounds = got.balance.map((b) => Number(b.bound))
    expect(bounds[0]! < bounds[1]! && bounds[1]! < bounds[2]!).toBe(true)
  })

  it('the proof’s preconditions hold at every step (from the model alone), and the run corroborates the envelope', () => {
    expect(got.envelope.everyPoolSteadyInTheExactModel).toBe(true)
    expect(got.envelope.proofPreconditionsHeldAtEveryStep).toBe(true)
    expect(got.envelope.corroboration.actualInsideEnvelopeAtEveryStep).toBe(true)
    expect(got.envelope.corroboration.largestShareOfEnvelope).toBeLessThanOrEqual(1)
  })

  it('the grid total over the water delivered is exactly 4 kWh per m³, from the authored rates', () => {
    expect(got.energy).toEqual({ gridKwhPerDay: '36000', deliveredM3PerDay: '9000', kwhPerM3: '4' })
  })

  it('each chemical tank falls by its dose times the time, and none runs out in 30 days', () => {
    expect(got.chemicals).toHaveLength(6)
    for (const c of got.chemicals) {
      expect(c.difference, c.tank).toBeLessThan(1e-6)
      expect(c.engineLeft, c.tank).toBeGreaterThan(0)
    }
  })

  it('the Properties panel shows the product water in its authored unit', () => {
    for (const c of got.checkpoints) expect(c.productWaterShown).toMatch(/^(≈ )?1500000 L$/)
  })

  it('a wrong recovery ratio and `all` on a water line are refused before the run', () => {
    expect(got.contract.wrongRatio).toMatchObject({ findings: ['broken'], moved: 0 })
    // the line joins two Converters, so each of them reports it
    expect(got.contract.allOnFeed).toMatchObject({ findings: ['notComputable', 'notComputable'], moved: 0 })
  })

  describe('failures lose nothing silently', () => {
    it('an empty chemical tank stops its stage, and the plant downstream runs out and stops', () => {
      const r = failure((nodes) => { (nodeOf(nodes, 'naocl').data as { initial: number }).initial = 0 })
      expect(r.fired.get('screen') ?? 0).toBe(0)
      expect(r.lastDelivery).toBeGreaterThan(0)
      expect(r.lastDelivery).toBeLessThan(STEPS)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.basin).toBeLessThanOrEqual(12000)
    })

    it('a cut grid feed stops the pumps it feeds once its panel is empty, and water backs up without being lost', () => {
      const r = failure((_, edges) => { (edgeOf(edges, 'e_gridB_panelB').data as { flow: string }).flow = '0' })
      expect(r.fired.get('hp') ?? 0).toBeLessThan(5)
      expect(r.lastDelivery).toBeLessThan(STEPS)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.filtered).toBeLessThanOrEqual(12000)
    })

    it('a full tank holds what it can, stays within its capacity, and the water upstream waits', () => {
      // both sides of the Delivery pump, so its recipe still balances and the
      // run is not refused: the city takes nothing and the product tank fills
      const r = failure((_, edges) => {
        for (const id of ['e_product_dpump', 'e_dpump_city']) (edgeOf(edges, id).data as { flow: string }).flow = '0'
      })
      expect(r.fired.get('screen') ?? 0, 'the run was not refused').toBeGreaterThan(0)
      expect(r.lastDelivery).toBe(0)
      expect(r.worst).toBeLessThan(1e-6)
      expect(r.negative).toBe(false)
      expect(r.values.product).toBeCloseTo(6000, 6)
      expect(r.values.permeate).toBeLessThanOrEqual(6000)
      expect(r.fired.get('disinfect')).toBeLessThan(STEPS)
    })
  })
})
