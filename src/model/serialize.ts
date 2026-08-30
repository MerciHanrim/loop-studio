import { readRoutingPayload } from './edgeRouting'
import { defaultData } from './factory'
import { readParameterData, readRegisterData } from './model'
import type { LoopEdge, LoopNode, NodeKind } from './types'

export const STORAGE_KEY = 'loop-studio:graph:v1'
const SCHEMA = 'loop-studio/graph'
const SCHEMA_VERSION = 1

/**
 * Advisory execution defaults saved alongside the graph so a shared file
 * reproduces the run the author intended. NOT read by the engine — the app
 * applies the valid fields to the Monte-Carlo config on an explicit
 * document / template load only (never on localStorage restore). Every field
 * is optional; an unknown-shaped value is ignored on load.
 */
export type RecommendedRunConfig = {
  baseSeed?: number
  runs?: number
  steps?: number
  /** Pool ids to track; `[]` means every Pool. Filtered to the loaded graph. */
  tracked?: string[]
}

export type GraphDoc = {
  schema: string
  version: number
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
  /** loop-workspace/1 extension (SEMANTICS-W.md) — an opaque blob here; the
   *  Workspace reader validates it against the loaded graph. Absent on a plain
   *  Graph Export. */
  workspace?: unknown
  /** loop-revision/1 extension (SEMANTICS-R.md) — an opaque blob here; the
   *  revision reader validates it. On the autosave record it holds the
   *  lightweight project *header* (never `base.content`, never `workspace`) so
   *  the graph + its project lineage are one atomic `localStorage` write. */
  project?: unknown
}

const FLOW_KINDS: NodeKind[] = ['pool', 'source', 'drain', 'gate', 'converter', 'end']

/** Fill in fields an older or hand-made file may be missing (e.g. `activation`
 *  before it became `automatic` by default) without overriding saved values.
 *  For `parameter` / `register` (loop-model/1) the normalised `data` is the
 *  defensive reader's output (§M1.2 / §M2 — defaults filled, incoherent hints
 *  dropped). A model node whose shape cannot be seated (§R2-1.1) is left
 *  **exactly as authored**: the graph still loads, and the downstream
 *  `readRevisionSide` / canonical projection reject the `project` payload
 *  rather than silently repairing it. */
function normalizeNode(n: LoopNode): LoopNode {
  const kind = (n.data?.kind ?? (n.type as NodeKind | undefined)) as NodeKind | undefined
  if (!kind) return n

  if (kind === 'parameter' || kind === 'register') {
    const read = kind === 'parameter' ? readParameterData(n.data) : readRegisterData(n.data)
    if (!read.ok) return n
    return { ...n, type: n.type ?? kind, data: { ...read.data } as LoopNode['data'] }
  }

  if (!FLOW_KINDS.includes(kind)) return n
  return {
    ...n,
    type: n.type ?? kind,
    data: { ...defaultData(kind), ...n.data, kind } as LoopNode['data'],
  }
}

/** A handle id counts as "unset" when it is null, undefined, or empty. */
const isBlankHandle = (h: string | null | undefined): boolean => h == null || h === ''
const isStateHandle = (h: string | null | undefined): boolean => h?.startsWith('state') ?? false

/**
 * Backfill an edge's handle ids and data. Older / hand-made files (and the
 * templates) may leave `sourceHandle` / `targetHandle` null or '' — those bind
 * ambiguously once a node has more than one handle per side, so they snap to the
 * side circular ports (`out` / `in`). State handles (`state-source` /
 * `state-target`) are never rewritten; a blank handle on a state edge fills to
 * its state default instead.
 */
function normalizeEdge(e: LoopEdge): LoopEdge {
  const type = e.type ?? 'loop'
  const stateEdge =
    e.data?.kind === 'state' || isStateHandle(e.sourceHandle) || isStateHandle(e.targetHandle)

  // loop-revision/3 §R3-1.1 — accepted routing intent is appended TRAILING (the
  // canonical projection orders it explicitly; this keeps the serialized file
  // key order too). A bad payload is quarantined silently here; the import path
  // re-scans raw edges via `routingReadIssues` for the user warning.
  const routing = readRoutingPayload(e.data)

  if (stateEdge) {
    const prev = e.data?.kind === 'state' ? e.data : undefined
    return {
      ...e,
      type,
      sourceHandle: isBlankHandle(e.sourceHandle) ? 'state-source' : e.sourceHandle,
      targetHandle: isBlankHandle(e.targetHandle) ? 'state-target' : e.targetHandle,
      data: {
        kind: 'state',
        mode: prev?.mode ?? 'trigger',
        expr: prev?.expr ?? '',
        // `delay` (trigger only) is graph structure — keep it across a round-trip
        ...(typeof prev?.delay === 'number' ? { delay: prev.delay } : {}),
        ...(routing.route ? { route: routing.route } : {}),
        ...(routing.waypoints ? { waypoints: routing.waypoints } : {}),
      },
    }
  }

  const prevRes = e.data?.kind === 'resource' ? (e.data as Record<string, unknown>) : undefined
  const flow = prevRes?.flow
  return {
    ...e,
    type,
    sourceHandle: isBlankHandle(e.sourceHandle) ? 'out' : e.sourceHandle,
    targetHandle: isBlankHandle(e.targetHandle) ? 'in' : e.targetHandle,
    data: {
      kind: 'resource',
      flow: flow != null && flow !== '' ? (flow as string) : '1',
      // `resourceType` is authored graph structure (loop-model/1 §M4) — keep it
      // across a round-trip, like `delay` on a state edge. A string is kept
      // as-is here; the canonical projection normalises / drops it (§M4.1).
      ...(typeof prevRes?.resourceType === 'string' ? { resourceType: prevRes.resourceType } : {}),
      ...(routing.route ? { route: routing.route } : {}),
      ...(routing.waypoints ? { waypoints: routing.waypoints } : {}),
    } as LoopEdge['data'],
  }
}

/** Backfill a whole graph — used on file import and on template / paste load. */
export function normalizeGraph(g: { nodes: LoopNode[]; edges: LoopEdge[] }): {
  nodes: LoopNode[]
  edges: LoopEdge[]
} {
  return { nodes: g.nodes.map(normalizeNode), edges: g.edges.map(normalizeEdge) }
}

export function serialize(
  nodes: LoopNode[],
  edges: LoopEdge[],
  recommendedRunConfig?: RecommendedRunConfig,
  workspace?: unknown,
  project?: unknown,
): string {
  const doc: GraphDoc = { schema: SCHEMA, version: SCHEMA_VERSION, nodes, edges }
  if (recommendedRunConfig && typeof recommendedRunConfig === 'object') {
    doc.recommendedRunConfig = recommendedRunConfig
  }
  if (workspace && typeof workspace === 'object') {
    doc.workspace = workspace
  }
  if (project && typeof project === 'object') {
    doc.project = project
  }
  return JSON.stringify(doc, null, 2)
}

export function deserialize(text: string): {
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
  /** raw, unvalidated — the Workspace reader checks it against the loaded graph */
  workspace?: unknown
  /** raw, unvalidated — the revision reader (loop-revision/1) validates it */
  project?: unknown
} {
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
  const rrc =
    obj.recommendedRunConfig && typeof obj.recommendedRunConfig === 'object' && !Array.isArray(obj.recommendedRunConfig)
      ? (obj.recommendedRunConfig as RecommendedRunConfig)
      : undefined
  const workspace =
    obj.workspace && typeof obj.workspace === 'object' && !Array.isArray(obj.workspace)
      ? obj.workspace
      : undefined
  const project =
    obj.project && typeof obj.project === 'object' && !Array.isArray(obj.project)
      ? obj.project
      : undefined
  return {
    ...normalizeGraph({ nodes: obj.nodes as LoopNode[], edges: obj.edges as LoopEdge[] }),
    ...(rrc ? { recommendedRunConfig: rrc } : {}),
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
  }
}

/** Autosave record — the graph and, atomically in the same write, the
 *  lightweight `project` header (or nothing). One `localStorage.setItem`. */
export function saveToStorage(nodes: LoopNode[], edges: LoopEdge[], project?: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(nodes, edges, undefined, undefined, project))
  } catch {
    /* storage unavailable (private mode, quota) — silently skip */
  }
}

export function loadFromStorage():
  | { nodes: LoopNode[]; edges: LoopEdge[]; project?: unknown }
  | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return deserialize(text)
  } catch {
    return null
  }
}
