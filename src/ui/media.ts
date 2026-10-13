import { useSyncExternalStore } from 'react'

/**
 * The single source of truth for "this is the mobile view/run layout"
 * (docs/mobile.md §MV2). The identical text is used by the `@media` block in
 * `src/index.css`; `src/ui/media.query.test.ts` asserts the two stay in sync.
 *
 *   - `max-width: 720px`             — every phone in portrait + a narrow window
 *   - the landscape-short clause     — a phone turned sideways (~844x390): short
 *     AND not-wide AND a coarse pointer, so a short-but-wide desktop window is
 *     not mistaken for a phone.
 */
export const MOBILE_MEDIA_QUERY =
  '(max-width: 720px), (max-height: 500px) and (max-width: 950px) and (pointer: coarse)'

/** a `matchMedia` query in `useSyncExternalStore` form. SSR-safe. */
function mediaQuery(query: string) {
  return {
    subscribe(onChange: () => void): () => void {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    getSnapshot(): boolean {
      if (typeof window === 'undefined' || !window.matchMedia) return false
      return window.matchMedia(query).matches
    },
  }
}

const mobile = mediaQuery(MOBILE_MEDIA_QUERY)
const forcedColors = mediaQuery('(forced-colors: active)')

/** `true` while the viewport is in the mobile view/run layout. SSR-safe. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(mobile.subscribe, mobile.getSnapshot, () => false)
}

/** `true` under forced colours (Windows contrast themes). An inline SVG `fill`
 *  or `stroke` is not replaced by the system palette, so a view that paints a
 *  flow colour inline asks this instead (docs/flow-colour-and-compact-nodes.md
 *  FC-3.4: no flow colour under forced colours). SSR-safe. */
export function useForcedColors(): boolean {
  return useSyncExternalStore(forcedColors.subscribe, forcedColors.getSnapshot, () => false)
}

const systemDark = mediaQuery('(prefers-color-scheme: dark)')
/** the theme's own switch: `data-theme` on the root (src/theme/theme.ts), one
 *  observer for every reader */
const themeAttr = {
  subs: new Set<() => void>(),
  observer: null as MutationObserver | null,
  subscribe(onChange: () => void): () => void {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
    themeAttr.subs.add(onChange)
    if (!themeAttr.observer) {
      themeAttr.observer = new MutationObserver(() => themeAttr.subs.forEach((f) => f()))
      themeAttr.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    }
    const offSystem = systemDark.subscribe(onChange)
    return () => {
      themeAttr.subs.delete(onChange)
      offSystem()
    }
  },
}
const resolvedTheme = (): 'light' | 'dark' => {
  const set = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme')
  return set === 'light' || set === 'dark' ? set : systemDark.getSnapshot() ? 'dark' : 'light'
}

/** the theme the canvas is drawn in: the chosen one, else the system's.
 *  SSR-safe. */
export function useCanvasTheme(): 'light' | 'dark' {
  return useSyncExternalStore(themeAttr.subscribe, resolvedTheme, () => 'light')
}
