import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { kindFindings, refusingKindFindings, resolveKinds } from '../src/model/kinds'
import { add, displayRational, exactDouble, fromInt, mul, rational, sub, toDouble, type Rational } from '../src/model/rational'
import { deserialize } from '../src/model/serialize'
import { currentAmountText, engineValue, fieldRational, poolKindName, resolveFieldUnit } from '../src/model/units'
import type { LoopEdge } from '../src/model/types'

// `examples/desalination.json` — the bundled desalination Template (#471),
// written in the shipped kinds, units and step-length contract. This test
// re-derives every value in `examples/desalination.expected.json` from the
// graph through the REAL engine (initSim / step with its kinds table and step
// length, as Play runs it) and pins them exactly, then checks the water
// balance against an a-priori floating-point bound at 24, 168 and 720 steps.
//
// Two layers are kept apart:
//   • the AUTHORED recipe (per day) balances exactly in rationals — the kinds
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
const WATER_POOLS = ['feed', 'permeate', 'brine'] as const

const abs = (r: Rational): Rational => (r.num < 0n ? rational(-r.num, r.den) : r)
const le = (a: Rational, b: Rational) => a.num * b.den <= b.num * a.den
const show = (r: Rational) => displayRational(r).text
const sci = (r: Rational) => toDouble(r).toExponential(6)

function derive() {
  const doc = deserialize(readFileSync(resolve(DIR, 'desalination.json'), 'utf8'))
  const { nodes, edges, kinds, time, modelVersion } = doc
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const edgeKind = resolveKinds(nodes, edges).edgeKind

  // ── the fields: authored → exact per step → engine double → rounding ──
  const fields: Record<string, unknown>[] = []
  const engineOf = new Map<string, number>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const d = n.data as { initial: number; capacity: number | null; unit?: string }
    const fu = resolveFieldUnit(d.unit, declOf.get(poolKindName(d) ?? ''), time, 'stock')
    for (const [f, v] of [['initial', d.initial], ['capacity', d.capacity]] as const) {
      if (v == null) continue
      const exact = fieldRational(v, fu, time)!
      const eng = engineValue(v, fu, time)
      fields.push({ field: `${n.id}.${f}`, authored: d.unit ? `${v} ${d.unit}` : String(v), exactPerStep: show(exact), engine: eng, roundingError: show(sub(exactDouble(eng), exact)) })
    }
  }
  for (const e of edges) {
    const d = e.data as { flow: string; unit?: string }
    const k = edgeKind.get(e.id) ?? null
    const fu = resolveFieldUnit(d.unit, k ? declOf.get(k) : undefined, time, 'rate')
    const exact = fieldRational(d.flow, fu, time)
    const eng = exact ? engineValue(d.flow, fu, time) : null
    if (eng !== null) engineOf.set(e.id, eng)
    fields.push({
      field: e.id, kind: k, authored: d.unit ? `${d.flow} ${d.unit}` : d.flow,
      exactPerStep: exact ? show(exact) : null, engine: eng,
      roundingError: exact && eng !== null ? show(sub(exactDouble(eng), exact)) : null,
    })
  }
  // the reverse-osmosis conversion's representation term: the doubles of
  // 0.45 and 0.55 MLD do not sum exactly to the double of 1 MLD
  const delta = sub(add(exactDouble(engineOf.get('e_ro_permeate')!), exactDouble(engineOf.get('e_ro_brine')!)), exactDouble(engineOf.get('e_feed_ro')!))

  // ── the run ──
  const opts = { kinds, time }
  let st = initSim(nodes, opts)
  const W = (v: Record<string, number>) => WATER_POOLS.reduce<Rational>((s, p) => add(s, exactDouble(v[p] ?? 0)), fromInt(0))
  const W0 = W(st.values)
  let intake = fromInt(0)
  let drained = fromInt(0)
  let roRuns = 0
  let maxR = fromInt(0)
  let diagnostics = 0
  let notices = 0
  const checkpoints: Record<string, unknown>[] = []
  const residualAt = new Map<number, { r: Rational; max: Rational }>()
  const fuL = resolveFieldUnit('L', declOf.get('water'), time, 'stock')
  // a-priori magnitude sum for the bound: each Pool update's result is at most
  // (the exact predicted start of the step + its inflow), whatever the order
  let mag = fromInt(0)
  const boundAt = new Map<number, Rational>()
  const q = { in: rational(125n, 3n), p: rational(75n, 4n), b: rational(275n, 12n), city: rational(50n, 3n) }
  for (let t = 1; t <= STEPS; t++) {
    const permStart = add(rational(200n, 1n), mul(fromInt(t - 1), sub(q.p, q.city)))
    const brineStart = t === 1 ? fromInt(0) : q.b
    mag = add(mag, mul(fromInt(2), add(add(add(rational(500n, 1n), q.in), add(permStart, q.p)), add(brineStart, q.b))))
    const r = step(nodes, edges as LoopEdge[], st, 1, modelVersion, opts)
    st = r.state
    diagnostics += r.report.diagnostics.length
    notices += (r.report.notices ?? []).length
    const amt = (id: string) => r.report.events.filter((e) => e.edgeId === id).reduce<Rational>((s, e) => add(s, exactDouble(e.amount)), fromInt(0))
    intake = add(intake, amt('e_intake'))
    drained = add(drained, add(amt('e_city'), amt('e_outfall')))
    if (r.report.events.some((e) => e.edgeId === 'e_feed_ro' && e.amount > 0)) roRuns++
    const res = sub(W(st.values), add(W0, sub(intake, drained)))
    if (!le(abs(res), maxR)) maxR = abs(res)
    if (BOUND_AT.includes(t)) {
      residualAt.set(t, { r: res, max: maxR })
      boundAt.set(t, add(mul(fromInt(roRuns), abs(delta)), mul(U, mag)))
    }
    if (CHECKPOINTS.includes(t)) {
      checkpoints.push({
        step: t,
        values: { feed: st.values.feed, permeate: st.values.permeate, brine: st.values.brine, power: st.values.power },
        intakeTotal: toDouble(intake),
        drainedTotal: toDouble(drained),
        productWaterShown: currentAmountText(st.values.permeate, 200000, 'L', fuL, time),
        productWaterExact: show(add(rational(200n, 1n), mul(fromInt(t), sub(q.p, q.city)))),
      })
    }
  }
  const balance = BOUND_AT.map((n) => {
    const m = residualAt.get(n)!
    const b = boundAt.get(n)!
    return { steps: n, residual: sci(m.r), maxResidualSoFar: sci(m.max), bound: sci(b), withinBound: le(m.max, b), shareOfBound: Number((toDouble(m.max) / toDouble(b)).toPrecision(3)) }
  })

  // ── the shipped kinds contract on rev 3's silent shapes ──
  const variant = (id: string, patch: Record<string, string | undefined>) => edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) as LoopEdge[]
  const refused = (es: LoopEdge[]) => {
    const f = refusingKindFindings(nodes, es, kinds, modelVersion, time)
    const r = step(nodes, es, initSim(nodes, opts), 1, modelVersion, opts)
    return { findings: f.map((x) => x.cls), moved: r.report.events.length, diagnostic: r.report.diagnostics[0] ?? null }
  }

  return {
    $about:
      'examples/desalination.json run through the real engine for 720 steps (30 days at a 1 h step). Re-derived and pinned by test/desalination-example.test.ts. Two layers: the authored per-day recipe balances exactly (no kinds finding); the engine runs on doubles, and its water-balance residual, computed exactly from the doubles it holds, stays inside an a-priori bound that grows with the step count.',
    $bound: {
      formula: 'B(n) = n_RO(n) × |δ| + u × Σ_{t ≤ n} Σ_{water Pools} 2 × (S_t + a_t)',
      u: 'unit roundoff of binary64, 2^-53: each addition or subtraction rounds by at most u times its exact result',
      delta: `δ = double(0.45 MLD) + double(0.55 MLD) − double(1 MLD), per reverse-osmosis run, exact: ${show(delta)} m³`,
      updates: 'every event amount is applied to a Pool by exactly one addition (into it) or one subtraction (out of it) in src/engine/step.ts; each water Pool takes one inflow and one outflow per step, so two roundings, each of a result no larger than the exact predicted start of the step S_t plus its inflow a_t (feed 500 + 125/3, product water 200 + 25(t−1)/12 + 75/4, brine 275/12 + 275/12, from step 2)',
      notCounted: 'amounts that are copies of a value (a Source push, a pull at the full rate, `all` of a Pool) round nothing; the residual is summed in exact rationals, so the check adds no rounding of its own',
      why: 'the bound is derived from the model and IEEE-754 rounding before the run, never from the measured error; it grows with n (the RO term linearly, the update term about quadratically, as the product-water stock grows)',
    },
    modelVersion,
    time,
    authoredBalance: { finding: kindFindings(nodes, edges, kinds, modelVersion, time).length === 0 ? 'none' : 'broken', recipe: '1 MLD = 0.45 MLD + 0.55 MLD; per 1 h step 125/3 = 75/4 + 275/12 m³' },
    fields,
    run: { steps: STEPS, seed: 1, roRuns, diagnostics, notices, maxResidual: sci(maxR) },
    checkpoints,
    balance,
    contract: { wrongRatio: refused(variant('e_ro_permeate', { flow: '0.5' })), allOnFeed: refused(variant('e_feed_ro', { flow: 'all', unit: undefined })) },
  }
}

describe('examples/desalination.json — the bundled desalination Template (#471)', () => {
  const got = derive()
  if (GEN) writeFileSync(resolve(DIR, 'desalination.expected.json'), JSON.stringify(got, null, 2) + '\n')
  const want = JSON.parse(readFileSync(resolve(DIR, 'desalination.expected.json'), 'utf8')) as ReturnType<typeof derive>

  it('reproduces desalination.expected.json exactly: fields, the 720-step run, the checkpoints, the bound', () => {
    expect(JSON.parse(JSON.stringify(got))).toEqual(want)
  })

  it('the authored recipe balances exactly; the run raises no diagnostic or notice and the RO runs every step', () => {
    expect(got.authoredBalance.finding).toBe('none')
    expect(got.run).toMatchObject({ roRuns: 720, diagnostics: 0, notices: 0 })
  })

  it('the engine residual stays inside the a-priori bound at 24, 168 and 720 steps, and the bound grows with the steps', () => {
    expect(got.balance.map((b) => b.steps)).toEqual(BOUND_AT)
    for (const b of got.balance) expect(b.withinBound, `${b.steps} steps: ${b.maxResidualSoFar} vs ${b.bound}`).toBe(true)
    const bounds = got.balance.map((b) => Number(b.bound))
    expect(bounds[0]! < bounds[1]! && bounds[1]! < bounds[2]!).toBe(true)
  })

  it('the Properties panel shows the product water at 15 significant digits, ≈ where it is not the engine value', () => {
    const at = (n: number) => got.checkpoints.find((c) => c.step === n)!.productWaterShown
    expect(at(720)).toBe('≈ 1699999.99999998 L')
    for (const n of CHECKPOINTS) expect(at(n)).toMatch(/^(≈ )?\d+(\.\d+)? L$/)
  })

  it('rev 3’s two silent shapes are refused before the run under the shipped kinds contract', () => {
    expect(got.contract.wrongRatio).toMatchObject({ findings: ['broken'], moved: 0 })
    expect(got.contract.allOnFeed).toMatchObject({ findings: ['notComputable'], moved: 0 })
  })
})
