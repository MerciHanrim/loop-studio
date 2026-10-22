import { describe, expect, it } from 'vitest'
import pickupDoc from '../../examples/gacha-pickup.json'
import { buildGachaBannerZonesGraph } from './gachaBannerZonesGraph'
import { gateChances } from './gateChance'
import type { SimState } from './index'
import { initSim, step } from './index'
import { parseActivatorExpr, parseLabelExpr } from './stateExpr'
import type { LoopEdge, LoopNode } from '../model/types'

// docs/gacha-pickup.md — the shipped pickup gacha (examples/gacha-pickup.json)
// run by the engine, AS GENERATED (the shipped file, its own ids and draws).
// Its structure differs from the 3-zone comparison's Premium Pickup zone
// (adopted, Lumi 2026-10-20: one roll and one forced SSR into one SSR result,
// then the guarantee block). What is checked:
//   1. the transition table per state — (counter, pickup owed) → outcome,
//      chance, and the counter / owed state / ceiling hits / pulls made / SSR
//      count after — derived from the graph, is the zone's, row for row: for
//      EVERY counter 0 … ceiling − 1 × owed 0 / 1 at seven input sets (the
//      derivation needs no engine run);
//   2. the engine from representative and boundary states (counter 0, 1,
//      ceiling − 2, ceiling − 1 × owed 0 / 1) lands only on rows of the table,
//      at their chances (4σ, 600 seeds);
//   3. the example's own runs: counts, tickets, the ceiling, the guarantee on /
//      kept / used, the ceiling and the guarantee together, the end;
//   4. it reproduces itself.
// NOT checked, not claimed: the same draws as the 3-zone zone for the same
// seed (one roll draws where the zone's two did).

type G = { nodes: LoopNode[]; edges: LoopEdge[] }
const doc = pickupDoc as unknown as G & { recommendedRunConfig: { steps: number; canvasLocked?: boolean }; frames?: { id: string }[] }

// the zone's structure, standalone, named as the example's nodes (its four
// rolls keep names of their own); stated here, not read from the generator
const ZONE_NODE: Record<string, string> = {
  pulls_per_zone: 'target_pulls', zone3_pickup_w_ssr: 'w_ssr', zone3_pickup_w_sr: 'w_sr', zone3_pickup_w_r: 'w_r',
  zone3_pickup_hard_pity: 'hard_pity', zone3_pickup_w_pickup: 'w_pickup', zone3_pickup_w_standard: 'w_off',
  fund_pickup: 'fund_tickets', ticket_pickup: 'tickets',
  roll_normal_open_pickup: 'zone_roll_open', roll_normal_owed_pickup: 'zone_roll_owed', roll_forced_open_pickup: 'zone_forced_open', roll_forced_owed_pickup: 'zone_forced_owed',
  ssr_split_open_pickup: 'pickup_split', pickup_hit_pickup: 'pickup_ssr', standard_hit_pickup: 'off_ssr', sr_hit_pickup: 'sr_result', r_hit_pickup: 'r_result',
  pickup_count_pickup: 'pickup_count', standard_count_pickup: 'off_count', ssr_count_pickup: 'ssr_count', sr_count_pickup: 'sr_count', r_count_pickup: 'r_count',
  pulls_made_pickup: 'pulls_made', pity_pickup: 'pity', ceiling_hits_pickup: 'ceiling_hits', missed_pickup_pickup: 'pickup_owed',
  cmp3_hit_rate_pickup: 'ssr_hit_rate', cmp4_pickup_rate_pickup: 'pickup_rate', termination_fuel: 'completion_signal', all_zones_done: 'pulls_complete',
}
const rename = (s: string) => s.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (ZONE_NODE[id] ? `@${ZONE_NODE[id]}` : m))
function zoneStructure(): G {
  const full = buildGachaBannerZonesGraph()
  const nodes = full.nodes.filter((n) => ZONE_NODE[n.id]).map((n) => {
    const data = { ...n.data } as Record<string, unknown>
    if (typeof data.expr === 'string') data.expr = rename(data.expr)
    return { ...n, id: ZONE_NODE[n.id], data } as LoopNode
  })
  const edges = (full.edges as LoopEdge[]).filter((e) => ZONE_NODE[e.source] && ZONE_NODE[e.target]).map((e) => {
    const data = { ...e.data } as Record<string, unknown>
    if (typeof data.flow === 'string') data.flow = rename(data.flow)
    if (typeof data.expr === 'string') data.expr = rename(data.expr)
    return { ...e, source: ZONE_NODE[e.source], target: ZONE_NODE[e.target], data } as LoopEdge
  })
  return { nodes, edges }
}

type Inputs = { name: string; target?: number; hardPity: number; w: [number, number, number]; wp: [number, number] }
const INPUTS: Inputs[] = [
  { name: 'the defaults (ceiling 80, 10 / 90 / 900, pickup 50 : 50)', hardPity: 80, w: [10, 90, 900], wp: [50, 50] },
  { name: 'ceiling 4, 100 / 300 / 600, pickup 60 : 40', hardPity: 4, w: [100, 300, 600], wp: [60, 40] },
  { name: 'ceiling 2, 100 / 300 / 600, pickup 60 : 40', hardPity: 2, w: [100, 300, 600], wp: [60, 40] },
  { name: 'ceiling 1 (every pull at the ceiling), 100 / 300 / 600, pickup 60 : 40', hardPity: 1, w: [100, 300, 600], wp: [60, 40] },
  { name: 'no natural SSR (SSR weight 0), ceiling 4, pickup 60 : 40', hardPity: 4, w: [0, 500, 500], wp: [60, 40] },
  { name: 'pickup weight 0, ceiling 4', hardPity: 4, w: [200, 400, 400], wp: [0, 100] },
  { name: 'off-pickup weight 0, ceiling 4', hardPity: 4, w: [200, 400, 400], wp: [100, 0] },
]
type State = { pity: number; owed: number }
function withInputs(g: G, i: Inputs, s?: State, tickets = 0): G {
  const v: Record<string, number> = { hard_pity: i.hardPity, w_ssr: i.w[0], w_sr: i.w[1], w_r: i.w[2], w_pickup: i.wp[0], w_off: i.wp[1], target_pulls: i.target ?? 200 }
  const init: Record<string, number> = s ? { pity: s.pity, pickup_owed: s.owed, tickets } : {}
  return {
    nodes: g.nodes.map((n) => (n.id in v ? ({ ...n, data: { ...n.data, value: v[n.id] } } as LoopNode) : n.id in init ? ({ ...n, data: { ...n.data, initial: init[n.id] } } as LoopNode) : n)),
    edges: g.edges,
  }
}

// ---- the transition table, derived from a graph (no engine run) ----
const TRACK = ['pity', 'pickup_owed', 'ceiling_hits', 'pulls_made', 'ssr_count'] as const
type After = Record<(typeof TRACK)[number], number>
type Row = { outcome: string; p: number; after: After }
function table(g: G, s: State): Row[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const param = (id: string) => Number((byId.get(id)!.data as { value: number }).value)
  const pool: Record<string, number> = { pity: s.pity, pickup_owed: s.owed, ceiling_hits: 0, pulls_made: 0, ssr_count: 0 }
  const holds = (e: LoopEdge): boolean => {
    const a = parseActivatorExpr(String((e.data as { expr: string }).expr), 2)
    if (!a.ok) throw new Error(`condition ${e.id}`)
    const lhs = pool[e.source] ?? 0
    const rhs = a.rhs.kind === 'literal' ? a.rhs.n : param(a.rhs.id) + (a.rhs.offset ?? 0)
    return a.op === '<' ? lhs < rhs : a.op === '<=' ? lhs <= rhs : a.op === '>' ? lhs > rhs : a.op === '>=' ? lhs >= rhs : a.op === '!=' ? lhs !== rhs : lhs === rhs
  }
  const isGate = (id: string) => byId.get(id)?.type === 'gate'
  const enabled = (id: string) => g.edges.filter((e) => e.target === id && (e.data as { mode?: string }).mode === 'activator').every(holds)
  const flowOf = (e: LoopEdge) => {
    const f = String((e.data as { flow: string }).flow)
    return f.startsWith('@') ? param(f.slice(1)) : Number(f)
  }
  const resOut = (id: string) => g.edges.filter((e) => e.source === id && (e.data as { kind: string }).kind === 'resource').sort((a, b) => (a.id < b.id ? -1 : 1))
  const rows: Row[] = []
  const finish = (outcome: string, p: number, fired: string[]) => {
    const after = { ...pool } as Record<string, number>
    for (const e of g.edges.filter((x) => fired.includes(x.source) && (x.data as { mode?: string }).mode === 'label').sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const l = parseLabelExpr(String((e.data as { expr: string }).expr))
      if (!l.ok) throw new Error(`label ${e.id}`)
      const n = Number(l.n)
      after[e.target] = l.op === '=' ? n : l.op === '+' ? (after[e.target] ?? 0) + n : (after[e.target] ?? 0) - n
    }
    rows.push({ outcome, p, after: Object.fromEntries(TRACK.map((k) => [k, after[k] ?? 0])) as After })
  }
  const walk = (gid: string, mass: number, fired: string[]) => {
    const f = [...fired, gid]
    const outs = resOut(gid)
    const prob = (byId.get(gid)!.data as { distribution?: string }).distribution === 'probabilistic'
    const live = prob ? outs : outs.filter((e) => !isGate(e.target) || enabled(e.target))
    const sum = live.reduce((a, e) => a + flowOf(e), 0)
    if (!(sum > 0)) return finish('held', mass, fired)
    for (const e of live) {
      const p = (mass * flowOf(e)) / sum
      if (p === 0) continue
      if (isGate(e.target)) {
        if (enabled(e.target)) walk(e.target, p, f)
        else finish('held', p, f)
      } else finish(e.target, p, f)
    }
  }
  const starts = resOut('tickets').map((e) => e.target).filter((t) => isGate(t) && enabled(t))
  if (starts.length !== 1) throw new Error(`state ${JSON.stringify(s)}: ${starts.length} paths open`)
  walk(starts[0], 1, [])
  const merged = new Map<string, Row>()
  for (const r of rows) {
    const k = key(r)
    const m = merged.get(k)
    if (m) m.p += r.p
    else merged.set(k, { ...r })
  }
  return [...merged.values()].sort((a, b) => (key(a) < key(b) ? -1 : 1))
}
const key = (r: { outcome: string; after: After }) => `${r.outcome} ${JSON.stringify(r.after)}`

/** the engine from a state: the first pull's outcome and the values after it */
function firstPull(g: G, seed: number): { outcome: string; after: After } {
  let st: SimState = initSim(g.nodes)
  for (let i = 0; i < 6; i++) {
    const prev = st.values
    st = step(g.nodes, g.edges, st, seed, 2).state
    const v = st.values
    if (v.pulls_made > prev.pulls_made) {
      return { outcome: ['pickup_count', 'off_count', 'sr_count', 'r_count'].find((k) => v[k] > prev[k]) ?? 'none', after: Object.fromEntries(TRACK.map((k) => [k, v[k] ?? 0])) as After }
    }
  }
  return { outcome: 'held', after: Object.fromEntries(TRACK.map((k) => [k, st.values[k] ?? 0])) as After }
}

type RunRow = { v: Record<string, number>; ended: boolean; fired: string[] }
function run(g: G, steps: number, seed: number): RunRow[] {
  let st: SimState = initSim(g.nodes)
  const rows: RunRow[] = [{ v: { ...st.values }, ended: st.ended, fired: [] }]
  for (let i = 0; i < steps && !st.ended; i++) {
    st = step(g.nodes, g.edges, st, seed, 2).state
    rows.push({ v: { ...st.values }, ended: st.ended, fired: [...st.fired].sort() })
  }
  return rows
}
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('the pickup gacha (examples/gacha-pickup.json)', () => {
  it('opens unlocked; the two rates read against the target; two framed blocks', () => {
    expect(doc.recommendedRunConfig.canvasLocked).toBe(false)
    const expr = (id: string) => (doc.nodes.find((n) => n.id === id)!.data as { expr: string }).expr
    expect(expr('ssr_hit_rate')).toBe('@ssr_count / @target_pulls')
    expect(expr('pickup_rate')).toBe('@pickup_count / @target_pulls')
    expect((doc.frames ?? []).map((f) => f.id)).toEqual(['pity_block', 'pickup_block'])
    expect(doc.nodes).toHaveLength(31)
    expect(doc.edges).toHaveLength(32)
  })

  it('the roll: SSR, SR, R at 1 %, 9 %, 90 % of 1,000; the pickup split: 50 : 50', () => {
    const roll = gateChances(doc.nodes, doc.edges, 'roll', 2)!
    expect(Object.fromEntries(roll.branches.map((b) => [b.target, b.chance]))).toEqual({ ssr_result: 0.01, sr_result: 0.09, r_result: 0.9 })
    const split = gateChances(doc.nodes, doc.edges, 'pickup_split', 2)!
    expect(Object.fromEntries(split.branches.map((b) => [b.target, b.chance]))).toEqual({ pickup_ssr: 0.5, off_ssr: 0.5 })
  })

  for (const inp of INPUTS) {
    it(`1. the transition table equals the 3-zone zone's for every counter 0 … ceiling − 1 × owed 0 / 1 — ${inp.name}`, () => {
      const zone = zoneStructure()
      for (let pity = 0; pity < inp.hardPity; pity++) {
        for (const owed of [0, 1]) {
          const s = { pity, owed }
          const a = table(withInputs(doc, inp), s)
          const b = table(withInputs(zone, inp), s)
          expect(a.map(key), `${JSON.stringify(s)}: the rows`).toEqual(b.map(key))
          for (let i = 0; i < a.length; i++) expect(Math.abs(a[i].p - b[i].p), `${JSON.stringify(s)} ${key(a[i])}`).toBeLessThan(1e-12)
          expect(Math.abs(a.reduce((x, r) => x + r.p, 0) - 1)).toBeLessThan(1e-12)
          // the rules themselves: an SSR resets the counter, SR / R add one; an
          // off-pickup SSR turns the guarantee on, a pickup SSR clears it, SR /
          // R keep it; at the ceiling − 1 every outcome is an SSR and a ceiling
          // hit; while owed, an SSR is the pickup
          for (const r of a) {
            const ssr = r.outcome === 'pickup_count' || r.outcome === 'off_count'
            expect(r.after.pity).toBe(ssr ? 0 : pity + 1)
            expect(r.after.pickup_owed).toBe(r.outcome === 'off_count' ? 1 : r.outcome === 'pickup_count' ? 0 : owed)
            expect(r.after.ceiling_hits).toBe(pity === inp.hardPity - 1 ? 1 : 0)
            if (pity === inp.hardPity - 1) expect(ssr).toBe(true)
            if (owed === 1 && ssr) expect(r.outcome).toBe('pickup_count')
            expect(r.after.pulls_made).toBe(1)
            expect(r.after.ssr_count).toBe(ssr ? 1 : 0)
          }
        }
      }
    })

    it(`2. the engine from representative and boundary states lands on the table's rows at their chances — ${inp.name}`, () => {
      const c = inp.hardPity
      const counters = [...new Set([0, 1, c - 2, c - 1].filter((p) => p >= 0 && p <= c - 1))]
      for (const pity of counters) {
        for (const owed of [0, 1]) {
          const s = { pity, owed }
          const rows = table(withInputs(doc, inp), s)
          const g = withInputs(doc, inp, s, 5)
          const N = 600
          const count = new Map<string, number>()
          for (let seed = 1; seed <= N; seed++) {
            const o = firstPull(g, seed)
            expect(rows.map(key), `${JSON.stringify(s)} seed ${seed}`).toContain(key(o))
            count.set(key(o), (count.get(key(o)) ?? 0) + 1)
          }
          for (const r of rows) {
            const obs = (count.get(key(r)) ?? 0) / N
            expect(Math.abs(obs - r.p), `${JSON.stringify(s)} ${key(r)}: ${obs} vs ${r.p}`).toBeLessThanOrEqual(4 * Math.sqrt((r.p * (1 - r.p)) / N) + 1e-12)
            if (r.p >= 0.05) expect(obs).toBeGreaterThan(0)
          }
        }
      }
    })
  }

  it.each([
    ['the defaults (target 200)', { name: 'defaults', target: 200, hardPity: 80, w: [10, 90, 900], wp: [50, 50] }],
    ['ceiling 5, 100 / 300 / 600, 60 : 40, target 120', { name: 'c5', target: 120, hardPity: 5, w: [100, 300, 600], wp: [60, 40] }],
    ['ceiling 3, no natural SSR, 50 : 50, target 60', { name: 'c3', target: 60, hardPity: 3, w: [0, 500, 500], wp: [50, 50] }],
    ['ceiling 1, 50 : 50, target 30', { name: 'c1', target: 30, hardPity: 1, w: [10, 90, 900], wp: [50, 50] }],
  ] as const)('3. as generated, seeds 1–10 — %s: counts, tickets, the ceiling, the guarantee on / kept / used, both together, the end', (_n, inp) => {
    const i = { ...inp, w: [...inp.w] as [number, number, number], wp: [...inp.wp] as [number, number] }
    const target = i.target!
    let together = 0
    let kept = 0
    for (const seed of SEEDS) {
      const rows = run(withInputs(doc, i), target + 10, seed)
      for (let s = 1; s < rows.length; s++) {
        const a = rows[s - 1].v
        const b = rows[s].v
        const at = `seed ${seed} step ${s}`
        expect(b.pickup_count + b.off_count, `${at}: pickup + off-pickup = SSR`).toBe(b.ssr_count)
        expect(b.ssr_count + b.sr_count + b.r_count, `${at}: counts`).toBe(b.pulls_made)
        expect(b.tickets + b.pulls_made, `${at}: one ticket per pull`).toBe(target)
        const pulled = b.pulls_made - a.pulls_made
        expect(pulled === 0 || pulled === 1, `${at}: at most one pull`).toBe(true)
        if (!pulled) continue
        const o = b.pickup_count > a.pickup_count ? 'pickup' : b.off_count > a.off_count ? 'off' : 'srr'
        const ssr = o !== 'srr'
        const atCeiling = a.pity === i.hardPity - 1
        expect(b.ceiling_hits - a.ceiling_hits, `${at}: a ceiling hit exactly at the ceiling − 1`).toBe(atCeiling ? 1 : 0)
        if (atCeiling) expect(ssr, `${at}: at the ceiling, an SSR`).toBe(true)
        expect(b.pity, `${at}: the counter`).toBe(ssr ? 0 : a.pity + 1)
        if (a.pickup_owed === 1 && ssr) expect(o, `${at}: owed — the SSR is the pickup`).toBe('pickup')
        if (a.pickup_owed === 1 && !ssr) kept++
        if (a.pickup_owed === 1 && atCeiling) together++
        expect(b.pickup_owed, `${at}: the guarantee`).toBe(o === 'off' ? 1 : o === 'pickup' ? 0 : a.pickup_owed)
      }
      const endAt = rows.findIndex((r) => r.ended)
      expect(endAt, `seed ${seed}: the end at target + 2`).toBe(target + 2)
      expect(rows[endAt].v.pulls_made).toBe(target)
      expect(rows[endAt - 1].v.completion_signal).toBe(1)
    }
    // (at ceiling 1 every pull is an SSR: no SR / R to keep the guarantee over)
    if (i.hardPity > 1) expect(kept, 'SR / R pulls while owed were checked').toBeGreaterThan(0)
    if (i.hardPity <= 5) expect(together, 'the ceiling and the guarantee together were checked').toBeGreaterThan(0)
  })

  it('4. it reproduces itself: the same inputs and seed, run twice and from a fresh copy of the file, the same every step', () => {
    const fresh = JSON.parse(JSON.stringify(pickupDoc)) as G
    for (const inp of INPUTS) {
      for (const seed of SEEDS) {
        const a = run(withInputs(doc, inp), 120, seed)
        expect(run(withInputs(doc, inp), 120, seed), `${inp.name} seed ${seed}: twice`).toEqual(a)
        expect(run(withInputs(fresh, inp), 120, seed), `${inp.name} seed ${seed}: a fresh copy`).toEqual(a)
      }
    }
  })

  it('the default horizon (target 200 + 2) is the end step', () => {
    expect(doc.recommendedRunConfig.steps).toBe(202)
    const rows = run(doc, 202, 1)
    expect(rows[rows.length - 1].ended).toBe(true)
  })
})
