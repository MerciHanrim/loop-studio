// docs/diagram-layout.md §DL3.6 (issue #344) — the smart guides on screen: set
// by the drag snap (graphStore) during a pointer drag, briefly after a keyboard
// move, cleared when the gesture ends. Display only: nothing here reaches a
// document, the history or a simulation.

import { create } from 'zustand'
import type { Guide } from '../model/layout/smartGuides'

/** how long the row and column stay up after a keyboard move, ms */
export const KEY_GUIDE_MS = 1200

type GuideState = {
  guides: Guide[]
  /** a free (Alt) move: drawn faint */
  faint: boolean
  show: (guides: Guide[], faint: boolean) => void
  /** shown, then cleared after `KEY_GUIDE_MS` unless something replaced them */
  flash: (guides: Guide[]) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | undefined

const same = (a: Guide[], b: Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => g.axis === b[i].axis && g.at === b[i].at && g.from === b[i].from && g.to === b[i].to && g.kind === b[i].kind && g.strong === b[i].strong)

export const useGuideStore = create<GuideState>((set, get) => ({
  guides: [],
  faint: false,
  show: (guides, faint) => {
    clearTimeout(timer)
    if (get().faint === faint && same(get().guides, guides)) return
    set({ guides, faint })
  },
  flash: (guides) => {
    clearTimeout(timer)
    set({ guides, faint: false })
    timer = setTimeout(() => set({ guides: [] }), KEY_GUIDE_MS)
  },
  clear: () => {
    clearTimeout(timer)
    if (get().guides.length) set({ guides: [] })
  },
}))
