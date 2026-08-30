// loop-model/1 §M3.5 — the ONE `R(currentStepIndex)` map every observer reads.
//
// A single `evaluateRegisters` pass per snapshot identity `(nodes, S(t))`,
// shared by the Canvas nodes, the Inspector, and the Timeline's "current" read
// via a module-level identity cache (Zustand keeps `nodes` / `values`
// referentially stable until they actually change, so every component in one
// render pass gets the SAME map with no recompute). A graph edit / reset / load
// swaps the `nodes` or `values` reference ⇒ the cache misses ⇒ exactly one
// recompute. Nothing is stored in a store or the Workspace (M-INV-2).

import {
  initialPoolValues,
  registersOfSnapshot,
  type RegisterOutcome,
} from '../model/model'
import type { LoopNode } from '../model/types'
import type { SimValues } from '../engine'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

type Snapshot = { nodes: LoopNode[]; values: SimValues | null }

let cacheKey: Snapshot | null = null
let cacheMap: ReadonlyMap<string, RegisterOutcome> = new Map()
let evalCount = 0

/** `R(currentStepIndex)` for every Register — computed at most once per
 *  `(nodes, values)` identity. */
export function currentRegisterOutcomes(
  nodes: LoopNode[],
  values: SimValues | null,
): ReadonlyMap<string, RegisterOutcome> {
  if (cacheKey && cacheKey.nodes === nodes && cacheKey.values === values) return cacheMap
  cacheMap = registersOfSnapshot(nodes, values ?? initialPoolValues(nodes))
  cacheKey = { nodes, values }
  evalCount += 1
  return cacheMap
}

/** test hook — how many times the current-step DAG has actually been evaluated. */
export function __registerEvalCount(): number {
  return evalCount
}
/** test hook — drop the identity cache. */
export function __resetRegisterCache(): void {
  cacheKey = null
  cacheMap = new Map()
  evalCount = 0
}

export function useRegisterOutcomes(): ReadonlyMap<string, RegisterOutcome> {
  const nodes = useGraphStore((s) => s.nodes)
  const values = useSimStore((s) => s.values)
  return currentRegisterOutcomes(nodes, values)
}

export function useRegisterOutcome(id: string): RegisterOutcome | undefined {
  return useRegisterOutcomes().get(id)
}
