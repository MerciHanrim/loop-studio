import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { createNode, defaultData, nextId } from '../model/factory'
import {
  deserialize,
  loadFromStorage,
  type ModelSemanticsVersion,
  normalizeGraph,
  saveToStorage,
  serialize,
} from '../model/serialize'
import type { RecommendedRunConfig, SavedFrame } from '../model/serialize'
import type { LoopEdge, LoopEdgeData, LoopNode, NodeKind } from '../model/types'

type XY = { x: number; y: number }
type Snapshot = { nodes: LoopNode[]; edges: LoopEdge[] }
/** one undo-history frame: the graph AND an opaque sidecar (the loop-revision/1
 *  project header at that instant), so a single undo/redo restores both together
 *  even across several Apply / edit steps (SEMANTICS-R.md §R7.3). */
type HistoryEntry = { nodes: LoopNode[]; edges: LoopEdge[]; sidecar: unknown }

type GraphStore = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null

  /** bumped only on changes that alter what a simulation computes — structure
   *  (add/remove/connect) and simulation-relevant node/edge data. NOT position,
   *  selection, or a pure `label` rename. The sim store and the Monte-Carlo
   *  store watch this (to reset / to mark results stale). */
  simulationRev: number

  /** bumped only when the WHOLE graph is (re)loaded — `newGraph`, `loadGraph`,
   *  `loadDoc` (so: doc open, template load, Share / Workspace import, revision
   *  Apply). NOT an edit. docs/large-graph-readability.md §LGR3.4 — the filter
   *  store watches this to drop its ephemeral selections on a graph swap. */
  loadRev: number

  /** bumped only by `loadGraph` — a Templates load or a pasted graph: a
   *  whole-graph swap that carries NO viewport of its own and lands on top of
   *  another graph the user was already looking at. The Canvas watches this to
   *  re-fit the camera to the new graph once React Flow has measured it.
   *  Excluded on purpose: `newGraph` (empty canvas, nothing to fit) and
   *  `loadDoc` (file / Workspace / Share / revision import — a Workspace
   *  restores its own saved view, a plain file import keeps the camera). */
  fitRev: number

  /** true only while this session is still showing the untouched first-run
   *  sample (no `localStorage` graph at boot, nothing changed since). Cleared
   *  permanently by any edit / Import / Template / undo / redo / restore. A
   *  share link opens without a replace prompt only while this holds
   *  (SEMANTICS-U.md §U5.6 / D5). */
  pristineSample: boolean

  /** loop-model/2 (SEMANTICS-M2.md §M2-1) — the current document's
   *  model-semantics version. Set from the loaded `schema`, latched to `2` by
   *  the first leading-`@` `flow` commit (§M2-1.1), reset to `1` by `newGraph`.
   *  Passed to `serialize()` / autosave and to `step()` / Monte-Carlo. One-way
   *  per document: never returns to `1` except on a full new / v1 load. */
  modelVersion: ModelSemanticsVersion

  past: HistoryEntry[]
  future: HistoryEntry[]
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** LGR Slice 5 (§SF11) — `frameStore` calls this BEFORE a saved-frame
   *  mutation so the graph undo history gets one entry at the §SF11.1
   *  granularity. `framesOverride` pins the PRE-gesture frames (a resize/move
   *  commits once, at the first move). The entry's node/edge snapshot is the
   *  current graph; its sidecar carries the given (or current) frames. */
  commitHistory: (tag: string, framesOverride?: unknown) => void
  /** LGR Slice 5 — `frameStore` calls this AFTER a mutation so a frame-only
   *  change still schedules the autosave write (which serialises the live
   *  `frameStore.frames`). */
  notifyFrameChange: () => void

  onNodesChange: (changes: NodeChange<LoopNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LoopEdge>[]) => void
  onConnect: (conn: Connection) => void

  addNodeAt: (kind: NodeKind, position: XY) => void
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  setEdgeData: (id: string, data: LoopEdgeData) => void
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  setSelection: (nodeId: string | null, edgeId: string | null) => void
  newGraph: () => void
  loadGraph: (snapshot: Snapshot, modelVersion?: ModelSemanticsVersion) => void
  loadDoc: (
    doc: { nodes: LoopNode[]; edges: LoopEdge[] },
    modelVersion?: ModelSemanticsVersion,
    /** LGR Slice 5 — the doc's saved manual frames (already defensively read).
     *  Absent ⇒ `[]`. Loaded into `frameStore` as part of this ONE `loadDoc`
     *  (no separate undo entry — §SF11). */
    frames?: readonly SavedFrame[],
  ) => void
  /** returns the file's `recommendedRunConfig` (if any) for the caller to apply */
  loadJSON: (text: string) => RecommendedRunConfig | undefined
  exportJSON: (recommendedRunConfig?: RecommendedRunConfig) => string
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

// The lightweight loop-revision/1 project *header* (or null) that autosaves in
// the SAME `localStorage` record as the graph — one atomic write, so a graph
// and its project lineage can never come from two different moments
// (SEMANTICS-R.md review round 2). `projectStore` is the only writer, via
// `setAutosaveProjectHeader`; graphStore just carries the opaque value.
let autosaveProjectHeader: unknown = null

// The CURRENT Timeline visible-series selection (simStore, UI-only) rides in the
// SAME autosave record as the graph — the only `recommendedRunConfig` slice that
// survives a `localStorage` restore (serialize.ts), so a plain reload restores
// the selection instead of falling back to "every series shown, no collapse".
// This is reload state, not a reinterpretation of the file-level field.
// `simStore` is the only writer, via `setAutosaveTimelineSeries`; graphStore
// just carries the value so its own graph-edit saves don't drop it. Seeded from
// the boot record below.
let autosaveTimelineSeries: 'all' | string[] = 'all'

/** Set (or clear with `null`) the project header persisted alongside the graph,
 *  and flush it immediately with the current graph in one write. Called by
 *  `projectStore` on commit / open / clear. */
export function setAutosaveProjectHeader(header: unknown): void {
  autosaveProjectHeader = header ?? null
  clearTimeout(saveTimer)
  const s = useGraphStore.getState()
  saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion, liveFrames())
}

/** Persist the Timeline visible-series default into the autosave record and
 *  flush it immediately with the current graph in one write (mirrors
 *  `setAutosaveProjectHeader`). Called by `simStore` on every legend toggle /
 *  `setTimelineSeries`, so the choice survives a plain reload even with no
 *  intervening graph edit. `'all'` clears the field. */
export function setAutosaveTimelineSeries(ts: 'all' | readonly string[]): void {
  autosaveTimelineSeries = ts === 'all' ? 'all' : [...ts]
  clearTimeout(saveTimer)
  const s = useGraphStore.getState()
  saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion, liveFrames())
}

/** The raw project header from the last autosave record — read once by
 *  `projectStore` on boot. */
export function bootProjectHeader(): unknown {
  return loadFromStorage()?.project ?? null
}

/** The Timeline visible-series selection from the last autosave record — read
 *  once by `simStore` to seed its initial `timelineSeries`. `'all'` when the
 *  record is absent / has no `timelineSeries`. */
export function bootTimelineSeries(): 'all' | string[] {
  return autosaveTimelineSeries
}

// The undo history carries opaque per-frame "sidecars" alongside the graph.
// `projectStore` registers one (the loop-revision/1 project header lineage,
// SEMANTICS-R.md §R7.3); LGR Slice 5 (`SEMANTICS-R5.md` / §SF11) registers a
// second (the saved manual `frameStore.frames`), so a single undo / redo
// restores the graph AND its saved frames together. Each is a `get`/`set`
// pair — not store state, no re-renders.
type Sidecar = { get: () => unknown; set: (h: unknown) => void }
let projectSidecar: Sidecar | null = null
let frameSidecar: Sidecar | null = null
export function setHistorySidecar(s: Sidecar | null): void {
  projectSidecar = s
}
/** LGR Slice 5 — `frameStore` registers its saved-frames snapshot/restore pair
 *  here so a graph undo / redo carries the frames with it (§SF11). */
export function setFrameHistorySidecar(s: Sidecar | null): void {
  frameSidecar = s
}
type SidecarBundle = { p: unknown; f: unknown }
const sidecarNow = (framesOverride?: unknown): SidecarBundle => ({
  p: projectSidecar?.get() ?? null,
  f: framesOverride !== undefined ? framesOverride : (frameSidecar?.get() ?? null),
})
const restoreSidecar = (sc: unknown): void => {
  const b = (sc ?? { p: null, f: null }) as SidecarBundle
  projectSidecar?.set(b.p ?? null)
  frameSidecar?.set(b.f ?? null)
}
/** LGR Slice 5 — the live saved manual frames, for `serialize` / autosave. The
 *  `frameStore` snapshot is already `SavedFrame`-shaped (id / label / rect /
 *  color; no `n`). `undefined` when no frames or before `frameStore` registers. */
const liveFrames = (): readonly SavedFrame[] | undefined => {
  const f = frameSidecar?.get()
  return Array.isArray(f) && f.length > 0 ? (f as SavedFrame[]) : undefined
}

// ── save boundary (SEMANTICS of an undo step) ───────────────────────────────
// One history entry per discrete action. Continuous actions coalesce: a node
// drag is one entry; rapid edits to the same field within COALESCE_MS are one
// entry. Selection and simulation never create history.
const COALESCE_MS = 600
const HISTORY_MAX = 100
let lastTag = ''
let lastTagAt = 0

function makeSample(): Snapshot {
  return {
    nodes: [
      {
        id: 'sample-source',
        type: 'source',
        position: { x: 40, y: 150 },
        data: { ...defaultData('source'), label: 'Faucet' },
      },
      {
        id: 'sample-pool',
        type: 'pool',
        position: { x: 300, y: 130 },
        data: { ...defaultData('pool'), label: 'Gold', initial: 5 },
      },
      {
        id: 'sample-drain',
        type: 'drain',
        position: { x: 560, y: 150 },
        data: { ...defaultData('drain'), label: 'Upkeep' },
      },
    ],
    edges: [
      {
        id: 'sample-e1',
        source: 'sample-source',
        target: 'sample-pool',
        type: 'loop',
        data: { kind: 'resource', flow: '2' },
      },
      {
        id: 'sample-e2',
        source: 'sample-pool',
        target: 'sample-drain',
        type: 'loop',
        data: { kind: 'resource', flow: '1' },
      },
    ],
  }
}

export const useGraphStore = create<GraphStore>((set, get) => {
  const stored = loadFromStorage()
  const boot = normalizeGraph(stored ?? makeSample())
  const bootModelVersion: ModelSemanticsVersion = stored?.modelVersion ?? 1
  autosaveProjectHeader = stored?.project ?? null
  const bootTs = stored?.recommendedRunConfig?.timelineSeries
  autosaveTimelineSeries = Array.isArray(bootTs) && bootTs.length > 0 ? [...bootTs] : 'all'

  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const s = get()
      saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion, liveFrames())
    }, 400)
  }
  /** any full-document swap starts with "no project"; a project-aware caller
   *  (`projectStore.openRevisionFromFile`) re-sets the header right after. */
  const dropProjectHeader = () => {
    autosaveProjectHeader = null
  }

  /** One-way latch: the first edit / undo / redo / structural change ends the
   *  "pristine sample" state for the rest of the session (SEMANTICS-U.md §U5.6). */
  const clearPristine = () => {
    if (get().pristineSample) set({ pristineSample: false })
  }

  /** Snapshot the CURRENT state into history before a mutation is applied.
   *  `framesOverride` (LGR Slice 5) lets a caller pin the PRE-gesture saved
   *  frames — e.g. a frame resize/move commits once, at the first move, with
   *  the rect the frame had when the drag started (§SF11.1). */
  const commit = (tag: string, framesOverride?: unknown) => {
    const now = Date.now()
    const coalesce = tag !== '' && tag === lastTag && now - lastTagAt < COALESCE_MS
    lastTag = tag
    lastTagAt = now
    // 'remove' coalesces only within a single tick (node + cascaded edges),
    // never across two separate deletions.
    if (tag === 'remove') queueMicrotask(() => { if (lastTag === 'remove') lastTag = '' })
    clearPristine() // any edit / load / template — even a coalesced one — ends "pristine"
    if (coalesce) return
    const { nodes, edges } = get()
    set({
      past: [...get().past, { nodes, edges, sidecar: sidecarNow(framesOverride) }].slice(-HISTORY_MAX),
      future: [], // a fresh action discards the redo branch AND its sidecars
      canUndo: true,
      canRedo: false,
    })
  }

  /** Signal a simulation-relevant change (structure or node/edge data). */
  const bump = () => {
    clearPristine() // covers undo / redo / structural changes that skip `commit`
    set({ simulationRev: get().simulationRev + 1 })
  }

  return {
    commitHistory: (tag, framesOverride) => commit(tag, framesOverride),
    notifyFrameChange: () => persist(),

    nodes: boot.nodes,
    edges: boot.edges,
    selectedNodeId: null,
    selectedEdgeId: null,
    simulationRev: 0,
    loadRev: 0,
    fitRev: 0,
    pristineSample: stored == null,
    modelVersion: bootModelVersion,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
      const { past, future, nodes, edges } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      lastTag = ''
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        past: past.slice(0, -1),
        future: [{ nodes, edges, sidecar: sidecarNow() }, ...future].slice(0, HISTORY_MAX),
        canUndo: past.length > 1,
        canRedo: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      bump()
      persist()
      restoreSidecar(prev.sidecar) // restore the project header + saved frames this entry carried
    },

    redo: () => {
      const { past, future, nodes, edges } = get()
      if (!future.length) return
      const next = future[0]
      lastTag = ''
      set({
        nodes: next.nodes,
        edges: next.edges,
        past: [...past, { nodes, edges, sidecar: sidecarNow() }].slice(-HISTORY_MAX),
        future: future.slice(1),
        canUndo: true,
        canRedo: future.length > 1,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      bump()
      persist()
      restoreSidecar(next.sidecar) // restore the project header + saved frames this entry carried
    },

    onNodesChange: (changes) => {
      const dragging = changes.some((c) => c.type === 'position' && c.dragging)
      const settled = changes.some((c) => c.type === 'position' && c.dragging === false)
      const removed = changes.some((c) => c.type === 'remove')
      // 'remove' tag: a node deletion and the connected-edge deletions React Flow
      // cascades arrive as separate calls in the same tick — coalesce them into
      // one history entry so a single undo brings the node AND its edges back.
      if (removed) commit('remove')
      else if (dragging) commit('move')
      set({ nodes: applyNodeChanges(changes, get().nodes) })
      if (removed) bump()
      if (settled) lastTag = '' // end of a drag gesture
      persist()
    },

    onEdgesChange: (changes) => {
      const removed = changes.some((c) => c.type === 'remove')
      if (removed) commit('remove')
      set({ edges: applyEdgeChanges(changes, get().edges) })
      if (removed) bump()
      persist()
    },

    onConnect: (conn) => {
      if (!conn.source || !conn.target) return
      const viaState =
        conn.sourceHandle?.startsWith('state') || conn.targetHandle?.startsWith('state')
      const edge: LoopEdge = viaState
        ? {
            id: nextId('e'),
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle?.startsWith('state')
              ? conn.sourceHandle
              : 'state-source',
            targetHandle: conn.targetHandle?.startsWith('state')
              ? conn.targetHandle
              : 'state-target',
            type: 'loop',
            data: { kind: 'state', mode: 'trigger', expr: '' },
          }
        : {
            id: nextId('e'),
            source: conn.source,
            target: conn.target,
            // resource edges always ride the side circular ports
            sourceHandle: 'out',
            targetHandle: 'in',
            type: 'loop',
            data: { kind: 'resource', flow: '1' },
          }
      commit('')
      set({ edges: addEdge(edge, get().edges) })
      bump()
      persist()
    },

    addNodeAt: (kind, position) => {
      commit('')
      const node = createNode(kind, position)
      set({
        nodes: [...get().nodes, node],
        selectedNodeId: node.id,
        selectedEdgeId: null,
      })
      bump()
      persist()
    },

    updateNodeData: (id, patch) => {
      commit(`data:${id}`)
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } as LoopNode['data'] } : n,
        ),
      })
      // a pure `label` rename does not change what a simulation computes
      if (Object.keys(patch).some((k) => k !== 'label')) bump()
      persist()
    },

    setEdgeData: (id, data) => {
      commit(`edge:${id}`)
      const before = get().edges.find((e) => e.id === id)?.data as Record<string, unknown> | undefined
      set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data } : e)) })
      // loop-revision/3 §R3-3 — `route` / `waypoints` are cosmetic: they change
      // the canonical digest but NOTHING a simulation computes, so a routing-only
      // edit must not bump `simulationRev` (mirrors the pure-`label` exemption).
      const after = data as unknown as Record<string, unknown>
      const COSMETIC = new Set(['route', 'waypoints'])
      const touched = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter(
        (k) => !Object.is(before?.[k], after[k]),
      )
      // loop-model/2 (SEMANTICS-M2.md §M2-1.1) — the leading-`@` commit boundary:
      // the user editing a resource-edge `flow` and committing a value whose
      // trimmed form starts with `@` (reference well-formed OR malformed) is the
      // explicit action that promotes a v1 document to v2. One-way; opening /
      // saving a stored `@…` string never triggers this (it never calls here).
      if (
        get().modelVersion === 1 &&
        after.kind === 'resource' &&
        typeof after.flow === 'string' &&
        after.flow.trim().startsWith('@') &&
        !Object.is(before?.flow, after.flow)
      ) {
        set({ modelVersion: 2 })
      }
      if (touched.length === 0 || !touched.every((k) => COSMETIC.has(k))) bump()
      persist()
    },

    removeNode: (id) => {
      commit('')
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
      })
      bump()
      persist()
    },

    removeEdge: (id) => {
      commit('')
      set({ edges: get().edges.filter((e) => e.id !== id), selectedEdgeId: null })
      bump()
      persist()
    },

    setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),

    newGraph: () => {
      commit('')
      lastTag = ''
      dropProjectHeader()
      set({
        nodes: [],
        edges: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion: 1,
        loadRev: get().loadRev + 1,
        // `newGraph` does NOT bump `fitRev`: an empty canvas has nothing to fit,
        // and every e2e `resetAll()` calls this right before an `importGraph` —
        // bumping `fitRev` here would arm the Canvas re-fit against the graph
        // that import then loads.
      })
      frameSidecar?.set([]) // §SF6 — an empty canvas has no saved frames
      bump()
      persist()
    },

    loadGraph: (snapshot, modelVersion = 1) => {
      // templates and pasted graphs go through the same handle/field backfill
      const { nodes, edges } = normalizeGraph(snapshot)
      commit('')
      lastTag = ''
      dropProjectHeader()
      set({
        nodes,
        edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion,
        loadRev: get().loadRev + 1,
        fitRev: get().fitRev + 1,
      })
      // a Template / pasted graph carries no `frames` block (§SF2) — clear.
      frameSidecar?.set([])
      bump()
      persist()
    },

    loadJSON: (text) => {
      const { nodes, edges, recommendedRunConfig, modelVersion, frames } = deserialize(text)
      get().loadDoc({ nodes, edges }, modelVersion, frames)
      return recommendedRunConfig
    },

    /** load already-deserialized (and normalized) nodes/edges — one `bump()`.
     *  Used by `loadJSON`, the Workspace importer, and revision Apply so the
     *  whole restore is a single `simulationRev` step (SEMANTICS-W.md §W5.1).
     *  LGR Slice 5 — `frames`: an array (incl. `[]`) REPLACES `frameStore` with
     *  the doc's saved frames; `undefined` KEEPS the current frames (a revision
     *  Apply that carries no `frames` change must not wipe them). Either way
     *  this is part of the ONE `loadDoc` history entry — no per-frame undo
     *  entry (§SF11). */
    loadDoc: ({ nodes, edges }, modelVersion = 1, frames) => {
      commit('')
      lastTag = ''
      dropProjectHeader()
      set({
        nodes,
        edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion,
        loadRev: get().loadRev + 1,
      })
      if (frames !== undefined) frameSidecar?.set(frames) // §SF6 — replace with the doc's saved frames
      bump()
      persist()
    },

    exportJSON: (recommendedRunConfig) =>
      serialize(
        get().nodes,
        get().edges,
        recommendedRunConfig,
        undefined,
        undefined,
        get().modelVersion,
        liveFrames(),
      ),
  }
})
