import { buildKind } from './buildKind'

// The one door to browser storage (issue #297).
//
// Every read and write of what Loop Studio keeps in this browser profile goes
// through `storagePort`. Behind the door sits a SESSION, and the session is
// what decides whether this browser profile is reached at all:
//
//   gate      the page has started and nobody has said yet whether this is a
//             personal browser or a shared one. EVERY call throws. Nothing is
//             read, nothing is written, until the gate is answered. The only
//             thing that may be read before that is the one non-sensitive mode
//             key, through `storageSession.readRemembered()`, and the only
//             thing that may be written is that same key, through
//             `storageSession.remember()`.
//   browser   a personal browser: the port is a straight pass-through to
//             `localStorage` - same keys, same values, same exceptions.
//   memory    a temporary session: the same keys and values, held in a Map that
//             lives as long as the page. Nothing the previous person left is
//             read, nothing is left for the next one. A crash or a forced close
//             needs no clean-up step, because nothing was ever stored.
//   closed    after "Reset all Loop Studio data", until the page reloads: reads
//             find nothing and writes are dropped, so the autosave flush that
//             runs on `pagehide` cannot store the document again.
//
// The rule is enforced, not requested: `npm run check:storage-port` fails on any
// use of `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`
// outside this file and the port's one other door, `themeBoot.js` (issue
// #302): a classic script inlined into <head> that reads the mode key and, only
// in a remembered personal browser, the theme, before the first paint. Both
// doors are scanned by the check and seen by the run-time trap in
// `e2e/storage-port-runtime.spec.ts`.
//
// What the port deliberately does NOT do in the `browser` state:
//   - catch errors. `localStorage` throws when storage is unavailable (private
//     mode, a policy, a file:// origin in some browsers) and when the quota is
//     exceeded, and callers tell those apart - the autosave reports "quota"
//     versus "unavailable". The port throws exactly what the browser throws.
//   - cache the `localStorage` object. It is looked up on every call, so a test
//     that replaces the global is honoured.

/**
 * Every key Loop Studio stores, with what kind of thing it holds. A key that is
 * not listed here cannot be passed to the port: the type is the registry.
 *
 *   mode        which kind of session this browser profile asked to start
 *               without being asked again (issue #297). Written only on an
 *               explicit choice, never read as a sign that a person was here.
 *   work        the document - diagram, frames, imported data, project lineage
 *   personal    something the person typed about themselves
 *   preference  how the app is set up in this browser
 *   onboarding  which first-run guidance has already been shown
 *   release     which release note this profile has been told about, and which
 *               one it has opened (issue #296)
 */
export const STORAGE_KEYS = {
  'loop-studio:storage-mode': 'mode',
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
  'loop-studio/whats-new/announced/1': 'release',
  'loop-studio/whats-new/opened/1': 'release',
} as const

export type StorageKey = keyof typeof STORAGE_KEYS
export type StorageKeyKind = (typeof STORAGE_KEYS)[StorageKey]

/** the one key that may be read before the gate and written by a temporary session */
export const STORAGE_MODE_KEY = 'loop-studio:storage-mode' satisfies StorageKey
/** the document record: the one key "Delete work data" removes */
export const WORK_KEY = 'loop-studio:graph:v1' satisfies StorageKey

/** `personal`: this browser is trusted, stored work is restored; `temporary`: no
 *  stored work, author information or preference is read or stored - the mode
 *  key itself is the one exception, written only when the person asked */
export type StorageMode = 'personal' | 'temporary'
export const isStorageMode = (v: unknown): v is StorageMode => v === 'personal' || v === 'temporary'

export type StorageSessionState = 'gate' | 'browser' | 'memory' | 'closed'

/** thrown by every call made before the gate was answered. A caller that
 *  catches storage errors treats it like unavailable storage, which is the
 *  safe reading: nothing stored is seen and nothing is stored. */
export class StorageGateError extends Error {
  constructor(op: string, key: string) {
    super(`Loop Studio: storage ${op} of "${key}" before the storage gate was answered`)
    this.name = 'StorageGateError'
  }
}

let state: StorageSessionState = 'gate'
/** the temporary session's storage: same keys, same strings, page-lifetime only */
let memory = new Map<string, string>()
/** what the mode key said when it was last read or written on this page */
let rememberedCache: StorageMode | null | undefined

export const storagePort = {
  /** the stored string, or `null` when the key is absent. Throws when storage is
   *  unavailable, and before the gate is answered. */
  getItem(key: StorageKey): string | null {
    switch (state) {
      case 'gate':
        throw new StorageGateError('read', key)
      case 'browser':
        return localStorage.getItem(key)
      case 'memory':
        return memory.get(key) ?? null
      case 'closed':
        return null
    }
  },
  /** Throws when storage is unavailable or the quota is exceeded, and before the
   *  gate is answered. A temporary session's write never fails: it is a Map. */
  setItem(key: StorageKey, value: string): void {
    switch (state) {
      case 'gate':
        throw new StorageGateError('write', key)
      case 'browser':
        localStorage.setItem(key, value)
        return
      case 'memory':
        memory.set(key, String(value))
        return
      case 'closed':
        return
    }
  },
  /** Throws when storage is unavailable, and before the gate is answered. */
  removeItem(key: StorageKey): void {
    switch (state) {
      case 'gate':
        throw new StorageGateError('remove', key)
      case 'browser':
        localStorage.removeItem(key)
        return
      case 'memory':
        memory.delete(key)
        return
      case 'closed':
        return
    }
  },
}

/**
 * The session behind the port: the ONLY code that changes the port's state, and
 * the only code that touches the mode key before the gate or from a temporary
 * session. Everything here that reaches `localStorage` directly says so.
 */
export const storageSession = {
  /** which door the port currently opens on */
  state(): StorageSessionState {
    return state
  },
  /** the kind of session running, or null before the gate and after a reset */
  mode(): StorageMode | null {
    return state === 'browser' ? 'personal' : state === 'memory' ? 'temporary' : null
  },

  /**
   * Answer the gate, or switch sessions later. `personal` opens the browser
   * door; `temporary` opens a FRESH in-memory store (a switch into a temporary
   * session starts from nothing, whatever was in memory before). The callers
   * that switch mid-session are the confirmation flows in the Settings area,
   * which have already asked what the switch does to the document.
   */
  use(mode: StorageMode): void {
    if (state === 'closed') throw new Error('Loop Studio: the storage session was reset; reload the page')
    memory = new Map()
    state = mode === 'personal' ? 'browser' : 'memory'
  },

  /**
   * The mode this browser profile asked to be started in without the gate, or
   * null when it never said (the gate is shown), when the value is not a mode,
   * when storage cannot be read, and ALWAYS in the portable file, which shows
   * the gate every time whatever a stored value says.
   *
   * Reads `localStorage` directly, in every state: this is the one read the
   * gate is allowed before it is answered, and it reads nothing else.
   */
  readRemembered(): StorageMode | null {
    if (buildKind() === 'portable') return (rememberedCache = null)
    try {
      const v = localStorage.getItem(STORAGE_MODE_KEY)
      return (rememberedCache = isStorageMode(v) ? v : null)
    } catch {
      return (rememberedCache = null)
    }
  },

  /**
   * What the last `readRemembered()` or `remember()` on this page established,
   * WITHOUT touching storage again: the Settings area shows it, and a
   * temporary session must not read the browser's storage a second time for
   * it. `undefined` until the boot has read it.
   */
  remembered(): StorageMode | null | undefined {
    return rememberedCache
  },

  /**
   * Remember a mode (the person ticked the box), or forget it (`null`). Writes
   * `localStorage` directly, in every state: a temporary session may store this
   * one non-sensitive key and nothing else. A no-op in the portable file, which
   * never remembers a mode. Best effort: storage that cannot be written leaves
   * the gate in place next time, which is the safe outcome.
   */
  remember(mode: StorageMode | null): void {
    if (buildKind() === 'portable') return
    try {
      if (mode === null) localStorage.removeItem(STORAGE_MODE_KEY)
      else localStorage.setItem(STORAGE_MODE_KEY, mode)
      rememberedCache = mode
    } catch {
      /* unwritable storage: nothing is remembered, the gate returns */
      rememberedCache = null
    }
  },

  /**
   * Remove ONE record from the browser's storage, whatever session is running:
   * "Delete work data" from a temporary session removes the document the
   * browser holds, not the temporary one. Throws what the browser throws.
   */
  removeFromBrowser(key: StorageKey): void {
    localStorage.removeItem(key)
  },

  /**
   * "Reset all Loop Studio data": every registered key is removed from the
   * browser's storage (the mode key included, so the gate is shown again), the
   * temporary store is emptied, and the port closes until the page reloads, so
   * that no flush on the way out can store anything again. Returns the keys
   * that were present. Throws what the browser throws, before anything closes.
   */
  resetAll(): string[] {
    const removed: string[] = []
    for (const key of Object.keys(STORAGE_KEYS)) {
      if (localStorage.getItem(key) !== null) removed.push(key)
      localStorage.removeItem(key)
    }
    memory = new Map()
    state = 'closed'
    return removed
  },

  /** TESTS ONLY: back to the gate, with an empty memory store. */
  __resetForTests(): void {
    memory = new Map()
    state = 'gate'
    rememberedCache = undefined
  },
}
