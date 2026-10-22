import { create } from 'zustand'
import { useGraphStore } from './graphStore'
import { suggestFrames, type AFEdge, type AFNode } from '../components/frames/autoFrames'
import { shownRect, type Side } from '../components/frames/autoFrameShown'
import { useFrameStore, type FrameRect } from './frameStore'
import { useUiStore } from './uiStore'

// docs/large-graph-readability-auto-frames.md §AF (Slice 4b) — the DERIVED
// auto-frame set behind "Suggest frames".
//
//   • recomputed ONLY on an explicit `suggest()` (P1, §AF4.1) — never on a
//     sim run, the Activity overlay, Focus, Filters, or a graph edit;
//   • session-only, nothing serialized (§AF6). Cleared on a whole-graph swap
//     (`graphStore.loadRev`), same signal that clears the 4a manual frames;
//   • `dismiss` splices one frame from the CURRENT set; it is not remembered —
//     the next `suggest` may re-propose it (§AF5 R8);
//   • a committed rename / resize PROMOTES an auto frame to a 4a transient
//     manual frame — that transition lives in the render layer (it moves the
//     frame into `frameStore`), here we only drop it from the auto set.

export type AutoFrame = {
  id: string
  /** 1-based ordinal in `suggestFrames` order — drives the default label
   *  `Area N` / `구역 N` when `label` is empty. */
  area: number
  label: string
  /** the ALGORITHM's rect (R0): what decided this frame, its order and its
   *  label — never redrawn, never grown (§AF8) */
  rect: FrameRect
  /** the clustered node ids — used only for the staleness signature and tests;
   *  the render layer treats the frame as a pure rectangle (no membership). */
  members: string[]
  /** the rect the frame is DRAWN with, and selected, moved, resized and
   *  promoted from (frames/autoFrameShown.ts): R0 grown to hold its members'
   *  outside names where that is safe; R0 itself in the previous structure */
  shown: FrameRect
  /** sides the members' names wanted beyond R0 that stayed at R0 for safety */
  shownHeld: Side[]
}

type AutoFrameStore = {
  autoFrames: AutoFrame[]
  /** structural signature of (graph, framed node positions) at the last
   *  `suggest`; `null` ⇒ never suggested this session. Drives the "recompute
   *  available" hint (§AF4.3). */
  lastSignature: string | null

  suggest: () => void
  dismissAuto: (id: string) => void
  removeAuto: (id: string) => void
  clearAuto: () => void
}

let seq = 0
const newId = (): string => `af_${Date.now().toString(36)}_${(seq++).toString(36)}`

/** the inputs `suggestFrames` needs, read from the live graph store. Only
 *  `id`, `kind` and `position` are passed — the algorithm's geometry is
 *  canonical and never reads React Flow's `measured` size (§AF8 / S9), so the
 *  store does not forward it. */
function graphInputs(): { nodes: AFNode[]; edges: AFEdge[] } {
  const g = useGraphStore.getState()
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      kind: (n.data as { kind?: string })?.kind ?? String(n.type),
      position: n.position,
    })),
    edges: g.edges.map((e) => ({ source: e.source, target: e.target })),
  }
}

/** a deterministic string over the structure + positions that would change the
 *  clustering or the rects. NOT a hash — a plain join is enough and is stable. */
export function graphSignature(nodes: AFNode[], edges: AFEdge[]): string {
  const n = nodes
    .map((nd) => `${nd.id}:${nd.kind}:${Math.round(nd.position.x)},${Math.round(nd.position.y)}`)
    .sort()
    .join('|')
  const e = edges
    .map((ed) => (ed.source < ed.target ? `${ed.source}~${ed.target}` : `${ed.target}~${ed.source}`))
    .sort()
    .join('|')
  return `${n}#${e}`
}

export const useAutoFrameStore = create<AutoFrameStore>((set) => ({
  autoFrames: [],
  lastSignature: null,

  suggest: () => {
    const { nodes, edges } = graphInputs()
    const results = suggestFrames(nodes, edges)
    // the shown rect: only under the node structure whose names stand outside
    const g = useGraphStore.getState()
    const outside = useUiStore.getState().nodeStructure === 'outside'
    const manual = useFrameStore.getState().frames
    set({
      autoFrames: results.map((r) => {
        const s = outside ? shownRect(r.rect, r.members, g.nodes, g.edges, manual) : { rect: r.rect, held: [] }
        return { id: newId(), area: r.area, label: '', rect: r.rect, members: r.members, shown: s.rect, shownHeld: s.held }
      }),
      // an empty result (a graph below the floor, or with no clusterable
      // structure) leaves NOTHING to be stale about — clear the signature so
      // the "recompute available" hint never lights on an empty set.
      lastSignature: results.length > 0 ? graphSignature(nodes, edges) : null,
    })
  },

  // §AF5 R8 — remove one from the current set; not remembered.
  dismissAuto: (id) => set((s) => ({ autoFrames: s.autoFrames.filter((f) => f.id !== id) })),
  // used by the render layer's "promote to manual" path (§AF5 R5).
  removeAuto: (id) => set((s) => ({ autoFrames: s.autoFrames.filter((f) => f.id !== id) })),

  clearAuto: () => set((s) => (s.autoFrames.length === 0 && s.lastSignature === null ? s : { autoFrames: [], lastSignature: null })),
}))

/** at least one auto frame exists (drives the "Clear suggested frames" control). */
export const hasAutoFrames = (s: AutoFrameStore): boolean => s.autoFrames.length > 0

/** true when the graph structure or a node position changed since the last
 *  `suggest` — the control shows a "recompute available" state (§AF4.3). Never
 *  recomputes on its own. */
export function autoFramesStale(lastSignature: string | null): boolean {
  if (lastSignature === null) return false
  const { nodes, edges } = graphInputs()
  return graphSignature(nodes, edges) !== lastSignature
}

// §AF6 / §AF4.2 — a whole-graph swap drops the derived set (same `loadRev`
// signal the 4a manual frames use). A plain edit never bumps `loadRev`, so the
// set survives an edit and just goes "stale" (§AF4.3).
let lastLoadRev = useGraphStore.getState().loadRev
useGraphStore.subscribe((g) => {
  if (g.loadRev === lastLoadRev) return
  lastLoadRev = g.loadRev
  useAutoFrameStore.getState().clearAuto()
})
