import { defaultData } from '../model/factory'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'

// Builder for examples/mmo-progression.json — the "Early MMO progression
// (levels 1–15)" Templates demo. Design: docs/example-mmo-progression.md
// (settled, non-frozen). This is a PRODUCT DEMO, not a value oracle: the smoke
// test in mmo-progression.test.ts pins structural invariants + the §EM10.1
// accounting identities + the reach-15 tuning window, never specific numbers.
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
//   shared economy (down the right edge):
//     Win amp → Reward Pool → Reward Router (deterministic hunt:quest) →
//       Hunt / Quest payout Converters → XP (+ XP earned), Gold (+ Gold earned),
//       Hunt XP / Quest XP counters.
//     Drop Pool → Loot dispatch (tee: Items looted + category feed) →
//       Loot category Gate (deterministic) → four bucket Pools → four bucket
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
// Two deliberate deviations from docs/example-mmo-progression.md, both forced by
// the frozen engine and both conservation-safe:
//
//   • `Level` is CONTINUOUS, not integer. The design's "a Converter emits whole
//     units" relied on a `pullAll` XP→Level Converter, but a `pullAll` pool-fed
//     Converter that is under-supplied consumes its partial input WITHOUT
//     producing (SEMANTICS.md §6 / step.ts) — that would silently destroy XP and
//     break the `XP earned` counter. So each XP→Level Converter is `pullAny`:
//     when XP ≥ xp_per_level it is exactly +1 Level; when XP is short it adds a
//     fraction and consumes exactly what it added (XP conserved). The band
//     activators still switch cleanly at Level 5.0 / 10.0 / 15.0.
//   • REPAIR is two Converters (`Repair (wear)` clears Gear wear, `Repair (bill)`
//     meters the Gold) rather than one two-input Converter — a single Converter
//     couples one `f` across two inputs of unequal availability and can pay a
//     Repair bill with Gold it did not actually consume. Split, each is a
//     single-input metered Converter, so Gold conservation is exact.
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
  gearGate10: 6, // Highlands also needs Gear score ≥ this

  rewardPerWin: [1.15, 1.5, 2.0] as const, // units delivered to the Reward Pool per win
  wWin: [9, 7, 6] as const, // Combat Gate branch weights …
  wFail: [1.8, 2.5, 2.8] as const,
  wDeath: [0.5, 0.9, 1.3] as const,
  dropRate: [34, 34, 40] as const, // Loot Gate "drop" weight vs "no drop" = 100 − this
  xpPerLevel: [10, 20, 30] as const, // rising level cost per band
  trainingCost: [0.25, 0.45, 0.7] as const, // per-step Gold sink while in the band

  // reward router (deterministic) + payout converters
  huntW: 3,
  questW: 1,
  huntXp: 3,
  huntGold: 2,
  questXp: 9,
  questGold: 7,

  // loot category gate (deterministic) weights + effects
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
  N(mkNode('gate', 'loot_category', 'Loot category', { x: 1180, y: 980 }, { distribution: 'deterministic' }))
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
    N(pool(`${p}_enc`, `${['Starter', 'Foothills', 'Highlands'][z]} encounter`, { x: 240, y }, { capacity: 3 }))
    N(mkNode('gate', `${p}_combat`, `${['Starter', 'Foothills', 'Highlands'][z]} combat`, { x: 440, y }, { distribution: 'probabilistic' }))
    N(pool(`${p}_win`, `${['Starter', 'Foothills', 'Highlands'][z]} victory`, { x: 550, y: y - 40 }, { capacity: 3 }))
    N(mkNode('converter', `${p}_winamp`, `${['Starter', 'Foothills', 'Highlands'][z]} win`, { x: 660, y: y - 40 }))
    N(pool(`${p}_lootroll`, `${['Starter', 'Foothills', 'Highlands'][z]} loot roll`, { x: 880, y: y - 40 }, { capacity: 3 }))
    N(mkNode('gate', `${p}_loot`, `${['Starter', 'Foothills', 'Highlands'][z]} loot`, { x: 1080, y: y - 40 }, { distribution: 'probabilistic' }))
    N(mkNode('converter', `${p}_xp2lvl`, `${['Starter', 'Foothills', 'Highlands'][z]} level up`, { x: 660, y: y + 80 }))
    N(mkNode('converter', `${p}_training`, `${['Starter', 'Foothills', 'Highlands'][z]} training`, { x: 660, y: y + 160 }))

    E(res(`e_${p}_enc_in`, `${p}_enc_src`, `${p}_enc`, num(P.encountersPerStep)))
    E(res(`e_${p}_enc_gate`, `${p}_enc`, `${p}_combat`, 'all'))
    E(res(`e_${p}_win`, `${p}_combat`, `${p}_win`, num(P.wWin[z])))
    E(res(`e_${p}_fail`, `${p}_combat`, 'fail_pool', num(P.wFail[z])))
    E(res(`e_${p}_death`, `${p}_combat`, 'death_pool', num(P.wDeath[z])))
    // win amp: 1 win token → Reward units + a win count + a loot roll
    E(res(`e_${p}_winamp_in`, `${p}_win`, `${p}_winamp`, '1'))
    E(res(`e_${p}_winamp_reward`, `${p}_winamp`, 'reward', num(P.rewardPerWin[z])))
    E(res(`e_${p}_winamp_ct`, `${p}_winamp`, 'combat_wins', '1'))
    E(res(`e_${p}_winamp_loot`, `${p}_winamp`, `${p}_lootroll`, '1'))
    E(res(`e_${p}_lootroll_gate`, `${p}_lootroll`, `${p}_loot`, 'all'))
    E(res(`e_${p}_loot_drop`, `${p}_loot`, 'drop', num(P.dropRate[z])))
    E(res(`e_${p}_loot_miss`, `${p}_loot`, 'void', num(100 - P.dropRate[z])))
    // xp → level (rising cost) + per-step training gold sink
    E(res(`e_${p}_xp2lvl_in`, 'xp', `${p}_xp2lvl`, num(P.xpPerLevel[z])))
    E(res(`e_${p}_xp2lvl_out`, `${p}_xp2lvl`, 'level', '1'))
    E(res(`e_${p}_training_in`, 'gold', `${p}_training`, num(P.trainingCost[z])))
    E(res(`e_${p}_training_ct`, `${p}_training`, 'training_spend', num(P.trainingCost[z])))

    // band activators — open the lane only inside its Level band
    for (const target of [`${p}_enc_src`, `${p}_xp2lvl`, `${p}_training`]) {
      if (lo > 1) E(act(`a_${target}_lo`, 'level', target, `>= ${lo}`))
      if (hi != null) E(act(`a_${target}_hi`, 'level', target, `< ${hi}`))
      if (z === 2) E(act(`a_${target}_gear`, 'gear_score', target, `>= ${P.gearGate10}`))
    }
  }

  // shared "no drop" sink
  N(mkNode('drain', 'void', 'No drop', { x: 1280, y: 1160 }))

  // ── reporting Registers (loop-expr/1 canonical form) ────────────────────
  N(reg('r_income', 'Total income', '@gold_earned', { x: 2280, y: 400 }, { format: 'int' }))
  N(reg('r_expense', 'Total expense', '@repair_spend + @resupply_spend + @training_spend', { x: 2280, y: 460 }, { format: 'int' }))
  N(reg('r_netgold', 'Net gold check', '@gold_earned - @repair_spend - @resupply_spend - @training_spend', { x: 2280, y: 520 }, { format: 'int' }))
  N(reg('r_huntshare', 'Hunt XP share', '@hunt_xp / (@hunt_xp + @quest_xp)', { x: 2280, y: 300 }, { format: 'percent' }))
  N(reg('r_efflevel', 'Effective level', `1 + @xp_earned / ${num(P.xpPerLevel[0])}`, { x: 2280, y: 40 }, { format: 'float' }))
  N(reg('r_items_acct', 'Items accounted', '@items_equipped + @items_sold + @items_consumed', { x: 2280, y: 900 }, { format: 'float' }))
  N(reg('r_burned', 'Consumables burned', '@water_consumed + @food_consumed', { x: 2280, y: 720 }, { format: 'int' }))

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
}
