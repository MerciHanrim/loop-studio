import { describe, expect, it } from 'vitest'
import standardDoc from '../../examples/gacha-standard.json'
import { buildGachaBannerZonesGraph } from './gachaBannerZonesGraph'
import { gateChances } from './gateChance'
import type { SimState } from './index'
import { initSim, step } from './index'
import type { LoopEdge, LoopNode } from '../model/types'

// docs/gacha-standard.md — the shipped standard gacha (examples/gacha-standard.json)
// run by the engine. Its structure differs from the 3-zone comparison's Premium
// Standard zone in ONE reviewed way (Lumi, 2026-10-20): the forced SSR sends
// its ticket into the SSR result, so the SSR result handles every SSR, natural
// or forced. The step comparison below holds the example to the zone's
// structure: over the inputs and seeds checked, every Pool's value and the end
// are the same at every step; the only difference in what fires is the SSR
// result firing on a forced pull too. Not a proof for every input or seed.

type G = { nodes: LoopNode[]; edges: LoopEdge[] }
const doc = standardDoc as unknown as G & { recommendedRunConfig: { steps: number; canvasLocked?: boolean } }

// the zone's structure, standalone: the zone's nodes, the shared target and
// the termination plumbing, with the example's ids (stated here on their own,
// not read from the generator)
const ZONE_ID: Record<string, string> = {
  pulls_per_zone: 'target_pulls',
  zone2_standard_w_ssr: 'w_ssr',
  zone2_standard_w_sr: 'w_sr',
  zone2_standard_w_r: 'w_r',
  zone2_standard_hard_pity: 'hard_pity',
  fund_standard: 'fund_tickets',
  ticket_standard: 'tickets',
  roll_gate_standard: 'roll',
  ssr_hit_standard: 'ssr_result',
  sr_hit_standard: 'sr_result',
  r_hit_standard: 'r_result',
  ssr_count_standard: 'ssr_count',
  sr_count_standard: 'sr_count',
  r_count_standard: 'r_count',
  pulls_made_standard: 'pulls_made',
  pity_standard: 'pity',
  forced_ssr_standard: 'forced_ssr',
  ceiling_hits_standard: 'ceiling_hits',
  cmp2_hit_rate_standard: 'ssr_hit_rate',
  termination_fuel: 'completion_signal',
  all_zones_done: 'pulls_complete',
}
// the connections' ids too: a probabilistic gate orders its branches by
// connection id before it draws (engine `pickBranch`), so the zone's ids
// (`e_standard_2/3/4`) and the example's (`e_roll_ssr/sr/r`) sort the roll's
// branches differently and the same seed draws differently — same chances,
// another sequence. Compared with the example's ids, the draws line up.
const ZONE_EDGE_ID: Record<string, string> = {
  e_standard_1: 'e_fund',
  e_standard_10: 'e_tickets_roll',
  e_standard_2: 'e_roll_ssr',
  e_standard_3: 'e_roll_sr',
  e_standard_4: 'e_roll_r',
  e_standard_20: 'e_ssr_count',
  e_standard_5: 'e_sr_count',
  e_standard_6: 'e_r_count',
  e_standard_7: 'e_ssr_pull',
  e_standard_8: 'e_sr_pull',
  e_standard_9: 'e_r_pull',
  e_termination_gate_standard: 'e_pulls_done',
  e_termination_fuel: 'e_completion',
  e_standard_11: 'e_tickets_forced',
  e_standard_14: 'e_forced_ceiling',
  e_standard_13: 'e_pity_forced',
  e_standard_12: 'e_pity_roll',
  e_standard_15: 'e_ssr_pity',
  e_standard_17: 'e_sr_pity',
  e_standard_18: 'e_r_pity',
  // the forced SSR's own three, which the example does not have
  e_standard_21: 'e_forced_ssr_count',
  e_standard_19: 'e_forced_pull',
  e_standard_16: 'e_forced_pity',
}
const rename = (s: string) => s.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (ZONE_ID[id] ? `@${ZONE_ID[id]}` : m))
function zoneStructure(): G {
  const full = buildGachaBannerZonesGraph()
  const nodes = full.nodes
    .filter((n) => ZONE_ID[n.id])
    .map((n) => {
      const data = { ...n.data } as Record<string, unknown>
      if (typeof data.expr === 'string') data.expr = rename(data.expr)
      return { ...n, id: ZONE_ID[n.id], data } as LoopNode
    })
  const edges = (full.edges as LoopEdge[])
    .filter((e) => ZONE_ID[e.source] && ZONE_ID[e.target])
    .map((e) => {
      const data = { ...e.data } as Record<string, unknown>
      if (typeof data.flow === 'string') data.flow = rename(data.flow)
      if (typeof data.expr === 'string') data.expr = rename(data.expr)
      const id = ZONE_EDGE_ID[e.id]
      if (!id) throw new Error(`no id for the zone's connection ${e.id}`)
      return { ...e, id, source: ZONE_ID[e.source], target: ZONE_ID[e.target], data } as LoopEdge
    })
  return { nodes, edges }
}

type Inputs = { target: number; hardPity: number; w: [number, number, number] }
function withInputs(g: G, i: Inputs): G {
  const value: Record<string, number> = { target_pulls: i.target, hard_pity: i.hardPity, w_ssr: i.w[0], w_sr: i.w[1], w_r: i.w[2] }
  return { nodes: g.nodes.map((n) => (n.id in value ? ({ ...n, data: { ...n.data, value: value[n.id] } } as LoopNode) : n)), edges: g.edges }
}

type Row = { values: Record<string, number>; ended: boolean; fired: string[] }
function run(g: G, steps: number, seed: number): Row[] {
  let st: SimState = initSim(g.nodes)
  const rows: Row[] = [{ values: { ...st.values }, ended: st.ended, fired: [] }]
  for (let i = 0; i < steps && !st.ended; i++) {
    st = step(g.nodes, g.edges, st, seed, 2).state
    rows.push({ values: { ...st.values }, ended: st.ended, fired: [...st.fired].sort() })
  }
  return rows
}

// the boundaries: the step before the ceiling, a forced pull at it, the
// counter's reset, a target on a ceiling boundary, the target and the end
const CASES: (Inputs & { name: string })[] = [
  { name: 'the defaults (target 200, ceiling 80, 10 / 90 / 900)', target: 200, hardPity: 80, w: [10, 90, 900] },
  { name: 'ceiling 3, target 20', target: 20, hardPity: 3, w: [10, 90, 900] },
  { name: 'ceiling 2, target 9', target: 9, hardPity: 2, w: [10, 90, 900] },
  { name: 'ceiling 1 (every pull forced), target 5', target: 5, hardPity: 1, w: [10, 90, 900] },
  { name: 'no natural SSR (weight 0), ceiling 4, target 13', target: 13, hardPity: 4, w: [0, 90, 900] },
  { name: 'many natural SSRs (500 / 250 / 250), ceiling 3, target 30', target: 30, hardPity: 3, w: [500, 250, 250] },
  { name: 'target 1, ceiling 80', target: 1, hardPity: 80, w: [10, 90, 900] },
  { name: 'a target on a ceiling boundary (target 6, ceiling 3, no natural SSR)', target: 6, hardPity: 3, w: [0, 90, 900] },
]
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('the standard gacha (examples/gacha-standard.json)', () => {
  it('opens unlocked; the hit rate reads SSR count over the target; the pity block is framed', () => {
    expect(doc.recommendedRunConfig.canvasLocked).toBe(false)
    const reg = doc.nodes.find((n) => n.id === 'ssr_hit_rate')!
    expect((reg.data as { expr: string }).expr).toBe('@ssr_count / @target_pulls')
    const frames = (standardDoc as { frames?: { id: string }[] }).frames ?? []
    expect(frames.map((f) => f.id)).toEqual(['pity_block'])
  })

  it('the roll picks SSR, SR or R by weight: 1 %, 9 %, 90 % of 1,000', () => {
    const c = gateChances(doc.nodes, doc.edges, 'roll', 2)!
    expect(c.status).toBe('fixed')
    expect(c.sum).toBe(1000)
    expect(Object.fromEntries(c.branches.map((b) => [b.target, b.chance]))).toEqual({ ssr_result: 0.01, sr_result: 0.09, r_result: 0.9 })
  })

  it('the structure: the forced SSR feeds the SSR result and the ceiling hits; no line of its own to the SSR count, the pulls made or the counter', () => {
    const out = doc.edges.filter((e) => e.source === 'forced_ssr').map((e) => e.target).sort()
    expect(out).toEqual(['ceiling_hits', 'ssr_result'])
    const zone = zoneStructure()
    expect(zone.edges.filter((e) => e.source === 'forced_ssr').map((e) => e.target).sort()).toEqual(['ceiling_hits', 'pity', 'pulls_made', 'ssr_count'])
    expect(doc.nodes.map((n) => n.id).sort()).toEqual(zone.nodes.map((n) => n.id).sort())
  })

  for (const c of CASES) {
    it(`step by step against the zone's structure — ${c.name}, seeds 1–10`, () => {
      let forcedPulls = 0
      for (const seed of SEEDS) {
        const a = run(withInputs(zoneStructure(), c), c.target + 10, seed)
        const b = run(withInputs(doc, c), c.target + 10, seed)
        expect(b.length, `seed ${seed}: the number of steps`).toBe(a.length)
        for (let i = 0; i < a.length; i++) {
          expect(b[i].values, `seed ${seed} step ${i}: every Pool's value`).toEqual(a[i].values)
          expect(b[i].ended, `seed ${seed} step ${i}: the end`).toBe(a[i].ended)
          // what fires: the same, except the SSR result also fires on a forced pull
          const forced = a[i].fired.includes('forced_ssr')
          if (forced) forcedPulls++
          const expected = forced ? [...new Set([...a[i].fired, 'ssr_result'])].sort() : a[i].fired
          expect(b[i].fired, `seed ${seed} step ${i}: what fires`).toEqual(expected)
        }
        expect(a[a.length - 1].ended, `seed ${seed}: the run ends`).toBe(true)
      }
      // each case reaches a forced pull, except where the ceiling is never met
      if (c.hardPity <= c.target && c.w[0] < 500) expect(forcedPulls, 'forced pulls compared').toBeGreaterThan(0)
    })
  }

  // ---- the example AS GENERATED (its own ids, its own draws) ----
  // The step comparison above lines the draws up by renaming the zone's
  // connections; it says the merged structure behaves as the zone's. The
  // checks below run the shipped file itself, unchanged, and say what its own
  // runs do. Same seed ≠ the 3-zone Standard zone's run (the branch order by
  // connection id differs), and nothing is renamed to make it so.
  it.each([
    ['the defaults (target 200, ceiling 80, weights 10 / 90 / 900)', 200, 80, [10, 90, 900]],
    ['ceiling 10, target 200, weights 10 / 90 / 900 (natural and forced SSRs both occur)', 200, 10, [10, 90, 900]],
    ['ceiling 3, target 60, weights 300 / 350 / 350', 60, 3, [300, 350, 350]],
  ] as const)('as generated, seeds 1–10 — %s: counts add up, tickets are consumed one per pull, the ceiling forces and the counter resets, the end at target + 2', (_name, target, hardPity, w) => {
    const g = withInputs(doc, { target, hardPity, w: [...w] as [number, number, number] })
    let forcedSeen = 0
    for (const seed of SEEDS) {
      const rows = run(g, target + 10, seed)
      for (let i = 1; i < rows.length; i++) {
        const v = rows[i].values
        const prev = rows[i - 1].values
        // counts: SSR + SR + R = pulls made, at every step
        expect(v.ssr_count + v.sr_count + v.r_count, `seed ${seed} step ${i}: counts`).toBe(v.pulls_made)
        // tickets: funded once, then one consumed per pull — tickets + pulls made = target
        expect(v.tickets + v.pulls_made, `seed ${seed} step ${i}: tickets`).toBe(target)
        const pulled = v.pulls_made - prev.pulls_made
        expect(pulled === 0 || pulled === 1, `seed ${seed} step ${i}: at most one pull`).toBe(true)
        if (pulled === 0) continue
        const forced = rows[i].fired.includes('forced_ssr')
        const ssr = v.ssr_count - prev.ssr_count === 1
        // the ceiling: a forced pull exactly when the counter stood at ceiling − 1
        expect(forced, `seed ${seed} step ${i}: forced iff the counter was at ceiling − 1`).toBe(prev.pity === hardPity - 1)
        if (forced) {
          forcedSeen++
          expect(ssr, `seed ${seed} step ${i}: a forced pull is an SSR`).toBe(true)
          expect(v.ceiling_hits - prev.ceiling_hits).toBe(1)
        } else expect(v.ceiling_hits).toBe(prev.ceiling_hits)
        // the counter: reset by every SSR, natural or forced; +1 otherwise
        expect(v.pity, `seed ${seed} step ${i}: the counter`).toBe(ssr ? 0 : prev.pity + 1)
        expect(v.pity).toBeLessThan(hardPity)
      }
      const endAt = rows.findIndex((r) => r.ended)
      expect(endAt, `seed ${seed}: the end`).toBe(target + 2)
      expect(rows[endAt].values.pulls_made).toBe(target)
    }
    if (hardPity <= 10) expect(forcedSeen, 'forced pulls checked').toBeGreaterThan(0)
  })

  it.each([200, 50, 7])('target %i: the run ends at step target + 2 with exactly the target pulled', (target) => {
    const rows = run(withInputs(doc, { target, hardPity: 80, w: [10, 90, 900] }), target + 10, 1)
    const endAt = rows.findIndex((r) => r.ended)
    expect(endAt).toBe(target + 2)
    const last = rows[endAt].values
    expect(last.pulls_made).toBe(target)
    expect(last.ssr_count + last.sr_count + last.r_count).toBe(target)
    expect(rows[endAt - 1].values.completion_signal).toBe(1)
    expect(last.completion_signal).toBe(0)
  })

  it('the ceiling: with no natural SSR every 4th pull is forced — the counter runs 1, 2, 3 and resets; the ceiling hits count the forced SSRs', () => {
    const rows = run(withInputs(doc, { target: 12, hardPity: 4, w: [0, 90, 900] }), 30, 1)
    const pulls = rows.filter((r, i) => i > 0 && r.values.pulls_made > rows[i - 1].values.pulls_made)
    expect(pulls.map((r) => r.values.pity)).toEqual([1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0])
    expect(pulls.map((r) => r.fired.includes('forced_ssr'))).toEqual([false, false, false, true, false, false, false, true, false, false, false, true])
    const last = rows[rows.length - 1].values
    expect(last.ceiling_hits).toBe(3)
    expect(last.ssr_count).toBe(3)
  })

  it('the default horizon (target 200 + 2) is the end step', () => {
    expect(doc.recommendedRunConfig.steps).toBe(202)
    const rows = run(doc, 202, 1)
    expect(rows[rows.length - 1].ended).toBe(true)
  })
})
