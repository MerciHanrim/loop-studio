import { readRoutingPayload } from './edgeRouting'
import { defaultData } from './factory'
import { readParameterData, readRegisterData } from './model'
import type { LoopEdge, LoopNode, NodeKind } from './types'

export const STORAGE_KEY = 'loop-studio:graph:v1'

/** loop-model/2 (SEMANTICS-M2.md §M2-1) — the model-semantics version rides the
 *  `schema` string, NOT `version`: a reader that does not recognise a `schema`
 *  value already rejects the file, so a pre-`loop-model/2` client fail-closes on
 *  a v2 document with no code change. `version` stays `1` for both (the JSON
 *  envelope shape is unchanged). */
export const SCHEMA_V1 = 'loop-studio/graph'
export const SCHEMA_V2 = 'loop-studio/graph/2'
const SCHEMA_VERSION = 1

export type ModelSemanticsVersion = 1 | 2

const SCHEMA_BY_MODEL_VERSION: Record<ModelSemanticsVersion, string> = {
  1: SCHEMA_V1,
  2: SCHEMA_V2,
}
/** The model-semantics version a `schema` string denotes, or `null` if the
 *  string is not a Loop Studio graph schema at all (⇒ the reader rejects it). */
export function modelVersionForSchema(schema: unknown): ModelSemanticsVersion | null {
  if (schema === SCHEMA_V1) return 1
  if (schema === SCHEMA_V2) return 2
  return null
}

/**
 * Advisory execution defaults saved alongside the graph so a shared file
 * reproduces the run the author intended. NOT read by the engine — the app
 * applies the Monte-Carlo fields (`baseSeed` / `runs` / `steps` / `tracked`)
 * and `canvasLocked` on an explicit document / template load only (never on
 * localStorage restore). Separately, the app's autosave record persists the
 * *current* in-app Timeline series selection under a one-field
 * `recommendedRunConfig` `{ timelineSeries }`, purely so a plain reload restores
 * that selection (see `saveToStorage`) — this is reload state, not a change to
 * the file-level meaning of any field here. Every field is optional; an
 * unknown-shaped value is ignored on load.
 */
export type RecommendedRunConfig = {
  baseSeed?: number
  runs?: number
  steps?: number
  /** Pool ids to track; `[]` means every Pool. Filtered to the loaded graph. */
  tracked?: string[]
  /**
   * Advisory Timeline display default: the series shown when the document is
   * opened — Pool **and** Register ids, sorted. Absent ⇒ every series is shown
   * (unchanged behaviour). Distinct from `tracked` (that is Monte-Carlo).
   *
   * A pure display preference: on document / template / Workspace / Share /
   * revision load it seeds the visible set, and every graph Export writes the
   * current value back. The app's autosave record ALSO persists whatever the
   * current selection is — the only `recommendedRunConfig` slice that does —
   * purely so a plain reload restores it (recommended subset + "+N more", never
   * the incoherent "every series shown, no collapse"). NEVER part of the
   * GraphDoc proper, the `loop-revision/*` digest, undo, or `simulationRev`.
   * Unknown / deleted ids are ignored, not an error.
   */
  timelineSeries?: string[]

  /**
   * Advisory: open the document with the Canvas **edit-locked** (nodes don't
   * move / connect, nothing deletes, the Inspector is read-only — selection,
   * pan / zoom, minimap, Timeline and the simulation still work). Absent /
   * falsey ⇒ unlocked (unchanged behaviour). Like `timelineSeries` it is a
   * UI-only preference — applied on load, written back by Export, never in the
   * GraphDoc / digest / undo. The user can flip the Controls lock at any time.
   */
  canvasLocked?: boolean
}

/**
 * LGR Slice 5 (`SEMANTICS-R5.md` / `docs/large-graph-readability-saved-frames.md`)
 * — a saved group frame. A labelled rectangle with an optional preset accent
 * and **no membership** (§LGR6.5). Graph-level, `loop-revision/5` **cosmetic**
 * content: it never reaches the engine, `SimState`, or the semantic digest, and
 * `frames` absent / empty ⇒ the file is byte-identical to a pre-Slice-5 file.
 * Only a MANUAL frame (drawn, or an auto frame the user promoted — §AF5 R5) is
 * ever written here; a pure suggested frame stays session-only.
 */
export const SF_FRAME_COLORS = ['slate', 'sage', 'gold', 'violet', 'rose'] as const
export type SavedFrameColor = (typeof SF_FRAME_COLORS)[number]
/** §R5-1.1 — the defensive-read caps. */
export const SF_LABEL_MAX = 120
export const SF_FRAMES_MAX = 200

export type SavedFrame = {
  id: string
  label: string
  rect: { x: number; y: number; w: number; h: number }
  color?: SavedFrameColor
}

export type GraphDoc = {
  schema: string
  version: number
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
  /** LGR Slice 5 (`loop-revision/5`, SEMANTICS-R5.md) — the saved manual group
   *  frames. Emitted only when non-empty; absent ⇒ no frames, byte-identical to
   *  a pre-Slice-5 file. Read defensively (`readSavedFrames`). */
  frames?: SavedFrame[]
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

let sfSeq = 0
const freshFrameId = (): string => `frame_${Date.now().toString(36)}_${(sfSeq++).toString(36)}`

/**
 * `SEMANTICS-R5.md §R5-1.1` — the defensive read of `GraphDoc.frames`. Drops a
 * bad ENTRY, never the graph. A file-clashing / missing `id` is replaced with a
 * fresh session id (the file's id string is not trusted for identity). `label`
 * is coerced + capped, `rect` kept verbatim (finite, positive size), `color`
 * kept only if it is a palette id. At most `SF_FRAMES_MAX` entries survive.
 * The `n` ordinal is never read — the store re-derives it from array order.
 */
export function readSavedFrames(raw: unknown): SavedFrame[] {
  if (!Array.isArray(raw)) return []
  const out: SavedFrame[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length >= SF_FRAMES_MAX) break
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const r = e.rect as Record<string, unknown> | undefined
    if (!r || typeof r !== 'object') continue
    const x = r.x
    const y = r.y
    const w = r.w
    const h = r.h
    if (
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof w !== 'number' || !Number.isFinite(w) || w <= 0 ||
      typeof h !== 'number' || !Number.isFinite(h) || h <= 0
    ) {
      continue
    }
    let id = typeof e.id === 'string' ? e.id : ''
    if (id === '' || seen.has(id)) id = freshFrameId()
    seen.add(id)
    let label = typeof e.label === 'string' ? e.label : e.label == null ? '' : String(e.label)
    if (label.length > SF_LABEL_MAX) label = label.slice(0, SF_LABEL_MAX)
    const frame: SavedFrame = {
      id,
      label,
      rect: { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, w, h },
    }
    if (typeof e.color === 'string' && (SF_FRAME_COLORS as readonly string[]).includes(e.color)) {
      frame.color = e.color as SavedFrameColor
    }
    out.push(frame)
  }
  return out
}

/** Project a live frame to the wire shape (`§R5-2.1` key order): `id`, `label`,
 *  `rect` (`x, y, w, h`), then `color` only when set. `n` / `selectedId` etc.
 *  are never emitted. */
function toDocFrame(f: SavedFrame): SavedFrame {
  const rect = { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h }
  return f.color ? { id: f.id, label: f.label, rect, color: f.color } : { id: f.id, label: f.label, rect }
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

/**
 * Project a live React Flow node / edge down to just the fields the document
 * owns. React Flow writes renderer state straight back onto the objects it is
 * given — `measured` (its ResizeObserver result), plus `selected` / `dragging`
 * as the user interacts — and those objects are the very ones the store hands to
 * `serialize()`. None of that belongs in a saved or shared graph: `measured`
 * depends on viewport size, fonts and *when* RF got round to measuring, so
 * letting it through makes the same graph export to different bytes on different
 * machines and even on the same machine before vs. after the first layout pass
 * (it broke the "a locale switch changes no exported byte" invariant the moment
 * RF finished measuring). `serialize()` is the single write boundary for every
 * persisted / exported form — Graph JSON, Share, Workspace, autosave — so the
 * projection to the schema shape (types.ts `LoopNode` / `LoopEdge`) happens here
 * once. Key order matches the committed example files.
 */
function toDocNode(n: LoopNode): LoopNode {
  return { id: n.id, type: n.type, position: n.position, data: n.data } as LoopNode
}

function toDocEdge(e: LoopEdge): LoopEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
    data: e.data,
  } as LoopEdge
}

export function serialize(
  nodes: LoopNode[],
  edges: LoopEdge[],
  recommendedRunConfig?: RecommendedRunConfig,
  workspace?: unknown,
  project?: unknown,
  modelVersion: ModelSemanticsVersion = 1,
  /** LGR Slice 5 — the saved MANUAL frames. Absent / empty ⇒ no `frames` key,
   *  byte-identical to a pre-Slice-5 file (`SEMANTICS-R5.md` R5-INV-2). */
  frames?: readonly SavedFrame[],
): string {
  const doc: GraphDoc = {
    schema: SCHEMA_BY_MODEL_VERSION[modelVersion] ?? SCHEMA_V1,
    version: SCHEMA_VERSION,
    nodes: nodes.map(toDocNode),
    edges: edges.map(toDocEdge),
  }
  if (recommendedRunConfig && typeof recommendedRunConfig === 'object') {
    doc.recommendedRunConfig = recommendedRunConfig
  }
  // §R5-2.1 — `frames` after `recommendedRunConfig`, only when non-empty.
  if (Array.isArray(frames) && frames.length > 0) {
    doc.frames = frames.map(toDocFrame)
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
  /** loop-model/2 — the model-semantics version this file declares (from `schema`). */
  modelVersion: ModelSemanticsVersion
  recommendedRunConfig?: RecommendedRunConfig
  /** LGR Slice 5 — the saved manual frames, already run through `readSavedFrames`
   *  (bad entries dropped, ids resolved, labels capped). `[]` when the file has
   *  none. The store re-derives the `n` ordinal from array order. */
  frames: SavedFrame[]
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
  const modelVersion = modelVersionForSchema(obj.schema)
  if (modelVersion == null) {
    // Unknown schema — including a newer `loop-studio/graph/N` a pre-N client
    // does not know (SEMANTICS-M2.md §M2-1: fail-closed, never a silent run).
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
    modelVersion,
    frames: readSavedFrames(obj.frames), // §R5-1.1 — [] when absent / all-bad
    ...(rrc ? { recommendedRunConfig: rrc } : {}),
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
  }
}

/** Autosave record — the graph and, atomically in the same write, the
 *  lightweight `project` header (or nothing) and the current Timeline series
 *  selection (as a one-field `recommendedRunConfig` `{ timelineSeries }`, or
 *  nothing while it is the "all" default) so a plain reload restores it. One
 *  `localStorage.setItem`. The Monte-Carlo fields and `canvasLocked` are
 *  deliberately NOT persisted here — they apply on an explicit document /
 *  template load only. */
export function saveToStorage(
  nodes: LoopNode[],
  edges: LoopEdge[],
  project?: unknown,
  timelineSeries?: 'all' | readonly string[],
  modelVersion: ModelSemanticsVersion = 1,
  /** LGR Slice 5 — the current saved manual frames, atomically in the same
   *  write. Absent / empty ⇒ no `frames` key. */
  frames?: readonly SavedFrame[],
): void {
  try {
    const rrc: RecommendedRunConfig | undefined =
      Array.isArray(timelineSeries) && timelineSeries.length > 0
        ? { timelineSeries: [...timelineSeries] }
        : undefined
    localStorage.setItem(
      STORAGE_KEY,
      serialize(nodes, edges, rrc, undefined, project, modelVersion, frames),
    )
  } catch {
    /* storage unavailable (private mode, quota) — silently skip */
  }
}

export function loadFromStorage():
  | {
      nodes: LoopNode[]
      edges: LoopEdge[]
      modelVersion: ModelSemanticsVersion
      recommendedRunConfig?: RecommendedRunConfig
      frames: SavedFrame[]
      project?: unknown
    }
  | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return deserialize(text)
  } catch {
    return null
  }
}
