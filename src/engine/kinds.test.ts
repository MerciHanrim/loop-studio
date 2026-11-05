import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { ResourceKindDecl } from '../model/kinds'
import { initSim, step } from './step'

// loop-model/3 (#471, kinds-units-design.md rev 3; SEMANTICS-M3.md) — the
// engine side of the kinds contract: what runs, what is refused, and the
// boundary outflow by kind, on the desalination shapes the design verified
// (A: well-formed, C: a wrong ratio, R6: an `all` feed line), a Gate carrying
// two kinds, and a Converter line with no kind. The per-connection resolution
// and finding rows are in src/model/kinds.test.ts.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial: number, resourceType?: string, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny', ...(resourceType ? { resourceType } : {}) } as LoopNode['data'],
})
const node = (id: string, kind: 'source' | 'drain' | 'end' | 'gate' | 'converter'): LoopNode => ({
  id, type: kind, position: XY,
  data: { kind, label: id, activation: kind === 'source' ? 'automatic' : 'automatic', mode: kind === 'source' ? 'pushAny' : 'pullAny' } as unknown as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow = '1', resourceType?: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow, ...(resourceType ? { resourceType } : {}) } as LoopEdge['data'],
})

const WATER: ResourceKindDecl[] = [{ name: 'water', conserved: true, baseUnit: 'm³' }, { name: 'power', conserved: false, baseUnit: 'kWh' }]

/** the desalination plant: sea water and power into the RO Converter, permeate
 *  and brine into Pools, a small evaporation loss into a Drain on a line that
 *  says it is water. `feed` 100 water in; `permeate` + `brine` + 2 out. */
function plant(feed: string, permeate: string, brine: string, extra: { evapKind?: string; evapRate?: string } = {}) {
  const nodes = [
    pool('sea', 1000, 'water'), pool('power', 1000, 'power'),
    node('ro', 'converter'),
    pool('permeate', 0, 'water'), pool('brine', 0, 'water'),
    node('evap', 'drain'),
  ]
  const edges = [
    res('e_feed_ro', 'sea', 'ro', feed),
    res('e_power_ro', 'power', 'ro', '30'),
    res('e_ro_perm', 'ro', 'permeate', permeate),
    res('e_ro_brine', 'ro', 'brine', brine),
    res('e_ro_evap', 'ro', 'evap', extra.evapRate ?? '2', extra.evapKind ?? 'water'),
  ]
  return { nodes, edges }
}

function run(nodes: LoopNode[], edges: LoopEdge[], steps: number, kinds?: ResourceKindDecl[]) {
  let st = initSim(nodes)
  const reports = []
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1, kinds ? 3 : 2, kinds ? { kinds } : {})
    st = r.state
    reports.push(r.report)
  }
  return { state: st, reports }
}

describe('loop-model/3 — the desalination shapes (design §6, §7)', () => {
  it('A: a balanced plant runs under the kinds table exactly as under loop-model/2, and reports its water outflow', () => {
    const { nodes, edges } = plant('100', '45', '53')
    const v2 = run(nodes, edges, 5)
    const v3 = run(nodes, edges, 5, WATER)
    expect(v3.state).toEqual(v2.state)
    for (let i = 0; i < 5; i++) {
      const { boundaryOutflow: _ignored, ...rest } = v3.reports[i]!
      expect(rest).toEqual(v2.reports[i])
      // L1 — the evaporation line is water into "evap": an outflow, never a loss
      expect(v3.reports[i]!.boundaryOutflow).toEqual([{ kind: 'water', nodeId: 'evap', amount: 2, raw: 2 }])
      expect(v2.reports[i]!.boundaryOutflow).toBeUndefined()
    }
    expect(v3.state.values).toEqual({ sea: 500, power: 850, permeate: 225, brine: 265 })
  })

  it('M3-INV-2: per step, water in the Pools changes by exactly the Drain intake', () => {
    const { nodes, edges } = plant('100', '45', '53')
    let st = initSim(nodes)
    for (let i = 0; i < 5; i++) {
      const before = st.values.sea! + st.values.permeate! + st.values.brine!
      const r = step(nodes, edges, st, 1, 3, { kinds: WATER })
      const out = r.report.boundaryOutflow!.filter((o) => o.kind === 'water').reduce((s, o) => s + o.amount, 0)
      const after = r.state.values.sea! + r.state.values.permeate! + r.state.values.brine!
      expect(after).toBeCloseTo(before - out, 9)
      st = r.state
    }
  })

  it('C: a wrong ratio is a broken water balance — refused in step with the state unchanged and one diagnostic; loop-model/2 runs it', () => {
    const { nodes, edges } = plant('100', '50', '53') // 105 out of 100 in
    const v2 = run(nodes, edges, 1)
    expect(v2.state.values.permeate).toBe(50)
    const st = initSim(nodes)
    const r = step(nodes, edges, st, 1, 3, { kinds: WATER })
    expect(r.state.values).toEqual(st.values)
    expect(r.state.step).toBe(0)
    expect(r.report.events).toEqual([])
    expect(r.report.diagnostics).toHaveLength(1)
    // loop-model/4 (§M4-5) — the sums and their exact difference, under R≈
    expect(r.report.diagnostics[0]).toMatch(/^Can't run: Converter "ro" takes in 100 "water" and puts out 105 \(out − in 5\)\./)
    expect(r.report.boundaryOutflow).toBeUndefined()
  })

  it('R6: an `all` feed line is "not computable", never a derived 100 ≠ 0 — refused with that one diagnostic', () => {
    const { nodes, edges } = plant('all', '45', '53')
    const st = initSim(nodes)
    const r = step(nodes, edges, st, 1, 3, { kinds: WATER })
    expect(r.state.values).toEqual(st.values)
    expect(r.report.diagnostics).toHaveLength(1)
    expect(r.report.diagnostics[0]).toMatch(/the rate "all" on the connection from "sea" to "ro" is not a number, so the "water" balance of Converter "ro" cannot be computed/)
    expect(r.report.diagnostics[0]).not.toMatch(/100/)
  })

  it('a Converter output into a Drain with no kind cannot be balanced where water is conserved — refused; with no conserved kind it is only untyped', () => {
    const { nodes, edges } = plant('100', '45', '53', { evapKind: '' })
    const st = initSim(nodes)
    const refused = step(nodes, edges, st, 1, 3, { kinds: WATER })
    expect(refused.state.values).toEqual(st.values)
    expect(refused.report.diagnostics).toEqual([
      'Can\'t run: the connection from "ro" to "evap" has no kind, so the balance of Converter "ro" cannot be computed and nothing moved.',
    ])
    const free = step(nodes, edges, st, 1, 3, { kinds: [{ name: 'water', conserved: false }] })
    expect(free.state.values.permeate).toBe(45)
    expect(free.report.boundaryOutflow).toEqual([{ kind: null, nodeId: 'evap', amount: 2, raw: 2 }])
  })

  it('§M4-9: `raw` is the engine sum before the report rounds it to 9 decimals, and `amount` does not move', () => {
    const nodes = [pool('w', 100, 'water'), node('d', 'drain')]
    const edges = [res('a', 'w', 'd', String(50 / 3))]
    const r = step(nodes, edges, initSim(nodes), 1, 3, { kinds: [{ name: 'water', conserved: false }] })
    expect(r.report.boundaryOutflow).toEqual([{ kind: 'water', nodeId: 'd', amount: 16.666666667, raw: 50 / 3 }])
  })

  it('a Gate whose connections carry two kinds is refused when one of them is conserved', () => {
    const nodes = [pool('w', 100, 'water'), pool('p', 100, 'power'), node('g', 'gate'), node('d', 'drain')]
    const edges = [res('a', 'w', 'g', '5'), res('b', 'p', 'g', '5'), res('c', 'g', 'd', '10')]
    const st = initSim(nodes)
    const r = step(nodes, edges, st, 1, 3, { kinds: WATER })
    expect(r.state.values).toEqual(st.values)
    expect(r.report.diagnostics).toEqual(['Can\'t run: Gate "g" carries "power" and "water". A Gate carries one kind, so nothing moved.'])
    const v2 = step(nodes, edges, st, 1, 2)
    expect(v2.state.values.w).toBe(95)
  })

  it('review 3 — `water Pool → Gate → untyped Pool` with water conserved is refused, naming the Pool; loop-model/2 moves the water out of the only water Pool', () => {
    const nodes = [pool('w', 100, 'water'), node('g', 'gate'), pool('u', 0)]
    const edges = [res('a', 'w', 'g', '5'), res('b', 'g', 'u', '5')]
    // under loop-model/2 the water leaves the only water Pool: a water sum over the water Pools drops by 5 with no outflow — M3-INV-2 needs the refusal
    const v2 = step(nodes, edges, initSim(nodes), 1, 2)
    expect(v2.state.values).toEqual({ w: 95, u: 5 })
    const st = initSim(nodes)
    const r = step(nodes, edges, st, 1, 3, { kinds: WATER })
    expect(r.state.values).toEqual(st.values)
    expect(r.state.step).toBe(0)
    expect(r.report.events).toEqual([])
    expect(r.report.diagnostics).toEqual([
      'Can\'t run: the connection from "g" to "u" is "water", but its Pool "u" has no kind. A conserved kind moves between Pools that declare it, so nothing moved.',
    ])
    // not conserved: the same fact is a finding only, and the water moves as under loop-model/2
    const free = step(nodes, edges, st, 1, 3, { kinds: [{ name: 'water', conserved: false }] })
    expect(free.state.values).toEqual({ w: 95, u: 5 })
    // the direct `water Pool → untyped Pool` line is the same conflict at resolution (src/model/kinds.test.ts, review 3); nothing drives it on its own in the engine
  })

  it('M3-INV-1: a /graph/3 document with no kinds table computes, event for event, what loop-model/2 computes', () => {
    const { nodes, edges } = plant('all', '45', '53') // the R6 shape — refused only under a conserved kind
    const v2 = run(nodes, edges, 3)
    let st = initSim(nodes)
    for (let i = 0; i < 3; i++) {
      const r = step(nodes, edges, st, 1, 3, { kinds: [] })
      expect(r.report).toEqual(v2.reports[i])
      st = r.state
    }
    expect(st).toEqual(v2.state)
  })
})
