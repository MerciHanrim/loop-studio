import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'

// docs/accessibility.md — the ONE keyboard contract of every menu in the app
// (issue #307; Help first, in issue #296). A popup that declares `role="menu"`
// holds `menuitem` / `menuitemradio` rows and behaves as the W3C menu-button
// pattern asks:
//
//   - opened from the keyboard (Enter, Space, a screen reader's "activate"),
//     focus goes to the first item; opened with the pointer, it stays on the
//     button that was clicked
//   - Arrow Down on the CLOSED button opens the menu at the first item, Arrow
//     Up at the last (`useMenuTrigger`)
//   - inside, Arrow Down / Up step and wrap at both ends; Home / End jump;
//     separators and disabled items are never landed on
//   - Escape closes the menu ONCE and returns focus to its button
//   - Tab / Shift+Tab close the menu and move on from its BUTTON, to the next
//     or the previous control: Tab never walks from item to item
//   - an item chosen from the keyboard that opens no dialog (an insert, a
//     download, an outside link, a theme) returns focus to the button; one
//     that opens a dialog lets the dialog take focus, and the dialog returns
//     it to the button when it closes
//
// Popups that are not menus do not use this: Settings and the toolbar
// overflow are disclosures (their content is other controls, reached with
// Tab), Language is a combobox with a search field, Share is a popover.
// Typeahead (jump by first letter) is optional in the pattern and not done.
//
// Activation is left to the browser. An item is a native `button` (or link),
// so Enter and Space already fire its `onClick`; calling `.click()` from here
// as well would run the command twice.
//
// The keys are bound on `window` in the capture phase, so this hook is the one
// owner of each of them while the menu is open: the canvas's own Escape
// handlers listen on `document` (capture) and older handlers on `window`
// (bubble), both downstream, and `stopPropagation()` here stops them. A menu
// inside another (Theme inside Settings) is closed first, alone.

/** Where focus goes when the menu opens: the first item, the last, or nowhere
 *  (it stays on the button - a pointer open). */
export type MenuEntry = 'first' | 'last' | null

const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

/** The items a keystroke may land on, read from the live popup at the moment
 *  the key arrives — `ExportMenuItems` contributes File's rows from another
 *  component, and a row can be disabled by state, so a list captured earlier
 *  would be wrong. `[role="separator"]` never matches. */
export function usableItems(pop: HTMLElement): HTMLElement[] {
  return Array.from(pop.querySelectorAll<HTMLElement>(ITEM)).filter(
    (el) =>
      !el.hidden &&
      el.offsetParent !== null &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !(el as HTMLButtonElement).disabled,
  )
}

/** focus has nowhere to be: the page body, or an element that left the page */
const focusLost = (): boolean => {
  const a = document.activeElement
  return !a || a === document.body || !a.isConnected
}

/**
 * The menu button's own handlers: which way the menu was opened, and Arrow
 * Down / Up on the closed button. Spread `triggerProps` on the button;
 * `entry` goes to `useMenuKeyboard`.
 */
export function useMenuTrigger(open: boolean, setOpen: Dispatch<SetStateAction<boolean>> | ((open: boolean) => void)) {
  const [entry, setEntry] = useState<MenuEntry>(null)
  const set = setOpen as (v: SetStateAction<boolean>) => void
  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      // a click no pointer made (Enter, Space, a screen reader's activate)
      // carries no click count
      setEntry(e.detail === 0 ? 'first' : null)
      set(!open)
    },
    [open, set],
  )
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
      e.preventDefault()
      setEntry(e.key === 'ArrowDown' ? 'first' : 'last')
      set(true)
    },
    [open, set],
  )
  return { entry, triggerProps: { onClick, onKeyDown } }
}

/**
 * The keyboard of one open menu popup (see the contract above).
 *
 * `entry` — where focus goes when the menu opens (`useMenuTrigger`). `true`
 * means `'first'`, for a caller that tracks only "opened from the keyboard".
 */
export function useMenuKeyboard(
  open: boolean,
  popRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  close: () => void,
  entry: MenuEntry | boolean = null,
): void {
  const where: MenuEntry = entry === true ? 'first' : entry === false ? null : entry
  useReturnFocusAfterKeyboardChoice(open, popRef, triggerRef, ITEM)

  // focus the entry item once the popup can take focus: a flyout positioned
  // after its first measurement is `visibility: hidden` for a frame or two,
  // and a hidden element refuses focus
  useEffect(() => {
    if (!open || !where) return
    let frame = 0
    let tries = 0
    const attempt = () => {
      const pop = popRef.current
      const items = pop ? usableItems(pop) : []
      const target = where === 'first' ? items[0] : items[items.length - 1]
      target?.focus()
      if ((!target || document.activeElement !== target) && ++tries < 20) frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [open, where, popRef])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        triggerRef.current?.focus()
        return
      }
      if (e.key === 'Tab') {
        // close, and let the browser move on from the BUTTON: focusing it
        // before the default action makes Tab land after it, Shift+Tab before
        const inside = popRef.current?.contains(document.activeElement) || document.activeElement === triggerRef.current
        if (!inside) return
        e.stopPropagation()
        // the popup must be gone BEFORE the default action, or Tab would land
        // on its first item and focus would then be lost with it
        flushSync(close)
        triggerRef.current?.focus()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const p = popRef.current
      if (!p) return
      const items = usableItems(p)
      if (items.length === 0) return
      const here = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      e.stopPropagation()
      const next =
        e.key === 'Home'
          ? items[0]
          : e.key === 'End'
            ? items[items.length - 1]
            : here < 0
              ? // focus is still on the trigger (or left the list entirely)
                e.key === 'ArrowDown'
                ? items[0]
                : items[items.length - 1]
              : e.key === 'ArrowDown'
                ? items[(here + 1) % items.length]
                : items[(here - 1 + items.length) % items.length]
      next.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, popRef, triggerRef, close])
}

/**
 * A popup closed by a choice made from the keyboard (Enter or Space on one of
 * its `chosen` elements) gives focus back to its trigger if focus was left
 * nowhere - the item opened no dialog (an insert, a download, an outside link)
 * or took its own trigger away with it (a menu inside the toolbar overflow).
 * A dialog the item opened has taken focus by the frame after the commit, so
 * it keeps it. A pointer choice is left as it always was.
 */
export function useReturnFocusAfterKeyboardChoice(
  open: boolean,
  popRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  chosen: string = 'button, a[href]',
): void {
  const keyboardChoice = useRef(false)
  useEffect(() => {
    if (!open) return
    keyboardChoice.current = false
    const pop = popRef.current
    const onClick = (e: MouseEvent) => {
      // a click no pointer made (Enter, Space, a screen reader's activate)
      if (e.detail === 0 && (e.target as Element | null)?.closest?.(chosen)) keyboardChoice.current = true
    }
    // any pointer press after it makes the close a pointer one again
    const onPointer = () => {
      keyboardChoice.current = false
    }
    pop?.addEventListener('click', onClick, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      pop?.removeEventListener('click', onClick, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open, popRef, chosen])
  useEffect(() => {
    if (open || !keyboardChoice.current) return
    keyboardChoice.current = false
    const frame = requestAnimationFrame(() => {
      const t = triggerRef.current
      if (focusLost() && t?.isConnected) t.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, triggerRef])
}
