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
  timelineSeries: [...MMO_PROGRESSION_MC.timelineSeries],
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

  it('the Timeline default (timelineSeries) is a curated ~10-series set of real ids, sorted', () => {
    const ts = (fixtureDoc as unknown as { recommendedRunConfig: { timelineSeries: string[] } })
      .recommendedRunConfig.timelineSeries
    expect(ts.length).toBeGreaterThanOrEqual(9)
    expect(ts.length).toBeLessThanOrEqual(12)
    expect([...ts]).toEqual([...ts].sort()) // sorted
    const ids = new Set(nodes.map((n) => n.id))
    for (const id of ts) expect(ids.has(id), id).toBe(true)
    // the story metrics + the Net gold check Register
    for (const id of ['level', 'elapsed', 'gold', 'deaths', 'r_netgold']) expect(ts).toContain(id)
    // it is NOT the same list as the Monte-Carlo tracked set (different purpose)
    expect([...ts].sort()).not.toEqual([...MMO_PROGRESSION_MC.tracked].sort())
  })

  it('opens on Character creation → the three zone landmarks → Reached level 15, left to right', () => {
    const at = (id: string) => nodes.find((n) => n.id === id)!
    const cc = at('char_creation')
    expect(cc.data.kind).toBe('source')
    expect((cc.data as { activation: string }).activation).toBe('onStart')
    const spine = ['char_creation', 'active_char', 'z1_enc', 'z2_enc', 'z3_enc', 'end15'].map(at)
    // strictly increasing x, and all on one row well above the detail
    for (let i = 1; i < spine.length; i++) {
      expect(spine[i].position.x, spine[i].id).toBeGreaterThan(spine[i - 1].position.x)
    }
    const spineY = spine.map((n) => n.position.y)
    expect(Math.max(...spineY) - Math.min(...spineY)).toBeLessThanOrEqual(20)
    // the busy detail sits below the spine
    const detail = nodes.filter((n) => /_combat$|_winamp$|_loot$|_conv$|^bucket_/.test(n.id))
    expect(detail.every((n) => n.position.y > Math.max(...spineY) + 100)).toBe(true)
    // the landmark labels carry the level band
    expect((at('z1_enc').data as { label: string }).label).toMatch(/1[–-]5/)
    expect((at('z3_enc').data as { label: string }).label).toMatch(/10[–-]15/)
  })

  it('each zone is an isolated column; the seven Registers sit in clear space (no edges)', () => {
    const at = (id: string) => nodes.find((n) => n.id === id)!
    const zoneBox = (z: number) => {
      const xs = [`enc_src`, `combat`, `win`, `winamp`, `lootroll`, `loot`, `xp2lvl`, `training`].map(
        (s) => at(`z${z}_${s}`).position.x,
      )
      return { minX: Math.min(...xs), maxX: Math.max(...xs) }
    }
    const [b1, b2, b3] = [1, 2, 3].map(zoneBox)
    // adjacent zone columns do not overlap in x — each lane's detail is its own
    expect(b2.minX).toBeGreaterThan(b1.maxX)
    expect(b3.minX).toBeGreaterThan(b2.maxX)

    // Registers have no ports, so nothing wires to them — they must not sit
    // where resource edges run (top-right, above the economy)
    const regIds = new Set(nodes.filter((n) => n.data.kind === 'register').map((n) => n.id))
    expect(edges.filter((e) => regIds.has(e.source) || regIds.has(e.target))).toEqual([])
    const regs = nodes.filter((n) => regIds.has(n.id))
    const spineMaxX = Math.max(...['char_creation', 'z3_enc', 'end15'].map((id) => at(id).position.x))
    expect(regs.every((r) => r.position.x >= spineMaxX && r.position.y < 600)).toBe(true)
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

  it('has probabilistic combat / loot / category gates, deterministic router / XP-meter gates, and activator state edges', () => {
    const gates = nodes.filter((n) => n.data.kind === 'gate')
    const dist = gates.map((g) => (g.data as { distribution: string }).distribution).sort()
    // 3 combat + 3 loot + 1 loot-category probabilistic;
    // reward router + 3 pull-all XP-meter gates deterministic
    expect(dist.filter((d) => d === 'probabilistic')).toHaveLength(7)
    expect(dist.filter((d) => d === 'deterministic')).toHaveLength(4)
    // each XP-meter gate is `pull all` — it moves `xp_per_level` atomically or nothing
    for (const g of gates.filter((n) => n.id.endsWith('_xp_meter'))) {
      expect((g.data as { mode?: string }).mode).toBe('pullAll')
    }
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

  it('every Register evaluates to a value at step 0 — no `/0` / invalid on opening the file', async () => {
    const { registersOfSnapshot } = await import('../model/model')
    const st0 = initSim(nodes)
    const out = registersOfSnapshot(nodes, st0.values)
    for (const r of nodes.filter((n) => n.data.kind === 'register')) {
      const o = out.get(r.id)
      expect(o, r.id).toBeDefined()
      if (o!.invalid) throw new Error(`${r.id} is invalid at step 0 (code ${o!.code})`)
      expect(Number.isFinite(o!.value), `${r.id} = ${o!.value}`).toBe(true)
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

      it(`run ${i}: Level and item counts are whole numbers`, () => {
        const { values } = runToEnd(nodes, edges, runSeed(1, i), MMO_PROGRESSION_MC.steps)
        const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS
        // the pull-all XP meter → +1 Converter keeps Level integral in a single run
        expect(nearInt(v(values, 'level')), `level = ${v(values, 'level')}`).toBe(true)
        // one whole drop → exactly one category, so every item counter is an integer
        for (const id of [
          'items_looted',
          'items_equipped',
          'items_sold',
          'items_consumed',
          'bucket_equip',
          'bucket_vendor',
          'bucket_consumable',
          'bucket_rare',
          'loot_feed',
          'drop',
        ]) {
          expect(nearInt(v(values, id)), `${id} = ${v(values, id)}`).toBe(true)
        }
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
