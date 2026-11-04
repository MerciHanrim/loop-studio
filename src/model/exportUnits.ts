// loop-model/4 (SEMANTICS-M4.md §M4-6, D6) — what an export says about units.
// A number meant for calculation stays a number in the base unit per step, and
// the unit is named beside it, once. A document that names no unit gets an empty
// table here, and every writer then writes what it always wrote, byte for byte.
import type { ResourceKindDecl } from './kinds'
import type { LoopNode } from './types'
import { poolKindName } from './units'

/** node id → the base unit of that Pool's numbers. A Pool of no kind, or of a
 *  kind with no base unit, has no entry. */
export type ExportUnits = ReadonlyMap<string, string>

export const NO_EXPORT_UNITS: ExportUnits = new Map()

export function exportUnits(nodes: readonly LoopNode[], kinds: readonly ResourceKindDecl[]): ExportUnits {
  const units = new Map<string, string>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const kind = poolKindName(n.data)
    const base = kind === null ? undefined : kinds.find((k) => k.name === kind)?.baseUnit
    if (base) units.set(n.id, base)
  }
  return units
}

/** `true` when at least one of these Pools has a named base unit */
export const namesAUnit = (units: ExportUnits, ids: readonly string[]): boolean => ids.some((id) => units.has(id))

/** `feed [m³]`: the readable name of a column, unchanged when no unit is named */
export function withUnit(name: string, unit: string | undefined): string {
  return unit ? `${name} [${unit}]` : name
}

/** the JSON header (§M4-6): `units` names each Pool's base unit once, by node id
 *  because labels may repeat; left out when there is nothing to name */
export function unitsHeader(units: ExportUnits, ids: readonly string[]): { units?: Record<string, string> } {
  const named = ids.filter((id) => units.has(id))
  return named.length > 0 ? { units: Object.fromEntries(named.map((id) => [id, units.get(id)!])) } : {}
}
