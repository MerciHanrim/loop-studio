import { useEffect, type RefObject } from 'react'

// docs/accessibility.md — `role="menu"` promises arrow-key navigation, and
// three Tier-1 menus (Templates, Module, File) declared the role without
// implementing it: opening one left focus on the trigger and ArrowDown /
// ArrowUp / Home / End did nothing, so the only way through was Tab, which
// walks straight out of the menu at the last item.
//
// Help joined them with issue #296: its menu is where the release notes are
// read again, and that has to work from a keyboard.
//
// Deliberately NOT applied to every `.menu` in the app. Settings, Overflow,
// Data import and the Distribution menu would gain behaviour nobody has
// specified yet (issue #307 is that specification); Theme and Language already
// implement their own arrow keys and would end up with two handlers on one
// keydown; Share's surface is a popover, not a menu.
//
// Activation is left to the browser. An item is a native `button`, so Enter
// and Space already fire its `onClick`; calling `.click()` from here as well
// would run the command twice. Help's feedback item is a native link, which
// Enter follows.

/** The items a keystroke may land on, read from the live popup at the moment
 *  the key arrives — `ExportMenuItems` contributes File's rows from another
 *  component, and a row can be disabled by state, so a list captured earlier
 *  would be wrong. `[role="separator"]` never matches. */
function usableItems(pop: HTMLElement): HTMLElement[] {
  return Array.from(pop.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (el) =>
      !el.hidden &&
      el.offsetParent !== null &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !(el as HTMLButtonElement).disabled,
  )
}

/**
 * Arrow / Home / End / Escape for one open menu popup.
 *
 * - ArrowDown from the trigger enters at the first item, ArrowUp at the last.
 * - Inside the list ArrowDown / ArrowUp step and wrap at both ends.
 * - Home / End jump to the first / last item.
 * - Escape closes the menu ONCE and returns focus to the trigger.
 *
 * Bound on `window` in the capture phase so Escape is handled before it can
 * reach anything else: the canvas's own Escape handlers listen on `document`
 * (capture) and the menus' legacy handlers on `window` (bubble), both of which
 * are downstream of this one, so `stopPropagation()` here leaves exactly one
 * owner for the key. The menu components therefore no longer register an
 * Escape handler of their own.
 *
 * `enterOnOpen` — when the menu opens with this set, focus goes to its first
 * item. A menu sets it when its button was activated from the keyboard (Enter,
 * Space, or a screen reader's own "activate"), which is what the menu button
 * pattern asks: otherwise focus stays on the button, and a screen reader, which
 * follows focus, is given none of the menu to read. A pointer click leaves it unset, so
 * focus stays on the button the person clicked. Opt-in: Help uses it (issue
 * #296, "read it again from Help" has to work from a keyboard); the other
 * menus are audited as one piece of work in issue #307.
 */
export function useMenuKeyboard(
  open: boolean,
  popRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  close: () => void,
  enterOnOpen = false,
): void {
  useEffect(() => {
    if (!open || !enterOnOpen) return
    const pop = popRef.current
    if (pop) usableItems(pop)[0]?.focus()
    // read once, when the menu opens: the popup is in the document by the time
    // an effect runs
  }, [open, enterOnOpen, popRef])

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
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const pop = popRef.current
      if (!pop) return
      const items = usableItems(pop)
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
