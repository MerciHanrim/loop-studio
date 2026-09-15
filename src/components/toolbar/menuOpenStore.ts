import { create } from 'zustand'

// Hanrim's UX report (2026-09-15): while any Tier-1 menu (Templates,
// Insert module, File, Data, Settings, Help, the ⋯ overflow menu) or
// Share's result panel is open, the palette's own hover tooltip could still
// pop up underneath it — two competing temporary UI layers at once. Each of
// those menus announces its own open/closed state here under a stable key;
// `Toolbar.tsx` reads the aggregate (`anyMenuOpenSelector`) to suppress
// palette tooltips for as long as anything is open. A tiny shared store,
// not a prop threaded through Toolbar.tsx's composition of these
// otherwise-unrelated components, since the palette is a sibling of all of
// them, not a parent.
type MenuOpenState = {
  open: Record<string, boolean>
  setOpen: (key: string, isOpen: boolean) => void
}

export const useMenuOpenStore = create<MenuOpenState>((set) => ({
  open: {},
  setOpen: (key, isOpen) =>
    set((s) => (s.open[key] === isOpen ? s : { open: { ...s.open, [key]: isOpen } })),
}))

export const anyMenuOpenSelector = (s: MenuOpenState): boolean => Object.values(s.open).some(Boolean)
