import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { createNode, defaultData, nextId } from '../model/factory'
import { deserialize, loadFromStorage, saveToStorage, serialize } from '../model/serialize'
import type { LoopEdge, LoopEdgeData, LoopNode, NodeKind } from '../model/types'

type XY = { x: number; y: number }
type Snapshot = { nodes: LoopNode[]; edges: LoopEdge[] }

type GraphStore = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null

  past: Snapshot[]
  future: Snapshot[]
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
  loadGraph: (snapshot: Snapshot) => void
  loadJSON: (text: string) => void
  exportJSON: () => string
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

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
        markerEnd: { type: MarkerType.ArrowClosed },
      },
      {
        id: 'sample-e2',
        source: 'sample-pool',
        target: 'sample-drain',
        type: 'loop',
        data: { kind: 'resource', flow: '1' },
        markerEnd: { type: MarkerType.ArrowClosed },
      },
    ],
  }
}

export const useGraphStore = create<GraphStore>((set, get) => {
  const boot = loadFromStorage() ?? makeSample()

  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const s = get()
      saveToStorage(s.nodes, s.edges)
    }, 400)
  }

  /** Snapshot the CURRENT state into history before a mutation is applied. */
  const commit = (tag: string) => {
    const now = Date.now()
    const coalesce = tag !== '' && tag === lastTag && now - lastTagAt < COALESCE_MS
    lastTag = tag
    lastTagAt = now
    if (coalesce) return
    const { nodes, edges } = get()
    set({
      past: [...get().past, { nodes, edges }].slice(-HISTORY_MAX),
      future: [],
      canUndo: true,
      canRedo: false,
    })
  }

  return {
    nodes: boot.nodes,
    edges: boot.edges,
    selectedNodeId: null,
    selectedEdgeId: null,
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
        future: [{ nodes, edges }, ...future].slice(0, HISTORY_MAX),
        canUndo: past.length > 1,
        canRedo: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      persist()
    },

    redo: () => {
      const { past, future, nodes, edges } = get()
      if (!future.length) return
      const next = future[0]
      lastTag = ''
      set({
        nodes: next.nodes,
        edges: next.edges,
        past: [...past, { nodes, edges }].slice(-HISTORY_MAX),
        future: future.slice(1),
        canUndo: true,
        canRedo: future.length > 1,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      persist()
    },

    onNodesChange: (changes) => {
      const dragging = changes.some((c) => c.type === 'position' && c.dragging)
      const settled = changes.some((c) => c.type === 'position' && c.dragging === false)
      const removed = changes.some((c) => c.type === 'remove')
      if (removed) commit('')
      else if (dragging) commit('move')
      set({ nodes: applyNodeChanges(changes, get().nodes) })
      if (settled) lastTag = '' // end of a drag gesture
      persist()
    },

    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) commit('')
      set({ edges: applyEdgeChanges(changes, get().edges) })
      persist()
    },

    onConnect: (conn) => {
      if (!conn.source || !conn.target) return
      const viaState =
        conn.sourceHandle?.startsWith('state') || conn.targetHandle?.startsWith('state')
      const edge: LoopEdge = {
        id: nextId('e'),
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? null,
        targetHandle: conn.targetHandle ?? null,
        type: 'loop',
        data: viaState
          ? { kind: 'state', mode: 'trigger', expr: '' }
          : { kind: 'resource', flow: '1' },
        markerEnd: viaState ? undefined : { type: MarkerType.ArrowClosed },
      }
      commit('')
      set({ edges: addEdge(edge, get().edges) })
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
      persist()
    },

    updateNodeData: (id, patch) => {
      commit(`data:${id}`)
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } as LoopNode['data'] } : n,
        ),
      })
      persist()
    },

    setEdgeData: (id, data) => {
      commit(`edge:${id}`)
      set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data } : e)) })
      persist()
    },

    removeNode: (id) => {
      commit('')
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
      })
      persist()
    },

    removeEdge: (id) => {
      commit('')
      set({ edges: get().edges.filter((e) => e.id !== id), selectedEdgeId: null })
      persist()
    },

    setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),

    newGraph: () => {
      commit('')
      lastTag = ''
      set({ nodes: [], edges: [], selectedNodeId: null, selectedEdgeId: null })
      persist()
    },

    loadGraph: ({ nodes, edges }) => {
      commit('')
      lastTag = ''
      set({
        nodes: nodes.map((n) => ({ ...n })),
        edges: edges.map((e) => ({ ...e })),
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      persist()
    },

    loadJSON: (text) => {
      const { nodes, edges } = deserialize(text)
      commit('')
      lastTag = ''
      set({ nodes, edges, selectedNodeId: null, selectedEdgeId: null })
      persist()
    },

    exportJSON: () => serialize(get().nodes, get().edges),
  }
})
