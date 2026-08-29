import { create } from 'zustand'

// docs/pwa.md §P4 — the state behind the `.pwa-update` bar. Only ever populated
// by `src/pwa/register-sw.ts` (Production / PWA-test build). In every other
// build `registerPwa()` is never called, so `hasWaiting` stays false and the
// bar never renders.

type PwaStore = {
  /** a new service worker is installed and WAITING (an update is staged) */
  hasWaiting: boolean
  /** the user dismissed the bar for the current waiting worker */
  dismissed: boolean
  /** set by register-sw: message the waiting worker to skipWaiting */
  applyFn: (() => void) | null

  /** a waiting worker appeared — show the bar afresh (un-dismiss) */
  markWaiting: () => void
  /** hide the bar for THIS waiting worker; the next deploy re-shows it */
  dismiss: () => void
  /** Update clicked — hand off to the waiting worker (register-sw reloads on
   *  the resulting `controllerchange`) */
  apply: () => void
  setApplyFn: (fn: () => void) => void
}

export const usePwaStore = create<PwaStore>((set, get) => ({
  hasWaiting: false,
  dismissed: false,
  applyFn: null,
  markWaiting: () => set({ hasWaiting: true, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
  apply: () => get().applyFn?.(),
  setApplyFn: (fn) => set({ applyFn: fn }),
}))

/** the bar shows only while a worker is waiting and the user hasn't dismissed it */
export const selectUpdateReady = (s: PwaStore): boolean => s.hasWaiting && !s.dismissed
