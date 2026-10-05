import { useEffect, useRef, type RefObject } from 'react'
import { isTopOverlay, pushOverlay, topOverlay, type OverlayKind } from '../ui/overlayStack'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Focus behaviour shared by every app dialog and every mobile sheet:
 *  - on open, move focus to the first field (input/select) or the first
 *    focusable element
 *  - a dialog (`kind: 'modal'`, the default) traps Tab inside itself; a mobile
 *    sheet (`kind: 'sheet'`) does not, it is not modal (src/ui/overlayStack.ts)
 *  - Escape → `onEscape`, for the top dialog or sheet only
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
  const initialFocusRef = useRef(options.initialFocus)
  initialFocusRef.current = options.initialFocus
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
    const removeEntry = d ? pushOverlay(d, kind) : () => {}
    const target =
      initialFocusRef.current?.() ??
      d?.querySelector<HTMLElement>('input, select, textarea') ??
      d?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (!isTopOverlay(ref.current)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscapeRef.current()
        return
      }
      // a sheet is not modal: Tab follows the page's own order out of it
      if (e.key !== 'Tab' || kind !== 'modal' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
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
      const back = top && opener?.isConnected && top.contains(opener) ? opener : (returnFocusTo?.() ?? opener)
      back?.focus?.()
    }
    // returnFocusTo is intentionally not a dep — it's read at cleanup time; and
    // onEscape is read through its ref (above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref])
}
