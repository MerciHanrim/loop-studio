// loop-model/4 (SEMANTICS-M4.md) — display units and the step length (#471,
// `units-display-design.md` rev 6, U1 stage 2). A kind may declare AMOUNT
// UNITS (a scale of its base unit: `L` = 0.001 m³) and RATE UNITS (an amount
// per time: `MW` = 1000 kWh per h); a document may declare its STEP LENGTH.
// A number field of a declared kind then keeps what the user typed — the
// AUTHORED decimal and the field's UNIT — and the engine reads a DERIVED
// value: the nearest double of the exact rational `authored × factor × S ÷ T`
// (§M4-2, invariant S′). Everything here is exact rational arithmetic; the
// one double is `engineValue`.
import { normalizeResourceType } from './model/resourceType'
import { trimUnicodeWhitespace, utf8Len } from './model/text'
import {
  cmp,
  displayRational,
  div,
  equals,
  exactDouble,
  exactWithin15Digits,
  fromInt,
  mul,
  parseDecimal,
  rational,
  roundTo15Digits,
  significantDigits,
  sub,
  toDouble,
  MAX_SIGNIFICANT_DIGITS,
  type Rational,
} from './rational'

// ── declarations ──────────────────────────────────────────────────────────

export type TimeUnit = 's' | 'min' | 'h' | 'd'
export const TIME_UNITS: readonly TimeUnit[] = ['s', 'min', 'h', 'd']
export const TIME_UNIT_SECONDS: Record<TimeUnit, number> = { s: 1, min: 60, h: 3600, d: 86400 }
export const isTimeUnit = (v: unknown): v is TimeUnit => typeof v === 'string' && (TIME_UNITS as readonly string[]).includes(v)

/** an amount unit of a kind: 1 `name` = `factor` base units (`factor` a
 *  positive decimal of at most 15 significant digits, kept as text) */
export type UnitDecl = { name: string; factor: string }
/** a rate unit of a kind: 1 `name` = `factor` base units per `per` */
export type RateUnitDecl = { name: string; factor: string; per: TimeUnit }

/** the document's step length (§M4-3) and the time unit its aggregate panels
 *  show rates per; `step` is a model fact and is digested, `display` is not */
export type DocTime = { step: { value: number; unit: TimeUnit }; display?: TimeUnit }

export const UNIT_NAME_MAX_BYTES = 32
/** `/` separates an amount unit from a time unit in a field's unit text
 *  (`L/min`), so a unit name may not contain it */
export const UNIT_SEPARATOR = '/'
export const STEP_VALUE_MAX = 1_000_000

/** a unit name as the file keeps it: trimmed, NFC, non-empty, at most 32
 *  UTF-8 bytes, without the separator; `null` otherwise */
export function readUnitName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = trimUnicodeWhitespace(raw).normalize('NFC')
  if (name === '' || utf8Len(name) > UNIT_NAME_MAX_BYTES || name.includes(UNIT_SEPARATOR)) return null
  return name
}

/** the runnable range of a unit factor (§M4-1): 10⁻¹⁵ … 10¹⁵ base units.
 *  Wide enough for femto- to peta-scaled units of any base, narrow enough
 *  that a factor times the largest step ratio (10⁶ days over 1 s, < 10¹¹)
 *  leaves every authored number below 10²⁸⁰ finite in the engine — a
 *  15-digit `1e400` would read as a valid decimal and run as `Infinity`. */
export const FACTOR_MIN = rational(1n, 10n ** 15n)
export const FACTOR_MAX = rational(10n ** 15n, 1n)

/** a factor as the file keeps it: a positive plain decimal of at most 15
 *  significant digits inside the runnable range, in its shortest exact form
 *  (`1000.0` → `1000`); `null` otherwise (a number is accepted through its
 *  shortest decimal form). The same read guards a declaration typed in the
 *  Kinds panel, so a factor out of range is never committed either. */
export function readFactor(raw: unknown): string | null {
  const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  if (text === null) return null
  const r = parseDecimal(text)
  if (r === null || r.num <= 0n) return null
  if (cmp(r, FACTOR_MIN) < 0 || cmp(r, FACTOR_MAX) > 0) return null
  const sig = significantDigits(text)
  if (sig === null || sig > MAX_SIGNIFICANT_DIGITS) return null
  return exactWithin15Digits(r)
}

/** whether a field's engine value is a finite number the engine can run on
 *  (§M4-2.1): with every factor in range this fails only for an authored
 *  number near the double's limit, which a run then refuses (§M4-2.5) */
export function engineValueRunnable(authored: string | number, fu: FieldUnit, time: DocTime | undefined): boolean {
  return fu.kind === 'base' || Number.isFinite(engineValue(authored, fu, time))
}

/** the §M4-1 defensive read of a kind's amount units: a bad entry is dropped,
 *  the first of two equal names wins, file order is kept */
export function readUnitList(raw: unknown, taken: Set<string> = new Set()): UnitDecl[] {
  if (!Array.isArray(raw)) return []
  const out: UnitDecl[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const o = entry as { name?: unknown; factor?: unknown }
    const name = readUnitName(o.name)
    const factor = readFactor(o.factor)
    if (name === null || factor === null || taken.has(name)) continue
    taken.add(name)
    out.push({ name, factor })
  }
  return out
}

/** the same read for rate units; `per` must be a time unit */
export function readRateUnitList(raw: unknown, taken: Set<string> = new Set()): RateUnitDecl[] {
  if (!Array.isArray(raw)) return []
  const out: RateUnitDecl[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const o = entry as { name?: unknown; factor?: unknown; per?: unknown }
    const name = readUnitName(o.name)
    const factor = readFactor(o.factor)
    if (name === null || factor === null || !isTimeUnit(o.per) || taken.has(name)) continue
    taken.add(name)
    out.push({ name, factor, per: o.per })
  }
  return out
}

/** the §M4-3 read of a document's `time`: `step.value` an integer in 1…10⁶,
 *  `step.unit` a time unit; `display` a time unit or absent; anything else
 *  ⇒ no time declaration at all */
export function readDocTime(raw: unknown): DocTime | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as { step?: unknown; display?: unknown }
  if (!o.step || typeof o.step !== 'object' || Array.isArray(o.step)) return undefined
  const s = o.step as { value?: unknown; unit?: unknown }
  if (typeof s.value !== 'number' || !Number.isInteger(s.value) || s.value < 1 || s.value > STEP_VALUE_MAX || !isTimeUnit(s.unit)) return undefined
  const time: DocTime = { step: { value: s.value, unit: s.unit } }
  if (isTimeUnit(o.display)) time.display = o.display
  return time
}

/** the canonical form of a time declaration (the read applied) */
export const canonicalDocTime = (time: DocTime | undefined): DocTime | undefined => (time ? readDocTime(time) : undefined)

export const stepSeconds = (time: DocTime | undefined): number | undefined => (time ? time.step.value * TIME_UNIT_SECONDS[time.step.unit] : undefined)

// ── a field's unit ────────────────────────────────────────────────────────

/** what a kind declares, as the unit code reads it (the kinds table entry
 *  without the parts it does not need) */
export type KindUnits = { name?: string; baseUnit?: string; units?: readonly UnitDecl[]; rateUnits?: readonly RateUnitDecl[] }

/** the unit a number field is authored in (§M4-2): the base unit per step
 *  (every field of every document before loop-model/4), an amount unit — for
 *  a rate, per step or per a time unit — or a rate unit */
export type FieldUnit =
  | { kind: 'base' }
  | { kind: 'amount'; unit: UnitDecl; per?: TimeUnit }
  | { kind: 'rate'; unit: RateUnitDecl }

export type FieldRole = 'stock' | 'rate'

/** the text a field's `unit` key holds: `L`, `L/min`, `MW`; `''` for the base */
export function fieldUnitText(fu: FieldUnit): string {
  if (fu.kind === 'base') return ''
  if (fu.kind === 'rate') return fu.unit.name
  return fu.per ? `${fu.unit.name}${UNIT_SEPARATOR}${fu.per}` : fu.unit.name
}

/**
 * §M4-2.2 — the unit a field's `unit` text names under its kind's lists and
 * the document's time. Fail-safe: an unknown name, a rate unit or a per-time
 * unit on a stock, and a per-time or rate unit without a step length all
 * read as the base unit per step — the number is then what every earlier
 * document meant by it, never a silently scaled one.
 */
export function resolveFieldUnit(text: unknown, decl: KindUnits | undefined, time: DocTime | undefined, role: FieldRole): FieldUnit {
  if (typeof text !== 'string' || text === '' || !decl) return { kind: 'base' }
  const amount = (name: string) => decl.units?.find((u) => u.name === name)
  const slash = text.lastIndexOf(UNIT_SEPARATOR)
  if (slash >= 0) {
    const per = text.slice(slash + 1)
    const u = amount(text.slice(0, slash))
    if (role === 'rate' && u && isTimeUnit(per) && time) return { kind: 'amount', unit: u, per }
    return { kind: 'base' }
  }
  const u = amount(text)
  if (u) return { kind: 'amount', unit: u }
  const r = decl.rateUnits?.find((x) => x.name === text)
  if (r && role === 'rate' && time) return { kind: 'rate', unit: r }
  return { kind: 'base' }
}

/** the units a field may be authored in (§M4-2.3): the base, every amount
 *  unit, and — for a rate field with a step length — every amount unit per
 *  each time unit and every rate unit. A stock field never sees a rate. */
export function fieldUnitOptions(decl: KindUnits | undefined, time: DocTime | undefined, role: FieldRole): FieldUnit[] {
  const out: FieldUnit[] = [{ kind: 'base' }]
  if (!decl) return out
  for (const u of decl.units ?? []) out.push({ kind: 'amount', unit: u })
  if (role === 'rate' && time) {
    for (const u of decl.units ?? []) for (const per of TIME_UNITS) out.push({ kind: 'amount', unit: u, per })
    for (const r of decl.rateUnits ?? []) out.push({ kind: 'rate', unit: r })
  }
  return out
}

/** the exact ratio from one unit of the field's unit to the base unit per
 *  step: `f`, `f × S ÷ T`, or 1 for the base (§M4-2.1) */
export function unitRatio(fu: FieldUnit, time: DocTime | undefined): Rational {
  if (fu.kind === 'base') return fromInt(1)
  const f = parseDecimal(fu.unit.factor) ?? fromInt(1)
  const per = fu.kind === 'rate' ? fu.unit.per : fu.per
  if (!per) return f
  const S = stepSeconds(time)
  if (S === undefined) return f // unreachable through `resolveFieldUnit`; the base ratio is the safe one
  return mul(f, rational(BigInt(S), BigInt(TIME_UNIT_SECONDS[per])))
}

/** an authored number as a decimal text: the field's text when it is a plain
 *  decimal, else the shortest form of its value */
export const authoredText = (v: string | number): string => (typeof v === 'number' ? String(v) : v.trim())

/** the exact value of an authored field in the base unit per step, or `null`
 *  when the text is not a plain decimal */
export function fieldRational(authored: string | number, fu: FieldUnit, time: DocTime | undefined): Rational | null {
  const a = parseDecimal(authoredText(authored))
  return a === null ? null : mul(a, unitRatio(fu, time))
}

/** §M4-2.1 — the ENGINE VALUE of an authored field: the nearest double of its
 *  exact value in the base unit per step; the authored number itself when
 *  the field is in the base unit or its text is not a plain decimal */
export function engineValue(authored: string | number, fu: FieldUnit, time: DocTime | undefined): number {
  if (fu.kind === 'base') return typeof authored === 'number' ? authored : Number(authored)
  const r = fieldRational(authored, fu, time)
  return r === null ? (typeof authored === 'number' ? authored : Number(authored)) : toDouble(r)
}

// ── changing the unit of a non-empty field (§M4-4, D10) ──────────────────

export type UnitChangePreview =
  /** the re-expressed decimal terminates within 15 significant digits: the
   *  same rational, so the engine value and every balance verdict are unchanged */
  | { exact: true; value: string }
  /** it does not: nothing is applied until the user confirms the rounded value */
  | {
      exact: false
      /** the 15-digit value that would be stored */
      rounded: string
      /** the exact value as far as it goes (R≈ text: `≈ …` when it does not terminate) */
      exactShown: string
      /** the deviation of the rounded value from the authored one, in the base unit per step (R≈) */
      deviation: { text: string; approx: boolean }
      deviationSign: -1 | 0 | 1
    }

/** what re-expressing an authored value from one unit to another would store */
export function previewUnitChange(authored: string | number, from: FieldUnit, to: FieldUnit, time: DocTime | undefined): UnitChangePreview | null {
  const a = parseDecimal(authoredText(authored))
  if (a === null) return null
  const base = mul(a, unitRatio(from, time))
  const inTo = div(base, unitRatio(to, time))
  const exact = exactWithin15Digits(inTo)
  if (exact !== null) return { exact: true, value: exact }
  const rounded = roundTo15Digits(inTo)
  const roundedBase = mul(parseDecimal(rounded) ?? inTo, unitRatio(to, time))
  const dev = sub(roundedBase, base)
  return { exact: false, rounded, exactShown: displayRational(inTo).text, deviation: displayRational(dev), deviationSign: cmp(dev, fromInt(0)) }
}

/** an ENGINE value in the base unit per step re-expressed for a panel
 *  (§M4-5): the double's exact binary value in the field's unit, shown to at
 *  most 15 significant digits, `≈` exactly when the shown text is not that
 *  value. A float residue never reads as exact: the engine's
 *  1699.999999999984 m³ shows as `≈ 1700000` L, its exact 200 m³ as `200000`.
 *  Display only — the stored value and every balance verdict are untouched. */
export function reexpress(baseValue: number, fu: FieldUnit, time: DocTime | undefined): { text: string; approx: boolean } {
  if (!Number.isFinite(baseValue)) return { text: String(baseValue), approx: false }
  return shownRational(div(exactDouble(baseValue), unitRatio(fu, time)))
}

/** at most 15 significant digits, `≈` exactly when that is not the value (§M4-5) */
function shownRational(r: Rational): { text: string; approx: boolean } {
  const shown = roundTo15Digits(r)
  const approx = !equals(parseDecimal(shown) ?? r, r)
  return { text: approx ? `≈ ${shown}` : shown, approx }
}

/** an AUTHORED value read in another unit (§M4-10): exact from its decimal, so
 *  no double stands between the field and the text. `null` when the text is not
 *  a plain decimal. */
export function reexpressField(authored: string | number, from: FieldUnit, to: FieldUnit, time: DocTime | undefined): { text: string; approx: boolean } | null {
  const r = fieldRational(authored, from, time)
  return r === null ? null : shownRational(div(r, unitRatio(to, time)))
}

/** the Inspector's current amount of a Pool (§M4-5): before a run its
 *  authored starting amount as typed; during one the engine value re-expressed
 *  in the Pool's unit (`reexpress`), with the unit. A Pool in the base unit
 *  keeps the node's own two-decimal format. A view unit (§M4-10) takes the
 *  Pool's unit's place in both cases. */
export function currentAmountText(live: number | undefined, initial: number, unitText: string | undefined, fu: FieldUnit, time: DocTime | undefined, view?: FieldUnit): string {
  if (view) {
    const text = live === undefined ? (reexpressField(initial, fu, view, time) ?? reexpress(engineValue(initial, fu, time), view, time)).text : reexpress(live, view, time).text
    return `${text} ${fieldUnitText(view)}`
  }
  if (fu.kind === 'base') {
    const shown = live ?? initial
    return Number.isInteger(shown) ? String(shown) : shown.toFixed(2)
  }
  const text = live === undefined ? String(initial) : reexpress(live, fu, time).text
  return `${text} ${unitText ?? fieldUnitText(fu)}`
}

/** the kind a Pool's `resourceType` names, normalised (`null` when none) */
export const poolKindName = (data: { resourceType?: unknown } | undefined): string | null => normalizeResourceType(data?.resourceType).value
