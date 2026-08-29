import { create } from 'zustand'

// docs/pwa.md §P4 — state behind the `.pwa-update` bar. Populated only by
// `src/pwa/register-sw.ts` (Production / PWA-test build); in every other build
// `registerPwa()` is never called and `waitingWorker` stays null.
//
// The store tracks the WAITING service-worker object itself, not just a flag, so
// a Dismiss can be scoped to that exact worker: `markWaiting(sameWorker)` keeps
// an existing Dismiss, only a DIFFERENT worker clears it (a new deploy).

type PwaStore = {
  /** the service worker currently installed and WAITING, or null */
  waitingWorker: ServiceWorker | null
  /** the worker the user dismissed the bar for (bar hidden while this === waitingWorker) */
  dismissedWorker: ServiceWorker | null
  /** set by register-sw: hand off to the waiting worker + reload on controllerchange */
  applyFn: (() => void) | null

  /** a worker is waiting. Same object ⇒ keep any Dismiss; a new object ⇒ show afresh. */
  markWaiting: (worker: ServiceWorker) => void
  /** the waiting worker vanished / moved on — resync, hide the bar */
  clearWaiting: () => void
  /** hide the bar for the CURRENT waiting worker; a later deploy re-shows it */
  dismiss: () => void
  /** Update clicked */
  apply: () => void
  setApplyFn: (fn: () => void) => void
}

export const usePwaStore = create<PwaStore>((set, get) => ({
  waitingWorker: null,
  dismissedWorker: null,
  applyFn: null,

  markWaiting: (worker) =>
    set((s) =>
      s.waitingWorker === worker
        ? s // same worker: no change, an existing Dismiss stays
        : { waitingWorker: worker, dismissedWorker: null }, // new worker: un-dismiss
    ),
  clearWaiting: () => set({ waitingWorker: null }),
  dismiss: () => set((s) => ({ dismissedWorker: s.waitingWorker })),
  apply: () => get().applyFn?.(),
  setApplyFn: (fn) => set({ applyFn: fn }),
}))

/** the bar shows only while a worker is waiting and it is not the dismissed one */
export const selectUpdateReady = (s: PwaStore): boolean =>
  s.waitingWorker != null && s.waitingWorker !== s.dismissedWorker

/** Should Update proceed? A run in progress needs a second confirm; otherwise it
 *  applies straight away. Pure — testable without the SW / a dialog (docs/pwa.md
 *  §P4.2 / test 6). */
export function decideUpdate(runInProgress: boolean, confirm: () => boolean): boolean {
  return !runInProgress || confirm()
}
