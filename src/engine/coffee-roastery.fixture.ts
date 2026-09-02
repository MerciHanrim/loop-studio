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
// structural invariants (25 nodes, one `@param` edge per lever, mass-conserving
// roasting split) and the §CR9.1 scenario *directions* — a deterministic run
// before / after each single `@param` change — never specific numbers.
//
// ── the roasting node: a deterministic Gate, not a Converter (§CR6.1 rev 8) ──
// "Daily roast amount (kg)" is *how much green goes to roast per day*. Under
// frozen Engine A a Converter cannot carry that: I2 fixes `producedₖ = f·outRateₖ`
// with a single `f ∈ [0, 1]` and ≤ 1 activation/step, so a Converter whose input
// edge is `@daily_roast_kg` produces at most its constant `outRate` — the lever
// stops mattering the moment green is not the binding constraint, and moves the
// output *backwards* when it is. A deterministic Gate expresses the quantity
// exactly: the ONE input edge `green_stock → roasting` carries `@daily_roast_kg`
// (the day's roast intake), the Gate pulls `T = min(@daily_roast_kg, green
// available)`, and two fixed weights split T into 82 % roasted-bean stock and
// 18 % roasting weight loss. Raising / lowering the lever raises / lowers the
// roasted inflow directly; when green stock is short, T — and therefore BOTH
// the roasted output and the weight-loss path — fall together. Mass is
// conserved (T kg green in, 0.82·T + 0.18·T out). The weight loss is a real
// process drain (moisture / chaff), never labelled "waste".
//
// The Gate carries an activator `roasted_stock < roastTarget`: a roastery roasts
// to keep the shelf stocked, so roasting pauses once roasted stock is at the
// target and `@daily_roast_kg` sets the batch size on the days it does run. This
// bounds roasted stock and makes the "roasted supply margin" proxy meaningful —
// it reads how far the live roasted-stock level sits above / below the day's
// demand buffer. `green_wholesale` sorts before `roasting` (id order), so on a
// short-green day wholesale contracts are filled first and roasting takes what
// is left — raising `green_wholesale_kg` genuinely starves the roaster (§CR9.1 #2).
//
// ── the other four levers ──
//   daily_customers    — Source push amount into the cafe-demand pool (§CR6.1 #1)
//   online_orders      — Drain pull amount off roasted-bean stock       (§CR6.1 #3)
//   green_wholesale_kg — Drain pull amount off green-bean stock         (§CR6.1 #4)
//   dessert_prep       — Source push amount into the dessert-stock pool (§CR6.1 #5)
// green_wholesale_kg and daily_roast_kg both draw the SAME green-bean pool, so
// wholesale genuinely competes with roasting for green beans (§CR9.1 #2) — there
// is deliberately no second green pool.
//
// ── the Summary (five Registers, loop-expr/1: + - * / and @id only) ──
// Four are formulas over the five Parameters + fixed prices / costs; one reads
// the live roasted-stock level. The two "… margin" read-outs are SIGNED PROXIES
// (docs/example-coffee-roastery.md §CR3.5) — `+` slack / leftover, `−` short /
// sold out — never "missed sales" or "waste".

// ── tunable parameters (own invented numbers, one consistent unit: kg) ──────
// Tuned so a 30-day run holds every Register finite from step 0, keeps green and
// roasted stock positive at the defaults, and lets each §CR9.1 change move the
// trajectory in the stated direction.
export const P = {
  steps: 30,

  // the five surfaced levers — their DEFAULT values (the reviewer changes these)
  dailyCustomers: 90, // cafe drink demand per day
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
  cafeRetailKg: 6, // steady cafe-drink + retail-bag bean use per day (kg)
  roastedBleedPct: 14, // % of roasted stock to staff / cupping / sampling per day
  dessertSales: 16, // dessert units the day's demand absorbs
  dessertWrapPct: 55, // % of the day's leftover dessert that does not carry over

  // prices / unit costs — literal constants, read only by the Summary Registers
  cafeRevenuePerCustomer: 4.6, // cafe drink + attached retail, per customer
  onlineRevenuePerKg: 17,
  wholesaleRevenuePerKg: 9,
  greenCostPerKg: 5.5,
  dessertCostPerUnit: 1.4,
  fixedDailyOther: 60, // misc. daily revenue not tied to a lever
  fixedDailyCost: 140, // rent / staff / utilities baseline per day
  roastedCoverDays: 2.1, // roasted-supply-margin buffer = this many days of demand
  cafeKgPerCustomer: 0.09, // kg of roasted beans per cafe customer (margin demand term)
  dessertAttachPerCustomer: 0.14, // dessert units demanded per customer
  dessertBaseDemand: 5,
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

const reg = (id: string, label: string, expr: string, at: XY) =>
  mkNode('register', id, label, at, { expr })

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
  N(param('daily_customers', 'Daily customers', { x: 40, y: 0 }, P.dailyCustomers))
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
  // cafe drinks + retail bags — a steady daily draw (not a surfaced lever)
  N(mkNode('drain', 'cafe_retail', 'Cafe & retail bean use', { x: 780, y: 360 }))
  E(res('e_cafe_retail', 'roasted_stock', 'cafe_retail', num(P.cafeRetailKg)))
  // staff coffee / cupping / sampling — a small draw that scales with what is on
  // the shelf, so roasted stock settles to a level instead of running away.
  N(mkNode('drain', 'roasted_bleed', 'Staff, cupping & sampling', { x: 1020, y: 300 }))
  E(res('e_roasted_bleed', 'roasted_stock', 'roasted_bleed', `${num(P.roastedBleedPct)}%`))

  // ── cafe footfall: lever #1 pushes demand into the cafe-demand pool (§CR6.1 #1)
  // The pool is a running footfall tally — raising `daily_customers` steepens it.
  N(mkNode('source', 'cafe_footfall', 'Cafe footfall', { x: 40, y: 470 }))
  N(pool('cafe_demand', 'Customers to date', { x: 300, y: 470 }))
  E(res('e_footfall', 'cafe_footfall', 'cafe_demand', '@daily_customers'))

  // ── dessert: lever #5 preps into the dessert pool; sales are demand-bounded,
  // most of the day's leftover does not carry over (§CR3.4). ────────────────
  N(mkNode('source', 'dessert_prep_src', 'Dessert prep', { x: 40, y: 620 }))
  N(pool('dessert_stock', 'Dessert stock', { x: 300, y: 620 }))
  N(mkNode('drain', 'dessert_sales', 'Dessert sales', { x: 540, y: 620 }))
  N(mkNode('drain', 'dessert_wrapup', 'End-of-day leftover', { x: 540, y: 760 }))
  E(res('e_dessert_in', 'dessert_prep_src', 'dessert_stock', '@dessert_prep'))
  E(res('e_dessert_sales', 'dessert_stock', 'dessert_sales', num(P.dessertSales)))
  // `dessert_sales` sorts before `dessert_wrapup` (id order), so the day's
  // demand is taken first and the wrap-up takes a % of what is left.
  E(res('e_dessert_wrap', 'dessert_stock', 'dessert_wrapup', `${P.dessertWrapPct}%`))

  // ── Summary — five Registers (loop-expr/1), one clean column, no ports ─────
  const rx = 1320
  N(
    reg(
      'total_revenue',
      'Total revenue',
      `@daily_customers * ${num(P.cafeRevenuePerCustomer)} + @online_orders * ${num(
        P.onlineRevenuePerKg,
      )} + @green_wholesale_kg * ${num(P.wholesaleRevenuePerKg)} + ${num(P.fixedDailyOther)}`,
      { x: rx, y: 0 },
    ),
  )
  N(
    reg(
      'total_cost',
      'Total cost',
      `(@daily_roast_kg + @green_wholesale_kg) * ${num(P.greenCostPerKg)} + @dessert_prep * ${num(
        P.dessertCostPerUnit,
      )} + ${num(P.fixedDailyCost)}`,
      { x: rx, y: 120 },
    ),
  )
  N(reg('operating_profit', 'Operating profit', '@total_revenue - @total_cost', { x: rx, y: 240 }))
  // signed PROXY — reads the LIVE roasted-stock level against a demand buffer.
  // `+` = comfortable cover · `−` = below the buffer / running short (§CR3.5).
  N(
    reg(
      'roasted_supply_margin',
      'Roasted supply margin',
      `@roasted_stock - (@daily_customers * ${num(P.cafeKgPerCustomer)} + @online_orders) * ${num(
        P.roastedCoverDays,
      )}`,
      { x: rx, y: 360 },
    ),
  )
  // signed PROXY — `+` = prepared more than the day sold (leftover) · `−` = demand
  // outran prep (sold out) (§CR3.5).
  N(
    reg(
      'dessert_prep_margin',
      'Dessert prep margin',
      `@dessert_prep - (@daily_customers * ${num(P.dessertAttachPerCustomer)} + ${num(
        P.dessertBaseDemand,
      )})`,
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
  // headline inventories, the two signed-proxy margins, and the money line.
  timelineSeries: [
    'dessert_prep_margin',
    'dessert_stock',
    'green_stock',
    'operating_profit',
    'roasted_stock',
    'roasted_supply_margin',
    'total_cost',
    'total_revenue',
  ],
  // opens EDITABLE (§CR2.1) — the reviewer is meant to change the five levers,
  // so there is deliberately no `canvasLocked`.
}
