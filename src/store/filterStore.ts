import { create } from 'zustand'
import type { NodeKind } from '../model/types'
import { useGraphStore } from './graphStore'

// docs/large-graph-readability.md §LGR3.2 / §LGR3.4 — the transient (ephemeral)
// filter selections. In memory ONLY: never serialized, never in the undo stack,
// never in localStorage; cleared on every whole-graph (re)load and by Reset
// view. Filters HIDE (remove from the canvas, not hit-testable); Focus DIMS.
// The panel's open/closed state is a separate sticky preference (uiStore).

/** Edge classes the filter can hide (§LGR3.2 / LGR-D4):
 *  - `resource` / `state` — the two classes a canvas edge can currently have.
 *  - `hint` — the dependency-hint dotted edge (`docs/visual-language.md` §VL6:
 *    "removing this node also removes / retargets this edge"). It renders only
 *    inside the revision Review surface, never on the normal canvas, and
 *    `normalizeEdge` collapses any imported non-`state` edge to `resource`. The
 *    option is offered per the design doc and is future-proof; on a plain graph
 *    it matches nothing. */
export type EdgeClass = 'resource' | 'state' | 'hint'
export const EDGE_CLASSES: readonly EdgeClass[] = ['resource', 'state', 'hint']

/** The eight node kinds (`src/model/types.ts`), in reading order (§LGR3.2). */
export const NODE_KINDS: readonly NodeKind[] = [
  'source',
  'pool',
  'gate',
  'converter',
  'drain',
  'end',
  'parameter',
  'register',
]

/** The untyped resource-type bucket (§LGR3.2) — a pool / resource edge with no
 *  `resourceType`. A sentinel that can never be a normalised resource-type
 *  string (those are always non-empty). */
export const UNTYPED = ''

type FilterStore = {
  hiddenEdgeClasses: ReadonlySet<EdgeClass>
  /** normalised resource-type strings, or `UNTYPED` for the untyped bucket */
  hiddenResourceTypes: ReadonlySet<string>
  hiddenNodeKinds: ReadonlySet<NodeKind>

  toggleEdgeClass: (c: EdgeClass) => void
  toggleResourceType: (t: string) => void
  toggleNodeKind: (k: NodeKind) => void
  /** drop every selection (Reset view / graph reload / explicit Clear filters) */
  clear: () => void
}

const toggle = <T>(set: ReadonlySet<T>, v: T): Set<T> => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

const isEmpty = (s: FilterStore): boolean =>
  s.hiddenEdgeClasses.size === 0 &&
  s.hiddenResourceTypes.size === 0 &&
  s.hiddenNodeKinds.size === 0

export const useFilterStore = create<FilterStore>((set) => ({
  hiddenEdgeClasses: new Set(),
  hiddenResourceTypes: new Set(),
  hiddenNodeKinds: new Set(),

  toggleEdgeClass: (c) => set((s) => ({ hiddenEdgeClasses: toggle(s.hiddenEdgeClasses, c) })),
  toggleResourceType: (t) =>
    set((s) => ({ hiddenResourceTypes: toggle(s.hiddenResourceTypes, t) })),
  toggleNodeKind: (k) => set((s) => ({ hiddenNodeKinds: toggle(s.hiddenNodeKinds, k) })),
  clear: () =>
    set((s) =>
      isEmpty(s)
        ? s
        : {
            hiddenEdgeClasses: new Set<EdgeClass>(),
            hiddenResourceTypes: new Set<string>(),
            hiddenNodeKinds: new Set<NodeKind>(),
          },
    ),
}))

/** True when the filter is hiding anything (drives the "active" badge + the
 *  Clear-filters enabled state). */
export const filtersActive = (s: FilterStore): boolean => !isEmpty(s)

// §LGR3.4 — filter selections are dropped whenever the WHOLE graph is swapped
// (doc open, template load, Share / Workspace import, revision Apply). An edit
// never bumps `loadRev`, so a filter set survives while you tweak the graph.
let lastLoadRev = useGraphStore.getState().loadRev
useGraphStore.subscribe((g) => {
  if (g.loadRev === lastLoadRev) return
  lastLoadRev = g.loadRev
  useFilterStore.getState().clear()
})
