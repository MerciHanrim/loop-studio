// docs/gacha-banner-zones.md (GZ) — the 3-zone gacha Template's acceptance
// tests, GZ8's items in order. Built from `gachaBannerZonesGraph.ts`'s shared
// graph builder (also used by the example-JSON generator), not a hand-copied
// second graph — so this test and the shipped Template can never drift apart.
//
// GZ3.5's exact pull horizon: `steps = pulls_per_zone + 1` (verified against
// `step.ts`'s `actOf(n) === 'onStart' && prev.step === 0` — the funding push
// commits at step 1, so pulls occupy steps `2..pulls_per_zone+1`).
//
// GZ3.5 round 4: the global `End`'s own horizon is one step LATER —
// `pulls_per_zone + 2` — since its AND-gate (`pulls_made_<zone> >=
// @pulls_per_zone` for all three zones) reads `S[]`, the state as of the
// START of the step it gates, so the earliest it can observe every zone's
// `pulls_made` having just reached `pulls_per_zone` (at the end of step
// `pulls_per_zone + 1`) is the FOLLOWING step.

import { describe, expect, it } from 'vitest'
import { evaluate } from '../model/expr/evaluate'
import { parse } from '../model/expr/parse'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'
import {
  DEFAULT_TIMELINE_SERIES,
  GLOBAL_END_ID,
  HARD_PITY_PICKUP,
  HARD_PITY_STANDARD,
  PULLS_PER_ZONE,
  TERMINATION_FUEL_ID,
  TRACKED_POOLS,
  buildComparisonRegisters,
  buildGachaBannerZonesGraph,
  buildSharedParameter,
  buildZone,
  paramId,
} from './gachaBannerZonesGraph'

const HORIZON = PULLS_PER_ZONE + 1 // GZ3.5 — the pull horizon, unchanged by round 4
const END_STEP = PULLS_PER_ZONE + 2 // GZ3.5 round 4 — the global End's own horizon

function run(nodes: LoopNode[], edges: LoopEdge[], n: number, seed: number): SimState {
  let st: SimState = initSim(nodes)
  for (let i = 0; i < n; i++) st = step(nodes, edges, st, seed, 2).state
  return st
}

/** Per-step trace of a fixed set of ids' values — used by the RNG
 *  stream-isolation tests (GZ8 item 2) to compare full step-by-step
 *  histories, not just final totals (a coincidental match on the final sum
 *  could hide diverging intermediate steps). */
function runTrace(nodes: LoopNode[], edges: LoopEdge[], n: number, seed: number, ids: string[]): number[][] {
  let st: SimState = initSim(nodes)
  const trace: number[][] = []
  for (let i = 0; i < n; i++) {
    st = step(nodes, edges, st, seed, 2).state
    trace.push(ids.map((id) => st.values[id] ?? 0))
  }
  return trace
}

function fullGraph() {
  return buildGachaBannerZonesGraph()
}

describe('GZ8 item 6 — conservation, per zone', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: ssr+sr+r == pulls_made == pulls_per_zone, every zone', (seed) => {
    const { nodes, edges } = fullGraph()
    const st = run(nodes, edges, HORIZON, seed)
    for (const zone of ['free', 'standard', 'pickup']) {
      const ssr = st.values[`ssr_count_${zone}`] ?? 0
      const sr = st.values[`sr_count_${zone}`] ?? 0
      const r = st.values[`r_count_${zone}`] ?? 0
      const pulls = st.values[`pulls_made_${zone}`] ?? 0
      expect(ssr + sr + r).toBe(pulls)
      expect(pulls).toBe(PULLS_PER_ZONE)
    }
  })

  it.each([1, 2, 3, 4, 5])('seed %i: pickup + standard == ssr (Zone 3); ceiling_hits <= ssr_count (Zones 2-3)', (seed) => {
    const { nodes, edges } = fullGraph()
    const st = run(nodes, edges, HORIZON, seed)
    const ssrPickup = st.values.ssr_count_pickup ?? 0
    const pickup = st.values.pickup_count_pickup ?? 0
    const standard = st.values.standard_count_pickup ?? 0
    expect(pickup + standard).toBe(ssrPickup)
    expect(st.values.ceiling_hits_standard ?? 0).toBeLessThanOrEqual(st.values.ssr_count_standard ?? 0)
    expect(st.values.ceiling_hits_pickup ?? 0).toBeLessThanOrEqual(ssrPickup)
  })
})

describe('GZ8 item 3 — the fixed horizon’s exact contract (GZ3.5 round 4)', () => {
  it('at steps = pulls_per_zone + 1: pulls_made == N, tickets == 0, ended still false', () => {
    const { nodes, edges } = fullGraph()
    const st = run(nodes, edges, HORIZON, 1)
    for (const zone of ['free', 'standard', 'pickup']) {
      expect(st.values[`pulls_made_${zone}`]).toBe(PULLS_PER_ZONE)
      expect(st.values[`ticket_${zone}`]).toBe(0)
    }
    // the AND-gate reads S[] from the START of this step (last step's
    // pulls_made, not this step's) — it JUST reached pulls_per_zone THIS
    // step, so the gate cannot observe it satisfied until the NEXT step.
    expect(st.ended).toBe(false)
  })

  it.each([1, 2, 3])('seed %i: no premature termination — ended is false at every step 1..pulls_per_zone+1', (seed) => {
    const { nodes, edges } = fullGraph()
    let st: SimState = initSim(nodes)
    for (let i = 0; i < HORIZON; i++) {
      st = step(nodes, edges, st, seed, 2).state
      // in particular NOT at step 1 — the ticket_<zone> <= 0 false-positive
      // round 4 found and rejected would have opened the gate right here,
      // before a single pull (every ticket Pool starts at initial 0).
      expect(st.ended).toBe(false)
    }
  })

  it.each([1, 2, 3])('seed %i: ended becomes true at exactly pulls_per_zone + 2, not one step earlier or later', (seed) => {
    const { nodes, edges } = fullGraph()
    let st: SimState = initSim(nodes)
    for (let i = 0; i < END_STEP; i++) {
      st = step(nodes, edges, st, seed, 2).state
      const expectedEnded = i + 1 === END_STEP // i is 0-indexed; step number is i+1
      expect(st.ended).toBe(expectedEnded)
    }
    expect(st.values[GLOBAL_END_ID]).toBeUndefined() // End is not a Pool value
    expect(st.values[TERMINATION_FUEL_ID]).toBe(0) // spent doing its one job — `flow: "all"` drains it to fire the End
  })

  it('the End firing at pulls_per_zone + 2 changes no other value from pulls_per_zone + 1', () => {
    const { nodes, edges } = fullGraph()
    const atHorizon = run(nodes, edges, HORIZON, 1)
    const r = step(nodes, edges, atHorizon, 1, 2) // the one step that fires the End
    expect(r.state.ended).toBe(true)
    const { [GLOBAL_END_ID]: _end, [TERMINATION_FUEL_ID]: _fuel, ...restAfter } = r.state.values
    const { [GLOBAL_END_ID]: _end0, [TERMINATION_FUEL_ID]: _fuel0, ...restBefore } = atHorizon.values
    expect(restAfter).toEqual(restBefore)
  })

  it('running additional steps past pulls_per_zone + 2 changes no value and produces no further event', () => {
    const { nodes, edges } = fullGraph()
    const atEnd = run(nodes, edges, END_STEP, 1)
    expect(atEnd.ended).toBe(true)
    let st = atEnd
    for (let i = 0; i < 5; i++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      expect(r.report.fired).toEqual([])
      expect(st.ended).toBe(true)
    }
    expect(st.values).toEqual(atEnd.values)
  })

  it('Reset and re-run with the same seed reproduces the same termination step and the same results', () => {
    const seed = 7
    const a = fullGraph()
    const b = fullGraph()
    let stA: SimState = initSim(a.nodes)
    let stB: SimState = initSim(b.nodes)
    let endStepA = -1
    let endStepB = -1
    for (let i = 1; i <= END_STEP; i++) {
      stA = step(a.nodes, a.edges, stA, seed, 2).state
      stB = step(b.nodes, b.edges, stB, seed, 2).state
      if (stA.ended && endStepA < 0) endStepA = i
      if (stB.ended && endStepB < 0) endStepB = i
    }
    expect(endStepA).toBe(END_STEP)
    expect(endStepB).toBe(END_STEP)
    expect(stA.values).toEqual(stB.values)
  })

  it('the pulls_per_zone contract holds at a second safe positive integer, not just the shipped default (GZ8 item 10)', () => {
    const N = 5
    const { nodes, edges } = fullGraph()
    ;(nodes.find((n) => n.id === 'pulls_per_zone')!.data as { value: number }).value = N
    let st: SimState = initSim(nodes)
    for (let i = 1; i <= N + 2; i++) {
      st = step(nodes, edges, st, 1, 2).state
      if (i <= N + 1) expect(st.ended).toBe(false)
      else expect(st.ended).toBe(true)
    }
    for (const zone of ['free', 'standard', 'pickup']) {
      expect(st.values[`pulls_made_${zone}`]).toBe(N)
    }
  })
})

// GZ6 round 4 (post-review correction) — `pulls_per_zone` must be a safe
// positive integer (`N >= 1`); that is the ONLY supported contract, and the
// Parameter's own label now says so ("(whole number)" / "(정수)" /
// "（整数）"). These are NOT acceptance tests for a feature — they pin
// today's DEFENSIVE (i.e. unvalidated, unguarded) behavior for input the
// engine does not itself reject, purely so a future change can't silently
// make either case worse without a test noticing. Neither case is something
// a user should rely on, and this PR does not add engine- or common-Inputs-
// UI-level validation to prevent either input in the first place.
describe('GZ6 round 4 — unsupported input, current defensive behavior only (NOT a supported feature)', () => {
  it('unsupported input — N = 0 opens the End’s gate from step 1', () => {
    const { nodes, edges } = fullGraph()
    ;(nodes.find((n) => n.id === 'pulls_per_zone')!.data as { value: number }).value = 0
    const st = step(nodes, edges, initSim(nodes), 1, 2).state
    // pulls_made_<zone> starts at 0, and `0 >= 0` is already true — an
    // immediate false-positive termination for this out-of-contract input.
    expect(st.ended).toBe(true)
  })

  it('unsupported input — a non-integer N silently rounds the real pull count UP to ceil(N), not down', () => {
    // Traced directly against the engine before writing this assertion —
    // an earlier draft of this note assumed a non-integer N makes each zone
    // idle on an un-spendable fractional remainder forever (floor(N) pulls,
    // gate never opens). That assumption was WRONG: a router's resource pull
    // is satisfied by WHATEVER is available up to its want, not an exact
    // match, so the leftover 0.5 ticket funds one MORE full pull
    // (afterPull's `+1` books a whole pull regardless of the fractional
    // amount that actually moved) — `pulls_made` reaches `ceil(N)`, ticket
    // lands exactly on `0`, and the Template terminates, just at a silently
    // rounded-up pull count the Parameter's displayed value never admits
    // to. Pinned here as CURRENT DEFENSIVE BEHAVIOR for out-of-contract
    // input, not a designed rounding feature — do not build product copy or
    // UX around this number matching being reliable.
    const N = 10.5
    const ceilN = 11
    const { nodes, edges } = fullGraph()
    ;(nodes.find((n) => n.id === 'pulls_per_zone')!.data as { value: number }).value = N
    let st: SimState = initSim(nodes)
    for (let i = 1; i <= ceilN + 2; i++) {
      st = step(nodes, edges, st, 1, 2).state
      if (i <= ceilN + 1) expect(st.ended).toBe(false)
      else expect(st.ended).toBe(true)
    }
    for (const zone of ['free', 'standard', 'pickup']) {
      expect(st.values[`pulls_made_${zone}`]).toBe(ceilN)
      expect(st.values[`ticket_${zone}`]).toBe(0)
    }
  })
})

// Zone 2's forced route is one gate; Zone 3's is two (open/owed) — GZ5 round 3.
const FORCED_IDS: Record<'standard' | 'pickup', string[]> = {
  standard: ['forced_ssr_standard'],
  pickup: ['roll_forced_open_pickup', 'roll_forced_owed_pickup'],
}

describe('GZ8 item 4 — the tunable pity ceiling holds per zone', () => {
  // A deterministic non-SSR roll (weights 0:0:1) isolates the ceiling: every
  // natural roll is R, so only the forced route can ever produce an SSR.
  function forcedOnlyGraph(zone: 'standard' | 'pickup') {
    const built = buildZone(zone)
    const nodes = [buildSharedParameter(), ...built.nodes]
    const edges = [...built.edges]
    const wR = nodes.find((n) => n.id === paramId(zone, 'w_r'))!
    const wSsr = nodes.find((n) => n.id === paramId(zone, 'w_ssr'))!
    const wSr = nodes.find((n) => n.id === paramId(zone, 'w_sr'))!
    ;(wR.data as { value: number }).value = 1
    ;(wSsr.data as { value: number }).value = 0
    ;(wSr.data as { value: number }).value = 0
    return { nodes, edges }
  }

  it.each(['standard', 'pickup'] as const)('%s: the gap between forced SSRs never exceeds the ceiling; pity resets same step', (zone) => {
    const { nodes, edges } = forcedOnlyGraph(zone)
    let st: SimState = initSim(nodes)
    let sincePity0 = 0
    for (let i = 0; i < HORIZON; i++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      const forced = FORCED_IDS[zone].some((id) => r.report.fired.includes(id))
      // i === 0 is the funding step (GZ3.5) — nothing pulls yet, so it must
      // not count toward the pity gap.
      if (i >= 1) {
        sincePity0++
        // pity increments only on non-SSR — with weights forcing R, every
        // NATURAL pull is a non-SSR miss, so pity should climb by exactly 1
        // per pull until the ceiling forces, then reset to 0 the SAME step.
        if (forced) {
          expect(st.values[`pity_${zone}`]).toBe(0)
          expect(sincePity0).toBeLessThanOrEqual(HARD_PITY_STANDARD)
          sincePity0 = 0
        }
      }
    }
    // the ceiling must have actually fired at least once over 200 pulls at a
    // forced cadence of every 80 (per HARD_PITY_STANDARD/HARD_PITY_PICKUP).
    expect(st.values[`ceiling_hits_${zone}`]).toBeGreaterThan(0)
  })

  it.each(['standard', 'pickup'] as const)('%s: a forced pull is a guaranteed SSR; pity increments only on non-SSR', (zone) => {
    const { nodes, edges } = forcedOnlyGraph(zone)
    let st: SimState = initSim(nodes)
    let prevPity = 0
    const rHitId = zone === 'standard' ? 'r_hit_standard' : 'r_hit_pickup'
    const srHitId = zone === 'standard' ? 'sr_hit_standard' : 'sr_hit_pickup'
    for (let i = 0; i < HORIZON; i++) {
      const before = st.values[`pity_${zone}`] ?? 0
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      const forced = FORCED_IDS[zone].some((id) => r.report.fired.includes(id))
      if (forced) {
        // a forced pull always lands SSR — never SR/R this step.
        expect(r.report.fired.includes(srHitId)).toBe(false)
        expect(r.report.fired.includes(rHitId)).toBe(false)
      } else if (r.report.fired.includes(rHitId)) {
        expect(st.values[`pity_${zone}`]).toBe(before + 1)
      }
      prevPity = st.values[`pity_${zone}`] ?? 0
    }
    expect(prevPity).toBeGreaterThanOrEqual(0)
  })
})

describe('GZ8 item 5 — the four-path pickup-guarantee structure holds (Zone 3 only, GZ5 round 3)', () => {
  const FOUR_PATHS = ['roll_normal_open_pickup', 'roll_normal_owed_pickup', 'roll_forced_open_pickup', 'roll_forced_owed_pickup']
  const FOUR_HITS = ['pickup_hit_pickup', 'standard_hit_pickup', 'sr_hit_pickup', 'r_hit_pickup']

  function pickupGraph(weights: { ssr: number; sr: number; r: number }) {
    const built = buildZone('pickup')
    const nodes = [buildSharedParameter(), ...built.nodes]
    const edges = [...built.edges]
    const set = (id: string, value: number) => {
      ;(nodes.find((n) => n.id === id)!.data as { value: number }).value = value
    }
    set(paramId('pickup', 'w_ssr'), weights.ssr)
    set(paramId('pickup', 'w_sr'), weights.sr)
    set(paramId('pickup', 'w_r'), weights.r)
    return { nodes, edges }
  }

  const setInitial = (nodes: LoopNode[], id: string, value: number) => {
    ;(nodes.find((n) => n.id === id)!.data as { initial: number }).initial = value
  }

  // Force every natural roll to SSR (1:0:0) so the pickup split is exercised
  // on every single pull, regardless of the pity ceiling.
  const forcedSsrEverySplit = () => pickupGraph({ ssr: 1, sr: 0, r: 0 })

  it('exactly one of the four paths is active for every (pity-state × guarantee-state) combination', () => {
    const combos: [number, number][] = [
      [0, 0], // normal, not owed
      [0, 1], // normal, owed
      [HARD_PITY_STANDARD - 1, 0], // forced, not owed
      [HARD_PITY_STANDARD - 1, 1], // forced, owed
    ]
    for (const [pity, missed] of combos) {
      const { nodes, edges } = forcedSsrEverySplit()
      setInitial(nodes, 'pity_pickup', pity)
      setInitial(nodes, 'missed_pickup_pickup', missed)
      let st: SimState = initSim(nodes)
      st = step(nodes, edges, st, 1, 2).state // step 1 (GZ3.5): funding only, nothing pulls yet
      const r = step(nodes, edges, st, 1, 2) // step 2: the first real pull
      const activePaths = FOUR_PATHS.filter((id) => r.report.fired.includes(id))
      expect(activePaths).toHaveLength(1)
    }
  })

  it('exactly one of the four shared hit Gates fires every step (branch-outcome sum is exactly 1)', () => {
    const { nodes, edges } = pickupGraph({ ssr: 10, sr: 90, r: 900 })
    let st: SimState = initSim(nodes)
    for (let i = 0; i < HORIZON; i++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      if (i === 0) continue // the funding step (GZ3.5) — nothing pulls yet
      const hits = FOUR_HITS.filter((id) => r.report.fired.includes(id))
      expect(hits).toHaveLength(1)
    }
  })

  it('pickup + standard + sr + r == pulls_made, exactly, every run', () => {
    const { nodes, edges } = pickupGraph({ ssr: 10, sr: 90, r: 900 })
    const st = run(nodes, edges, HORIZON, 1)
    const total =
      (st.values.pickup_count_pickup ?? 0) +
      (st.values.standard_count_pickup ?? 0) +
      (st.values.sr_count_pickup ?? 0) +
      (st.values.r_count_pickup ?? 0)
    expect(total).toBe(st.values.pulls_made_pickup)
  })

  it('the last allowed pull can be an SSR and still conserves at the exact horizon', () => {
    // an all-SSR roll guarantees the FINAL pull (step horizon) is itself an
    // SSR — the exact case round 1-2's relay-Pool bug broke.
    const { nodes, edges } = forcedSsrEverySplit()
    const st = run(nodes, edges, HORIZON, 1)
    expect(st.values.pulls_made_pickup).toBe(PULLS_PER_ZONE)
    expect((st.values.pickup_count_pickup ?? 0) + (st.values.standard_count_pickup ?? 0)).toBe(
      st.values.ssr_count_pickup,
    )
  })

  // The single test this replaces ("after any standard SSR, the very next
  // SSR is pickup — natural or ceiling-forced alike") never actually
  // exercised the forced-owed branch: an all-SSR weighting resets pity to 0
  // on every single pull, so pity can never climb to the ceiling. Split into
  // two explicit, independently pinned cases — one per guarantee-fulfilling
  // path — using `setInitial` to place each run directly at the boundary it
  // claims to test, rather than hoping a long random run happens to pass
  // through it.
  it('owed + natural pity (pity=0): the natural-owed path fires and the SSR is a guaranteed pickup', () => {
    const { nodes, edges } = forcedSsrEverySplit() // every natural roll is SSR
    setInitial(nodes, 'pity_pickup', 0)
    setInitial(nodes, 'missed_pickup_pickup', 1)
    let st: SimState = initSim(nodes)
    st = step(nodes, edges, st, 1, 2).state // step 1 (GZ3.5): funding only
    const r = step(nodes, edges, st, 1, 2) // step 2: the first real pull
    expect(r.report.fired).toContain('roll_normal_owed_pickup')
    expect(r.report.fired).toContain('pickup_hit_pickup')
    expect(r.report.fired.includes('standard_hit_pickup')).toBe(false)
    expect(r.state.values.missed_pickup_pickup).toBe(0) // guarantee clears same step
  })

  it('owed + ceiling pity (pity=H-1): the forced-owed path fires, the SSR is a guaranteed pickup, ceiling clears same step', () => {
    const { nodes, edges } = forcedSsrEverySplit()
    setInitial(nodes, 'pity_pickup', HARD_PITY_PICKUP - 1)
    setInitial(nodes, 'missed_pickup_pickup', 1)
    let st: SimState = initSim(nodes)
    st = step(nodes, edges, st, 1, 2).state // step 1 (GZ3.5): funding only
    const r = step(nodes, edges, st, 1, 2) // step 2: the first real pull
    expect(r.report.fired).toContain('roll_forced_owed_pickup')
    expect(r.report.fired).toContain('pickup_hit_pickup')
    expect(r.report.fired.includes('standard_hit_pickup')).toBe(false)
    expect(r.state.values.pity_pickup).toBe(0) // ceiling resets pity same step
    expect(r.state.values.missed_pickup_pickup).toBe(0) // guarantee clears same step
    expect(r.state.values.ceiling_hits_pickup).toBe(1)
  })

  it('the guarantee persists across any number of intervening SR/R pulls', () => {
    // weights heavily favour R, so a "missed" state (if ever reached) should
    // survive many SR/R pulls before the next SSR resolves it.
    const { nodes, edges } = pickupGraph({ ssr: 10, sr: 90, r: 900 })
    let st: SimState = initSim(nodes)
    let owedSinceStep = -1
    for (let i = 0; i < HORIZON; i++) {
      const before = st.values.missed_pickup_pickup ?? 0
      const r = step(nodes, edges, st, 3, 2)
      st = r.state
      const isSrOrR = r.report.fired.includes('sr_hit_pickup') || r.report.fired.includes('r_hit_pickup')
      if (before === 1 && isSrOrR) {
        expect(st.values.missed_pickup_pickup).toBe(1) // unchanged by SR/R
        if (owedSinceStep < 0) owedSinceStep = i
      }
    }
    // the sweep must have actually exercised at least one owed-then-SR/R step
    // at these weights over 200 pulls.
    expect(owedSinceStep).toBeGreaterThanOrEqual(0)
  })

  it('a pickup SSR clears the guarantee the SAME step', () => {
    const { nodes, edges } = forcedSsrEverySplit()
    let st: SimState = initSim(nodes)
    for (let i = 0; i < HORIZON; i++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      if (r.report.fired.includes('pickup_hit_pickup')) {
        expect(st.values.missed_pickup_pickup).toBe(0)
      }
      if (r.report.fired.includes('standard_hit_pickup')) {
        expect(st.values.missed_pickup_pickup).toBe(1)
      }
    }
  })

  it('missed_pickup_pickup is always 0 or 1, never anything else', () => {
    const { nodes, edges } = forcedSsrEverySplit()
    let st: SimState = initSim(nodes)
    for (let i = 0; i < HORIZON; i++) {
      st = step(nodes, edges, st, 1, 2).state
      expect([0, 1]).toContain(st.values.missed_pickup_pickup)
    }
  })

  it('two consecutive pickups can occur naturally (a pickup roll does not owe a guarantee)', () => {
    // sweep a handful of seeds; at a fair 50/50 split over 200 forced-SSR
    // pulls, at least one seed must show back-to-back pickup hits.
    let sawConsecutive = false
    for (let seed = 1; seed <= 10 && !sawConsecutive; seed++) {
      const { nodes, edges } = forcedSsrEverySplit()
      let st: SimState = initSim(nodes)
      let prevWasPickup = false
      for (let i = 0; i < HORIZON; i++) {
        const r = step(nodes, edges, st, seed, 2)
        st = r.state
        const pickedUp = r.report.fired.includes('pickup_hit_pickup')
        if (pickedUp && prevWasPickup) sawConsecutive = true
        if (r.report.fired.includes('pickup_hit_pickup') || r.report.fired.includes('standard_hit_pickup')) {
          prevWasPickup = pickedUp
        }
      }
    }
    expect(sawConsecutive).toBe(true)
  })

  it('running additional steps past the horizon changes no value and produces no further event (Zone 3)', () => {
    const { nodes, edges } = pickupGraph({ ssr: 10, sr: 90, r: 900 })
    const atHorizon = run(nodes, edges, HORIZON, 1)
    let st = atHorizon
    for (let i = 0; i < 5; i++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      expect(r.report.fired).toEqual([])
    }
    expect(st.values).toEqual(atHorizon.values)
  })
})

describe('GZ8 item 2 — RNG stream isolation (not a claim of statistical independence)', () => {
  const FREE_IDS = ['pulls_made_free', 'ssr_count_free', 'sr_count_free', 'r_count_free']
  const NON_FREE_IDS = ['standard', 'pickup'].flatMap((zone) =>
    ['pulls_made', 'ssr_count', 'sr_count', 'r_count', 'pity', 'ceiling_hits'].map((role) => `${role}_${zone}`),
  )
  const ALL_ZONE_IDS = [
    ...FREE_IDS,
    ...['standard', 'pickup'].flatMap((zone) =>
      ['pulls_made', 'ssr_count', 'sr_count', 'r_count'].map((role) => `${role}_${zone}`),
    ),
  ]

  // Comparing only the FINAL summed totals (the previous version of these
  // tests) could coincidentally pass even if intermediate steps diverged —
  // two different per-step paths can land on the same final sum. Comparing
  // the full per-step trace closes that gap.
  it.each([1, 2, 3])('seed %i: deleting Zones 2-3 leaves Zone 1’s own full step trace byte-identical', (seed) => {
    const full = fullGraph()
    const traceFull = runTrace(full.nodes, full.edges, HORIZON, seed, FREE_IDS)

    const soloFree = buildZone('free')
    const nodesSolo = [buildSharedParameter(), ...soloFree.nodes]
    const traceSolo = runTrace(nodesSolo, soloFree.edges, HORIZON, seed, FREE_IDS)

    expect(traceSolo).toEqual(traceFull)
  })

  it.each([1, 2, 3])('seed %i: deleting Zone 1 leaves Zones 2-3’s own full step trace byte-identical', (seed) => {
    const full = fullGraph()
    const traceFull = runTrace(full.nodes, full.edges, HORIZON, seed, NON_FREE_IDS)

    const standard = buildZone('standard')
    const pickup = buildZone('pickup')
    const nodesNoFree = [buildSharedParameter(), ...standard.nodes, ...pickup.nodes]
    const edgesNoFree = [...standard.edges, ...pickup.edges]
    const traceNoFree = runTrace(nodesNoFree, edgesNoFree, HORIZON, seed, NON_FREE_IDS)

    expect(traceNoFree).toEqual(traceFull)
  })

  // Deletion alone doesn't rule out an id-independent stream keyed by, say,
  // array index or insertion order — reordering the SAME three zones in the
  // nodes/edges arrays must also leave every zone's own trace untouched,
  // since `sample()` keys purely off each element's own id (GZ3.2).
  it.each([1, 2, 3])('seed %i: reordering the zones in the nodes/edges arrays changes no zone’s own trace', (seed) => {
    const canonical = fullGraph()
    const traceCanonical = runTrace(canonical.nodes, canonical.edges, HORIZON, seed, ALL_ZONE_IDS)

    const free = buildZone('free')
    const standard = buildZone('standard')
    const pickup = buildZone('pickup')
    const reordered = {
      nodes: [buildSharedParameter(), ...pickup.nodes, ...standard.nodes, ...free.nodes],
      edges: [...pickup.edges, ...standard.edges, ...free.edges],
    }
    const traceReordered = runTrace(reordered.nodes, reordered.edges, HORIZON, seed, ALL_ZONE_IDS)

    expect(traceReordered).toEqual(traceCanonical)
  })
})

describe('GZ8 item 7 — determinism', () => {
  it('same graph + seed ⇒ byte-identical states across all three zones, same run', () => {
    const a = fullGraph()
    const b = fullGraph()
    const stA = run(a.nodes, a.edges, HORIZON, 42)
    const stB = run(b.nodes, b.edges, HORIZON, 42)
    expect(stA.values).toEqual(stB.values)
  })
})

describe('GZ8 item 8 — comparison Registers compute correctly, including zero-SSR / zero-pickup', () => {
  const resolverFor = (values: Record<string, number>, nodes: LoopNode[]) => (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return { ok: false as const, error: { code: 'unknown-ref' } as never }
    if (n.data.kind === 'parameter') return { ok: true as const, value: n.data.value }
    const v = values[id]
    return v == null ? { ok: false as const, error: { code: 'unknown-ref' } as never } : { ok: true as const, value: v }
  }

  it('hit_rate_<zone> is well-defined (0) even when ssr_count is 0', () => {
    const { nodes, edges } = fullGraph()
    // find a seed where at least one zone lands zero SSRs over the horizon —
    // not vanishingly rare at p ≈ 0.01 over 200 pulls (GZ7.2).
    let st: SimState | undefined
    for (let seed = 1; seed <= 200; seed++) {
      const candidate = run(nodes, edges, HORIZON, seed)
      if ((candidate.values.ssr_count_free ?? 0) === 0) {
        st = candidate
        break
      }
    }
    expect(st).toBeDefined()
    const registers = buildComparisonRegisters()
    const hitRateFree = registers.find((r) => r.id === 'cmp1_hit_rate_free')!
    const parsed = parse((hitRateFree.data as { expr: string }).expr)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = evaluate(parsed.ast, resolverFor(st!.values, nodes))
    expect(result).toEqual({ ok: true, value: 0 })
  })

  it('cmp4_pickup_rate_pickup is well-defined (0) even when pickup_count_pickup is 0 — never a 0/0 at rest', () => {
    // an all-non-SSR pickup zone (weights 0:0:1) never lands a NATURAL SSR,
    // but the pity ceiling still forces one periodically regardless of
    // weights — push the ceiling out past the horizon too, so this run
    // truly never lands any pickup at all. The denominator is the constant
    // `pulls_per_zone`, not `ssr_count_pickup`, so this is well-defined even
    // at the Template's very first, un-run open (the bug this formula fixes).
    const built = buildZone('pickup')
    const nodes = [buildSharedParameter(), ...built.nodes]
    const set = (id: string, value: number) => {
      ;(nodes.find((n) => n.id === id)!.data as { value: number }).value = value
    }
    set(paramId('pickup', 'w_ssr'), 0)
    set(paramId('pickup', 'w_sr'), 0)
    set(paramId('pickup', 'w_r'), 1)
    set(paramId('pickup', 'hard_pity'), PULLS_PER_ZONE + 10)
    const st = run(nodes, built.edges, HORIZON, 1)
    expect(st.values.ssr_count_pickup).toBe(0)
    expect(st.values.pickup_count_pickup).toBe(0)

    const registers = buildComparisonRegisters()
    const rate = registers.find((r) => r.id === 'cmp4_pickup_rate_pickup')!
    const parsed = parse((rate.data as { expr: string }).expr)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = evaluate(parsed.ast, resolverFor(st.values, nodes))
    expect(result).toEqual({ ok: true, value: 0 })
  })

  it('cmp4_pickup_rate_pickup is well-defined at the Template’s very first open, before any pull', () => {
    // GZ7.2 display Registers read Pool VALUES, which default to their
    // `initial` (0) before the graph is ever stepped — this is the exact
    // "opened, not yet run" state the 0/0 bug surfaced in.
    const { nodes } = buildGachaBannerZonesGraph()
    const st = initSim(nodes)
    const registers = buildComparisonRegisters()
    const rate = registers.find((r) => r.id === 'cmp4_pickup_rate_pickup')!
    const parsed = parse((rate.data as { expr: string }).expr)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = evaluate(parsed.ast, resolverFor(st.values, nodes))
    expect(result).toEqual({ ok: true, value: 0 })
  })
})

describe('GZ8 item 9 — Monte Carlo tracked set stays inside CELL_LIMIT', () => {
  it('TRACKED_POOLS × (the real MC steps config + 1) × a reasonable K stays well under CELL_LIMIT', async () => {
    // GZ3.5 round 4 — Monte Carlo's configured `steps` must be END_STEP
    // (pulls_per_zone + 2) to match the Template's real completion point,
    // not the pull horizon alone.
    const { CELL_LIMIT } = await import('./montecarlo')
    const K = 2000
    const cells = TRACKED_POOLS.length * (END_STEP + 1) * K
    expect(cells).toBeLessThan(CELL_LIMIT)
  })
})

describe('GZ7.1 round 4 — the global End’s termination plumbing is excluded from every tracked/display set', () => {
  it('termination_fuel and the global End never appear in TRACKED_POOLS or DEFAULT_TIMELINE_SERIES', () => {
    expect(TRACKED_POOLS).not.toContain(TERMINATION_FUEL_ID)
    expect(TRACKED_POOLS).not.toContain(GLOBAL_END_ID)
    expect(DEFAULT_TIMELINE_SERIES).not.toContain(TERMINATION_FUEL_ID)
    expect(DEFAULT_TIMELINE_SERIES).not.toContain(GLOBAL_END_ID)
  })

  it('termination_fuel and the global End are neither a Parameter nor a Register (never in Inputs/Summary)', () => {
    const { nodes } = fullGraph()
    const fuel = nodes.find((n) => n.id === TERMINATION_FUEL_ID)!
    const globalEnd = nodes.find((n) => n.id === GLOBAL_END_ID)!
    expect(fuel.data.kind).toBe('pool')
    expect(globalEnd.data.kind).toBe('end')
  })
})
