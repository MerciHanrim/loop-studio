import type { LoopEdge, LoopNode } from './types'

export const STORAGE_KEY = 'loop-studio:graph:v1'
const SCHEMA = 'loop-studio/graph'
const SCHEMA_VERSION = 1

export type GraphDoc = {
  schema: string
  version: number
  nodes: LoopNode[]
  edges: LoopEdge[]
}

export function serialize(nodes: LoopNode[], edges: LoopEdge[]): string {
  const doc: GraphDoc = { schema: SCHEMA, version: SCHEMA_VERSION, nodes, edges }
  return JSON.stringify(doc, null, 2)
}

export function deserialize(text: string): { nodes: LoopNode[]; edges: LoopEdge[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Unexpected file contents.')
  }
  const obj = raw as Partial<GraphDoc>
  if (obj.schema !== SCHEMA) {
    throw new Error('This does not look like a Loop Studio graph file.')
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error('Graph file is missing its nodes or edges.')
  }
  return { nodes: obj.nodes as LoopNode[], edges: obj.edges as LoopEdge[] }
}

export function saveToStorage(nodes: LoopNode[], edges: LoopEdge[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(nodes, edges))
  } catch {
    /* storage unavailable (private mode, quota) — silently skip */
  }
}

export function loadFromStorage(): { nodes: LoopNode[]; edges: LoopEdge[] } | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return deserialize(text)
  } catch {
    return null
  }
}
