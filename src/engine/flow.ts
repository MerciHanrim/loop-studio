// Flow-expression parsing and deterministic evaluation.
//
// Every resource edge carries a flow string ("2", "all", "25%", "1-3", "2D6").
// It is parsed once into a structured `FlowExpr` that the editor, serialisation,
// and both engines share. Engine A can evaluate const / all / percent; ranges
// and dice parse but contribute 0 (SEMANTICS.md §8).

export type FlowExpr =
  | { kind: 'const'; value: number }
  | { kind: 'all' }
  | { kind: 'percent'; frac: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'dice'; count: number; sides: number }

const NUM = /^\d+(?:\.\d+)?$/

export function parseFlow(raw: string | undefined): FlowExpr {
  const s = (raw ?? '').trim().toLowerCase()
  if (s === '') return { kind: 'const', value: 1 }
  if (s === 'all') return { kind: 'all' }

  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/)
  if (pct) return { kind: 'percent', frac: Number(pct[1]) / 100 }

  const dice = s.match(/^(\d*)\s*d\s*(\d+)$/)
  if (dice) {
    return { kind: 'dice', count: dice[1] === '' ? 1 : Number(dice[1]), sides: Number(dice[2]) }
  }

  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    return { kind: 'range', lo: Math.min(a, b), hi: Math.max(a, b) }
  }

  if (NUM.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n) && n >= 0) return { kind: 'const', value: n }
  }
  return { kind: 'const', value: 1 } // unparseable behaves like empty
}

export const isRandom = (e: FlowExpr): boolean => e.kind === 'range' || e.kind === 'dice'

/** Are the bounds of a random expression usable? (integers, lo ≤ hi / n,d ≥ 1) */
export function randomBoundsOk(e: FlowExpr): boolean {
  if (e.kind === 'range') {
    return Number.isInteger(e.lo) && Number.isInteger(e.hi) && e.lo <= e.hi
  }
  if (e.kind === 'dice') {
    return Number.isInteger(e.count) && Number.isInteger(e.sides) && e.count >= 1 && e.sides >= 1
  }
  return true
}

/**
 * Deterministic (Engine A) evaluation of a flow expression.
 * `available` = S[sourcePool] − taken[sourcePool] (used by `all`)
 * `snapshot`  = S[sourcePool] (used by `percent`)
 * On a Source edge there is no source pool, so both are 0.
 */
export function evalDet(e: FlowExpr, available: number, snapshot: number): number {
  switch (e.kind) {
    case 'const':
      return e.value
    case 'all':
      return Math.max(0, available)
    case 'percent':
      return Math.max(0, e.frac * snapshot)
    case 'range':
    case 'dice':
      return 0 // random flow is inactive in Engine A
  }
}

/**
 * A non-negative scalar reading of an edge label for contexts that treat it as a
 * weight or a per-activation rate rather than an amount (gate split weights,
 * converter consume/produce rates). `all` → 1, random → 0 (Engine A only —
 * Engine B feeds the sampled value in via the flowVal cache; see `rateOfValue`).
 */
export function rateOf(e: FlowExpr): number {
  switch (e.kind) {
    case 'const':
      return e.value
    case 'percent':
      return e.frac
    case 'all':
      return 1
    case 'range':
    case 'dice':
      return 0
  }
}

/**
 * Weight / rate reading when a per-step sampled value is available for random
 * expressions (Engine B, SEMANTICS-B1.md §B3). `const` → its value, `all` → 1,
 * `percent` → its fraction, `range`/`dice` → the sampled integer `sampled`.
 */
export function rateOfValue(e: FlowExpr, sampled: number): number {
  return e.kind === 'range' || e.kind === 'dice' ? sampled : rateOf(e)
}

/** A closure that returns `u ∈ [0, 1)` for a given purpose + draw index. */
export type RandDraw = (purpose: 'flow-range' | 'flow-die', drawIndex: number) => number

/**
 * Engine B evaluation of a flow expression as an **amount**.
 * `const` / `all` / `percent` are exactly `evalDet`. `range` / `dice` draw via
 * `draw`; invalid bounds → `0` and `onBad(reason)` (one diagnostic, no throw).
 */
export function evalRand(
  e: FlowExpr,
  available: number,
  snapshot: number,
  draw: RandDraw,
  onBad?: (reason: string) => void,
): number {
  if (e.kind === 'range') {
    if (!randomBoundsOk(e)) {
      onBad?.(`range "${e.lo}-${e.hi}" needs integer bounds with lo ≤ hi`)
      return 0
    }
    return e.lo + Math.floor(draw('flow-range', 0) * (e.hi - e.lo + 1))
  }
  if (e.kind === 'dice') {
    if (!randomBoundsOk(e)) {
      onBad?.(`dice "${e.count}D${e.sides}" needs integer count ≥ 1 and sides ≥ 1`)
      return 0
    }
    let total = 0
    for (let i = 0; i < e.count; i++) total += 1 + Math.floor(draw('flow-die', i) * e.sides)
    return total
  }
  return evalDet(e, available, snapshot)
}
