// docs/large-graph-readability.md §LGR6.6 — the two guards every destructive
// canvas key has to pass. Kept here (pure, DOM-only) so the global shortcut
// layer and the canvas delete handler share ONE definition and one unit test.

/** a text-entry control: the browser's own editing must win over any shortcut */
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Every modal surface this app can put over the canvas. React Flow's own
 *  delete-key handler listens on `document` and only skips text inputs, so a
 *  dialog's Cancel button used to be enough to delete the node behind it
 *  (audit 2026-09-20, F3). Covers the scrims by class AND the generic ARIA
 *  markers, so a future dialog is guarded by either. */
const MODAL_SELECTOR = '.mcdlg__scrim, .review-scrim, [role="dialog"], [aria-modal="true"]'

export function isModalOpen(doc: Document = document): boolean {
  return doc.querySelector(MODAL_SELECTOR) !== null
}

/** true when a destructive canvas key must be ignored for this event */
export function blocksCanvasKey(target: EventTarget | null, doc: Document = document): boolean {
  return isTypingTarget(target) || isModalOpen(doc)
}
