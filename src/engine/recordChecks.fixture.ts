import { add, cmp, exactDouble, fromInt, sub, type Rational } from '../model/rational'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step, type StepMove, type StepResult } from './index'

// What a test reads off a step's record of moves (SEMANTICS-E.md §E2, §E3), in exact fractions.

export const ZERO: Rational = fromInt(0)
export const amountOf = (m: StepMove): Rational => ({ num: BigInt(m.num), den: BigInt(m.den) })
export const same = (a: Rational, b: Rational) => cmp(a, b) === 0

/** Every Pool that the record takes under 0 or over its capacity (§E3): each Pool's level is
 *  walked from its value before the step, move by move. (For a step with no Phase-0 `label`.) */
export function outsideBounds(nodes: LoopNode[], before: Record<string, number>, moves: readonly StepMove[]): string[] {
  const level = new Map<string, Rational>()
  const cap = new Map<string, number | null>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    level.set(n.id, exactDouble(before[n.id] ?? 0))
    cap.set(n.id, n.data.capacity)
  }
  const out: string[] = []
  for (const m of moves) {
    if (level.has(m.from)) {
      const l = sub(level.get(m.from)!, amountOf(m))
      level.set(m.from, l)
      if (cmp(l, ZERO) < 0) out.push(`${m.from} is under 0 after the move on ${m.edgeId}`)
    }
    if (level.has(m.to)) {
      const l = add(level.get(m.to)!, amountOf(m))
      level.set(m.to, l)
      const c = cap.get(m.to)
      if (c != null && cmp(l, exactDouble(c)) > 0) out.push(`${m.to} is over its capacity after the move on ${m.edgeId}`)
    }
  }
  return out
}

export type StepRead = {
  result: StepResult
  /** the exact amount the step moved on a line (0 where it moved nothing) */
  moved: (edgeId: string) => Rational
  /** every line that moved anything, in the record's order */
  movedLines: string[]
  /** Pools the record takes out of their bounds */
  outside: string[]
  values: Record<string, number>
}
/** `steps` steps of a graph from its start (seed 7, model version 2), each read off its record */
export function runAndRead(g: { nodes: LoopNode[]; edges: LoopEdge[] }, steps = 1): StepRead[] {
  let st = initSim(g.nodes)
  const out: StepRead[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(g.nodes, g.edges, st, 7, 2)
    const moves = r.report.moves ?? []
    out.push({
      result: r,
      moved: (edgeId) => moves.filter((m) => m.edgeId === edgeId).reduce((t, m) => add(t, amountOf(m)), ZERO),
      movedLines: [...new Set(moves.map((m) => m.edgeId))],
      outside: outsideBounds(g.nodes, st.values, moves),
      values: r.state.values,
    })
    st = r.state
  }
  return out
}
