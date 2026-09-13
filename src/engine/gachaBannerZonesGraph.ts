// docs/gacha-banner-zones.md (GZ) — the 3-zone gacha Template's graph, built
// once here and reused by both the engine fixture/test (raw nodes/edges) and
// the example-JSON generator (adds positions/frames/recommendedRunConfig).
// No new engine feature: every mechanic reuses shipped primitives exactly as
// GZ4/GZ5 specify — the mutually-exclusive-Gates-via-activator shape already
// proven in `src/engine/gacha-hard-pity.test.ts`, and CSU `afterPull` labels
// for all state bookkeeping (pity, pulls_made, the pickup-guarantee flag).
//
// Implementation note 1 (not in the GZ prose, a wiring-level correction found
// while building this): GZ3.4/GZ4 describe `buy_pull_<zone>` as a `pullAll`
// Converter feeding BOTH `roll_gate_<zone>` and `forced_ssr_<zone>`. That
// exact shape is the one GS10-3 already found broken (`docs/example-gacha-
// simulator.md`'s GS10-3 section): a `pullAll` Converter's `accept()` takes
// the MINIMUM across every outgoing edge (verified again here directly,
// `src/engine/step.ts`'s `accept()` `k === 'converter'` branch), so the
// moment one of two mutually-exclusive targets is disabled by its own
// activator (`accept` 0 for a disabled router), the WHOLE Converter accepts
// nothing, permanently. GS10-3's own fix — the funding Pool feeds both
// mutually-exclusive Gates DIRECTLY, no Converter — is reused verbatim here:
// `ticket_<zone>` funds `roll_gate_<zone>` / `forced_ssr_<zone>` by ordinary
// resource edges, with no `buy_pull_<zone>` Converter anywhere.
// `pulls_made_<zone>` is booked purely via `afterPull` `+1` labels off the
// result Gates (mirroring how `gacha-hard-pity.test.ts` already books it) —
// this is graph wiring, not an engine change.
//
// Implementation note 2 (GZ5 round 3 — see `docs/gacha-banner-zones.md`'s
// changelog and GZ5.0/GZ5.1/GZ9's GZ-D7): the pickup guarantee is NOT the
// relay-Pool shape GZ5's rounds 1-2 described (`ssr_landed_pickup` feeding
// two mutually-exclusive Gates) — that shape has a same-vs-next-step lag bug,
// found and fixed before this file was written. It is four mutually-
// exclusive paths fed DIRECTLY by `ticket_pickup`, each gated by an
// AND-conjunction of the pity activator pair and a new guarantee activator
// pair on `missed_pickup_pickup`. See `buildPickupRoll` below.
//
// Implementation note 3 (visual-clarity pass, Hanrim, 2026-09-13, after
// reviewing screenshots of the round-3 wiring): a Template someone opens
// expecting a 10-minute answer must not read as "a complex internal
// circuit". Node LABELS drop the "(Zone)" suffix — each zone's own frame
// title already gives that context, so repeating it on every node inside is
// pure clutter (`labelFor` below). The 4 comparison Registers are the one
// exception: they sit together outside any per-zone frame, so they keep an
// explicit, prominent zone tag. PARAMETER ids get a `zoneN_` sort prefix
// (`paramId` below) purely so the Inputs panel — which sorts by raw node id,
// `src/components/ModelPanels.tsx`'s `byId` — groups them by zone in the
// product's own stated order (shared -> Free -> Standard -> Pickup) instead
// of interleaving by role. This changes ONLY the 13 Parameter ids that carry
// a zone (`pulls_per_zone` itself sorts first unprefixed, already lexically
// before `zoneN_...`); every other node id is unchanged.
//
// Implementation note 4 (Hanrim, 2026-09-13, live-preview review round 2):
// note 3's zone-suffix drop went too far for Parameters specifically. The
// `zoneN_` id prefix only controls Inputs-panel SORT ORDER — it is never
// shown — so "SSR weight" / "SR weight" / "R weight" rendered three times,
// indistinguishably, in the flat Inputs panel (frame context lives only on
// the canvas, and the Inputs panel has no frames). `paramLabelFor` below
// restores an explicit zone tag to Parameter LABELS ONLY; every other node
// kind keeps the short `labelFor` label, since their ids already carry a
// visible zone suffix on canvas via the frame they sit in. The 4 comparison
// Registers separately gain a numbered `cmpN_` sort prefix on their IDS (not
// just their labels) for the same reason `paramId` exists: the Summary
// panel also sorts by raw id, and an alphabetical sort of `hit_rate_free` /
// `hit_rate_pickup` / `hit_rate_standard` / `pickup_share_pickup` does not
// land in the product's stated Free -> Standard -> Pickup order. The pickup
// Register's formula also changes here — see `buildComparisonRegisters`.

import type { LoopEdge, LoopNode } from '../model/types'

export const PULLS_PER_ZONE = 200
export const HARD_PITY_STANDARD = 80
export const HARD_PITY_PICKUP = 80

const XY = { x: 0, y: 0 }

const pool = (id: string, label: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id,
  type: 'pool',
  position: XY,
  data: { kind: 'pool', label, activation: 'passive', initial, capacity, mode: 'pullAny' },
})

const source = (id: string, label: string): LoopNode => ({
  id,
  type: 'source',
  position: XY,
  data: { kind: 'source', label, activation: 'onStart', mode: 'pushAny' },
})

const end = (id: string, label: string): LoopNode => ({
  id,
  type: 'end',
  position: XY,
  data: { kind: 'end', label, activation: 'automatic' },
})

const gate = (
  id: string,
  label: string,
  distribution: 'deterministic' | 'probabilistic',
): LoopNode => ({
  id,
  type: 'gate',
  position: XY,
  data: { kind: 'gate', label, activation: 'automatic', distribution, mode: 'pullAny' },
})

const parameter = (id: string, label: string, value: number): LoopNode => ({
  id,
  type: 'parameter',
  position: XY,
  data: { kind: 'parameter', label, value },
})

const register = (id: string, label: string, expr: string, format: 'percent'): LoopNode => ({
  id,
  type: 'register',
  position: XY,
  data: { kind: 'register', label, expr, format },
})

const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  sourceHandle: 'out',
  targetHandle: 'in',
  data: { kind: 'resource', flow },
})

const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  sourceHandle: 'state-source',
  targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})

const afterPull = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  sourceHandle: 'state-source',
  targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})

export type ZoneKey = 'free' | 'standard' | 'pickup'

/** GZ2 canonical EN zone names — the graph JSON's canonical labels. */
export const ZONE_TITLE: Record<ZoneKey, string> = {
  free: 'General / Free',
  standard: 'Premium Standard',
  pickup: 'Premium Pickup',
}

/** Product-stated zone order (shared -> Free -> Standard -> Pickup) — drives
 *  both the generator's vertical zone stacking and, via `paramId`, the
 *  Inputs panel's id-sorted grouping (implementation note 3). */
const ZONE_ORDINAL: Record<ZoneKey, number> = { free: 1, standard: 2, pickup: 3 }

/** A Parameter id that sorts into its zone's block in the Inputs panel
 *  (`ModelPanels.tsx`'s `byId`, plain string compare). Only Parameter ids use
 *  this — Pool/Gate/Source ids are unchanged since they never appear there.
 *  Exported so the engine fixture test can address the same Parameters
 *  without hand-duplicating this scheme. */
export const paramId = (zone: ZoneKey, role: string) => `zone${ZONE_ORDINAL[zone]}_${zone}_${role}`

/** Node LABEL text — no zone suffix (implementation note 3): the zone's own
 *  frame title already gives that context on canvas. */
const labelFor = (role: string) => role

/** Parameter LABEL text ONLY (implementation note 4) — regains an explicit
 *  zone tag, since the Inputs panel is flat and carries no frame context. */
const paramLabelFor = (zone: ZoneKey, role: string) => `${ZONE_TITLE[zone]} · ${role}`

/**
 * One zone's nodes/edges (GZ3.4 funding shape + GZ4 pity + GZ5 pickup
 * guarantee, `pickup` only). `hasPity` is false only for `free` (GZ-D2).
 * `pickup` branches early into `buildPickupRoll` — its roll mechanism is
 * structurally different (four AND-gated paths, GZ5 round 3), not an
 * extension of the shared `free`/`standard` roll shape.
 */
export function buildZone(zone: ZoneKey): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const hasPity = zone !== 'free'
  const id = (role: string) => `${role}_${zone}`
  const nodes: LoopNode[] = []
  const edges: LoopEdge[] = []
  let eN = 0
  const nextE = () => `e_${zone}_${++eN}`

  const fund = id('fund')
  const ticket = id('ticket')
  nodes.push(source(fund, labelFor('Fund tickets')))
  nodes.push(pool(ticket, labelFor('Tickets')))
  edges.push(res(nextE(), fund, ticket, '@pulls_per_zone'))

  const pullsMade = id('pulls_made')
  nodes.push(pool(pullsMade, labelFor('Pulls made')))

  const wSsr = paramId(zone, 'w_ssr')
  const wSr = paramId(zone, 'w_sr')
  const wR = paramId(zone, 'w_r')
  const weights =
    zone === 'free' ? { ssr: 6, sr: 51, r: 943 } : { ssr: 10, sr: 90, r: 900 }
  nodes.push(parameter(wSsr, paramLabelFor(zone, 'SSR weight'), weights.ssr))
  nodes.push(parameter(wSr, paramLabelFor(zone, 'SR weight'), weights.sr))
  nodes.push(parameter(wR, paramLabelFor(zone, 'R weight'), weights.r))

  const srCount = id('sr_count')
  const rCount = id('r_count')
  const ssrCount = id('ssr_count')
  nodes.push(pool(srCount, labelFor('SR count')))
  nodes.push(pool(rCount, labelFor('R count')))
  nodes.push(pool(ssrCount, labelFor('SSR count')))

  if (zone === 'pickup') {
    buildPickupRoll({ nodes, edges, nextE, ticket, pullsMade, srCount, rCount, ssrCount, wSsr, wSr, wR })
    return { nodes, edges }
  }

  const rollGate = id('roll_gate')
  nodes.push(gate(rollGate, labelFor('Roll'), 'probabilistic'))

  const ssrHit = id('ssr_hit')
  const srHit = id('sr_hit')
  const rHit = id('r_hit')
  nodes.push(gate(ssrHit, labelFor('SSR'), 'deterministic'))
  nodes.push(gate(srHit, labelFor('SR'), 'deterministic'))
  nodes.push(gate(rHit, labelFor('R'), 'deterministic'))

  edges.push(res(nextE(), rollGate, ssrHit, `@${wSsr}`))
  edges.push(res(nextE(), rollGate, srHit, `@${wSr}`))
  edges.push(res(nextE(), rollGate, rHit, `@${wR}`))
  edges.push(res(nextE(), srHit, srCount, '1'))
  edges.push(res(nextE(), rHit, rCount, '1'))
  edges.push(afterPull(nextE(), ssrHit, pullsMade, '+1'))
  edges.push(afterPull(nextE(), srHit, pullsMade, '+1'))
  edges.push(afterPull(nextE(), rHit, pullsMade, '+1'))

  if (!hasPity) {
    // Zone 1 (General/Free, GZ-D2): a single probabilistic roll, no pity.
    edges.push(res(nextE(), ticket, rollGate, '1'))
    edges.push(res(nextE(), ssrHit, ssrCount, '1'))
    return { nodes, edges }
  }

  // GZ4 — the tunable pity ceiling (Zone 2), the funding Pool directly
  // feeds both mutually-exclusive Gates (see the file header note).
  const pity = id('pity')
  const hardPity = paramId(zone, 'hard_pity')
  const forcedSsr = id('forced_ssr')
  const ceilingHits = id('ceiling_hits')
  nodes.push(pool(pity, labelFor('Pity')))
  nodes.push(parameter(hardPity, paramLabelFor(zone, 'Hard pity ceiling'), HARD_PITY_STANDARD))
  nodes.push(gate(forcedSsr, labelFor('Forced SSR'), 'deterministic'))
  nodes.push(pool(ceilingHits, labelFor('Ceiling hits')))

  edges.push(res(nextE(), ticket, rollGate, '1'))
  edges.push(res(nextE(), ticket, forcedSsr, '1'))
  edges.push(act(nextE(), pity, rollGate, `< @${hardPity} - 1`))
  edges.push(act(nextE(), pity, forcedSsr, `>= @${hardPity} - 1`))
  // ceilingHits is booked via afterPull, NOT a second resource edge from
  // forcedSsr — a deterministic Gate's outgoing edges SPLIT its received
  // amount proportionally across ALL of them (verified, step.ts's Gate flow
  // computation), so a second resource edge here would silently halve both
  // ssrCount's and ceilingHits' share instead of crediting each in full.
  edges.push(afterPull(nextE(), forcedSsr, ceilingHits, '+1'))
  edges.push(afterPull(nextE(), ssrHit, pity, '=0'))
  edges.push(afterPull(nextE(), forcedSsr, pity, '=0'))
  edges.push(afterPull(nextE(), srHit, pity, '+1'))
  edges.push(afterPull(nextE(), rHit, pity, '+1'))
  edges.push(afterPull(nextE(), forcedSsr, pullsMade, '+1'))

  // Zone 2 (Premium Standard): the SSR result tallies directly.
  edges.push(res(nextE(), ssrHit, ssrCount, '1'))
  edges.push(res(nextE(), forcedSsr, ssrCount, '1'))
  return { nodes, edges }
}

/**
 * GZ5 round 3 — the pickup guarantee (Zone 3 only), four mutually-exclusive
 * paths fed DIRECTLY by `ticket_pickup`, one per (pity-state × guarantee-
 * state) combination. No relay Pool anywhere in the roll path — see the file
 * header's implementation note 2 and `docs/gacha-banner-zones.md` GZ5.
 */
function buildPickupRoll(ctx: {
  nodes: LoopNode[]
  edges: LoopEdge[]
  nextE: () => string
  ticket: string
  pullsMade: string
  srCount: string
  rCount: string
  ssrCount: string
  wSsr: string
  wSr: string
  wR: string
}): void {
  const { nodes, edges, nextE, ticket, pullsMade, srCount, rCount, ssrCount, wSsr, wSr, wR } = ctx

  const pity = 'pity_pickup'
  const hardPity = paramId('pickup', 'hard_pity')
  const ceilingHits = 'ceiling_hits_pickup'
  const missedPickup = 'missed_pickup_pickup'
  nodes.push(pool(pity, labelFor('Pity')))
  nodes.push(parameter(hardPity, paramLabelFor('pickup', 'Hard pity ceiling'), HARD_PITY_PICKUP))
  nodes.push(pool(ceilingHits, labelFor('Ceiling hits')))
  nodes.push(pool(missedPickup, labelFor('Pickup owed'))) // GZ-D4: starts at 0

  const wPickup = paramId('pickup', 'w_pickup')
  const wStandard = paramId('pickup', 'w_standard')
  nodes.push(parameter(wPickup, paramLabelFor('pickup', 'Pickup weight'), 50))
  nodes.push(parameter(wStandard, paramLabelFor('pickup', 'Standard weight'), 50))

  // The four paths (GZ5.1). Pity condition and guarantee condition
  // AND-combine on each (multiple activators on one target already AND
  // together, SEMANTICS-S.md §S6 — no new engine capability).
  const pityOpen = `< @${hardPity} - 1`
  const pityForced = `>= @${hardPity} - 1`
  const owedOpen = '< 1'
  const owedActive = '>= 1'

  const roll_normal_open = 'roll_normal_open_pickup'
  const roll_normal_owed = 'roll_normal_owed_pickup'
  const roll_forced_open = 'roll_forced_open_pickup'
  const roll_forced_owed = 'roll_forced_owed_pickup'
  nodes.push(gate(roll_normal_open, labelFor('Roll — normal, not owed'), 'probabilistic'))
  nodes.push(gate(roll_normal_owed, labelFor('Roll — normal, owed'), 'probabilistic'))
  nodes.push(gate(roll_forced_open, labelFor('Roll — forced, not owed'), 'probabilistic'))
  nodes.push(gate(roll_forced_owed, labelFor('Roll — forced, owed'), 'deterministic'))

  edges.push(res(nextE(), ticket, roll_normal_open, '1'))
  edges.push(res(nextE(), ticket, roll_normal_owed, '1'))
  edges.push(res(nextE(), ticket, roll_forced_open, '1'))
  edges.push(res(nextE(), ticket, roll_forced_owed, '1'))
  edges.push(act(nextE(), pity, roll_normal_open, pityOpen))
  edges.push(act(nextE(), missedPickup, roll_normal_open, owedOpen))
  edges.push(act(nextE(), pity, roll_normal_owed, pityOpen))
  edges.push(act(nextE(), missedPickup, roll_normal_owed, owedActive))
  edges.push(act(nextE(), pity, roll_forced_open, pityForced))
  edges.push(act(nextE(), missedPickup, roll_forced_open, owedOpen))
  edges.push(act(nextE(), pity, roll_forced_owed, pityForced))
  edges.push(act(nextE(), missedPickup, roll_forced_owed, owedActive))

  // The shared "not owed" pickup/standard split — a pure Gate→Gate chain
  // (no Pool), fed by BOTH not-owed paths' SSR outcome; they are mutually
  // exclusive by the SAME pity condition, so sharing this one split Gate is
  // safe (GZ5.1).
  const ssrSplitOpen = 'ssr_split_open_pickup'
  nodes.push(gate(ssrSplitOpen, labelFor('SSR split — not owed'), 'probabilistic'))
  edges.push(res(nextE(), roll_normal_open, ssrSplitOpen, `@${wSsr}`))
  edges.push(res(nextE(), roll_forced_open, ssrSplitOpen, '1'))

  // The four shared, single-output result Gates every path funnels into.
  const pickupHit = 'pickup_hit_pickup'
  const standardHit = 'standard_hit_pickup'
  const srHit = 'sr_hit_pickup'
  const rHit = 'r_hit_pickup'
  nodes.push(gate(pickupHit, labelFor('Pickup hit'), 'deterministic'))
  nodes.push(gate(standardHit, labelFor('Standard hit'), 'deterministic'))
  nodes.push(gate(srHit, labelFor('SR'), 'deterministic'))
  nodes.push(gate(rHit, labelFor('R'), 'deterministic'))

  edges.push(res(nextE(), ssrSplitOpen, pickupHit, `@${wPickup}`))
  edges.push(res(nextE(), ssrSplitOpen, standardHit, `@${wStandard}`))
  edges.push(res(nextE(), roll_normal_owed, pickupHit, `@${wSsr}`)) // SSR always → pickup when owed
  edges.push(res(nextE(), roll_normal_owed, srHit, `@${wSr}`))
  edges.push(res(nextE(), roll_normal_owed, rHit, `@${wR}`))
  edges.push(res(nextE(), roll_normal_open, srHit, `@${wSr}`))
  edges.push(res(nextE(), roll_normal_open, rHit, `@${wR}`))
  edges.push(res(nextE(), roll_forced_owed, pickupHit, '1')) // guaranteed SSR AND guaranteed pickup

  edges.push(res(nextE(), pickupHit, 'pickup_count_pickup', '1'))
  edges.push(res(nextE(), standardHit, 'standard_count_pickup', '1'))
  edges.push(res(nextE(), srHit, srCount, '1'))
  edges.push(res(nextE(), rHit, rCount, '1'))
  nodes.push(pool('pickup_count_pickup', labelFor('Pickup count')))
  nodes.push(pool('standard_count_pickup', labelFor('Standard count')))

  // GZ5.2 bookkeeping — all afterPull, all same-step.
  edges.push(afterPull(nextE(), pickupHit, pity, '=0'))
  edges.push(afterPull(nextE(), standardHit, pity, '=0'))
  edges.push(afterPull(nextE(), srHit, pity, '+1'))
  edges.push(afterPull(nextE(), rHit, pity, '+1'))

  edges.push(afterPull(nextE(), pickupHit, pullsMade, '+1'))
  edges.push(afterPull(nextE(), standardHit, pullsMade, '+1'))
  edges.push(afterPull(nextE(), srHit, pullsMade, '+1'))
  edges.push(afterPull(nextE(), rHit, pullsMade, '+1'))

  edges.push(afterPull(nextE(), pickupHit, ssrCount, '+1'))
  edges.push(afterPull(nextE(), standardHit, ssrCount, '+1'))

  edges.push(afterPull(nextE(), roll_forced_open, ceilingHits, '+1'))
  edges.push(afterPull(nextE(), roll_forced_owed, ceilingHits, '+1'))

  edges.push(afterPull(nextE(), standardHit, missedPickup, '=1'))
  edges.push(afterPull(nextE(), pickupHit, missedPickup, '=0'))
  // sr_hit / r_hit touch neither pity's reset nor missed_pickup — the
  // guarantee persists across any number of SR/R pulls (GZ5.2).
}

/** GZ6 — the one Parameter shared read-only by all three zones' funding edges.
 *  Left unprefixed (implementation note 3) — it already sorts first in the
 *  Inputs panel ahead of every `zoneN_...` id. Label carries "(whole number)"
 *  (GZ6 round 4, after review) — the engine does not itself validate a
 *  Parameter's value, and the global End's termination contract (GZ3.5)
 *  only holds for a safe positive integer; this is a light in-UI hint, not
 *  enforcement (no engine or common Inputs-UI validation added here). */
export function buildSharedParameter(): LoopNode {
  return parameter('pulls_per_zone', 'Pulls per zone (whole number)', PULLS_PER_ZONE)
}

/** GZ7.2 — the single-run display Registers, NOT Monte Carlo tracked. These
 *  sit together in the shared comparison area, outside any per-zone frame,
 *  so — unlike every other node (implementation note 3) — they KEEP an
 *  explicit zone tag; it is the only thing telling them apart here. IDs carry
 *  a `cmpN_` sort prefix (implementation note 4) so the Summary panel's raw-
 *  id sort (`ModelPanels.tsx`'s `byId`) lands in Free -> Standard -> Pickup
 *  order instead of alphabetical (`hit_rate_free/pickup/standard` then
 *  `pickup_share_pickup`).
 *
 *  The 4th Register was `pickup_share_pickup = pickup_count / ssr_count`
 *  (share of Zone 3's own SSRs that were pickup) — that divides 0/0 the
 *  moment the Template opens (before any pull), surfacing as a visible error
 *  badge with no user action taken yet. Fixed to `pickup_count / pulls_per_zone`
 *  — pickup rate per PULL, not per SSR — since `pulls_per_zone` is a non-zero
 *  constant, this can never divide by zero at rest. This changes what the
 *  number means (a rarer, lower rate than "share of SSRs"), not just its
 *  formula — a "share of SSRs" framing has no well-defined value at rest, so
 *  it was dropped rather than patched. */
export function buildComparisonRegisters(): LoopNode[] {
  return [
    register('cmp1_hit_rate_free', `Hit rate — ${ZONE_TITLE.free}`, '@ssr_count_free / @pulls_per_zone', 'percent'),
    register(
      'cmp2_hit_rate_standard',
      `Hit rate — ${ZONE_TITLE.standard}`,
      '@ssr_count_standard / @pulls_per_zone',
      'percent',
    ),
    register(
      'cmp3_hit_rate_pickup',
      `Hit rate — ${ZONE_TITLE.pickup}`,
      '@ssr_count_pickup / @pulls_per_zone',
      'percent',
    ),
    register(
      'cmp4_pickup_rate_pickup',
      `Pickup rate — ${ZONE_TITLE.pickup}`,
      '@pickup_count_pickup / @pulls_per_zone',
      'percent',
    ),
  ]
}

/** GZ3.5 round 4 — the global `End`'s ids, exported so the engine fixture
 *  test can address them directly (mirrors `TRACKED_POOLS` / `paramId`). */
export const TERMINATION_FUEL_ID = 'termination_fuel'
export const GLOBAL_END_ID = 'all_zones_done'

/**
 * GZ3.5 round 4 — exactly ONE global `End`, gated by all three zones having
 * actually produced `pulls_per_zone` results (`pulls_made_<zone> >=
 * @pulls_per_zone`, AND-combined directly on the `End` node — multiple
 * activators on one target already AND together, GZ4/GZ5's same mechanism,
 * no new engine capability). `pulls_made` is used rather than
 * `ticket_<zone> <= 0` for two reasons verified directly against `step.ts`
 * before this was written (see the design doc's GZ3.5/GZ-D8): ticket-
 * emptiness is ALSO true before step 1 ever funds anything (an immediate
 * false-positive), and `pulls_made` is the more precise completion signal
 * regardless (a zone actually PRODUCED its `N` results, not merely spent its
 * funding).
 *
 * The `End` pulls from `termination_fuel`, a STANDING Pool (`initial: 1,
 * capacity: 1`, fed and drained by nothing else in the graph) — never a live
 * pulse. Its balance has been committed since step 1, long before the
 * AND-gate can ever open, so there is no same-step Pool arrival for the
 * lag rule (`availOf` reads `S[]`, the previous step's committed value) to
 * apply to — the exact `Source -> Pool -> End` relay lag (and the
 * `Source -> End` "push to a non-Pool" hard block) the design doc's GZ-D8
 * checked directly against `step.ts` and rejected.
 *
 * Both `termination_fuel` and the `End` are pure termination plumbing —
 * excluded from `TRACKED_POOLS`, `DEFAULT_TIMELINE_SERIES`, and (being
 * neither a Parameter nor a Register) the Inputs/Summary panels.
 */
function buildGlobalTermination(zones: ZoneKey[]): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes: LoopNode[] = [
    pool(TERMINATION_FUEL_ID, 'Completion signal', 1, 1),
    end(GLOBAL_END_ID, 'All zones complete'),
  ]
  const edges: LoopEdge[] = [res('e_termination_fuel', TERMINATION_FUEL_ID, GLOBAL_END_ID, 'all')]
  for (const zone of zones) {
    edges.push(act(`e_termination_gate_${zone}`, `pulls_made_${zone}`, GLOBAL_END_ID, '>= @pulls_per_zone'))
  }
  return { nodes, edges }
}

/** The full graph: all three zones + the shared Parameter + comparison
 *  Registers + the global termination structure (GZ3.5 round 4). */
export function buildGachaBannerZonesGraph(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const zones: ZoneKey[] = ['free', 'standard', 'pickup']
  const nodes: LoopNode[] = [buildSharedParameter(), ...buildComparisonRegisters()]
  const edges: LoopEdge[] = []
  for (const z of zones) {
    const built = buildZone(z)
    nodes.push(...built.nodes)
    edges.push(...built.edges)
  }
  const termination = buildGlobalTermination(zones)
  nodes.push(...termination.nodes)
  edges.push(...termination.edges)
  return { nodes, edges }
}

/** GZ7.1 — the fixed Monte Carlo tracked-Pool set. */
export const TRACKED_POOLS = [
  'pulls_made_free',
  'ssr_count_free',
  'pulls_made_standard',
  'ssr_count_standard',
  'ceiling_hits_standard',
  'pulls_made_pickup',
  'ssr_count_pickup',
  'ceiling_hits_pickup',
  'pickup_count_pickup',
  'standard_count_pickup',
]

/** Timeline default (curated — Hanrim, 2026-09-13): one headline result per
 *  zone (SSR count) plus Zone 3's pickup count, not the full TRACKED_POOLS
 *  set — a first-time viewer sees 4 lines, not 10. */
export const DEFAULT_TIMELINE_SERIES = ['ssr_count_free', 'ssr_count_standard', 'ssr_count_pickup', 'pickup_count_pickup']

/** Node ids that are activator/pity "control" state, not the main resource
 *  flow — the generator lays these out in their own lower band per zone
 *  (implementation note 3 / Hanrim's "flow on top, control below"), and the
 *  Parameter nodes among them already sort into place via `paramId`. */
export function isControlNode(id: string): boolean {
  return (
    id.startsWith('zone1_') ||
    id.startsWith('zone2_') ||
    id.startsWith('zone3_') ||
    id === 'pulls_per_zone' ||
    id.startsWith('pity_') ||
    id === 'missed_pickup_pickup'
  )
}
