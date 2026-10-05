// Issue #307 - the open dialogs and mobile sheets, in the order they opened
// (every one registers through `useDialogFocus`).
//
//   - Only the top entry answers Escape: a dialog opened over a sheet closes
//     alone, and the sheet under it stays.
//   - A `modal` is a real dialog (`aria-modal="true"`), and what that attribute
//     says is made true: while it is the top entry, everything outside it is
//     `inert` - for the pointer, for Tab and in the accessibility tree - at any
//     width, over a sheet or not. That includes the PWA update bar, which sits
//     behind the dialog layer while one is open (docs/mobile.md MV8a) and comes
//     back, in the state it was in, when it closes; and a lower dialog when two
//     are nested, so only the top one can be reached. "The dialog" is its whole
//     modal layer: the nearest `data-modal-layer` ancestor (the guided tour's
//     scrim and spotlight are siblings of its popover) - MEASURED without it:
//     the tour's own scrim was made inert and stopped taking the clicks it
//     exists to swallow. Pure live regions (an
//     `aria-live` / status / alert / log region with no control in it, such as
//     the playback announcer) are left out, so an announcement is not lost.
//     Something that mounts while a dialog is open is made inert as it arrives.
//   - A `sheet` is NOT modal (docs/mobile.md MV5, MV-D11, MV-D18, MV-D19): no
//     `aria-modal` and no Tab trap. The run bar and the PWA update bar stay
//     reachable by pointer, keyboard and screen reader while a sheet is open.
//     Only what the sheet's scrim covers for the pointer is taken out of the
//     keyboard and screen-reader order too, so all three reach the same
//     controls: the elements marked `data-covered-by-sheets` (the canvas, the
//     top bar's More button and the open-file card). MEASURED at 390 px with
//     More, Export or Help open: those are the only focusable elements
//     outside the sheet that the scrim covers; the run bar's five controls and
//     the update bar's two are on top of it.
//
// `inert` is restored exactly: an element that was already inert is left alone
// and never "restored" to active.

export type OverlayKind = 'modal' | 'sheet'

type Entry = { el: HTMLElement; kind: OverlayKind }

const stack: Entry[] = []
let madeInert: HTMLElement[] = []
let observer: MutationObserver | null = null

const COVERED_BY_SHEETS = '[data-covered-by-sheets]'
const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'
const CONTROL =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])'

/** make every element outside `keep` inert, descending only into the elements
 *  that contain something to keep; already-inert elements are left alone */
function inertOutside(node: Element, keep: Element[]): void {
  for (const child of Array.from(node.children)) {
    if (!(child instanceof HTMLElement) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue
    if (keep.includes(child)) continue
    if (keep.some((k) => child.contains(k))) {
      inertOutside(child, keep)
      continue
    }
    if (child.inert) continue
    child.inert = true
    madeInert.push(child)
  }
}

/** the dialog's whole modal layer: the nearest `data-modal-layer` ancestor (the
 *  guided tour's scrim, spotlight and popover are siblings), else the dialog;
 *  a dialog drawn through DialogScrim has its scrim as an ancestor already */
const layerOf = (dialog: HTMLElement): HTMLElement => dialog.closest<HTMLElement>('[data-modal-layer]') ?? dialog

/** the top dialog's layer, and every pure live region outside it */
function keptAround(layer: HTMLElement): Element[] {
  const live = Array.from(document.querySelectorAll(LIVE)).filter((el) => !layer.contains(el) && !el.querySelector(CONTROL))
  return [layer, ...live]
}

function stopObserving(): void {
  observer?.disconnect()
  observer = null
}

function apply(): void {
  for (const el of madeInert) el.inert = false
  madeInert = []
  stopObserving()
  const top = stack[stack.length - 1]
  if (!top) return
  if (top.kind === 'sheet') {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(COVERED_BY_SHEETS))) {
      if (el.contains(top.el) || el.inert) continue
      el.inert = true
      madeInert.push(el)
    }
    return
  }
  const layer = layerOf(top.el)
  inertOutside(document.body, keptAround(layer))
  // what mounts while the dialog is open (an update notice, a toast) joins the
  // inert background as it arrives
  if (typeof MutationObserver === 'undefined') return
  observer = new MutationObserver((records) => {
    const arrived = records.some((r) =>
      Array.from(r.addedNodes).some((n) => n instanceof Element && !n.closest('[inert]') && !layer.contains(n)),
    )
    if (arrived) inertOutside(document.body, keptAround(layer))
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

/** register an open dialog or sheet; the returned function removes it */
export function pushOverlay(el: HTMLElement, kind: OverlayKind): () => void {
  const entry = { el, kind }
  stack.push(entry)
  apply()
  return () => {
    const i = stack.indexOf(entry)
    if (i >= 0) stack.splice(i, 1)
    apply()
  }
}

/** is this element the top entry (the one that answers Escape)? */
export function isTopOverlay(el: HTMLElement | null): boolean {
  return el != null && stack.length > 0 && stack[stack.length - 1].el === el
}

/** the element of the top entry, if anything is open */
export function topOverlay(): HTMLElement | null {
  return stack.length > 0 ? stack[stack.length - 1].el : null
}

/** tests only */
export function overlayCount(): number {
  return stack.length
}
