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

type GraphStore = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null

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
  loadJSON: (text: string) => void
  exportJSON: () => string
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function makeSample(): { nodes: LoopNode[]; edges: LoopEdge[] } {
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

  return {
    nodes: boot.nodes,
    edges: boot.edges,
    selectedNodeId: null,
    selectedEdgeId: null,

    onNodesChange: (changes) => {
      set({ nodes: applyNodeChanges(changes, get().nodes) })
      persist()
    },

    onEdgesChange: (changes) => {
      set({ edges: applyEdgeChanges(changes, get().edges) })
      persist()
    },

    onConnect: (conn) => {
      if (!conn.source || !conn.target) return
      const edge: LoopEdge = {
        id: nextId('e'),
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? null,
        targetHandle: conn.targetHandle ?? null,
        type: 'loop',
        data: { kind: 'resource', flow: '1' },
        markerEnd: { type: MarkerType.ArrowClosed },
      }
      set({ edges: addEdge(edge, get().edges) })
      persist()
    },

    addNodeAt: (kind, position) => {
      const node = createNode(kind, position)
      set({
        nodes: [...get().nodes, node],
        selectedNodeId: node.id,
        selectedEdgeId: null,
      })
      persist()
    },

    updateNodeData: (id, patch) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } as LoopNode['data'] } : n,
        ),
      })
      persist()
    },

    setEdgeData: (id, data) => {
      set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data } : e)) })
      persist()
    },

    removeNode: (id) => {
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
      })
      persist()
    },

    removeEdge: (id) => {
      set({ edges: get().edges.filter((e) => e.id !== id), selectedEdgeId: null })
      persist()
    },

    setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),

    newGraph: () => {
      set({ nodes: [], edges: [], selectedNodeId: null, selectedEdgeId: null })
      persist()
    },

    loadJSON: (text) => {
      const { nodes, edges } = deserialize(text)
      set({ nodes, edges, selectedNodeId: null, selectedEdgeId: null })
      persist()
    },

    exportJSON: () => serialize(get().nodes, get().edges),
  }
})
