// loop-model/1 §M3.5 — the ONE `R(currentStepIndex)` every observer reads.
//
// Nothing is cached in a store: Register values are a pure function of the
// committed snapshot S(t) and the GraphDoc, recomputed on demand (M-INV-2).
// The Canvas, the Inspector, and the Timeline all go through here so they can
// never disagree.

import { useMemo } from 'react'
import {
  initialPoolValues,
  registersOfSnapshot,
  type RegisterOutcome,
} from '../model/model'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

/** `R(currentStepIndex)` for every Register — `S(t)` is the live sim's pool
 *  counts, or the pools' `initial` values when no run is live (`R(0)`). */
export function useRegisterOutcomes(): Map<string, RegisterOutcome> {
  const nodes = useGraphStore((s) => s.nodes)
  const values = useSimStore((s) => s.values)
  return useMemo(
    () => registersOfSnapshot(nodes, values ?? initialPoolValues(nodes)),
    [nodes, values],
  )
}

export function useRegisterOutcome(id: string): RegisterOutcome | undefined {
  return useRegisterOutcomes().get(id)
}
