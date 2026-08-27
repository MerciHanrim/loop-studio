import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Modal-dialog focus behaviour shared by every app dialog:
 *  - on open, move focus to the first field (input/select) or the first
 *    focusable element
 *  - trap Tab inside the dialog
 *  - Escape → `onEscape`
 *  - on close, restore focus to `returnFocusTo()` (or the element that was
 *    focused when the dialog opened)
 */
export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  returnFocusTo?: () => HTMLElement | null | undefined,
): void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const d = ref.current
    const target =
      d?.querySelector<HTMLElement>('input, select, textarea') ??
      d?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
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
      const back = returnFocusTo?.() ?? opener
      back?.focus?.()
    }
    // returnFocusTo is intentionally not a dep — it's read at cleanup time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref, onEscape])
}
