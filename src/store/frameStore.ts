import { create } from 'zustand'
import { useGraphStore } from './graphStore'

// docs/large-graph-readability.md §LGR6 — TRANSIENT group frames (Slice 4a).
// A frame is a labelled rectangle drawn BEHIND the nodes for the current
// session only:
//   - state lives here, in memory, and NOWHERE else — never GraphDoc / digest /
//     Share / revision / SimState / localStorage (§LGR3.4 / LGR-INV-1);
//   - it has NO membership model (LGR-D9 / §LGR6.5): `{ id, n, label, rect }`
//     only. Nothing is "in" a frame; moving nodes never changes it;
//   - creating / renaming / resizing / deleting a frame is NOT an undo entry;
//   - a frame survives sim Reset and "Reset view"; only an explicit
//     `clearFrames()` removes them, and a whole-graph (re)load drops them.
// The `rect` is in FLOW coordinates so the frame stays put under pan / zoom.

export type FrameRect = { x: number; y: number; w: number; h: number }

export type Frame = {
  id: string
  /** creation ordinal in this session, 1-based — drives the default label
   *  `Group N` / `그룹 N` and never reused after a delete (§LGR-answers). */
  n: number
  /** the shown caption. Empty ⇒ the render layer falls back to the default for
   *  `n`. Identity is `id` ONLY — duplicates are allowed. */
  label: string
  rect: FrameRect
}

type FrameStore = {
  frames: Frame[]
  /** the one-shot "draw a frame" tool: armed by its Controls button, disarmed
   *  after ONE frame is created or on Esc / right-click / re-click. Frame mode
   *  is visually and behaviourally distinct from box-select / pan. */
  toolArmed: boolean
  /** the frame whose chrome (resize / delete) is shown, or null. Transient UI —
   *  cleared with the frames on a graph reload and on an empty-pane click. */
  selectedId: string | null
  /** next creation ordinal (monotonic within a session; reset with the graph) */
  nextN: number

  armTool: () => void
  disarmTool: () => void
  selectFrame: (id: string | null) => void
  /** create a frame from a (already normalised, already validated) flow rect.
   *  Returns the new id; disarms the tool. */
  addFrame: (rect: FrameRect) => string
  /** Slice 4b (§AF5 R5) — adopt a *suggested* (auto) frame as a transient
   *  manual frame: same as `addFrame` but keeps the given label and does NOT
   *  touch the tool. The new frame gets the next `Group N` ordinal for its
   *  empty-label fallback. Returns the new id. */
  adoptFrame: (rect: FrameRect, label: string) => string
  renameFrame: (id: string, label: string) => void
  resizeFrame: (id: string, rect: FrameRect) => void
  removeFrame: (id: string) => void
  clearFrames: () => void
}

let seq = 0
const newId = (): string => `frame_${Date.now().toString(36)}_${(seq++).toString(36)}`

export const useFrameStore = create<FrameStore>((set, get) => ({
  frames: [],
  toolArmed: false,
  selectedId: null,
  nextN: 1,

  armTool: () => set({ toolArmed: true }),
  disarmTool: () => set((s) => (s.toolArmed ? { toolArmed: false } : s)),
  selectFrame: (id) => set((s) => (s.selectedId === id ? s : { selectedId: id })),

  addFrame: (rect) => {
    const id = newId()
    const n = get().nextN
    set((s) => ({
      frames: [...s.frames, { id, n, label: '', rect }],
      nextN: s.nextN + 1,
      toolArmed: false,
      selectedId: id,
    }))
    return id
  },

  adoptFrame: (rect, label) => {
    const id = newId()
    const n = get().nextN
    set((s) => ({
      frames: [...s.frames, { id, n, label, rect }],
      nextN: s.nextN + 1,
      selectedId: id,
    }))
    return id
  },

  renameFrame: (id, label) =>
    set((s) => ({ frames: s.frames.map((f) => (f.id === id ? { ...f, label } : f)) })),

  resizeFrame: (id, rect) =>
    set((s) => ({ frames: s.frames.map((f) => (f.id === id ? { ...f, rect } : f)) })),

  removeFrame: (id) =>
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  clearFrames: () =>
    set((s) =>
      s.frames.length === 0 && s.nextN === 1 && s.selectedId === null
        ? s
        : { frames: [], nextN: 1, selectedId: null },
    ),
}))

/** True when at least one frame exists (drives "Clear frames" enabled state). */
export const hasFrames = (s: FrameStore): boolean => s.frames.length > 0

// §LGR3.4 — a whole-graph swap (`newGraph` / `loadGraph` / `loadDoc`: doc open,
// template load, Import, Workspace / Share restore, revision Apply) drops every
// transient frame AND resets the `Group N` counter to 1. An edit never bumps
// `loadRev`, so frames survive while you tweak the graph.
let lastLoadRev = useGraphStore.getState().loadRev
useGraphStore.subscribe((g) => {
  if (g.loadRev === lastLoadRev) return
  lastLoadRev = g.loadRev
  useFrameStore.getState().clearFrames()
})
