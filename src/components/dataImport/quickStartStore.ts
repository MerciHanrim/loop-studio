import { create } from 'zustand'

// docs/data-import.md §DI17 — the import wizard's quick-start block: whether
// it is collapsed, and whether that was the USER's explicit choice (the
// header toggle) or the automatic collapse after the first successful
// import. Presentation only — never serialized, digested, or undone.
//
// The key is versioned: bump the trailing number when the quick-start copy
// is revised enough that everyone should see it expanded again.
export const QUICKSTART_STORAGE_KEY = 'loop-studio/import-quickstart/1'

export type QuickStartState = { collapsed: boolean; explicit: boolean }

/** A missing, corrupt, or foreign value reads as "expanded, not explicit" —
 *  never as "dismissed" (the same rule `hintStore` / the tour use). */
export function readQuickStartState(): QuickStartState {
  try {
    const raw = localStorage.getItem(QUICKSTART_STORAGE_KEY)
    if (!raw) return { collapsed: false, explicit: false }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { collapsed: false, explicit: false }
    const o = parsed as Record<string, unknown>
    return { collapsed: o.collapsed === true, explicit: o.explicit === true }
  } catch {
    return { collapsed: false, explicit: false }
  }
}

function write(state: QuickStartState): void {
  try {
    localStorage.setItem(QUICKSTART_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* non-fatal — the in-memory state still updates for the session */
  }
}

type QuickStartStore = QuickStartState & {
  /** the header toggle — an explicit user choice, persisted as such. */
  setCollapsed: (collapsed: boolean) => void
  /** after the first successful import: collapse by default, but NEVER
   *  override a state the user set explicitly. */
  markFirstSuccess: () => void
}

export const useQuickStartStore = create<QuickStartStore>((set, get) => ({
  ...readQuickStartState(),
  setCollapsed: (collapsed) => {
    const next = { collapsed, explicit: true }
    write(next)
    set(next)
  },
  markFirstSuccess: () => {
    const cur = get()
    if (cur.explicit || cur.collapsed) return
    const next = { collapsed: true, explicit: false }
    write(next)
    set(next)
  },
}))
