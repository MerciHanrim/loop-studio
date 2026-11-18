import { EPSILON, type StepMove } from '../engine'
import { add, fromInt, sub, type Rational } from '../model/rational'

/** SEMANTICS-E.md §E17 — what a committed step moved WITHOUT showing it: the moves of its
 *  record whose amount is at or under the display threshold (no event, no line label, no
 *  token), and, for each Pool one of them reached, that Pool's exact net change over ALL the
 *  step's moves, shown or not. Empty where every move of the step is shown, which is every
 *  step of an ordinary document. */
export type SmallMoves = {
  /** the moves that are not shown, in the record's order */
  moves: StepMove[]
  /** Pool id → `in − out` over every move of the step, as the fraction `num / den` (`num`
   *  carries the sign); only for a Pool that a move in `moves` reached */
  netByPool: Record<string, { num: string; den: string }>
}

export const NO_SMALL_MOVES: SmallMoves = { moves: [], netByPool: {} }

export const amountOf = (m: { num: string; den: string }): Rational => ({ num: BigInt(m.num), den: BigInt(m.den) })

/** `moves`: `StepReport.moves` of the step; `isPool`: is this node id a Pool? */
export function smallMovesOf(moves: readonly StepMove[] | undefined, isPool: (id: string) => boolean): SmallMoves {
  const small = (moves ?? []).filter((m) => !(m.shown > EPSILON))
  if (small.length === 0) return NO_SMALL_MOVES
  const reached = new Set<string>()
  for (const m of small) for (const id of [m.from, m.to]) if (isPool(id)) reached.add(id)
  const net = new Map<string, Rational>()
  for (const id of reached) net.set(id, fromInt(0))
  for (const m of moves ?? []) {
    if (net.has(m.to)) net.set(m.to, add(net.get(m.to)!, amountOf(m)))
    if (net.has(m.from)) net.set(m.from, sub(net.get(m.from)!, amountOf(m)))
  }
  const netByPool: SmallMoves['netByPool'] = {}
  for (const [id, r] of net) netByPool[id] = { num: String(r.num), den: String(r.den) }
  return { moves: small, netByPool }
}
