import { defaultData } from '../model/factory'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'

// Builder for examples/coffee-roastery.json — the "Coffee roastery operations
// flow" Templates demo (docs/example-coffee-roastery.md, settled design,
// non-frozen). The FIRST bundled Template that declares model-semantics v2:
// its serialized `schema` is `loop-studio/graph/2` and its five surfaced levers
// are `resource`-edge `flow` parameter references (`@<id>`, loop-model/2) the
// engine resolves once per step.
//
// This is a PRODUCT DEMO, not a value oracle: coffee-roastery.test.ts pins
// structural invariants (23 nodes, one `@param` edge per lever, mass-conserving
// roasting split) and the §CR9.1 scenario *directions* — a deterministic run
// before / after each single `@param` change — never specific numbers.
//
// ── every lever moves a real stock trajectory (rev 9) ──────────────────────
// The five `@param` references sit on edges that the engine actually reads as a
// rate, so changing any one of them moves a Pool trajectory, not just a Register
// readout:
//   cafe_retail_demand_kg — Drain pull off roasted-bean stock  (§CR6.1 #1)
//   daily_roast_kg        — deterministic-Gate pull off green   (§CR6.1 #2)
//   online_orders         — Drain pull off roasted-bean stock   (§CR6.1 #3)
//   green_wholesale_kg    — Drain pull off green-bean stock     (§CR6.1 #4)
//   dessert_prep          — Source push into the dessert pool   (§CR6.1 #5)
// rev 9 replaced the old `daily_customers` footfall lever — it drove only a
// cumulative-tally Pool and the Register formulas, never the roasted-stock
// trajectory (a "Register numbers move only" pseudo-link, exactly what §CR16.2
// rules out). It is now `cafe_retail_demand_kg`, wired straight onto the
// `roasted_stock → cafe_retail` edge, and the disconnected footfall Source +
// tally Pool are gone (25 → 23 nodes).
//
// ── the roasting node: a deterministic Gate, not a Converter (§CR6.1 rev 8) ──
// "Daily roast amount (kg)" is *how much green goes to roast per day*. Under
// frozen Engine A a Converter's output is `f·outRate` with `f ∈ [0, 1]` and
// ≤ 1 activation/step (SEMANTICS.md I2), so a Converter whose input edge is
// `@daily_roast_kg` produces at most its constant `outRate` — the lever stops
// mattering once green is not the binding constraint, and moves the output
// *backwards* when it is. A deterministic Gate expresses the quantity exactly:
// the ONE input edge `green_stock → roasting` carries `@daily_roast_kg`, the
// Gate pulls `T = min(@daily_roast_kg, green available)`, and two fixed weights
// split T into 82 % roasted-bean stock and 18 % roasting weight loss (moisture /
// chaff — a real process drain, never "waste"). Mass is conserved
// (`0.82·T + 0.18·T = T`). `green_wholesale` sorts before `roasting`, so on a
// short-green day the wholesale contract is filled first and the roaster is
// genuinely starved (§CR9.1 #2).
//
// ── the Summary — five Registers (loop-expr/1: + - * / and @id only) ────────
// Two signed PROXIES (§CR3.5) — `roasted supply margin` (reads the live
// roasted-stock level) and `dessert prep margin`. THREE PLANNING PROXIES —
// `projected revenue` / `planned cost` / `projected operating margin` are
// computed from the *ordered / planned* levers assuming every unit of demand is
// met; they are NOT realised revenue, cost, or accounting operating profit, and
// must never be shown as such in a Register title, node label, blurb, Timeline
// series, or §CR9 scenario. When roasted stock runs short the projected-revenue
// line still rises with the order lever — the shortfall shows up in the
// roasted-stock trajectory and the roasted-supply-margin proxy going negative.

// ── tunable parameters (own invented numbers, one consistent unit: kg) ──────
// Tuned so a 30-day run holds every Register finite from step 0, keeps green and
// roasted stock positive at the defaults, and lets each §CR9.1 change move the
// trajectory in the stated direction.
export const P = {
  steps: 30,

  // the five surfaced levers — their DEFAULT values (the reviewer changes these)
  cafeRetailDemandKg: 6, // kg of roasted beans the cafe + retail counter sell per day
  dailyRoastKg: 26, // kg of green beans put to roast per day
  onlineOrders: 10, // kg of roasted beans leaving to online sales per day
  greenWholesaleKg: 6, // kg of green beans sold on to other businesses per day
  dessertPrep: 22, // dessert units prepared per day

  // fixed operating structure
  greenDeliveryKg: 34, // kg of green beans delivered per day (constant contract)
  greenStart: 90, // opening green-bean stock (kg)
  greenCap: 130, // green-store capacity — the delivery Source back-pressures here
  roastedStart: 30, // opening roasted-bean stock (kg)
  roastYieldPct: 82, // Gate weight → roasted-bean stock
  roastLossPct: 18, // Gate weight → roasting weight loss (moisture / chaff)
  roastedBleedPct: 14, // % of roasted stock to staff / cupping / sampling per day
  dessertSales: 16, // dessert units the day's demand absorbs
  dessertWrapPct: 55, // % of the day's leftover dessert that does not carry over

  // prices / unit costs — PLANNING constants, read only by the proxy Registers
  cafeRetailPricePerKg: 30,
  onlineRevenuePerKg: 17,
  wholesaleRevenuePerKg: 9,
  greenCostPerKg: 5.5,
  dessertCostPerUnit: 1.4,
  fixedDailyOther: 60, // misc. planned daily revenue not tied to a lever
  fixedDailyCost: 140, // rent / staff / utilities baseline per day
  roastedCoverDays: 2.35, // roasted-supply-margin buffer = this many days of demand
}

export type CoffeeParams = typeof P

// ── tiny builders ─────────────────────────────────────────────────────────
type XY = { x: number; y: number }

const mkNode = (
  kind: NodeKind,
  id: string,
  label: string,
  at: XY,
  extra: Record<string, unknown> = {},
): LoopNode => ({
  id,
  type: kind,
  position: at,
  data: { ...defaultData(kind), label, ...extra } as LoopNode['data'],
})

const param = (id: string, label: string, at: XY, value: number) =>
  mkNode('parameter', id, label, at, { value })

const pool = (
  id: string,
  label: string,
  at: XY,
  opts: { initial?: number; capacity?: number | null } = {},
) => mkNode('pool', id, label, at, { initial: opts.initial ?? 0, capacity: opts.capacity ?? null })

// `unit` is an advisory display hint (loop-model/2 §M2): it renders as the
// Register node's sub-line and carries no locale, so the three money proxies
// below share one canonical `kKRW/day` string (thousand-won per day — the price
// constants in `P` are in thousands of KRW). It does NOT make the proxy a
// realised or accounting figure.
const reg = (id: string, label: string, expr: string, at: XY, unit?: string) =>
  mkNode('register', id, label, at, unit ? { expr, unit } : { expr })

const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow },
})

const num = (n: number) => String(n)

// ── the graph ─────────────────────────────────────────────────────────────
export function buildCoffeeRoastery(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes: LoopNode[] = []
  const edges: LoopEdge[] = []
  const N = (n: LoopNode) => (nodes.push(n), n)
  const E = (e: LoopEdge) => (edges.push(e), e)

  // ── the five surfaced levers — one clear row along the top (§CR6) ──────────
  N(param('cafe_retail_demand_kg', 'Cafe & retail bean demand (kg/day)', { x: 40, y: 0 }, P.cafeRetailDemandKg))
  N(param('daily_roast_kg', 'Daily roast amount (kg)', { x: 320, y: 0 }, P.dailyRoastKg))
  N(param('online_orders', 'Online bean orders (kg/day)', { x: 600, y: 0 }, P.onlineOrders))
  N(param('green_wholesale_kg', 'Green wholesale orders (kg)', { x: 880, y: 0 }, P.greenWholesaleKg))
  N(param('dessert_prep', 'Daily dessert prep', { x: 1160, y: 0 }, P.dessertPrep))

  // ── green side: delivery → green stock, split between wholesale and roasting ─
  N(mkNode('source', 'green_delivery', 'Green bean delivery', { x: 40, y: 200 }))
  N(
    pool('green_stock', 'Green bean stock', { x: 300, y: 200 }, {
      initial: P.greenStart,
      capacity: P.greenCap,
    }),
  )
  E(res('e_green_in', 'green_delivery', 'green_stock', num(P.greenDeliveryKg)))

  // green wholesale — a Drain metered by lever #4 (§CR6.1 #4). Its id sorts
  // before `roasting`, so on a short-green day the wholesale contract is filled
  // first and the roaster takes what is left — the two genuinely compete for the
  // SAME green pool (§CR9.1 #2).
  N(mkNode('drain', 'green_wholesale', 'Green wholesale', { x: 300, y: 360 }))
  E(res('e_green_wholesale', 'green_stock', 'green_wholesale', '@green_wholesale_kg'))

  // roasting — a deterministic Gate metered by lever #2 (§CR6.1 #2). ONE input
  // edge carries `@daily_roast_kg`; two fixed weights conserve mass 82 : 18.
  N(
    mkNode('gate', 'roasting', 'Roasting · 82% yield', { x: 540, y: 200 }, {
      distribution: 'deterministic',
    }),
  )
  N(pool('roasted_stock', 'Roasted bean stock', { x: 780, y: 200 }, { initial: P.roastedStart }))
  N(mkNode('drain', 'roast_loss', 'Roasting weight loss', { x: 540, y: 360 }))
  E(res('e_green_roast', 'green_stock', 'roasting', '@daily_roast_kg'))
  E(res('e_roast_yield', 'roasting', 'roasted_stock', num(P.roastYieldPct)))
  E(res('e_roast_loss', 'roasting', 'roast_loss', num(P.roastLossPct)))

  // ── roasted-bean sales ────────────────────────────────────────────────────
  // online bagged beans — a Drain metered by lever #3 (§CR6.1 #3)
  N(mkNode('drain', 'online_sales', 'Online bagged-bean sales', { x: 1020, y: 160 }))
  E(res('e_online', 'roasted_stock', 'online_sales', '@online_orders'))
  // cafe drinks + retail bags — a Drain metered by lever #1 (§CR6.1 #1). This is
  // the demand the cafe counter + retail shelf actually pull off roasted stock
  // each day, so raising it draws roasted stock down (§CR9.1 #1).
  N(mkNode('drain', 'cafe_retail', 'Cafe & retail bean use', { x: 780, y: 360 }))
  E(res('e_cafe_retail', 'roasted_stock', 'cafe_retail', '@cafe_retail_demand_kg'))
  // staff coffee / cupping / sampling — a small draw that scales with what is on
  // the shelf, so roasted stock settles to a level instead of running away.
  N(mkNode('drain', 'roasted_bleed', 'Staff, cupping & sampling', { x: 1020, y: 300 }))
  E(res('e_roasted_bleed', 'roasted_stock', 'roasted_bleed', `${num(P.roastedBleedPct)}%`))

  // ── dessert: lever #5 preps into the dessert pool; sales are demand-bounded,
  // most of the day's leftover does not carry over (§CR3.4). ────────────────
  N(mkNode('source', 'dessert_prep_src', 'Dessert prep', { x: 40, y: 520 }))
  N(pool('dessert_stock', 'Dessert stock', { x: 300, y: 520 }))
  N(mkNode('drain', 'dessert_sales', 'Dessert sales', { x: 540, y: 520 }))
  N(mkNode('drain', 'dessert_wrapup', 'End-of-day leftover', { x: 540, y: 660 }))
  E(res('e_dessert_in', 'dessert_prep_src', 'dessert_stock', '@dessert_prep'))
  E(res('e_dessert_sales', 'dessert_stock', 'dessert_sales', num(P.dessertSales)))
  // `dessert_sales` sorts before `dessert_wrapup` (id order), so the day's
  // demand is taken first and the wrap-up takes a % of what is left.
  E(res('e_dessert_wrap', 'dessert_stock', 'dessert_wrapup', `${P.dessertWrapPct}%`))

  // ── Summary — five Registers (loop-expr/1), one clean column, no ports ─────
  const rx = 1320
  // PLANNING PROXY — projected on the ordered / planned levers, assumes all
  // demand is met. NOT realised revenue (§CR3.5 / §CR8).
  N(
    reg(
      'projected_revenue',
      'Projected daily revenue',
      `@cafe_retail_demand_kg * ${num(P.cafeRetailPricePerKg)} + @online_orders * ${num(
        P.onlineRevenuePerKg,
      )} + @green_wholesale_kg * ${num(P.wholesaleRevenuePerKg)} + ${num(P.fixedDailyOther)}`,
      { x: rx, y: 0 },
      'kKRW/day',
    ),
  )
  // PLANNING PROXY — the planned daily spend at the current levers. NOT a
  // realised or accounting cost figure.
  N(
    reg(
      'planned_cost',
      'Planned daily cost',
      `(@daily_roast_kg + @green_wholesale_kg) * ${num(P.greenCostPerKg)} + @dessert_prep * ${num(
        P.dessertCostPerUnit,
      )} + ${num(P.fixedDailyCost)}`,
      { x: rx, y: 120 },
      'kKRW/day',
    ),
  )
  // PLANNING PROXY — projected revenue minus planned cost. NOT accounting
  // operating profit; a shortfall in fulfilment does not reduce it.
  N(
    reg(
      'projected_operating_margin',
      'Projected daily operating margin',
      '@projected_revenue - @planned_cost',
      { x: rx, y: 240 },
      'kKRW/day',
    ),
  )
  // signed PROXY — reads the LIVE roasted-stock level against a demand buffer.
  // `+` = comfortable cover · `−` = below the buffer / running short (§CR3.5).
  N(
    reg(
      'roasted_supply_margin',
      'Roasted supply margin',
      `@roasted_stock - (@cafe_retail_demand_kg + @online_orders) * ${num(P.roastedCoverDays)}`,
      { x: rx, y: 360 },
    ),
  )
  // signed PROXY — `+` = prepared more than the day sold (leftover) · `−` = demand
  // outran prep (sold out) (§CR3.5).
  N(
    reg(
      'dessert_prep_margin',
      'Dessert prep margin',
      `@dessert_prep - ${num(P.dessertSales)}`,
      { x: rx, y: 480 },
    ),
  )

  return { nodes, edges }
}

// ── the recommended run saved into the file ────────────────────────────────
export const COFFEE_ROASTERY_MC = {
  baseSeed: 1,
  runs: 200,
  steps: P.steps,
  tracked: ['green_stock', 'roasted_stock', 'dessert_stock'],
  // the Timeline's default visible set (Pool + Register ids, sorted) — the two
  // headline inventories, the dessert pool, the two signed-proxy margins, and
  // the three planning-proxy money lines.
  timelineSeries: [
    'dessert_prep_margin',
    'dessert_stock',
    'green_stock',
    'planned_cost',
    'projected_operating_margin',
    'projected_revenue',
    'roasted_stock',
    'roasted_supply_margin',
  ],
  // opens EDITABLE (§CR2.1) — the reviewer is meant to change the five levers,
  // so there is deliberately no `canvasLocked`.
}
