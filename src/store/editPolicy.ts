import { setDocumentLockSink, setEditGuard } from './graphStore'
import { useUiStore } from './uiStore'

// Issue #334 — the Canvas edit lock as ONE policy (docs/canvas-edit-lock.md).
//
// While `uiStore.canvasLocked` is on, every USER edit of the document is
// refused at the store: `graphStore`'s editing actions, `frameStore`'s saved
// frame changes and `projectStore.applyProposal` return without changing
// anything (no state, no history, no autosave). The UI disables the same entry
// points first; this is the backstop, so a new entry point cannot forget the
// lock.
//
// Three things pass by construction:
//  - a whole-document replacement (New, a Template, a file, a share link, a
//    Workspace, a project revision, Open proposal as document) — it is not an
//    edit of the open document; it writes the NEW document's lock through the
//    sink below, once, as part of the swap;
//  - the runtime of Run, Step and Monte Carlo — `simStore` / `mcStore` never
//    call a document-changing action;
//  - unlocking — the guard reads the lock, it never guards it.
//
// `graphStore` cannot import `uiStore` (uiStore → mcStore → graphStore would
// be a cycle), so this module registers both functions there, the way the
// history sidecars register. It is imported once by `startApp` (every build:
// web, portable, PWA) and by the tests that exercise the policy.

/** true while the edit lock refuses user edits */
export const editLocked = (): boolean => useUiStore.getState().canvasLocked

setEditGuard(editLocked)
setDocumentLockSink((locked) => useUiStore.getState().setCanvasLocked(locked))
