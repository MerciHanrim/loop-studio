import { describe, expect, it } from 'vitest'
import fixtureDoc from '../../examples/risky-factory.json'
import { buildTermChart } from '../components/TerminationSparkline'
import { normalizeGraph, serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { runMonteCarlo, runSeed } from './montecarlo'
import { buildRiskyFactory, RISKY_FACTORY_MC } from './risky-factory.fixture'
import { initSim, step } from './step'

// `examples/risky-factory.json` is the hands-on demo graph — one connected
// economy that touches every working node kind and Engine A/B feature. It is
// generated from `buildRiskyFactory()` (below) via the real serializer.
//
// Unlike engine-b-verification.*, this is NOT a value oracle: the smoke test
// below pins only structural invariants, so honest engine changes that shift
// the numbers don't force a fixture rewrite.
//
// Regenerate after a deliberate change:  GEN_RISKY_FACTORY=1 npx vitest run src/engine/risky-factory.test.ts

const built = buildRiskyFactory()

function trace(nodes: LoopNode[], edges: LoopEdge[], seed: number, steps: number) {
  let st = initSim(nodes)
  const rows: number[][] = []
  for (let t = 1; t <= steps; t++) {
    st = step(nodes, edges, st, seed).state
    rows.push(nodes.filter((n) => n.data.kind === 'pool').map((n) => st.values[n.id] ?? 0))
  }
  return JSON.stringify(rows)
}

describe('risky-factory example', () => {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_RISKY_FACTORY === '1') {
    it('regenerates examples/risky-factory.json', async () => {
      const fs = await import('node:' + 'fs')
      fs.writeFileSync(
        new URL('../../examples/risky-factory.json', import.meta.url),
        serialize(built.nodes, built.edges) + '\n',
      )
    })
    return
  }

  const { nodes, edges } = normalizeGraph(fixtureDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
  const id = (label: string) => nodes.find((n) => n.data.label === label)!.id

  it('the committed file matches buildRiskyFactory() through the serializer', () => {
    expect(fixtureDoc).toEqual(JSON.parse(serialize(built.nodes, built.edges)))
  })

  it('uses every working node kind', () => {
    const kinds = new Set(nodes.map((n) => n.data.kind))
    expect([...kinds].sort()).toEqual(['converter', 'drain', 'end', 'gate', 'pool', 'source'])
  })

  it('has one deterministic and one probabilistic Gate, no state edges', () => {
    const gates = nodes.filter((n) => n.data.kind === 'gate')
    expect(gates.map((g) => (g.data as { distribution: string }).distribution).sort()).toEqual([
      'deterministic',
      'probabilistic',
    ])
    expect(edges.every((e) => (e.data?.kind ?? 'resource') === 'resource')).toBe(true)
  })

  it('is reproducible: same seed ⇒ identical trajectory, different seed diverges', () => {
    expect(trace(nodes, edges, 4, 24)).toBe(trace(nodes, edges, 4, 24))
    expect(trace(nodes, edges, 4, 24)).not.toBe(trace(nodes, edges, 9, 24))
  })

  it('the probabilistic Quality Gate routes at most one branch per step', () => {
    const qc = id('Quality Gate')
    let st = initSim(nodes)
    let maxBranches = 0
    let sawRoute = false
    for (let t = 1; t <= 40; t++) {
      const r = step(nodes, edges, st, 4)
      st = r.state
      const outs = r.report.events.filter((e) => e.from === qc)
      maxBranches = Math.max(maxBranches, outs.length)
      if (outs.length === 1) sawRoute = true
    }
    expect(maxBranches).toBe(1)
    expect(sawRoute).toBe(true)
  })

  it('the deterministic Ore Router splits ≈ 4 : 1 (refined ore : tailings)', () => {
    const refine = edges.find((e) => e.id === 'e_route_refine')!.id
    const tail = edges.find((e) => e.id === 'e_route_tail')!.id
    let st = initSim(nodes)
    let toRefine = 0
    let toTail = 0
    for (let t = 1; t <= 40; t++) {
      const r = step(nodes, edges, st, 3)
      st = r.state
      for (const e of r.report.events) {
        if (e.edgeId === refine) toRefine += e.amount
        if (e.edgeId === tail) toTail += e.amount
      }
    }
    expect(toRefine / toTail).toBeGreaterThan(3.4)
    expect(toRefine / toTail).toBeLessThan(4.6)
  })

  it('the Assembly Converter turns ore + energy into Components, and Finished Goods appear', () => {
    const comp = id('Components')
    const fin = id('Finished Goods')
    let st = initSim(nodes)
    let compSeen = 0
    let finSeen = 0
    for (let t = 1; t <= 40; t++) {
      st = step(nodes, edges, st, 3).state // seed 3 survives all 40 steps
      compSeen = Math.max(compSeen, st.values[comp] ?? 0)
      finSeen = Math.max(finSeen, st.values[fin] ?? 0)
    }
    expect(compSeen).toBeGreaterThanOrEqual(2)
    expect(finSeen).toBeGreaterThan(0)
  })

  describe('Monte Carlo (baseSeed 1, 500 × 40)', () => {
    const mc = runMonteCarlo(nodes, edges, { ...RISKY_FACTORY_MC })
    const cum = mc.endedRuns.atOrBeforeStep

    it('is deterministic — the same config reproduces byte-identical output', () => {
      const again = runMonteCarlo(nodes, edges, { ...RISKY_FACTORY_MC })
      expect(again.series).toEqual(mc.series)
      expect(again.endedRuns).toEqual(mc.endedRuns)
      expect(again.final).toEqual(mc.final)
    })

    it('the cumulative-termination vector has length steps+1 and is monotone non-decreasing', () => {
      expect(cum).toHaveLength(RISKY_FACTORY_MC.steps + 1)
      for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1])
    })

    it('the last cumulative value equals an independent recount of ended runs', () => {
      // re-run every derived per-run seed by hand and count the ones that hit End
      let ended = 0
      for (let i = 0; i < RISKY_FACTORY_MC.runs; i++) {
        const s = runSeed(RISKY_FACTORY_MC.baseSeed, i)
        let st = initSim(nodes)
        for (let t = 1; t <= RISKY_FACTORY_MC.steps && !st.ended; t++) {
          st = step(nodes, edges, st, s).state
        }
        if (st.ended) ended++
      }
      expect(cum.at(-1)).toBe(ended)
    })

    it('the termination rate is strictly between 0 % and 100 %', () => {
      const rate = cum.at(-1)! / mc.completedRuns
      expect(rate).toBeGreaterThan(0)
      expect(rate).toBeLessThan(1)
    })

    it('feeds the termination sparkline a real line + Bead', () => {
      const chart = buildTermChart(mc, { w: 720, h: 34 })
      expect(chart.anyEnded).toBe(true)
      expect(chart.finalRate).toBeGreaterThan(0)
      expect(chart.finalRate).toBeLessThan(1)
      expect(chart.linePath.startsWith('M ')).toBe(true)
      expect(Number.isFinite(chart.beadX)).toBe(true)
      expect(Number.isFinite(chart.beadY)).toBe(true)
    })

    it('tracks the six recommended Pools and Finished Goods shows real spread (p90 > p10)', () => {
      for (const pid of RISKY_FACTORY_MC.tracked) {
        expect(mc.series[pid], `series for ${pid}`).toBeTruthy()
      }
      const fin = mc.final[id('Finished Goods')].summary
      expect(fin.p90).toBeGreaterThan(fin.p10)
    })
  })
})
