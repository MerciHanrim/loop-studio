import { create } from 'zustand'
import { buildKind, type BuildKind } from '../storage/buildKind'
import { storageSession, type StorageMode } from '../storage/storagePort'

// Issue #297 — the storage session as React sees it: which door the port is
// open on, what the mode key says, and which build this is. The port itself is
// the truth (`storageSession`); this store mirrors it so that the Settings
// area, the temporary-session chip and the loss warning re-render when a
// switch happens. It reads NO storage: `remembered` is what the boot module
// already read, or what a toggle just wrote, so a temporary session never
// touches the browser's storage for it again.
//
// Created by the app module, behind the gate: by the time this module is
// evaluated the port is open, and `mode()` is never null. The fallback is for
// the unit tests' bare imports only.

type SessionState = {
  /** the session running on this page */
  mode: StorageMode
  /** what the mode key says: skip the gate next time with this mode, or null for "ask" */
  remembered: StorageMode | null
  /** the portable file shows the gate every time and remembers nothing */
  build: BuildKind
  /** mirror the port again after a switch, a remember or a reset */
  sync: () => void
  /** remember a mode, or forget it; a no-op in the portable file */
  setRemembered: (mode: StorageMode | null) => void
}

const read = () => ({
  mode: storageSession.mode() ?? 'personal',
  remembered: storageSession.remembered() ?? null,
})

export const useSessionStore = create<SessionState>((set) => ({
  ...read(),
  build: buildKind(),
  sync: () => set(read()),
  setRemembered: (mode) => {
    storageSession.remember(mode)
    set(read())
  },
}))

export const selectTemporary = (s: SessionState): boolean => s.mode === 'temporary'
