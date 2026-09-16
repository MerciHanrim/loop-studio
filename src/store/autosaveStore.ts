import { create } from 'zustand'
import type { SaveToStorageResult } from '../model/serialize'

// Audit ①-4 — the autosave write used to swallow every failure: with a
// document over this browser's localStorage quota (reproduced with two
// 20k-row data-import tables on Chromium, whose per-origin quota is ~5M
// characters), nothing was persisted from that moment on, and there was no
// page error, no console line, no UI — the user found out on the next reload.
//
// This store is the ONE reactive signal for that: `graphStore` reports the
// result of every autosave write here; `AutosaveNotice` renders a persistent
// banner while `failed` is set and hides it the moment a write succeeds
// again (e.g. after the document shrinks). Session-only, never serialized.
// It must not import `graphStore` (that module imports this one).

export type AutosaveFailureReason = Exclude<SaveToStorageResult, { ok: true }>['reason']

type AutosaveState = {
  /** true while the latest autosave write failed */
  failed: boolean
  reason: AutosaveFailureReason | null
  /** the latest write's outcome — called by `graphStore` after every write */
  report: (r: SaveToStorageResult) => void
}

export const useAutosaveStore = create<AutosaveState>((set, get) => ({
  failed: false,
  reason: null,
  report: (r) => {
    if (r.ok) {
      if (get().failed) set({ failed: false, reason: null })
      return
    }
    if (!get().failed || get().reason !== r.reason) set({ failed: true, reason: r.reason })
  },
}))
