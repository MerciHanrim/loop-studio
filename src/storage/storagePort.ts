// The one door to browser storage (issue #297, step 1).
//
// Every read and write of what Loop Studio keeps in this browser profile goes
// through `storagePort`. Today the port is a straight pass-through to
// `localStorage`: same keys, same values, same exceptions. Nothing about the
// product changes by routing through it.
//
// It exists because of what comes next. A temporary session must read nothing
// the previous person left and write nothing for the next one, and that can
// only be guaranteed if no code reaches storage on its own. So the rule is
// enforced, not requested: `npm run check:storage-port` fails on any use of
// `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` outside
// this file.
//
// What the port deliberately does NOT do:
//   - catch errors. `localStorage` throws when storage is unavailable (private
//     mode, a policy, a file:// origin in some browsers) and when the quota is
//     exceeded, and callers tell those apart — the autosave reports "quota"
//     versus "unavailable". The port throws exactly what the browser throws.
//   - cache the `localStorage` object. It is looked up on every call, so a test
//     that replaces the global is honoured.

/**
 * Every key Loop Studio stores, with what kind of thing it holds. A key that is
 * not listed here cannot be passed to the port: the type is the registry.
 *
 *   work        the document — diagram, frames, imported data, project lineage
 *   personal    something the person typed about themselves
 *   preference  how the app is set up in this browser
 *   onboarding  which first-run guidance has already been shown
 */
export const STORAGE_KEYS = {
  'loop-studio:graph:v1': 'work',
  'loop-studio:author': 'personal',
  'loop-studio:theme': 'preference',
  'loop-studio/ui-locale/1': 'preference',
  'loop-studio:canvas-locked': 'preference',
  'loop-studio:focus-mode': 'preference',
  'loop-studio:filter-panel': 'preference',
  'loop-studio:activity-overlay': 'preference',
  'loop-studio:minimap-collapsed': 'preference',
  'loop-studio:inputs-panel': 'preference',
  'loop-studio:summary-panel': 'preference',
  'loop-studio/guided-tour/1': 'onboarding',
  'loop-studio/contextual-help/1': 'onboarding',
  'loop-studio/import-quickstart/1': 'onboarding',
} as const

export type StorageKey = keyof typeof STORAGE_KEYS
export type StorageKeyKind = (typeof STORAGE_KEYS)[StorageKey]

export const storagePort = {
  /** the stored string, or `null` when the key is absent. Throws when storage is unavailable. */
  getItem(key: StorageKey): string | null {
    return localStorage.getItem(key)
  },
  /** Throws when storage is unavailable or the quota is exceeded. */
  setItem(key: StorageKey, value: string): void {
    localStorage.setItem(key, value)
  },
  /** Throws when storage is unavailable. */
  removeItem(key: StorageKey): void {
    localStorage.removeItem(key)
  },
}
