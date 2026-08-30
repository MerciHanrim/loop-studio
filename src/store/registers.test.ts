import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopNode } from '../model/types'
import {
  __registerEvalCount,
  __resetRegisterCache,
  currentRegisterOutcomes,
} from './registers'

// loop-model/1 §M3.5 — "one R(t)" must mean ONE `evaluateRegisters` pass per
// snapshot identity `(nodes, S(t))`, shared by every observer. The Canvas nodes,
// the Inspector, and the Timeline all read the SAME map without re-evaluating.

const node = (id: string, data: Record<string, unknown>): LoopNode =>
  ({ id, type: data.kind as string, position: { x: 0, y: 0 }, data }) as unknown as LoopNode

const graph = (nRegisters: number): LoopNode[] => {
  const nodes: LoopNode[] = [
    node('pool_a', { kind: 'pool', label: 'A', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' }),
    node('p_k', { kind: 'parameter', label: 'k', value: 2 }),
  ]
  for (let i = 0; i < nRegisters; i++) nodes.push(node(`r_${i}`, { kind: 'register', label: `r${i}`, expr: '@pool_a * @p_k + ' + i }))
  return nodes
}

beforeEach(() => __resetRegisterCache())

describe('currentRegisterOutcomes — one evaluation per (nodes, values) identity', () => {
  it('rendering N Register observers ⇒ the current-step DAG is evaluated exactly once', () => {
    const nodes = graph(8)
    const values = { pool_a: 5 }
    // simulate the Canvas asking once per RegisterNode, plus the Inspector, plus
    // the Timeline legend — all in one render pass, same object identities
    const reads = Array.from({ length: 8 + 1 + 1 }, () => currentRegisterOutcomes(nodes, values))
    expect(__registerEvalCount()).toBe(1)
    // every reader got the SAME map instance
    for (const m of reads) expect(m).toBe(reads[0])
    expect(reads[0].get('r_3')).toEqual({ invalid: false, value: 13 })
  })

  it('a new nodes reference (graph edit) or a new values reference (a step) re-evaluates once', () => {
    const n1 = graph(4)
    const v1 = { pool_a: 5 } // Zustand keeps `values` referentially stable between renders
    currentRegisterOutcomes(n1, v1)
    currentRegisterOutcomes(n1, v1) // same identities — cached
    expect(__registerEvalCount()).toBe(1)

    currentRegisterOutcomes(n1, { pool_a: 6 }) // new values ref (a step) — recompute
    expect(__registerEvalCount()).toBe(2)

    const n2 = graph(4) // new nodes ref (an edit / reset / load) — recompute
    currentRegisterOutcomes(n2, { pool_a: 6 })
    expect(__registerEvalCount()).toBe(3)
  })

  it('idle (values = null) uses S(0) from the pools’ initial, still one eval', () => {
    const nodes = graph(3)
    currentRegisterOutcomes(nodes, null)
    currentRegisterOutcomes(nodes, null)
    expect(__registerEvalCount()).toBe(1)
    expect(currentRegisterOutcomes(nodes, null).get('r_0')).toEqual({ invalid: false, value: 10 }) // 5 * 2 + 0
  })
})
