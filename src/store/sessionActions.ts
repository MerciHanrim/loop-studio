import { WORK_KEY, storagePort, storageSession } from '../storage/storagePort'
import { persistNow, useGraphStore } from './graphStore'
import { recommendedRunConfigForExport } from './mcStore'
import { useSessionStore } from './sessionStore'

// Issue #297 — what the Storage and privacy area DOES, once the person has
// confirmed. Every function here is called from a Confirm button and from
// nowhere else; the dialogs own the explanation, the export offer and the
// confirmation (docs/localization.md Slice 2b posture: no external effect
// before Confirm). No direction copies or deletes a document silently.

/** the open diagram as a Graph JSON text, for the export offers */
export function exportableDocument(): string {
  return useGraphStore.getState().exportJSON(recommendedRunConfigForExport())
}

/** does the session hold work worth warning about? The untouched sample and
 *  an empty canvas do not. */
export function sessionHasWork(): boolean {
  const g = useGraphStore.getState()
  if (g.pristineSample) return false
  return g.nodes.length > 0 || g.edges.length > 0
}

/**
 * Personal → temporary. The port opens a fresh in-memory door; the stored
 * personal document is NOT deleted. With `carryDocument` the open diagram
 * stays open (and is now saved to memory only, the stored copy remaining);
 * without it the temporary session starts with an empty diagram.
 */
export function switchToTemporary(carryDocument: boolean): void {
  storageSession.use('temporary')
  if (carryDocument) persistNow()
  else useGraphStore.getState().newGraph()
  useSessionStore.getState().sync()
}

/**
 * Temporary → personal. The first write to the browser happens here, after
 * the confirmation: the open diagram is saved at once and replaces whatever
 * document the browser held. Settings made during the session are written
 * as they next change, like any other preference.
 */
export function switchToPersonal(): void {
  storageSession.use('personal')
  persistNow()
  useSessionStore.getState().sync()
}

/**
 * "Delete work data": the document record only. In a personal browser the
 * record is removed and the open diagram is emptied (the autosave then holds
 * an empty diagram, not the old one). In a temporary session the browser's
 * stored record is removed and the temporary diagram is left alone: what is
 * being deleted is the previous person's exposure, not this session's work.
 * Throws what the browser throws, so the caller can say it failed.
 */
export function deleteWorkData(): void {
  if (storageSession.mode() === 'personal') {
    storagePort.removeItem(WORK_KEY)
    useGraphStore.getState().newGraph()
  } else {
    storageSession.removeFromBrowser(WORK_KEY)
  }
}

/**
 * "Reset all Loop Studio data": every registered key leaves the browser's
 * storage, the port closes so that the flush on the way out stores nothing,
 * and the page reloads into the gate. Returns the keys that were present,
 * for the caller's record; the reload follows unless `reload` is false (the
 * unit tests). Throws what the browser throws, before anything closes.
 */
export function resetAllData(reload = true): string[] {
  const removed = storageSession.resetAll()
  useSessionStore.getState().sync()
  if (reload) window.location.reload()
  return removed
}

/**
 * The loss warning of a temporary session: a reload or a close would lose the
 * work, and the browser's own "leave this page?" dialog is the only thing that
 * can still stop it at that point. `beforeunload` is not fired by every
 * browser (iOS Safari does not), so this is a warning, never a guarantee; the
 * chip and the Storage area offer the export before it comes to this.
 */
export function installLossWarning(target: Window = window): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (useSessionStore.getState().mode !== 'temporary' || !sessionHasWork()) return
    e.preventDefault()
    // the legacy spelling some browsers still require to show the dialog
    e.returnValue = ''
  }
  target.addEventListener('beforeunload', onBeforeUnload)
  return () => target.removeEventListener('beforeunload', onBeforeUnload)
}
