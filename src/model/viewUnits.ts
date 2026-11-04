// SEMANTICS-M4.md §M4-8 — the Timeline's view unit (#471). A person may READ a
// kind's Pools in another of its amount units. This is screen state and nothing
// else: no document, Workspace file, undo entry or engine value depends on it.
// Every Timeline series is a stock, so only amount units apply. Everything here
// is presentation of an engine value in the base unit.
import type { ResourceKindDecl } from './kinds'
import type { LoopNode } from './types'
import { div, equals, exactDouble, parseDecimal, plainDecimal, toDouble, toSignificant15, MAX_SIGNIFICANT_DIGITS } from './rational'
import { fieldUnitOptions, fieldUnitText, poolKindName, reexpress, resolveFieldUnit, unitRatio, type FieldUnit } from './units'

/** the chosen unit by kind name; a kind with no entry reads in its base unit */
export type ViewUnits = Readonly<Record<string, string>>
export const NO_VIEW_UNITS: ViewUnits = {}

/** how one Pool reads on the Timeline. `unit` is the text printed beside its
 *  numbers, absent when none is named; `fu` is set only when the view
 *  re-expresses it; `ratio` is base units per shown unit, a double, for the
 *  chart's geometry only — no printed number is computed from it. */
export type PoolView = { unit?: string; fu?: FieldUnit; ratio: number }
export type PoolViews = ReadonlyMap<string, PoolView>

/** node id → how that Pool reads. A Pool that names no unit and is not
 *  re-expressed has no entry, and prints exactly what it always printed. The
 *  name is resolved here on every read, so a unit removed from the kind reads
 *  as the base unit at once and a stale factor is never applied (§M4-2.2). */
export function poolViews(nodes: readonly LoopNode[], kinds: readonly ResourceKindDecl[], views: ViewUnits): PoolViews {
  const out = new Map<string, PoolView>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const name = poolKindName(n.data)
    const decl = name === null ? undefined : kinds.find((k) => k.name === name)
    if (!decl) continue
    const fu = resolveFieldUnit(views[decl.name], decl, undefined, 'stock')
    if (fu.kind !== 'base') out.set(n.id, { unit: fieldUnitText(fu), fu, ratio: toDouble(unitRatio(fu, undefined)) })
    else if (decl.baseUnit) out.set(n.id, { unit: decl.baseUnit, ratio: 1 })
  }
  return out
}

/** one kind's choice in the Series popover: `value` is the chosen unit, `''`
 *  for the base. A kind is offered when it has an amount unit and a Pool. */
export type ViewUnitChoice = { kind: string; baseUnit?: string; value: string; options: string[] }

export function viewUnitChoices(nodes: readonly LoopNode[], kinds: readonly ResourceKindDecl[], views: ViewUnits): ViewUnitChoice[] {
  const used = new Set(nodes.flatMap((n) => (n.data.kind === 'pool' ? [poolKindName(n.data)] : [])))
  return kinds
    .filter((k) => (k.units?.length ?? 0) > 0 && used.has(k.name))
    .map((k) => ({
      kind: k.name,
      baseUnit: k.baseUnit,
      value: fieldUnitText(resolveFieldUnit(views[k.name], k, undefined, 'stock')),
      options: fieldUnitOptions(k, undefined, 'stock').flatMap((fu) => (fu.kind === 'base' ? [] : [fieldUnitText(fu)])),
    }))
}

/** the number a chart plots for a Pool: a point's height is its shown number */
export const shownNumber = (value: number, view: PoolView | undefined): number => (view ? value / view.ratio : value)

/** the charts' own number format: an integer as it is, otherwise one decimal */
export const chartNumber = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** an axis mark in a view unit: a round mark, not an engine value, so it carries
 *  no `≈`; plain digits, and no float residue (`0.30000000000000004`) */
export const axisMark = (n: number): string => plainDecimal(toSignificant15(n))

const withUnit = (text: string, unit: string | undefined): string => (unit ? `${text} ${unit}` : text)

/** R≈ at the width of a chip or an end label: six significant digits, or the
 *  whole integer part when that is longer. `≈` exactly when the text is not the
 *  engine value (§M4-5 allows at most 15 significant digits). */
const COMPACT_DIGITS = 6
function compact(value: number, fu: FieldUnit): string {
  if (!Number.isFinite(value)) return String(value)
  const r = div(exactDouble(value), unitRatio(fu, undefined))
  const x = toDouble(r)
  const whole = String(Math.trunc(Math.abs(x))).length
  const shown = plainDecimal(Number(x.toPrecision(Math.min(MAX_SIGNIFICANT_DIGITS, Math.max(COMPACT_DIGITS, whole)))))
  return equals(parseDecimal(shown) ?? r, r) ? shown : `≈ ${shown}`
}

/** a chip's and an end label's text */
export function compactText(value: number, view: PoolView | undefined): string {
  return withUnit(view?.fu ? compact(value, view.fu) : chartNumber(value), view?.unit)
}

/** the full R≈ form of a re-expressed value, without its unit; the `(shown)`
 *  cell is this text, so a file and the step reading can never disagree */
export const fullShown = (value: number, fu: FieldUnit): { text: string; approx: boolean } => reexpress(value, fu, undefined)

/** the step reading's text */
export function fullText(value: number, view: PoolView | undefined): string {
  return withUnit(view?.fu ? fullShown(value, view.fu).text : chartNumber(value), view?.unit)
}

/** what the axis can say about the Pools it draws: nothing when none names a
 *  unit, the one unit they share, or that the units differ, so two amounts on
 *  one number line are never read as the same scale */
export type AxisUnit = { kind: 'none' } | { kind: 'one'; unit: string } | { kind: 'mixed' }

export function axisUnit(ids: readonly string[], views: PoolViews): AxisUnit {
  const units = new Set(ids.map((id) => views.get(id)?.unit ?? ''))
  if (units.size > 1) return { kind: 'mixed' }
  const [unit] = units
  return unit ? { kind: 'one', unit } : { kind: 'none' }
}

/** whether any of these Pools is re-expressed by the view */
export const viewIsOn = (ids: readonly string[], views: PoolViews): boolean => ids.some((id) => views.get(id)?.fu !== undefined)

/** the left pad of a chart: today's value, wider only when a view unit's axis
 *  marks need it. 6.7 px is one character of the 11 px axis face. */
export function axisPad(marks: readonly string[], least: number): number {
  return Math.max(least, Math.ceil(Math.max(...marks.map((m) => m.length)) * 6.7) + 10)
}
