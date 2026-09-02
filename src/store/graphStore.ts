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
import type { RecommendedRunConfig } from '../model/serialize'
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
  saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion)
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
  saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion)
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

// The undo history carries an opaque per-frame "sidecar" alongside the graph.
// `projectStore` registers a get/set pair: `get()` reads the current project
// header when a frame is captured, `set(h)` restores the header a frame carries
// when undo/redo lands on it. This keeps the header lineage correct across any
// sequence of Apply + plain edits + undo/redo (SEMANTICS-R.md §R7.3) without a
// single global "last apply" variable. Not store state — no re-renders.
let historySidecar: { get: () => unknown; set: (h: unknown) => void } | null = null
export function setHistorySidecar(
  s: { get: () => unknown; set: (h: unknown) => void } | null,
): void {
  historySidecar = s
}
const sidecarNow = (): unknown => historySidecar?.get() ?? null

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
      saveToStorage(s.nodes, s.edges, autosaveProjectHeader, autosaveTimelineSeries, s.modelVersion)
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

  /** Snapshot the CURRENT state into history before a mutation is applied. */
  const commit = (tag: string) => {
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
      past: [...get().past, { nodes, edges, sidecar: sidecarNow() }].slice(-HISTORY_MAX),
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
    nodes: boot.nodes,
    edges: boot.edges,
    selectedNodeId: null,
    selectedEdgeId: null,
    simulationRev: 0,
    loadRev: 0,
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
      historySidecar?.set(prev.sidecar) // restore the project header this frame carried
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
      historySidecar?.set(next.sidecar) // restore the project header this frame carried
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
      })
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
      })
      bump()
      persist()
    },

    loadJSON: (text) => {
      const { nodes, edges, recommendedRunConfig, modelVersion } = deserialize(text)
      get().loadDoc({ nodes, edges }, modelVersion)
      return recommendedRunConfig
    },

    /** load already-deserialized (and normalized) nodes/edges — one `bump()`.
     *  Used by `loadJSON` and by the Workspace importer so the whole restore is
     *  a single `simulationRev` step (SEMANTICS-W.md §W5.1). */
    loadDoc: ({ nodes, edges }, modelVersion = 1) => {
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
      ),
  }
})
