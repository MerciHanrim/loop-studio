import type { Activation, LoopEdge, LoopNode } from '../model/types'
import { kindFindingText, refusingKindFindings, resolveKinds, type ResourceKindDecl } from '../model/kinds'
import { applyUnits } from '../model/engineValues'
import { hasRunRules, hasTableMeaning, hasTimetables } from '../model/modelVersion'
import { anyRunRule, planRuns, runFindings, runFindingText, runNotices, runReports } from '../model/runRule'
import { applyTimetables, meaningOf, timetableFindings, timetableFindingText, timetableLines, unmetAmount, type PlannedLine, type Timetable } from '../model/timetable'
import type { DocTime } from '../model/units'
import { boundaryOutflowByKind } from './boundaryOutflow'
import { converterGroups, refusedGroups } from './converterGroups'
import { fromDouble as ratOfShortestDecimal, fromInt, gcd, parseDecimal, type Rational as Rat, toDouble } from '../model/rational'
const POW2: bigint[] = []
const pow2 = (k: number): bigint => (POW2[k] ??= 1n << BigInt(k))
const F64C = new Float64Array(1)
const U32C = new Uint32Array(F64C.buffer)
F64C[0] = 1
const HI = U32C[1] === 0x3ff00000 ? 1 : 0
const LO = 1 - HI
const ratOfDoubleFast = (x: number): Rat => {
  if (!Number.isFinite(x)) throw new Error(`rational: not finite: ${x}`)
  if (Number.isInteger(x)) return { num: BigInt(x), den: 1n }
  F64C[0] = x
  const hi = U32C[HI]
  const lo = U32C[LO]
  const biased = (hi >>> 20) & 0x7ff
  let mantHi = hi & 0xfffff
  let e = -1074
  if (biased !== 0) {
    mantHi |= 0x100000
    e = biased - 1075
  }
  // not an integer, so `e < 0` and the trailing zero bits are fewer than `-e`
  const tz = lo !== 0 ? 31 - Math.clz32(lo & -lo) : 32 + (31 - Math.clz32(mantHi & -mantHi))
  const num = BigInt((mantHi * 4294967296 + lo) / 2 ** tz)
  return { num: hi >>> 31 ? -num : num, den: pow2(-e - tz) }
}
const ratOfDouble = (x: number): Rat => (ratOfDoubleFast(x))
const TWO53 = 1n << 53n
const TWO54 = 1n << 54n
/** The double nearest a fraction above 0 (ties to even), by one division of
 *  integers: the quotient to 54 bits, the last of them and what is left over deciding the
 *  rounding. NaN where the fraction is outside the plain range of doubles (the caller then goes
 *  the long way). */
const nearestFast = (r: Rat): number => {
  const a = Number(r.num) / Number(r.den)
  if (!(a > 1e-280 && a < 1e280)) return NaN
  F64C[0] = a
  let k = 53 - (((U32C[HI] >>> 20) & 0x7ff) - 1023) // so that `r · 2^k` is in [2^53, 2^54)
  let q: bigint
  let exact: boolean
  for (;;) {
    const n = k >= 0 ? r.num << BigInt(k) : r.num
    const d = k >= 0 ? r.den : r.den << BigInt(-k)
    q = n / d
    if (q >= TWO54) k--
    else if (q < TWO53) k++
    else {
      exact = q * d === n
      break
    }
  }
  let m = q >> 1n
  if ((q & 1n) === 1n && (!exact || (m & 1n) === 1n)) m += 1n
  return Number(m) * 2 ** (1 - k)
}
// The arithmetic of fractions with the same results as `../model/rational`
// (a fraction is kept reduced, its denominator above 0; there is one such form), by shorter ways:
//   - a denominator that is a power of two (every double's is) is reduced by the numerator's
//     trailing zero bits, with no Euclid's algorithm;
//   - two fractions on one denominator are added and compared on their numerators;
//   - 0 and 1 are not multiplied through.
const ZERO_R: Rat = { num: 0n, den: 1n }
const reduceFast = (num: bigint, den: bigint): Rat => {
  if (den < 0n) {
    num = -num
    den = -den
  }
  if (num === 0n) return ZERO_R
  if (den === 1n) return { num, den }
  if ((den & (den - 1n)) === 0n) {
    const low = num & -num // the numerator's lowest set bit, as a power of two
    if (low === 1n) return { num, den }
    const g = low < den ? low : den
    return { num: num / g, den: den / g }
  }
  const g = gcd(num, den)
  return g > 1n ? { num: num / g, den: den / g } : { num, den }
}
const addFast = (a: Rat, b: Rat): Rat => (a.num === 0n ? b : b.num === 0n ? a : a.den === b.den ? reduceFast(a.num + b.num, a.den) : reduceFast(a.num * b.den + b.num * a.den, a.den * b.den))
const subFast = (a: Rat, b: Rat): Rat => (b.num === 0n ? a : a.den === b.den ? reduceFast(a.num - b.num, a.den) : reduceFast(a.num * b.den - b.num * a.den, a.den * b.den))
const mulFast = (a: Rat, b: Rat): Rat => (a.num === 0n || b.num === 0n ? ZERO_R : reduceFast(a.num * b.num, a.den * b.den))
const divFast = (a: Rat, b: Rat): Rat => {
  if (b.num === 0n) throw new Error('rational: division by zero')
  return a.num === 0n ? ZERO_R : reduceFast(a.num * b.den, a.den * b.num)
}
const cmpFast = (a: Rat, b: Rat): -1 | 0 | 1 => {
  const d = a.den === b.den ? a.num - b.num : a.num * b.den - b.num * a.den
  return d < 0n ? -1 : d > 0n ? 1 : 0
}
const addR = (a: Rat, b: Rat): Rat => (addFast(a, b))
const subR = (a: Rat, b: Rat): Rat => (subFast(a, b))
const mulR = (a: Rat, b: Rat): Rat => (mulFast(a, b))
const divR = (a: Rat, b: Rat): Rat => (divFast(a, b))
const cmpR = (a: Rat, b: Rat): -1 | 0 | 1 => (cmpFast(a, b))
/** A connection's exact rate, kept from step to step with what it was worked from.
 *  By the connection's ID, not by its object: a document with units has its connections made
 *  anew by the unit application at every step, so a table by object would never hold an answer
 *  there, and every rate would be read again every step. The answer depends on nothing but the
 *  four things kept beside it and compared before it is given, so one id in two documents
 *  cannot give a wrong one. */
const RATE_CACHE = new Map<string, { flow: unknown; kind: string; unit: Rat | undefined; r: number; exact: Rat }>()
/** A fraction above 0 as a double NEAR it (the quotient of the two integers as
 *  doubles, within a last place or two), for the code that then finds the exact neighbour itself;
 *  `toDouble` (25 decimal digits through a text) where that quotient is not a finite number above 0 */
const nearD = (r: Rat): number => {
  const a = Number(r.num) / Number(r.den)
  return a > 0 && Number.isFinite(a) ? a : toDouble(r)
}
import { evalDet, evalRand, type ModelVersion, rateOf } from './flow'
import { resolveFlowExprs, routerOrder } from './gateChance'
import { categorical, sample } from './rng'
import {
  ACT_WHY,
  LABEL_WHY,
  ROUTER_KINDS,
  parseActivatorExpr,
  parseDelay,
  parseLabelExpr,
  parseLabelTiming,
  parseLabelWhen,
  resolveParamRhs,
} from './stateExpr'
// docs/label-timing-authoring.md LTA-D13 — `ROUTER_KINDS`'s canonical home is
// `stateExpr.ts` (shared with the Inspector's `eligibleLabelPreset`); this
// re-export keeps `src/engine/index.ts`'s public `ROUTER_KINDS` path — and
// every other direct `from './step'` import of it — unchanged. A bare
// `import` does not re-export a name, so this line is required.
export { ROUTER_KINDS } from './stateExpr'
import { EPSILON, type FlowEvent, type GateStatus, type RunLimit, type SimState, type SimValues, type StateEvent, type StepNotice, type StepResult, type TimetableLineReport, type TriggerQueueEntry } from './types'

// Engine A — the deterministic core. Implements SEMANTICS.md §6 exactly:
// Phase 1 push (Sources), then Phase 2 pull (Gate / Converter / Drain / End)
// as one forward walk of the router DAG in topological order, with a
// reservation ledger so pool capacity is never double-spent.
//
// Engine B Part 1 (SEMANTICS-B1.md) adds, behind a `seed`: random flow
// evaluation (`1-3`, `2D6`) via a keyed RNG, cached one draw per edge per step;
// and the probabilistic Gate (one branch per step by categorical sampling).
//
// State connections (SEMANTICS-S.md, loop-state/1) add a Phase 0 before Push:
// `trigger` — a one-step pulse (optional integer `delay`) firing a `passive` /
// `interactive` target on the delivery step; `activator` — an AND-combined level
// gate on the target's firing; `label` — a numeric edit on the target Pool's
// step-start balance, with a single end-of-Phase-0 clamp. The `label` event
// reporting shape (`delta` + `clampAdjustment`) is loop-state/2 (SEMANTICS-S2.md);
// everything else is loop-state/1.

const nz = (x: number) => (Math.abs(x) < EPSILON ? 0 : x)
// ── exact fractions (`../model/rational`), for the exact test of a Pool's room
const RAT0 = fromInt(0)
/** What a `pull all` node that asks `demand` in all may be short of and still run
 *  (SEMANTICS-E.md §E11, §E11a): the absolute epsilon where it asks more than that; where its
 *  whole demand is at or under the epsilon, that part of the demand (an absolute 1e-9 there
 *  would be all it asks, and the node could never stop). As a double and as a fraction. */
const shortfallAllowed = (demand: number): number => (demand > EPSILON ? EPSILON : demand * EPSILON)
const shortfallAllowedR = (demand: Rat): Rat => (cmpR(demand, ratOfDouble(EPSILON)) > 0 ? ratOfDouble(EPSILON) : mulR(demand, ratOfDouble(EPSILON)))
const RAT1 = fromInt(1)
const minR = (a: Rat, b: Rat): Rat => (cmpR(a, b) <= 0 ? a : b)
const maxR = (a: Rat, b: Rat): Rat => (cmpR(a, b) >= 0 ? a : b)
const isPositive = (a: Rat): boolean => a.num > 0n
/** The plans check a Pool's room along the group's commit order with no slack
 *  (SEMANTICS.md §6 erratum, part 4): the level, summed from what the members
 *  take and deliver, never passes the room. Summed in floating point that
 *  level is only good to its rounding, and at a bound the rounding decides: a
 *  group that returns to a full Pool exactly what it takes has a level of 0 on
 *  paper and of 1e-16 of its flow in floating point, and stood still (issue
 *  #572); and a level a hair past the room could come out a hair under it.
 *  So wherever the floating-point level is too close to the room to be
 *  trusted, the walk is done again in exact fractions and THAT is compared
 *  with the room (part 9). This constant only says what "too close" is: within
 *  this fraction of everything taken from and delivered into the Pool, which
 *  scales with the amounts and is some millions of times the rounding the sum
 *  can have. It lets nothing through and refuses nothing by itself: outside it
 *  the floating-point answer is certain, inside it the exact one is asked. */
const LEVEL_DOUBT = 2 ** -30
const cap = (n: LoopNode): number =>
  n.data.kind === 'pool' && n.data.capacity != null ? n.data.capacity : Infinity

function requireFinite(v: number, what: string): number {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${what} must be a finite number ≥ 0 (got ${v})`)
  return v
}

export function initSim(nodes: LoopNode[], opts: Pick<StepOptions, 'kinds' | 'time'> = {}): SimState {
  // loop-model/4 (SEMANTICS-M4.md §M4-2.1) — a Pool authored in a unit starts
  // at its engine value; a graph with no field unit is read as it is
  nodes = applyUnits(nodes, [], opts.kinds, opts.time).nodes
  const values: SimValues = {}
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    values[n.id] = requireFinite(n.data.initial, `Pool "${n.data.label}" initial`)
    if (n.data.capacity != null) {
      requireFinite(n.data.capacity, `Pool "${n.data.label}" capacity`)
      // issue #406 — a starting amount above the capacity is refused here, not
      // clamped by the first step's Commit in silence; the document keeps the
      // pair as authored, for the user to correct
      if (n.data.initial > n.data.capacity)
        throw new Error(
          `Pool "${n.data.label}" initial must be ≤ its capacity (initial ${n.data.initial}, capacity ${n.data.capacity})`,
        )
    }
  }
  return { step: 0, values, ended: false, fired: [], triggerQueue: [] }
}

const TRIGGERABLE = new Set(['passive', 'interactive'])

/** §M5-6 — what each table line actually moved this step */
function withMoved(lines: readonly PlannedLine[], events: readonly FlowEvent[]): TimetableLineReport[] {
  return lines.map((l) => ({ ...l, moved: events.reduce((sum, ev) => (ev.edgeId === l.edgeId ? sum + ev.amount : sum), 0) }))
}

export type StepOptions = {
  /** loop-model/3 (SEMANTICS-M3.md) — the document's kinds table. With a
   *  non-empty one, a refusing finding (§M3-4: a conflict, a not-computable or
   *  a broken balance where a conserved kind is involved) stops the step before
   *  anything moves, and the report carries `boundaryOutflow` (§M3-5). Absent
   *  or empty ⇒ the loop-model/2 behaviour, event for event (M3-INV-1). */
  kinds?: readonly ResourceKindDecl[]
  /** loop-model/4 (SEMANTICS-M4.md §M4-3) — the document's step length, which
   *  a per-time or rate-unit field's engine value depends on. Absent ⇒ no
   *  per-time field resolves (its number is read as the base unit per step). */
  time?: DocTime
  /** loop-model/5 (SEMANTICS-M5.md) — the document's timetables, which a `~id`
   *  flow reads. A document with no table line steps as it did, event for event. */
  timetables?: readonly Timetable[]
  /** the fraction each Converter may run at this step, by node id: 0 to 1, and
   *  absent means 1. The engine reaches for it and no further, and `pull all`
   *  means reaching it (SEMANTICS.md §9). With no entry a step is what it was. */
  runTargets?: Readonly<Record<string, number>>
}

export function step(
  nodes: LoopNode[],
  edges: LoopEdge[],
  prev: SimState,
  seed = 1,
  modelVersion: ModelVersion = 1,
  opts: StepOptions = {},
): StepResult {
  // SEMANTICS.md §6 — "if `ended` was set, the run stops": an ended state is a
  // fixed point of `step`. Nothing is evaluated, nothing moves, the step count
  // and the values stay, and the report is empty (issue #419 item 1: until
  // now only the callers held this — the PlayBar's Replay resets first, the
  // Monte-Carlo loops stop on `st.ended` — while `step` itself kept moving
  // resources past the End).
  if (prev.ended) {
    return {
      state: { step: prev.step, values: prev.values, ended: true, fired: [], triggerQueue: prev.triggerQueue },
      report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: [], notices: [], gates: [] },
    }
  }
  const curStep = prev.step + 1 // the step being computed — the RNG key's `step`
  // a Converter's target, and what `pull all` must reach of it. A ratio, so a small
  // target cannot pass with nothing moved; at a target of 1 it is the `1 − EPSILON`
  // this test has always been.
  let runTargets = opts.runTargets
  const runOf = (id: string): number => runTargets?.[id] ?? 1
  const RUN_REACHED = 1 - EPSILON
  const frac = (x: number): number => {
    return x
  }
  const fracGone = (f: number): boolean => (!(f > 0))
  const targetFloored = (cid: string): boolean => runTargets?.[cid] !== undefined && runOf(cid) <= EPSILON
  // A Source's push into a Pool and a Drain's or End's pull from one: an amount above 0 is moved,
  // whatever its size (SEMANTICS-E.md §E7). Dropped under the display threshold, 5e-10 a step
  // was not moved.
  const nzPool = (x: number): number => (x > 0 ? x : 0)
  /** a fraction that is above 0, as the double nearest it (0 for a fraction at 0 or under) */
  const rnR = (r: Rat): number => {
    if (cmpR(r, RAT0) <= 0) return 0
    // by one division where the fraction is in the plain range of doubles. Outside it, the
    // loops below find the double just under the fraction from ANY double near it, and the
    // choice between that one and the next is exact; so the start need not be the nearest
    const f = nearestFast(r)
    if (f === f) return f
    let v = nearD(r)
    if (!(v > 0)) return 0
    while (v > 0 && cmpR(ratOfDouble(v), r) > 0) v = nextTo(v, -1)
    while (cmpR(ratOfDouble(nextTo(v, 1)), r) <= 0) v = nextTo(v, 1)
    const up = nextTo(v, 1)
    const c = cmpR(subR(r, ratOfDouble(v)), subR(ratOfDouble(up), r))
    if (c !== 0) return c < 0 ? v : up
    f64[0] = v
    return (u64[0] & 1n) === 0n ? v : up
  }
  /** The largest number between `lo0` (every margin at 0 or above)
   *  and `hi0` (a margin under 0) at which every margin is at 0 or above. The margins are bent
   *  lines of the number. Two steps a round, each checked by working the margins out again:
   *  up from the low end along the lines there, to where the first of them meets 0; down from
   *  the high end along the lines of the margins passed there. It ends where a margin is 0 at
   *  the low end and falls just above it: that number is the top, exactly. `halved` is called
   *  where the rounds run out and the rest is halved (not exact). */
  const exactTop = (lo0: Rat, hi0: Rat, marginsAt: (x: Rat) => Rat[], halved: () => void): Rat => {
    const inAll = (ms: Rat[]) => ms.every((x) => x.num >= 0n)
    const SL = ratOfDouble(2 ** -30)
    const TINY = ratOfDouble(2 ** -90)
    let lo = lo0
    let hi = hi0
    let mLo = marginsAt(lo)
    let mHi = marginsAt(hi)
    // FIRST, down from the high end, until a number is met at which every margin holds. The
    // numbers that fit need not be one stretch from the low end: a Gate whose first lines take
    // from other Pools and whose later lines take from the Pool it adds to fits at 0, not just
    // above it, and again further up (for example at 0 and from 3 1/3 to 7; begun from the low
    // end, "0, and falling above it" was taken for the top and the Gate moved nothing).
    for (let k = 0; k < 60 && !inAll(mHi); k++) {
      const dT = mulR(subR(hi, lo), SL)
      if (!isPositive(dT)) break
      const mDn = marginsAt(subR(hi, dT))
      if (mDn.length !== mHi.length) break
      let z: Rat | null = null
      for (let i = 0; i < mHi.length; i++) {
        if (mHi[i].num >= 0n || cmpR(mDn[i], mHi[i]) <= 0) continue
        const zi = addR(hi, divR(mulR(mHi[i], dT), subR(mDn[i], mHi[i])))
        if (z === null || cmpR(zi, z) < 0) z = zi
      }
      if (z === null || cmpR(z, lo) <= 0 || cmpR(z, hi) >= 0) break
      const mz = marginsAt(z)
      if (inAll(mz)) {
        lo = z
        mLo = mz
        break
      }
      hi = z
      mHi = mz
    }
    for (let round = 0; round < 120; round++) {
      let moved = false
      const d = mulR(subR(hi, lo), SL)
      if (!isPositive(d)) return lo
      const mUp = marginsAt(addR(lo, d))
      if (mUp.length === mLo.length) {
        let z: Rat | null = null
        for (let i = 0; i < mLo.length; i++) {
          if (cmpR(mUp[i], mLo[i]) >= 0) continue // not falling
          const zi = addR(lo, divR(mulR(mLo[i], d), subR(mLo[i], mUp[i])))
          if (z === null || cmpR(zi, z) < 0) z = zi
        }
        if (z !== null && cmpR(z, lo) <= 0) {
          // a margin is 0 here and falls above: asked again much nearer, so that a bend just above is not taken for it
          const mNear = marginsAt(addR(lo, mulR(d, TINY)))
          if (mNear.length === mLo.length && mNear.some((x, i) => mLo[i].num === 0n && x.num < 0n)) return lo
          // the margin stays at 0 for a while above and bends down before the sliver: the top is under the sliver
          hi = addR(lo, d)
          mHi = mUp
          moved = true
        } else if (z !== null && cmpR(z, hi) < 0) {
          const mz = marginsAt(z)
          if (inAll(mz)) {
            lo = z
            mLo = mz
          } else {
            hi = z
            mHi = mz
          }
          moved = true
        }
      }
      const d2 = mulR(subR(hi, lo), SL)
      if (!isPositive(d2)) return lo
      const mDn = marginsAt(subR(hi, d2))
      if (mDn.length === mHi.length) {
        let z: Rat | null = null
        for (let i = 0; i < mHi.length; i++) {
          if (mHi[i].num >= 0n || cmpR(mDn[i], mHi[i]) <= 0) continue
          const zi = addR(hi, divR(mulR(mHi[i], d2), subR(mDn[i], mHi[i])))
          if (z === null || cmpR(zi, z) < 0) z = zi
        }
        if (z !== null && cmpR(z, lo) > 0 && cmpR(z, hi) < 0) {
          const mz = marginsAt(z)
          if (inAll(mz)) {
            lo = z
            mLo = mz
          } else {
            hi = z
            mHi = mz
          }
          moved = true
        }
      }
      if (!moved) {
        // neither line led anywhere (a margin that bends the other way): one halving, and again
        const mid = divR(addR(lo, hi), ratOfDouble(2))
        const mm = marginsAt(mid)
        if (inAll(mm)) {
          lo = mid
          mLo = mm
        } else {
          hi = mid
          mHi = mm
        }
      }
    }
    halved()
    for (let i = 0; i < 64; i++) {
      const mid = divR(addR(lo, hi), ratOfDouble(2))
      if (inAll(marginsAt(mid))) lo = mid
      else hi = mid
    }
    return lo
  }
  /** what a deterministic Gate hands each of its lines out, by their weights, at a throughput of T */
  const splitOf = (weights: number[], sumW: number, T: number, fix = false, totalX?: bigint, skip = 0): number[] => {
    const shares = weights.map((w) => (sumW > 0 ? nz((T * w) / sumW) : 0))
    if (fix && sumW > 0 && T > 0) {
      // each share is `total × w / W` worked out exactly and rounded once (the
      // formula above rounds the product and then the quotient)
      const tX = totalX ?? toX(T)
      const wX = toX(sumW)
      for (let i = 0; i < weights.length; i++) {
        if (!(weights[i] > 0) || wX <= 0n) continue
        const num = tX * toX(weights[i])
        const q = (2n * num + wX) / (2n * wX) // to the nearest count of 2^-160
        shares[i] = nz(xNear(q))
      }
    }
    if (fix && T > 0 && shares.some((s) => s > 0)) {
      // the shares are made to sum to T exactly: what the formula's rounding left
      // over, worked out exactly, goes onto one share that can take it as a double (the largest first)
      const d = (totalX ?? toX(T)) - shares.reduce((s, x) => s + toX(x), 0n)
      if (d !== 0n) {
        const ranked = shares.map((_, i) => i).filter((i) => shares[i] > 0).sort((a, b) => shares[b] - shares[a])
        const byLargest = ranked.length ? [...ranked.slice(skip % ranked.length), ...ranked.slice(0, skip % ranked.length)] : ranked // `skip`: which share is tried first
        let left = d
        // first a share that can take the whole difference as a double; failing that, the
        // difference is passed down the shares, each taking what its own grid can hold
        for (const i of byLargest) {
          const want = toX(shares[i]) + left
          if (want < 0n) continue
          const cand = xNear(want)
          if (toX(cand) === want) {
            shares[i] = cand
            left = 0n
            break
          }
        }
        for (let pass = 0; pass < 3 && left !== 0n; pass++) {
          for (const i of byLargest) {
            if (left === 0n) break
            const want = toX(shares[i]) + left
            if (want < 0n) continue
            const cand = xNear(want)
            if (cand <= 0) continue
            left = want - toX(cand)
            shares[i] = cand
          }
        }
      }
      // (no share is lowered here so that no more is handed on than came in: what was taken
      // off, under a last place, would be left with the Gate and gone. What the Gate PULLS is
      // sized instead, see the Gate's turn.)
      return shares
    }
    return shares
  }
  const f64 = new Float64Array(1)
  const u64 = new BigUint64Array(f64.buffer)
  /** the next double below (d = -1) or above (d = 1) a positive finite x */
  const nextTo = (x: number, d: 1 | -1): number => {
    f64[0] = x
    u64[0] += BigInt(d)
    return f64[0]
  }
  // Exact arithmetic on doubles: a double as an integer count of 2^-160.
  // Sums and differences of doubles are then exact integer sums (no division, no fractions).
  const X_SHIFT = 160n
  const X_UNIT = 2 ** -160
  const toX = (x: number): bigint => {
    if (x === 0 || !Number.isFinite(x)) return 0n
    f64[0] = x
    const bits = u64[0]
    const e = Number((bits >> 52n) & 0x7ffn)
    const m = bits & 0xfffffffffffffn
    const mant = e === 0 ? m : m | 0x10000000000000n
    const sh = BigInt((e === 0 ? 1 : e) - 1075) + X_SHIFT
    const v = sh >= 0n ? mant << sh : mant >> -sh
    return bits >> 63n ? -v : v
  }
  /** the double nearest an exact value (ties to even) */
  const xNear = (b: bigint): number => Number(b) * X_UNIT
  /** the largest double within an exact value that is above 0 (0 otherwise) */
  const xDown = (b: bigint): number => {
    if (b <= 0n) return 0
    let v = xNear(b)
    while (v > 0 && toX(v) > b) v = nextTo(v, -1)
    return v
  }
  /** a planned group's `pull all` need per member: the target its number asks for */
  const planNeed = new Map<string, number>()
  /** SEMANTICS-M6.md §M6-5 — what held a ruled stage below its target, by member */
  const runLimit = new Map<string, RunLimit>()
  // loop-model/4 (SEMANTICS-M4.md §M4-2.1) — the engine reads the DERIVED
  // graph: every unit-bearing field at its engine value. The same arrays come
  // back when no field names a unit (M4-INV-1). The kind findings below read
  // the authored graph: their balance is exact over the authored decimals.
  const authoredNodes = nodes
  const authoredEdges = edges
  const derived = applyUnits(nodes, edges, opts.kinds, opts.time)
  ;({ nodes, edges } = derived)
  /** the exact value of every flow a unit converted, by connection id (for `exactRate`) */
  const exactUnitFlow = derived.exactFlow
  // loop-model/6 (SEMANTICS-M6.md §M6-3) — a rule that cannot run refuses the step:
  // nothing moves and the step is not consumed. A broken rule stops the run, because
  // a plant that quietly ran at a default would look like a result.
  const ruled = hasRunRules(modelVersion) && anyRunRule(authoredNodes)
  if (ruled) {
    const found = runFindings(authoredNodes, authoredEdges, opts.timetables, opts.kinds, opts.time, modelVersion)
    if (found.length) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: found.map((f) => runFindingText(f, nodes)), notices: [], gates: [] },
      }
    }
  }
  // loop-model/5 (SEMANTICS-M5.md §M5-5) — a table line that cannot run refuses
  // the step: nothing moves and the step is not consumed. Otherwise each table
  // line carries this step's amount as a constant from here on, so every phase
  // below reads it as it reads any other number.
  let tablePlan: ReturnType<typeof applyTimetables> | null = null
  if (hasTimetables(modelVersion) && timetableLines(edges).length > 0) {
    const found = timetableFindings(nodes, edges, opts.timetables, opts.kinds, opts.time)
    if (found.length) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: found.map((f) => timetableFindingText(f, nodes, edges)), notices: [], gates: [] },
      }
    }
    tablePlan = applyTimetables(nodes, edges, opts.timetables!, opts.kinds, opts.time!, curStep)
    if (tablePlan.notFinite) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: [timetableFindingText(tablePlan.notFinite, nodes, edges)], notices: [], gates: [] },
      }
    }
    edges = tablePlan.edges
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // loop-model/1: `parameter` / `register` have no ports — the engine ignores
  // ANY edge incident to one (a malformed / hand-authored file can carry them).
  const MODEL = new Set(['parameter', 'register'])
  const modelId = (id: string) => MODEL.has(byId.get(id)?.data.kind as string)
  const liveEdges = edges.filter((e) => !modelId(e.source) && !modelId(e.target))
  const resEdges = liveEdges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  // #471 Deploy 2 (F1) — a split that rejoins (two forward paths from one
  // router meeting again at a later Gate or Converter) has no plan but zero,
  // and one that happens to agree flips with the branches that are live. The
  // run bar refuses such a graph before Play, Step or Monte Carlo start
  // (`refusedGroups`, the same classification); this is the engine's own
  // refusal for a caller that steps anyway: nothing moves, the step is not
  // consumed, and the report says why. Never a silent zero.
  const refused = refusedGroups(nodes, liveEdges)
  if (refused.length) {
    const label = (id: string | null) => byId.get(id ?? '')?.data.label ?? id ?? '?'
    return {
      state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
      report: {
        events: [], activated: [], fired: [], stateEvents: [],
        diagnostics: refused.map(
          (g) =>
            `Can't run: resources split at "${label(g.split)}" and meet again at "${label(g.join)}". This model version does not support paths that split and meet again, so nothing moved. Remove one of the paths, or add a Pool on one of them (that path then moves one step later).`,
        ),
        notices: [],
        gates: [],
      },
    }
  }
  // loop-model/3 (SEMANTICS-M3.md §M3-4, D1) — with a kinds table, a finding
  // where a conserved kind is involved refuses the step the same way: nothing
  // moves, the step is not consumed, one diagnostic per finding. The run bars
  // refuse before Play with the same findings (`simStore.kindRefusals`).
  const kinds = opts.kinds ?? []
  const kindRes = kinds.length > 0 ? resolveKinds(nodes, liveEdges) : null
  if (kindRes) {
    const liveAuthored = authoredEdges.filter((e) => !modelId(e.source) && !modelId(e.target))
    const findings = refusingKindFindings(authoredNodes, liveAuthored, kinds, modelVersion, opts.time)
    if (findings.length) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: {
          events: [], activated: [], fired: [], stateEvents: [],
          diagnostics: findings.map((f) => kindFindingText(f, authoredNodes, liveAuthored)),
          notices: [],
          gates: [],
        },
      }
    }
  }
  // loop-model/5 (§M5-4) — a `stop` table does not cover this step: the run ends
  // before it. Nothing is invented for the part of the step it does not describe.
  // A table a rule reads ends it the same way, before any rule is used.
  const runPlan = ruled ? planRuns(authoredNodes, authoredEdges, opts.timetables, opts.kinds, opts.time, prev.values, curStep, modelVersion) : null
  const endedBy = tablePlan?.endedBy ?? runPlan?.endedBy
  if (endedBy) {
    return {
      state: { step: prev.step, values: prev.values, ended: true, fired: [], triggerQueue: prev.triggerQueue },
      report: {
        events: [], activated: [], fired: [], stateEvents: [], diagnostics: [], gates: [],
        notices: [{ kind: 'timetableEnded', tableId: endedBy.id, label: endedBy.label }],
      },
    }
  }
  // loop-model/6 (§M6-4) — each rule has read the step's start state; a fraction that
  // is not finite refuses the step, as a table plan does
  if (runPlan?.outOfRange) {
    return {
      state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
      report: {
        events: [], activated: [], fired: [], stateEvents: [], notices: [], gates: [],
        diagnostics: [`Can't run "${byId.get(runPlan.outOfRange)?.data.label ?? runPlan.outOfRange}": its run rule asks for a fraction out of range. Nothing moved.`],
      },
    }
  }
  if (runPlan) runTargets = runPlan.targets
  // loop-model/2 (SEMANTICS-M2.md §M2-3): in a v2 document, resolve every
  // `@id` / malformed-`@…` flow to a `const` once, before any phase. Every
  // unresolved reference contributes 0 + one diagnostic; a resolved finite
  // value follows the identical-literal rules (§M2-3.1). Deduped per edge.
  // Shared with the panel's Gate chances (./gateChance.ts), so the two read
  // every flow alike.
  const { flowOf, paramDiagnostics } = resolveFlowExprs(byId, resEdges, modelVersion)
  const fe = (e: LoopEdge) => flowOf.get(e.id)!
  const isRandExpr = (e: LoopEdge) => {
    const k = fe(e).kind
    return k === 'range' || k === 'dice'
  }

  const outRes = new Map<string, LoopEdge[]>()
  const inRes = new Map<string, LoopEdge[]>()
  for (const e of resEdges) {
    let o = outRes.get(e.source)
    if (!o) outRes.set(e.source, (o = []))
    o.push(e)
    let i = inRes.get(e.target)
    if (!i) inRes.set(e.target, (i = []))
    i.push(e)
  }
  const outOf = (id: string) => outRes.get(id) ?? []
  const inOf = (id: string) => inRes.get(id) ?? []
  const kindOf = (id: string) => byId.get(id)?.data.kind
  const isPool = (id: string) => kindOf(id) === 'pool'
  const cmpEdge = (a: LoopEdge, b: LoopEdge) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

  const S = { ...prev.values } // snapshot — read-only
  const working: SimValues = { ...prev.values } // mutated, committed
  const taken = new Map<string, number>() // pulled OUT of a pool this step
  const reserved = new Map<string, number>() // promised INTO a pool, not yet in `working`
  // What has been settled of the promises, as an exact count on the fine unit (kept through a
  // probe's rewind with the rest; no decision reads it).
  const reservedXm = new Map<string, bigint>()
  // The promises as FRACTIONS: what is promised into a Pool, and what of it stands for each
  // member's own delivery. These are the record; the doubles beside them are read-outs for the
  // code that still decides in doubles, rounded to the safe side (a member's own promise DOWN,
  // so a room read with it credited back is never above the exact one). Summed as doubles, two
  // promises of 0.003999999999999999 and 0.0030000000000000005 read 0.006999999999999999,
  // 4.3e-19 under their sum, and a Gate outside the plan was given that much room that is not there.
  const reservedR = new Map<string, Rat>()
  const ownR = new Map<string, Map<string, Rat>>()
  const ownOfR = (mid: string, pid: string): Rat => ownR.get(mid)?.get(pid) ?? RAT0
  const ownSumR = (ms: Iterable<string>, pid: string): Rat => {
    let t = RAT0
    for (const m of ms) t = addR(t, ownOfR(m, pid))
    return t
  }
  const setOwnR = (mid: string, pid: string, v: Rat) => {
    let row = ownR.get(mid)
    if (!row) ownR.set(mid, (row = new Map()))
    row.set(pid, v)
    let rowD = ownReserve.get(mid)
    if (!rowD) ownReserve.set(mid, (rowD = new Map()))
    rowD.set(pid, downTo(v))
  }
  /** promise exactly `x` into Pool `pid` for member `mid`'s own delivery */
  const promiseR = (mid: string, pid: string, x: Rat) => {
    if (!isPositive(x)) return
    const total = addR(reservedR.get(pid) ?? RAT0, x)
    reservedR.set(pid, total)
    reserved.set(pid, Number(total.num) / Number(total.den)) // (a read-out; nothing decides on it)
    setOwnR(mid, pid, addR(ownOfR(mid, pid), x))
  }
  /** member `mid` delivers exactly `x` into Pool `pid`: that much of its promise there is settled */
  const settleR = (mid: string, pid: string, x: Rat) => {
    const have = ownOfR(mid, pid)
    if (!isPositive(have)) return
    const held = cmpR(have, x) < 0 ? have : x
    const total = subR(reservedR.get(pid) ?? RAT0, held)
    reservedR.set(pid, total)
    reserved.set(pid, Number(total.num) / Number(total.den)) // (a read-out; nothing decides on it)
    setOwnR(mid, pid, subR(have, held))
  }
  const reserveSub = (q: string, d: number) => {
    reserved.set(q, (reserved.get(q) ?? 0) - d)
    reservedXm.set(q, (reservedXm.get(q) ?? 0n) - toX(d))
  }
  /** what is promised into a Pool, as an exact count: the exact promises, rounded UP onto the
   *  fine unit for the code that reads a room on it */
  const resX = (q: string): bigint => (ceilX(reservedR.get(q) ?? RAT0))
  const inbox = new Map<string, number>() // handed to a router by an upstream router
  const ownReserve = new Map<string, Map<string, number>>()
  /** a promise into a Pool for a member's own delivery: exactly `x` where it is given, otherwise the double `d` as it is */
  const promise = (mid: string, pid: string, d: number, x?: Rat) => {
    return promiseR(mid, pid, x ?? ratOfDouble(d))
  }

  const events: StepResult['report']['events'] = []
  const activated = new Set<string>()
  const fired = new Set<string>()
  const diagnostics: string[] = [...paramDiagnostics]
  const notices: StepNotice[] = [] // worded by the UI in the user's language
  const gates: GateStatus[] = [] // #477 — the committed pass's per-Gate evidence
  let ended: boolean = prev.ended // `false` here (the ended fixed point returned above)

  // A random draw / gate pick is memoised at `step()` scope so the shadow probe
  // pass (see `pullPass`) reuses the SAME result as the real pass — no extra
  // draw. Its *diagnostic* must not leak the same way: a probe rewinds
  // `diagnostics`, so a bad `range` / `dice` flow or an inert probabilistic gate
  // first seen during a probe would record then discard its reason, and the
  // committed pass would read only the cached value and never re-surface it.
  // So the reason is cached alongside the value and flushed to `diagnostics`
  // (exactly once) only when the cache is actually consumed with `emitDiag`
  // true — i.e. during the committed pass, on a path that really executes.
  let emitDiag = true // false only for the duration of a probe pullPass
  const randReason = new Map<string, string>() // edgeId → its bad-random diagnostic
  const gateInertReason = new Map<string, string>() // gateId → its inert-gate diagnostic
  const diagShown = new Set<string>() // `rand:<edgeId>` / `gate:<gateId>` already flushed
  const surfaceRandDiag = (edgeId: string) => {
    const key = `rand:${edgeId}`
    if (emitDiag && randReason.has(edgeId) && !diagShown.has(key)) {
      diagnostics.push(randReason.get(edgeId)!)
      diagShown.add(key)
    }
  }
  const surfaceGateDiag = (gateId: string) => {
    const key = `gate:${gateId}`
    if (emitDiag && gateInertReason.has(gateId) && !diagShown.has(key)) {
      diagnostics.push(gateInertReason.get(gateId)!)
      diagShown.add(key)
    }
  }

  // ── Engine B: one draw per random edge per step (SEMANTICS-B1.md §B3) ─────
  // `sampled` holds the drawn value for `range`/`dice` edges only; it is filled
  // on first touch (whether as an amount or as a weight) and reused everywhere.
  const sampled = new Map<string, number>()
  const drawnValue = (e: LoopEdge): number => {
    const hit = sampled.get(e.id)
    if (hit !== undefined) {
      surfaceRandDiag(e.id)
      return hit
    }
    const v = evalRand(fe(e), 0, 0, (purpose, i) => sample(seed, curStep, e.id, purpose, i).u, (reason) => {
      if (!randReason.has(e.id)) randReason.set(e.id, `Edge "${e.id}" ${reason}; contributes 0.`)
      surfaceRandDiag(e.id)
    })
    sampled.set(e.id, v)
    return v
  }
  /** Flow as an amount: deterministic forms exactly as Engine A; random forms
   *  from the per-step draw cache. */
  const amountOf = (e: LoopEdge, available: number, snapshot: number): number =>
    isRandExpr(e) ? drawnValue(e) : evalDet(fe(e), available, snapshot)
  // issue #396 (Lumi, 2026-10-30) — a percent on a connection that touches a
  // Converter is REFUSED: everywhere else `N%` is the amount `frac · S[source
  // Pool]` (SEMANTICS.md §8), but a Converter reads its edges as per-activation
  // rates, where a Converter's out-edge and a Converter → Converter edge have
  // no Pool to take a percent of, and reading the token as the bare fraction
  // gave "50%" two meanings. The edge contributes 0 and one diagnostic names
  // the connection and the expression; the document is never rewritten (a
  // number, 0.5 for what "50%" used to do, is the author's own change). The
  // diagnostic follows the random-flow pattern: cached per edge, flushed once,
  // and only on the committed pass.
  // issue #471 item 5 (Lumi, 2026-11-03) — `all` on such a connection is
  // refused the same way: everywhere else the token is the Pool as it stands
  // (a Gate's demand, a Drain's pull, §8), and a Converter's connection read
  // it as the rate 1 — one unit per activation, whatever the Pool held. The
  // edge contributes 0, the diagnostic names the connection and the number
  // that keeps the rate it used to mean (`1`), the document is never
  // rewritten. A Converter with no other live input or output does not run.
  const rateReason = new Map<string, string>() // edgeId → its refused-rate diagnostic
  const isRefusedRate = (e: LoopEdge): boolean => {
    const k = fe(e).kind
    return (k === 'percent' || k === 'all') && (kindOf(e.source) === 'converter' || kindOf(e.target) === 'converter')
  }
  const refusedRate = (e: LoopEdge): number => {
    const key = `rate:${e.id}`
    if (emitDiag && !diagShown.has(key)) {
      if (!rateReason.has(e.id)) {
        const raw = String((e.data as { flow?: unknown } | undefined)?.flow ?? '')
        const x = fe(e)
        rateReason.set(
          e.id,
          x.kind === 'all'
            ? `Edge "${e.id}" flow "${raw}" is \`all\` on a Converter connection; a Converter's rate cannot be \`all\` — contributes 0 (write 1 for the rate "${raw}" used to mean).`
            : `Edge "${e.id}" flow "${raw}" is a percent on a Converter connection; a Converter's rate cannot be a percent — contributes 0 (write ${(x as { frac?: number }).frac ?? 0} for the rate "${raw}" used to mean).`,
        )
      }
      diagnostics.push(rateReason.get(e.id)!)
      diagShown.add(key)
    }
    return 0
  }
  /** Flow as a weight / per-activation rate: `%`→frac, `const`→value,
   *  random→the drawn integer, `all`→1 as a Gate's split weight; a percent or
   *  `all` on a Converter connection → 0 (#396, #471 item 5). */
  const rateOfCached = (e: LoopEdge): number =>
    isRefusedRate(e) ? refusedRate(e) : isRandExpr(e) ? drawnValue(e) : rateOf(fe(e))
  // ── the same numbers as exact fractions, for the exact test of a Pool's room
  // (SEMANTICS.md §6 erratum, part 9; issue #572). What a number stands for
  // decides the fraction; no result of a floating-point operation is read as
  // if it were the document's:
  //  - a rate the document states as a decimal is that decimal, digit for digit;
  //  - a rate a unit converted is the authored decimal times the unit's exact
  //    ratio (`exactUnitFlow`), of which the engine holds the nearest double;
  //  - any other rate (a percent's fraction, a Parameter's value, a drawn
  //    number) is the shortest decimal that gives its double, the number a
  //    person reads for it;
  //  - a number the engine itself produced (a Pool's content, a room, an inbox,
  //    the plan's numbers) is its double and nothing else.
  // Each is used only when it is the number the engine runs on: when its nearest
  // double is not the rate in hand, the rate in hand is read instead.
  const exactRateOf = new Map<string, { r: number; exact: Rat }>() // by connection, for the rate it was worked out for
  const exactRate = (e: LoopEdge): Rat => {
    const r = rateOfCached(e)
    const known = exactRateOf.get(e.id)
    if (known && known.r === r) return known.exact
    // (the exact rate of a connection is worked from what the document states for it,
    // the unit's exact ratio, the kind of its expression and the rate in hand. Where all four are
    // what they were the last time this connection was asked, in whatever step, the answer is the
    // one given then: a written amount is not read again every step.)
    const unit = exactUnitFlow?.get(e.id)
    const flow = (e.data as { flow?: unknown } | undefined)?.flow
    const kind = fe(e).kind
    const c = RATE_CACHE.get(e.id)
    if (c && c.r === r && c.flow === flow && c.kind === kind && (unit === undefined ? c.unit === undefined : c.unit !== undefined && c.unit.num === unit.num && c.unit.den === unit.den)) {
      exactRateOf.set(e.id, { r, exact: c.exact })
      return c.exact
    }
    const stated = unit ?? (kind === 'const' ? parseDecimal(String(flow ?? '').trim()) : null)
    const exact = stated !== null && stated !== undefined && toDouble(stated) === r ? stated : ratOfShortestDecimal(r)
    exactRateOf.set(e.id, { r, exact })
    if (RATE_CACHE.size > 20000) RATE_CACHE.clear() // a bound; a cleared table only costs the reading again
    RATE_CACHE.set(e.id, { flow, kind, unit, r, exact })
    return exact
  }
  /** a line's own amount this step, exactly: its rate when the amount is that rate, else the double the engine worked out */
  const exactWant = (e: LoopEdge, want: number): Rat => {
    if (fe(e).kind !== 'const' || isRefusedRate(e)) return ratOfDouble(want)
    const r = exactRate(e)
    // (the exact rate's nearest double IS the rate in hand: `exactRate` takes the stated decimal
    // only when its nearest double is that rate, and otherwise the rate's own shortest decimal,
    // which reads back as it. So the question is asked of the rate, with no conversion.)
    return rateOfCached(e) === want ? r : ratOfDouble(want)
  }

  // #471 Deploy 2 — a tree group's plan claims the Pool inputs of its
  // Converters at the group's FIRST router's turn (SEMANTICS.md §6 erratum,
  // part 2: the input reservation). Until that Converter's own turn the claim
  // is held here, and every other router reads the Pool net of it, as
  // `headroom` already reads a Pool net of `reserved`.
  const reservedIn = new Map<string, number>() // poolId → claimed by a planned Converter not yet at its turn
  // Issue #570 — the same reservation for a planned group's SOURCE GATES
  // (SEMANTICS.md §6 erratum, part 10). The plan counts on what each of them
  // pulls from its own Pools; until that Gate's own turn the amount is held
  // here, and every other router reads the Pool net of it. Without it a router
  // outside the group that is ordered between the group's first router and the
  // Gate took it: the Gate moved less than its plan, and the Converter behind
  // it was fed at different fractions on its connections.
  // The hold is released at the top of the Gate's turn and the Gate then pulls
  // as it always did, so with no one else on the Pool nothing changes. A
  // Pool's total is summed again from the holds that remain, never added and
  // subtracted, so that a Pool with no hold reads exactly as before.
  const gateHolds = new Map<string, Map<string, number>>() // source Gate → Pool → held for it until its turn
  const heldIn = new Map<string, number>() // poolId → the sum of `gateHolds` on it
  const sumHolds = (pools: Iterable<string>) => {
    for (const p of pools) {
      let total = 0
      for (const h of gateHolds.values()) total += h.get(p) ?? 0
      if (total > 0) heldIn.set(p, total)
      else heldIn.delete(p)
    }
  }
  const releaseHold = (gateId: string) => {
    const h = gateHolds.get(gateId)
    if (!h) return
    gateHolds.delete(gateId)
    sumHolds(h.keys())
  }
  // Each Pool's level where the push phase begins and what has been taken from it since, as
  // exact counts on the fine unit (kept through a probe's rewind with the rest; no decision reads them).
  const xl = new Map<string, bigint>()
  const xTaken = new Map<string, bigint>()
  // The exact ledger, in FRACTIONS. Every move of the step has an exact amount; a Pool's level
  // within the step is its stored double plus those amounts; it is stored as the nearest double
  // when the step ends, and that is the only rounding. What the engine decides on in between
  // (a room, what is available) is read FROM this ledger and rounded to the safe side onto the
  // fine unit (2^-160): a level up, an available amount down, so that nothing is decided that
  // the exact ledger does not hold.
  const lvR = new Map<string, Rat>() // a Pool's exact level within the step
  const takenR = new Map<string, Rat>() // exactly what has been taken from it
  const claimR = new Map<string, Rat>() // exactly what a plan has claimed of its supply and not yet taken
  const inboxR = new Map<string, Rat>() // exactly what a router has been handed
  const movesR: { edgeId: string; from: string; to: string; amount: Rat; shown?: number }[] = [] // the record of moves (`shown`: the nearest double, worked once)
  const levelR = (id: string): Rat => lvR.get(id) ?? ratOfDouble(working[id] ?? 0)
  const X_ONE = 1n << 160n
  const floorX = (r: Rat): bigint => {
    const n = r.num * X_ONE
    const q = n / r.den
    return n % r.den === 0n || n > 0n ? q : q - 1n
  }
  const ceilX = (r: Rat): bigint => {
    const n = r.num * X_ONE
    const q = n / r.den
    return n % r.den === 0n || n < 0n ? q : q + 1n
  }
  // (a Pool's level and what is available in it, on the fine unit, are asked many times
  // between two changes. A fraction is never changed in place, a change puts a NEW one in the
  // ledger; so "the same fraction objects as the last time" is "the same values", and the answer
  // given then is given again.)
  const xLevelMemo = new Map<string, { l: Rat | undefined; w: number; v: bigint }>()
  const xLevel = (id: string): bigint => {
    const l = lvR.get(id)
    const w = working[id] ?? 0
    const m = xLevelMemo.get(id)
    if (m && m.l === l && m.w === w) return m.v
    const v = ceilX(l ?? ratOfDouble(w))
    xLevelMemo.set(id, { l, w, v })
    return v
  }
  const availMemo = new Map<string, { s: number; t: Rat | undefined; c: Rat | undefined; h: number; v: bigint; d?: number }>()
  const availMemoOf = (id: string) => {
    const s = S[id] ?? 0
    const t = takenR.get(id)
    const c = claimR.get(id)
    const h = heldIn.get(id) ?? 0
    let m = availMemo.get(id)
    if (!m || m.s !== s || m.t !== t || m.c !== c || m.h !== h) {
      m = { s, t, c, h, v: floorX(subR(subR(ratOfDouble(s), t ?? RAT0), c ?? RAT0)) - toX(h) }
      availMemo.set(id, m)
    }
    return m
  }
  /** what is available in a Pool, as an exact count: its start, less the takes, the claims and the holds, rounded DOWN onto the fine unit */
  const availX = (id: string): bigint =>
    availMemoOf(id).v
  /** a plan claims an exact amount of a Pool's supply, and gives the claim back as it takes */
  const claimAddR = (p: string, r: Rat) => claimR.set(p, addR(claimR.get(p) ?? RAT0, r))
  const claimSubR = (p: string, r: Rat) => claimR.set(p, subR(claimR.get(p) ?? RAT0, r))
  /** exactly what a Pool can still give: its start, less the takes, the claims and the holds */
  const availR = (id: string): Rat => subR(subR(subR(ratOfDouble(S[id] ?? 0), takenR.get(id) ?? RAT0), claimR.get(id) ?? RAT0), ratOfDouble(heldIn.get(id) ?? 0))
  /** a capped Pool's room exactly: capacity, less the exact level, less what is promised into it, `own` credited back (null: no capacity) */
  const roomRat = (id: string, own = 0): Rat | null => roomRatX(id, toX(own))
  /** the same, `own` as an exact sum on the fine unit (a group's own promises there) */
  const roomRatX = (id: string, ownX: bigint): Rat | null => {
    const n = byId.get(id)
    if (!n) return RAT0
    const c = cap(n)
    if (!Number.isFinite(c)) return null
    return roomRatR(id, divR(fromInt(ownX), fromInt(X_ONE)))
  }
  /** the room in fractions throughout: capacity, less the exact level, less the exact promises, `own` (exact) credited back */
  const roomRatR = (id: string, own: Rat): Rat | null => {
    const n = byId.get(id)
    if (!n) return RAT0
    const c = cap(n)
    if (!Number.isFinite(c)) return null
    return subR(addR(subR(ratOfDouble(c), reservedR.get(id) ?? RAT0), own), levelR(id))
  }
  const availExactR = availR // (a plan's block has an `availR` of its own, which asks this one once a Pool)
  const availOf = (id: string) => {
    const m = availMemoOf(id)
    return (m.d ??= xDown(m.v))
  }
  const reservedOf = (id: string) => reserved.get(id) ?? 0
  const headroom = (id: string) => {
    const n = byId.get(id)
    if (!n) return 0
    if (Number.isFinite(cap(n))) {
      const b = toX(cap(n)) - xLevel(id) - resX(id)
      return b >= 0n ? xDown(b) : xNear(b)
    }
    return cap(n) - (working[id] ?? 0) - reservedOf(id)
  }
  /** a capped Pool's room as an exact count, `own` credited back (null: no capacity). A Pool
   *  that reads full (its level would be stored as its capacity) has no room for a new grant. */
  const roomX = (id: string, own = 0): bigint | null => {
    const n = byId.get(id)
    if (!n) return 0n
    const c = cap(n)
    if (!Number.isFinite(c)) return null
    if (own === 0 && (working[id] ?? 0) >= c) return 0n
    return toX(c) - xLevel(id) - resX(id) + toX(own)
  }
  const roomP = (id: string, own = 0): number => {
    const b = roomX(id, own)
    return b === null ? Infinity : xDown(b)
  }
  /** the largest double within a fraction that is above 0 (0 otherwise) */
  const downTo = (x: Rat): number => {
    if (cmpR(x, RAT0) <= 0) return 0
    let v = nearD(x) // (the loops below find the same double from any double near it)
    if (!(v > 0)) return 0
    while (v > 0 && cmpR(ratOfDouble(v), x) > 0) v = nextTo(v, -1)
    while (v > 0 && cmpR(ratOfDouble(nextTo(v, 1)), x) <= 0) v = nextTo(v, 1)
    return v
  }
  /** a Pool's level is moved by `delta`, or by exactly `r` where it is given */
  const moveLevel = (id: string, delta: number, r?: Rat) => {
    // the exact level moves by the exact amount (signed as `delta` is); what the engine holds
    // beside it is the double nearest
    const b = addR(levelR(id), r ?? ratOfDouble(delta))
    lvR.set(id, b)
    working[id] = rnR(b)
  }
  const takeFrom = (poolId: string, amt: number, r?: Rat) => {
    taken.set(poolId, (taken.get(poolId) ?? 0) + amt)
    xTaken.set(poolId, (xTaken.get(poolId) ?? 0n) + toX(amt))
    takenR.set(poolId, addR(takenR.get(poolId) ?? RAT0, r ?? ratOfDouble(amt)))
    moveLevel(poolId, -amt, r ? subR(RAT0, r) : undefined)
  }
  // A move is RECORDED with its exact amount (`r`; a double moved as it is, is its own exact
  // amount), whatever its size (SEMANTICS-E.md §E7). The EVENT is what is shown of it: the
  // nearest double, and only above the display threshold. A router's inbox is exact too.
  const emit = (e: LoopEdge, from: string, to: string, amount: number, r?: Rat) => {
    const x = r ?? ratOfDouble(amount)
    if (!isPositive(x)) return
    // (a double moved as it is, is its own nearest double; and the record keeps the nearest
    // double it worked out, so the report does not work it out again)
    const shown = r === undefined ? amount : rnR(x)
    movesR.push({ edgeId: e.id, from, to, amount: x, shown })
    if (!isPool(to) && !isPool(from)) inboxR.set(to, addR(inboxR.get(to) ?? RAT0, x)) // handed from a router to a router (a Pool line goes into the member's own turn)
    if (shown > EPSILON) events.push({ edgeId: e.id, from, to, amount: shown })
    return
  }

  // ── Phase 0: state connections (SEMANTICS-S.md §S2) ─────────────────────
  // `trigger` (pulse + delay), `activator` (AND level gate) and `label` (numeric
  // edit on the target Pool's step-start balance) are live. A legacy `node` /
  // unrecognised mode is inert + one diagnostic per step.
  const stateEvents: StateEvent[] = []
  const stateEdgeCmp = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const KNOWN_STATE_MODES = new Set(['trigger', 'activator', 'label'])
  const stateEdges = liveEdges
    .filter((e): e is LoopEdge & { data: { kind: 'state'; mode: string; delay?: number } } => e.data?.kind === 'state')
    .sort(stateEdgeCmp)
  for (const e of stateEdges) {
    if (!KNOWN_STATE_MODES.has(e.data.mode)) {
      diagnostics.push(`State edge "${e.id}" mode "${e.data.mode}" is not supported; connection has no effect.`)
    }
  }
  const triggerEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'trigger'; delay?: number } } => e.data.mode === 'trigger',
  )

  // ── activator gate (§S4) ──────────────────────────────────────────────
  // `enabled(target)` = AND over its activator edges; empty ⇒ true. Source
  // must be a Pool; a non-Pool source or an unparseable comparison is inert +
  // diagnostic (does NOT disable the target).
  //
  // §S6 grammar (parser in ./stateExpr, shared with the Inspector) —
  // `(>=|>|<=|<|==|!=)\s*<finite real>`, whitespace-tolerant. Everything it
  // rejects — empty, operator-only, `NaN` / `±Infinity`, `+5` / `.5` / `5.` /
  // `1e3`, trailing junk — stays invalid: the edge is inert (dropped from the
  // AND) and adds exactly one diagnostic line this step.
  const cmp = (v: number, op: string, n: number): boolean => {
    switch (op) {
      case '>=': return v >= n
      case '<=': return v <= n
      case '>': return v > n
      case '<': return v < n
      case '==': return v === n
      case '!=': return v !== n
      default: return true
    }
  }
  const activatorEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'activator'; expr: string } } => e.data.mode === 'activator',
  )
  const enabledByNode = new Map<string, boolean>() // activator targets only
  for (const e of activatorEdges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      diagnostics.push(`Activator "${e.id}" connects a removed node; ignored.`)
      continue
    }
    if (!isPool(e.source)) {
      diagnostics.push(`Activator "${e.id}" needs a Pool source; ignored.`)
      continue
    }
    const rawExpr = (e.data as { expr?: string }).expr ?? ''
    const p = parseActivatorExpr(rawExpr, modelVersion)
    if (!p.ok) {
      // PA5 Class 1 — grammar-invalid `expr` (including every PA4 rejection:
      // a doubled sign, a fractional/out-of-range offset, a second reference,
      // parentheses). Unchanged from loop-state/1: inert, fail-OPEN for the
      // target — this edge never enters `enabledByNode`.
      diagnostics.push(`Activator "${e.id}" expression "${rawExpr}" ${ACT_WHY[p.reason]}; ignored.`)
      continue
    }
    // docs/parameter-activator.md §PA5 — a `param-term` RHS resolves once,
    // here, against this step's node map (never a prior step's — a Parameter
    // edit must take effect the very next step), via the SAME
    // `resolveParamRhs` the Inspector's live preview calls — one predicate,
    // so the preview can never drift from what the engine actually gates on.
    // A resolution failure (Class 2: unknown id, wrong kind, non-finite
    // value, or an overflowing `v ± offset`) is the OPPOSITE of Class 1: the
    // activator still counts — it joins the AND as `satisfied: false`,
    // fail-CLOSED, gating its target off — a syntactically valid `@id` is a
    // declared gating intent, and a broken reference must stop resource
    // movement, not silently remove the gate (PA11-D3).
    let n: number
    if (p.rhs.kind === 'literal') {
      n = p.rhs.n
    } else {
      const paramId = p.rhs.id
      const resolution = resolveParamRhs(p.rhs, (id) => {
        const node = byId.get(id)
        return node ? { kind: node.data.kind, value: (node.data as { value?: unknown }).value } : undefined
      })
      if (!resolution.ok) {
        const why =
          resolution.reason === 'unknown'
            ? `references an unknown parameter "@${paramId}"`
            : resolution.reason === 'not-param'
              ? `reference "@${paramId}" must be a parameter node (got ${resolution.kind})`
              : resolution.reason === 'non-finite'
                ? `parameter "@${paramId}" is not a finite number`
                : `parameter "@${paramId}" resolves to a non-finite threshold`
        diagnostics.push(`Activator "${e.id}" ${why}; target not gated on this comparison.`)
        const prevOk = enabledByNode.get(e.target)
        enabledByNode.set(e.target, prevOk === undefined ? false : prevOk && false)
        stateEvents.push({
          edgeId: e.id, from: e.source, to: e.target, mode: 'activator',
          effect: { kind: 'activator', satisfied: false },
        })
        continue
      }
      n = resolution.threshold
    }
    const satisfied = cmp(S[e.source] ?? 0, p.op, n)
    const prevOk = enabledByNode.get(e.target)
    enabledByNode.set(e.target, prevOk === undefined ? satisfied : prevOk && satisfied)
    stateEvents.push({
      edgeId: e.id, from: e.source, to: e.target, mode: 'activator',
      effect: { kind: 'activator', satisfied },
    })
  }
  const isEnabled = (id: string): boolean => enabledByNode.get(id) ?? true

  // Validate each trigger edge's `delay` once this step: a non-negative integer;
  // NaN / Infinity / fractional / negative → 0 + exactly one diagnostic.
  const delayByEdge = new Map<string, number>()
  for (const e of triggerEdges) {
    const raw = e.data.delay
    const d = parseDelay(raw)
    if (raw == null || d.ok) {
      delayByEdge.set(e.id, d.ok ? d.delay : 0)
    } else {
      diagnostics.push(`State edge "${e.id}" delay ${raw} is not an integer ≥ 0; treated as 0.`)
      delayByEdge.set(e.id, 0)
    }
  }

  // deliver every queue entry due this step; a delivery whose edge or target no
  // longer exists is dropped with no effect (§S8).
  const prevQueue = prev.triggerQueue ?? []
  const triggerEdgeIds = new Set(triggerEdges.map((e) => e.id))
  const triggered = new Set<string>() // targets pulsed this step
  const deliveredEdgeIds = new Set<string>()
  const carriedQueue: TriggerQueueEntry[] = []
  for (const q of prevQueue) {
    if (q.deliveryStep > curStep) {
      carriedQueue.push(q)
      continue
    }
    // due (== curStep) or stale (< curStep, shouldn't happen) — consumed either way
    if (q.deliveryStep < curStep) {
      diagnostics.push(`Dropped a stale queued trigger (edge "${q.edgeId}", due ${q.deliveryStep}).`)
      continue
    }
    if (triggerEdgeIds.has(q.edgeId) && byId.has(q.target)) {
      triggered.add(q.target)
      deliveredEdgeIds.add(q.edgeId)
    } else {
      diagnostics.push(`Dropped a queued trigger for a removed edge / node (edge "${q.edgeId}").`)
    }
  }

  // loop-model/1: `parameter` / `register` nodes have no `activation` and never
  // fire — the engine ignores them entirely (SEMANTICS-M.md §M6.1).
  const actOf = (n: { data: LoopNode['data'] }): Activation =>
    n.data && typeof n.data === 'object' && 'activation' in n.data ? n.data.activation : 'passive'

  const firing = (n: LoopNode) =>
    isEnabled(n.id) &&
    (actOf(n) === 'automatic' ||
      (actOf(n) === 'onStart' && prev.step === 0) ||
      (TRIGGERABLE.has(actOf(n)) && triggered.has(n.id)))

  const sumInRate = (id: string) => inOf(id).reduce((s, e) => s + rateOfCached(e), 0)

  const cmpId = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const isProbGate = (n: LoopNode | undefined) =>
    n?.data.kind === 'gate' && n.data.distribution === 'probabilistic'

  // ── label modifier — end of Phase 0 ─────────────────────────────────
  // Value semantics: loop-state/1 §S5. A numeric edit on the target Pool's
  // step-start balance (`working[target]`, seeded from `S[target]`). Source AND
  // target must be Pools. `expr` is one of `+N -N =N +S -S =S` (N a finite real
  // ≥ 0, whitespace tolerated; `S` = the literal token for `S[source]`). A
  // non-Pool endpoint, a removed node, an empty or unparseable `expr` ⇒ inert +
  // exactly one diagnostic this step. Several edges into one target apply in
  // ascending `edge.id` to the running value; intermediate out-of-range values
  // are allowed. Then ONE clamp per target: `[0, capacity]`, or floor-0 only
  // when the Pool is uncapped. Grammar parser in ./stateExpr (shared with the
  // Inspector).
  //
  // Reporting: loop-state/2 §S2-9 (SEMANTICS-S2.md). Each edge's `delta` is its
  // OWN raw requested change — the clamp is never folded into a per-edge figure
  // (that could invert an edge's apparent direction). The single per-target
  // clamp correction is reported once as `clampAdjustment` on the last label
  // event into that target. Net external change on the target =
  // `Σ delta + clampAdjustment = final − start`; this is I1′'s explicit term.
  // `label` never touches `report.events`, never schedules
  // a trigger, and never sets `ended`.
  const labelEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'label'; expr: string } } => e.data.mode === 'label',
  )
  // CSU / loop-state/3 (SEMANTICS-S3.md) — a `label` may run `timing:
  // "afterPull"` (Phase 2.5, after the pull, gated by `when`) instead of the
  // default unconditional Phase 0. Split validation happens here, once, in
  // `labelEdges`' existing ascending-`edge.id` order; `pendingAfterPull` is
  // consumed after Phase 2 (see below). `timing`/`when` are validated
  // fail-closed (CSU3-5): an edge whose declared intent cannot be honoured is
  // fully inert — it NEVER falls back to running as a plain Phase-0 label.
  const pendingAfterPull: { e: LoopEdge; op: '+' | '-' | '='; n: number }[] = []
  const pendingPhase0: { e: LoopEdge; op: '+' | '-' | '='; token: 'N' | 'S'; n: number }[] = []
  for (const e of labelEdges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      diagnostics.push(`Label "${e.id}" connects a removed node; ignored.`)
      continue
    }
    const rawTiming = (e.data as { timing?: unknown }).timing
    const timingParse = parseLabelTiming(rawTiming)
    if (!timingParse.ok) {
      diagnostics.push(`Label "${e.id}" timing "${rawTiming}" is not supported; ignored.`)
      continue
    }
    const rawWhen = (e.data as { when?: unknown }).when
    if (timingParse.timing === 'phase0') {
      // fail-closed (CSU3-5): a `when` on a `phase0` label is never silently
      // dropped in favour of running unconditionally — the whole edge is inert.
      if (rawWhen !== undefined) {
        diagnostics.push(`Label "${e.id}" has a "when" but is not timing: "afterPull"; ignored.`)
        continue
      }
      if (!isPool(e.source)) {
        diagnostics.push(`Label "${e.id}" needs a Pool source; ignored.`)
        continue
      }
      if (!isPool(e.target)) {
        diagnostics.push(`Label "${e.id}" needs a Pool target; ignored.`)
        continue
      }
      const raw = (e.data as { expr?: string }).expr ?? ''
      const p = parseLabelExpr(raw)
      if (!p.ok) {
        diagnostics.push(`Label "${e.id}" expression "${raw}" ${LABEL_WHY[p.reason]}; ignored.`)
        continue
      }
      pendingPhase0.push({ e, op: p.op, token: p.token, n: p.n })
      continue
    }
    // timing === 'afterPull'
    if (rawWhen === undefined) {
      diagnostics.push(`Label "${e.id}" (timing: "afterPull") needs when: "source-fired"; ignored.`)
      continue
    }
    const whenParse = parseLabelWhen(rawWhen)
    if (!whenParse.ok) {
      diagnostics.push(`Label "${e.id}" when "${rawWhen}" is not supported; ignored.`)
      continue
    }
    const srcKind = kindOf(e.source)
    if (!srcKind || !ROUTER_KINDS.has(srcKind)) {
      diagnostics.push(
        `Label "${e.id}" (timing: "afterPull") needs a Gate / Converter / Drain / End source; ignored.`,
      )
      continue
    }
    if (!isPool(e.target)) {
      diagnostics.push(`Label "${e.id}" needs a Pool target; ignored.`)
      continue
    }
    const raw = (e.data as { expr?: string }).expr ?? ''
    const p = parseLabelExpr(raw)
    if (!p.ok) {
      diagnostics.push(`Label "${e.id}" expression "${raw}" ${LABEL_WHY[p.reason]}; ignored.`)
      continue
    }
    if (p.token === 'S') {
      diagnostics.push(`Label "${e.id}" (timing: "afterPull") cannot read S; use a numeric literal; ignored.`)
      continue
    }
    pendingAfterPull.push({ e, op: p.op, n: p.n })
  }
  const labelTargets = new Set<string>()
  const labelApplied: { e: LoopEdge; delta: number }[] = []
  for (const item of pendingPhase0) {
    const e = item.e
    const operand = item.token === 'S' ? S[e.source] ?? 0 : item.n
    const running = working[e.target] ?? 0
    const delta = item.op === '+' ? operand : item.op === '-' ? -operand : operand - running
    working[e.target] = running + delta
    labelTargets.add(e.target)
    labelApplied.push({ e, delta })
  }
  // one clamp per target, after every label edge across all targets; record the
  // correction (clamped − unclamped) so it can be reported once, un-attributed.
  const clampAdjByTarget = new Map<string, number>()
  for (const tid of labelTargets) {
    const unclamped = working[tid] ?? 0
    const clamped = Math.min(cap(byId.get(tid)!), Math.max(0, unclamped))
    working[tid] = clamped
    clampAdjByTarget.set(tid, nz(clamped - unclamped))
  }
  // one label event per valid edge, ascending edge.id; `delta` is the edge's own
  // raw request, `clampAdjustment` rides on the last event into each target.
  const lastLabelIdx = new Map<string, number>()
  labelApplied.forEach((r, i) => lastLabelIdx.set(r.e.target, i))
  labelApplied.forEach((r, i) => {
    stateEvents.push({
      edgeId: r.e.id,
      from: r.e.source,
      to: r.e.target,
      mode: 'label',
      effect: {
        kind: 'label',
        delta: r.delta,
        clampAdjustment: lastLabelIdx.get(r.e.target) === i ? clampAdjByTarget.get(r.e.target) ?? 0 : 0,
      },
    })
  })

  // ── Phase 1: push ────────────────────────────────────────────────────────
  for (const id of Object.keys(working)) xl.set(id, toX(working[id] ?? 0)) // the exact level starts at the value the push phase finds
  for (const id of Object.keys(working)) lvR.set(id, ratOfDouble(working[id] ?? 0)) // and so does the exact ledger: a stored double is exactly itself
  const sources = nodes
    .filter((n) => n.data.kind === 'source' && firing(n))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const src of sources) {
    activated.add(src.id)
    const outs = outOf(src.id)
    const plan = outs.map((e) => {
      // a Source edge has no source pool → available / snapshot are 0; `all` and
      // `%` stay 0 there, but `range` / `dice` now draw (SEMANTICS-B1.md §B2.1)
      return { e, want: amountOf(e, 0, 0), pool: isPool(e.target) }
    })
    const pushAll = src.data.kind === 'source' && src.data.mode === 'pushAll'
    if (pushAll) {
      // issue #419 item 2 — a push-all Source with a non-Pool target used to
      // `continue` here in silence: the atomic check failed on that edge before
      // the per-edge loop below could report it, so the Source moved nothing on
      // ANY of its edges and said nothing. Report each such edge (a Source →
      // Drain / Gate / Converter / End line is drawable); the amount stays 0.
      for (const p of plan) {
        if (p.pool) continue
        const t = byId.get(p.e.target)
        diagnostics.push(
          `Edge "${p.e.id}" from Source "${src.data.label}" goes to ${t?.data.kind ?? 'a missing node'} "${t?.data.label ?? p.e.target}", not a Pool; a push-all Source moves nothing while one of its targets is not a Pool.`,
        )
      }
      // every line in full or nothing (§9): lines into one Pool are asked of
      // its room TOGETHER. Asked one by one, two "5" lines into a room of 8
      // both passed and the Source pushed 5 + 3 (review of 2026-11-15, E3).
      const into = new Map<string, number>()
      for (const p of plan) if (p.pool) into.set(p.e.target, (into.get(p.e.target) ?? 0) + Math.max(0, p.want))
      const pushed = [...into.values()].reduce((a, b) => a + b, 0) // all the Source asks to push: what its allowance is measured by
      if (!plan.every((p) => p.pool) || ![...into].every(([q, want]) => roomP(q) >= want - shortfallAllowed(pushed))) {
        continue // atomic: nothing
      }
    }
    let did = 0
    for (const p of plan) {
      if (!p.pool) {
        diagnostics.push(`Source "${src.data.label}" pushes to a non-Pool; ignored in Engine A.`)
        continue
      }
      const h = roomP(p.e.target)
      const moved = nzPool(Math.max(0, Math.min(p.want, h)))
      if (moved > 0) {
        moveLevel(p.e.target, moved)
        did += moved
        emit(p.e, src.id, p.e.target, moved)
      }
    }
    if (did > 0) fired.add(src.id)
  }

  // ── Phase 2: pull over the router DAG ────────────────────────────────────
  const routers = nodes.filter((n) => firing(n) && ROUTER_KINDS.has(n.data.kind))
  const dead = new Set<string>() // edge ids on a router-only cycle
  // a resource edge into a disabled router is inert — the upstream keeps the
  // resource (§S4). This is kept SEPARATE from `dead`: a *deterministic* gate /
  // converter re-splits its output over the still-active branches (allowed —
  // conservation holds), but a *probabilistic* gate must keep its full branch
  // set for the `gate-route` draw (frozen loop-rng/1 no-spill / no-reroll). A
  // probabilistic pick that lands on a disabled branch simply accepts 0, so the
  // resource stays upstream — no redraw, no re-normalised weights.
  // The same rule holds for a router that does not FIRE this step for any
  // other reason (`passive` / `interactive` without a pulse, `onStart` after
  // step 1): it is not in `order`, so an inbox handed to it would never be
  // consumed and the amount would vanish (issue #388 A — reproduced with a
  // passive Gate downstream of a Gate: the share left the source Pool and
  // reached nothing, reported as fired, no diagnostic).
  const willFire = new Set(routers.map((r) => r.id))
  const disabledInto = new Set<string>()
  for (const e of resEdges) {
    const k = kindOf(e.target)
    if (k && ROUTER_KINDS.has(k) && !willFire.has(e.target)) disabledInto.add(e.id)
  }
  // deterministic routing / accept / reserve skip both a dead branch and a
  // branch into a disabled router; `pickBranch` (probabilistic) skips only `dead`.
  const skipDet = (id: string): boolean => dead.has(id) || disabledInto.has(id)

  // Kahn topological sort of router→router edges, ascending-id tiebreak
  // (./gateChance.ts `routerOrder`, shared with the panel's Gate chances)
  const { order, cyclic } = routerOrder(
    routers.map((r) => r.id),
    resEdges,
  )
  if (cyclic.length) {
    for (const e of resEdges) {
      if (cyclic.includes(e.source) || cyclic.includes(e.target)) dead.add(e.id)
    }
    order.push(...cyclic.sort())
    diagnostics.push(
      `${cyclic.length} router node(s) form a zero-storage cycle; those connections are inactive (a loop must contain a Pool).`,
    )
  }

  // Probabilistic Gate branch selection — one `gate-route` draw per gate per
  // step (SEMANTICS-B1.md §B4). Memoised so `accept()` and execution agree (I10).
  const gatePick = new Map<string, LoopEdge | null>()
  const pickBranch = (g: LoopNode): LoopEdge | null => {
    const memo = gatePick.get(g.id)
    if (memo !== undefined) {
      if (memo === null) surfaceGateDiag(g.id)
      return memo
    }
    const outs = outOf(g.id)
      .filter((e) => !dead.has(e.id))
      .sort(cmpId) // canonical order: edge.id ascending (§B4.2)
    const weights = outs.map((e) => rateOfCached(e))
    const idx = categorical(weights, sample(seed, curStep, g.id, 'gate-route', 0).u)
    if (idx < 0) {
      if (!gateInertReason.has(g.id)) {
        gateInertReason.set(
          g.id,
          weights.some((w) => !Number.isFinite(w) || w < 0)
            ? `Probabilistic gate "${g.data.label}": invalid branch weight; gate is inert this step.`
            : `Probabilistic gate "${g.data.label}": no positive branch weight; gate is inert this step.`,
        )
      }
      surfaceGateDiag(g.id)
      gatePick.set(g.id, null)
      return null
    }
    gatePick.set(g.id, outs[idx])
    return outs[idx]
  }

  // `pullAll` Converters proven unfillable by the probe pass (see `pullPass`).
  // Rebuilt each iteration of the feasibility fixpoint; empty for the common
  // no-`pullAll`-Converter graph, so behaviour there is byte-identical.
  let disabledPullAll = new Set<string>()

  // #492 (SEMANTICS.md §6 erratum, part 5) — a plain tree of routers, outside
  // every group, can reach one Pool by two paths. `accept` bounds each branch on
  // its own, so each read the Pool's whole room: the router at the root sent
  // more than the Pool could take, its reservations passed the room, and the
  // Gates below were handed what they could not deliver. `branches` is what the
  // router sends into each of its targets per unit it moves; this follows them
  // through the firing Gates below and returns the largest number of units that
  // fits every Pool reached by two or more paths: its room, plus what those
  // Gates (and `own`) already hold there, over its path-summed share. A
  // Converter's `takes` come off the share: what it takes from a Pool in the
  // same activation is room it may fill. A Pool reached by one path is left to
  // `accept`, whose arithmetic stays as it was. (A pick is memoised, so reading
  // a probabilistic Gate's branch here makes no extra draw.)
  const sharedPoolBound = (branches: Map<string, number>, own?: Map<string, number>, takes?: Map<string, number>): number => {
    const share = new Map<string, number>()
    const paths = new Map<string, number>()
    const held = new Map<string, number>(own)
    const follow = (target: string, c: number) => {
      if (isPool(target)) {
        share.set(target, (share.get(target) ?? 0) + c)
        paths.set(target, (paths.get(target) ?? 0) + 1)
        return
      }
      // any other router or terminal bounds its branch through `accept`
      if (kindOf(target) !== 'gate' || !willFire.has(target)) return
      for (const [q, a] of ownReserve.get(target) ?? []) held.set(q, (held.get(q) ?? 0) + a)
      const g = byId.get(target)!
      if (isProbGate(g)) {
        const sel = pickBranch(g)
        if (sel && !skipDet(sel.id)) follow(sel.target, c)
        return
      }
      const outs = outOf(target).filter((e) => !skipDet(e.id))
      const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
      if (sumW <= 0) return
      const wInto = new Map<string, number>() // two connections into one target are one path
      for (const e of outs) {
        const w = rateOfCached(e)
        if (w > 0) wInto.set(e.target, (wInto.get(e.target) ?? 0) + w)
      }
      for (const [t, w] of wInto) follow(t, (c * w) / sumW)
    }
    for (const [t, c] of branches) follow(t, c)
    let bound = Infinity
    for (const [q, n] of paths) {
      if (n < 2) continue
      const net = (share.get(q) ?? 0) - (takes?.get(q) ?? 0)
      if (net > 0) bound = Math.min(bound, Math.max(0, headroom(q) + (held.get(q) ?? 0)) / net) // (a net above 0 asks the room, SEMANTICS-E.md §E14; asked only above the epsilon, a Pool reached by two paths was filled past its capacity by a Converter whose net into it was 1e-11 a run)
    }
    return bound
  }

  // `accept(id)` — max the node can take on its input side, live. Memo is valid
  // only while `working`/`reserved` are stable, so it is rebuilt per router turn.
  const makeAccept = () => {
    const memo = new Map<string, number>()

    const accept = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!
      const k = kindOf(id)
      let v: number
      // a router that does not fire this step is inert — like a zero-weight
      // branch (§S4; disabled by an activator, or not firing — #388 A)
      if (k && ROUTER_KINDS.has(k) && !willFire.has(id)) v = 0
      else if (k === 'pool') v = roomP(id)
      else if (k === 'drain' || k === 'end') v = Infinity
      else if (k === 'converter') {
        // SEMANTICS.md §9 — a `pullAll` Converter is all-or-nothing. The probe
        // pass has already decided which ones cannot reach f = 1 this step; an
        // upstream router must route NOTHING into those (§11 / I5). Checked
        // before reading any input edge so a disabled Converter's edges are not
        // even evaluated on the committed pass.
        if (disabledPullAll.has(id)) {
          memo.set(id, 0)
          return 0
        }
        const sumIn = sumInRate(id)
        // #388 D — a Converter with no LIVE output cannot run: with every
        // branch skipped (dead, or into a router that does not fire) it must
        // accept 0, or it pulls its inputs and has nowhere to deliver them.
        // #471 (V3r) — two outputs into one target share what it can take:
        // the bound is per TARGET, `accept(target) / Σ rate into it`. Per
        // connection, each of two outputs into one Gate saw the Gate's whole
        // accept, and the Gate was handed more than it could deliver.
        let fmax = 1
        const makeInto = new Map<string, number>()
        for (const e of outOf(id)) {
          if (skipDet(e.id)) continue
          const r = rateOfCached(e)
          if (r <= 0) continue
          makeInto.set(e.target, (makeInto.get(e.target) ?? 0) + r)
        }
        for (const [target, make] of makeInto) fmax = Math.min(fmax, accept(target) / make)
        if (makeInto.size === 0) fmax = 0
        v = Math.max(0, Math.min(1, fmax)) * sumIn
      } else if (k === 'gate') {
        // #388 B — a Gate fed by an upstream router has a reservation standing
        // in its target Pool(s) on ITS behalf (`planReserve`). Its own accept
        // must credit that back, exactly as a Converter's does (`back` below),
        // or the delivery it is about to make counts against it and T comes
        // out 0: the inbox was already pulled from the source Pool and is lost.
        const own = ownReserve.get(id)
        const acceptInto = (target: string): number =>
          isPool(target) ? (roomP(target, own?.get(target) ?? 0)) : accept(target)
        if (isProbGate(byId.get(id))) {
          // one live branch of effective weight 1 (§B4.4)
          const sel = pickBranch(byId.get(id)!)
          v = sel ? acceptInto(sel.target) : 0
        } else {
          const outs = outOf(id).filter((e) => !skipDet(e.id))
          const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
          if (sumW <= 0) v = 0
          else {
            // #471 (V3g) — two branches into one Pool share its room: the
            // bound is per target, `acceptInto(target) · sumW / Σ w into it`.
            // Per branch, each saw the Pool's whole room, the Gate sent twice
            // it, and the commit clamp cut the excess unreported.
            const wInto = new Map<string, number>()
            for (const e of outs) {
              const w = rateOfCached(e)
              if (w <= 0) continue
              wInto.set(e.target, (wInto.get(e.target) ?? 0) + w)
            }
            v = Infinity
            for (const [target, w] of wInto) v = Math.min(v, acceptInto(target) * (sumW / w))
            // #492 — a Pool reached through the Gates below by two paths
            const shares = new Map<string, number>()
            for (const [target, w] of wInto) shares.set(target, w / sumW)
            v = Math.min(v, sharedPoolBound(shares, own))
          }
        }
      } else v = 0
      memo.set(id, v)
      return v
    }
    return accept
  }
  /** Reserve the Pool headroom that `xR` arriving at `destId` will consume downstream, exactly.
   *  It is followed in the shares the turns hand on in: a Gate's exact weights (a probabilistic
   *  Gate: its one branch), a Converter's one fraction `xR / Σ inputs` on every output; each
   *  Pool it ends in is promised its exact part, for the member that delivers there. */
  const planReserveR = (destId: string, xR: Rat, depth = 0) => {
    if (!isPositive(xR) || depth > 32) return
    const k = kindOf(destId)
    if (k === 'converter') {
      const sumInR = inOf(destId).reduce((t, e) => (rateOfCached(e) > 0 ? addR(t, exactRate(e)) : t), RAT0)
      if (!isPositive(sumInR)) return
      const part = divR(xR, sumInR)
      const fR = cmpR(part, RAT1) > 0 ? RAT1 : part
      for (const e of outOf(destId)) {
        if (skipDet(e.id) || rateOfCached(e) <= 0) continue
        const q = mulR(fR, exactRate(e))
        if (isPool(e.target)) promiseR(destId, e.target, q)
        else planReserveR(e.target, q, depth + 1)
      }
    } else if (k === 'gate') {
      if (isProbGate(byId.get(destId))) {
        const sel = pickBranch(byId.get(destId)!)
        if (sel && !skipDet(sel.id)) {
          if (isPool(sel.target)) promiseR(destId, sel.target, xR)
          else planReserveR(sel.target, xR, depth + 1)
        }
        return
      }
      const outs = outOf(destId).filter((e) => !skipDet(e.id))
      const ws = outs.map((e) => exactRate(e))
      const W = ws.reduce((t, w) => addR(t, w), RAT0)
      if (!isPositive(W)) return
      for (const [i, e] of outs.entries()) {
        const q = divR(mulR(xR, ws[i]), W)
        if (isPool(e.target)) promiseR(destId, e.target, q)
        else planReserveR(e.target, q, depth + 1)
      }
    }
  }
  const planReserve = (destId: string, amountIn: number, amountR?: Rat) => {
    return planReserveR(destId, amountR ?? ratOfDouble(amountIn))
    // drain / end / pool: nothing further to reserve
  }

  // ── Phase 2 as a re-runnable pass ───────────────────────────────────────
  // `pullPass` walks the canonical router `order` exactly once. With
  // `commit = false` it is a *probe*: every mutation lands on a shadow copy of
  // `working` / `taken` / `reserved` / `inbox` / `ownReserve` / `activated` /
  // `fired`, `events` / `diagnostics` are rewound, `ended` is restored, and the
  // set of `pullAll` Converters that could not reach f = 1 is returned. The
  // probabilistic branch picks (`gatePick`) and random-flow draws (`sampled`)
  // are memoised at `step()` scope, so a probe reuses the SAME results as the
  // real pass — no extra draws; `emitDiag = false` keeps a probe from
  // publishing a diagnostic (`surfaceRandDiag` / `surfaceGateDiag` flush it on
  // the committed pass instead). `disabledPullAll` (closed over by
  // `makeAccept`) selects which `pullAll` Converters are non-accepting.
  const cloneOwn = (m: Map<string, Map<string, number>>) =>
    new Map([...m].map(([k, v]) => [k, new Map(v)]))
  const pullPass = (commit: boolean): Set<string> => {
    const pullShort = new Set<string>()
    const prevEmitDiag = emitDiag
    emitDiag = commit
    const snap = commit
      ? null
      : {
          working: { ...working },
          xl: new Map(xl),
          xTaken: new Map(xTaken),
          taken: new Map(taken),
          reserved: new Map(reserved),
          reservedXm: new Map(reservedXm),
          reservedIn: new Map(reservedIn),
          inbox: new Map(inbox),
          lvR: new Map(lvR),
          takenR: new Map(takenR),
          claimR: new Map(claimR),
          inboxR: new Map(inboxR),
          movesLen: movesR.length,
          ownReserve: cloneOwn(ownReserve),
          reservedR: new Map(reservedR),
          ownR: new Map([...ownR].map(([k, v]) => [k, new Map(v)])),
          activated: new Set(activated),
          fired: new Set(fired),
          eventsLen: events.length,
          diagLen: diagnostics.length,
          ended,
        }

    // ── #471 Deploy 2 — Converter groups and the joint plan ─────────────────
    // (SEMANTICS.md §6 erratum, part 2.) The connections that carry something
    // THIS step: a router → router connection is live when both ends fire, it
    // is not dead, its source is not a disabled `pull all` Converter (its
    // flows are never read on the committed pass), it is the picked branch of
    // a probabilistic Gate, and its rate is positive; a Pool → router
    // connection is live when the router fires. Over those, `converterGroups`
    // finds every group with a router-fed Converter and classes it: a TREE is
    // planned as one at the turn of its first router in `order` (one free
    // number `s`; every member's amount is a fixed multiple of it); a MULTI
    // group (a Gate with two supplies) is planned at the same turn by filling
    // the Gates' supplies one after the other at a fixed priority (#476,
    // `planMulti` below), two such Gates meeting at one Converter included.
    // A split that rejoins was refused at the top of `step` when the group has
    // a Converter; a group of Gates only that rejoins is a multi group (#471).
    const liveEdge = (e: LoopEdge): boolean => {
      if (dead.has(e.id)) return false
      const sk = kindOf(e.source)
      const tk = kindOf(e.target)
      if (tk && ROUTER_KINDS.has(tk) && !willFire.has(e.target)) return false
      if (sk && ROUTER_KINDS.has(sk) && !willFire.has(e.source)) return false
      if (sk === 'converter' && disabledPullAll.has(e.source)) return false
      if (sk === 'pool') return true
      if (!(tk && ROUTER_KINDS.has(tk))) return true
      if (sk === 'gate' && isProbGate(byId.get(e.source))) return pickBranch(byId.get(e.source)!) === e
      return rateOfCached(e) > 0
    }
    const orderIdx = new Map(order.map((id, i) => [id, i]))
    const treeAtRoot = new Map<string, string[]>() // root id → the group's members
    const multiAtRoot = new Map<string, { members: string[]; multiGates: string[]; rejoin: boolean }>() // #476 — root id → the multi group (#471 part 4: a Gate-only split that rejoins is one)
    for (const g of converterGroups(nodes, resEdges, liveEdge)) {
      // with a Converter: refused at the top of `step`. Gates only (#471,
      // erratum part 4): the join has two supplies, so the group is a multi
      // group — the cut at the join's inputs leaves trees, and the join's two
      // supplies from one piece sum that piece's paths
      if (g.cls === 'split-rejoin' && g.hasConverter) continue
      const root = g.members.reduce((a, b) => ((orderIdx.get(b) ?? Infinity) < (orderIdx.get(a) ?? Infinity) ? b : a))
      if (g.cls === 'tree') treeAtRoot.set(root, g.members)
      else multiAtRoot.set(root, { members: g.members, multiGates: g.multiGates, rejoin: g.cls === 'split-rejoin' })
    }
    const planned = new Set<string>()
    const planF = new Map<string, number>() // Converter member → its run fraction
    const planT = new Map<string, number>() // Gate member → its throughput
    const planTakes = new Map<string, { e: LoopEdge; a: number; r?: Rat }[]>() // Converter member → its Pool takes (`r`: the exact amount)
    const planPulls = new Map<string, { e: LoopEdge; a: number; r?: Rat }[]>() // #476 — multi-supply Gate → its own-Pool takes
    /** a double that is not under the exact amount `x`: its nearest (`near`), or the next one above that */
    const upTo = (near: number, x: Rat): number => {
      if (!isPositive(x)) return near
      const d = near > 0 ? near : rnR(x) // (a line the display threshold made 0 in the record is still promised its room)
      return cmpR(ratOfDouble(d), x) < 0 ? nextTo(d, 1) : d
    }
    /** a record's line into a Pool has its room promised whatever its size */
    const promised = (amt: number, x: Rat): boolean => amt > 0 || (isPositive(x))
    const planOut = new Map<string, Map<string, number>>() // planned member → connection → the amount it is to hand on
    const planPullsSource = new Set<string>() // source Gates whose pulls the plan's record fixed (not multi-supply Gates): they still ask `pull all` at their turn
    gateHolds.clear() // a hold lives from a group's plan to its Gate's turn, inside one pass (issue #570)
    heldIn.clear()
    const liveOuts =(id: string): LoopEdge[] => {
      const n = byId.get(id)!
      if (isProbGate(n)) {
        const sel = pickBranch(n)
        return sel && !skipDet(sel.id) ? [sel] : []
      }
      return outOf(id).filter((e) => !skipDet(e.id))
    }
    /** What a Gate would hand on of `amount`, followed through the Gates below it that
     *  only pass on, with their own split, to the Pools it ends in: summed exactly per Pool into
     *  `need`. False where a target that is not followed (a Converter, a planned member, a router
     *  that does not fire) accepts less, in doubles. `skip`: which share of the first Gate takes
     *  its split's leftover. (The root Gate's sizing.) */
    const followDown = (gid: string, amount: number, depth: number, need: Map<string, bigint>, acc: (id: string) => number, skip = 0): boolean => {
      const gn = byId.get(gid)!
      let parts: { target: string; q: number }[]
      if (isProbGate(gn)) {
        const s = pickBranch(gn)
        if (!s || skipDet(s.id)) return amount <= EPSILON
        parts = [{ target: s.target, q: amount }]
      } else {
        const os = outOf(gid).filter((e) => !skipDet(e.id))
        const sw = os.reduce((s, e) => s + rateOfCached(e), 0)
        if (sw <= 0) return amount <= EPSILON
        const sh = splitOf(os.map((e) => rateOfCached(e)), sw, amount, true, undefined, depth === 0 ? skip : 0)
        parts = os.map((e, i) => ({ target: e.target, q: sh[i] }))
      }
      for (const { target, q } of parts) {
        if (q <= 0) continue
        if (isPool(target)) {
          need.set(target, (need.get(target) ?? 0n) + toX(q))
          continue
        }
        const tk = kindOf(target)
        if (tk === 'drain' || tk === 'end') continue
        if (passesOn(target) && depth < 16) {
          if (!followDown(target, q, depth + 1, need, acc)) return false
          continue
        }
        if (q > acc(target)) return false // a Converter, a planned member, a router that does not fire: its accept, in doubles
      }
      return true
    }
    /** What a Gate hands on of `share`, in EXACT shares, followed through the
     *  Gates below it that only pass on, to the Pools it ends in: each Pool's part is added to
     *  `partPool`; a target that is not followed (a Converter, a planned member, a router that
     *  does not fire) gets its part in `partOther`. False where a Gate on the way has no live
     *  branch. `selRoot`: the branch a probabilistic first Gate has already picked. */
    const spreadExact = (gid: string, share: Rat, depth: number, partPool: Map<string, Rat>, partOther: Map<string, Rat>, selRoot?: LoopEdge | null, viaLive = true): boolean => {
      const gn = byId.get(gid)!
      let parts: { target: string; x: Rat; live: boolean }[]
      if (isProbGate(gn)) {
        const sB = selRoot !== undefined ? selRoot : pickBranch(gn)
        if (!sB || skipDet(sB.id)) return false
        parts = [{ target: sB.target, x: share, live: true }]
      } else {
        const os = outOf(gid).filter((e) => !skipDet(e.id))
        const ws = os.map((e) => exactRate(e))
        const Ws = ws.reduce((t, w) => addR(t, w), RAT0)
        if (!isPositive(Ws)) return false
        // The rule of a Gate's `accept` (`sumW <= 0` accepts nothing): a Gate whose lines' rates
        // sum to nothing above 0 moves nothing. A Gate that moved all the same handed what it
        // took along a line that is not live for the plans: into a `pull all` Gate that then
        // refused it, or into a planned group that had not counted it (a Pool filled past its
        // capacity and cut at the commit). A Gate BELOW is asked this only where the line into
        // it has a rate above 0 (`viaLive`): what a branch with no rate leads to is not asked.
        if (viaLive && os.reduce((s, e) => s + rateOfCached(e), 0) <= 0) return false
        parts = os.map((e, i) => ({ target: e.target, x: divR(mulR(share, ws[i]), Ws), live: rateOfCached(e) > 0 }))
      }
      for (const { target, x, live } of parts) {
        if (!isPositive(x)) continue
        if (isPool(target)) {
          partPool.set(target, addR(partPool.get(target) ?? RAT0, x))
          continue
        }
        const tk = kindOf(target)
        if (tk === 'drain' || tk === 'end') continue
        if (passesOn(target) && depth < 16) {
          if (!spreadExact(target, x, depth + 1, partPool, partOther, undefined, live)) return false
        } else partOther.set(target, addR(partOther.get(target) ?? RAT0, x))
      }
      return true
    }
    /** a Gate that fires this step, outside every plan, with no live Pool line of its own: it passes on what it is handed */
    const passesOn = (target: string): boolean =>
      kindOf(target) === 'gate' && willFire.has(target) && !planned.has(target) && !cyclicSet.has(target) && inOf(target).every((e) => !isPool(e.source) || dead.has(e.id))
    /** a record's amount through the display threshold */
    let keepTiny = false // (never set)
    const nzD = (v: number): number => {
      if (keepTiny && v > 0) {
        return v
      }
      const out = nz(v)
      return out
    }
    const modeOfRouter = (id: string) => ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny')

    // ── #477 — a Gate's execution evidence (`GateStatus`, types.ts) ─────────
    // The design is the QA record gate-state-design.md rev 2 (Lumi,
    // 2026-11-02). `demand` / `available` are PLAN-FREE: read at the router's
    // own turn — or at its group's plan, before the plan claims anything —
    // from rates and what its inputs hold THEN, upstream first. A router input
    // is the upstream's number propagated through its share, never what the
    // plan delivered (the inbox IS the plan's limit: read as demand it made
    // every Gate the plan cut look `full`). Memoised per pass; a probe pass
    // computes and discards.
    type Nums = { demand: number; available: number; ownWant: number; ownAvail: number }
    const routerNums = new Map<string, Nums>()
    /** what router `up` sends on `e` when it runs at `x` */
    const sendOf = (up: string, e: LoopEdge, x: number): number => {
      if (kindOf(up) === 'gate') {
        if (isProbGate(byId.get(up))) return pickBranch(byId.get(up)!) === e ? x : 0
        const outs = outOf(up).filter((o) => !skipDet(o.id))
        const Wsum = outs.reduce((s, o) => s + rateOfCached(o), 0)
        return Wsum > 0 ? (x * rateOfCached(e)) / Wsum : 0
      }
      const sumIn = sumInRate(up)
      return Math.min(1, sumIn > 0 ? x / sumIn : 0) * rateOfCached(e)
    }
    const numsOf = (id: string): Nums => {
      const hit = routerNums.get(id)
      if (hit) return hit
      const v: Nums = { demand: 0, available: 0, ownWant: 0, ownAvail: 0 }
      // lines off one Pool share what it holds: two "5" lines off a Pool of 8
      // have 8 available between them, not 10 (the amount the Gate can move,
      // E1 of the 2026-11-15 review, read the same way here)
      const claimed = new Map<string, number>()
      for (const e of inOf(id)) {
        if (dead.has(e.id)) continue
        const src = e.source
        if (isPool(src)) {
          const want = Math.max(0, amountOf(e, availOf(src), S[src] ?? 0))
          const before = claimed.get(src) ?? 0
          const have = Math.min(want, Math.max(0, availOf(src) - before))
          claimed.set(src, before + have)
          v.demand += want
          v.available += have
          v.ownWant += want
          v.ownAvail += have
        } else if (willFire.has(src) && !(kindOf(src) === 'converter' && disabledPullAll.has(src))) {
          const up = numsOf(src)
          v.demand += sendOf(src, e, up.demand)
          v.available += sendOf(src, e, up.available)
        }
      }
      routerNums.set(id, v)
      return v
    }
    const gateEntries = new Map<string, GateStatus>()
    const planZeroWhy = new Map<string, 'pullAll' | 'plan'>() // a planned Gate that moves nothing, by the plan's cause
    const cyclicSet = new Set(cyclic)
    // What is reported is rounded to six decimals. An amount under that precision is reported
    // to six significant digits instead: a Gate that passed 5e-10 on does not read "moved 0".
    const r6 = (x: number) => (x !== 0 && Math.abs(x) < 1e-6 ? Number(x.toPrecision(6)) : Number(x.toFixed(6)))
    /** the Gate's verdict, recorded at the point that decided what it moved */
    const recordGate = (id: string, moved: number, fault?: 'inert' | 'cycle') => {
      const { demand, available, ownWant, ownAvail } = numsOf(id)
      // The verdict is given at the reported precision: 1e-6, or, where the Gate's own amounts
      // are at or under that, 1e-6 of them (an absolute 1e-6 read every such Gate as `idle`).
      // And it never contradicts the firing (SEMANTICS-E.md §E9): a Gate that moved anything is
      // `full` or `partial`, one that moved nothing is `idle` or `held`.
      const size = Math.max(demand, available)
      const tol = size > 1e-6 ? 1e-6 : size * 1e-6
      let state: GateStatus['state']
      let why: GateStatus['why']
      if (fault) {
        state = 'fault'
        why = fault
      } else if (!(moved > 0)) {
        if (available <= tol) state = 'idle'
        else {
          state = 'held'
          why = planZeroWhy.get(id) ?? (modeOfRouter(id) === 'pullAll' && ownAvail < ownWant - tol ? 'pullAll' : 'room')
        }
      } else if (moved >= demand - tol) state = 'full'
      else {
        state = 'partial'
        why = moved < available - tol ? 'room' : ownAvail < ownWant - tol ? 'supply' : 'upstream'
      }
      const entry: GateStatus = { nodeId: id, state, demand: r6(demand), available: r6(available), moved: r6(moved) }
      if (why) entry.why = why
      gateEntries.set(id, entry)
    }

    /** what a group's plan reads of its members: a Gate's live branches and
     *  their weights, a Converter's live outputs and Pool needs, and the live
     *  router → router connections summed per pair (shared by the tree plan
     *  and the multi-supply plan) */
    const memberShapes = (members: string[]) => {
      const inGroup = new Set(members)
      const W = new Map<string, number>() // Gate → Σ rate over its live branches
      const gateInto = new Map<string, Map<string, number>>() // Gate → target → Σ rate
      const convMake = new Map<string, Map<string, number>>() // Converter → target → Σ rate
      const convNeed = new Map<string, Map<string, number>>() // Converter → source Pool → Σ rate
      const convPoolIns = new Map<string, LoopEdge[]>()
      for (const m of members) {
        const into = new Map<string, number>()
        let sum = 0
        for (const e of liveOuts(m)) {
          const r = rateOfCached(e)
          if (r <= 0) continue
          sum += r
          into.set(e.target, (into.get(e.target) ?? 0) + r)
        }
        if (kindOf(m) === 'gate') {
          W.set(m, sum)
          gateInto.set(m, into)
        } else {
          convMake.set(m, into)
          const ins = inOf(m).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
          convPoolIns.set(m, ins)
          const need = new Map<string, number>()
          for (const e of ins) {
            const r = rateOfCached(e)
            if (r <= 0) continue
            need.set(e.source, (need.get(e.source) ?? 0) + r)
          }
          convNeed.set(m, need)
        }
      }
      // the router → router connections inside the group, summed per pair
      const pair = new Map<string, number>()
      const fedByRouter = new Set<string>()
      for (const e of resEdges) {
        if (!inGroup.has(e.source) || !inGroup.has(e.target) || !liveEdge(e)) continue
        const key = `${e.source}\u0000${e.target}`
        pair.set(key, (pair.get(key) ?? 0) + rateOfCached(e))
        fedByRouter.add(e.target)
      }
      return { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter }
    }
    /** `memberShapes` again, as exact fractions of the rates the document
     *  states (`./exact.ts`): for the exact test of a Pool's room. Built only
     *  when a floating-point level comes out past a room. */
    const exactShapes = (members: string[]) => {
      const inGroup = new Set(members)
      const W = new Map<string, Rat>()
      const into = new Map<string, Map<string, Rat>>() // member → target → Σ rate
      const need = new Map<string, Map<string, Rat>>() // Converter → source Pool → Σ rate
      const bump = (map: Map<string, Rat>, k: string, v: Rat) => map.set(k, addR(map.get(k) ?? RAT0, v))
      for (const m of members) {
        const row = new Map<string, Rat>()
        let sum = RAT0
        for (const e of liveOuts(m)) {
          const r = rateOfCached(e)
          if (r <= 0) continue
          sum = addR(sum, exactRate(e))
          bump(row, e.target, exactRate(e))
        }
        into.set(m, row)
        if (kindOf(m) === 'gate') W.set(m, sum)
        else {
          const n = new Map<string, Rat>()
          for (const e of inOf(m)) {
            if (!isPool(e.source) || dead.has(e.id)) continue
            const r = rateOfCached(e)
            if (r > 0) bump(n, e.source, exactRate(e))
          }
          need.set(m, n)
        }
      }
      const pair = new Map<string, Rat>()
      for (const e of resEdges) {
        if (!inGroup.has(e.source) || !inGroup.has(e.target) || !liveEdge(e)) continue
        bump(pair, `${e.source}\u0000${e.target}`, exactRate(e))
      }
      /** member → its amount per unit of the root's, by the same walk as the floating-point coefficients */
      const coefficients = (root: string, has: (u: string, v: string) => boolean, floatW: Map<string, number>): Map<string, Rat> => {
        const cof = new Map<string, Rat>([[root, RAT1]])
        for (let changed = true; changed; ) {
          changed = false
          for (const [key, w] of pair) {
            const [u, v] = key.split('\u0000')
            if (!has(u, v)) continue
            const hasU = cof.has(u)
            const hasV = cof.has(v)
            if (hasU === hasV) continue
            if (kindOf(u) === 'gate' && (floatW.get(u) ?? 0) <= 0) continue
            const Wu = kindOf(u) === 'gate' ? W.get(u)! : RAT1
            const F = mulR(divR(RAT1, Wu), kindOf(v) === 'gate' ? w : RAT1)
            if (hasU) cof.set(v, mulR(cof.get(u)!, F))
            else cof.set(u, divR(cof.get(v)!, F))
            changed = true
          }
        }
        return cof
      }
      return { W, into, need, pair, coefficients }
    }
    /** a Pool-fed Gate's own inputs this step, in pull order */
    const ownIns = (id: string) => inOf(id).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
    const planGroup = (members: string[]) => {
      const cof = new Map<string, number>() // member → its amount per unit of s (a Converter's f, a Gate's T)
      const { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter } = memberShapes(members)
      // coefficients by traversal from the root (c = 1), in either direction:
      // Gate g → X scales by the branch share `w / W`; into a Converter the
      // share is divided by that connection's rate (what one run consumes);
      // Converter C → X scales by its rate on the connection; into a Gate the
      // whole amount arrives. So the factor source → target is
      // (source a Gate ? 1 / W : 1) · (target a Gate ? w : 1).
      const root = members.reduce((a, b) => ((orderIdx.get(b) ?? Infinity) < (orderIdx.get(a) ?? Infinity) ? b : a))
      cof.set(root, 1)
      for (let changed = true; changed && cof.size < members.length; ) {
        changed = false
        for (const [key, w] of pair) {
          const [u, v] = key.split('\u0000')
          const hasU = cof.has(u)
          const hasV = cof.has(v)
          if (hasU === hasV) continue
          const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
          if (Wu <= 0) continue
          const F = (1 / Wu) * (kindOf(v) === 'gate' ? w : 1)
          if (hasU) cof.set(v, cof.get(u)! * F)
          else cof.set(u, cof.get(v)! / F)
          changed = true
        }
      }
      // the bounds — s is the smallest of them
      let sMax = Infinity
      const bound = (v: number) => {
        if (v < sMax) sMax = v
      }
      const inNeed = new Map<string, number>() // Pool → Σ c_C · need
      const outCoef = new Map<string, number>() // Pool → Σ c · amount delivered per unit of s
      for (const m of members) {
        const c = cof.get(m) ?? 0
        if (kindOf(m) === 'gate') {
          if ((W.get(m) ?? 0) <= 0) bound(0) // no live branch — delivers nothing (#388 D)
          const Wm = W.get(m) ?? 1
          for (const [q, w] of gateInto.get(m)!) if (isPool(q)) outCoef.set(q, (outCoef.get(q) ?? 0) + (c * w) / Wm)
          continue
        }
        if (disabledPullAll.has(m)) bound(0) // an upstream router routes nothing into it (§11 / I5)
        // f ≤ the target ≤ 1. The coefficient is asked `> 0`, not `> EPSILON`
        // (issue #576; SEMANTICS.md §6 erratum, part 11): behind a Gate it is
        // a fraction PER AMOUNT, the Gate's share over the connection's rate,
        // and epsilon is the engine's floor for amounts. With a rate of 1e9 it
        // is below 1e-9 for no reason but the size of the model's numbers; the
        // bound was skipped, the Gate was planned past one run, and what the
        // Converter did not consume was gone (12 handed over for a run of 6).
        // A product of rates and shares: 0 when not reached, never rounding.
        if (c > 0) bound(runOf(m) / c)
        if (convMake.get(m)!.size === 0) bound(0) // no live output, no run (#388 D)
        // a router input that delivers nothing this step (its router does not
        // fire, the connection is dead, a probabilistic Gate picked another
        // branch, a disabled `pull all` Converter): one f on every connection
        // is 0, for the whole group
        if (inOf(m).some((e) => !isPool(e.source) && !liveEdge(e) && rateOfCached(e) > 0)) bound(0)
        const need = convNeed.get(m)!
        for (const [p, r] of need) inNeed.set(p, (inNeed.get(p) ?? 0) + c * r)
        for (const [q, make] of convMake.get(m)!) if (isPool(q)) outCoef.set(q, (outCoef.get(q) ?? 0) + c * make)
      }
      // §M6-5 — the tightest limit on the group's number, for the report
      let lim: { why: 'supply' | 'room'; pool: string; per: number; had: number } | null = null
      let limV = Infinity
      for (const [p, k] of inNeed) {
        if (k <= 0) continue
        const v = Math.max(0, availOf(p)) / k
        if (v < limV) {
          limV = v
          lim = { why: 'supply', pool: p, per: k, had: Math.max(0, availOf(p)) }
        }
        bound(v)
      }
      // #471 item 5 (Lumi, 2026-11-03) — a Pool's room is checked ALONG THE
      // GROUP'S COMMIT ORDER, not on the members' total: from the Pool as it
      // stands, each member's take lowers the level at its turn and each
      // member's delivery raises it, and the plan must keep the level within
      // the capacity at every point. A Converter takes and makes inside one
      // activation, so a Pool it both takes from and makes into is bounded on
      // its net; a take by an EARLIER member (the source Gate, an upstream
      // Converter) is room a later member's delivery may fill; a take by a
      // later member is not. With a source Gate's take on such a Pool the
      // level is not linear in `s` (its pulls are greedy and capped), so the
      // bound is found by bisection on the same walk.
      const roomOf = (q: string) => {
        let room = headroom(q)
        let own = 0
        for (const m of members) own += ownReserve.get(m)?.get(q) ?? 0
        // in the room the search reads too, a Pool that reads full has no room of its own
        if (own === 0 && Number.isFinite(cap(byId.get(q)!)) && (working[q] ?? 0) >= cap(byId.get(q)!)) return 0
        room += own
        return Math.max(0, room)
      }
      const inOrder = [...members].sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity))
      // The group's source Gates (fed from their own Pools), in the commit
      // order, with their Pool lines in pull order. A tree can have several:
      // two Gates into one Converter. Each one's pulls are read net of the
      // plan's claims AND of what the source Gates before it pull, so two of
      // them on one Pool share it, and each one's take is room for a later
      // member's delivery. Only the FIRST one was walked: a second Gate on the
      // same Pool was planned at a reach the first had already used (50 + 50
      // planned from a Pool of 60, 50 + 10 moved, the Converter fed at two
      // fractions), and a loop through a second Gate into a full Pool ran or
      // stood still by the Gates' ids (review of 2026-11-15, P2 and P5).
      const srcGates = inOrder.filter((m) => kindOf(m) === 'gate' && !fedByRouter.has(m))
      const wantsOf = new Map(
        srcGates.map((g) => [
          g,
          inOf(g)
            .filter((e) => isPool(e.source) && !dead.has(e.id))
            .sort(cmpEdge)
            .map((e) => ({ e, want: amountOf(e, availOf(e.source), S[e.source] ?? 0) })),
        ]),
      )
      /** every source Gate's greedy pulls at the plan number `s`, per Gate and Pool (the commit's own order) */
      const gateTakes = (s: number): Map<string, Map<string, number>> => {
        const took = new Map<string, Map<string, number>>()
        const used = new Map<string, number>() // Pool → pulled by the source Gates so far
        for (const g of srcGates) {
          const mine = new Map<string, number>()
          took.set(g, mine)
          let need = (cof.get(g) ?? 0) * s - (inbox.get(g) ?? 0)
          for (const w of wantsOf.get(g)!) {
            if (need <= 0) break // (what a source Gate still needs is pulled while it is above 0; with the epsilon here a tree whose amounts are under 1e-9 took nothing in its own walk and was planned at 0)
            const avail = Math.max(0, availOf(w.e.source) - s * (inNeed.get(w.e.source) ?? 0) - (used.get(w.e.source) ?? 0))
            const a = Math.max(0, Math.min(need, w.want, avail))
            mine.set(w.e.source, (mine.get(w.e.source) ?? 0) + a)
            used.set(w.e.source, (used.get(w.e.source) ?? 0) + a)
            need -= a
          }
        }
        return took
      }
      /** the highest level above the Pool's start that the walk reaches at `s` */
      /** everything the last `peakAt` walk took from and delivered into its Pool (for `LEVEL_DOUBT`) */
      let walkGross = 0
      const peakAt = (q: string, s: number): number => {
        const gt = gateTakes(s)
        let level = 0
        let peak = 0
        let gross = 0
        for (const m of inOrder) {
          const c = cof.get(m) ?? 0
          let took = 0
          let gave = 0
          if (kindOf(m) === 'gate') {
            took = gt.get(m)?.get(q) ?? 0
            const Wm = W.get(m) ?? 0
            if (Wm > 0) gave = (c * s * (gateInto.get(m)!.get(q) ?? 0)) / Wm
          } else {
            took = c * s * (convNeed.get(m)!.get(q) ?? 0)
            gave = c * s * (convMake.get(m)!.get(q) ?? 0)
          }
          level -= took
          level += gave
          gross += took + gave
          if (level > peak) peak = level
        }
        walkGross = gross
        return peak
      }
      const gateTouches = (q: string) => srcGates.some((g) => wantsOf.get(g)!.some((w) => w.e.source === q))
      const walked: string[] = [] // Pools whose bound needs the bisection
      for (const [q, k] of outCoef) {
        if (k <= 0) continue
        if (gateTouches(q)) {
          walked.push(q)
          continue
        }
        const peak = peakAt(q, 1) // linear in s without the Gate's pulls
        if (peak > EPSILON) {
          const v = roomOf(q) / peak
          if (v < limV) {
            limV = v
            lim = { why: 'room', pool: q, per: peak, had: roomOf(q) }
          }
          bound(v)
        }
      }
      // a Gate fed from its own Pools (a group's source — a Gate fed by a
      // router has no Pool input, or the group would be multi): what it can
      // reach by its greedy pulls, net of what the plan claims from the same
      // Pools; the reach falls as s grows, so the largest feasible s is found
      // by bisection when a Pool is shared, and is the plain reach otherwise.
      const sourceGates: { id: string; demand: number; c: number }[] = []
      for (const m of members) {
        if (kindOf(m) !== 'gate' || fedByRouter.has(m)) continue
        const c = cof.get(m) ?? 0
        const inb = inbox.get(m) ?? 0
        const ins = inOf(m).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
        const wants = ins.map((e) => ({ e, want: amountOf(e, availOf(e.source), S[e.source] ?? 0) }))
        const demand = inb + wants.reduce((t, w) => t + w.want, 0)
        sourceGates.push({ id: m, demand, c })
        if (c <= 0) continue
        const reach = (s: number): number => {
          const used = new Map<string, number>()
          let r = inb
          for (const w of wants) {
            const avail = Math.max(0, availOf(w.e.source) - s * (inNeed.get(w.e.source) ?? 0) - (used.get(w.e.source) ?? 0))
            const a = Math.max(0, Math.min(w.want, avail))
            used.set(w.e.source, (used.get(w.e.source) ?? 0) + a)
            r += a
          }
          return r
        }
        const shared = wants.some((w) => (inNeed.get(w.e.source) ?? 0) > 0)
        let hi = Math.min(sMax, reach(0) / c)
        // no slack (#471, erratum part 4): a value kept is one the Gate reaches
        if (shared && !(reach(hi) >= c * hi)) {
          let lo = 0
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2
            if (reach(mid) >= c * mid) lo = mid
            else hi = mid
          }
          hi = lo
        }
        bound(hi)
      }
      // Two or more source Gates on one Pool: each bound above read that Pool
      // as if its Gate were alone. The largest `s` at which EVERY source Gate
      // still reaches its amount, each one after what the ones before it pull
      // (no slack; every pull grows with `s`, so the test is one-sided).
      const pulledBy = new Map<string, number>() // Pool → the number of source Gates with a line off it
      for (const g of srcGates) for (const p of new Set(wantsOf.get(g)!.map((w) => w.e.source))) pulledBy.set(p, (pulledBy.get(p) ?? 0) + 1)
      if ([...pulledBy.values()].some((n) => n > 1) && Number.isFinite(sMax) && sMax > 0) {
        const allReach = (s: number): boolean => {
          const used = new Map<string, number>()
          for (const g of srcGates) {
            const T = (cof.get(g) ?? 0) * s
            if (T <= 0) continue
            let r = inbox.get(g) ?? 0
            let need = Math.max(0, T - r)
            for (const w of wantsOf.get(g)!) {
              const avail = Math.max(0, availOf(w.e.source) - s * (inNeed.get(w.e.source) ?? 0) - (used.get(w.e.source) ?? 0))
              const a = Math.max(0, Math.min(w.want, avail))
              r += a
              const pulled = Math.min(a, need) // what the commit pulls: up to what is still needed
              need -= pulled
              used.set(w.e.source, (used.get(w.e.source) ?? 0) + pulled)
            }
            if (r < T) return false
          }
          return true
        }
        if (!allReach(sMax)) {
          let lo = 0
          let hi = sMax
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2
            if (allReach(mid)) lo = mid
            else hi = mid
          }
          bound(lo)
        }
      }
      // the Pools the source Gate pulls from and a member delivers into: the
      // largest `s` under every other bound at which the walk keeps every such
      // Pool's level within its room (feasible at 0; bisection from there)
      if (walked.length > 0 && Number.isFinite(sMax) && sMax > 0) {
        // The same walk in exact fractions, from the rates the document states
        // and the number `s` itself (issue #572). Asked only where the
        // floating-point level is too close to the room to tell
        // (`LEVEL_DOUBT`): a group that returns to a Pool exactly what it
        // takes from it has a level of exactly 0 there, and one that returns
        // any more has a level above 0.
        let exactWalk: ((q: string, s: number) => boolean) | null = null
        const buildExactWalk = () => {
          const sh = exactShapes(members)
          const cofR = sh.coefficients(root, () => true, W)
          const inNeedR = new Map<string, Rat>()
          for (const m of members) {
            if (kindOf(m) === 'gate') continue
            const c = cofR.get(m)
            if (!c) continue
            for (const [p, r] of sh.need.get(m)!) inNeedR.set(p, addR(inNeedR.get(p) ?? RAT0, mulR(c, r)))
          }
          const wantsR = new Map(srcGates.map((g) => [g, wantsOf.get(g)!.map((w) => ({ pool: w.e.source, want: exactWant(w.e, w.want) }))]))
          const EPS = RAT0 // (the same in the exact walk: a need above 0 is pulled)
          return (q: string, s: number): boolean => {
            if (!Number.isFinite(roomOf(q))) return true // a Pool with no capacity
            const sR = ratOfDouble(s)
            const room = ratOfDouble(roomOf(q))
            const took = new Map<string, Rat>() // source Gate → what it pulls from q
            const used = new Map<string, Rat>()
            for (const g of srcGates) {
              let need = subR(mulR(cofR.get(g) ?? RAT0, sR), ratOfDouble(inbox.get(g) ?? 0))
              let mine = RAT0
              for (const w of wantsR.get(g)!) {
                if (cmpR(need, EPS) <= 0) break
                const avail = maxR(RAT0, subR(subR(ratOfDouble(availOf(w.pool)), mulR(sR, inNeedR.get(w.pool) ?? RAT0)), used.get(w.pool) ?? RAT0))
                const a = maxR(RAT0, minR(need, minR(w.want, avail)))
                if (w.pool === q) mine = addR(mine, a)
                used.set(w.pool, addR(used.get(w.pool) ?? RAT0, a))
                need = subR(need, a)
              }
              took.set(g, mine)
            }
            let level = RAT0
            for (const m of inOrder) {
              const cs = mulR(cofR.get(m) ?? RAT0, sR)
              if (kindOf(m) === 'gate') {
                level = subR(level, took.get(m) ?? RAT0)
                const w = sh.into.get(m)!.get(q)
                if (w && (W.get(m) ?? 0) > 0) level = addR(level, divR(mulR(cs, w), sh.W.get(m)!))
              } else {
                const n = sh.need.get(m)!.get(q)
                if (n) level = subR(level, mulR(cs, n))
                const mk = sh.into.get(m)!.get(q)
                if (mk) level = addR(level, mulR(cs, mk))
              }
              if (cmpR(level, room) > 0) return false
            }
            return true
          }
        }
        const fits = (s: number) =>
          walked.every((q) => {
            const peak = peakAt(q, s)
            const room = roomOf(q)
            const doubt = LEVEL_DOUBT * walkGross
            if (peak > room + doubt) return false // past the room beyond any rounding
            if (peak <= room - doubt) return true // within it beyond any rounding
            return (exactWalk ??= buildExactWalk())(q, s) // too close: the exact walk decides
          }) // no slack (#471, erratum part 4)
        if (!fits(sMax)) {
          let lo = 0
          let hi = sMax
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2
            if (fits(mid)) lo = mid
            else hi = mid
          }
          bound(lo)
        }
      }
      let s = Number.isFinite(sMax) ? Math.max(0, sMax) : 0
      // `pull all` members fix the number: the group runs at it or not at all
      // (SEMANTICS.md §9; a short one is recorded for the fixpoint).
      const modeOf = (id: string) => ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny')
      let zeroAt: string | null = null // #477 — '' for a short `pull all` Converter, the Gate's id for its own fixed demand
      // the number the targets alone allow: what a `pull all` member must reach
      const targeted = members.some((m) => runTargets?.[m] !== undefined)
      // (`> 0` here too, issue #576: with every Converter left out for a small
      // coefficient the cap came out as "none", and a `pull all` Converter was
      // asked for a whole run where its target allows a half)
      const sCap = targeted ? Math.min(...members.filter((m) => kindOf(m) === 'converter' && (cof.get(m) ?? 0) > 0).map((m) => runOf(m) / cof.get(m)!)) : 1
      if (ruled && lim && limV < sCap * RUN_REACHED) {
        for (const m of members) if (!runLimit.has(m)) runLimit.set(m, { why: lim.why, pool: lim.pool, needed: lim.per * sCap, had: lim.had })
      }
      for (const m of members) {
        if (kindOf(m) !== 'converter' || disabledPullAll.has(m)) continue
        const need = targeted ? Math.min(1, (cof.get(m) ?? 0) * sCap) : 1
        planNeed.set(m, need)
        if (modeOf(m) === 'pullAll' && (cof.get(m) ?? 0) * s < need * RUN_REACHED) {
          pullShort.add(m)
          s = 0
          zeroAt ??= ''
        }
      }
      if (zeroAt !== null) for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, m === zeroAt ? 'pullAll' : 'plan')
      {
        // One working of every amount. The record takes each amount from the exact fractions the
        // search decides on (coefficient × number × rate). The fraction is what is claimed or
        // promised, and what the member takes from its Pools at its turn; the double beside it
        // is that fraction rounded once.
        const sh = exactShapes(members)
        const cofR = sh.coefficients(root, () => true, W)
        const availBefore = new Map<string, bigint>() // what was exactly available in a Pool before this record claimed from it
        const claimIn = (p: string, a: number, r?: Rat) => {
          if (!availBefore.has(p)) availBefore.set(p, availX(p))
          reservedIn.set(p, (reservedIn.get(p) ?? 0) + a)
          claimAddR(p, r ?? ratOfDouble(a))
        }
        const inNeedR = new Map<string, Rat>()
        for (const m of members) {
          if (kindOf(m) === 'gate') continue
          const c = cofR.get(m)
          if (!c) continue
          for (const [p, r] of sh.need.get(m)!) inNeedR.set(p, addR(inNeedR.get(p) ?? RAT0, mulR(c, r)))
        }
        // The group at a number, in exact fractions: what each source Gate pulls (greedy, in the
        // plan's order), and how far every bound is from being passed (a margin below 0 is a
        // bound passed): each Pool's supply, each source Gate's need, and each capped Pool's level
        // at every turn of the commit order against its exact room (a Pool that reads full has none).
        const capped = [...new Set(members.flatMap((m) => [...(sh.into.get(m)?.keys() ?? [])]))].filter((q) => isPool(q) && Number.isFinite(cap(byId.get(q)!))).sort()
        const roomRs = new Map<string, Rat>()
        for (const q of capped) {
          let own = 0n
          for (const m of members) own += toX(ownReserve.get(m)?.get(q) ?? 0)
          const readsFull = own === 0n && (working[q] ?? 0) >= cap(byId.get(q)!)
          // (the room and the supply are read off the exact ledger as they are, not rounded onto
          // the fine unit: a Pool at 8 + 2/3 has a room of exactly a third)
          roomRs.set(q, readsFull ? RAT0 : (roomRatR(q, ownSumR(members, q))!))
        }
        const availRs = new Map<string, Rat>()
        const availR = (p: string): Rat => {
          let v = availRs.get(p)
          if (!v) availRs.set(p, (v = availExactR(p)))
          return v
        }
        // What a source Gate's lines bring covers what the plan gives it with NO slack (with the
        // epsilon here the plan's number stood up to 1e-9 above what the lines bring; the Gate
        // then handed on less than the member behind it was planned on).
        const coverSlack = RAT0
        const handedR = (g: string): Rat => ((inboxR.get(g) ?? RAT0))
        const exactAt = (xR: Rat) => {
          const usedR = new Map<string, Rat>()
          const pulls = new Map<string, { e: LoopEdge; aR: Rat }[]>()
          const margins: Rat[] = []
          for (const g of srcGates) {
            let need = subR(mulR(cofR.get(g) ?? RAT0, xR), handedR(g))
            const list: { e: LoopEdge; aR: Rat }[] = []
            for (const w of wantsOf.get(g)!) {
              if (cmpR(need, coverSlack) <= 0) break
              const pool = w.e.source
              const avail = maxR(RAT0, subR(subR(availR(pool), mulR(xR, inNeedR.get(pool) ?? RAT0)), usedR.get(pool) ?? RAT0))
              const aR = maxR(RAT0, minR(need, minR(exactWant(w.e, w.want), avail)))
              usedR.set(pool, addR(usedR.get(pool) ?? RAT0, aR))
              need = subR(need, aR)
              list.push({ e: w.e, aR })
            }
            pulls.set(g, list)
            margins.push(subR(coverSlack, need)) // the Gate's need is covered
          }
          for (const p of [...inNeedR.keys()].sort()) {
            margins.push(subR(availR(p), mulR(xR, inNeedR.get(p)!))) // the Converters' takes are within the supply
          }
          for (const q of capped) {
            let level = RAT0
            for (const m of inOrder) {
              const cs = mulR(cofR.get(m) ?? RAT0, xR)
              if (kindOf(m) === 'gate') {
                for (const { e, aR } of pulls.get(m) ?? []) if (e.source === q) level = subR(level, aR)
                const w = sh.into.get(m)!.get(q)
                if (w && (W.get(m) ?? 0) > 0) level = addR(level, divR(mulR(cs, w), sh.W.get(m)!))
              } else {
                const n = sh.need.get(m)!.get(q)
                if (n) level = subR(level, mulR(cs, n))
                const mk = sh.into.get(m)!.get(q)
                if (mk) level = addR(level, mulR(cs, mk))
              }
              margins.push(subR(roomRs.get(q)!, level))
            }
          }
          return { pulls, margins }
        }
        const allIn = (ms: Rat[]) => ms.every((x) => cmpR(x, RAT0) >= 0)
        // The number. The search's is a double; where the exact bounds are passed at it, the
        // number is the exact point where the first of them is met, a fraction between the
        // double below and it (the bounds are straight lines over one last place).
        let sR = ratOfDouble(s)
        let exactNumber = false
        if (s > 0) {
          // The number is the largest fraction within every bound. The bounds that are
          // not margins give a cap: a Converter's run (its target, 1 without one) and a source
          // Gate's whole demand, each over the member's exact coefficient. At the cap, or at the
          // exact point below it where the first margin is met.
          let capR: Rat | null = null
          const lower = (v: Rat) => {
            if (capR === null || cmpR(v, capR) < 0) capR = v
          }
          for (const m of members) {
            const c = cofR.get(m)
            if (!c || !isPositive(c)) continue
            if (kindOf(m) !== 'gate') lower(divR(ratOfShortestDecimal(runOf(m)), c))
            else if (srcGates.includes(m)) {
              let d = handedR(m)
              for (const w of wantsOf.get(m)!) d = addR(d, exactWant(w.e, w.want))
              lower(divR(d, c))
            }
          }
          const cap0 = capR as Rat | null
          if (cap0 !== null) {
            if (allIn(exactAt(cap0).margins)) sR = cap0
            else {
              // a number within every bound to start from: the search's double, or a double below it
              let lo = RAT0
              let d = s
              for (let i = 0; i < 64 && d > 0; i++) {
                const x = ratOfDouble(d)
                if (cmpR(x, cap0) <= 0 && allIn(exactAt(x).margins)) {
                  lo = x
                  break
                }
                d = nextTo(d, -1)
              }
              // between that number and the cap: the exact point where the first margin is met
              sR = exactTop(lo, cap0, (x) => exactAt(x).margins, () => {
              })
            }
            exactNumber = true
            // `pull all` source Gates, on the exact number: within the absolute epsilon of what
            // its lines ask, or the group moves nothing
            for (const g of sourceGates) {
              if (modeOf(g.id) !== 'pullAll' || !isPositive(sR)) continue
              let d = handedR(g.id)
              for (const w of wantsOf.get(g.id) ?? []) d = addR(d, exactWant(w.e, w.want))
              if (cmpR(addR(mulR(cofR.get(g.id) ?? RAT0, sR), shortfallAllowedR(d)), d) < 0) {
                sR = RAT0
                s = 0
                zeroAt ??= g.id
              }
            }
            if (!isPositive(sR)) s = 0
            if (zeroAt !== null) for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, m === zeroAt ? 'pullAll' : 'plan')
          }
        }
        if (s > 0 && !exactNumber) {
          const atHi = exactAt(sR).margins
          if (!allIn(atHi)) {
            // the doubles below the search's, one at a time, until one is within every bound (the
            // search's double can be more than one double above the bound); the exact point is
            // then between that double and the one above it
            let loD = nextTo(s, -1)
            let hiD = s
            let stepsDown = 1
            while (stepsDown < 64 && loD > 0 && !allIn(exactAt(ratOfDouble(loD)).margins)) {
              hiD = loD
              loD = nextTo(loD, -1)
              stepsDown++
            }
            const lo = ratOfDouble(loD)
            const hi = ratOfDouble(hiD)
            const atLo = exactAt(lo).margins
            const atHi2 = exactAt(hi).margins
            if (allIn(atLo) && atLo.length === atHi2.length) {
              // The exact point, from the side that is past the bound. A margin is a bent line
              // (flat while a Gate's lines cover it, then falling), so the straight line from
              // the double below to the double above meets zero BELOW the point (a `pull all`
              // Gate was then given a last place less than its lines bring, and stopped).
              // The line through the passed double and a point a sliver below it is the margin's
              // last straight piece; where it meets zero is the point, or still past it and then
              // the next start.
              let best: Rat | null = null
              let from = hi
              let atFrom = atHi2
              const SLIVER = ratOfDouble(2 ** -30)
              for (let round = 0; round < 8 && best === null; round++) {
                const step = mulR(subR(from, lo), SLIVER)
                const near = subR(from, step)
                const atNear = exactAt(near).margins
                let at: Rat | null = null
                for (let i = 0; i < atFrom.length; i++) {
                  if (cmpR(atFrom[i], RAT0) >= 0 || cmpR(atNear[i], atFrom[i]) <= 0) continue
                  const zero = addR(from, divR(mulR(atFrom[i], step), subR(atNear[i], atFrom[i]))) // atFrom < 0: below `from`
                  if (at === null || cmpR(zero, at) < 0) at = zero
                }
                if (at === null || cmpR(at, lo) <= 0) break
                const atAt = exactAt(at).margins
                if (allIn(atAt)) best = at
                else { from = at; atFrom = atAt }
              }
              if (best !== null) {
                sR = best
              } else {
                sR = lo
              }
            }
          }
        }
        const pullsOf = new Map<string, { e: LoopEdge; a: number; r?: Rat }[]>()
        if (s > 0) {
          for (const [g, list] of exactAt(sR).pulls) {
            keepTiny = false
            // (a line keeps its exact amount, and is kept whatever its size)
            pullsOf.set(g, list.map(({ e, aR }) => ({ e, a: nzD(rnR(aR)), r: aR })).filter((x) => x.a > 0 || (isPositive(x.r))))
            keepTiny = false
          }
        }
        for (const m of members) {
          planned.add(m)
          const cs = s > 0 ? mulR(cofR.get(m) ?? RAT0, sR) : RAT0
          keepTiny = false
          const fixedOut = new Map<string, number>()
          planOut.set(m, fixedOut)
          if (kindOf(m) === 'gate') {
            planT.set(m, nz(rnR(cs)))
            const pulls = pullsOf.get(m)
            if (pulls) {
              planPulls.set(m, pulls)
              planPullsSource.add(m)
              for (const { e, a, r } of pulls) claimIn(e.source, a, r)
            }
            const WmR = sh.W.get(m)
            for (const e of liveOuts(m)) {
              if (rateOfCached(e) <= 0 || !WmR || (W.get(m) ?? 0) <= 0) continue
              const xR = divR(mulR(cs, exactRate(e)), WmR)
              const amt = nzD(rnR(xR))
              fixedOut.set(e.id, amt)
              if (promised(amt, xR) && isPool(e.target)) promise(m, e.target, upTo(amt, xR), xR)
            }
            continue
          }
          const fR = minR(RAT1, cs)
          const f = rnR(fR) // (a run fraction is not an amount: the display threshold is not put on it; issue #580)
          planF.set(m, f)
          const takes: { e: LoopEdge; a: number; r?: Rat }[] = []
          for (const e of convPoolIns.get(m)!) {
            const xR = mulR(fR, exactRate(e))
            const a = f > 0 ? nzD(rnR(xR)) : 0
            if (a <= 0 && !(isPositive(xR))) continue
            takes.push({ e, a, r: xR })
            claimIn(e.source, a, xR)
          }
          planTakes.set(m, takes)
          for (const e of liveOuts(m)) {
            if (rateOfCached(e) <= 0) continue
            const xR = mulR(fR, exactRate(e))
            const amt = f > 0 ? nzD(rnR(xR)) : 0
            fixedOut.set(e.id, amt)
            if (promised(amt, xR) && isPool(e.target)) promise(m, e.target, upTo(amt, xR), xR)
          }
        }
        keepTiny = false
        // Does the record, as the doubles it holds, fit the exact ledger? Worked out, not acted on.
        const takeX = new Map<string, bigint>()
        const giveBy = new Map<string, Map<string, bigint>>()
        const takeBy = new Map<string, Map<string, bigint>>()
        const putX = (by: Map<string, Map<string, bigint>>, m: string, q: string, v: number) => {
          let row = by.get(m)
          if (!row) by.set(m, (row = new Map()))
          row.set(q, (row.get(q) ?? 0n) + toX(v))
        }
        for (const m of members) {
          for (const { e, a } of [...(planPulls.get(m) ?? []), ...(planTakes.get(m) ?? [])]) {
            takeX.set(e.source, (takeX.get(e.source) ?? 0n) + toX(a))
            putX(takeBy, m, e.source, a)
          }
          for (const e of liveOuts(m)) if (isPool(e.target)) putX(giveBy, m, e.target, planOut.get(m)?.get(e.id) ?? 0)
        }
        let misfit = ''
        for (const [p, v] of takeX) {
          // the claims just made are in `reservedIn`: what was available before them is `availX + v`
          const had = availBefore.get(p) ?? 0n
          if (v > had) misfit = `supply of ${p}: the record's takes, summed exactly, are ${xNear(v - had)} more than was available (${xNear(had)})`
        }
        if (!misfit) {
          const pools = new Set<string>()
          for (const row of giveBy.values()) for (const q of row.keys()) pools.add(q)
          for (const q of pools) {
            const n = byId.get(q)
            if (!n || !Number.isFinite(cap(n))) continue
            // the room as it stood before this record: capacity − level − what others have reserved
            let mine = 0n
            for (const m of members) for (const e of liveOuts(m)) if (e.target === q) mine += toX(planOut.get(m)?.get(e.id) ?? 0)
            const room = toX(cap(n)) - xLevel(q) - resX(q) + mine
            let level = 0n
            for (const m of inOrder) {
              level -= takeBy.get(m)?.get(q) ?? 0n
              level += giveBy.get(m)?.get(q) ?? 0n
              if (level > room) misfit = `room of ${q} at ${m}'s turn: ${xNear(level - room)} past it`
            }
          }
        }
        return
      }
    }
    // ── #476 — the multi-supply Gate: a fixed priority in the existing order ──
    // (SEMANTICS.md §6 erratum, part 3.) A group with a Gate that has two
    // supplies has one free number per supply beyond the tree's one. Cutting
    // every router → router connection INTO a multi-supply Gate leaves PIECES,
    // each a tree: a piece headed by a multi-supply Gate runs at that Gate's
    // throughput `T = Σ supplies`; a source piece (no Gate at its head) has a
    // number of its own, set through the supply connection it feeds. The
    // supplies of each multi-supply Gate are filled one by one — the Gates in
    // router order; for each, its upstream routers in router order, then its
    // own Pool connections in `(source, edge)` order — every supply to the
    // largest amount that keeps the WHOLE group feasible with the earlier ones
    // fixed and the later ones at zero (closed form without a shared Pool;
    // bisection with one: every claim grows with the supply, so feasibility
    // is monotone in it). The throughput is whatever that order leaves, not a
    // maximum: the order is a contract so the losing supply follows from the
    // model. A `pull all` multi-supply Gate wants its own Pool connections at
    // their amounts (`all` = the Pool's available amount at plan time) and
    // each router supply at what that branch can deliver on its own (its
    // reach, never its connection rate); the plan is that point if it is
    // feasible, else the whole group moves nothing. `pull all` Converters and
    // source Gates keep the tree rule (f = 1 or nothing; the source Gate's
    // demand or nothing). Two multi-supply Gates whose downstreams meet at one
    // Converter share a piece: the Converter's one fraction sets the second
    // Gate's throughput from the first's (`cof · s`), so the first Gate, in
    // order, is filled as above while the second is held to what that leaves
    // it — its supplies, in their order, each up to its own bound, cover
    // exactly the throughput the first Gate implies (`settle`); when they
    // cannot, the first Gate's supply is smaller, and a `pull all` second Gate
    // whose fixed demand is not that throughput zeroes the group (D-fixed).
    // The two loss notices stay as safety nets: a planned group never reaches
    // them.
    //
    // #471 (erratum part 4): a group of Gates only that splits and rejoins is
    // planned here too (`rejoin`). The join has two supplies from one piece,
    // so the piece's paths sum (G-R2); every free number is filled in the
    // same order, `pull all` or not (G-R5); then a `pull all` Gate whose
    // planned throughput is below its fixed demand — its throughput with
    // every entry at its full amount — zeroes the whole group, side exits and
    // entries that never reach it included (G-R6, D-fixed).
    //
    // Every bound below is checked with no slack (#471 review of rev 2): a
    // value the bisection keeps is feasible against the actual availability
    // and room, so the commit never clips a planned amount. A tolerance only
    // classifies a difference already computed (a `pull all` demand met, two
    // supplies covering a throughput).
    const planMulti = (members: string[], multiGates: string[], rejoin = false) => {
      const { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter } = memberShapes(members)
      const multi = new Set(multiGates)
      const byOrder = (a: string, b: string) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity)
      // the pieces: components over the pairs that do not enter a multi-supply Gate
      type Piece = { id: number; members: string[]; head: string | null; root: string; cof: Map<string, number> }
      const pieces: Piece[] = []
      const pieceOf = new Map<string, number>()
      {
        const adj = new Map<string, Set<string>>(members.map((m) => [m, new Set()]))
        for (const key of pair.keys()) {
          const [u, v] = key.split('\u0000')
          if (multi.has(v)) continue
          adj.get(u)!.add(v)
          adj.get(v)!.add(u)
        }
        for (const start of [...members].sort(byOrder)) {
          if (pieceOf.has(start)) continue
          const ms: string[] = []
          const stack = [start]
          pieceOf.set(start, pieces.length)
          while (stack.length) {
            const v = stack.pop()!
            ms.push(v)
            for (const w of adj.get(v)!) if (!pieceOf.has(w)) { pieceOf.set(w, pieces.length); stack.push(w) }
          }
          ms.sort(byOrder)
          const head = ms.find((m) => multi.has(m)) ?? null
          pieces.push({ id: pieces.length, members: ms, head, root: head ?? ms[0], cof: new Map() })
        }
      }
      // coefficients within each piece from its root (c = 1), as the tree plan does
      for (const p of pieces) {
        p.cof.set(p.root, 1)
        for (let changed = true; changed && p.cof.size < p.members.length; ) {
          changed = false
          for (const [key, w] of pair) {
            const [u, v] = key.split('\u0000')
            if (multi.has(v) || pieceOf.get(u) !== p.id || pieceOf.get(v) !== p.id) continue
            const hasU = p.cof.has(u)
            const hasV = p.cof.has(v)
            if (hasU === hasV) continue
            const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
            if (Wu <= 0) continue
            const F = (1 / Wu) * (kindOf(v) === 'gate' ? w : 1)
            if (hasU) p.cof.set(v, p.cof.get(u)! * F)
            else p.cof.set(u, p.cof.get(v)! / F)
            changed = true
          }
        }
      }
      // the supplies of each multi-supply Gate, in the contract order
      type Sup = { kind: 'router'; src: string; piece: number; coef: number } | { kind: 'own'; e: LoopEdge; want: number }
      const supplies = new Map<string, Sup[]>()
      for (const G of multiGates) {
        const list: Sup[] = []
        const ups: { u: string; w: number }[] = []
        for (const [key, w] of pair) {
          const [u, v] = key.split('\u0000')
          if (v === G) ups.push({ u, w })
        }
        ups.sort((a, b) => byOrder(a.u, b.u))
        for (const { u, w } of ups) {
          const p = pieces[pieceOf.get(u)!]
          const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
          const coef = Wu > 0 ? (p.cof.get(u) ?? 0) * (1 / Wu) * w : 0 // the amount on the connection per unit of the piece's number
          list.push({ kind: 'router', src: u, piece: p.id, coef })
        }
        for (const e of ownIns(G)) list.push({ kind: 'own', e, want: Math.max(0, amountOf(e, availOf(e.source), S[e.source] ?? 0)) })
        supplies.set(G, list)
      }
      const orderedMulti = [...multiGates].sort(byOrder)
      const sPiece = new Map<number, number>() // source piece → its number
      type NumR = { d: number; r: Rat }
      const sPieceR = new Map<number, NumR>() // a piece's number as a fraction; it holds while the double beside it is the piece's number
      const uOwnR = new Map<string, NumR>() // the same for an own-Pool supply connection's amount (the record rounds it once)
      /** an own-Pool supply connection's amount, exactly */
      const ownExact = (id: string): Rat => {
        const d = uOwn.get(id) ?? 0
        const x = uOwnR.get(id)
        return x && x.d === d ? x.r : ratOfDouble(d)
      }
      const uOwn = new Map<string, number>() // own-Pool supply connection → its amount
      const fixed = new Set<string>() // the supplies filled so far
      const tentative = new Set<string>() // what `settle` set for a Gate that is not its piece's root; redone on every test
      const keyOf = (sup: Sup) => (sup.kind === 'own' ? `own:${sup.e.id}` : `piece:${sup.piece}`)
      /** every piece's number: a source piece's own; a headed piece's number is the throughput of the Gate at its root (its supplies are all upstream, so earlier in the order) */
      const sOf = (): Map<number, number> => {
        const s = new Map<number, number>()
        for (const p of pieces) if (p.head === null) s.set(p.id, sPiece.get(p.id) ?? 0)
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root !== G) continue
          let T = 0
          for (const sup of supplies.get(G)!) T += sup.kind === 'router' ? sup.coef * (s.get(sup.piece) ?? 0) : (uOwn.get(sup.e.id) ?? 0)
          s.set(p.id, T)
        }
        return s
      }
      /** member → its amount (a Gate's T, a Converter's f) */
      const amountsOf = (s: Map<number, number>) => {
        const c = new Map<string, number>()
        for (const m of members) {
          const p = pieces[pieceOf.get(m)!]
          c.set(m, (p.cof.get(m) ?? 0) * (s.get(p.id) ?? 0))
        }
        return c
      }
      const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v)
      /** Every source Gate's greedy pulls from its own Pools at the plan `c`,
       *  net of the plan's claims and of what the source Gates before it in
       *  the commit order pull; each pull is handed to `onPull`. `false` when
       *  one of them cannot reach its throughput. */
      const sourcePulls = (c: Map<string, number>, claim: Map<string, number>, inOrder: string[], onPull: (gateId: string, pool: string, pulled: number) => void): boolean => {
        const used = new Map<string, number>()
        for (const m of inOrder) {
          if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m)) continue
          const T = c.get(m) ?? 0
          if (T <= 0) continue
          let r = inbox.get(m) ?? 0
          let need = Math.max(0, T - r)
          for (const e of ownIns(m)) {
            const want = amountOf(e, availOf(e.source), S[e.source] ?? 0)
            const avail = xDown(availX(e.source) - toX(claim.get(e.source) ?? 0) - toX(used.get(e.source) ?? 0))
            const a = Math.max(0, Math.min(want, avail))
            r += a
            // what the commit will actually pull from this Pool: up to what is still needed
            const pulled = Math.min(a, need)
            need -= pulled
            add(used, e.source, pulled)
            if (pulled > 0) onPull(m, e.source, pulled)
          }
          if (r < T) return false
        }
        return true
      }
      /** the tree plan's bounds, as a test of the whole group at once */
      const feasible = (): boolean => {
        return evalQ().ok
      }
      // The room walk of `feasible` in exact fractions, from the rates the
      // document states and the plan's numbers as they stand (the fixed ones
      // and the ones `settle` has just set; issue #572). Every Pool the plan
      // delivers into is walked: true when no level passes its room.
      // what the exact walk last worked out: each member's amount, takes and deliveries as fractions
      let lastExact: { amount: (m: string) => Rat; takes: Map<string, Map<string, Rat>>; gives: Map<string, Map<string, Rat>>; pullsE: Map<string, { e: LoopEdge; aR: Rat }[]>; W: Map<string, Rat> } | null = null
      let roomsOffQ = false
      /** a `pull all` source Gate of a piece runs at its demand or not at all (the tree rule) */
      /** every member's exact amount at the plan's numbers as they stand, or null */
      const exactAmounts = (): ((m: string) => Rat) | null => {
        lastExact = null
        evalQ()
        return (lastExact as { amount: (m: string) => Rat } | null)?.amount ?? null
      }
      /** is a `pull all` Gate's amount short of its demand by more than the absolute epsilon? Asked of the exact amount where there is one. */
      const shortOf = (m: string, T: number, demand: number, exact: ((m: string) => Rat) | null): boolean =>
        exact ? cmpR(addR(exact(m), shortfallAllowedR(demandQ(m))), demandQ(m)) < 0 : T < demand - shortfallAllowed(demand)
      const pullAllSourcesOk = (p: Piece): boolean => {
        const c = amountsOf(sOf())
        const exact = exactAmounts()
        for (const m of p.members) {
          if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m) || modeOfRouter(m) !== 'pullAll') continue
          const T = c.get(m) ?? 0
          // (a `pull all` Gate given an amount under the epsilon is asked too: skipped here, it
          // was planned at 1.7e-16 of a demand of 17, stopped at its turn, and the Converter
          // behind it took its own lines' share)
          if (!(T > 0)) continue
          let demand = inbox.get(m) ?? 0
          for (const e of ownIns(m)) demand += amountOf(e, availOf(e.source), S[e.source] ?? 0)
          if (shortOf(m, T, demand, exact)) return false
        }
        return true
      }
      /** a finite upper bound for a source piece's number from its own members (the shared constraints are left to `feasible`) */
      const pieceMax = (p: Piece): number => {
        let hi = Infinity
        for (const m of p.members) {
          const cm = p.cof.get(m) ?? 0
          if (kindOf(m) === 'converter') {
            // `> 0`, as in the tree plan (issue #576): skipped for a Converter
            // whose coefficient is small only because its rates are large, a
            // piece with no other bound had none, was given 0, and the group
            // stood still
            if (cm > 0) hi = Math.min(hi, 1 / cm)
            continue
          }
          if (cm <= 0) continue
          if (!multi.has(m) && !fedByRouter.has(m)) {
            let r = inbox.get(m) ?? 0
            for (const e of ownIns(m)) r += Math.max(0, Math.min(amountOf(e, availOf(e.source), S[e.source] ?? 0), availOf(e.source)))
            hi = Math.min(hi, r / cm)
          }
        }
        return Number.isFinite(hi) ? Math.max(0, hi) : 0
      }
      // ── the multi-supply plan in exact fractions ────────────────────────────
      // Every free number of the plan (a source piece's number, an own line's amount) is a
      // fraction; the double beside it is only its nearest. The settling of a Gate that is not
      // its piece's root, every bound, and the room walk are worked on those fractions with no
      // tolerance, and a number is searched to the exact point where the first bound is met.
      type QParts = { sh: ReturnType<typeof exactShapes>; cofR: Map<number, Map<string, Rat>>; coefR: Map<Sup, Rat>; claimPools: string[]; rooms: [string, Rat][] }
      let qParts: QParts | null = null
      const inOrderQ = [...members].sort(byOrder)
      const availQ = (p: string): Rat => availR(p) // off the exact ledger, as it is
      const handedQ = (m: string): Rat => ((inboxR.get(m) ?? RAT0))
      const partsQ = (): QParts => {
        if (qParts) return qParts
        const sh = exactShapes(members)
        const cofR = new Map<number, Map<string, Rat>>(pieces.map((p) => [p.id, sh.coefficients(p.root, (u, v) => !multi.has(v) && pieceOf.get(u) === p.id && pieceOf.get(v) === p.id, W)]))
        const coefR = new Map<Sup, Rat>()
        const claimSet = new Set<string>()
        for (const G of multiGates) {
          for (const sup of supplies.get(G)!) {
            if (sup.kind !== 'router') {
              claimSet.add(sup.e.source)
              continue
            }
            const u = sup.src
            const live = kindOf(u) !== 'gate' || (W.get(u) ?? 0) > 0
            const Wu = kindOf(u) === 'gate' ? sh.W.get(u)! : RAT1
            const w = sh.pair.get(`${u}\u0000${G}`)
            const c = cofR.get(sup.piece)!.get(u)
            coefR.set(sup, live && w && c ? mulR(mulR(c, divR(RAT1, Wu)), w) : RAT0)
          }
        }
        for (const m of members) if (kindOf(m) !== 'gate') for (const p of sh.need.get(m)!.keys()) claimSet.add(p)
        const rooms: [string, Rat][] = []
        for (const q of [...new Set(members.flatMap((m) => [...(sh.into.get(m)?.keys() ?? [])]))].sort()) {
          if (!isPool(q)) continue
          const n = byId.get(q)!
          if (!Number.isFinite(cap(n))) continue
          let ownX = 0n
          for (const m of members) ownX += toX(ownReserve.get(m)?.get(q) ?? 0)
          const ownQ = ownSumR(members, q)
          rooms.push([q, (ownQ ? !isPositive(ownQ) : ownX === 0n) && (working[q] ?? 0) >= cap(n) ? RAT0 : ownQ ? roomRatR(q, ownQ)! : roomRatX(q, ownX)!])
        }
        return (qParts = { sh, cofR, coefR, claimPools: [...claimSet].sort(), rooms })
      }
      const sExact = (pid: number): Rat => {
        const d = sPiece.get(pid) ?? 0
        const x = sPieceR.get(pid)
        return x && x.d === d ? x.r : ratOfDouble(d)
      }
      const setPieceQ = (pid: number, r: Rat) => {
        const d = rnR(r)
        sPiece.set(pid, d)
        sPieceR.set(pid, { d, r })
      }
      const setOwnQ = (id: string, r: Rat) => {
        const d = rnR(r)
        uOwn.set(id, d)
        uOwnR.set(id, { d, r })
      }
      const valueQ = (sup: Sup): Rat => (sup.kind === 'own' ? ownExact(sup.e.id) : mulR(partsQ().coefR.get(sup)!, sExact(sup.piece)))
      /** every piece's number, exactly (a headed piece: what its root Gate's supplies add up to) */
      const sNowQ = (): Map<number, Rat> => {
        const s = new Map<number, Rat>()
        for (const p of pieces) if (p.head === null) s.set(p.id, sExact(p.id))
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root !== G) continue
          let T = RAT0
          for (const sup of supplies.get(G)!) T = addR(T, sup.kind === 'router' ? mulR(partsQ().coefR.get(sup)!, s.get(sup.piece) ?? RAT0) : ownExact(sup.e.id))
          s.set(p.id, T)
        }
        return s
      }
      /** what a source Gate's lines ask, with what it was handed: its demand, exactly */
      const demandQ = (m: string): Rat => ownIns(m).reduce((t, e) => addR(t, exactWant(e, amountOf(e, availOf(e.source), S[e.source] ?? 0))), handedQ(m))
      const pieceMaxQ = (p: Piece): Rat => {
        const cofP = partsQ().cofR.get(p.id)!
        let hi: Rat | null = null
        for (const m of p.members) {
          const cm = cofP.get(m)
          if (!cm || !isPositive(cm)) continue
          let v: Rat
          if (kindOf(m) === 'converter') v = divR(RAT1, cm)
          else if (!multi.has(m) && !fedByRouter.has(m)) {
            let r = handedQ(m)
            for (const e of ownIns(m)) r = addR(r, maxR(RAT0, minR(exactWant(e, amountOf(e, availOf(e.source), S[e.source] ?? 0)), availQ(e.source))))
            v = divR(r, cm)
          } else continue
          if (hi === null || cmpR(v, hi) < 0) hi = v
        }
        return hi === null ? RAT0 : maxR(RAT0, hi)
      }
      /** The plan at its numbers as they stand: the settling, then every bound as a margin (a
       *  margin under 0 is a bound passed). The list has the same entries in the same order at
       *  every number, so two evaluations can be compared entry by entry. */
      const evalQ = (): { ok: boolean; margins: Rat[] } => {
        const { sh, cofR, coefR, claimPools, rooms } = partsQ()
        const margins: Rat[] = []
        for (const k of tentative) {
          if (fixed.has(k)) continue
          if (k.startsWith('own:')) {
            uOwn.delete(k.slice(4))
            uOwnR.delete(k.slice(4))
          } else {
            sPiece.delete(Number(k.slice(6)))
            sPieceR.delete(Number(k.slice(6)))
          }
        }
        tentative.clear()
        {
          const s0 = sNowQ()
          for (const G of orderedMulti) {
            const p = pieces[pieceOf.get(G)!]
            if (p.root === G) continue
            let need = mulR(cofR.get(p.id)!.get(G) ?? RAT0, s0.get(p.id) ?? RAT0)
            const open: Sup[] = []
            for (const sup of supplies.get(G)!) {
              if (fixed.has(keyOf(sup)) || (sup.kind === 'router' && sPiece.has(sup.piece))) need = subR(need, valueQ(sup))
              else open.push(sup)
            }
            margins.push(need) // what is already fixed for the Gate is within its throughput
            for (const sup of open) {
              const k = keyOf(sup)
              if (tentative.has(k)) continue
              tentative.add(k)
              if (sup.kind === 'own') {
                const v = maxR(RAT0, minR(need, minR(exactWant(sup.e, sup.want), availQ(sup.e.source))))
                setOwnQ(sup.e.id, v)
                need = subR(need, v)
              } else {
                const coef = open.reduce((t, o) => (o.kind === 'router' && o.piece === sup.piece ? addR(t, coefR.get(o)!) : t), RAT0)
                const most = isPositive(coef) ? mulR(coef, pieceMaxQ(pieces[sup.piece])) : RAT0
                const v = maxR(RAT0, minR(need, most))
                setPieceQ(sup.piece, isPositive(coef) ? divR(v, coef) : RAT0)
                need = subR(need, v)
              }
            }
            margins.push(subR(RAT0, maxR(RAT0, need))) // its supplies cover its throughput, exactly
          }
        }
        const s = sNowQ()
        const amount = (m: string): Rat => {
          const pid = pieceOf.get(m)!
          return mulR(cofR.get(pid)!.get(m) ?? RAT0, s.get(pid) ?? RAT0)
        }
        const takes = new Map<string, Map<string, Rat>>()
        const gives = new Map<string, Map<string, Rat>>()
        const claim = new Map<string, Rat>()
        const bump = (by: Map<string, Map<string, Rat>>, m: string, q: string, v: Rat) => {
          let row = by.get(m)
          if (!row) by.set(m, (row = new Map()))
          row.set(q, addR(row.get(q) ?? RAT0, v))
        }
        for (const m of members) {
          const v = amount(m)
          if (kindOf(m) === 'gate') {
            const dead0 = (W.get(m) ?? 0) <= 0
            margins.push(dead0 ? subR(RAT0, v) : RAT0) // a Gate with no live branch moves nothing
            if (dead0 || !isPositive(v)) continue
            for (const [q, w] of sh.into.get(m)!) if (isPool(q)) bump(gives, m, q, divR(mulR(v, w), sh.W.get(m)!))
            continue
          }
          margins.push(subR(RAT1, v)) // a Converter runs once at most
          const cannot = disabledPullAll.has(m) || convMake.get(m)!.size === 0 || inOf(m).some((e) => !isPool(e.source) && !liveEdge(e) && rateOfCached(e) > 0)
          margins.push(cannot ? subR(RAT0, v) : RAT0) // one that cannot run moves nothing
          if (!isPositive(v)) continue
          for (const [p, r] of sh.need.get(m)!) {
            claim.set(p, addR(claim.get(p) ?? RAT0, mulR(v, r)))
            bump(takes, m, p, mulR(v, r))
          }
          for (const [q, mk] of sh.into.get(m)!) if (isPool(q)) bump(gives, m, q, mulR(v, mk))
        }
        for (const G of multiGates) {
          for (const sup of supplies.get(G)!) {
            if (sup.kind !== 'own') continue
            const u = ownExact(sup.e.id)
            margins.push(subR(exactWant(sup.e, sup.want), u)) // an own line within what it asks
            claim.set(sup.e.source, addR(claim.get(sup.e.source) ?? RAT0, u))
            if (isPositive(u)) bump(takes, G, sup.e.source, u)
          }
        }
        const used = new Map<string, Rat>()
        const pullsE = new Map<string, { e: LoopEdge; aR: Rat }[]>()
        for (const m of inOrderQ) {
          if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m)) continue
          let need = maxR(RAT0, subR(amount(m), handedQ(m)))
          for (const e of ownIns(m)) {
            if (!isPositive(need)) break
            const want = exactWant(e, amountOf(e, availOf(e.source), S[e.source] ?? 0))
            const avail = maxR(RAT0, subR(subR(availQ(e.source), claim.get(e.source) ?? RAT0), used.get(e.source) ?? RAT0))
            const pulled = minR(maxR(RAT0, minR(want, avail)), need)
            if (!isPositive(pulled)) continue
            need = subR(need, pulled)
            used.set(e.source, addR(used.get(e.source) ?? RAT0, pulled))
            bump(takes, m, e.source, pulled)
            let list = pullsE.get(m)
            if (!list) pullsE.set(m, (list = []))
            list.push({ e, aR: pulled })
          }
          margins.push(subR(RAT0, need)) // a source Gate's lines bring what the plan gives it
        }
        lastExact = { amount, takes, gives, pullsE, W: sh.W }
        for (const p of claimPools) margins.push(subR(availQ(p), claim.get(p) ?? RAT0)) // the claims on a Pool within what is available
        for (const [q, roomR] of rooms) {
          let level = RAT0
          for (const m of inOrderQ) {
            const t = takes.get(m)?.get(q)
            if (t) level = subR(level, t)
            const g = gives.get(m)?.get(q)
            if (g) level = addR(level, g)
            margins.push(roomsOffQ ? RAT0 : subR(roomR, level)) // the Pool's level at this member's turn within its room (left out while a `pull all` Gate's supplies are filled by what the Pools give)
          }
        }
        return { ok: margins.every((x) => x.num >= 0n), margins }
      }
      /** The largest fraction, 0 to `hiR`, at which the plan stands. From the bound,
       *  down the last straight piece of each margin that is passed, to where the first is met. */
      const largestQ = (setQ: (x: Rat) => void, hiR: Rat, ok: () => boolean): Rat => {
        const at = (x: Rat) => {
          setQ(x)
          return evalQ()
        }
        let best = RAT0
        if (isPositive(hiR)) {
          if (at(hiR).ok) best = hiR
          else if (at(RAT0).ok) best = exactTop(RAT0, hiR, (x) => at(x).margins, () => {})
        }
        at(best)
        if (isPositive(best) && !ok()) {
          // its `pull all` rule sets it to 0
          best = RAT0
          at(best)
        }
        return best
      }
      /** what a multi-supply Gate that is not its piece's root still has to bring (null: it is the root) */
      const stillToCoverQ = (G: string): Rat | null => {
        const p = pieces[pieceOf.get(G)!]
        if (p.root === G) return null
        let need = mulR(partsQ().cofR.get(p.id)!.get(G) ?? RAT0, sNowQ().get(p.id) ?? RAT0)
        for (const sup of supplies.get(G)!) if (fixed.has(keyOf(sup))) need = subR(need, valueQ(sup))
        return maxR(RAT0, need)
      }
      type Item = { sup: Sup; p: Piece | null }
      /** `forG`: the Gate held to a throughput that this supply is filled for (it never brings more than is left of it). The
       *  search is then over values that the later supplies can complete, which is one-sided. Without it the last supply
       *  of a held Gate was searched over "covers the throughput exactly", true at one point only: the bisection ended at
       *  0 unless that point was the bound or the bound over a power of two, and the whole group moved nothing; and an
       *  earlier supply settled the test's tolerance past the throughput, 5.000000001 for 5 (review of 2026-11-15, P1). */
      const fill = (it: Item, forG?: string): number => {
        // What is left of a held Gate's throughput is read before this supply counts as filled.
        const leftQ = forG !== undefined ? stillToCoverQ(forG) : null
        tentative.delete(keyOf(it.sup))
        fixed.add(keyOf(it.sup))
        let v: Rat
        if (it.sup.kind === 'own') {
          const idQ = it.sup.e.id
          let hiQ = minR(exactWant(it.sup.e, it.sup.want), maxR(RAT0, availQ(it.sup.e.source)))
          if (leftQ !== null) hiQ = minR(hiQ, leftQ)
          v = largestQ((x) => setOwnQ(idQ, x), hiQ, () => true)
        } else {
          const pQ = it.p!
          let hiQ = pieceMaxQ(pQ)
          if (leftQ !== null) {
            const pid = it.sup.piece
            const coef = supplies.get(forG!)!.reduce((t, o) => (o.kind === 'router' && o.piece === pid ? addR(t, partsQ().coefR.get(o)!) : t), RAT0)
            hiQ = minR(hiQ, isPositive(coef) ? divR(leftQ, coef) : RAT0)
          }
          v = largestQ((x) => setPieceQ(pQ.id, x), hiQ, () => pullAllSourcesOk(pQ))
        }
        return rnR(v)
      }
      let zero = false
      let zeroAt: string | null = null // #477 — the `pull all` Gate whose fixed demand could not be met
      for (const G of orderedMulti) {
        const items: Item[] = []
        for (const sup of supplies.get(G)!) {
          if (sup.kind === 'router') {
            const p = pieces[sup.piece]
            if (p.head === null) items.push({ sup, p }) // a supply whose piece is already set (`determined`) is skipped below
          } else items.push({ sup, p: null })
        }
        const determined = (it: Item) => it.p !== null && sPiece.has(it.p.id) && !tentative.has(`piece:${it.p.id}`)
        if (!rejoin && modeOfRouter(G) === 'pullAll') {
          // D-demand (the reach reading) and D-fixed
          const reach = items.map((it) => {
            if (it.sup.kind === 'own') return it.sup.want
            if (determined(it)) return NaN
            const v = fill(it)
            sPiece.delete(it.p!.id)
            fixed.delete(keyOf(it.sup))
            return v
          })
          items.forEach((it, i) => {
            if (Number.isNaN(reach[i])) return
            tentative.delete(keyOf(it.sup))
            if (it.sup.kind === 'own') {
              setOwnQ(it.sup.e.id, exactWant(it.sup.e, it.sup.want))
            }
            else sPiece.set(it.p!.id, reach[i])
            fixed.add(keyOf(it.sup))
          })
          let fits = feasible()
          if (!fits) {
            // The turn's `pull all` rule, in the plan. Asked in fractions, "the full reach fits"
            // is exact: a line that writes 0.006 asks 1.5e-19 more than a Pool holding the
            // double 0.011 has left after 0.005, and a supply of 4e-20 of such dust counted
            // twice does not fit either. The group is not stopped for that, where the Gate's
            // turn would run: short of what its lines ask by no more than the absolute epsilon.
            // So: the supplies again, in their order, each as much as fits; what they bring
            // together may be under the full reach by the absolute epsilon and no more.
            const live = items.filter((_, i) => !Number.isNaN(reach[i]))
            const fullOf = live.map((it) => valueQ(it.sup))
            const full = fullOf.reduce((t, x) => addR(t, x), RAT0)
            for (const it of live) {
              if (it.sup.kind === 'own') setOwnQ(it.sup.e.id, RAT0)
              else setPieceQ(it.p!.id, RAT0)
              fixed.delete(keyOf(it.sup))
            }
            for (const it of live) fill(it)
            const brought = live.reduce((t, it) => addR(t, valueQ(it.sup)), RAT0)
            fits = feasible() && cmpR(subR(full, brought), shortfallAllowedR(full)) <= 0
            // The epsilon is for a POOL that holds a hair less than is asked of it, and for
            // nothing else (SEMANTICS-E.md §E12). So of every supply that brings less than its
            // reach it is asked: WITH THE ROOMS LEFT OUT OF THE QUESTION and the other supplies
            // as they stand, could it bring more? If it could, it is the room below that holds
            // it, the fixed demand is not made smaller for that, and the group moves nothing
            // (SEMANTICS.md §6, erratum parts 3 and 9: "moves at exactly that point or not at
            // all", "a net inflow of any size is refused"; the two tests B of
            // fullPoolLoop.test.ts). If it could not, the Pools are what it is short of.
            // Asked instead whether a Pool of the short supply was empty, a piece held down by
            // the room with one of its Pools emptied passed.
            let heldByRoom = ''
            if (fits) {
              live.forEach((it, i) => {
                const had = valueQ(it.sup)
                if (heldByRoom || cmpR(had, fullOf[i]) >= 0) return
                const hadOwn = it.sup.kind === 'own' ? ownExact(it.sup.e.id) : RAT0
                const hadNumber = it.sup.kind === 'own' ? RAT0 : (sNowQ().get(it.p!.id) ?? RAT0)
                roomsOffQ = true
                fill(it)
                roomsOffQ = false
                const could = minR(valueQ(it.sup), fullOf[i])
                if (it.sup.kind === 'own') setOwnQ(it.sup.e.id, hadOwn)
                else setPieceQ(it.p!.id, hadNumber)
                if (cmpR(could, had) > 0) heldByRoom = `${it.sup.kind === 'own' ? `the line ${it.sup.e.id}` : `piece ${it.sup.piece}`} brings ${toDouble(had)} and its Pools could give ${toDouble(could)}`
              })
              if (heldByRoom) fits = false
              else fits = feasible() // the plan's numbers as they stand again
            }
          }
          if (!fits) {
            zero = true
            zeroAt = G
            break
          }
        } else {
          for (const it of items) {
            if (determined(it)) continue
            // a Gate held to a throughput: this supply brings at most what is left of it
            fixed.delete(keyOf(it.sup)) // (not counted as filled while its own room is measured)
            fill(it, G)
          }
        }
      }
      if (!zero && !feasible()) {
        zero = true // the later Gate of a shared piece could not be met exactly
      }
      // A `pull all` source Gate in a piece HEADED by a multi-supply Gate runs
      // at its demand or the group moves nothing (§9; the tree rule, "`pull
      // all` members fix the number"). Only the source pieces were asked, as
      // they were filled; such a Gate under a multi-supply Gate was planned
      // short, dropped at the commit, and the rest of the group moved without
      // it (review of 2026-11-15, P3).
      if (!zero && !rejoin) {
        const c = amountsOf(sOf())
        const exact = exactAmounts()
        for (const p of pieces) {
          if (p.head === null) continue
          for (const m of p.members) {
            if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m) || modeOfRouter(m) !== 'pullAll') continue
            let demand = inbox.get(m) ?? 0
            for (const e of ownIns(m)) demand += amountOf(e, availOf(e.source), S[e.source] ?? 0)
            if (shortOf(m, c.get(m) ?? 0, demand, exact)) {
              zero = true
              zeroAt ??= m
            }
          }
        }
      }
      const failedPullAll = new Set<string>() // G-R6 — every `pull all` Gate of a rejoin whose fixed demand was missed
      if (!zero && rejoin) {
        // the fixed demand: every entry at its full amount (a source piece at
        // its own maximum, an own-Pool connection at min(rate, availability)),
        // through the same coefficients as the plan
        const full = new Map<number, number>()
        for (const p of pieces) if (p.head === null) full.set(p.id, pieceMax(p))
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root !== G) continue
          let T = 0
          // (a `pull all` Gate's own Pool line counts at what it ASKS)
          for (const sup of supplies.get(G)!) T += sup.kind === 'router' ? sup.coef * (full.get(sup.piece) ?? 0) : modeOfRouter(G) === 'pullAll' ? sup.want : Math.min(sup.want, Math.max(0, availOf(sup.e.source)))
          full.set(p.id, T)
        }
        const demand = amountsOf(full)
        const plan = amountsOf(sOf())
        const exactP = exactAmounts()
        // The fixed demand of a Gate with two supplies, in fractions, its two kinds of supply
        // kept apart.
        //   HANDED: what the members before it hand it with every entry at its full amount (a
        //     source piece at the most its own members can run at). That is not a demand of this
        //     Gate's: a Gate passes on what it is handed (issue 572, erratum part 12).
        //   ITS OWN POOL LINES: what they ASK, where the Gate is `pull all`: the rule a Gate's
        //     turn asks of its lines. (Read as what they could bring, a join asking 6 of a Pool
        //     holding 2 was "met" at 2, and a Pool holding nothing asked nothing of it.) A Gate
        //     that is not `pull all` brings what its lines can.
        // Short of the two together by more than the absolute epsilon, the whole group stops.
        let demandR: ((m: string) => Rat) | null = null
        if (exactP) {
          const fullR = new Map<number, Rat>()
          for (const p of pieces) if (p.head === null) fullR.set(p.id, pieceMaxQ(p))
          for (const G of orderedMulti) {
            const p = pieces[pieceOf.get(G)!]
            if (p.root !== G) continue
            let handed = RAT0
            let own = RAT0
            for (const sup of supplies.get(G)!) {
              if (sup.kind === 'router') handed = addR(handed, mulR(partsQ().coefR.get(sup)!, fullR.get(sup.piece) ?? RAT0))
              else {
                const ask = exactWant(sup.e, sup.want)
                own = addR(own, modeOfRouter(G) === 'pullAll' ? ask : minR(ask, maxR(RAT0, availQ(sup.e.source))))
              }
            }
            fullR.set(p.id, addR(handed, own))
          }
          demandR = (m) => mulR(partsQ().cofR.get(pieceOf.get(m)!)?.get(m) ?? RAT0, fullR.get(pieceOf.get(m)!) ?? RAT0)
        }
        for (const m of members) {
          if (kindOf(m) !== 'gate' || modeOfRouter(m) !== 'pullAll') continue
          if (!multi.has(m) && !fedByRouter.has(m)) {
            // A SOURCE Gate's fixed demand is what its lines ASK, the rule its turn
            // asks, and not what they can bring. (Read as what they can bring, a Gate asking 9
            // of Pools that could bring 4 was "met" at 4 and stopped at its turn; and once the
            // fill asked the turn's rule and gave it 0, the group stopped where its Pools held
            // something and ran without it where they held nothing.)
            let demandP = inbox.get(m) ?? 0
            for (const e of ownIns(m)) demandP += amountOf(e, availOf(e.source), S[e.source] ?? 0)
            if (shortOf(m, plan.get(m) ?? 0, demandP, exactP)) failedPullAll.add(m)
            continue
          }
          if (demandR && exactP) {
            const want = demandR(m)
            if (cmpR(addR(exactP(m), shortfallAllowedR(want)), want) < 0) {
              failedPullAll.add(m)
            }
            continue
          }
          if ((plan.get(m) ?? 0) < (demand.get(m) ?? 0) - shortfallAllowed(demand.get(m) ?? 0)) failedPullAll.add(m)
        }
        if (failedPullAll.size) zero = true
      }
      if (!zero) {
        const c = amountsOf(sOf())
        for (const m of members) {
          if (kindOf(m) !== 'converter' || disabledPullAll.has(m) || modeOfRouter(m) !== 'pullAll') continue
          if ((c.get(m) ?? 0) < 1 - EPSILON) { pullShort.add(m); zero = true }
        }
      }
      if (zero) { sPiece.clear(); uOwn.clear(); fixed.clear(); tentative.clear() }
      // #477 — a zeroed group's Gates say why: the `pull all` Gate whose
      // fixed demand failed, `pullAll`; every other Gate of the group, `plan`
      if (zero) for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, m === zeroAt || failedPullAll.has(m) ? 'pullAll' : 'plan')
      // record the plan; claim the inputs (`reservedIn`) and the output room, as the tree plan does
      const c = amountsOf(sOf())
      // what the plan's source Gates pull, held for them until their turns
      // (issue #570): the same greedy pulls `feasible` charged, at the plan as
      // it is recorded, net of the same claims
      {
        const claim = new Map<string, number>()
        for (const m of members) {
          if (kindOf(m) === 'gate') continue
          const f = targetFloored(m) ? 0 : frac(Math.max(0, Math.min(1, c.get(m) ?? 0)))
          if (f <= 0) continue
          for (const [p, r] of convNeed.get(m)!) add(claim, p, f * r)
        }
        for (const G of multiGates) for (const sup of supplies.get(G)!) if (sup.kind === 'own') add(claim, sup.e.source, Math.max(0, uOwn.get(sup.e.id) ?? 0))
        const held = new Map<string, Map<string, number>>()
        const inOrder = [...members].sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity))
        sourcePulls(c, claim, inOrder, (m, q, pulled) => {
          let row = held.get(m)
          if (!row) held.set(m, (row = new Map()))
          row.set(q, (row.get(q) ?? 0) + pulled)
        })
      }
      if (!zero) {
        // One working of every amount of the multi-supply plan. The record takes each amount from
        // the exact fractions the test decided on. The fraction is what is claimed or promised,
        // and what a Gate or a Converter takes from its Pools at its turn; the double beside it
        // is that fraction rounded once.
        evalQ() // the fractions at the plan's final numbers
        type ExR = { amount: (m: string) => Rat; pullsE: Map<string, { e: LoopEdge; aR: Rat }[]>; W: Map<string, Rat> }
        const exR = lastExact as ExR | null
        if (exR) {
          for (const m of members) {
            planned.add(m)
            const aR = exR.amount(m)
            keepTiny = false
            const fixedOut = new Map<string, number>()
            planOut.set(m, fixedOut)
            if (kindOf(m) === 'gate') {
              const T = nz(rnR(aR))
              planT.set(m, T)
              const WmR = exR.W.get(m)
              for (const e of liveOuts(m)) {
                if (rateOfCached(e) <= 0 || !WmR || (W.get(m) ?? 0) <= 0) continue
                const xR = divR(mulR(aR, exactRate(e)), WmR)
                const amt = nzD(rnR(xR))
                fixedOut.set(e.id, amt)
                if (promised(amt, xR) && isPool(e.target)) promise(m, e.target, upTo(amt, xR), xR)
              }
              // (a line keeps its exact amount, and is kept whatever its size)
              const pulls: { e: LoopEdge; a: number; r?: Rat }[] = []
              if (multi.has(m)) {
                for (const sup of supplies.get(m)!) {
                  if (sup.kind !== 'own') continue
                  const xR = ownExact(sup.e.id)
                  const a = nzD(uOwn.get(sup.e.id) ?? 0)
                  if (a > 0 || (isPositive(xR))) pulls.push({ e: sup.e, a, r: xR })
                }
              } else {
                for (const { e, aR: pR } of exR.pullsE.get(m) ?? []) {
                  const a = nzD(rnR(pR))
                  if (a > 0 || (isPositive(pR))) pulls.push({ e, a, r: pR })
                }
              }
              if (multi.has(m) || pulls.length) {
                planPulls.set(m, pulls)
                if (!multi.has(m)) planPullsSource.add(m)
                for (const { e, a, r } of pulls) {
                  reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) + a)
                  claimAddR(e.source, r ?? ratOfDouble(a))
                }
              }
              continue
            }
            const fR = minR(RAT1, aR)
            const f = targetFloored(m) ? 0 : frac(rnR(fR))
            planF.set(m, f)
            const takes: { e: LoopEdge; a: number; r?: Rat }[] = []
            for (const e of convPoolIns.get(m)!) {
              const xR = mulR(fR, exactRate(e))
              const a = f > 0 ? nzD(rnR(xR)) : 0
              if (a <= 0 && !(f > 0 && isPositive(xR))) continue
              takes.push({ e, a, r: xR })
              reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) + a)
              claimAddR(e.source, xR)
            }
            planTakes.set(m, takes)
            for (const e of liveOuts(m)) {
              if (rateOfCached(e) <= 0) continue
              const xR = mulR(fR, exactRate(e))
              const amt = f > 0 ? nzD(rnR(xR)) : 0
              fixedOut.set(e.id, amt)
              if (promised(amt, xR) && isPool(e.target)) promise(m, e.target, upTo(amt, xR), xR)
            }
          }
          keepTiny = false
          return
        }
      }
      for (const m of members) {
        planned.add(m)
        if (kindOf(m) === 'gate') {
          const T = nz(Math.max(0, c.get(m) ?? 0))
          planT.set(m, T)
          const Wm = W.get(m) ?? 1
          for (const [q, w] of gateInto.get(m)!) {
            if (!isPool(q)) continue
            const amt = nz((T * w) / Wm)
            if (amt <= 0) continue
            promise(m, q, amt)
          }
          if (multi.has(m)) {
            const pulls: { e: LoopEdge; a: number }[] = []
            for (const sup of supplies.get(m)!) {
              if (sup.kind !== 'own') continue
              const a = nz(uOwn.get(sup.e.id) ?? 0)
              if (a <= 0) continue
              pulls.push({ e: sup.e, a })
              reservedIn.set(sup.e.source, (reservedIn.get(sup.e.source) ?? 0) + a)
            }
            planPulls.set(m, pulls)
          }
          continue
        }
        const f = targetFloored(m) ? 0 : frac(Math.max(0, Math.min(1, c.get(m) ?? 0)))
        planF.set(m, f)
        const takes: { e: LoopEdge; a: number }[] = []
        for (const e of convPoolIns.get(m)!) {
          const a = nz(f * rateOfCached(e))
          if (a <= 0) continue
          takes.push({ e, a })
          reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) + a)
        }
        planTakes.set(m, takes)
        for (const [q, make] of convMake.get(m)!) {
          if (!isPool(q)) continue
          const amt = nz(f * make)
          if (amt <= 0) continue
          promise(m, q, amt)
        }
      }
    }
    const multiLoss = new Set<string>() // Converters whose D1 diagnostic is out this pass

    for (const id of order) {
      const n = byId.get(id)!
      activated.add(id)
      const k = n.data.kind
      const accept = makeAccept()
      const group = treeAtRoot.get(id)
      const mg = multiAtRoot.get(id)
      // #477 — the plan-free numbers are read BEFORE the plan claims anything;
      // a group with a `pull all` Converter the fixpoint disabled runs that
      // piece at nothing, so its Gates that move nothing say `plan`
      // (a disabled `pull all` Converter's connections are never read on the
      // committed pass — a random flow only it consumes raises no diagnostic)
      const isDisabledConverter = (m: string) => kindOf(m) === 'converter' && disabledPullAll.has(m)
      if (!isDisabledConverter(id)) numsOf(id)
      const members = group ?? mg?.members ?? []
      for (const m of members) if (!isDisabledConverter(m)) numsOf(m)
      if (members.some((m) => kindOf(m) === 'converter' && disabledPullAll.has(m)))
        for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, 'plan')
      if (group) planGroup(group)
      if (mg) planMulti(mg.members, mg.multiGates, mg.rejoin)
      releaseHold(id) // a planned source Gate at its own turn: what was held for it is its to pull (issue #570)

      if (k === 'drain' || k === 'end') {
        // a terminal consumes what a router handed it: the entry is cleared, or
        // the held-amount sweep at the end of the pass would report a Drain's
        // intake as a loss (#471 review 3 — the visual matrix fixture's Gate
        // hands its Drain 999 999 and the phone run bar grew a notice row)
        let got = inbox.get(id) ?? 0
        inbox.set(id, 0)
        const ins = inOf(id)
          .filter((e) => isPool(e.source) && !dead.has(e.id))
          .sort(cmpEdge)
        const mode = (n.data as { mode?: 'pullAny' | 'pullAll' }).mode ?? 'pullAny'
        const wants = ins.map((e) => ({
          e,
          want: amountOf(e, availOf(e.source), S[e.source] ?? 0),
        }))
        // `pull all`: every line in full or nothing (§9), and lines off one
        // Pool are asked of it TOGETHER. Asked one by one, two "5" lines off a
        // Pool of 8 both passed: the events said 5 + 5 while the Pool lost 8
        // (review of 2026-11-15, E3).
        const from = new Map<string, number>()
        for (const w of wants) from.set(w.e.source, (from.get(w.e.source) ?? 0) + Math.max(0, w.want))
        const asked = [...from.values()].reduce((a, b) => a + b, 0) // all the node asks: what its allowance is measured by
        const feasible =
          mode === 'pullAll' ? [...from].every(([p, want]) => availOf(p) >= want - shortfallAllowed(asked)) : true
        if (feasible) {
          for (const w of wants) {
            // Each line takes what it asks or, where its Pool is short, what the Pool still
            // holds: a `pull all` node that runs short within its allowance as well
            // (SEMANTICS-E.md §E11b). It took all it asked, and the record took the Pool under 0.
            const a = nzPool(Math.max(0, Math.min(w.want, availOf(w.e.source))))
            if (a > 0) {
              takeFrom(w.e.source, a)
              got += a
              emit(w.e, w.e.source, id, a)
            }
          }
        }
        if (got > 0) {
          fired.add(id)
          if (k === 'end') ended = true
        }
        continue
      }

      if (k === 'gate') {
        const mode = n.data.mode ?? 'pullAny'
        const probabilistic = isProbGate(n)
        // invalid / zero-sum weights ⇒ the gate is inert this step (diagnostic
        // already pushed by pickBranch); do not touch the input pools.
        if (cyclicSet.has(id)) {
          recordGate(id, 0, 'cycle') // every connection of a router on a zero-storage cycle is dead
          continue
        }
        const sel = probabilistic ? pickBranch(n) : null
        if (probabilistic && !sel) {
          recordGate(id, 0, 'inert')
          continue
        }

        let T: number
        let fromInR: Rat = RAT0
        let TR: Rat = RAT0 // exactly what came into the Gate this turn, and what it hands on
        let sizeR: Rat | null = null // the most a Gate outside every plan may move, exactly (null: no bound)
        let sizedN = false
        const plPulls = planPulls.get(id)
        if (plPulls !== undefined) {
          // #476 — a multi-supply Gate moves exactly its plan: the inbox (its
          // router supplies, delivered at the plan) plus the own-Pool amounts
          // the plan claimed at the group's first router, released here. The
          // plan already applied `pull all` (the point or nothing), so the
          // demand test below does not run again on the Pool net of the claim.
          let got = inbox.get(id) ?? 0
          if (planPullsSource.has(id) && mode === 'pullAll') {
            // A source Gate keeps its own `pull all` test: what its record brings against what
            // its lines ask (the plan's number can be less than the demand). Short of it by more
            // than the absolute epsilon, it takes nothing: the record's claims are given back.
            let demandP = got
            for (const e of inOf(id)) if (isPool(e.source) && !dead.has(e.id)) demandP += amountOf(e, availOf(e.source) + (plPulls.find((x) => x.e.id === e.id)?.a ?? 0), S[e.source] ?? 0)
            // the test is on the exact amounts
            let shortB = false
            let askR = RAT0
            for (const e of inOf(id)) if (isPool(e.source) && !dead.has(e.id)) askR = addR(askR, exactWant(e, amountOf(e, availOf(e.source) + (plPulls.find((x) => x.e.id === e.id)?.a ?? 0), S[e.source] ?? 0)))
            const bringR = plPulls.reduce((t, x) => addR(t, x.r ?? ratOfDouble(x.a)), RAT0)
            shortB = cmpR(subR(askR, bringR), shortfallAllowedR(askR)) > 0
            if (shortB) {
              for (const { e, a, r } of plPulls) {
                reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) - a)
                claimSubR(e.source, r ?? ratOfDouble(a))
              }
              recordGate(id, 0)
              continue
            }
          }
          inbox.set(id, 0)
          TR = inboxR.get(id) ?? RAT0
          inboxR.set(id, RAT0)
          for (const { e, a, r } of plPulls) {
            const x = r ?? ratOfDouble(a)
            reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) - a)
            claimSubR(e.source, x)
            takeFrom(e.source, a, x)
            got += a
            TR = addR(TR, x)
            emit(e, e.source, id, a, x)
          }
          T = nz(Math.max(0, got))
          if (!isPositive(TR)) {
            recordGate(id, 0)
            continue
          }
        } else {
          let inb = inbox.get(id) ?? 0
          const ins = inOf(id)
            .filter((e) => isPool(e.source) && !dead.has(e.id))
            .sort(cmpEdge)
          let demand = inb
          let inputAvail = inb
          // What the Pool lines can bring: each line up to its OWN amount, and
          // lines off one Pool share what that Pool holds, in their order
          // (the pull below takes them the same way). It used to be the SUM
          // of the whole Pools, once per line: a Gate on Pool A = 100 and
          // Pool B = 0, "5" from each, sized T = 10, pulled 5 (each pull is
          // capped by its line) and still passed 10 on: 5 units from nowhere,
          // with no notice (review of 2026-11-15, E1). The planned groups
          // (`reach`) and the Gate's own evidence (`numsOf`) already bound a
          // supply per line.
          const claimed = new Map<string, number>()
          let askX = 0n // what the Pool lines ask, and what they can bring, summed exactly
          let bringX = 0n
          const wants = ins.map((e) => {
            const w = amountOf(e, availOf(e.source), S[e.source] ?? 0)
            demand += w
            const before = claimed.get(e.source) ?? 0
            const have = Math.max(0, Math.min(w, availOf(e.source) - before))
            claimed.set(e.source, before + have)
            inputAvail += have
            askX += toX(w)
            bringX += toX(have)
            return { e, want: w }
          })

          // a planned Gate moves exactly its plan's throughput (#471 Deploy 2);
          // for a Gate fed by a member the inbox IS that amount
          const plT = planT.get(id)
          // A planned Gate with no Pool line of its own is fed by another
          // member of its group: it passes on WHAT IT WAS HANDED, and its
          // `pull all` is not asked a second time (issue #572; SEMANTICS.md §6
          // erratum, part 12). The plan's number for it and what the member
          // before it hands over are one amount worked out in two orders,
          // `((1 / W) · w) · T` and `(T · w) / W`, and they can differ in the
          // last place. Taking the least of the two left that last place in the
          // inbox, which is emptied at the end of the step (I5: no router holds
          // anything between steps); and `pull all`, asked between the two
          // workings, moved nothing once the amounts were large enough for one
          // last place to pass epsilon (3.5e9 handed over, 0 passed on).
          // The plan has already decided what the group moves, `pull all`
          // members included; nothing is left for this Gate to refuse.
          const handed = (plT !== undefined || (inb > 0)) && ins.length === 0
          // the display threshold is for what is SHOWN, not for what moves: a throughput under it is not made 0
          const nzT = (v: number) => v
          T = handed
            ? nzT(Math.max(0, inb))
            : plT !== undefined
              ? nzT(Math.max(0, Math.min(plT, demand, inputAvail)))
              : Math.max(0, Math.min(demand, inputAvail))
          // `pull all` is asked below, once, on the exact amounts the lines would bring
          if (T <= 0) {
            recordGate(id, 0)
            continue
          }

          if (plT === undefined && !handed) {
            // A Gate outside every plan, with Pool lines of its own. What it hands on is followed
            // in exact shares, through the Gates below that only pass on, to the Pools it ends
            // in: each Pool gets a fixed part of the throughput. The most the Gate may move is
            // then the least of `room / part` over those Pools (the exact room; a Pool that
            // reads full has none) and of `accept / part` over the targets that are not followed.
            // A division; no walk down the doubles, and no share a part of a last place past the room.
            const partPool = new Map<string, Rat>()
            const partOther = new Map<string, Rat>()
            const blocked = !spreadExact(id, RAT1, 0, partPool, partOther, probabilistic ? sel : undefined)
            const least = (v: Rat) => {
              if (sizeR === null || cmpR(v, sizeR) < 0) sizeR = v
            }
            // (A Gate that was also HANDED something is sized here too. What it was handed was
            // promised downstream, exactly, in these same shares, when it was handed: it passes
            // all of that on, and what its own lines may add is what the Pools' rooms hold beyond
            // every promise.)
            const handedR = inb > 0 ? (inboxR.get(id) ?? RAT0) : RAT0
            if (blocked) least(RAT0)
            for (const [q, part] of partPool) {
              const c0 = cap(byId.get(q)!)
              if (!Number.isFinite(c0)) continue
              const room = (working[q] ?? 0) >= c0 ? RAT0 : maxR(RAT0, roomRat(q)!) // a Pool that reads full has no room
              least(addR(handedR, divR(room, part)))
            }
            for (const [t, part] of partOther) {
              const a = accept(t)
              if (Number.isFinite(a)) {
                least(divR(ratOfDouble(Math.max(0, a)), part))
              }
            }
            sizedN = true
            if (sizeR !== null && !isPositive(sizeR)) {
              recordGate(id, 0)
              continue
            }
          } else if (plT === undefined && inb === 0) {
            // A root: everything this Gate moves comes off its own Pool lines. It
            // follows what it would hand on, through the Gates below with their own split, to the
            // Pools it ends in, and sums it per Pool exactly against that Pool's exact room. Where
            // it does not fit, the throughput goes down a double at a time until it does.
            const fitsAt = (Tq: number, skip = 0): boolean => {
              const need = new Map<string, bigint>()
              if (!followDown(id, Tq, 0, need, accept, skip)) return false
              for (const [q, b] of need) {
                const r = roomX(q)
                if (r !== null && b > r) return false
              }
              return true
            }
            let downs = 0
            // at each throughput, the leftover of the split is tried on each share in turn: a split that fits is taken
            const branches = probabilistic ? 1 : Math.max(1, outOf(id).filter((e) => !skipDet(e.id)).length)
            const fitsSome = (Tq: number): boolean => {
              for (let k = 0; k < branches; k++) {
                if (fitsAt(Tq, k)) {
                  return true
                }
              }
              return false
            }
            while (T > EPSILON && downs < 64 && !fitsSome(T)) {
              T = nextTo(T, -1)
              downs++
            }
            if (downs >= 64 && !fitsSome(T)) T = 0
            if (T <= 0) {
              recordGate(id, 0)
              continue
            }
          }

          // consume inbox first, then pull the rest from pools in (source, edge) order
          let need = T
          const fromInbox = Math.min(need, inb)
          need -= fromInbox
          // What the Gate moves, exactly. Of what it was handed: all of it, where the
          // throughput takes all of it. Of its Pool lines: each up to its own exact amount and to
          // what its Pool exactly holds, in their order. The throughput found above (a double)
          // bounds the sum only where something other than the lines' own amounts and supplies
          // made it smaller (what the targets accept, the root's sizing); otherwise the lines
          // bring what they ask, and the sum need not be a double. `pull all` is asked here, on
          // these amounts, before anything moves: short of what the lines ask by more than the
          // absolute epsilon, the Gate takes nothing.
          const inR = inboxR.get(id) ?? RAT0
          // (a Gate sized exactly passes on all it was handed, up to its exact size)
          const fromInboxR = sizedN ? (sizeR !== null ? minR(inR, sizeR) : inR) : fromInbox >= inb ? inR : minR(inR, ratOfDouble(fromInbox))
          let bound = handed || T < Math.min(demand, inputAvail) ? maxR(RAT0, subR(ratOfDouble(T), fromInboxR)) : null
          if (sizedN && sizeR !== null) {
            const left = maxR(RAT0, subR(sizeR, fromInboxR))
            bound = bound === null ? left : minR(bound, left)
          }
          let leftR = handed ? RAT0 : bound
          const dry = new Map<string, Rat>()
          const pullsB: { e: LoopEdge; x: Rat }[] = []
          let askR = inR
          let bringR = fromInboxR
          for (const w of wants) {
            const wantR = exactWant(w.e, w.want)
            askR = addR(askR, wantR)
            const have = maxR(RAT0, subR(availR(w.e.source), dry.get(w.e.source) ?? RAT0))
            let x = minR(have, wantR)
            if (leftR !== null) x = minR(x, leftR)
            if (!isPositive(x)) continue
            pullsB.push({ e: w.e, x })
            dry.set(w.e.source, addR(dry.get(w.e.source) ?? RAT0, x))
            bringR = addR(bringR, x)
            if (leftR !== null) leftR = subR(leftR, x)
          }
          if (mode === 'pullAll' && !handed && cmpR(subR(askR, bringR), shortfallAllowedR(askR)) > 0) {
            recordGate(id, 0)
            continue
          }
          const liveW = probabilistic || outOf(id).some((e) => !skipDet(e.id) && rateOfCached(e) > 0)
          if (!isPositive(bringR) || !liveW) {
            recordGate(id, 0)
            continue
          }
          inbox.set(id, sizedN ? rnR(subR(inR, fromInboxR)) : inb - fromInbox)
          inb -= fromInbox
          inboxR.set(id, subR(inR, fromInboxR))
          fromInR = fromInboxR
          for (const { e, x } of pullsB) {
            const a = rnR(x)
            takeFrom(e.source, a, x)
            emit(e, e.source, id, a, x)
          }
          TR = bringR
          T = rnR(TR)
        }

        // The Gate hands on exactly what came in, split exactly by its weights (a probabilistic
        // Gate: all of it down the one branch). No share is rounded: lines in less lines out
        // is 0.
        const outsB = probabilistic ? [sel!] : outOf(id).filter((e) => !skipDet(e.id))
        const wB = outsB.map((e) => (probabilistic ? RAT1 : exactRate(e)))
        const WB = wB.reduce((t, w) => addR(t, w), RAT0)
        T = rnR(TR)
        for (const [i, e] of outsB.entries()) {
          const xR = isPositive(WB) ? divR(mulR(TR, wB[i]), WB) : RAT0
          if (!isPositive(xR)) continue
          const share = rnR(xR)
          if (isPool(e.target)) {
            settleR(id, e.target, xR)
            moveLevel(e.target, share, xR)
          } else {
            inbox.set(e.target, (inbox.get(e.target) ?? 0) + share)
            // the part of this share that the Gate's own lines brought (the rest was promised when it was handed)
            if (!planned.has(e.target) && cmpR(TR, fromInR) > 0) planReserveR(e.target, divR(mulR(xR, subR(TR, fromInR)), TR))
          }
          emit(e, id, e.target, share, xR)
        }
        fired.add(id)
        recordGate(id, T)
        continue
      }

      if (k === 'converter') {
        // A `pullAll` Converter the fixpoint has already disabled moves nothing
        // — skip it before any edge is read, so its flows are not evaluated on
        // the committed pass (a diagnostic from a branch only this Converter
        // would have consumed must not surface). A refused rate on one of its
        // own connections (#396, #471 item 5) is a fact of the connection, not
        // of this step's branches, and is still reported.
        if (disabledPullAll.has(id)) {
          for (const e of [...inOf(id), ...outOf(id)]) if (isRefusedRate(e)) refusedRate(e)
          continue
        }
        const mode = n.data.mode ?? 'pullAny'
        const inboxHave = inbox.get(id) ?? 0
        // pool-fed inputs: pull up to the per-activation rate
        const poolIns = inOf(id)
          .filter((e) => isPool(e.source) && !dead.has(e.id))
          .sort(cmpEdge)
        const sumIn = sumInRate(id)
        const own = ownReserve.get(id)

        // the outputs at `f`: into a Pool, settling only the reservation made
        // for THIS Converter (#388 C — releasing the Pool's total let a
        // pool-fed Converter free another router's promise); into a router,
        // an INBOX (#388 D — `working` is summed over Pools only at commit)
        // with its room reserved downstream, unless the target is a member of
        // a planned group, whose room the plan already holds.
        const deliver = (f: number, took = true, fR?: Rat) => {
          if (fR !== undefined) {
            // one exact fraction on every output: `fR · rate`, the rate as it is read
            let madeB = false
            for (const e of outOf(id)) {
              if (skipDet(e.id) || rateOfCached(e) <= 0) continue
              const xR = mulR(fR, exactRate(e))
              if (!isPositive(xR)) continue
              madeB = true
              const q = rnR(xR)
              const up = upTo(q, xR)
              if (isPool(e.target)) {
                settleR(id, e.target, xR)
                moveLevel(e.target, q, xR)
              } else {
                inbox.set(e.target, (inbox.get(e.target) ?? 0) + q)
                if (!planned.has(e.target)) planReserve(e.target, up, xR)
              }
              emit(e, id, e.target, q, xR)
            }
            if (madeB || took) fired.add(id)
            return
          }
          // a planned Converter makes the amounts its plan recorded, when it runs at the plan's
          // fraction (to within rounding); one that received less runs at what it received
          const plannedOut = planOut.get(id)
          const plFv = planF.get(id) ?? 0
          const recordedOut = plannedOut && Math.abs(f - plFv) <= 8 * Number.EPSILON * Math.max(f, plFv) ? plannedOut : undefined
          let made = false
          for (const e of outOf(id)) {
            if (skipDet(e.id)) continue
            const q = recordedOut ? (recordedOut.get(e.id) ?? 0) : nz(f * rateOfCached(e))
            if (q <= 0) continue
            made = true
            if (isPool(e.target)) {
              const held = Math.min(q, own?.get(e.target) ?? 0)
              if (held > 0) {
                reserveSub(e.target, held)
                own!.set(e.target, own!.get(e.target)! - held)
              }
              moveLevel(e.target, q)
            } else {
              inbox.set(e.target, (inbox.get(e.target) ?? 0) + q)
              if (!planned.has(e.target)) planReserve(e.target, q)
            }
            emit(e, id, e.target, q)
          }
          // (issue #580: a fraction is not tested against the display threshold, so a Converter
          // whose every amount is under it has moved nothing here and has not fired)
          if (made || took) fired.add(id)
        }

        // #471 Deploy 2 — a member of a planned tree group runs at the plan's
        // fraction: it takes exactly the Pool amounts the plan claimed at the
        // group's first router (releasing that claim), its upstream members
        // delivered exactly `f · rate`, and it makes `f · rate` on every output.
        const plF = planF.get(id)
        if (plF !== undefined) {
          let received = inboxHave
          inbox.set(id, 0)
          let receivedR = inboxR.get(id) ?? RAT0 // exactly what arrived
          inboxR.set(id, RAT0)
          for (const { e, a, r } of planTakes.get(id) ?? []) {
            const x = r ?? ratOfDouble(a)
            reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) - a)
            claimSubR(e.source, x)
            takeFrom(e.source, a, x)
            received += a
            receivedR = addR(receivedR, x)
            emit(e, e.source, id, a, x)
          }
          // The fraction is what arrived over what a full run takes, exactly (the
          // members before it delivered at the plan's fraction, and so did its own takes)
          const sumInR = inOf(id).reduce((t, e) => (rateOfCached(e) > 0 ? addR(t, exactRate(e)) : t), RAT0)
          // the plan's f, bounded by what arrived (equal, up to rounding). What arrived is read
          // off the exact amounts: the doubles beside them are 0 for an amount under the display
          // threshold, and a `pull all` Converter whose amounts are that small read "nothing
          // arrived" and stopped its group (SEMANTICS-E.md §E19: a part of a run is not an amount)
          let f = isPositive(sumInR) ? Math.min(plF, rnR(divR(receivedR, sumInR))) : 0
          f = frac(Math.max(0, Math.min(1, f)))
          if (mode === 'pullAll' && f < (planNeed.get(id) ?? 1) * RUN_REACHED) {
            pullShort.add(id)
            f = 0
          }
          // (`f`, the double, only carries the `pull all` verdict above here: what arrived is
          // the ledger's, whatever its size, and the Converter runs on it)
          const stopped = mode === 'pullAll' && f === 0
          const fR = !stopped && isPositive(sumInR) ? minR(RAT1, divR(receivedR, sumInR)) : RAT0
          if (!isPositive(fR) || targetFloored(id)) continue
          deliver(rnR(fR), isPositive(receivedR), fR)
          continue
        }

        // Not planned: either every input is a Pool (the revision-1 rule below),
        // or a router input delivers nothing this step — its router does not
        // fire, the connection is dead, or a probabilistic Gate picked another
        // branch — and one f on every connection (I2) is then 0: the Converter
        // does not run from its Pools alone (the "half a batch" defect, V2).
        // Or it is a member of a MULTI group (a live router input), which
        // keeps the rule it had (unresolved; #471 stays open).
        const routerIns = inOf(id).filter((e) => !isPool(e.source) && !dead.has(e.id) && rateOfCached(e) > 0)
        const routerFed = routerIns.some((e) => liveEdge(e))
        if (!routerFed && inOf(id).some((e) => !isPool(e.source) && rateOfCached(e) > 0)) {
          if (mode === 'pullAll') pullShort.add(id)
          continue
        }

        // #471 — plan, then commit (SEMANTICS.md §6 erratum; I2 / I4). The run
        // fraction is decided from the ledgers BEFORE anything is taken, and
        // every connection then moves exactly its share of it. The old order,
        // "pull what each input has, sum it, then divide", did three things
        // wrong (all measured in #471):
        //   V1  the output room was short, and the inputs were still taken in
        //       full — the difference vanished;
        //   V2  one input was short, the others were taken in full and summed,
        //       so no single f held per connection;
        //   V3  two outputs went into one capped Pool, each saw the Pool's
        //       whole room, and the commit clamp cut the excess unreported.
        // Inputs are grouped by source Pool and outputs by target (Pool or
        // router), so two connections off one Pool, or into one target, share
        // its availability or room (SEMANTICS.md §9 keeps the `pull all` rule:
        // f < 1 ⇒ nothing moves — a probe pass records it in `pullShort`).
        //
        // Pool side: for each source Pool P, `avail_P / Σ rate from P`.
        const needFrom = new Map<string, number>()
        for (const e of poolIns) {
          const r = rateOfCached(e)
          if (r <= 0) continue
          needFrom.set(e.source, (needFrom.get(e.source) ?? 0) + r)
        }
        let fPool = 1
        for (const [p, need] of needFrom) fPool = Math.min(fPool, availOf(p) / need)
        fPool = Math.max(0, fPool)
        let sumInPool = 0
        for (const need of needFrom.values()) sumInPool += need
        // Output side: for each target Q, `room_Q / Σ rate into Q` — a Pool's
        // headroom plus this Converter's own reservation there (so it is not
        // blocked by itself; #388 B/C), a router's live `accept` (#388 D — a
        // router's `headroom` is unbounded, and sizing by it handed a blocked
        // Gate an inbox it could not deliver). A Pool that is both an input
        // and an output of this Converter is bounded on the NET amount,
        // `room / (make − need)`: the take and the make happen inside one
        // activation, so what it takes is room it may fill, while what it
        // takes is bounded on the Pool as it stands (#471 item 5, Lumi
        // 2026-11-03 — the one-Converter case of the rule that a Pool's room
        // is checked along the plan unit's commit order).
        const makeInto = new Map<string, number>()
        for (const e of outOf(id)) {
          if (skipDet(e.id)) continue
          const r = rateOfCached(e)
          if (r <= 0) continue
          makeInto.set(e.target, (makeInto.get(e.target) ?? 0) + r)
        }
        // This Converter's net make into Pool `q` a run, where it is ABOVE 0, else 0. A net above
        // 0 asks the Pool's room whatever its size (SEMANTICS-E.md §E14): asked only above the
        // epsilon, a Converter that made 7e-12 a run into a Pool at its capacity was not held,
        // took its inputs, and what it made was gone. The sign is read off the rates as
        // fractions, so that rates that balance as they are written (0.3 taken, 0.1 and 0.2
        // made) are not a net by the rounding of their doubles.
        const netInto = (q: string, net: number): number => {
          let r = RAT0
          for (const e of outOf(id)) if (!skipDet(e.id) && e.target === q && rateOfCached(e) > 0) r = addR(r, exactRate(e))
          for (const e of poolIns) if (e.source === q && rateOfCached(e) > 0) r = subR(r, exactRate(e))
          return isPositive(r) ? (net > 0 ? net : toDouble(r)) : 0
        }
        let fOut = makeInto.size > 0 ? 1 : 0 // #388 D — no live output, no run
        for (const [q, make] of makeInto) {
          if (isPool(q)) {
            const net = netInto(q, make - (needFrom.get(q) ?? 0))
            if (net > 0) fOut = Math.min(fOut, (headroom(q) + (own?.get(q) ?? 0)) / net)
          } else fOut = Math.min(fOut, accept(q) / make)
        }
        fOut = Math.min(fOut, sharedPoolBound(makeInto, own, needFrom)) // #492 — a Pool reached by two paths

        // §M6-5 — the tightest limit below the target, for the report
        if (ruled && !runLimit.has(id)) {
          const T = runOf(id)
          let v = T
          let rec: RunLimit | null = null
          for (const [p, need] of needFrom) {
            const x = availOf(p) / need
            if (x < v * RUN_REACHED) {
              v = x
              rec = { why: 'supply', pool: p, needed: T * need, had: availOf(p) }
            }
          }
          for (const [q, make] of makeInto) {
            if (!isPool(q)) continue
            const net = netInto(q, make - (needFrom.get(q) ?? 0))
            if (!(net > 0)) continue
            const room = headroom(q) + (own?.get(q) ?? 0)
            const x = room / net
            if (x < v * RUN_REACHED) {
              v = x
              rec = { why: 'room', pool: q, needed: T * net, had: room }
            }
          }
          if (rec) runLimit.set(id, rec)
        }

        // the fraction, before anything moves — `pull all` is decided on it
        let fDry = sumIn > 0 ? (inboxHave + fPool * sumInPool) / sumIn : 0
        fDry = frac(Math.max(0, Math.min(runOf(id), fDry, fOut)))
        if (mode === 'pullAll' && fDry < runOf(id) * RUN_REACHED) {
          pullShort.add(id) // probe pass: this pullAll Converter cannot reach f = 1
          continue
        }
        if (fracGone(fDry) || targetFloored(id)) continue

        // What each Pool connection moves. A Converter fed from Pools only:
        // exactly `f · rate` on every one of them (I2). A router-fed Converter
        // outside every plan (no classified group reaches this since #476; the
        // safety net behind the loss notice): the upstream routers already
        // delivered at THEIR fraction, which this step cannot undo; its Pool
        // side keeps the rule it had, `fPool · rate`, the production below
        // follows what was received, so nothing is created, and what was
        // received above what it could use is reported (D1).
        const fTake = routerFed ? fPool : fDry
        {
          // The run in exact fractions. No Pool gives more than it holds (a Pool holding the
          // double 0.3 cannot give the 0.3 a line writes, which is 1.1e-17 more), and what it
          // makes on balance into a capped Pool is within that Pool's exact room. Then every
          // line moves `fR · rate`.
          // (The Converter outside a plan with a line from a node that is not a Pool, in
          // practice a Source's, which delivers nothing: its Pool side is `what a Pool holds / what
          // it takes of it`, exactly, as for the Converter fed from Pools only. As the double of
          // that division, 1/3 took 1 - 2^-54 of a Pool holding 1 and left the rest step after step.)
          let fR = routerFed ? RAT1 : ratOfDouble(fTake)
          const viaPool = new Map<string, Rat>() // Pool → what reaches it through Gates that pass on, per run
          const viaOther = new Map<string, Rat>()
          if (!routerFed) {
            // From its run target, exactly. What it hands a Gate that only passes on is followed
            // in exact shares to the Pools it ends in (their room is asked below with the Pools
            // it makes into itself); a target that is not followed bounds it by what it accepts,
            // a double the engine holds.
            fR = ratOfShortestDecimal(runOf(id))
            for (const e of outOf(id)) {
              if (skipDet(e.id) || rateOfCached(e) <= 0 || isPool(e.target)) continue
              const tk = kindOf(e.target)
              if (tk === 'drain' || tk === 'end') continue
              if (passesOn(e.target)) {
                if (!spreadExact(e.target, exactRate(e), 1, viaPool, viaOther)) fR = RAT0
              } else viaOther.set(e.target, addR(viaOther.get(e.target) ?? RAT0, exactRate(e)))
            }
            for (const [t, part] of viaOther) {
              const a = accept(t)
              if (Number.isFinite(a)) fR = minR(fR, divR(ratOfDouble(Math.max(0, a)), part))
            }
          }
          const needR = new Map<string, Rat>()
          for (const e of poolIns) if (rateOfCached(e) > 0) needR.set(e.source, addR(needR.get(e.source) ?? RAT0, exactRate(e)))
          for (const [p, nr] of needR) fR = minR(fR, divR(maxR(RAT0, availR(p)), nr))
          if (!routerFed) {
            const makeR = new Map<string, Rat>()
            for (const e of outOf(id)) if (!skipDet(e.id) && rateOfCached(e) > 0 && isPool(e.target)) makeR.set(e.target, addR(makeR.get(e.target) ?? RAT0, exactRate(e)))
            for (const [q, x] of viaPool) makeR.set(q, addR(makeR.get(q) ?? RAT0, x))
            for (const [q, mk] of makeR) {
              const net = subR(mk, needR.get(q) ?? RAT0)
              let room = roomRatR(q, ownOfR(id, q))
              if (room !== null && (!isPositive(ownOfR(id, q))) && (working[q] ?? 0) >= cap(byId.get(q)!)) room = RAT0 // a Pool that reads full has no room
              if (room !== null && isPositive(net)) fR = minR(fR, divR(maxR(RAT0, room), net))
            }
          }
          // (a router-fed Converter's output side, before anything is taken: the exact room of
          // the Pools it makes into itself, on the net amount, a Pool that reads full having
          // none; a target that is not a Pool, and a Pool reached by two paths, bound it by the
          // doubles the engine holds)
          let outBoundR: Rat | null = null
          if (routerFed) {
            let b: Rat = makeInto.size > 0 ? RAT1 : RAT0
            const makeR = new Map<string, Rat>()
            for (const e of outOf(id)) if (!skipDet(e.id) && rateOfCached(e) > 0) makeR.set(e.target, addR(makeR.get(e.target) ?? RAT0, exactRate(e)))
            for (const [q, mk] of makeR) {
              if (!isPool(q)) {
                const a = accept(q)
                if (Number.isFinite(a)) b = minR(b, divR(ratOfDouble(Math.max(0, a)), mk))
                continue
              }
              const net = subR(mk, needR.get(q) ?? RAT0)
              const ownQ = ownOfR(id, q)
              let room = roomRatR(q, ownQ)
              if (room !== null && !isPositive(ownQ) && (working[q] ?? 0) >= cap(byId.get(q)!)) room = RAT0 // a Pool that reads full has no room
              if (room !== null && isPositive(net)) b = minR(b, divR(maxR(RAT0, room), net))
            }
            const shared = sharedPoolBound(makeInto, own, needFrom)
            if (Number.isFinite(shared)) b = minR(b, ratOfDouble(Math.max(0, shared)))
            outBoundR = b
          }
          if (mode === 'pullAll' && cmpR(fR, ratOfDouble(runOf(id) * RUN_REACHED)) < 0) {
            pullShort.add(id)
            continue
          }
          let receivedR = inboxR.get(id) ?? RAT0
          inbox.set(id, 0)
          inboxR.set(id, RAT0)
          const hadR = receivedR
          for (const e of poolIns) {
            if (rateOfCached(e) <= 0) continue
            const x = mulR(fR, exactRate(e))
            if (!isPositive(x)) continue
            const a = rnR(x)
            takeFrom(e.source, a, x)
            receivedR = addR(receivedR, x)
            emit(e, e.source, id, a, x)
          }
          // fed from Pools only: the one fraction on every line. Fed by a router outside every
          // plan (the safety net): what was received over a full run, bounded by the room
          let fOutR = fR
          if (routerFed) {
            const sumInR = inOf(id).reduce((t, e) => (rateOfCached(e) > 0 ? addR(t, exactRate(e)) : t), RAT0)
            fOutR = isPositive(sumInR) ? minR(minR(RAT1, outBoundR ?? ratOfDouble(fOut)), divR(receivedR, sumInR)) : RAT0
            if (mode === 'pullAll' && cmpR(fOutR, ratOfDouble(runOf(id) * RUN_REACHED)) < 0) {
              pullShort.add(id)
              fOutR = RAT0
            }
            if (emitDiag && !multiLoss.has(id)) {
              const loss = toDouble(subR(receivedR, mulR(fOutR, sumInR)))
              if (loss > 1e-6) {
                multiLoss.add(id)
                notices.push({ kind: 'multiSupplyLoss', nodeId: id, label: n.data.label, amount: Number(loss.toFixed(6)) })
              }
            }
          }
          if (!isPositive(fOutR) || targetFloored(id)) continue
          deliver(rnR(fOutR), cmpR(receivedR, hadR) > 0, fOutR)
          continue
        }
      }
    }

    // #471 Deploy 2 (review 2) — an amount handed to a router this step that
    // the router did not pass on is gone at the end of the pass (an inbox is
    // per step; in G7 the Gate whose Converter accepts nothing keeps what the
    // upstream Converter delivered). Named like the Converter's loss (D1), so
    // the notices of a step add up to what the Pools lost. Committed pass only.
    if (emitDiag) {
      for (const [rid, v] of [...inbox].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (v > 1e-6) notices.push({ kind: 'multiSupplyHeld', nodeId: rid, label: byId.get(rid)?.data.label ?? rid, amount: Number(v.toFixed(6)) })
      }
      // #477 — the committed pass publishes the Gates' evidence, the held
      // amount (the notice's number) on the Gate it names
      for (const [rid, v] of inbox) {
        const g = gateEntries.get(rid)
        if (g && v > 1e-6) g.held = r6(v)
      }
      gates.push(...[...gateEntries.values()].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)))
    }
    gateHolds.clear()
    heldIn.clear()
    if (snap) {
      for (const key of Object.keys(working)) delete working[key]
      Object.assign(working, snap.working)
      xl.clear()
      for (const [key, v] of snap.xl) xl.set(key, v)
      for (const [live, kept] of [[lvR, snap.lvR], [takenR, snap.takenR], [claimR, snap.claimR], [inboxR, snap.inboxR]] as const) {
        live.clear()
        for (const [key, v] of kept) live.set(key, v)
      }
      movesR.length = snap.movesLen
      xTaken.clear()
      for (const [key, v] of snap.xTaken) xTaken.set(key, v)
      taken.clear()
      for (const [key, v] of snap.taken) taken.set(key, v)
      reserved.clear()
      for (const [key, v] of snap.reserved) reserved.set(key, v)
      reservedXm.clear()
      for (const [key, v] of snap.reservedXm) reservedXm.set(key, v)
      reservedIn.clear()
      for (const [key, v] of snap.reservedIn) reservedIn.set(key, v)
      inbox.clear()
      for (const [key, v] of snap.inbox) inbox.set(key, v)
      ownReserve.clear()
      for (const [key, v] of snap.ownReserve) ownReserve.set(key, v)
      reservedR.clear()
      for (const [key, v] of snap.reservedR) reservedR.set(key, v)
      ownR.clear()
      for (const [key, v] of snap.ownR) ownR.set(key, v)
      activated.clear()
      for (const v of snap.activated) activated.add(v)
      fired.clear()
      for (const v of snap.fired) fired.add(v)
      events.length = snap.eventsLen
      diagnostics.length = snap.diagLen // no-op while emitDiag is false, kept as a guard
      ended = snap.ended
    }
    emitDiag = prevEmitDiag
    return pullShort
  }

  // ── Phase 2 feasibility fixpoint ────────────────────────────────────────
  // Only `pullAll` Converters can force a re-run; without any, this is a single
  // committed pass identical to before. Disabling a short `pullAll` Converter
  // only ever frees resource for the rest, so the disabled set grows monotonic-
  // ally and must settle within `#pullAll Converters + 1` probes (SEMANTICS.md
  // §9 / §11). A canonical-order winner among Converters contending for one Pool
  // fills first in the probe and stays enabled; the loser lands in the set.
  const isPullAllConverter = (id: string) =>
    kindOf(id) === 'converter' &&
    ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny') === 'pullAll'
  const pullAllConverterCount = order.filter(isPullAllConverter).length
  if (pullAllConverterCount > 0) {
    const capIters = pullAllConverterCount + 1
    let settled = false
    for (let i = 0; i < capIters; i++) {
      const short = pullPass(false)
      let grew = false
      for (const id of short) {
        if (!disabledPullAll.has(id)) {
          disabledPullAll = new Set(disabledPullAll).add(id)
          grew = true
        }
      }
      if (!grew) {
        settled = true
        break
      }
    }
    if (!settled) {
      diagnostics.push(
        `pull-all feasibility did not settle within ${capIters} probe passes; ` +
          `results for this step may be approximate.`,
      )
    }
  }
  pullPass(true)

  // ── Phase 2.5: afterPull labels (CSU / SEMANTICS-S3.md) ─────────────────
  // Applied once, using THIS step's real, committed `fired` set (built above
  // by Phase 1 push + the committed Phase 2 pull) — never a probe's. Ascending
  // `edge.id` (labelEdges, and so pendingAfterPull, is already in that order);
  // the running `working[target]` carries between edges into the same target,
  // exactly like a Phase-0 label; intermediate out-of-range values are
  // allowed. There is no separate Phase-2.5 clamp point — the correction is
  // computed here (so it can be attributed and reported) using the identical
  // §S5(d) formula the Commit clamp below would apply anyway, so Commit then
  // finds the value already in range (a harmless no-op second pass).
  const afterPullDelta = new Map<string, number>() // edgeId -> delta, applied edges only
  const afterPullTargets = new Set<string>()
  for (const item of pendingAfterPull) {
    const e = item.e
    if (!fired.has(e.source)) continue // `when` not satisfied this step — inert
    const running = working[e.target] ?? 0
    const delta = item.op === '+' ? item.n : item.op === '-' ? -item.n : item.n - running
    working[e.target] = running + delta
    afterPullDelta.set(e.id, delta)
    afterPullTargets.add(e.target)
  }
  const afterPullClampByTarget = new Map<string, number>()
  for (const tid of afterPullTargets) {
    const unclamped = working[tid] ?? 0
    const clamped = Math.min(cap(byId.get(tid)!), Math.max(0, unclamped))
    working[tid] = clamped
    afterPullClampByTarget.set(tid, nz(clamped - unclamped))
  }
  // clamp correction rides on the target's LAST APPLIED edge (CSU3-6); an
  // inert edge is never the attribution target and always reports 0 / 0.
  const lastAppliedIdxByTarget = new Map<string, number>()
  pendingAfterPull.forEach((item, i) => {
    if (afterPullDelta.has(item.e.id)) lastAppliedIdxByTarget.set(item.e.target, i)
  })
  pendingAfterPull.forEach((item, i) => {
    const e = item.e
    const applied = afterPullDelta.has(e.id)
    stateEvents.push({
      edgeId: e.id,
      from: e.source,
      to: e.target,
      mode: 'label',
      effect: {
        kind: 'label',
        applied,
        delta: applied ? afterPullDelta.get(e.id)! : 0,
        clampAdjustment:
          applied && lastAppliedIdxByTarget.get(e.target) === i
            ? afterPullClampByTarget.get(e.target) ?? 0
            : 0,
      },
    })
  })

  // ── Commit ──────────────────────────────────────────────────────────────
  for (const nid of Object.keys(working)) {
    const n = byId.get(nid)
    const c = n ? cap(n) : Infinity
    // A Pool is stored as the double nearest its exact level, whatever its size: the one
    // rounding of the step (an amount under the display threshold is not dropped here)
    let v = working[nid]
    if (v < 0) v = 0
    if (v > c) v = c
    working[nid] = v
  }

  // ── Phase 0 wrap-up: state events + schedule future triggers ────────────
  for (const e of triggerEdges) {
    if (!deliveredEdgeIds.has(e.id)) continue
    // §S9: applied = the pulse made the target eligible to fire this step =
    // target is passive/interactive AND its activator gate is open
    const applied = TRIGGERABLE.has(actOf(byId.get(e.target)!)) && isEnabled(e.target)
    stateEvents.push({
      edgeId: e.id,
      from: e.source,
      to: e.target,
      mode: 'trigger',
      effect: { kind: 'trigger', delivered: true, applied },
    })
  }
  // §S9: emitted in ascending edgeId (activator events were pushed in Phase 0)
  stateEvents.sort((a, b) => (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))

  const triggerQueue: TriggerQueueEntry[] = [...carriedQueue]
  for (const e of triggerEdges) {
    if (!fired.has(e.source)) continue
    triggerQueue.push({
      edgeId: e.id,
      target: e.target,
      deliveryStep: curStep + delayByEdge.get(e.id)! + 1, // SEMANTICS-S.md §S3.1
    })
  }
  triggerQueue.sort(
    (a, b) =>
      a.deliveryStep - b.deliveryStep ||
      (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0),
  )

  const firedList = [...fired].sort()

  // §M5-6 — a table line short of its plan says so. A want below `EPSILON` moves
  // nothing by the engine's own rule: unmet in the numbers, not worth a message.
  // SEMANTICS-M7.md §M7-2 — a table of what a line CAN move has no shortfall: moving less
  // is normal. It moves exactly as a plan does, and its report entry is the same.
  const tableLines = tablePlan ? withMoved(tablePlan.lines, events) : null
  for (const l of tableLines ?? []) {
    const table = opts.timetables!.find((t) => t.id === l.tableId)!
    if (hasTableMeaning(modelVersion) && meaningOf(table) === 'available') continue
    const amount = unmetAmount(l.planned, l.moved)
    if (amount > EPSILON) notices.push({ kind: 'timetableUnmet', edgeId: l.edgeId, tableId: l.tableId, label: table.label, amount })
  }

  // §M6-5 — one entry per group with a rule; a document with none has no key
  const runs = runPlan ? runReports(runPlan.rules, nodes, edges, events, stateEvents, runLimit) : null
  if (runs) notices.push(...runNotices(runs, nodes))

  return {
    state: { step: curStep, values: working, ended, fired: firedList, triggerQueue },
    report: {
      events,
      activated: [...activated].sort(),
      fired: firedList,
      stateEvents,
      diagnostics,
      notices,
      gates,
      moves: movesR.map((m) => ({ edgeId: m.edgeId, from: m.from, to: m.to, num: String(m.amount.num), den: String(m.amount.den), shown: m.shown ?? rnR(m.amount) })),
      ...(tableLines ? { timetableLines: tableLines } : {}),
      ...(runs ? { runs } : {}),
      // §M3-5 (L1) — only for a document with a kinds table; a v2 report has no key
      ...(kindRes ? { boundaryOutflow: boundaryOutflowByKind(events, nodes, liveEdges, kindRes.edgeKind) } : {}),
    },
  }
}
