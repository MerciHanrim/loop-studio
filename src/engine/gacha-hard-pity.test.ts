// docs/example-gacha-simulator.md GS10-3 — the hard-pity content proof.
//
// GS10-1/GS11-D1 proved a hard pity was NOT expressible with `loop-state/1`
// (the reset always lands a step late, or resets unconditionally every step).
// docs/conditional-state-update.md (CSU, `loop-state/3`) closed that gap with
// a post-pull conditional `label` (Phase 2.5). `gacha-pity-timing.probe.test.ts`
// proved the MECHANISM works, on a deliberately minimal binary (SSR-vs-not)
// deterministic graph — it never exercises a NATURAL SSR (a probabilistic
// roll landing SSR before the ceiling), only the forced one.
//
// This file proves the mechanism holds in the REALISTIC gacha economy GS2
// describes: a funded wallet, a per-pull cost, and a probabilistic SSR / SR / R
// categorical draw (GS2.1/GS2.2) — with `HARD_PITY = 3` layered on top exactly
// as GS10-3 scopes it. No engine change; `examples/gacha-simulator.json`, a
// bundled Template entry, `@parameter` activators, and the 3-zone public
// Template are explicitly OUT of scope here (GS10 slices 2/3-later, 4, 5).
//
// HARD_PITY = 3: `pity` counts consecutive non-SSR pulls; the ceiling forces
// on the pull where `pity` would otherwise reach 3 (i.e. the gate flips at
// `pity >= HARD_PITY - 1 = 2`, matching CSU9-D2 / the probe's convention).

import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

const HARD_PITY = 3
const PULL_COST = 1

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const gate = (id: string, distribution: 'deterministic' | 'probabilistic' = 'deterministic'): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow },
})
const afterPullLabel = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})

type Row = { step: number; v: Record<string, number>; fired: string[] }

function run(nodes: LoopNode[], edges: LoopEdge[], n: number, seed = 1): Row[] {
  let st: SimState = initSim(nodes)
  const rows: Row[] = [{ step: 0, v: { ...st.values }, fired: [...st.fired] }]
  for (let i = 0; i < n; i++) {
    const r = step(nodes, edges, st, seed)
    st = r.state
    rows.push({ step: st.step, v: { ...st.values }, fired: r.report.fired })
  }
  return rows
}

// ── the shared economy (GS2.1) ──────────────────────────────────────────
// `wallet` is the sole funding Pool (a large-initial-value Pool rather than
// GS2.1's literal `fund_budget` onStart Source: a Source's step-1 push isn't
// pullable until step 2, SEMANTICS.md §3 — a funding-choreography concern GS9
// already covers separately (item 1) and orthogonal to what this file tests,
// pity timing). `pulls_made`/`spent_total` are declared here but populated
// below, by the roll's own result gates — see the note there for why.
function economyNodesAndEdges(walletInitial = 100_000) {
  const nodes: LoopNode[] = [
    pool('wallet', walletInitial),
    pool('pulls_made', 0),
    pool('spent_total', 0),
  ]
  return { nodes, edges: [] as LoopEdge[] }
}

// ── the hard-pity roll (GS2.2 + CSU) ────────────────────────────────────
// `wallet` pays for exactly one of `roll_gate` (pity < ceiling) or
// `forced_ssr` (pity >= ceiling), gated by activators on `pity` — the same
// pattern gacha-pity-timing.probe.test.ts already proved. `roll_gate` is a
// PROBABILISTIC 3-way categorical (SSR / SR / R, GS4 weights 6:51:943); each
// branch lands on its own single-output deterministic Gate so that Gate's own
// `fired` status is a Phase-2.5 `afterPull` source (a Pool can't be one).
//
// `pulls_made`/`spent_total` are booked from these SAME four result gates
// (`ssr_hit`/`sr_hit`/`r_hit`/`forced_ssr`), not from a separate Converter
// upstream of the payment: an earlier draft paid `wallet` twice per pull (once
// into a `buy_pull` Converter for the pulls_made/spent_total bookkeeping, once
// again into whichever roll gate actually fired) and let payment and result
// run as two independent, potentially-diverging pulls — since exactly one
// result gate fires per pull, booking off that SAME gate's `fired` status
// makes "a pull happened" and "the wallet was charged for it" the same event,
// by construction (Hanrim, PR #184 review round 1).
function hardPityRollNodesAndEdges(deterministicRoll: false | 'ssr' | 'non-ssr' = false) {
  const nodes: LoopNode[] = [
    pool('pity', 0),
    gate('roll_gate', deterministicRoll ? 'deterministic' : 'probabilistic'),
    gate('forced_ssr'),
    gate('ssr_hit'),
    gate('sr_hit'),
    gate('r_hit'),
    pool('ssr_count', 0),
    pool('sr_count', 0),
    pool('r_count', 0),
  ]
  const rollWeights =
    deterministicRoll === 'ssr'
      ? { ssr: '1', sr: '0', r: '0' } // forces the natural-SSR branch every non-ceiling pull
      : deterministicRoll === 'non-ssr'
        ? { ssr: '0', sr: '0', r: '1' } // forces R every non-ceiling pull (never natural SSR)
        : { ssr: '6', sr: '51', r: '943' } // GS4's real weights
  const edges: LoopEdge[] = [
    res('e_roll_in', 'wallet', 'roll_gate', String(PULL_COST)),
    act('a_roll', 'pity', 'roll_gate', `< ${HARD_PITY - 1}`),
    res('e_forced_in', 'wallet', 'forced_ssr', String(PULL_COST)),
    act('a_forced', 'pity', 'forced_ssr', `>= ${HARD_PITY - 1}`),

    res('e_roll_ssr', 'roll_gate', 'ssr_hit', rollWeights.ssr),
    res('e_roll_sr', 'roll_gate', 'sr_hit', rollWeights.sr),
    res('e_roll_r', 'roll_gate', 'r_hit', rollWeights.r),
    res('e_ssr_out', 'ssr_hit', 'ssr_count', '1'),
    res('e_sr_out', 'sr_hit', 'sr_count', '1'),
    res('e_r_out', 'r_hit', 'r_count', '1'),
    res('e_forced_out', 'forced_ssr', 'ssr_count', '1'),

    // both a NATURAL SSR (ssr_hit) and a FORCED one (forced_ssr) reset pity
    // to 0 THIS step (CSU3-2 same-step visibility) — the property GS11-D1
    // proved unreachable and CSU exists to close.
    afterPullLabel('l_reset_natural', 'ssr_hit', 'pity', '=0'),
    afterPullLabel('l_reset_forced', 'forced_ssr', 'pity', '=0'),
    // a non-SSR result (SR or R) increments pity by exactly 1 this step.
    afterPullLabel('l_inc_sr', 'sr_hit', 'pity', '+1'),
    afterPullLabel('l_inc_r', 'r_hit', 'pity', '+1'),

    // exactly one of these four fires per pull — booking pulls_made/spent_total
    // off the SAME gate that produced the result (rather than a separate
    // payment Converter) ties "a pull happened" and "it was paid for" to one
    // event; see the function comment above.
    afterPullLabel('l_pulls_ssr', 'ssr_hit', 'pulls_made', '+1'),
    afterPullLabel('l_pulls_sr', 'sr_hit', 'pulls_made', '+1'),
    afterPullLabel('l_pulls_r', 'r_hit', 'pulls_made', '+1'),
    afterPullLabel('l_pulls_forced', 'forced_ssr', 'pulls_made', '+1'),
    afterPullLabel('l_spent_ssr', 'ssr_hit', 'spent_total', `+${PULL_COST}`),
    afterPullLabel('l_spent_sr', 'sr_hit', 'spent_total', `+${PULL_COST}`),
    afterPullLabel('l_spent_r', 'r_hit', 'spent_total', `+${PULL_COST}`),
    afterPullLabel('l_spent_forced', 'forced_ssr', 'spent_total', `+${PULL_COST}`),
  ]
  return { nodes, edges }
}

function hardPityGraph(deterministicRoll: false | 'ssr' | 'non-ssr' = false, walletInitial = 100_000) {
  const economy = economyNodesAndEdges(walletInitial)
  const roll = hardPityRollNodesAndEdges(deterministicRoll)
  return { nodes: [...economy.nodes, ...roll.nodes], edges: [...economy.edges, ...roll.edges] }
}

// ── the baseline: the SAME economy, no pity at all (GS2 v1 as documented) ──
// `roll_gate` is unconditionally active (no `forced_ssr`, no activators, no
// `pity`) — this is the "existing no-ceiling basic model" GS10-3 compares
// against, built to the identical weights/economy so the comparison isolates
// exactly the hard-pity mechanism's effect. `pulls_made`/`spent_total` are
// booked off the three result gates, same reasoning as the hard-pity roll.
function noPityBaselineGraph() {
  const economy = economyNodesAndEdges()
  const nodes: LoopNode[] = [
    ...economy.nodes,
    gate('roll_gate', 'probabilistic'),
    gate('ssr_hit'),
    gate('sr_hit'),
    gate('r_hit'),
    pool('ssr_count', 0),
    pool('sr_count', 0),
    pool('r_count', 0),
  ]
  const edges: LoopEdge[] = [
    ...economy.edges,
    res('e_roll_in', 'wallet', 'roll_gate', String(PULL_COST)),
    res('e_roll_ssr', 'roll_gate', 'ssr_hit', '6'),
    res('e_roll_sr', 'roll_gate', 'sr_hit', '51'),
    res('e_roll_r', 'roll_gate', 'r_hit', '943'),
    res('e_ssr_out', 'ssr_hit', 'ssr_count', '1'),
    res('e_sr_out', 'sr_hit', 'sr_count', '1'),
    res('e_r_out', 'r_hit', 'r_count', '1'),
    afterPullLabel('l_pulls_ssr', 'ssr_hit', 'pulls_made', '+1'),
    afterPullLabel('l_pulls_sr', 'sr_hit', 'pulls_made', '+1'),
    afterPullLabel('l_pulls_r', 'r_hit', 'pulls_made', '+1'),
    afterPullLabel('l_spent_ssr', 'ssr_hit', 'spent_total', `+${PULL_COST}`),
    afterPullLabel('l_spent_sr', 'sr_hit', 'spent_total', `+${PULL_COST}`),
    afterPullLabel('l_spent_r', 'r_hit', 'spent_total', `+${PULL_COST}`),
  ]
  return { nodes, edges }
}

const N = <T extends Record<string, number | undefined>>(v: T, k: string): number => v[k] ?? 0
const ssrEventSteps = (rows: Row[]): number[] =>
  rows.filter((r) => r.fired.includes('ssr_hit') || r.fired.includes('forced_ssr')).map((r) => r.step)

// PINNED — seed 1, HARD_PITY = 3, GS4 weights (6:51:943), 300 pulls. Captured
// from this exact graph; regenerate by temporarily logging `ssrEventSteps(a)`
// / `a.slice(1,4).map(r=>r.v.pity)` in the test below if the RNG scheme,
// weights, or graph shape ever change.
const PINNED_FIRST_SSR_STEP = 3
const PINNED_EARLY_PITY = [1, 2, 0]

describe('GS10-3 — hard pity in the realistic gacha economy (docs/example-gacha-simulator.md)', () => {
  describe('mechanism, deterministic rolls (isolates the reset/increment timing from RNG)', () => {
    it('a NATURAL SSR resets pity to 0 the SAME step it lands (deterministic all-SSR roll)', () => {
      const { nodes, edges } = hardPityGraph('ssr')
      const t = run(nodes, edges, 5)
      for (let s = 1; s <= 5; s++) {
        expect(t[s].fired).toContain('ssr_hit')
        expect(t[s].fired).not.toContain('forced_ssr') // never reaches the ceiling
        expect(N(t[s].v, 'pity')).toBe(0)
      }
    })

    it('a FORCED SSR (ceiling hit) resets pity to 0 the SAME step — the exact GS11-D1 negative closed by CSU', () => {
      const { nodes, edges } = hardPityGraph('non-ssr') // never a natural SSR, so every SSR is forced
      const t = run(nodes, edges, 9) // 3 ceiling hits at steps 3, 6, 9
      const forced = t.filter((r) => r.fired.includes('forced_ssr')).map((r) => r.step)
      expect(forced).toEqual([3, 6, 9])
      for (const s of forced) expect(N(t[s].v, 'pity')).toBe(0)
      // the step right after a reset starts counting from 0 (not the
      // pre-reset ceiling value) — step 4 must roll normally, not re-force
      expect(t[4].fired).toContain('r_hit')
      expect(t[4].fired).not.toContain('forced_ssr')
    })

    it('a non-SSR pull (SR or R) increments pity by exactly 1 the same step; a ceiling hit adds 0', () => {
      const { nodes, edges } = hardPityGraph('non-ssr')
      const t = run(nodes, edges, 9)
      for (let s = 1; s <= 9; s++) {
        if (t[s].fired.includes('forced_ssr')) expect(N(t[s].v, 'pity')).toBe(0)
        else expect(N(t[s].v, 'pity')).toBe(N(t[s - 1].v, 'pity') + 1)
      }
    })

    it('the forced route fires exactly once per ceiling hit, spaced exactly HARD_PITY apart — no double-fire', () => {
      const { nodes, edges } = hardPityGraph('non-ssr')
      const t = run(nodes, edges, 12)
      const forced = ssrEventSteps(t)
      expect(forced).toEqual([3, 6, 9, 12])
      for (let i = 1; i < forced.length; i++) expect(forced[i] - forced[i - 1]).toBe(HARD_PITY)
    })

    it('one result per pull, every step: ssr_count + sr_count + r_count === pulls_made', () => {
      for (const roll of ['ssr', 'non-ssr'] as const) {
        const { nodes, edges } = hardPityGraph(roll)
        const t = run(nodes, edges, 10)
        for (let s = 1; s <= 10; s++) {
          const total = N(t[s].v, 'ssr_count') + N(t[s].v, 'sr_count') + N(t[s].v, 'r_count')
          expect(total).toBe(N(t[s].v, 'pulls_made'))
        }
      }
    })
  })

  describe('wallet accounting (Hanrim, PR #184 review round 1 — payment and result must be one event)', () => {
    it('wallet spend and spent_total agree, and spent_total tracks pulls_made 1:1, every step', () => {
      const { nodes, edges } = hardPityGraph(false)
      const walletInitial = 100_000
      const t = run(nodes, edges, 50)
      for (let s = 1; s <= 50; s++) {
        expect(walletInitial - N(t[s].v, 'wallet')).toBe(N(t[s].v, 'spent_total'))
        expect(N(t[s].v, 'spent_total')).toBe(N(t[s].v, 'pulls_made') * PULL_COST)
      }
    })

    it('a natural SSR and a forced SSR are booked identically: -PULL_COST wallet, +PULL_COST spent_total, +1 pulls_made', () => {
      const natural = run(hardPityGraph('ssr').nodes, hardPityGraph('ssr').edges, 1)
      const forced = run(hardPityGraph('non-ssr').nodes, hardPityGraph('non-ssr').edges, 3) // ceiling at step 3
      expect(natural[1].fired).toContain('ssr_hit')
      expect(natural[0].v.wallet - natural[1].v.wallet).toBe(PULL_COST)
      expect(natural[1].v.spent_total).toBe(PULL_COST)
      expect(natural[1].v.pulls_made).toBe(1)

      expect(forced[3].fired).toContain('forced_ssr')
      expect(forced[2].v.wallet - forced[3].v.wallet).toBe(PULL_COST)
      expect(forced[3].v.spent_total - forced[2].v.spent_total).toBe(PULL_COST)
      expect(forced[3].v.pulls_made - forced[2].v.pulls_made).toBe(1)
    })

    it('a wallet funded for exactly one pull buys exactly one pull, then every counter holds', () => {
      const { nodes, edges } = hardPityGraph('ssr', PULL_COST) // wallet = PULL_COST, all-SSR roll
      const t = run(nodes, edges, 5)
      expect(t[1].fired).toContain('ssr_hit')
      expect(t[1].v.wallet).toBe(0)
      expect(t[1].v.spent_total).toBe(PULL_COST)
      expect(t[1].v.pulls_made).toBe(1)
      for (let s = 2; s <= 5; s++) {
        expect(t[s].fired).not.toContain('ssr_hit')
        expect(t[s].fired).not.toContain('forced_ssr')
        expect(t[s].v.wallet).toBe(0)
        expect(t[s].v.spent_total).toBe(PULL_COST)
        expect(t[s].v.pulls_made).toBe(1)
      }
    })
  })

  describe('statistical content, real GS4 weights + a fixed seed (the "realistic model" proof)', () => {
    const PULLS = 300
    const SEED = 1

    it('conservation holds throughout a long probabilistic run: ssr + sr + r === pulls, every step', () => {
      const { nodes, edges } = hardPityGraph(false)
      const t = run(nodes, edges, PULLS, SEED)
      for (let s = 1; s <= PULLS; s++) {
        const total = N(t[s].v, 'ssr_count') + N(t[s].v, 'sr_count') + N(t[s].v, 'r_count')
        expect(total).toBe(N(t[s].v, 'pulls_made'))
      }
    })

    it('no gap between consecutive SSR events (natural or forced) ever exceeds HARD_PITY', () => {
      const { nodes, edges } = hardPityGraph(false)
      const t = run(nodes, edges, PULLS, SEED)
      const events = ssrEventSteps(t)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toBeLessThanOrEqual(HARD_PITY) // the very first SSR is within one ceiling window
      for (let i = 1; i < events.length; i++) {
        expect(events[i] - events[i - 1]).toBeLessThanOrEqual(HARD_PITY)
      }
      // and pity itself never reaches HARD_PITY (it always forces at HARD_PITY-1)
      for (let s = 1; s <= PULLS; s++) expect(N(t[s].v, 'pity')).toBeLessThan(HARD_PITY)
    })

    it('every forced-route pull is exactly at the ceiling (pity was HARD_PITY-1 the step before), never earlier', () => {
      const { nodes, edges } = hardPityGraph(false)
      const t = run(nodes, edges, PULLS, SEED)
      for (let s = 1; s <= PULLS; s++) {
        if (t[s].fired.includes('forced_ssr')) expect(N(t[s - 1].v, 'pity')).toBe(HARD_PITY - 1)
      }
    })

    it('Timeline series check — the full per-step (pity, ssr/sr/r, pulls_made) trajectory is deterministic for this seed', () => {
      const { nodes, edges } = hardPityGraph(false)
      const a = run(nodes, edges, PULLS, SEED)
      const b = run(nodes, edges, PULLS, SEED)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b)) // same seed -> byte-identical series
      expect(a[PULLS].v.pulls_made).toBe(PULLS)
      // PINNED — this seed's actual first-SSR step and running pity at a few
      // early steps, so a silent behavioural drift in the roll or the pity
      // mechanism fails HERE, not just via the aggregate invariants above.
      // (Values captured from this graph/seed; see the file header for how
      // to regenerate if the engine's RNG scheme ever changes.)
      const firstSsrStep = ssrEventSteps(a)[0]
      expect(firstSsrStep).toBe(PINNED_FIRST_SSR_STEP)
      expect(a.slice(1, 4).map((r) => N(r.v, 'pity'))).toEqual(PINNED_EARLY_PITY)
    })

    it("compared to the existing no-ceiling baseline (same seed, same weights): hard pity visibly bounds the SSR gap where the baseline doesn't", () => {
      const hard = run(hardPityGraph(false).nodes, hardPityGraph(false).edges, PULLS, SEED)
      const baseline = run(noPityBaselineGraph().nodes, noPityBaselineGraph().edges, PULLS, SEED)

      const hardEvents = ssrEventSteps(hard)
      const baseEvents = baseline.filter((r) => r.fired.includes('ssr_hit')).map((r) => r.step)

      // the hard-pity model's own invariant, re-confirmed:
      for (let i = 1; i < hardEvents.length; i++) expect(hardEvents[i] - hardEvents[i - 1]).toBeLessThanOrEqual(HARD_PITY)

      // the baseline has NO such mechanism — at these odds (0.6% SSR) over
      // 300 pulls its gaps are typically much wider than HARD_PITY, and the
      // hard-pity model produces far MORE total SSRs (every ceiling window
      // guarantees one) than the baseline's plain-probability count. Both
      // facts demonstrate the feature actually changes real behaviour
      // relative to the documented v1 model, not just in a synthetic probe.
      expect(hardEvents.length).toBeGreaterThan(baseEvents.length)
      const baseMaxGap = baseEvents.length > 1 ? Math.max(...baseEvents.slice(1).map((s, i) => s - baseEvents[i])) : PULLS
      expect(baseMaxGap).toBeGreaterThan(HARD_PITY)

      // the baseline is conservative too — same conservation law, no pity involved
      for (let s = 1; s <= PULLS; s++) {
        const total = N(baseline[s].v, 'ssr_count') + N(baseline[s].v, 'sr_count') + N(baseline[s].v, 'r_count')
        expect(total).toBe(N(baseline[s].v, 'pulls_made'))
      }
    })
  })
})
