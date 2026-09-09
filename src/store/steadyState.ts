import type { FlowEvent } from '../engine'

// docs/simulation-playback-ordering.md §PBO5 — steady-state detection.
// Presentation-only, session-only: a boolean the PlayBar chip reads. Never
// serialized; no engine / RNG / GraphDoc / digest / undo / autosave effect.

/** consecutive committed steps that must agree */
export const STEADY_N = 3
/** `|a − b| ≤ STEADY_ABS_EPS + STEADY_REL_EPS · max(|a|, |b|)` — an ε-tolerant
 *  equality: variation below this is treated as unchanged by design (not a
 *  guarantee about any particular run). The abs term is looser than the engine
 *  `EPSILON` (1e-9) to absorb float accumulation in the stored `series`. */
export const STEADY_ABS_EPS = 1e-6
export const STEADY_REL_EPS = 1e-9
/** every sample must carry more than this total flow ("flows continue") */
export const STEADY_MIN_FLOW = 1e-6

export type SteadySample = {
  step: number
  /** committed Pool balances, keyed by node.id */
  pools: Readonly<Record<string, number>>
  /** raw Σ FlowEvent.amount per edge.id — NOT a render-filtered / capped map */
  flow: Readonly<Record<string, number>>
}

/** raw per-edge flow totals straight from the unfiltered event list — never
 *  touched by LOD, the travelling-token budget, or any display threshold. */
export function flowTotals(events: readonly FlowEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const ev of events) out[ev.edgeId] = (out[ev.edgeId] ?? 0) + ev.amount
  return out
}

const approxEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= STEADY_ABS_EPS + STEADY_REL_EPS * Math.max(Math.abs(a), Math.abs(b))

/** every key in `a ∪ b` is ε-equal, missing ⇒ 0 — compared by id, not order. */
function mapsApproxEqual(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (!approxEqual(a[k] ?? 0, b[k] ?? 0)) return false
  return true
}

const sumValues = (m: Readonly<Record<string, number>>): number => {
  let s = 0
  for (const k in m) s += m[k]
  return s
}

/**
 * §PBO5 — the system is steady iff the window holds exactly `STEADY_N`
 * consecutive committed steps and, for BOTH adjacent pairs, the Pool vector AND
 * the whole edge-flow vector are pairwise ε-equal, AND every sample's total flow
 * exceeds `STEADY_MIN_FLOW`. A frozen / stopped run (Σ flow ≈ 0 anywhere in the
 * window) is not steady — it is stopped, and gets no label.
 */
export function isSteady(window: readonly SteadySample[]): boolean {
  if (window.length !== STEADY_N) return false
  for (let i = 1; i < window.length; i++) {
    if (window[i].step !== window[i - 1].step + 1) return false // consecutive
  }
  for (const s of window) {
    if (sumValues(s.flow) <= STEADY_MIN_FLOW) return false
  }
  for (let i = 1; i < window.length; i++) {
    if (!mapsApproxEqual(window[i - 1].pools, window[i].pools)) return false
    if (!mapsApproxEqual(window[i - 1].flow, window[i].flow)) return false
  }
  return true
}
