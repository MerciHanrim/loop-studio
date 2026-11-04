// loop-model/4 (SEMANTICS-M4.md §M4-6, D6) — what an export says about units.
// A number meant for calculation stays a number in the base unit per step: the
// unit is named beside it, once, and a value re-expressed in another unit is a
// separate text with a separate approximation flag. A document that names no
// unit gets an empty table here, and every writer then writes what it always
// wrote, byte for byte.
import type { ResourceKindDecl } from './kinds'
import type { LoopNode } from './types'
import { fieldUnitText, poolKindName, reexpress, resolveFieldUnit, type DocTime, type FieldUnit } from './units'

export type PoolExportUnit = {
  /** the kind's base unit, the unit of every exported number of this Pool;
   *  `''` when the kind names none */
  base: string
  /** the unit the Pool is authored in, when that is not the base */
  field?: FieldUnit
}

export type ExportUnits = { pools: ReadonlyMap<string, PoolExportUnit>; time?: DocTime }

export const NO_EXPORT_UNITS: ExportUnits = { pools: new Map() }

/** a quantity with a display form (§M4-6): the number and its unit stay as they
 *  are, and `display` is the R≈ text in the unit the Pool is authored in */
export type ShownQuantity = { value: number; unit: string; approx: boolean; display: string }

/** The table for a document's Pools. A Pool of no kind, or of a kind with no
 *  base unit and no other unit in use, has no entry. */
export function exportUnits(nodes: readonly LoopNode[], kinds: readonly ResourceKindDecl[], time: DocTime | undefined): ExportUnits {
  const pools = new Map<string, PoolExportUnit>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const kind = poolKindName(n.data)
    const decl = kind === null ? undefined : kinds.find((k) => k.name === kind)
    if (!decl) continue
    const base = decl.baseUnit ?? ''
    const field = resolveFieldUnit(n.data.unit, decl, time, 'stock')
    if (field.kind !== 'base') pools.set(n.id, { base, field })
    else if (base !== '') pools.set(n.id, { base })
  }
  return { pools, time }
}

/** the base unit a Pool's numbers are in; `''` when none is named */
export const poolBaseUnit = (u: ExportUnits, id: string): string => u.pools.get(id)?.base ?? ''

/** `true` when at least one of these Pools has a named base unit */
export const namesAUnit = (u: ExportUnits, ids: readonly string[]): boolean => ids.some((id) => poolBaseUnit(u, id) !== '')

/** `true` when at least one of these Pools is authored in another unit */
export const hasShownForm = (u: ExportUnits, ids: readonly string[]): boolean => ids.some((id) => u.pools.get(id)?.field !== undefined)

/** `feed [m³]`: the readable name of a column, unchanged when no unit is named */
export function withUnit(name: string, unit: string | undefined): string {
  return unit ? `${name} [${unit}]` : name
}

/** A Pool's engine value as a person reads it in the Pool's own unit, or `null`
 *  for a Pool in the base unit, whose number already is that value. `approx` is
 *  derived here, at export time, and never stored. */
export function shownQuantity(value: number, id: string, u: ExportUnits): ShownQuantity | null {
  const pool = u.pools.get(id)
  if (!pool?.field) return null
  const { text, approx } = reexpress(value, pool.field, u.time)
  return { value, unit: pool.base, approx, display: `${text} ${fieldUnitText(pool.field)}` }
}

/** the `<name> (shown)` and `<name> (approx)` cells: blank for a Pool in the
 *  base unit, so a column stays one type in a file that mixes both */
export function shownCells(value: number, id: string, u: ExportUnits): [string, string] {
  const q = shownQuantity(value, id, u)
  return q ? [q.display, String(q.approx)] : ['', '']
}

/** the JSON header (§M4-6): `units` names each Pool's base unit once, by node
 *  id because labels may repeat; `time` is the step length, a model fact. A key
 *  with nothing to say is left out. */
export function unitsHeader(u: ExportUnits, ids: readonly string[]): { units?: Record<string, string>; time?: { step: DocTime['step'] } } {
  const units: Record<string, string> = {}
  for (const id of ids) {
    const base = poolBaseUnit(u, id)
    if (base !== '') units[id] = base
  }
  return {
    ...(Object.keys(units).length > 0 ? { units } : {}),
    ...(u.time ? { time: { step: u.time.step } } : {}),
  }
}
