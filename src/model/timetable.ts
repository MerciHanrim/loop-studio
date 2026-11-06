// loop-model/5 (SEMANTICS-M5.md) — a timetable: a named list of times and rates
// that a connection reads instead of a constant. A step's amount is the table's
// rate added up over that step, as an exact rational, and the engine reads its
// nearest double. Nothing here uses a numeric grid: a hold or linear table has
// a closed form, so the amount of a step never depends on how the time is cut.
import { resolveKinds, type ResourceKindDecl } from './kinds'
import { add, cmp, div, exactDouble, fromInt, mul, parseDecimal, plainDecimal, rational, significantDigits, sub, toDouble, MAX_SIGNIFICANT_DIGITS, type Rational } from './rational'
import type { LoopEdge, LoopNode, ResourceEdgeData } from './types'
import { isTimeUnit, resolveFieldUnit, stepSeconds, TIME_UNIT_SECONDS, type DocTime, type TimeUnit } from './units'

export type TimetableRead = 'hold' | 'linear'
export type TimetableAfter = 'stop' | 'hold' | 'zero' | 'repeat'

export type Timetable = {
  id: string
  label: string
  /** where the numbers came from; shown beside the table */
  source: string
  /** a rate unit of the line's kind (`CMD`, `L/min`), never an amount per step */
  unit: string
  timeUnit: TimeUnit
  read: TimetableRead
  /** the time the table stops describing (§M5-3); under `repeat`, the period */
  end: string
  after: TimetableAfter
  /** `[time, rate]`, both decimal text kept as typed */
  points: [string, string][]
}

/** the data import's existing row limit */
export const MAX_TIMETABLE_POINTS = 20_000
/** the largest time or rate a table may hold. A step's amount is at most a rate
 *  times the longest step times the largest factor (§M5-2): 10⁶⁰ × 8.64 × 10¹⁰ ×
 *  10¹⁵ is about 10⁸⁶, so every plan a good table makes is a finite double. */
export const MAX_TIMETABLE_DECIMAL = rational(10n ** 60n, 1n)
export const TIMETABLE_FLOW_PREFIX = '~'
const TIMETABLE_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/
const READS: readonly string[] = ['hold', 'linear']
const AFTERS: readonly string[] = ['stop', 'hold', 'zero', 'repeat']

export type TimetableProblemCode =
  | 'not-a-list'
  | 'bad-entry'
  | 'bad-id'
  | 'duplicate-id'
  | 'bad-label'
  | 'bad-source'
  | 'bad-unit'
  | 'bad-time-unit'
  | 'bad-read'
  | 'bad-after'
  | 'no-points'
  | 'too-many-points'
  | 'bad-point'
  | 'first-not-zero'
  | 'time-out-of-order'
  | 'bad-end'

/** why a table is refused. `row` is the 1-based point that broke it, when one did. */
export type TimetableProblem = { code: TimetableProblemCode; tableId: string | null; row?: number }

/** a decimal a table may hold: plain, not negative, at most 15 significant
 *  digits, at most `MAX_TIMETABLE_DECIMAL` */
function readDecimal(text: unknown): Rational | null {
  if (typeof text !== 'string' || !PLAIN_DECIMAL.test(text)) return null
  const sig = significantDigits(text)
  if (sig === null || sig > MAX_SIGNIFICANT_DIGITS) return null
  const value = parseDecimal(text)
  return value !== null && cmp(value, MAX_TIMETABLE_DECIMAL) <= 0 ? value : null
}

/** the §M5-3 rule, for a table whose points are already good */
function endHolds(end: Rational, last: Rational, read: TimetableRead, after: TimetableAfter): boolean {
  if (end.num <= 0n) return false
  if (read === 'linear' && after !== 'repeat') return cmp(end, last) === 0
  return cmp(end, last) > 0
}

/** the first thing wrong with one entry, or the table it reads as. A table is
 *  never repaired: dropping a row would change what it means (§M5-2). */
export function checkTimetable(raw: unknown): { ok: true; table: Timetable } | { ok: false; problem: TimetableProblem } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problem: { code: 'bad-entry', tableId: null } }
  const o = raw as Record<string, unknown>
  const tableId = typeof o.id === 'string' ? o.id : null
  const fail = (code: TimetableProblemCode, row?: number) => ({ ok: false as const, problem: { code, tableId, ...(row !== undefined ? { row } : {}) } })
  if (tableId === null || !TIMETABLE_ID.test(tableId)) return fail('bad-id')
  if (typeof o.label !== 'string' || o.label.trim() === '') return fail('bad-label')
  if (typeof o.source !== 'string' || o.source.trim() === '') return fail('bad-source')
  if (typeof o.unit !== 'string' || o.unit.trim() === '') return fail('bad-unit')
  if (!isTimeUnit(o.timeUnit)) return fail('bad-time-unit')
  if (typeof o.read !== 'string' || !READS.includes(o.read)) return fail('bad-read')
  const after = o.after === undefined ? 'stop' : o.after
  if (typeof after !== 'string' || !AFTERS.includes(after)) return fail('bad-after')
  if (!Array.isArray(o.points) || o.points.length === 0) return fail('no-points')
  if (o.points.length > MAX_TIMETABLE_POINTS) return fail('too-many-points')
  const points: [string, string][] = []
  let last: Rational | null = null
  for (let i = 0; i < o.points.length; i++) {
    const p = o.points[i] as unknown
    if (!Array.isArray(p) || p.length !== 2) return fail('bad-point', i + 1)
    const t = readDecimal(p[0])
    if (t === null || readDecimal(p[1]) === null) return fail('bad-point', i + 1)
    if (i === 0 && t.num !== 0n) return fail('first-not-zero', 1)
    if (last !== null && cmp(t, last) <= 0) return fail('time-out-of-order', i + 1)
    last = t
    points.push([p[0] as string, p[1] as string])
  }
  const end = readDecimal(o.end)
  const read = o.read as TimetableRead
  if (end === null || last === null || !endHolds(end, last, read, after as TimetableAfter)) return fail('bad-end')
  return {
    ok: true,
    table: { id: tableId, label: o.label, source: o.source, unit: o.unit, timeUnit: o.timeUnit, read, end: o.end as string, after: after as TimetableAfter, points },
  }
}

/** every table of a file, or the first problem: one bad table refuses them all */
export function readTimetables(raw: unknown): { ok: true; tables: Timetable[] } | { ok: false; problem: TimetableProblem } {
  if (raw === undefined) return { ok: true, tables: [] }
  if (!Array.isArray(raw)) return { ok: false, problem: { code: 'not-a-list', tableId: null } }
  const tables: Timetable[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const r = checkTimetable(entry)
    if (!r.ok) return r
    if (seen.has(r.table.id)) return { ok: false, problem: { code: 'duplicate-id', tableId: r.table.id } }
    seen.add(r.table.id)
    tables.push(r.table)
  }
  return { ok: true, tables }
}

/** a table in canonical key order, as the file and the digest carry it */
export const canonicalTimetable = (t: Timetable): Timetable => ({
  id: t.id,
  label: t.label,
  source: t.source,
  unit: t.unit,
  timeUnit: t.timeUnit,
  read: t.read,
  end: t.end,
  after: t.after,
  points: t.points.map(([time, rate]) => [time, rate]),
})

// ── the exact integral ────────────────────────────────────────────────────

type Compiled = {
  times: Rational[]
  rates: Rational[]
  /** the integral from 0 to `times[i]` */
  prefix: Rational[]
  end: Rational
  /** the integral from 0 to `end` */
  total: Rational
  /** the rate at `end`, the one `after: hold` continues */
  lastRate: Rational
  plans: Map<string, number>
}

const compiled = new WeakMap<Timetable, Compiled>()
const ZERO = fromInt(0)
const TWO = fromInt(2)

/** the rate reached at the far end of stretch `i`, for a linear table */
function nextRate(c: Pick<Compiled, 'rates'>, i: number, after: TimetableAfter): Rational {
  if (i + 1 < c.rates.length) return c.rates[i + 1]
  return after === 'repeat' ? c.rates[0] : c.rates[i]
}

function compile(t: Timetable): Compiled {
  const hit = compiled.get(t)
  if (hit) return hit
  const times = t.points.map(([x]) => parseDecimal(x)!)
  const rates = t.points.map(([, v]) => parseDecimal(v)!)
  const end = parseDecimal(t.end)!
  const prefix: Rational[] = [ZERO]
  let total = ZERO
  for (let i = 0; i < times.length; i++) {
    const to = i + 1 < times.length ? times[i + 1] : end
    const width = sub(to, times[i])
    const area = t.read === 'hold' ? mul(rates[i], width) : mul(div(add(rates[i], nextRate({ rates }, i, t.after)), TWO), width)
    total = add(total, area)
    if (i + 1 < times.length) prefix.push(total)
  }
  const lastRate = t.read === 'hold' ? rates[rates.length - 1] : nextRate({ rates }, rates.length - 1, t.after)
  const c: Compiled = { times, rates, prefix, end, total, lastRate, plans: new Map() }
  compiled.set(t, c)
  return c
}

/** the last point at or before `x` (`x` inside the table) */
function stretchOf(c: Compiled, x: Rational): number {
  let lo = 0
  let hi = c.times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cmp(c.times[mid], x) <= 0) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** the rate added up from 0 to `x`, for `x` from 0 to `end` */
function inside(t: Timetable, c: Compiled, x: Rational): Rational {
  const i = stretchOf(c, x)
  const width = sub(x, c.times[i])
  if (width.num === 0n) return c.prefix[i] // a linear table's last point has no stretch after it
  if (t.read === 'hold') return add(c.prefix[i], mul(c.rates[i], width))
  const to = i + 1 < c.times.length ? c.times[i + 1] : c.end
  const slope = div(sub(nextRate(c, i, t.after), c.rates[i]), sub(to, c.times[i]))
  const reached = add(c.rates[i], mul(slope, width))
  return add(c.prefix[i], mul(div(add(c.rates[i], reached), TWO), width))
}

/** the rate added up from 0 to `x`, for any `x` the table's `after` covers */
export function timetableIntegral(t: Timetable, x: Rational): Rational {
  const c = compile(t)
  if (cmp(x, c.end) <= 0) return inside(t, c, x)
  switch (t.after) {
    case 'repeat': {
      const whole = (x.num * c.end.den) / (x.den * c.end.num) // floor: both are positive
      const rest = sub(x, mul(fromInt(whole), c.end))
      return add(mul(fromInt(whole), c.total), inside(t, c, rest))
    }
    case 'hold':
      return add(c.total, mul(c.lastRate, sub(x, c.end)))
    case 'zero':
      return c.total
    case 'stop':
      throw new Error(`timetable "${t.id}" does not reach that time`)
  }
}

/** the rate at time `x`, for a chart of the table itself */
export function timetableRateAt(t: Timetable, x: Rational): Rational {
  const c = compile(t)
  let at = x
  if (cmp(x, c.end) >= 0) {
    if (t.after === 'zero') return ZERO
    if (t.after === 'hold' || t.after === 'stop') return c.lastRate
    const whole = (x.num * c.end.den) / (x.den * c.end.num)
    at = sub(x, mul(fromInt(whole), c.end))
  }
  const i = stretchOf(c, at)
  if (t.read === 'hold') return c.rates[i]
  const to = i + 1 < c.times.length ? c.times[i + 1] : c.end
  return add(c.rates[i], mul(div(sub(nextRate(c, i, t.after), c.rates[i]), sub(to, c.times[i])), sub(at, c.times[i])))
}

/** the corners of the table's rate from `from` to `to`, in its own time and rate
 *  units, for a chart. Past `end`, a `stop` table has no line. A table with more
 *  corners than `budget` keeps each bin's lowest and highest rate, so a spike
 *  between two reads is still drawn: `budget` is at most what comes back, plus one. */
export function timetablePolyline(t: Timetable, from: number, to: number, budget: number): { time: number; rate: number }[] {
  const c = compile(t)
  const end = toDouble(c.end)
  const stopAt = t.after === 'stop' ? Math.min(to, end) : to
  if (stopAt <= from) return []
  const at = (x: number) => toDouble(timetableRateAt(t, fromNumber(x)))
  const corners: number[] = []
  const times = c.times.map(toDouble)
  const periods = t.after === 'repeat' ? Math.ceil(stopAt / end) : 1
  if (periods * times.length > budget) {
    return envelope(t, times, c.rates.map(toDouble), end, from, stopAt, Math.max(1, Math.floor(budget / 2)), at)
  }
  for (let p = 0; p < periods; p++) for (const x of times) corners.push(p * end + x)
  if (t.after !== 'repeat' && end < stopAt) corners.push(end)
  const inside = [from, ...corners.filter((x) => x > from && x < stopAt), stopAt]
  const out: { time: number; rate: number }[] = []
  inside.forEach((x, i) => {
    // a hold table's rate jumps at a corner: draw the old rate up to it first
    const prev = inside[i - 1]
    if (t.read === 'hold' && prev !== undefined) out.push({ time: x, rate: at(prev) })
    if (i < inside.length - 1 || t.read === 'linear') out.push({ time: x, rate: at(x) })
  })
  return out
}

const fromNumber = (x: number): Rational => exactDouble(x)

/** the first index whose time is after `x` */
function firstAfter(times: readonly number[], x: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] > x) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** each bin's lowest and highest rate, in time order. Both readings are piecewise
 *  straight, so a bin's extremes lie at its edges or at a corner inside it. */
function envelope(t: Timetable, times: readonly number[], rates: readonly number[], end: number, from: number, to: number, bins: number, at: (x: number) => number): { time: number; rate: number }[] {
  const width = (to - from) / bins
  const out: { time: number; rate: number }[] = []
  const lowest = Math.min(...rates)
  const highest = Math.max(...rates)
  for (let i = 0; i < bins; i++) {
    const a = from + width * i
    const b = i === bins - 1 ? to : a + width
    let lo = { time: a, rate: at(a) }
    let hi = lo
    const see = (time: number, rate: number) => {
      if (rate < lo.rate) lo = { time, rate }
      if (rate > hi.rate) hi = { time, rate }
    }
    if (t.read === 'linear') see(b, at(b))
    if (t.after === 'repeat' && width >= end) {
      see(a + width / 3, lowest) // the bin holds a whole period, so it holds both
      see(a + (2 * width) / 3, highest)
    } else {
      const first = t.after === 'repeat' ? Math.floor(a / end) : 0
      const last = t.after === 'repeat' ? Math.floor(b / end) : 0
      for (let p = first; p <= last; p++) {
        const base = p * end
        for (let k = firstAfter(times, a - base); k < times.length && base + times[k] < b; k++) see(base + times[k], rates[k])
      }
    }
    if (lo.rate === hi.rate) out.push(lo)
    else if (lo.time <= hi.time) out.push(lo, hi)
    else out.push(hi, lo)
  }
  out.push({ time: to, rate: at(to) })
  return out
}

/** the step length in the table's own time unit */
function stepInTableTime(t: Timetable, time: DocTime): Rational {
  return rational(BigInt(stepSeconds(time)!), BigInt(TIME_UNIT_SECONDS[t.timeUnit]))
}

/** the first step the table does not fully cover: the run ends before it under
 *  `stop`. `null` for any other `after`, which covers every step. */
export function firstUncoveredStep(t: Timetable, time: DocTime): number | null {
  if (t.after !== 'stop') return null
  const S = stepInTableTime(t, time)
  const end = compile(t).end
  return Number((end.num * S.den) / (end.den * S.num)) + 1
}

/** from one unit of table rate × one unit of table time to the base unit */
export type RateFactor = Rational

/** the table's rate unit under a line's kind, as base units per table time
 *  unit; `null` when the unit is not a rate of that kind (§M5-5) */
export function timetableRateFactor(t: Timetable, decl: ResourceKindDecl | undefined, time: DocTime | undefined): RateFactor | null {
  const fu = resolveFieldUnit(t.unit, decl, time, 'rate')
  if (fu.kind === 'base') return null
  const per = fu.kind === 'rate' ? fu.unit.per : fu.per
  if (!per) return null
  const f = parseDecimal(fu.unit.factor)
  return f === null ? null : mul(f, rational(BigInt(TIME_UNIT_SECONDS[t.timeUnit]), BigInt(TIME_UNIT_SECONDS[per])))
}

/** P: the exact plan of step `k`, in the base unit (§M5-6). Never stored. */
export function exactPlan(t: Timetable, k: number, factor: RateFactor, time: DocTime): Rational {
  const S = stepInTableTime(t, time)
  const to = mul(S, fromInt(k))
  const from = mul(S, fromInt(k - 1))
  return mul(sub(timetableIntegral(t, to), timetableIntegral(t, from)), factor)
}

/** the most one step can ask of the table, in the base unit: its highest rate held for
 *  a whole step. No step reads more, so a step-length warning can rest on it (§M6-9). */
export function peakPlan(t: Timetable, factor: RateFactor, time: DocTime): Rational {
  const top = compile(t).rates.reduce((a, b) => (cmp(a, b) >= 0 ? a : b))
  return mul(mul(top, stepInTableTime(t, time)), factor)
}

/** p: the nearest double of P, what the engine is asked to move. Worked out once
 *  per table, factor, step length and step, so a replay or a Monte Carlo run
 *  pays for it once. */
export function enginePlan(t: Timetable, k: number, factor: RateFactor, time: DocTime): number {
  const c = compile(t)
  const key = `${k}|${stepSeconds(time)}|${factor.num}/${factor.den}`
  let p = c.plans.get(key)
  if (p === undefined) {
    p = toDouble(exactPlan(t, k, factor, time))
    c.plans.set(key, p)
  }
  return p
}

// ── lines ─────────────────────────────────────────────────────────────────

/** the table a flow text names (`~tide_intake`), or `null` */
export function timetableRef(flow: unknown): string | null {
  if (typeof flow !== 'string') return null
  const s = flow.trim()
  return s.startsWith(TIMETABLE_FLOW_PREFIX) ? s.slice(TIMETABLE_FLOW_PREFIX.length) : null
}

export type TimetableFindingCode = 'unknown-table' | 'bad-line' | 'no-step' | 'no-kind' | 'bad-unit' | 'two-kinds' | 'out-of-range'

export type TimetableFinding = { code: TimetableFindingCode; edgeId: string; tableId: string }

const checked = new WeakMap<Timetable, boolean>()
/** a table the §M5-2 read accepts. A file cannot hand the engine any other, but
 *  a caller can, and the integral must never meet one. */
function tableIsGood(t: Timetable): boolean {
  let ok = checked.get(t)
  if (ok === undefined) {
    ok = checkTimetable(t).ok
    checked.set(t, ok)
  }
  return ok
}

const resourceData = (e: LoopEdge): ResourceEdgeData | null => ((e.data?.kind ?? 'resource') === 'resource' ? (e.data as ResourceEdgeData) : null)

/** the lines that read a table: id, and the table named */
export function timetableLines(edges: readonly LoopEdge[]): { edge: LoopEdge; tableId: string }[] {
  const out: { edge: LoopEdge; tableId: string }[] = []
  for (const e of edges) {
    const d = resourceData(e)
    const tableId = d ? timetableRef(d.flow) : null
    if (tableId !== null) out.push({ edge: e, tableId })
  }
  return out
}

/** every reason a run cannot use its tables (§M5-5). The run bars refuse before
 *  Play with these, and `step` refuses with them for a caller that steps anyway. */
export function timetableFindings(
  nodes: LoopNode[],
  edges: LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime | undefined,
): TimetableFinding[] {
  const lines = timetableLines(edges)
  if (lines.length === 0) return []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const tables = new Map((timetables ?? []).map((t) => [t.id, t]))
  const declOf = new Map((kinds ?? []).map((k) => [k.name, k]))
  const edgeKind = resolveKinds(nodes, edges).edgeKind
  const kindOfTable = new Map<string, string>()
  const out: TimetableFinding[] = []
  for (const { edge, tableId } of lines) {
    const found = (code: TimetableFindingCode) => out.push({ code, edgeId: edge.id, tableId })
    const t = tables.get(tableId)
    if (!t) {
      found('unknown-table')
      continue
    }
    if (!tableIsGood(t)) {
      found('out-of-range')
      continue
    }
    const from = byId.get(edge.source)?.data.kind
    const to = byId.get(edge.target)?.data.kind
    if (!((from === 'source' && to === 'pool') || (from === 'pool' && (to === 'drain' || to === 'end')))) {
      found('bad-line')
      continue
    }
    if (!time) {
      found('no-step')
      continue
    }
    const kind = edgeKind.get(edge.id) ?? null
    if (kind === null) {
      found('no-kind')
      continue
    }
    const seen = kindOfTable.get(tableId)
    if (seen !== undefined && seen !== kind) {
      found('two-kinds')
      continue
    }
    kindOfTable.set(tableId, kind)
    if (timetableRateFactor(t, declOf.get(kind), time) === null) found('bad-unit')
  }
  return out
}

/** a finding as the engine's own refusal says it. The run bars word the same
 *  findings in the user's language. */
export function timetableFindingText(f: TimetableFinding, nodes: readonly LoopNode[], edges: readonly LoopEdge[]): string {
  const label = (id: string | undefined) => nodes.find((n) => n.id === id)?.data.label ?? id ?? '?'
  const e = edges.find((x) => x.id === f.edgeId)
  const line = `the line from "${label(e?.source)}" to "${label(e?.target)}"`
  const why: Record<TimetableFindingCode, string> = {
    'unknown-table': `${line} names a timetable this document does not hold`,
    'bad-line': `${line} cannot read a timetable: only Source to Pool and Pool to Drain or End can`,
    'no-step': `${line} reads a timetable, and the document has no step length`,
    'no-kind': `${line} reads a timetable, and has no kind for its unit to resolve against`,
    'bad-unit': `${line} reads a timetable whose unit is not a rate of the line's kind`,
    'two-kinds': `${line} reads a timetable another line uses with a different kind`,
    'out-of-range': `${line} reads a timetable with a value out of range`,
  }
  return `Can't run: ${why[f.code]} ("${f.tableId}"). Nothing moved.`
}

/** u: the double nearest exact(p) − exact(m), never negative (§M5-6) */
export const unmetAmount = (planned: number, moved: number): number => toDouble(sub(exactDouble(planned), exactDouble(moved)))

/** one table line of a step: what the engine is asked to move (§M5-6) */
export type PlannedLine = { edgeId: string; tableId: string; planned: number }

/** the step's plan: the graph with each table line at its amount, or, when a
 *  `stop` table does not cover step `k`, the table that ended the run. Assumes
 *  `timetableFindings` found nothing. */
export function applyTimetables(
  nodes: LoopNode[],
  edges: LoopEdge[],
  timetables: readonly Timetable[],
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime,
  k: number,
): { edges: LoopEdge[]; lines: PlannedLine[]; endedBy: Timetable | null; notFinite: TimetableFinding | null } {
  const tables = new Map(timetables.map((t) => [t.id, t]))
  const declOf = new Map((kinds ?? []).map((d) => [d.name, d]))
  const used = timetableLines(edges)
  for (const { tableId } of used) {
    const t = tables.get(tableId)!
    const first = firstUncoveredStep(t, time)
    if (first !== null && k >= first) return { edges, lines: [], endedBy: t, notFinite: null }
  }
  const edgeKind = resolveKinds(nodes, edges).edgeKind
  const planned = new Map<string, PlannedLine>()
  for (const { edge, tableId } of used) {
    const t = tables.get(tableId)!
    const factor = timetableRateFactor(t, declOf.get(edgeKind.get(edge.id) ?? ''), time)!
    const amount = enginePlan(t, k, factor, time)
    // a good table under a factor from the file is always finite; a caller's own
    // kinds table may not be, and that is a refusal, never a throw
    if (!Number.isFinite(amount)) return { edges, lines: [], endedBy: null, notFinite: { code: 'out-of-range', edgeId: edge.id, tableId } }
    planned.set(edge.id, { edgeId: edge.id, tableId, planned: amount })
  }
  const out = edges.map((e) => {
    const line = planned.get(e.id)
    return line ? ({ ...e, data: { ...(e.data as ResourceEdgeData), flow: plainDecimal(line.planned) } } as LoopEdge) : e
  })
  return { edges: out, lines: [...planned.values()].sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1)), endedBy: null, notFinite: null }
}
