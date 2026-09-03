import { create } from 'zustand'
import { setFrameHistorySidecar, useGraphStore } from './graphStore'
import { loadFromStorage, type SavedFrame } from '../model/serialize'

// docs/large-graph-readability.md §LGR6 — group frames.
// A frame is a labelled rectangle drawn BEHIND the nodes:
//   - it has NO membership model (LGR-D9 / §LGR6.5): `{ id, n, label, rect,
//     color? }` only. Nothing is "in" a frame; moving nodes never changes it;
//   - it survives sim Reset and "Reset view".
//
// LGR Slice 5 (`SEMANTICS-R5.md` / `docs/large-graph-readability-saved-frames.md`)
// — a MANUAL frame's `id` / `label` / `rect` / `color` is now DOCUMENT CONTENT:
//   - it round-trips reload / Import·Export / Share / Workspace / a Project
//     revision as `loop-revision/5` **cosmetic** content;
//   - every create / rename / resize / recolour / delete / `Clear all` is ONE
//     graph undo entry at the §SF11.1 granularity (Option A). `Suggest` /
//     `Dismiss` / `Clear suggested` on a *pure* auto frame stay session-only
//     and are NOT undo entries (that is `autoFrameStore`).
// The `rect` is in FLOW coordinates so the frame stays put under pan / zoom.
//
// docs/large-graph-readability-frame-colour.md (§FC) — a MANUAL frame may carry
// an optional accent `color` from a fixed 5-entry preset palette (absent =
// neutral). A pure auto frame never holds a `color`; an accent picked on an
// auto frame is chosen only at the moment it is promoted (§AF5 R5).

export type FrameRect = { x: number; y: number; w: number; h: number }

/** §FC1 — the preset accent palette (kept in sync with `SF_FRAME_COLORS`). */
export type FrameColor = 'slate' | 'sage' | 'gold' | 'violet' | 'rose'
export const FRAME_COLORS: readonly FrameColor[] = ['slate', 'sage', 'gold', 'violet', 'rose']

export type Frame = {
  id: string
  /** creation ordinal for this document, 1-based — drives the default label
   *  `Group N` / `그룹 N`. NOT serialized; re-derived from array order on load. */
  n: number
  label: string
  rect: FrameRect
  /** §FC — optional preset accent. Absent ⇒ neutral. */
  color?: FrameColor
}

type FrameStore = {
  frames: Frame[]
  toolArmed: boolean
  selectedId: string | null
  nextN: number

  armTool: () => void
  disarmTool: () => void
  selectFrame: (id: string | null) => void
  /** create a frame from a validated flow rect. One undo entry (`frame:add`);
   *  disarms the tool. Returns the new id. */
  addFrame: (rect: FrameRect) => string
  /** §AF5 R5 — promote a suggested (auto) frame to a MANUAL frame, keeping its
   *  label + rect (+ an accent if the promotion was a colour pick). ONE undo
   *  entry that bundles the promotion and its first edit
   *  (§SF11.1); the caller drops the auto frame from `autoFrameStore` — that is
   *  NOT on the undo stack, so undoing a promote removes only the manual frame
   *  and never revives the suggestion (§SF11.2). Returns the new id. */
  adoptFrame: (rect: FrameRect, label: string, color?: FrameColor) => string
  /** commit a rename. ONE undo entry; no-op if unchanged. */
  renameFrame: (id: string, label: string) => void
  /** apply a rect during / at the end of a resize gesture. The gesture is ONE
   *  undo entry — the per-move calls coalesce; a gesture that
   *  ends unchanged makes no entry (§SF11.1). */
  resizeFrame: (id: string, rect: FrameRect) => void
  /** §FC — set / change / clear (`null`) a frame's accent. ONE undo entry; no-op if it already holds that colour. */
  setFrameColor: (id: string, color: FrameColor | null) => void
  /** delete one frame. ONE undo entry. */
  removeFrame: (id: string) => void
  /** remove EVERY manual frame in ONE atomic undo entry — one `Ctrl+Z` brings them all back together (§SF11.1). */
  clearFrames: () => void

  /** LGR Slice 5 — replace the whole set from a document's saved frames (or
   *  `[]`). Re-derives `n` from array order (§SF6). NOT an undo entry — the
   *  caller (`graphStore.loadDoc` / undo·redo) owns the history boundary. */
  loadFrames: (saved: readonly SavedFrame[] | null) => void
  /** LGR Slice 5 — the wire-shaped snapshot for `serialize` / autosave / the
   *  undo sidecar. `SavedFrame[]` — `id / label / rect / color?`, no `n`. */
  snapshot: () => SavedFrame[]
}

let seq = 0
const newId = (): string => `frame_${Date.now().toString(36)}_${(seq++).toString(36)}`
const rectEq = (a: FrameRect, b: FrameRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** push ONE graph undo entry for the DISCRETE frame op about to happen (§SF11.1)
 *  — an empty tag never coalesces, so two frame ops in a row are two entries.
 *  The entry's node/edge snapshot is the current graph; its sidecar carries the
 *  PRE-mutation frames (read back by an undo). */
const beginUndo = () => useGraphStore.getState().commitHistory('')
/** push ONE undo entry for a resize / move GESTURE — a STABLE per-frame tag so
 *  the gesture's many calls coalesce (600 ms) into one entry (§SF11.1). */
const beginGestureUndo = (id: string) => useGraphStore.getState().commitHistory(`frame:gesture:${id}`)
/** schedule the autosave write so a frame-only change is not lost (§SF5). */
const afterChange = () => useGraphStore.getState().notifyFrameChange()

export const useFrameStore = create<FrameStore>((set, get) => ({
  frames: [],
  toolArmed: false,
  selectedId: null,
  nextN: 1,

  armTool: () => set({ toolArmed: true }),
  disarmTool: () => set((s) => (s.toolArmed ? { toolArmed: false } : s)),
  selectFrame: (id) => set((s) => (s.selectedId === id ? s : { selectedId: id })),

  addFrame: (rect) => {
    beginUndo()
    const id = newId()
    const n = get().nextN
    set((s) => ({
      frames: [...s.frames, { id, n, label: '', rect }],
      nextN: s.nextN + 1,
      toolArmed: false,
      selectedId: id,
    }))
    afterChange()
    return id
  },

  adoptFrame: (rect, label, color) => {
    beginUndo()
    const id = newId()
    const n = get().nextN
    set((s) => ({
      frames: [...s.frames, color ? { id, n, label, rect, color } : { id, n, label, rect }],
      nextN: s.nextN + 1,
      selectedId: id,
    }))
    afterChange()
    return id
  },

  renameFrame: (id, label) => {
    const f = get().frames.find((x) => x.id === id)
    if (!f || f.label === label) return
    beginUndo()
    set((s) => ({ frames: s.frames.map((x) => (x.id === id ? { ...x, label } : x)) }))
    afterChange()
  },

  resizeFrame: (id, rect) => {
    const f = get().frames.find((x) => x.id === id)
    if (!f || rectEq(f.rect, rect)) return
    beginGestureUndo(id) // coalesces across the gesture (§SF11.1)
    set((s) => ({ frames: s.frames.map((x) => (x.id === id ? { ...x, rect } : x)) }))
    afterChange()
  },

  setFrameColor: (id, color) => {
    const f = get().frames.find((x) => x.id === id)
    if (!f) return
    if (color === null ? f.color === undefined : f.color === color) return // no-op ⇒ no entry
    beginUndo()
    set((s) => ({
      frames: s.frames.map((x) => {
        if (x.id !== id) return x
        if (color === null) {
          const { color: _drop, ...rest } = x
          return rest
        }
        return { ...x, color }
      }),
    }))
    afterChange()
  },

  removeFrame: (id) => {
    if (!get().frames.some((f) => f.id === id)) return
    beginUndo()
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }))
    afterChange()
  },

  clearFrames: () => {
    if (get().frames.length === 0 && get().nextN === 1 && get().selectedId === null) return
    beginUndo() // ONE atomic entry for the whole clear (§SF11.1)
    set({ frames: [], nextN: 1, selectedId: null })
    afterChange()
  },

  // ── LGR Slice 5 — document load / undo sidecar (NO history of their own) ──
  loadFrames: (saved) => {
    const list = Array.isArray(saved) ? saved : []
    set({
      frames: list.map((f, i) => {
        const base: Frame = { id: f.id, n: i + 1, label: f.label, rect: { ...f.rect } }
        if (f.color) base.color = f.color as FrameColor
        return base
      }),
      nextN: list.length + 1,
      selectedId: null,
      toolArmed: false,
    })
  },

  snapshot: () =>
    get().frames.map((f) =>
      f.color
        ? { id: f.id, label: f.label, rect: { ...f.rect }, color: f.color }
        : { id: f.id, label: f.label, rect: { ...f.rect } },
    ),
}))

/** True when at least one frame exists (drives "Clear frames" enabled state). */
export const hasFrames = (s: FrameStore): boolean => s.frames.length > 0

// LGR Slice 5 (§SF11) — register the saved-frames undo sidecar: `graphStore`
// captures `snapshot()` into every history entry and calls `loadFrames()` on an
// undo / redo (and on `loadDoc` / `loadGraph` / `newGraph`), so one graph
// undo / redo — and every document load — restores the graph AND its saved
// frames together, with no separate frame history entry.
setFrameHistorySidecar({
  get: () => useFrameStore.getState().snapshot(),
  set: (snap) => useFrameStore.getState().loadFrames(snap as SavedFrame[] | null),
})

// Cold boot — `graphStore` seeds nodes/edges from the autosave record before
// this module registers the sidecar; seed the saved frames from the same
// record here so a plain reload restores them (§SF5 / §SF6).
try {
  const booted = loadFromStorage()
  if (booted?.frames?.length) useFrameStore.getState().loadFrames(booted.frames)
} catch {
  /* no storage / bad record — start with no frames */
}
