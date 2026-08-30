// loop-model/1 (SEMANTICS-M.md §M3) — `R(t) = evaluate every Register against
// the committed snapshot S(t)`, the ONE primitive every observer uses.
//
// `R(t)` is a pure function of S(t) (pool counts) and the graph (Register
// expressions + Parameter values). It is NOT simulation state: nothing here is
// stored in `SimState` or the Workspace — Canvas, Inspector, and the Timeline
// all call this with the appropriate snapshot and recompute (M-INV-2).

import { evaluateRegisters, type RefKind, type RegisterOutcome } from './registers'
import { readParameterData } from './parameter'
import { readRegisterData } from './register'

type NodeLike = { id: string; data: unknown }

const kindOf = (data: unknown): unknown =>
  data && typeof data === 'object' ? (data as { kind?: unknown }).kind : undefined

/** Pool counts at the snapshot being observed. `S(0)` uses the pools' `initial`. */
export function initialPoolValues(nodes: NodeLike[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of nodes) {
    if (kindOf(n.data) === 'pool') {
      const v = (n.data as { initial?: unknown }).initial
      out[n.id] = typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
  }
  return out
}

/**
 * `R(t)` for every Register in `nodes`, evaluated against `poolValues` = the
 * committed `S(t)`. Deterministic and order-independent (§M3.3). A Register
 * whose `data` cannot be read at all is reported `invalid` (`M_REG_PARSE`); a
 * reference to an unreadable Parameter surfaces as `M_REG_EVAL` (non-finite).
 */
export function registersOfSnapshot(
  nodes: NodeLike[],
  poolValues: Record<string, number>,
): Map<string, RegisterOutcome> {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const registers: { id: string; expr: string }[] = []
  const unreadable = new Map<string, RegisterOutcome>()
  for (const n of nodes) {
    if (kindOf(n.data) !== 'register') continue
    const r = readRegisterData(n.data)
    if (r.ok) registers.push({ id: n.id, expr: r.data.expr })
    else unreadable.set(n.id, { invalid: true, code: 'M_REG_PARSE', detail: r.detail })
  }

  const refKind = (id: string): RefKind => {
    const n = byId.get(id)
    if (!n) return 'missing'
    const k = kindOf(n.data)
    if (k === 'pool') return 'pool'
    if (k === 'parameter') return 'parameter'
    if (k === 'register') return 'register'
    return 'other'
  }
  const paramValue = (id: string): number => {
    const n = byId.get(id)
    if (!n) return Number.NaN
    const r = readParameterData(n.data)
    return r.ok ? r.data.value : Number.NaN // → REF_NOT_FINITE ⇒ the Register is invalid
  }

  const out = evaluateRegisters({
    registers,
    refKind,
    poolCount: (id) => poolValues[id] ?? 0,
    paramValue,
  })
  for (const [id, o] of unreadable) out.set(id, o)
  return out
}

export type { RegisterOutcome } from './registers'

/**
 * §M3.5 / §M6.2 — split a Register's per-step outcomes into **contiguous runs**
 * of valid points. A step where `R(t)` is invalid (or missing) ends the current
 * run; the next valid step starts a new one. A caller draws one polyline per
 * run, so a gap is never bridged.
 */
export function registerSeriesRuns(
  byStep: { step: number; outcomes: Map<string, RegisterOutcome> }[],
  registerId: string,
): { step: number; value: number }[][] {
  const runs: { step: number; value: number }[][] = []
  let cur: { step: number; value: number }[] = []
  let prevStep: number | null = null
  for (const f of byStep) {
    const o = f.outcomes.get(registerId)
    if (o && !o.invalid) {
      if (prevStep !== null && f.step !== prevStep + 1 && cur.length) {
        runs.push(cur)
        cur = []
      }
      cur.push({ step: f.step, value: o.value })
      prevStep = f.step
    } else {
      if (cur.length) runs.push(cur)
      cur = []
      prevStep = null
    }
  }
  if (cur.length) runs.push(cur)
  return runs
}

/** Display string for a valid Register value, per `data.format` (display only —
 *  the digested value is always the raw number, §M2). */
export function formatRegisterValue(value: number, format?: 'int' | 'float' | 'percent'): string {
  if (format === 'int') return String(Math.round(value))
  if (format === 'percent') {
    const p = value * 100
    return `${Number.isInteger(p) ? p : Number(p.toFixed(2))}%`
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}
