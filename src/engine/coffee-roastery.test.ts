import { describe, expect, it } from 'vitest'
import fixtureDoc from '../../examples/coffee-roastery.json'
import { registersOfSnapshot } from '../model/model'
import { normalizeGraph, serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { buildCoffeeRoastery, COFFEE_ROASTERY_FRAMES, COFFEE_ROASTERY_MC, P } from './coffee-roastery.fixture'
import { initSim, step } from './step'

// `examples/coffee-roastery.json` is the "Coffee roastery operations flow"
// Templates demo — the first bundled Template at schema `loop-studio/graph/2`
// (loop-model/2). Generated from `buildCoffeeRoastery()` through the real
// serializer; docs/example-coffee-roastery.md is the settled design.
//
// NOT a value oracle. The checks pin structural invariants (§CR5 / §CR6.1), the
// mass-conserving roasting split, "every Register finite from step 0, no engine
// diagnostics", determinism, and the §CR9.1 scenario DIRECTIONS — a real
// deterministic run before / after each single `@param` change.
//
// Regenerate after a deliberate change:
//   GEN_COFFEE_ROASTERY=1 npx vitest run src/engine/coffee-roastery.test.ts

const built = buildCoffeeRoastery()

const RECOMMENDED = {
  baseSeed: COFFEE_ROASTERY_MC.baseSeed,
  runs: COFFEE_ROASTERY_MC.runs,
  steps: COFFEE_ROASTERY_MC.steps,
  tracked: [...COFFEE_ROASTERY_MC.tracked],
  timelineSeries: [...COFFEE_ROASTERY_MC.timelineSeries],
}

// loop-model/2: this Template is a v2 document — resolve `@param` flows.
const MV = 2 as const

/** Run the graph `steps` days with optional `parameter` value overrides, and
 *  return the committed pool values plus the Register outcomes at the end. */
function runWith(
  overrides: Record<string, number>,
  steps = P.steps,
): { pools: Record<string, number>; reg: (id: string) => number } {
  const nodes: LoopNode[] = built.nodes.map((n) =>
    n.data.kind === 'parameter' && overrides[n.id] !== undefined
      ? { ...n, data: { ...n.data, value: overrides[n.id] } }
      : n,
  )
  let st = initSim(nodes)
  for (let t = 1; t <= steps && !st.ended; t++) st = step(nodes, built.edges, st, 1, MV).state
  const outcomes = registersOfSnapshot(nodes, st.values)
  return {
    pools: st.values,
    reg: (id) => {
      const o = outcomes.get(id)
      if (!o || o.invalid) throw new Error(`register ${id} invalid: ${JSON.stringify(o)}`)
      return o.value
    },
  }
}

describe('coffee-roastery example', () => {
  if (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.GEN_COFFEE_ROASTERY === '1'
  ) {
    it('regenerates examples/coffee-roastery.json', async () => {
      const fs = await import('node:' + 'fs')
      fs.writeFileSync(
        new URL('../../examples/coffee-roastery.json', import.meta.url),
        serialize(built.nodes, built.edges, RECOMMENDED, undefined, undefined, 2, COFFEE_ROASTERY_FRAMES) + '\n',
      )
    })
    return
  }

  const { nodes, edges } = normalizeGraph(
    fixtureDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] },
  )
  const byId = new Map(nodes.map((n) => [n.id, n]))

  it('the committed file matches buildCoffeeRoastery() through the serializer, as loop-studio/graph/2', () => {
    expect((fixtureDoc as { schema: string }).schema).toBe('loop-studio/graph/2')
    expect((fixtureDoc as { version: number }).version).toBe(1)
    expect(fixtureDoc).toEqual(
      JSON.parse(serialize(built.nodes, built.edges, RECOMMENDED, undefined, undefined, 2, COFFEE_ROASTERY_FRAMES)),
    )
  })

  it('carries the recommended run (no canvasLocked — opens editable, §CR2.1)', () => {
    const rrc = (fixtureDoc as { recommendedRunConfig?: Record<string, unknown> })
      .recommendedRunConfig
    expect(rrc).toEqual(RECOMMENDED)
    expect(rrc && 'canvasLocked' in rrc).toBe(false)
  })

  it('ships the three zone frames — non-overlapping, 18 nodes each in exactly one frame ≥24px, 5 params outside (§CR17)', () => {
    type R = { x: number; y: number; w: number; h: number }
    const frames = (fixtureDoc as { frames?: { id: string; label: string; rect: R }[] }).frames
    expect(frames).toEqual(COFFEE_ROASTERY_FRAMES)

    const box = (r: R) => ({ l: r.x, r: r.x + r.w, t: r.y, b: r.y + r.h })
    const overlap = (
      a: { l: number; r: number; t: number; b: number },
      b: { l: number; r: number; t: number; b: number },
    ) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t)

    for (const f of frames!) {
      expect(f.rect.w).toBeGreaterThan(0)
      expect(f.rect.h).toBeGreaterThan(0)
    }
    // zero overlap between the three frame boxes
    expect(overlap(box(frames![0].rect), box(frames![1].rect))).toBe(false)
    expect(overlap(box(frames![1].rect), box(frames![2].rect))).toBe(false)
    expect(overlap(box(frames![0].rect), box(frames![2].rect))).toBe(false)

    // rendered node box SIZES `[maxW, maxH]` — the UNION of what the node renders
    // at in EN / KO / JA (Coffee nodes auto-size to their label; heights
    // re-measured 2026-09-09 after the node-shell fix
    // (docs/node-shell-content-in-vessel.md) — a Register / Parameter now sizes
    // to its true content height so the whole stack sits inside the drawn
    // vessel). The e2e (coffee-zone-frames.spec.ts) re-measures the live boxes
    // per locale and fails if any drifts past these.
    const NODE_WH: Record<string, [number, number]> = {
      green_delivery: [186.3, 64], dessert_prep_src: [168, 64], green_stock: [159.1, 74],
      green_wholesale: [164.8, 64], dessert_stock: [134.2, 64],
      roasting: [207.2, 64], roast_loss: [189.2, 64], dessert_sales: [146.6, 64],
      dessert_wrapup: [182.3, 64], roasted_stock: [172.9, 64], cafe_retail: [191, 72],
      online_sales: [191, 72], roasted_bleed: [191, 88],
      projected_revenue: [260, 102], planned_cost: [260, 86], projected_operating_margin: [248, 102],
      roasted_supply_margin: [260, 102], dessert_prep_margin: [181, 102],
    }
    const PARAM_WH: [number, number] = [181, 86] // widest / tallest Parameter render

    const MARGIN = 24
    const nonParams = nodes.filter((n) => n.data.kind !== 'parameter')
    expect(nonParams).toHaveLength(18)
    for (const n of nonParams) {
      const wh = NODE_WH[n.id]
      expect(wh, `no measured box for ${n.id}`).toBeDefined()
      const nb = { l: n.position.x, r: n.position.x + wh[0], t: n.position.y, b: n.position.y + wh[1] }
      const inside = frames!.filter((f) => {
        const fb = box(f.rect)
        return (
          nb.l >= fb.l + MARGIN && nb.r <= fb.r - MARGIN && nb.t >= fb.t + MARGIN && nb.b <= fb.b - MARGIN
        )
      })
      expect(inside.length, `${n.id} (${n.data.kind}) should sit in exactly one frame with ≥${MARGIN}px margin`).toBe(1)
    }

    // the FIVE Parameter nodes touch no frame box (they render up to 181×70)
    const params = nodes.filter((n) => n.data.kind === 'parameter')
    expect(params).toHaveLength(5)
    for (const p of params) {
      const pb = { l: p.position.x, r: p.position.x + PARAM_WH[0], t: p.position.y, b: p.position.y + PARAM_WH[1] }
      for (const f of frames!) {
        expect(overlap(pb, box(f.rect)), `${p.id} must not touch ${f.id}`).toBe(false)
      }
    }
  })

  it('the Timeline default (timelineSeries) is the curated 4-series story set, sorted (§CR7)', () => {
    const ts = (fixtureDoc as { recommendedRunConfig: { timelineSeries: string[] } })
      .recommendedRunConfig.timelineSeries
    // one profitability proxy + the three real stock trajectories
    expect(ts).toEqual([
      'dessert_stock',
      'green_stock',
      'projected_operating_margin',
      'roasted_stock',
    ])
    expect([...ts]).toEqual([...ts].sort()) // the store keeps timelineSeries sorted
    // revenue, cost and the two per-line signed margins are behind "+N more"
    for (const id of [
      'projected_revenue',
      'planned_cost',
      'roasted_supply_margin',
      'dessert_prep_margin',
    ])
      expect(ts).not.toContain(id)
    const ids = new Set(nodes.map((n) => n.id))
    for (const id of ts) expect(ids.has(id), id).toBe(true)
  })

  it('is ≤ 25 nodes (23 after rev 9), reads left → right, Registers sit in one clean column with no edges (§CR5)', () => {
    expect(nodes.length).toBe(23)
    expect(nodes.length).toBe(built.nodes.length)

    const params = nodes.filter((n) => n.data.kind === 'parameter')
    expect(params).toHaveLength(5)
    // the five levers on one row along the top, strictly left → right
    const py = params.map((n) => n.position.y)
    expect(Math.max(...py) - Math.min(...py)).toBe(0)
    const sortedByX = [...params].sort((a, b) => a.position.x - b.position.x)
    for (let i = 1; i < sortedByX.length; i++) {
      expect(sortedByX[i].position.x).toBeGreaterThan(sortedByX[i - 1].position.x)
    }

    // Registers: no ports, so nothing wires to them; one column past every
    // other node.
    const regIds = new Set(nodes.filter((n) => n.data.kind === 'register').map((n) => n.id))
    expect(regIds.size).toBe(5)
    expect(edges.filter((e) => regIds.has(e.source) || regIds.has(e.target))).toEqual([])
    const regs = nodes.filter((n) => regIds.has(n.id))
    expect(new Set(regs.map((r) => r.position.x)).size).toBe(1)
    const otherMaxX = Math.max(
      ...nodes.filter((n) => !regIds.has(n.id)).map((n) => n.position.x),
    )
    expect(regs.every((r) => r.position.x > otherMaxX)).toBe(true)
  })

  const LEVERS = [
    'cafe_retail_demand_kg',
    'daily_roast_kg',
    'online_orders',
    'green_wholesale_kg',
    'dessert_prep',
  ]

  it('each of the five levers is exactly one resource-edge flow `@<id>`, and nothing else (§CR6.1)', () => {
    for (const id of LEVERS) {
      expect(byId.get(id)?.data.kind).toBe('parameter')
      const refs = edges.filter(
        (e) => e.data?.kind === 'resource' && (e.data.flow ?? '').trim() === `@${id}`,
      )
      expect(refs, `${id} should be referenced by exactly one edge flow`).toHaveLength(1)
    }
    // no OTHER edge flow carries an `@` reference
    const atFlows = edges.filter(
      (e) => e.data?.kind === 'resource' && (e.data.flow ?? '').trim().startsWith('@'),
    )
    expect(atFlows).toHaveLength(5)
    for (const e of atFlows) {
      expect(LEVERS).toContain((e.data as { flow: string }).flow.trim().slice(1))
    }
  })

  it('every lever sits on an edge the engine reads as a rate — a Pool, not just a Register (rev 9)', () => {
    // rev 9: no lever may drive only Register formulas. Each `@lever` edge must
    // pull from / push into a Pool via a flow-router node (Source / Gate / Drain).
    const flowKinds = new Set(['source', 'gate', 'drain'])
    for (const id of LEVERS) {
      const e = edges.find(
        (x) => x.data?.kind === 'resource' && (x.data.flow ?? '').trim() === `@${id}`,
      )!
      const src = byId.get(e.source)!.data.kind
      const tgt = byId.get(e.target)!.data.kind
      // one endpoint is a Pool, the other a flow-router that meters the rate
      const touchesPool = src === 'pool' || tgt === 'pool'
      const touchesRouter = flowKinds.has(src) || flowKinds.has(tgt)
      expect(touchesPool && touchesRouter, `${id}: ${e.source}(${src}) → ${e.target}(${tgt})`).toBe(true)
    }
  })

  it('the three money Registers are named as PLANNING PROXIES, not realised figures (rev 9 / §CR3.5)', () => {
    const label = (id: string) => (byId.get(id)!.data as { label: string }).label
    expect(label('projected_revenue')).toMatch(/Projected/)
    expect(label('planned_cost')).toMatch(/Planned/)
    expect(label('projected_operating_margin')).toMatch(/Projected/)
    // never presented as actual / realised revenue or profit
    for (const id of ['projected_revenue', 'planned_cost', 'projected_operating_margin']) {
      expect(label(id).toLowerCase()).not.toMatch(/\bactual\b|\brealis|revenue earned|profit\b/)
    }
  })

  it('the three money proxies carry a `kKRW/day` unit and evaluate to 464 / 346.8 / 117.2 at the defaults (rev 10)', () => {
    // `unit` is an advisory display hint only — it does not change the value or
    // make the proxy a realised / accounting figure (§CR3.5 / §CR8).
    for (const id of ['projected_revenue', 'planned_cost', 'projected_operating_margin']) {
      expect((byId.get(id)!.data as { unit?: string }).unit).toBe('kKRW/day')
    }
    // the two signed stock proxies stay unitless (kg / dessert-unit space)
    for (const id of ['roasted_supply_margin', 'dessert_prep_margin']) {
      expect((byId.get(id)!.data as { unit?: string }).unit).toBeUndefined()
    }
    const base = runWith({})
    expect(base.reg('projected_revenue')).toBeCloseTo(464, 6)
    expect(base.reg('planned_cost')).toBeCloseTo(346.8, 6)
    expect(base.reg('projected_operating_margin')).toBeCloseTo(117.2, 6)
  })

  it('roasting is a deterministic Gate — one `@daily_roast_kg` input, a fixed 82:18 split (§CR6.1 rev 8)', () => {
    const g = byId.get('roasting')!
    expect(g.data.kind).toBe('gate')
    expect((g.data as { distribution: string }).distribution).toBe('deterministic')

    const ins = edges.filter((e) => e.target === 'roasting' && e.data?.kind === 'resource')
    expect(ins).toHaveLength(1)
    expect(ins[0].source).toBe('green_stock')
    expect((ins[0].data as { flow: string }).flow.trim()).toBe('@daily_roast_kg')

    const outs = edges.filter((e) => e.source === 'roasting' && e.data?.kind === 'resource')
    const byTarget = Object.fromEntries(
      outs.map((e) => [e.target, Number((e.data as { flow: string }).flow)]),
    )
    expect(byTarget.roasted_stock).toBe(P.roastYieldPct)
    expect(byTarget.roast_loss).toBe(P.roastLossPct)
    expect(byId.get('roast_loss')?.data.kind).toBe('drain')
  })

  it('the roasting Gate conserves mass — green pulled = roasted produced + weight loss', () => {
    let st = initSim(nodes)
    let greenIntoRoasting = 0
    let roastedOut = 0
    let lossOut = 0
    for (let t = 1; t <= 12; t++) {
      const r = step(nodes, edges, st, 1, MV)
      st = r.state
      for (const ev of r.report.events) {
        if (ev.to === 'roasting') greenIntoRoasting += ev.amount
        if (ev.from === 'roasting' && ev.to === 'roasted_stock') roastedOut += ev.amount
        if (ev.from === 'roasting' && ev.to === 'roast_loss') lossOut += ev.amount
      }
    }
    expect(greenIntoRoasting).toBeGreaterThan(0)
    expect(roastedOut + lossOut).toBeCloseTo(greenIntoRoasting, 6)
    // and the split really is 82 : 18
    expect(roastedOut / (roastedOut + lossOut)).toBeCloseTo(0.82, 6)
  })

  it('no label anywhere says "waste" / "폐기" / "missed" / "lost" (§CR3.5)', () => {
    for (const n of built.nodes) {
      const label = (n.data as { label?: string }).label ?? ''
      expect(label.toLowerCase()).not.toMatch(/waste|missed|lost sale/)
      expect(label).not.toMatch(/폐기/)
    }
  })

  it('every Register is loop-expr/1 (+ - * / and @id) and evaluates finite at step 0 — no `/0`, no invalid', () => {
    const idSet = new Set(nodes.map((n) => n.id))
    for (const r of nodes.filter((n) => n.data.kind === 'register')) {
      const expr = (r.data as { expr: string }).expr
      expect(expr).not.toMatch(/floor|min|max|abs|round|\?|<|>|%/)
      for (const ref of expr.match(/@[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
        expect(idSet.has(ref.slice(1)), `${expr} → ${ref}`).toBe(true)
      }
    }
    const st0 = initSim(nodes)
    const out = registersOfSnapshot(nodes, st0.values)
    for (const r of nodes.filter((n) => n.data.kind === 'register')) {
      const o = out.get(r.id)
      expect(o, r.id).toBeDefined()
      expect(o!.invalid, `${r.id} invalid at step 0`).toBe(false)
    }
  })

  it('runs clean over a 30-day playthrough — no engine diagnostics', () => {
    let st = initSim(nodes)
    const seen = new Set<string>()
    for (let t = 1; t <= P.steps && !st.ended; t++) {
      const r = step(nodes, edges, st, 1, MV)
      st = r.state
      for (const d of r.report.diagnostics) seen.add(d)
    }
    expect([...seen]).toEqual([])
  })

  it('is deterministic — the same run reproduces an identical trajectory', () => {
    const trace = () => {
      let st = initSim(nodes)
      const rows: number[][] = []
      for (let t = 1; t <= P.steps; t++) {
        st = step(nodes, edges, st, 1, MV).state
        rows.push(nodes.filter((n) => n.data.kind === 'pool').map((n) => st.values[n.id] ?? 0))
      }
      return JSON.stringify(rows)
    }
    expect(trace()).toBe(trace())
  })

  describe('§CR9.1 — each lever change moves a real Pool trajectory in the stated direction', () => {
    const base = runWith({})

    it('1. cafe / retail demand up (`cafe_retail_demand_kg` ↑): roasted-stock trajectory ↓, roasted supply margin → negative', () => {
      const more = runWith({ cafe_retail_demand_kg: 16 })
      expect(more.pools.roasted_stock).toBeLessThan(base.pools.roasted_stock)
      expect(more.reg('roasted_supply_margin')).toBeLessThan(base.reg('roasted_supply_margin'))
      expect(more.reg('roasted_supply_margin')).toBeLessThan(0)
    })

    it('2. roast amount too low (`daily_roast_kg` ↓): roasted-stock ↓, roasted supply margin → negative', () => {
      const low = runWith({ daily_roast_kg: 14 })
      expect(low.pools.roasted_stock).toBeLessThan(base.pools.roasted_stock)
      expect(low.reg('roasted_supply_margin')).toBeLessThan(base.reg('roasted_supply_margin'))
      expect(low.reg('roasted_supply_margin')).toBeLessThan(0)
    })

    it('3. more green wholesale (`green_wholesale_kg` ↑): green stock ↓, the roaster is starved → roasted stock ↓; projected revenue ↑ (plan only)', () => {
      const more = runWith({ green_wholesale_kg: 18 })
      expect(more.pools.green_stock).toBeLessThan(base.pools.green_stock)
      expect(more.pools.roasted_stock).toBeLessThan(base.pools.roasted_stock)
      // projected_revenue is a PLANNING proxy — it rises with the order lever
      // even though roasted stock (above) shows the plan is not fulfillable.
      expect(more.reg('projected_revenue')).toBeGreaterThan(base.reg('projected_revenue'))
    })

    it('4. dessert prep above demand (`dessert_prep` ↑): dessert stock ↑, dessert prep margin more positive, planned cost ↑', () => {
      const more = runWith({ dessert_prep: 34 })
      expect(more.pools.dessert_stock).toBeGreaterThan(base.pools.dessert_stock)
      expect(more.reg('dessert_prep_margin')).toBeGreaterThan(base.reg('dessert_prep_margin'))
      expect(more.reg('planned_cost')).toBeGreaterThan(base.reg('planned_cost'))
    })

    it('5. more online orders (`online_orders` ↑): roasted stock ↓, roasted supply margin → negative; projected revenue / margin ↑ (plan only)', () => {
      const more = runWith({ online_orders: 22 })
      expect(more.pools.roasted_stock).toBeLessThan(base.pools.roasted_stock)
      expect(more.reg('roasted_supply_margin')).toBeLessThan(base.reg('roasted_supply_margin'))
      // planning proxies — projected, not realised (roasted stock above shows
      // the shortfall the projected figures do not net out).
      expect(more.reg('projected_revenue')).toBeGreaterThan(base.reg('projected_revenue'))
      expect(more.reg('projected_operating_margin')).toBeGreaterThan(
        base.reg('projected_operating_margin'),
      )
    })

    it('6. roast amount at a sensible level (the default): roasted supply margin sits nearer zero than the too-low / too-high cases', () => {
      const low = Math.abs(runWith({ daily_roast_kg: 14 }).reg('roasted_supply_margin'))
      const tuned = Math.abs(base.reg('roasted_supply_margin')) // the shipped default IS the sensible point
      const high = Math.abs(runWith({ daily_roast_kg: 42 }).reg('roasted_supply_margin'))
      expect(tuned).toBeLessThan(low)
      expect(tuned).toBeLessThan(high)
      expect(tuned).toBeLessThan(5) // and it really is near zero
    })
  })
})
