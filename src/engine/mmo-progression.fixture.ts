import { defaultData } from '../model/factory'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'

// Builder for examples/mmo-progression.json — the "Early MMO progression
// (levels 1–15)" Templates demo. Design: docs/example-mmo-progression.md
// (settled, non-frozen). This is a PRODUCT DEMO, not a value oracle: the smoke
// test in mmo-progression.test.ts pins structural invariants + the §EM10.1
// accounting identities + the reach-15 tuning window, never specific numbers.
//
// Laid out as a first-time READING PATH (docs/example-mmo-progression.md §EM13):
// a top spine — Character creation → Starter · Lv 1–5 → Foothills · Lv 5–10 →
// Highlands · Lv 10–15 → Reached level 15 — with each zone's detail directly
// below its landmark, the shared economy as a band across the middle-bottom, and
// the seven Registers in a corner block. Positions live in the LAYOUT table at
// the end of the builder. `Character creation` is an `onStart` Source that seeds
// `Active character`; a `>= 1` activator on the Starter encounters Source opens
// the first zone. The file also ships `recommendedRunConfig.timelineSeries` —
// the curated ~10-series Timeline default (the wide Monte-Carlo `tracked` list
// stays separate).
//
// Shape (one connected play economy):
//
//   three parallel ZONE LANES, exactly one live at a time (Level activators):
//     Starter  1–5   ·  Foothills 5–10  ·  Highlands 10–15
//   each lane:  Encounters Source → Encounter Pool → Combat Gate (probabilistic,
//               3 branches) → { Win amp Converter | shared Fail Pool | shared
//               Death Pool }; a Loot-roll Pool → Loot Gate (probabilistic drop);
//               an XP→Level Converter (rising xp_per_level); a Training drain.
//
//   shared economy (hub row + bottom bands — see the LAYOUT table):
//     Win amp → Reward Pool → Reward Router (deterministic hunt:quest) →
//       Hunt / Quest payout Converters → XP (+ XP earned), Gold (+ Gold earned),
//       Hunt XP / Quest XP counters.
//     Drop Pool → Loot dispatch (tee: Items looted + category feed) →
//       Loot category Gate (PROBABILISTIC — one drop, one category) → four
//       Converters → Items equipped / sold / consumed, Gear score, Gold
//       (+ Gold earned + Vendor revenue), Water/Food (+ bought).
//     Water/Food upkeep Converters → Water/Food consumed.
//     Resupply Converter (Gold → Water/Food + bought + Resupply spend), opened by
//       a `Water < restock` activator.
//     Repair: a wear-clearing Converter + a gold-metering Converter, both opened
//       by a `Gear wear > repair` activator.
//     Clock Source → Elapsed time (+ Fail/Death time penalties).
//     Completion Source → Completion Pool → End, opened by `Level ≥ 15`.
//     seven reporting Registers (loop-expr/1: + - * / and @id only).
//
// Structural notes (docs/example-mmo-progression.md §EM13):
//
//   • INTEGER Level. A `pullAll` pool-fed Converter that is under-supplied
//     consumes its partial input WITHOUT producing (SEMANTICS.md §6 / step.ts),
//     which would silently destroy XP. So the level-up is a `pull all`
//     deterministic METER GATE (pulls exactly `xp_per_level` from the XP Pool,
//     atomically — nothing when XP is short) feeding a Converter that turns that
//     fixed amount into exactly +1 Level. Level is a WHOLE NUMBER in a single
//     run; XP is never destroyed.
//   • REPAIR is two Converters (`Repair (wear)` clears Gear wear, `Repair (bill)`
//     meters the Gold) rather than one two-input Converter — a single Converter
//     couples one `f` across two inputs of unequal availability and can pay a
//     Repair bill with Gold it did not actually consume. Split, each is a
//     single-input metered Converter, so Gold conservation is exact.
//   • `Loot category` is PROBABILISTIC — one whole drop → exactly one category,
//     so item counts are integral in a single run (§EM13.6).
//   • `Hunt XP share` divides by `(@hunt_xp + @quest_xp + 0.001)` so R(t) is a
//     clean `0%` before the first reward, not a `/0` diagnostic on opening.
//   • `XP pace (starter-levels)` (id `r_efflevel`) is NOT a level estimate —
//     real Level is Converter-driven and piecewise, which an expression cannot
//     reproduce — it is total XP earned in first-zone level-costs.
//
// Every "how much total" quantity is a cumulative counter Pool a flow only adds
// to; every balance Pool that is both filled and drained (Gold / Water / Food)
// has paired `… earned|bought` / `… spent|consumed` counters fed the same
// amounts, so the §EM10.1 identities hold by construction:
//
//   start Gold  + Gold earned  = final Gold + Repair + Resupply + Training spend
//   start Water + Water bought  = final Water + Water consumed
//   start Food  + Food bought   = final Food  + Food consumed
//   Items looted = Items equipped + Items sold + Items consumed

// ── tunable parameters (own invented numbers — §EM9, no WoW values) ─────────
// Tuned to docs/example-mmo-progression.md §EM10: a run reaches Level 15 and
// ends `fired` with a median in [60, 120] steps and ≥ 95 % of a fixed
// verification-seed set inside 150 steps.
export const P = {
  timePerStep: 1,
  encountersPerStep: 1,

  // per zone lane [Starter, Foothills, Highlands]
  bandLo: [1, 5, 10] as const, // Level ≥  (lane opens)
  bandHi: [5, 10, null] as const, // Level <  (lane closes); Highlands runs to the End
  gearGate10: 4, // Highlands also needs Gear score ≥ this

  rewardPerWin: [1.15, 1.5, 2.0] as const, // units delivered to the Reward Pool per win
  wWin: [9, 7, 6.5] as const, // Combat Gate branch weights …
  wFail: [1.8, 2.5, 2.6] as const,
  wDeath: [0.5, 0.9, 1.2] as const,
  dropRate: [38, 38, 44] as const, // Loot Gate "drop" weight vs "no drop" = 100 − this
  xpPerLevel: [10, 19, 27] as const, // rising level cost per band
  trainingCost: [0.25, 0.45, 0.7] as const, // per-step Gold sink while in the band

  // reward router (deterministic) + payout converters
  huntW: 3,
  questW: 1,
  huntXp: 3,
  huntGold: 2,
  questXp: 9,
  questGold: 7,

  // loot category gate (probabilistic — one whole drop, one category) weights + effects
  equipW: 34,
  vendorW: 40,
  consumableW: 20,
  rareW: 6,
  gearGain: 4,
  vendorValue: 3,
  rareValue: 14,
  consumableBonus: 2,

  // consumables / upkeep
  goldStart: 10,
  waterStart: 12,
  foodStart: 12,
  waterPerStep: 1,
  foodPerStep: 1,
  restockThreshold: 5, // Water < this opens Resupply
  resupplyCost: 6, // Gold consumed per Resupply activation
  waterRestock: 8,
  foodRestock: 8,

  // repair
  repairThreshold: 6, // Gear wear > this opens Repair
  repairWearBatch: 4, // wear points cleared per activation
  repairGoldPerWear: 1, // Gold metered per wear point cleared
  wearPerFail: 1.5,
  wearPerDeath: 3,

  // time penalties
  failTimeCost: 1,
  deathTimePenalty: 3,
}

export type MmoParams = typeof P

// ── tiny builders ─────────────────────────────────────────────────────────
type XY = { x: number; y: number }

const mkNode = (
  kind: NodeKind,
  id: string,
  label: string,
  at: XY,
  extra: Record<string, unknown> = {},
): LoopNode => {
  const data = { ...defaultData(kind), label, ...extra } as LoopNode['data']
  return { id, type: kind, position: at, data }
}

const pool = (id: string, label: string, at: XY, opts: { initial?: number; capacity?: number | null; resourceType?: string } = {}) =>
  mkNode('pool', id, label, at, {
    initial: opts.initial ?? 0,
    capacity: opts.capacity ?? null,
    ...(opts.resourceType ? { resourceType: opts.resourceType } : {}),
  })

const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow },
})

// a long edge that leaves a zone column or crosses the economy — routed
// ORTHOGONALLY (loop-revision/3 `route`, cosmetic: changes nothing the engine
// computes) so it steps around nodes instead of sweeping a curve through them.
const resO = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow, route: 'orthogonal' },
})

const act = (id: string, source: string, target: string, expr: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'state-source',
  targetHandle: 'state-target',
  type: 'loop',
  data: { kind: 'state', mode: 'activator', expr },
})

const reg = (id: string, label: string, expr: string, at: XY, extra: Record<string, unknown> = {}) =>
  mkNode('register', id, label, at, { expr, ...extra })

const num = (n: number) => String(n)

// ── the graph ─────────────────────────────────────────────────────────────
export function buildMmoProgression(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes: LoopNode[] = []
  const edges: LoopEdge[] = []
  const N = (n: LoopNode) => (nodes.push(n), n)
  const E = (e: LoopEdge) => (edges.push(e), e)

  // shared progression column (x ≈ 1500…2100)
  N(pool('level', 'Level', { x: 1500, y: 40 }, { initial: 1 }))
  N(pool('xp', 'XP', { x: 1500, y: 180 }))
  N(pool('xp_earned', 'XP earned', { x: 1700, y: 180 }))
  N(pool('reward', 'Reward', { x: 1260, y: 320 }, { capacity: 12 }))
  N(pool('fail_pool', 'Setbacks', { x: 1260, y: 460 }, { capacity: 6 }))
  N(pool('death_pool', 'Deaths queue', { x: 1260, y: 600 }, { capacity: 6 }))

  // reward router + payouts
  N(mkNode('gate', 'reward_router', 'Reward router', { x: 1460, y: 320 }, { distribution: 'deterministic' }))
  N(mkNode('converter', 'hunt_payout', 'Hunt payout', { x: 1660, y: 300 }))
  N(mkNode('converter', 'quest_payout', 'Quest payout', { x: 1660, y: 400 }))
  E(res('e_reward_in', 'reward', 'reward_router', 'all'))
  E(res('e_router_hunt', 'reward_router', 'hunt_payout', num(P.huntW)))
  E(res('e_router_quest', 'reward_router', 'quest_payout', num(P.questW)))
  for (const [pfx, cv, xp, gold, qctr] of [
    ['hunt', 'hunt_payout', P.huntXp, P.huntGold, 'hunt_xp'],
    ['quest', 'quest_payout', P.questXp, P.questGold, 'quest_xp'],
  ] as const) {
    E(res(`e_${pfx}_xp`, cv, 'xp', num(xp)))
    E(res(`e_${pfx}_xpe`, cv, 'xp_earned', num(xp)))
    E(res(`e_${pfx}_qctr`, cv, qctr, num(xp)))
    E(res(`e_${pfx}_gold`, cv, 'gold', num(gold)))
    E(res(`e_${pfx}_golde`, cv, 'gold_earned', num(gold)))
  }
  N(pool('hunt_xp', 'Hunt XP', { x: 1860, y: 260 }))
  N(pool('quest_xp', 'Quest XP', { x: 1860, y: 340 }))

  // setback / death resolution
  N(mkNode('converter', 'fail_conv', 'Setback cost', { x: 1460, y: 460 }))
  N(mkNode('converter', 'death_conv', 'Death cost', { x: 1460, y: 600 }))
  E(res('e_fail_in', 'fail_pool', 'fail_conv', '1'))
  E(res('e_fail_ct', 'fail_conv', 'combat_fails', '1'))
  E(res('e_fail_wear', 'fail_conv', 'gear_wear', num(P.wearPerFail)))
  E(res('e_fail_time', 'fail_conv', 'elapsed', num(P.failTimeCost)))
  E(res('e_death_in', 'death_pool', 'death_conv', '1'))
  E(res('e_death_ct', 'death_conv', 'deaths', '1'))
  E(res('e_death_wear', 'death_conv', 'gear_wear', num(P.wearPerDeath)))
  E(res('e_death_time', 'death_conv', 'elapsed', num(P.deathTimePenalty)))

  // combat outcome counters
  N(pool('combat_wins', 'Combat wins', { x: 1660, y: 500 }))
  N(pool('combat_fails', 'Combat fails', { x: 1660, y: 560 }))
  N(pool('deaths', 'Deaths', { x: 1660, y: 620 }))

  // gold economy
  N(pool('gold', 'Gold', { x: 1900, y: 460 }, { initial: P.goldStart, resourceType: 'currency' }))
  N(pool('gold_earned', 'Gold earned', { x: 2080, y: 400 }))
  N(pool('vendor_revenue', 'Vendor revenue', { x: 2080, y: 460 }))
  N(pool('repair_spend', 'Repair spend', { x: 2080, y: 520 }))
  N(pool('resupply_spend', 'Resupply spend', { x: 2080, y: 580 }))
  N(pool('training_spend', 'Training spend', { x: 2080, y: 640 }))

  // consumables
  N(pool('water', 'Water', { x: 1900, y: 720 }, { initial: P.waterStart, resourceType: 'supply' }))
  N(pool('food', 'Food', { x: 1900, y: 800 }, { initial: P.foodStart, resourceType: 'supply' }))
  N(pool('water_bought', 'Water bought', { x: 2080, y: 720 }))
  N(pool('food_bought', 'Food bought', { x: 2080, y: 800 }))
  N(pool('water_consumed', 'Water consumed', { x: 1720, y: 720 }))
  N(pool('food_consumed', 'Food consumed', { x: 1720, y: 800 }))
  N(mkNode('converter', 'water_upkeep', 'Water upkeep', { x: 1800, y: 720 }))
  N(mkNode('converter', 'food_upkeep', 'Food upkeep', { x: 1800, y: 800 }))
  E(res('e_water_up', 'water', 'water_upkeep', num(P.waterPerStep)))
  E(res('e_water_up_ct', 'water_upkeep', 'water_consumed', num(P.waterPerStep)))
  E(res('e_food_up', 'food', 'food_upkeep', num(P.foodPerStep)))
  E(res('e_food_up_ct', 'food_upkeep', 'food_consumed', num(P.foodPerStep)))

  // resupply — Gold → Water/Food, opened by low Water
  N(mkNode('converter', 'resupply', 'Resupply', { x: 2000, y: 900 }))
  E(res('e_resupply_gold', 'gold', 'resupply', num(P.resupplyCost)))
  E(res('e_resupply_water', 'resupply', 'water', num(P.waterRestock)))
  E(res('e_resupply_waterb', 'resupply', 'water_bought', num(P.waterRestock)))
  E(res('e_resupply_food', 'resupply', 'food', num(P.foodRestock)))
  E(res('e_resupply_foodb', 'resupply', 'food_bought', num(P.foodRestock)))
  E(res('e_resupply_spend', 'resupply', 'resupply_spend', num(P.resupplyCost)))
  E(act('a_resupply', 'water', 'resupply', `< ${P.restockThreshold}`))

  // gear
  N(pool('gear_score', 'Gear score', { x: 2080, y: 260 }, { resourceType: 'power' }))
  N(pool('gear_wear', 'Gear wear', { x: 1900, y: 320 }, { capacity: 40 }))
  N(pool('wear_cleared', 'Wear cleared', { x: 1720, y: 320 }))
  N(mkNode('converter', 'repair_wear', 'Repair (wear)', { x: 1810, y: 320 }))
  N(mkNode('converter', 'repair_gold', 'Repair (bill)', { x: 1810, y: 380 }))
  E(res('e_repair_wear_in', 'gear_wear', 'repair_wear', num(P.repairWearBatch)))
  E(res('e_repair_wear_ct', 'repair_wear', 'wear_cleared', num(P.repairWearBatch)))
  E(res('e_repair_gold_in', 'gold', 'repair_gold', num(P.repairWearBatch * P.repairGoldPerWear)))
  E(res('e_repair_gold_ct', 'repair_gold', 'repair_spend', num(P.repairWearBatch * P.repairGoldPerWear)))
  // both halves of Repair open together: Gear wear over the threshold AND at
  // least one Gold to pay with (no free repair, no phantom charge)
  E(act('a_repair_wear', 'gear_wear', 'repair_wear', `> ${P.repairThreshold}`))
  E(act('a_repair_wear_gold', 'gold', 'repair_wear', `>= 1`))
  E(act('a_repair_gold', 'gear_wear', 'repair_gold', `> ${P.repairThreshold}`))
  E(act('a_repair_gold_gold', 'gold', 'repair_gold', `>= 1`))

  // loot dispatch + category buckets (shared)
  N(pool('drop', 'Drops', { x: 900, y: 980 }, { capacity: 8 }))
  N(pool('loot_feed', 'Loot to sort', { x: 1080, y: 980 }, { capacity: 8 }))
  N(mkNode('converter', 'loot_dispatch', 'Loot dispatch', { x: 990, y: 980 }))
  // PROBABILISTIC — one whole drop lands in exactly one category (integer item
  // counts in a single run; only Monte-Carlo averages are fractional). The
  // weights are selection odds, not a split ratio.
  N(mkNode('gate', 'loot_category', 'Loot category', { x: 1180, y: 980 }, { distribution: 'probabilistic' }))
  E(res('e_drop_in', 'drop', 'loot_dispatch', '1'))
  E(res('e_dispatch_looted', 'loot_dispatch', 'items_looted', '1'))
  E(res('e_dispatch_feed', 'loot_dispatch', 'loot_feed', '1'))
  E(res('e_feed_cat', 'loot_feed', 'loot_category', 'all'))
  N(pool('bucket_equip', 'Equip drops', { x: 1320, y: 900 }, { capacity: 8 }))
  N(pool('bucket_vendor', 'Vendor drops', { x: 1320, y: 960 }, { capacity: 8 }))
  N(pool('bucket_consumable', 'Consumable drops', { x: 1320, y: 1020 }, { capacity: 8 }))
  N(pool('bucket_rare', 'Rare drops', { x: 1320, y: 1080 }, { capacity: 8 }))
  E(res('e_cat_equip', 'loot_category', 'bucket_equip', num(P.equipW)))
  E(res('e_cat_vendor', 'loot_category', 'bucket_vendor', num(P.vendorW)))
  E(res('e_cat_consumable', 'loot_category', 'bucket_consumable', num(P.consumableW)))
  E(res('e_cat_rare', 'loot_category', 'bucket_rare', num(P.rareW)))

  N(pool('items_looted', 'Items looted', { x: 1500, y: 860 }))
  N(pool('items_equipped', 'Items equipped', { x: 1500, y: 920 }))
  N(pool('items_sold', 'Items sold', { x: 1500, y: 980 }))
  N(pool('items_consumed', 'Items consumed', { x: 1500, y: 1040 }))

  N(mkNode('converter', 'equip_conv', 'Equip', { x: 1420, y: 900 }))
  N(mkNode('converter', 'vendor_conv', 'Sell to vendor', { x: 1420, y: 960 }))
  N(mkNode('converter', 'consumable_conv', 'Use consumable', { x: 1420, y: 1020 }))
  N(mkNode('converter', 'rare_conv', 'Sell rare', { x: 1420, y: 1080 }))
  E(res('e_equip_in', 'bucket_equip', 'equip_conv', '1'))
  E(res('e_equip_ct', 'equip_conv', 'items_equipped', '1'))
  E(res('e_equip_gear', 'equip_conv', 'gear_score', num(P.gearGain)))
  E(res('e_vendor_in', 'bucket_vendor', 'vendor_conv', '1'))
  E(res('e_vendor_ct', 'vendor_conv', 'items_sold', '1'))
  E(res('e_vendor_gold', 'vendor_conv', 'gold', num(P.vendorValue)))
  E(res('e_vendor_golde', 'vendor_conv', 'gold_earned', num(P.vendorValue)))
  E(res('e_vendor_rev', 'vendor_conv', 'vendor_revenue', num(P.vendorValue)))
  E(res('e_cons_in', 'bucket_consumable', 'consumable_conv', '1'))
  E(res('e_cons_ct', 'consumable_conv', 'items_consumed', '1'))
  E(res('e_cons_water', 'consumable_conv', 'water', num(P.consumableBonus)))
  E(res('e_cons_waterb', 'consumable_conv', 'water_bought', num(P.consumableBonus)))
  E(res('e_cons_food', 'consumable_conv', 'food', num(P.consumableBonus)))
  E(res('e_cons_foodb', 'consumable_conv', 'food_bought', num(P.consumableBonus)))
  E(res('e_rare_in', 'bucket_rare', 'rare_conv', '1'))
  E(res('e_rare_ct', 'rare_conv', 'items_sold', '1'))
  E(res('e_rare_gold', 'rare_conv', 'gold', num(P.rareValue)))
  E(res('e_rare_golde', 'rare_conv', 'gold_earned', num(P.rareValue)))
  E(res('e_rare_rev', 'rare_conv', 'vendor_revenue', num(P.rareValue)))

  // clock + completion / End
  N(pool('elapsed', 'Elapsed time', { x: 2080, y: 40 }))
  N(mkNode('source', 'clock', 'Clock', { x: 1900, y: 40 }))
  E(res('e_clock', 'clock', 'elapsed', num(P.timePerStep)))
  N(pool('completion', 'Completion', { x: 1900, y: 120 }, { capacity: 3 }))
  N(mkNode('source', 'completion_src', 'Completion pulse', { x: 1720, y: 120 }))
  N(mkNode('end', 'end15', 'Reached level 15', { x: 2080, y: 120 }))
  E(res('e_completion_in', 'completion_src', 'completion', '1'))
  E(res('e_completion_end', 'completion', 'end15', 'all'))
  E(act('a_end15', 'level', 'end15', '>= 15'))

  // ── three zone lanes ────────────────────────────────────────────────────
  const laneY = [40, 380, 720]
  for (let z = 0; z < 3; z++) {
    const p = `z${z + 1}`
    const y = laneY[z]
    const lo = P.bandLo[z]
    const hi = P.bandHi[z]
    N(mkNode('source', `${p}_enc_src`, `${['Starter', 'Foothills', 'Highlands'][z]} encounters`, { x: 40, y }))
    N(
      pool(
        `${p}_enc`,
        // the top-spine LANDMARK for this stage of the journey
        `${['Starter · Lv 1–5', 'Foothills · Lv 5–10', 'Highlands · Lv 10–15'][z]}`,
        { x: 240, y },
        { capacity: 3 },
      ),
    )
    N(mkNode('gate', `${p}_combat`, `${['Starter', 'Foothills', 'Highlands'][z]} combat`, { x: 440, y }, { distribution: 'probabilistic' }))
    N(pool(`${p}_win`, `${['Starter', 'Foothills', 'Highlands'][z]} victory`, { x: 550, y: y - 40 }, { capacity: 3 }))
    N(mkNode('converter', `${p}_winamp`, `${['Starter', 'Foothills', 'Highlands'][z]} win`, { x: 660, y: y - 40 }))
    N(pool(`${p}_lootroll`, `${['Starter', 'Foothills', 'Highlands'][z]} loot roll`, { x: 880, y: y - 40 }, { capacity: 3 }))
    N(mkNode('gate', `${p}_loot`, `${['Starter', 'Foothills', 'Highlands'][z]} loot`, { x: 1080, y: y - 40 }, { distribution: 'probabilistic' }))
    // XP → Level: a `pull all` meter Gate pulls exactly `xp_per_level` from the
    // shared XP Pool (all-or-nothing — nothing is consumed when XP is short), and
    // the Converter turns that fixed amount into exactly +1 Level. So Level is a
    // WHOLE NUMBER in a single run, and no XP is ever destroyed.
    N(mkNode('gate', `${p}_xp_meter`, `${['Starter', 'Foothills', 'Highlands'][z]} XP meter`, { x: 620, y: y + 80 }, { distribution: 'deterministic', mode: 'pullAll' }))
    N(mkNode('converter', `${p}_xp2lvl`, `${['Starter', 'Foothills', 'Highlands'][z]} level up`, { x: 660, y: y + 80 }))
    N(mkNode('converter', `${p}_training`, `${['Starter', 'Foothills', 'Highlands'][z]} training`, { x: 660, y: y + 160 }))

    E(res(`e_${p}_enc_in`, `${p}_enc_src`, `${p}_enc`, num(P.encountersPerStep)))
    E(res(`e_${p}_enc_gate`, `${p}_enc`, `${p}_combat`, 'all'))
    E(res(`e_${p}_win`, `${p}_combat`, `${p}_win`, num(P.wWin[z])))
    E(resO(`e_${p}_fail`, `${p}_combat`, 'fail_pool', num(P.wFail[z])))
    E(resO(`e_${p}_death`, `${p}_combat`, 'death_pool', num(P.wDeath[z])))
    // win amp: 1 win token → Reward units + a win count + a loot roll
    E(res(`e_${p}_winamp_in`, `${p}_win`, `${p}_winamp`, '1'))
    E(resO(`e_${p}_winamp_reward`, `${p}_winamp`, 'reward', num(P.rewardPerWin[z])))
    E(resO(`e_${p}_winamp_ct`, `${p}_winamp`, 'combat_wins', '1'))
    E(res(`e_${p}_winamp_loot`, `${p}_winamp`, `${p}_lootroll`, '1'))
    E(res(`e_${p}_lootroll_gate`, `${p}_lootroll`, `${p}_loot`, 'all'))
    E(resO(`e_${p}_loot_drop`, `${p}_loot`, 'drop', num(P.dropRate[z])))
    E(resO(`e_${p}_loot_miss`, `${p}_loot`, 'void', num(100 - P.dropRate[z])))
    // XP meter (pull all) → level-up Converter → Level ; + a per-step Gold sink
    E(resO(`e_${p}_xpmeter_in`, 'xp', `${p}_xp_meter`, num(P.xpPerLevel[z])))
    E(res(`e_${p}_xpmeter_out`, `${p}_xp_meter`, `${p}_xp2lvl`, num(P.xpPerLevel[z])))
    E(resO(`e_${p}_xp2lvl_out`, `${p}_xp2lvl`, 'level', '1'))
    E(resO(`e_${p}_training_in`, 'gold', `${p}_training`, num(P.trainingCost[z])))
    E(resO(`e_${p}_training_ct`, `${p}_training`, 'training_spend', num(P.trainingCost[z])))

    // band activators — open the lane only inside its Level band
    for (const target of [`${p}_enc_src`, `${p}_xp_meter`, `${p}_xp2lvl`, `${p}_training`]) {
      if (lo > 1) E(act(`a_${target}_lo`, 'level', target, `>= ${lo}`))
      if (hi != null) E(act(`a_${target}_hi`, 'level', target, `< ${hi}`))
      if (z === 2) E(act(`a_${target}_gear`, 'gear_score', target, `>= ${P.gearGate10}`))
    }
  }

  // shared "no drop" sink
  N(mkNode('drain', 'void', 'No drop', { x: 1280, y: 1160 }))

  // ── character creation — the start of the journey (§EM2.1) ──────────────
  // `Character creation` is an `onStart` Source: it fires once on the first
  // advance, putting a token in `Active character`. A `>= 1` activator on the
  // Starter encounters Source then opens the first zone — so the visible path is
  // Character creation → Starter zone → Foothills → Highlands → Reached level 15.
  N(mkNode('source', 'char_creation', 'Character creation', { x: 0, y: 0 }, { activation: 'onStart' }))
  N(pool('active_char', 'Active character', { x: 0, y: 0 }, { capacity: 2 }))
  E(res('e_char_create', 'char_creation', 'active_char', '1'))
  E(act('a_starter_open', 'active_char', 'z1_enc_src', '>= 1'))

  // ── reporting Registers (loop-expr/1 canonical form) ────────────────────
  N(reg('r_income', 'Total income', '@gold_earned', { x: 2280, y: 400 }, { format: 'int' }))
  N(reg('r_expense', 'Total expense', '@repair_spend + @resupply_spend + @training_spend', { x: 2280, y: 460 }, { format: 'int' }))
  N(reg('r_netgold', 'Net gold check', '@gold_earned - @repair_spend - @resupply_spend - @training_spend', { x: 2280, y: 520 }, { format: 'int' }))
  // `+ 0.001` keeps the denominator non-zero so R(t) is a clean `0%` before the
  // first reward instead of an invalid `/0` (no diagnostic on opening the file);
  // the term is negligible once XP flows.
  N(reg('r_huntshare', 'Hunt XP share', '@hunt_xp / (@hunt_xp + @quest_xp + 0.001)', { x: 2280, y: 300 }, { format: 'percent' }))
  // NOT a level estimate (real Level is Converter-driven and piecewise, which an
  // expression can't reproduce) — total XP earned expressed in first-zone
  // level-costs, i.e. a pace / effort index.
  N(reg('r_efflevel', 'XP pace (starter-levels)', `@xp_earned / ${num(P.xpPerLevel[0])}`, { x: 2280, y: 40 }, { format: 'float' }))
  N(reg('r_items_acct', 'Items accounted', '@items_equipped + @items_sold + @items_consumed', { x: 2280, y: 900 }, { format: 'float' }))
  N(reg('r_burned', 'Consumables burned', '@water_consumed + @food_consumed', { x: 2280, y: 720 }, { format: 'int' }))

  // ── layout (§EM2.7 / §EM13.1) ─────────────────────────────────────────────
  //   TOP     spine: Character → Starter → Foothills → Highlands → Reached 15
  //   MIDDLE  three ISOLATED zone columns — each zone's Combat → outcome →
  //           level-up flows straight down inside its own column; a column's
  //           only outgoing edges go to the shared HUB ROW just below it.
  //   BOT-L   Loot chain (Drop → dispatch → category → Equip / Sell / Consume)
  //   BOT-C   Gold economy (Reward router → payouts → Gold → Repair / Resupply
  //           / Training) + consumables + gear
  //   TOP-R   the seven reporting Registers, in clear space (no edges reach
  //           them — a Register has no ports)
  //   BOT-R   left empty for the minimap
  // Zone centres are far enough apart (720) that each zone's roomy 3-lane grid
  // (below) never bleeds into its neighbour — a first read can zoom a zone and
  // every node stays readable and clickable (§EM13.5.1).
  const CX = [720, 1460, 2200] as const // the three zone-column centres, 740 apart
  const LAYOUT: Record<string, XY> = {
    // ── TOP: the spine (y 40) — Character → 3 zones → Reached level 15 ──
    char_creation: { x: 40, y: 40 },
    active_char: { x: 320, y: 40 },
    z1_enc: { x: CX[0], y: 40 },
    z2_enc: { x: CX[1], y: 40 },
    z3_enc: { x: CX[2], y: 40 },
    end15: { x: 2760, y: 40 },
    completion_src: { x: 2560, y: 170 },
    completion: { x: 2760, y: 170 },
    clock: { x: 2560, y: 290 },
    elapsed: { x: 2760, y: 290 },

    // ── TOP-RIGHT: reporting / checks (no edges — clear of the minimap) ──
    r_efflevel: { x: 2960, y: 60 },
    r_huntshare: { x: 2960, y: 130 },
    r_income: { x: 2960, y: 200 },
    r_expense: { x: 2960, y: 270 },
    r_netgold: { x: 2960, y: 340 },
    r_items_acct: { x: 2960, y: 410 },
    r_burned: { x: 2960, y: 480 },

    // ── the HUB ROW (y 660 → shifted to 800): the only place zone columns merge ──
    drop: { x: 380, y: 660 },
    fail_pool: { x: 560, y: 660 },
    death_pool: { x: 720, y: 660 },
    xp: { x: 1120, y: 660 },
    xp_earned: { x: 1320, y: 660 },
    level: { x: 1520, y: 660 },
    reward: { x: 1720, y: 660 },
    void: { x: 1920, y: 640 },

    // ── BOTTOM-LEFT: the loot chain (x 100–1150, y 800–1360) ──
    loot_dispatch: { x: 380, y: 800 },
    items_looted: { x: 200, y: 800 },
    loot_feed: { x: 380, y: 920 },
    loot_category: { x: 380, y: 1040 },
    bucket_equip: { x: 300, y: 1160 },
    bucket_vendor: { x: 460, y: 1160 },
    bucket_consumable: { x: 620, y: 1160 },
    bucket_rare: { x: 780, y: 1160 },
    equip_conv: { x: 300, y: 1280 },
    vendor_conv: { x: 460, y: 1280 },
    consumable_conv: { x: 620, y: 1280 },
    rare_conv: { x: 780, y: 1280 },
    items_equipped: { x: 120, y: 1160 },
    items_sold: { x: 120, y: 1240 },
    items_consumed: { x: 120, y: 1320 },

    // ── BOTTOM-CENTRE: setback / death, reward router, gold, gear, upkeep ──
    combat_wins: { x: 560, y: 780 },
    combat_fails: { x: 560, y: 840 },
    deaths: { x: 560, y: 900 },
    fail_conv: { x: 720, y: 800 },
    death_conv: { x: 880, y: 800 },
    reward_router: { x: 1680, y: 800 },
    hunt_payout: { x: 1840, y: 760 },
    quest_payout: { x: 1840, y: 860 },
    hunt_xp: { x: 2000, y: 760 },
    quest_xp: { x: 2000, y: 860 },
    gold: { x: 1500, y: 1000 },
    gold_earned: { x: 1680, y: 1000 },
    vendor_revenue: { x: 1860, y: 1000 },
    repair_wear: { x: 2160, y: 760 },
    wear_cleared: { x: 2160, y: 680 },
    repair_gold: { x: 2160, y: 840 },
    gear_wear: { x: 2160, y: 920 },
    gear_score: { x: 2340, y: 920 },
    repair_spend: { x: 1500, y: 1120 },
    resupply: { x: 1680, y: 1120 },
    resupply_spend: { x: 1680, y: 1220 },
    training_spend: { x: 1860, y: 1120 },
    water_consumed: { x: 1200, y: 1160 },
    food_consumed: { x: 1200, y: 1220 },
    water_upkeep: { x: 1360, y: 1160 },
    food_upkeep: { x: 1360, y: 1220 },
    water: { x: 1520, y: 1300 },
    food: { x: 1520, y: 1360 },
    water_bought: { x: 1700, y: 1340 },
    food_bought: { x: 1880, y: 1340 },
  }
  for (let z = 0; z < 3; z++) {
    const cx = CX[z]
    // One self-contained column on a roomy 3-lane grid — L / M / R at cx-260 /
    // cx-30 / cx+240 (≈ 260 px pitch), rows every ~150 px, all inside
    // [cx-260, cx+240] × [150, 620]. The combat → win → winamp → loot-roll → loot
    // chain runs down the LEFT lane; the XP-meter → level-up pair sits on the
    // RIGHT lane; encounters + training are on the MIDDLE lane. No two boxes
    // abut, and no in-column edge has to cross a node body.
    const L = cx - 260
    const M = cx - 30
    const R = cx + 240
    Object.assign(LAYOUT, {
      [`z${z + 1}_enc_src`]: { x: L, y: 160 },
      [`z${z + 1}_combat`]: { x: M, y: 300 },
      [`z${z + 1}_win`]: { x: L, y: 320 },
      [`z${z + 1}_winamp`]: { x: L, y: 460 },
      [`z${z + 1}_lootroll`]: { x: L, y: 600 },
      [`z${z + 1}_loot`]: { x: M, y: 620 },
      [`z${z + 1}_xp_meter`]: { x: R, y: 290 },
      [`z${z + 1}_xp2lvl`]: { x: R, y: 440 },
      [`z${z + 1}_training`]: { x: M, y: 470 },
    })
  }
  for (const n of nodes) if (LAYOUT[n.id]) n.position = LAYOUT[n.id]

  // The hub row + the bottom economy bands were authored at y ≥ 640; drop them
  // another 140 px so the widened zone grids (which now reach y ≈ 620) keep clear
  // air above the hub row. Registers (y ≤ 480) and the spine (y ≤ 290) are
  // untouched. One pass, so the band spacing below stays exactly as authored.
  for (const n of nodes) {
    if (LAYOUT[n.id] && n.position.y >= 640) n.position = { x: n.position.x, y: n.position.y + 140 }
  }

  return { nodes, edges }
}

// ── the verified Monte-Carlo run (saved into the file, walked in the README) ─
export const MMO_PROGRESSION_MC = {
  baseSeed: 1,
  runs: 200,
  steps: 150,
  tracked: [
    'elapsed',
    'level',
    'deaths',
    'combat_wins',
    'combat_fails',
    'water_consumed',
    'food_consumed',
    'items_looted',
    'items_equipped',
    'items_sold',
    'items_consumed',
    'gold_earned',
    'repair_spend',
    'resupply_spend',
    'training_spend',
    'gold',
    'vendor_revenue',
    'gear_score',
    'quest_xp',
    'hunt_xp',
  ],
  // the Timeline's DEFAULT visible set (loop-studio/timelineSeries — Pool + Register
  // ids, sorted). The MC `tracked` list above stays wide for analysis; this keeps
  // the first-run Timeline to the story: Level, time, XP, Gold, Deaths, Gear,
  // consumables burned, Items sold, and the Net gold check Register. The rest are
  // one "+N more" click away.
  timelineSeries: [
    'deaths',
    'elapsed',
    'food_consumed',
    'gear_score',
    'gold',
    'items_sold',
    'level',
    'r_netgold',
    'water_consumed',
    'xp_earned',
  ],
  // the layout is part of the explanation — open in a view-safe EDIT-LOCK so a
  // stray drag can't move a node. Selection + the read-only Inspector + pan /
  // zoom / minimap / Timeline / the sim all still work; the user flips the 🔓
  // control in the Canvas to edit. (recommendedRunConfig.canvasLocked, UI-only.)
  canvasLocked: true,
}
