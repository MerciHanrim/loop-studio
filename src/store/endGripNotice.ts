// docs/edge-routing.md §ER18 — the last refused drop of a canvas end grip, so
// the Inspector's Ends status line says the same reason the canvas live region
// announced. Cleared when a new grip drag starts or the pick changes.
import { create } from 'zustand'
import type { EndMoveVerdict } from '../model/endMove'

export type RefusedMove = Extract<EndMoveVerdict, { ok: false }>

export const useEndGripNotice = create<{
  edgeId: string | null
  verdict: RefusedMove | null
  set: (edgeId: string | null, verdict: RefusedMove | null) => void
}>((set) => ({
  edgeId: null,
  verdict: null,
  set: (edgeId, verdict) => set({ edgeId, verdict }),
}))
