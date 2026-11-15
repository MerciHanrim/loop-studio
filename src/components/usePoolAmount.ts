import { currentAmountText, poolKindName, resolveFieldUnit } from '../model/units'
import { stockReading } from '../model/viewUnits'
import type { PoolData } from '../model/types'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { useViewUnitsStore } from '../store/viewUnitsStore'

/** A Pool's CURRENT amount as it is read out, and what it is read with. One
 *  reading for the Inspector's "Current amount" field and for the phone's
 *  selection panel (`MobileSelectionPanel`), so the two never say different
 *  numbers. */
export function usePoolAmount(id: string, d: PoolData) {
  // the count the node SHOWS — the engine's value once a run has started, the
  // authored starting amount before — as the node formats it (`nodes.tsx` fmt)
  const live = useSimStore((s) => (s.values ? s.values[id] : undefined))
  // loop-model/4 — in the Pool's authored unit when it has one (§M4-5), and in
  // the Timeline's view unit while one is on (§M4-10)
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const views = useViewUnitsStore((s) => s.views)
  const decl = kinds.find((k) => k.name === poolKindName(d))
  const fu = resolveFieldUnit(d.unit, decl, time, 'stock')
  const reading = decl ? stockReading(views, decl) : undefined
  const shownText = currentAmountText(live, d.initial, undefined, fu, time, reading?.kind === 'base' ? undefined : reading)
  return { shownText, decl, fu, reading, time }
}
