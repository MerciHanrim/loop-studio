// docs/edge-routing.md §ER18 — what the canvas end grips tell the Inspector's
// Ends group: the last refused grip drop (so the status line says the same
// reason the canvas live region announced), and which ends of the selected
// connection have NO grip because no free spot was found near them (the Ends
// group is then the way to move that end).
import { create } from 'zustand'
import type { EndMoveVerdict } from '../model/endMove'
import type { PortEnd } from '../model/ports'

export type RefusedMove = Extract<EndMoveVerdict, { ok: false }>

export const useEndGripNotice = create<{
  edgeId: string | null
  verdict: RefusedMove | null
  set: (edgeId: string | null, verdict: RefusedMove | null) => void
  /** the selected connection's ends that have no grip on the canvas */
  noSpot: { edgeId: string; ends: PortEnd[] } | null
  setNoSpot: (v: { edgeId: string; ends: PortEnd[] } | null) => void
}>((set) => ({
  edgeId: null,
  verdict: null,
  set: (edgeId, verdict) => set({ edgeId, verdict }),
  noSpot: null,
  setNoSpot: (noSpot) => set({ noSpot }),
}))
