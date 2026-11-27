import { describe, expect, it } from 'vitest'
import coffeeDoc from '../../examples/coffee-roastery.json'
import { initSim, step } from '../engine'
import type { FlowEvent } from '../engine'
import { normalizeGraph } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { computeStagger, STAGGER_MAX_BUCKETS, STAGGER_SPAN } from './playbackRank'

// issue #617 item 7 (Lumi, 2026-11-27) — playback onsets: one bucket per depth,
// at most STAGGER_MAX_BUCKETS; groups at the same depth start together, a depth
// is never split over two buckets, and everything deeper than the last bucket
// folds into it.

const N = (id: string, kind: LoopNode['data']['kind']): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id } }) as unknown as LoopNode
const E = (id: string, source: string, target: string): LoopEdge =>
  ({ id, source, target, type: 'loop', data: { kind: 'resource', flow: '1' } }) as unknown as LoopEdge
const EV = (edgeId: string, from: string, to: string): FlowEvent => ({ edgeId, from, to, amount: 1 })

/** a source into pool p0, then `depths` gates in a chain (each with its pool), and
 *  `siblings` more gates hanging off the pool before chain gate `at` (the same depth) */
function chain(depths: number, at: number, siblings: number) {
  const nodes: LoopNode[] = [N('src', 'source'), N('p0', 'pool')]
  const edges: LoopEdge[] = [E('e0', 'src', 'p0')]
  const events: FlowEvent[] = [EV('e0', 'src', 'p0')]
  let prev = 'p0'
  for (let i = 1; i <= depths; i++) {
    const g = `g${i}`
    const p = `p${i}`
    nodes.push(N(g, 'gate'), N(p, 'pool'))
    edges.push(E(`eg${i}`, prev, g), E(`ep${i}`, g, p))
    events.push(EV(`eg${i}`, prev, g), EV(`ep${i}`, g, p))
    if (i === at) {
      for (let s = 1; s <= siblings; s++) {
        const sg = `s${i}_${s}`
        const sp = `sp${i}_${s}`
        nodes.push(N(sg, 'gate'), N(sp, 'pool'))
        edges.push(E(`es${i}_${s}`, prev, sg), E(`esp${i}_${s}`, sg, sp))
        events.push(EV(`es${i}_${s}`, prev, sg), EV(`esp${i}_${s}`, sg, sp))
      }
    }
    prev = p
  }
  return { nodes, edges, events }
}

describe('#617 item 7 — one onset bucket per depth', () => {
  it('sibling gates at the same depth start together', () => {
    const { nodes, edges, events } = chain(3, 2, 2)
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    expect(onsetByEdge['es2_1']).toBe(onsetByEdge['eg2'])
    expect(onsetByEdge['es2_2']).toBe(onsetByEdge['eg2'])
    // and the depths still cascade: Phase 1, depth 1, depth 2, depth 3
    expect(onsetByEdge['e0']).toBe(0)
    expect(onsetByEdge['eg1']).toBeGreaterThan(onsetByEdge['e0'])
    expect(onsetByEdge['eg2']).toBeGreaterThan(onsetByEdge['eg1'])
    expect(onsetByEdge['eg3']).toBeGreaterThan(onsetByEdge['eg2'])
  })

  it('a depth is never split over two buckets, next to the fold either', () => {
    // Phase 1 and depths 1–3 take buckets 0–3; depth 4 has two groups, depth 5 one.
    // One bucket per group put depth 4 over buckets 4 and 5 (the second sharing the
    // last bucket with depth 5)
    const { nodes, edges, events } = chain(5, 4, 1)
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    expect(onsetByEdge['es4_1']).toBe(onsetByEdge['eg4'])
    expect(onsetByEdge['eg5']).toBeGreaterThan(onsetByEdge['eg4'])
  })

  it('the bucket count is the number of distinct depths (Phase 1 one of them), at most the cap', () => {
    expect(computeStagger(...Object.values(chain(3, 2, 2)) as [LoopNode[], LoopEdge[], FlowEvent[]]).bucketCount).toBe(4)
    expect(computeStagger(...Object.values(chain(9, 4, 3)) as [LoopNode[], LoopEdge[], FlowEvent[]]).bucketCount).toBe(STAGGER_MAX_BUCKETS)
  })

  it('everything deeper than the last bucket folds into it; the depths before it stay apart', () => {
    const { nodes, edges, events } = chain(9, 4, 3)
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    const at = (d: number) => onsetByEdge[`eg${d}`]
    expect([0, 1, 2, 3, 4].map((d) => (d === 0 ? onsetByEdge['e0'] : at(d)))).toEqual([0, 1, 2, 3, 4].map((k) => (STAGGER_SPAN * k) / (STAGGER_MAX_BUCKETS - 1)))
    for (const d of [5, 6, 7, 8, 9]) expect(at(d)).toBe(STAGGER_SPAN)
    // the depth-4 siblings with their chain gate
    for (let s = 1; s <= 3; s++) expect(onsetByEdge[`es4_${s}`]).toBe(at(4))
  })

  it('Coffee roastery: the three outflows of Roasted bean stock start together', () => {
    const { nodes, edges } = normalizeGraph(coffeeDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
    let st = initSim(nodes)
    let events: FlowEvent[] = []
    for (let i = 0; i < 6; i++) {
      const r = step(nodes, edges, st, 1)
      st = r.state
      events = [...r.report.events]
    }
    const ids = ['e_cafe_retail', 'e_online', 'e_roasted_bleed']
    const { onsetByEdge } = computeStagger(nodes, edges, events)
    for (const id of ids) expect(id in onsetByEdge, id).toBe(true)
    expect(new Set(ids.map((id) => onsetByEdge[id])).size).toBe(1)
  })
})
