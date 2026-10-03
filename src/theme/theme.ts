import { storagePort } from '../storage/storagePort'

// Issue #302 — the colour theme: one reader, one writer, one place that applies it.
//
// The choice is `loop-studio:theme`, read through the storage port like every
// other key. `light` and `dark` set `data-theme` on the root element, which the
// stylesheet reads; `system` removes it, and the stylesheet follows
// `prefers-color-scheme`. A stored value that is none of the three, and storage
// that cannot be read at all, both mean `system`: nothing is thrown at start-up
// and nothing is written back.
//
// MEASURED before this (main 16020f2, dev server, production build and portable
// file, desktop and mobile): with `dark` stored, a reload opened in the light
// theme and every painted frame was light; `data-theme` appeared only when the
// Settings menu (or the More sheet) was opened, because the only code that read
// the key was the toggle inside that menu, which is mounted only while the menu
// is open. `applyStoredTheme()` runs from `src/main.tsx` before the first render.

export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_KEY = 'loop-studio:theme'
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

export const isThemeMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark'

/** the stored choice, or `system` when there is none, when the value is not a
 *  mode, or when storage cannot be read */
export function readStoredTheme(): ThemeMode {
  try {
    const v = storagePort.getItem(THEME_KEY)
    return isThemeMode(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** `data-theme` on the root element: set for `light` and `dark`, absent for `system` */
export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

/** at start-up: read, apply, and say what was applied. Writes nothing. */
export function applyStoredTheme(root?: HTMLElement): ThemeMode {
  const mode = readStoredTheme()
  applyTheme(mode, root)
  return mode
}
