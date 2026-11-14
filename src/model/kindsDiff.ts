// SEMANTICS-R14.md §R14-2 — what differs between two kinds tables, said so that a reader
// can see what a number would mean under each: the base unit a kind is counted in, whether
// it is conserved, and what one of each of its units is worth. The review's Kinds line
// shows these before the table is taken.
import type { ResourceKindDecl } from './kinds'

export type KindsDiffRow =
  /** the kind is in one table only */
  | { kind: string; what: 'kind'; yours: boolean; theirs: boolean }
  | { kind: string; what: 'baseUnit'; yours: string | null; theirs: string | null }
  | { kind: string; what: 'conserved'; yours: boolean; theirs: boolean }
  /** one unit of the kind: what 1 of it is worth on each side (`60 kg`, `1000 g/min`), `null` where the side has no such unit */
  | { kind: string; what: 'unit'; unit: string; yours: string | null; theirs: string | null }

/** what 1 of each unit of a kind is worth, in the kind's base unit: `bag` → `60 kg`, a rate unit → `1000 g/min` */
function unitWorth(k: ResourceKindDecl | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!k) return out
  const base = k.baseUnit ?? ''
  const worth = (factor: string) => (base === '' ? factor : `${factor} ${base}`)
  for (const u of k.units ?? []) out.set(u.name, worth(u.factor))
  for (const u of k.rateUnits ?? []) out.set(u.name, `${worth(u.factor)}/${u.per}`)
  return out
}

/**
 * The rows in which `theirs` differs from `yours`, in the order of `theirs` and then the
 * kinds only `yours` holds. Per kind: its presence when one side lacks it, its base unit,
 * `conserved`, then every unit whose worth differs. A unit's worth is written with the
 * base unit, so a renamed base unit shows on every unit of the kind: `1 kg/min` against
 * `1 g/min` is not the same rate.
 */
export function kindsDiff(yours: readonly ResourceKindDecl[] | null, theirs: readonly ResourceKindDecl[] | null): KindsDiffRow[] {
  const mine = new Map((yours ?? []).map((k) => [k.name, k]))
  const other = new Map((theirs ?? []).map((k) => [k.name, k]))
  const names = [...other.keys(), ...[...mine.keys()].filter((n) => !other.has(n))]
  const rows: KindsDiffRow[] = []
  for (const kind of names) {
    const a = mine.get(kind)
    const b = other.get(kind)
    if (!a || !b) rows.push({ kind, what: 'kind', yours: a !== undefined, theirs: b !== undefined })
    const baseA = a?.baseUnit ?? null
    const baseB = b?.baseUnit ?? null
    if (baseA !== baseB) rows.push({ kind, what: 'baseUnit', yours: baseA, theirs: baseB })
    if (a && b && a.conserved !== b.conserved) rows.push({ kind, what: 'conserved', yours: a.conserved, theirs: b.conserved })
    const worthA = unitWorth(a)
    const worthB = unitWorth(b)
    for (const unit of [...worthB.keys(), ...[...worthA.keys()].filter((u) => !worthB.has(u))]) {
      const x = worthA.get(unit) ?? null
      const y = worthB.get(unit) ?? null
      if (x !== y) rows.push({ kind, what: 'unit', unit, yours: x, theirs: y })
    }
  }
  return rows
}
