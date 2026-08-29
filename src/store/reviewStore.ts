import { create } from 'zustand'
import type { PendingProposal } from './revisionIO'

// SEMANTICS-R.md §R10.5 / §R7 — a routed **proposal** waits here for the
// non-destructive Review UI (desktop panel / mobile sheet). Import ≠ Apply:
// opening one changes NOTHING in the graph / sim / undo / project until the
// user picks Apply or "Open as a document". Cancel just clears this.

type ReviewState = {
  pending: PendingProposal | null
  open: (p: PendingProposal) => void
  close: () => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  pending: null,
  open: (p) => set({ pending: p }),
  close: () => set({ pending: null }),
}))
