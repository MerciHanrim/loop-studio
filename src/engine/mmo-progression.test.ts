import { describe, expect, it } from 'vitest'
import fixtureDoc from '../../examples/mmo-progression.json'
import { normalizeGraph, serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { runMonteCarlo, runSeed } from './montecarlo'
import { buildMmoProgression, MMO_PROGRESSION_MC, P } from './mmo-progression.fixture'
import { initSim, step } from './step'

// `examples/mmo-progression.json` is the "Early MMO progression (levels 1–15)"
// Templates demo — a connected play economy (three zone lanes + a shared
// gold / consumable / gear / loot economy). Generated from
// `buildMmoProgression()` via the real serializer; docs/example-mmo-progression.md
// is the settled design.
//
// This is NOT a value oracle (there is no `.expected.json`). The checks below
// pin structural invariants, seed reproducibility, the §EM10.1 accounting
// identities (which hold by construction), and the §EM10 reach-15 tuning
// window — honest engine changes that shift the numbers within the window do
// not force a rewrite.
//
// Regenerate after a deliberate change:
//   GEN_MMO_PROGRESSION=1 npx vitest run src/engine/mmo-progression.test.ts

const built = buildMmoProgression()

const RECOMMENDED = {
  baseSeed: MMO_PROGRESSION_MC.baseSeed,
  runs: MMO_PROGRESSION_MC.runs,
  steps: MMO_PROGRESSION_MC.steps,
  tracked: [...MMO_PROGRESSION_MC.tracked],
}

function poolTrace(nodes: LoopNode[], edges: LoopEdge[], seed: number, steps: number) {
  let st = initSim(nodes)
  const rows: number[][] = []
  for (let t = 1; t <= steps && !st.ended; t++) {
    st = step(nodes, edges, st, seed).state
    rows.push(nodes.filter((n) => n.data.kind === 'pool').map((n) => st.values[n.id] ?? 0))
  }
  return JSON.stringify(rows)
}

/** Run one seed to termination (or `steps`) and return the terminal values. */
function runToEnd(nodes: LoopNode[], edges: LoopEdge[], seed: number, steps: number) {
  let st = initSim(nodes)
  let endedAt = -1
  for (let t = 1; t <= steps && !st.ended; t++) {
    st = step(nodes, edges, st, seed).state
    if (st.ended) endedAt = t
  }
  return { values: st.values, endedAt, ended: st.ended }
}

describe('mmo-progression example', () => {
  if (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.GEN_MMO_PROGRESSION === '1'
  ) {
    it('regenerates examples/mmo-progression.json', async () => {
      const fs = await import('node:' + 'fs')
      fs.writeFileSync(
        new URL('../../examples/mmo-progression.json', import.meta.url),
        serialize(built.nodes, built.edges, RECOMMENDED) + '\n',
      )
    })
    return
  }

  const { nodes, edges } = normalizeGraph(
    fixtureDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] },
  )
  const v = (vals: Record<string, number>, id: string) => vals[id] ?? 0

  it('the committed file matches buildMmoProgression() through the serializer', () => {
    expect(fixtureDoc).toEqual(JSON.parse(serialize(built.nodes, built.edges, RECOMMENDED)))
  })

  it('carries recommendedRunConfig matching the verified Monte-Carlo run', () => {
    expect((fixtureDoc as { recommendedRunConfig?: unknown }).recommendedRunConfig).toEqual(
      RECOMMENDED,
    )
  })

  it('deserialises as loop-studio/graph with the expected structure', () => {
    expect((fixtureDoc as { schema: string }).schema).toBe('loop-studio/graph')
    expect((fixtureDoc as { version: number }).version).toBe(1)
    const kinds = new Set(nodes.map((n) => n.data.kind))
    expect([...kinds].sort()).toEqual([
      'converter',
      'drain',
      'end',
      'gate',
      'pool',
      'register',
      'source',
    ])
    // three zone lanes + one shared End
    expect(nodes.filter((n) => n.data.kind === 'end')).toHaveLength(1)
    expect(nodes.filter((n) => n.data.kind === 'source').length).toBeGreaterThanOrEqual(5)
    expect(nodes.length).toBe(built.nodes.length)
    expect(edges.length).toBe(built.edges.length)
  })

  it('has probabilistic combat / loot gates, deterministic router / category gates, and activator state edges', () => {
    const gates = nodes.filter((n) => n.data.kind === 'gate')
    const dist = gates.map((g) => (g.data as { distribution: string }).distribution).sort()
    // 3 combat + 3 loot probabilistic; reward-router + loot-category deterministic
    expect(dist.filter((d) => d === 'probabilistic')).toHaveLength(6)
    expect(dist.filter((d) => d === 'deterministic')).toHaveLength(2)
    const stateEdges = edges.filter((e) => e.data?.kind === 'state')
    expect(stateEdges.length).toBeGreaterThan(0)
    expect(stateEdges.every((e) => (e.data as { mode: string }).mode === 'activator')).toBe(true)
  })

  it('every Register expression is loop-expr/1 (+ - * / and @id) and references live pool ids', () => {
    const poolIds = new Set(nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id))
    for (const r of nodes.filter((n) => n.data.kind === 'register')) {
      const expr = (r.data as { expr: string }).expr
      expect(expr).not.toMatch(/floor|min|max|abs|round|\?|<|>/)
      for (const ref of expr.match(/@[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
        expect(poolIds.has(ref.slice(1)), `${expr} → ${ref}`).toBe(true)
      }
    }
  })

  it('runs clean — no engine diagnostics over a full playthrough', () => {
    let st = initSim(nodes)
    const seen = new Set<string>()
    for (let t = 1; t <= MMO_PROGRESSION_MC.steps && !st.ended; t++) {
      const r = step(nodes, edges, st, runSeed(MMO_PROGRESSION_MC.baseSeed, 3))
      st = r.state
      for (const d of r.report.diagnostics) seen.add(d)
    }
    expect([...seen]).toEqual([])
  })

  it('is reproducible: same seed ⇒ identical trajectory, different seed diverges', () => {
    expect(poolTrace(nodes, edges, 7, 60)).toBe(poolTrace(nodes, edges, 7, 60))
    expect(poolTrace(nodes, edges, 7, 60)).not.toBe(poolTrace(nodes, edges, 12, 60))
  })

  it('each probabilistic combat gate routes at most one branch per step', () => {
    const combat = nodes.filter((n) => n.id.endsWith('_combat')).map((n) => n.id)
    let st = initSim(nodes)
    let maxBranches = 0
    for (let t = 1; t <= 80 && !st.ended; t++) {
      const r = step(nodes, edges, st, 5)
      st = r.state
      for (const g of combat) {
        maxBranches = Math.max(maxBranches, r.report.events.filter((e) => e.from === g).length)
      }
    }
    expect(maxBranches).toBe(1)
  })

  it('a run climbs the three bands and reaches Level 15 through the End', () => {
    const { values, ended, endedAt } = runToEnd(nodes, edges, runSeed(1, 0), MMO_PROGRESSION_MC.steps)
    expect(ended).toBe(true)
    expect(endedAt).toBeGreaterThan(15)
    expect(v(values, 'level')).toBeGreaterThanOrEqual(15)
    expect(v(values, 'combat_wins')).toBeGreaterThan(v(values, 'deaths'))
  })

  describe('§EM10.1 accounting invariants (hold to a float epsilon at every terminal state)', () => {
    const EPS = 1e-6
    for (const i of [0, 1, 2, 7, 25, 99]) {
      it(`run ${i} conserves Gold, Water, Food and Items`, () => {
        const { values } = runToEnd(nodes, edges, runSeed(1, i), MMO_PROGRESSION_MC.steps)
        // start Gold + Gold earned = final Gold + Repair + Resupply + Training spend
        expect(
          Math.abs(
            P.goldStart +
              v(values, 'gold_earned') -
              (v(values, 'gold') +
                v(values, 'repair_spend') +
                v(values, 'resupply_spend') +
                v(values, 'training_spend')),
          ),
        ).toBeLessThan(EPS)
        // start Water + Water bought = final Water + Water consumed
        expect(
          Math.abs(
            P.waterStart + v(values, 'water_bought') - (v(values, 'water') + v(values, 'water_consumed')),
          ),
        ).toBeLessThan(EPS)
        // start Food + Food bought = final Food + Food consumed
        expect(
          Math.abs(
            P.foodStart + v(values, 'food_bought') - (v(values, 'food') + v(values, 'food_consumed')),
          ),
        ).toBeLessThan(EPS)
        // Items looted = equipped + sold + consumed + <held in the loot pipeline>
        const held =
          v(values, 'loot_feed') +
          v(values, 'bucket_equip') +
          v(values, 'bucket_vendor') +
          v(values, 'bucket_consumable') +
          v(values, 'bucket_rare')
        expect(
          Math.abs(
            v(values, 'items_looted') -
              (v(values, 'items_equipped') +
                v(values, 'items_sold') +
                v(values, 'items_consumed') +
                held),
          ),
        ).toBeLessThan(EPS)
      })
    }
  })

  describe('§EM10 Monte Carlo (baseSeed 1, 200 × 150)', () => {
    const mc = runMonteCarlo(nodes, edges, { ...MMO_PROGRESSION_MC, tracked: [...MMO_PROGRESSION_MC.tracked] })
    const cum = mc.endedRuns.atOrBeforeStep

    it('is deterministic — the same config reproduces byte-identical output', () => {
      const again = runMonteCarlo(nodes, edges, {
        ...MMO_PROGRESSION_MC,
        tracked: [...MMO_PROGRESSION_MC.tracked],
      })
      expect(again.series).toEqual(mc.series)
      expect(again.endedRuns).toEqual(mc.endedRuns)
      expect(again.final).toEqual(mc.final)
    })

    it('tracks the explicit Pool list, none dropped', () => {
      expect(mc.droppedTracked).toEqual([])
      expect(mc.pools.map((p) => p.id).sort()).toEqual([...MMO_PROGRESSION_MC.tracked].sort())
    })

    it('the cumulative-termination vector has length steps+1 and is monotone non-decreasing', () => {
      expect(cum).toHaveLength(MMO_PROGRESSION_MC.steps + 1)
      for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1])
    })

    it('≥ 95 % of runs reach Level 15 within 150 steps', () => {
      expect(cum.at(-1)! / mc.completedRuns).toBeGreaterThanOrEqual(0.95)
    })

    it('the median run reaches Level 15 in 60–120 steps', () => {
      const half = mc.completedRuns / 2
      const median = cum.findIndex((c) => c >= half)
      expect(median).toBeGreaterThanOrEqual(60)
      expect(median).toBeLessThanOrEqual(120)
    })

    it('shows real spread — drop luck and combat variance move the levelling time', () => {
      const lvl = mc.final['level'].summary
      const elapsed = mc.final['elapsed'].summary
      expect(lvl.p50).toBeGreaterThanOrEqual(15) // most runs finish
      expect(elapsed.p90).toBeGreaterThan(elapsed.p10) // and the time-to-15 spreads
      const wins = mc.final['combat_wins'].summary
      expect(wins.p90).toBeGreaterThan(wins.p10)
    })
  })
})
