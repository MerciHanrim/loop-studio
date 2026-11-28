import { useEffect, useRef, type RefObject } from 'react'
import { isTopOverlay, pushOverlay, topOverlay, type OverlayKind } from '../ui/overlayStack'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
const FIELD = 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'

/** review U1 — `:disabled` (not the `disabled` attribute) also covers a control
 *  inside a `<fieldset disabled>`, the phone's read-only Inspector sheet. What
 *  takes focus must also be inside the dialog, shown and not inert: `focus()` on
 *  anything else does nothing, and focus was left on <body> */
function canTakeFocus(el: HTMLElement | null | undefined, within: HTMLElement): el is HTMLElement {
  return (
    !!el &&
    within.contains(el) &&
    !el.matches(':disabled') &&
    !el.closest('[inert]') &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden'
  )
}

/** the first element in `within` that matches `selector` and can take focus */
function firstUsable(within: HTMLElement, selector: string): HTMLElement | undefined {
  return [...within.querySelectorAll<HTMLElement>(selector)].find((el) => canTakeFocus(el, within))
}

/**
 * Focus behaviour shared by every app dialog and every mobile sheet:
 *  - on open, move focus to the first field (input/select) or the first
 *    focusable element that can take it (enabled, shown, inside, not inert)
 *  - a dialog (`kind: 'modal'`, the default) traps Tab inside itself; a mobile
 *    sheet (`kind: 'sheet'`) does not, it is not modal (src/ui/overlayStack.ts)
 *  - Escape → `onEscape`, for the top dialog or sheet only, unless an earlier
 *    handler has used it (`defaultPrevented`) or an input method is composing
 *  - on close, restore focus to `returnFocusTo()` (or the element that was
 *    focused when the dialog opened)
 */
export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  returnFocusTo?: () => HTMLElement | null | undefined,
  options: {
    /** issue #307 - a mobile sheet is not modal: no Tab trap (overlayStack.ts) */
    kind?: OverlayKind
    /** where focus goes on opening, before the default first field / control */
    initialFocus?: () => HTMLElement | null | undefined
  } = {},
): void {
  const kind = options.kind ?? 'modal'
  // `kind`, `initialFocus` and `returnFocusTo` as of the latest commit, set after each commit. The
  // open effect reads all three when the dialog opens and keeps them until it closes: focus goes
  // back through the `returnFocusTo` the dialog opened with, as before. None is a reason to run the
  // effect again (#625 item 5: refs, exhaustive-deps)
  const kindRef = useRef(kind)
  const initialFocusRef = useRef(options.initialFocus)
  const returnFocusToRef = useRef(returnFocusTo)
  useEffect(() => {
    kindRef.current = kind
    initialFocusRef.current = options.initialFocus
    returnFocusToRef.current = returnFocusTo
  })
  // The newest `onEscape`, without making its IDENTITY a reason to run the
  // effect again. Most callers pass an inline arrow, which is a new function on
  // every render, so the effect used to tear down and set up on every render of
  // the owner: focus went back to the opener and then to the dialog's first
  // control again. That is invisible for a lone dialog and wrong for a nested
  // one. A sheet that opens a dialog re-renders when the dialog opens, and its
  // re-run took focus out of the dialog and back into the sheet behind the
  // scrim, where Tab then walked the covered rows. MEASURED on the mobile Help
  // sheet: after opening About or the contextual-tips dialog, the focused
  // element was outside the dialog.
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const d = ref.current
    // issue #307 - the top dialog or sheet alone answers Escape; a dialog over a
    // mobile sheet makes the rest inert. Registered before focus moves in, so
    // the page behind is already inert when it does.
    const kindAtOpen = kindRef.current
    const returnFocusToAtOpen = returnFocusToRef.current
    const removeEntry = d ? pushOverlay(d, kindAtOpen) : () => {}
    // the owner's choice, else the first usable field, else the first usable
    // control: with every field disabled that is the dialog's Close, first in
    // its head (the phone's read-only Inspector sheet; the Monte Carlo dialog
    // opened while its run goes)
    if (d) {
      const asked = initialFocusRef.current?.()
      const target = canTakeFocus(asked, d) ? asked : (firstUsable(d, FIELD) ?? firstUsable(d, FOCUSABLE))
      target?.focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTopOverlay(ref.current)) return
      if (e.key === 'Escape') {
        // #613 item 5 — an Escape inside an input-method composition is the
        // composition's own (it cancels or ends it), not a request to close:
        // closing here threw away a protected link, already gone from the
        // address. keyCode 229 is how some browsers report a composing key.
        if (e.isComposing || e.keyCode === 229) return
        // #613 item 1 — an Escape an earlier handler has used (and said so with
        // preventDefault) is not also a close: the phone's language search
        // clears its query, and the More sheet closed on the same key as well.
        // One Escape, one step; the next Escape reaches the dialog or sheet.
        // This also holds for an armed canvas tool's capture listener (it
        // disarms first) and the expression field's suggestion list.
        if (e.defaultPrevented) return
        e.preventDefault()
        onEscapeRef.current()
        return
      }
      // a sheet is not modal: Tab follows the page's own order out of it
      if (e.key !== 'Tab' || kindAtOpen !== 'modal' || !ref.current) return
      const within = ref.current
      const items = [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => canTakeFocus(el, within))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // the entry goes first: what focus returns to must not be inert
      removeEntry()
      // Opened from inside a sheet or dialog that is still open (About from the
      // phone's Help sheet): back to the control that opened it there. The
      // target the owner names (the top bar's More button) is outside what the
      // person is still working in. MEASURED with the target alone: focus left
      // the Help sheet, and while the page behind was inert it fell to <body>.
      const top = topOverlay()
      const back = top && opener?.isConnected && top.contains(opener) ? opener : (returnFocusToAtOpen?.() ?? opener)
      back?.focus?.()
    }
  }, [open, ref])
}
