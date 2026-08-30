// Project Revision / Proposal — pure foundation (SEMANTICS-R.md, loop-revision/1).
//
// Slice 1A: types + constants, id validation + a secure mint, the canonical
// revision projection / JSON / digest (§R4), the RevisionDiff (§R5), the
// defensive `project` reader (§R10 steps 3/6), and the *pure* export planners
// (§R2.1 / §R6). NO store, NO autosave, NO UI, NO download side effects — the
// lifecycle that consumes these lands in Slice 1B.

import { edgeHasRoutingIntent } from './edgeRouting'
import { defaultData } from './factory'
import {
  normalizeResourceType,
  readParameterData,
  readRegisterData,
} from './model'
import { normalizeGraph } from './serialize'
import type { RecommendedRunConfig } from './serialize'
import type { FlowNodeKind, LoopEdge, LoopNode } from './types'
import { sha256Hex, sha256Js, utf8ByteLength, utf8Bytes } from './workspace'

// ── constants & formats (§R11) ──────────────────────────────────────────────

export const PROJECT_SCHEMA = 'loop-revision/1'
export const PROJECT_VERSION = 1

/** Crockford base32 — no I L O U (case-insensitive input, uppercase output). */
export const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_BODY_LEN = 26
export const PROJECT_ID_RE = /^proj_[0-9A-HJKMNP-TV-Z]{26}$/
export const REVISION_ID_RE = /^rev_[0-9A-HJKMNP-TV-Z]{26}$/

export const LINEAGE_MAX = 64
export const AUTHOR_NAME_KEY = 'loop-studio:author'
export const AUTHOR_NAME_MAX_BYTES = 80
export const AUTHOR_NOTE_MAX_BYTES = 1000
export const REVISION_FILE_MAX_BYTES = 8 * 1024 * 1024
/** lowercase 64-hex — a SHA-256 digest string */
export const HEX64 = /^[0-9a-f]{64}$/

// ── errors ─────────────────────────────────────────────────────────────────

/** Thrown by `mintId` when no secure RNG is available — export must abort
 *  (R-INV-12; `Math.random()` is never a fallback). */
export class SecureRandomUnavailableError extends Error {
  constructor() {
    super('secure random source unavailable — cannot mint a project/revision id')
    this.name = 'SecureRandomUnavailableError'
  }
}

/** Thrown by the canonical projection when it meets a non-finite number
 *  (§R4.1) — the content is invalid for revision purposes. */
export class InvalidRevisionContentError extends Error {
  constructor(where: string) {
    super(`non-finite number in revision content at ${where}`)
    this.name = 'InvalidRevisionContentError'
  }
}

// ── wire types (§R1) ───────────────────────────────────────────────────────

export type ProjectRole = 'revision' | 'proposal'

export type ProjectAuthor = { name?: string; note?: string }
export type ProjectMeta = {
  title?: string
  createdAt?: string
  author?: ProjectAuthor
  tool?: string
}

export type CanonicalNode = {
  id: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}
export type CanonicalEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  data: Record<string, unknown>
}
export type CanonicalContent = {
  nodes: CanonicalNode[]
  edges: CanonicalEdge[]
  recommendedRunConfig?: Record<string, unknown>
}

export type ProposalBase = {
  revisionId: string
  contentDigest: string
  content: CanonicalContent
}
export type AppliedProposal = {
  proposalId: string
  baseId: string
  baseDigest: string
}

/** The `project` object as it appears in a file (§R1). */
export type ProjectPayload = {
  schema: string
  version: number
  projectId: string
  revisionId: string
  parentId: string | null
  role: ProjectRole
  /** `fullContentDigest` of THIS file's own canonical revision content (the
   *  proposed content for a proposal). Optional integrity field — a reader that
   *  has the loaded graph cross-checks it; a mismatch drops the whole `project`
   *  payload (the graph still loads, R-INV-10); its absence is not an error. */
  contentDigest?: string
  base?: ProposalBase
  appliedProposal?: AppliedProposal
  lineage?: string[]
  meta?: ProjectMeta
}

// ── id validation & secure mint (§R11) ─────────────────────────────────────

export const isProjectId = (s: unknown): s is string =>
  typeof s === 'string' && PROJECT_ID_RE.test(s)
export const isRevisionId = (s: unknown): s is string =>
  typeof s === 'string' && REVISION_ID_RE.test(s)

/** 26 Crockford-base32 chars from `crypto.getRandomValues`. Rejection-samples
 *  so every char is uniform over the 32-symbol alphabet. Throws
 *  `SecureRandomUnavailableError` if no secure RNG is present. */
export function mintId(prefix: 'proj' | 'rev'): string {
  const g = globalThis.crypto
  if (!g || typeof g.getRandomValues !== 'function') throw new SecureRandomUnavailableError()
  const out: string[] = []
  const buf = new Uint8Array(ID_BODY_LEN * 2)
  while (out.length < ID_BODY_LEN) {
    try {
      g.getRandomValues(buf)
    } catch {
      throw new SecureRandomUnavailableError()
    }
    for (let i = 0; i < buf.length && out.length < ID_BODY_LEN; i++) {
      const v = buf[i] & 0x1f // 0..31 — the alphabet is exactly 32 symbols, no bias
      out.push(ID_ALPHABET[v])
    }
  }
  return `${prefix}_${out.join('')}`
}

// ── number / string normalisation (§R4.1) ─────────────────────────────────

function numOrThrow(n: number, where: string): number {
  if (!Number.isFinite(n)) throw new InvalidRevisionContentError(where)
  return n === 0 ? 0 : n // collapse -0; otherwise keep full precision (no rounding)
}

// ── canonical projection (§R4.2) ──────────────────────────────────────────

/** node `data` keys, in the frozen emit order, by kind (§R4.2 FIELDS_BY_KIND).
 *  `loop-revision/2` (`SEMANTICS-R2.md` §R2-2.2) appends a trailing
 *  `resourceType` to `pool` — emitted **only** when the normalised value is
 *  non-empty, so a graph with no resource types projects byte-identically to
 *  `loop-revision/1` (R2-INV-2). */
const NODE_FIELDS: Record<FlowNodeKind, readonly string[]> = {
  pool: ['kind', 'label', 'activation', 'initial', 'capacity', 'mode', 'resourceType'],
  source: ['kind', 'label', 'activation', 'mode'],
  drain: ['kind', 'label', 'activation', 'mode'],
  gate: ['kind', 'label', 'activation', 'distribution', 'mode'],
  converter: ['kind', 'label', 'activation', 'mode'],
  end: ['kind', 'label', 'activation', 'mode'],
}
/** `loop-revision/2` (`SEMANTICS-R2.md` §R2-2.1) — new node kinds, exact field
 *  order. Only reached for a `data.kind` of `parameter` / `register`. */
const MODEL_NODE_FIELDS: Record<'parameter' | 'register', readonly string[]> = {
  parameter: ['kind', 'label', 'value', 'min', 'max', 'step', 'unit'],
  register: ['kind', 'label', 'expr', 'unit', 'format'],
}
/** edge `data` keys, in the frozen emit order, by kind (§R4.2 EDGE_FIELDS_BY_KIND).
 *  `loop-revision/2` appends a trailing `resourceType` to `resource`;
 *  `loop-revision/3` (SEMANTICS-R3.md §R3-2.1) appends `route` then `waypoints`
 *  to **both** kinds — `resourceType` is NOT a `state`-edge field. Each new key
 *  is emitted only when non-default. */
const EDGE_FIELDS: Record<'resource' | 'state', readonly string[]> = {
  resource: ['kind', 'flow', 'resourceType', 'route', 'waypoints'],
  state: ['kind', 'mode', 'expr', 'delay', 'route', 'waypoints'],
}

const MODEL_NODE_KINDS = new Set(['parameter', 'register'])
/** every recognised node `data.kind` (flow + model). */
const NODE_KINDS = new Set(['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'])
const MODEL_KINDS = MODEL_NODE_KINDS

/**
 * `SEMANTICS-R2.md` §R2-1 — the purely-syntactic v1/v2 content predicate, run
 * on **normalised** nodes/edges (kind + normalised `resourceType` only). A doc
 * is `loop-revision/2` content iff it has a `parameter` / `register` node, or a
 * `pool` / `resource`-edge with a non-empty normalised `resourceType`. Inferred
 * from content — never a stored header field.
 */
export function isModelLayerContent(doc: {
  nodes: { data?: { kind?: unknown; resourceType?: unknown } | null }[]
  edges: { data?: { kind?: unknown; resourceType?: unknown } | null }[]
}): boolean {
  for (const n of doc.nodes) {
    const k = n.data?.kind
    if (k === 'parameter' || k === 'register') return true
    if (k === 'pool' && normalizeResourceType(n.data?.resourceType).value !== null) return true
  }
  for (const e of doc.edges) {
    if (e.data?.kind === 'resource' && normalizeResourceType(e.data?.resourceType).value !== null) return true
  }
  return false
}

/** normalised node data: kind defaults filled, `mode` made explicit */
function normNodeData(n: LoopNode): Record<string, unknown> {
  const kind = n.data.kind
  const merged: Record<string, unknown> = {
    ...(defaultData(kind) as unknown as Record<string, unknown>),
    ...(n.data as unknown as Record<string, unknown>),
    kind,
  }
  // `end` / `gate` `mode` default when the type leaves it optional
  if ((kind === 'gate' || kind === 'end') && merged.mode == null) merged.mode = 'pullAny'
  return merged
}

/**
 * `modelLayer: false` is the **literal `loop-revision/1` projection** — it
 * emits none of the `loop-revision/2` additions and *throws* if it meets a
 * `parameter` / `register` node. `readRevisionSide` verifies a v1 side against
 * this projection (§R2-5 / R2-INV-3) before lifting into the `modelLayer: true`
 * compare model.
 */
function projectNode(n: LoopNode, modelLayer: boolean): CanonicalNode {
  const kind = n.data.kind as string
  const position = {
    x: numOrThrow(n.position?.x ?? 0, `node ${n.id} position.x`),
    y: numOrThrow(n.position?.y ?? 0, `node ${n.id} position.y`),
  }
  const rawData = n.data as unknown as Record<string, unknown>

  // loop-revision/2 (§R2-2.1) — parameter / register. Defensive read first: an
  // unseatable shape is a malformed FILE (§R2-1.1), surfaced the same way a
  // non-finite number is (InvalidRevisionContentError ⇒ the caller drops
  // `project`, the graph still loads — R-INV-10 / R2-INV-9).
  if (MODEL_NODE_KINDS.has(kind)) {
    if (!modelLayer) {
      throw new InvalidRevisionContentError(`node ${n.id}: a ${kind} node is not loop-revision/1 content`)
    }
    const read = kind === 'parameter' ? readParameterData(rawData) : readRegisterData(rawData)
    if (!read.ok) throw new InvalidRevisionContentError(`node ${n.id} (${kind}): ${read.detail}`)
    const nd = read.data as unknown as Record<string, unknown>
    const data: Record<string, unknown> = {}
    for (const f of MODEL_NODE_FIELDS[kind as 'parameter' | 'register']) {
      if (nd[f] !== undefined) data[f] = nd[f]
    }
    return { id: n.id, position, data }
  }

  const fields = NODE_FIELDS[kind as FlowNodeKind]
  const src = normNodeData(n)
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    if (f === 'resourceType') {
      // loop-revision/2 (§R2-2.2) — trailing, only when non-empty after §M4.1
      if (!modelLayer) continue
      const rt = normalizeResourceType(src.resourceType).value
      if (rt !== null) data.resourceType = rt
      continue
    }
    let v = src[f]
    if (f === 'capacity') {
      // pool capacity: number (finite) or null (unbounded); absent ⇒ null
      v = v == null ? null : numOrThrow(v as number, `node ${n.id} data.capacity`)
    } else if (f === 'initial') {
      v = numOrThrow((v ?? 0) as number, `node ${n.id} data.initial`)
    }
    data[f] = v
  }
  return { id: n.id, position, data }
}

function projectEdge(e: LoopEdge, modelLayer: boolean): CanonicalEdge {
  const kind: 'resource' | 'state' = e.data?.kind === 'state' ? 'state' : 'resource'
  const fields = EDGE_FIELDS[kind]
  const src = e.data as Record<string, unknown> | undefined
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    if (f === 'kind') data.kind = kind
    else if (f === 'delay') data.delay = numOrThrow(((src?.delay ?? 0) as number) || 0, `edge ${e.id} data.delay`)
    else if (f === 'expr') data.expr = (src?.expr ?? '') as string
    else if (f === 'flow') data.flow = (src?.flow ?? '') as string
    else if (f === 'mode') data.mode = src?.mode
    else if (f === 'resourceType') {
      // loop-revision/2 (§R2-2.2) — trailing, only when non-empty after §M4.1
      if (!modelLayer) continue
      const rt = normalizeResourceType(src?.resourceType).value
      if (rt !== null) data.resourceType = rt
    }
    else if (f === 'route') {
      // loop-revision/3 (§R3-2.1) — conservative: only under the v2/v3
      // projection, and only when `route === "orthogonal"` survived.
      if (!modelLayer) continue
      if (src?.route === 'orthogonal') data.route = 'orthogonal'
    }
    else if (f === 'waypoints') {
      // §R3-2.2 — array in stored order, NOT deduped, each {x, y} verbatim
      // (§R4.1: -0 -> 0, no rounding). Only with `route: "orthogonal"`.
      if (!modelLayer) continue
      const wp = src?.waypoints
      if (src?.route === 'orthogonal' && Array.isArray(wp) && wp.length > 0) {
        data.waypoints = (wp as { x: number; y: number }[]).map((p) => ({
          x: numOrThrow(p.x === 0 ? 0 : p.x, `edge ${e.id} data.waypoints.x`),
          y: numOrThrow(p.y === 0 ? 0 : p.y, `edge ${e.id} data.waypoints.y`),
        }))
      }
    }
  }
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    data,
  }
}

function projectRunConfig(c: RecommendedRunConfig | undefined): Record<string, unknown> | undefined {
  if (!c || typeof c !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const k of ['baseSeed', 'runs', 'steps'] as const) {
    const v = c[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.trunc(v)
  }
  if (Array.isArray(c.tracked)) {
    const t = c.tracked.filter((x): x is string => typeof x === 'string')
    out.tracked = t
  }
  return Object.keys(out).length ? out : undefined
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * §R4.2 — the canonical revision projection of a graph doc. Operates on the
 * `normalizeGraph()` output; keeps `label` + full-precision `position` +
 * `recommendedRunConfig`; drops `workspace` / `project` / `meta` / selection /
 * every RF-render field. Throws `InvalidRevisionContentError` on a non-finite
 * number.
 */
export function canonicalContent(
  doc: {
    nodes: LoopNode[]
    edges: LoopEdge[]
    recommendedRunConfig?: RecommendedRunConfig
  },
  opts: { modelLayer?: boolean } = {},
): CanonicalContent {
  // `modelLayer` defaults to `true` — the conservative `loop-revision/2`
  // projection, byte-identical to `loop-revision/1` for a graph with no model
  // layer (R2-INV-2). `readRevisionSide` passes `false` to run the literal v1
  // projection when verifying a v1 side (§R2-5).
  const modelLayer = opts.modelLayer ?? true
  const g = normalizeGraph({ nodes: doc.nodes, edges: doc.edges })
  const out: CanonicalContent = {
    nodes: g.nodes.map((n) => projectNode(n, modelLayer)).sort(byId),
    edges: g.edges.map((e) => projectEdge(e, modelLayer)).sort(byId),
  }
  const rrc = projectRunConfig(doc.recommendedRunConfig)
  if (rrc) out.recommendedRunConfig = rrc
  return out
}

/**
 * §R4.3 — whitespace-free JSON with object keys in **insertion order** (the
 * projection built them in the frozen field-table order; arrays are already
 * id-sorted). Non-finite numbers are impossible here — `canonicalContent`
 * has already thrown.
 */
export function canonicalJson(x: CanonicalContent): string {
  return JSON.stringify(x)
}

/** §R4.4 — `fullContentDigest` = SHA-256 (lowercase hex) of the UTF-8 bytes of
 *  `canonicalJson(canonicalContent(doc))`. Web Crypto where present, pure-JS
 *  fallback elsewhere (shared with `loop-workspace/1`). */
export async function fullContentDigest(doc: {
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
}): Promise<string> {
  return sha256Hex(utf8Bytes(canonicalJson(canonicalContent(doc))))
}

/** synchronous digest of an already-built `CanonicalContent` (pure-JS SHA-256).
 *  Used where the caller has the projection in hand and wants no `await`. */
export function digestOfCanonical(c: CanonicalContent): string {
  return sha256Js(utf8Bytes(canonicalJson(c)))
}

// ── §R2-5 — the ordered read pipeline for one revision / proposal side ─────

export type SideVersion = 'loop-revision/1' | 'loop-revision/2' | 'loop-revision/3'
export type RevisionSideOk = {
  ok: true
  version: SideVersion
  /** the content in the common v2 compare model (byte-identical to the v1
   *  projection for a v1 side — R2-INV-2) */
  content: CanonicalContent
  /** true iff a `storedDigest` was supplied and matched the version-appropriate
   *  projection */
  digestVerified: boolean
}
export type RevisionSideFail = {
  ok: false
  /** which ordered stage rejected the side */
  stage: 'defensive-read' | 'digest'
  detail: string
}
export type RevisionSideResult = RevisionSideOk | RevisionSideFail

/**
 * `SEMANTICS-R2.md` §R2-5 — process one revision / proposal side in the FIXED
 * order, so "verify the v1 digest with the v1 projection, then lift" is a
 * tested call sequence, not an accident of the two projections happening to
 * agree:
 *
 *   1. `normalizeGraph` — kind defaults, handle backfill, the `resourceType`
 *      round-trip (`src/model/serialize.ts`).
 *   2. **defensive read** of every `parameter` / `register` — the §R2-1.1
 *      structural gate. An unseatable shape fails HERE (`stage:'defensive-read'`),
 *      before any projection or version decision.
 *   3. the **§R2-1 version predicate** on the *normalised* graph.
 *   4. project + verify: a **v1** side is projected with `{ modelLayer:false }`
 *      — the literal `loop-revision/1` projection — and its `storedDigest` is
 *      checked against THAT; a **v2** side against `{ modelLayer:true }`.
 *   5. **lift**: a verified v1 side is re-projected with `{ modelLayer:true }`
 *      (the common compare model). By R2-INV-2 the bytes are identical; this
 *      function asserts it rather than assuming it.
 *
 * `NodeKind` is not yet widened, so step 1 leaves a `parameter` / `register`
 * node *unchanged* (`normalizeNode` only defaults the six flow kinds) — default
 * fill + field normalisation for model nodes lives in the step-2 defensive read
 * until the editor-wiring slice moves it into `normalizeNode`.
 */
export function readRevisionSide(
  graph: { nodes: LoopNode[]; edges: LoopEdge[]; recommendedRunConfig?: RecommendedRunConfig },
  storedDigest?: string,
): RevisionSideResult {
  // 1 + 2 — normalise, then the structural gate (BEFORE any projection)
  const g = normalizeGraph({ nodes: graph.nodes, edges: graph.edges })
  for (const n of g.nodes) {
    const k = (n.data as { kind?: unknown } | undefined)?.kind
    if (typeof k !== 'string' || !NODE_KINDS.has(k)) {
      return { ok: false, stage: 'defensive-read', detail: `node ${n.id}: unreadable data (kind "${String(k)}")` }
    }
    if (k === 'parameter' || k === 'register') {
      const read = k === 'parameter'
        ? readParameterData(n.data as unknown)
        : readRegisterData(n.data as unknown)
      if (!read.ok) {
        return { ok: false, stage: 'defensive-read', detail: `node ${n.id} (${k}): ${read.detail}` }
      }
    }
  }

  // 3 — the version predicate on the normalised graph.
  //   SEMANTICS-R3.md §R3-1 / §R3-5.1 step 3 — inferred, per side, from the
  //   post-defensive-read content. Routing intent (a surviving
  //   `route: "orthogonal"` / non-empty `waypoints`) ⇒ v3; else the frozen
  //   `loop-revision/2` §R2-1 model-layer predicate ⇒ v2; else v1. v2 and v3
  //   share the conservative `{ modelLayer: true }` projection (§R3-INV-2).
  const hasRouting = g.edges.some((e) => edgeHasRoutingIntent(e.data))
  const hasModel = isModelLayerContent({
    nodes: g.nodes as { data?: { kind?: unknown; resourceType?: unknown } | null }[],
    edges: g.edges as { data?: { kind?: unknown; resourceType?: unknown } | null }[],
  })
  const version: SideVersion = hasRouting
    ? 'loop-revision/3'
    : hasModel
      ? 'loop-revision/2'
      : 'loop-revision/1'

  // 4 — project under the version-appropriate field set and verify the digest
  if (version === 'loop-revision/1') {
    const v1 = canonicalContent(graph, { modelLayer: false }) // the literal v1 projection
    if (storedDigest !== undefined && digestOfCanonical(v1) !== storedDigest) {
      return { ok: false, stage: 'digest', detail: 'stored digest does not match the loop-revision/1 projection' }
    }
    // 5 — lift into the common compare model; R2-INV-2 / R3-INV-2 say the bytes match
    const lifted = canonicalContent(graph, { modelLayer: true })
    if (canonicalJson(lifted) !== canonicalJson(v1)) {
      throw new InvalidRevisionContentError('R2-INV-2: lifting a v1 side changed its canonical bytes')
    }
    return { ok: true, version, content: lifted, digestVerified: storedDigest !== undefined }
  }

  // v2 + v3 both use the conservative projection; the label distinguishes them
  // for the loss report / UI (§R3-5).
  const v2 = canonicalContent(graph, { modelLayer: true })
  if (storedDigest !== undefined && digestOfCanonical(v2) !== storedDigest) {
    return {
      ok: false,
      stage: 'digest',
      detail: `stored digest does not match the ${version === 'loop-revision/3' ? 'loop-revision/3' : 'loop-revision/2'} projection`,
    }
  }
  return { ok: true, version, content: v2, digestVerified: storedDigest !== undefined }
}

// ── engine vs cosmetic (§R4.4 / §R5.2) ────────────────────────────────────

export type FieldTag = 'engine' | 'cosmetic' | 'advisory'

/**
 * `label` / `position` are `cosmetic`. `loop-revision/2` (`SEMANTICS-R2.md`
 * §R2-3) adds `advisory` — authored content that changes no computed value:
 * a Parameter tuning hint (`min` / `max` / `step` / `unit`), a Register display
 * hint (`unit` / `format`), or a `resourceType` tag. `parameter.value` and
 * `register.expr` stay `engine`. Everything else in the projection is `engine`.
 */
export function fieldTag(kind: 'node' | 'edge', field: string): FieldTag {
  if (kind === 'node' && (field === 'label' || field === 'position' || field === 'data.label')) {
    return 'cosmetic'
  }
  // loop-revision/3 §R3-3 — routing intent is cosmetic (like `label` / `position`):
  // projected, diffed, dirty-tracked; never engineAffecting, never advisoryAffecting.
  if (kind === 'edge' && (field === 'data.route' || field === 'data.waypoints')) return 'cosmetic'
  if (field === 'data.resourceType') return 'advisory'
  if (kind === 'node') {
    if (
      field === 'data.min' ||
      field === 'data.max' ||
      field === 'data.step' ||
      field === 'data.unit' ||
      field === 'data.format'
    ) {
      return 'advisory'
    }
  }
  return 'engine'
}

// ── RevisionDiff (§R5) ───────────────────────────────────────────────────

export type FieldChange = { field: string; base: unknown; proposed: unknown; tag: FieldTag }
export type ElementChange = { id: string; fields: FieldChange[] }
export type ElementBuckets<T> = {
  added: T[]
  removed: T[]
  changed: ElementChange[]
  unchangedCount: number
}
export type RunConfigChange =
  | { kind: 'added'; key: string; proposed: unknown }
  | { kind: 'removed'; key: string; base: unknown }
  | { kind: 'changed'; key: string; base: unknown; proposed: unknown }

export type RevisionDiff = {
  nodes: ElementBuckets<CanonicalNode>
  edges: ElementBuckets<CanonicalEdge>
  runConfig: RunConfigChange[]
  workspaceDiffers: boolean
  summary: {
    nodes: { added: number; removed: number; changed: number }
    edges: { added: number; removed: number; changed: number }
    runConfigChanged: boolean
    engineAffecting: boolean
    /** `loop-revision/2` (`SEMANTICS-R2.md` §R2-3 / R2-D1) — any `advisory`-tagged
     *  hunk (a tuning hint or a `resourceType` tag). Separate from
     *  `engineAffecting`: an advisory change is real revision content and feeds
     *  `dirty` / the diff / `nConf`, but never sets `engineAffecting`. */
    advisoryAffecting: boolean
    empty: boolean
  }
}

function indexById<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]))
}

/**
 * Deep structural equality, **key-order-independent** — a `base.content`
 * snapshot from an older file may carry `data` keys in a different order than
 * the freshly-projected proposed content; that must not read as a change
 * (R-INV-8, vector 19). Only plain JSON values occur here.
 */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // NaN never appears (canonicalContent throws); treat as plain !==
    return a === b
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEq(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  return ak.every((k) => k in bo && deepEq(ao[k], bo[k]))
}

function diffElement(
  kind: 'node' | 'edge',
  base: CanonicalNode | CanonicalEdge,
  proposed: CanonicalNode | CanonicalEdge,
): FieldChange[] {
  const fields: FieldChange[] = []
  const b = base as Record<string, unknown>
  const p = proposed as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(p)])
  for (const k of keys) {
    if (k === 'id') continue
    if (k === 'data') {
      const bd = (b.data ?? {}) as Record<string, unknown>
      const pd = (p.data ?? {}) as Record<string, unknown>
      for (const dk of new Set([...Object.keys(bd), ...Object.keys(pd)])) {
        if (!deepEq(bd[dk], pd[dk])) {
          fields.push({ field: `data.${dk}`, base: bd[dk], proposed: pd[dk], tag: fieldTag(kind, `data.${dk}`) })
        }
      }
      continue
    }
    if (!deepEq(b[k], p[k])) {
      fields.push({ field: k, base: b[k], proposed: p[k], tag: fieldTag(kind, k) })
    }
  }
  return fields
}

function bucket<T extends { id: string }>(
  kind: 'node' | 'edge',
  base: T[],
  proposed: T[],
): ElementBuckets<T> {
  const bi = indexById(base)
  const pi = indexById(proposed)
  const added: T[] = []
  const removed: T[] = []
  const changed: ElementChange[] = []
  let unchangedCount = 0
  for (const [id, pv] of pi) {
    const bv = bi.get(id)
    if (!bv) {
      added.push(pv)
      continue
    }
    if (deepEq(bv, pv)) {
      unchangedCount++
      continue
    }
    changed.push({ id, fields: diffElement(kind, bv as never, pv as never) })
  }
  for (const [id, bv] of bi) if (!pi.has(id)) removed.push(bv)
  added.sort(byId)
  removed.sort(byId)
  changed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { added, removed, changed, unchangedCount }
}

function diffRunConfig(
  base: Record<string, unknown> | undefined,
  proposed: Record<string, unknown> | undefined,
): RunConfigChange[] {
  const b = base ?? {}
  const p = proposed ?? {}
  const out: RunConfigChange[] = []
  for (const k of new Set([...Object.keys(b), ...Object.keys(p)]).values()) {
    const inB = k in b
    const inP = k in p
    if (inB && !inP) out.push({ kind: 'removed', key: k, base: b[k] })
    else if (!inB && inP) out.push({ kind: 'added', key: k, proposed: p[k] })
    else if (!deepEq(b[k], p[k])) out.push({ kind: 'changed', key: k, base: b[k], proposed: p[k] })
  }
  out.sort((a, x) => (a.key < x.key ? -1 : a.key > x.key ? 1 : 0))
  return out
}

/**
 * §R5 — the id-keyed three-/two-way diff over two `CanonicalContent`s.
 * Deterministic: element order and whitespace in the source files never
 * affect it. `workspaceDiffers` (§R5.3) is supplied by the caller (it is a
 * property of the raw files, not of their canonical content); it defaults to
 * `false`.
 */
export function computeRevisionDiff(
  base: CanonicalContent,
  proposed: CanonicalContent,
  opts: { workspaceDiffers?: boolean } = {},
): RevisionDiff {
  const nodes = bucket('node', base.nodes, proposed.nodes)
  const edges = bucket('edge', base.edges, proposed.edges)
  const runConfig = diffRunConfig(base.recommendedRunConfig, proposed.recommendedRunConfig)

  const anyEngine =
    nodes.added.length > 0 ||
    nodes.removed.length > 0 ||
    edges.added.length > 0 ||
    edges.removed.length > 0 ||
    nodes.changed.some((c) => c.fields.some((f) => f.tag === 'engine')) ||
    edges.changed.some((c) => c.fields.some((f) => f.tag === 'engine')) ||
    runConfig.length > 0

  // §R2-3 — any advisory-tagged changed field (a tuning hint or a resourceType
  // tag). Real revision content, but not engine-affecting.
  const anyAdvisory =
    nodes.changed.some((c) => c.fields.some((f) => f.tag === 'advisory')) ||
    edges.changed.some((c) => c.fields.some((f) => f.tag === 'advisory'))

  const empty =
    nodes.added.length === 0 &&
    nodes.removed.length === 0 &&
    nodes.changed.length === 0 &&
    edges.added.length === 0 &&
    edges.removed.length === 0 &&
    edges.changed.length === 0 &&
    runConfig.length === 0

  return {
    nodes,
    edges,
    runConfig,
    workspaceDiffers: opts.workspaceDiffers ?? false,
    summary: {
      nodes: { added: nodes.added.length, removed: nodes.removed.length, changed: nodes.changed.length },
      edges: { added: edges.added.length, removed: edges.removed.length, changed: edges.changed.length },
      runConfigChanged: runConfig.length > 0,
      engineAffecting: anyEngine,
      advisoryAffecting: anyAdvisory,
      empty,
    },
  }
}

// ── §R7A.3 three-way per-hunk check (drives §R7A.2 nConf AND Slice 2 apply) ──

/** read one projection field, `data.*` or a top-level key. */
function fieldOf(el: CanonicalNode | CanonicalEdge, field: string): unknown {
  const o = el as Record<string, unknown>
  if (field.startsWith('data.')) {
    const d = (o.data ?? {}) as Record<string, unknown>
    return d[field.slice(5)]
  }
  return o[field]
}

export type ThreeWayFieldVerdict = 'clean' | 'noop' | 'conflict'
/** one changed field of a `change` hunk, shown as base / proposed / yours */
export type HunkField = {
  field: string
  base: unknown
  proposed: unknown
  yours: unknown
  verdict: ThreeWayFieldVerdict
  tag: FieldTag
}
/**
 * One proposal-driven change, id-scoped, with its §R7A.3 verdict against the
 * target. `clean` = applies with no loss; `noop` = target already matches the
 * proposal; `conflict` = the target holds a third value (needs a per-item
 * choice). `yours` is the target's current canonical element (`null` = absent).
 */
export type ProposalHunk = {
  kind: 'add' | 'remove' | 'change'
  elementType: 'node' | 'edge'
  id: string
  verdict: ThreeWayFieldVerdict
  base?: CanonicalNode | CanonicalEdge
  proposed?: CanonicalNode | CanonicalEdge
  yours: CanonicalNode | CanonicalEdge | null
  /** present for `change` */
  fields?: HunkField[]
  /** a node `remove` hunk: incident edge hunk ids that must be resolved with it
   *  — each is a `remove` (drop the edge) OR a `change` that retargets an
   *  endpoint away from this node. The apply check is reference-based (does any
   *  edge still point at the removed node after the selection?), so retargets
   *  satisfy the dependency just as removals do. Surfaced to the user; never
   *  cascaded silently. */
  dependents?: string[]
  /** a node `remove` hunk: incident edges with **no** hunk to resolve them —
   *  an edge you added locally (target-only), or one the proposal keeps while
   *  removing the node. A STRUCTURAL CONFLICT: the node can't be removed, the
   *  hunk `verdict` is `conflict`, and it feeds `nConf` (⇒ `divergent`). */
  blockedBy?: string[]
}
export type ThreeWayPlan = {
  hunks: ProposalHunk[]
  /** §R7A.2 `nConf` — conflicting whole-hunks (`add`/`remove`) + conflicting
   *  fields of `change` hunks (a `change` whose target element was deleted
   *  counts once). `0` ⇒ `unknown ancestry`, `≥ 1` ⇒ `divergent`. */
  nConf: number
}

/**
 * §R7A.3 — the full three-way plan for every proposal hunk. `base.content`,
 * `canonicalContent(open graph)` and `canonicalContent(proposal top-level)`,
 * all three. Pure and deterministic (id-sorted). `recommendedRunConfig` plays
 * no part (the exporters never emit it into a revision's content).
 */
export function computeThreeWay(
  base: CanonicalContent,
  target: CanonicalContent,
  proposed: CanonicalContent,
): ThreeWayPlan {
  type El = CanonicalNode | CanonicalEdge
  const hunks: ProposalHunk[] = []
  for (const kind of ['node', 'edge'] as const) {
    const pick = (c: CanonicalContent): El[] => (kind === 'node' ? c.nodes : c.edges)
    const b = indexById<El>(pick(base))
    const t = indexById<El>(pick(target))
    const p = indexById<El>(pick(proposed))
    for (const id of [...new Set<string>([...b.keys(), ...p.keys()])].sort()) {
      const bv = b.get(id)
      const pv = p.get(id)
      const tv = t.get(id) ?? null
      if (!bv && pv) {
        // ADD
        const verdict: ThreeWayFieldVerdict = !tv ? 'clean' : deepEq(tv, pv) ? 'noop' : 'conflict'
        hunks.push({ kind: 'add', elementType: kind, id, verdict, proposed: pv, yours: tv })
      } else if (bv && !pv) {
        // REMOVE
        const verdict: ThreeWayFieldVerdict = !tv ? 'noop' : deepEq(tv, bv) ? 'clean' : 'conflict'
        hunks.push({ kind: 'remove', elementType: kind, id, verdict, base: bv, yours: tv })
      } else if (bv && pv && !deepEq(bv, pv)) {
        // CHANGE
        const fields: HunkField[] = diffElement(kind, bv as never, pv as never).map((f) => {
          const yours = tv ? fieldOf(tv, f.field) : undefined
          const verdict: ThreeWayFieldVerdict = !tv
            ? 'conflict' // §R7A.3 — id absent in target ⇒ conflict
            : deepEq(yours, f.proposed)
              ? 'noop'
              : deepEq(yours, f.base)
                ? 'clean'
                : 'conflict'
          return { field: f.field, base: f.base, proposed: f.proposed, yours, verdict, tag: f.tag }
        })
        const verdict: ThreeWayFieldVerdict = fields.some((f) => f.verdict === 'conflict')
          ? 'conflict'
          : fields.some((f) => f.verdict === 'clean')
            ? 'clean'
            : 'noop'
        hunks.push({ kind: 'change', elementType: kind, id, verdict, base: bv, proposed: pv, yours: tv, fields })
      }
    }
  }

  // node `remove` incident-edge analysis (Slice 2 review round 2). A dependent
  // is any incident edge that HAS a hunk (a `remove`, or a `change` that
  // retargets an endpoint) — the user resolves it with the node. An incident
  // edge with NO hunk (you added it locally, or the proposal keeps it while
  // deleting the node) is a STRUCTURAL CONFLICT: the hunk becomes `conflict`,
  // which feeds `nConf` below (so classification is `divergent`, never
  // "unknown ancestry · no field conflicts").
  const edgeHunkIds = new Set(hunks.filter((h) => h.elementType === 'edge').map((h) => h.id))
  for (const h of hunks) {
    if (h.kind !== 'remove' || h.elementType !== 'node') continue
    const incident = target.edges.filter((e) => e.source === h.id || e.target === h.id)
    const dependents = incident.filter((e) => edgeHunkIds.has(e.id)).map((e) => e.id).sort()
    const blockedBy = incident.filter((e) => !edgeHunkIds.has(e.id)).map((e) => e.id).sort()
    if (dependents.length) h.dependents = dependents
    if (blockedBy.length) {
      h.blockedBy = blockedBy
      h.verdict = 'conflict' // structural — counted in nConf
    }
  }

  let nConf = 0
  for (const h of hunks) {
    if (h.kind === 'change') {
      nConf += h.yours ? (h.fields ?? []).filter((f) => f.verdict === 'conflict').length : 1
    } else if (h.verdict === 'conflict') {
      nConf += 1
    }
  }

  return { hunks, nConf }
}

/** §R7A.2 `nConf` — the conflict count only (see {@link computeThreeWay}). */
export function countThreeWayConflicts(
  base: CanonicalContent,
  target: CanonicalContent,
  proposed: CanonicalContent,
): number {
  return computeThreeWay(base, target, proposed).nConf
}

// ── §R7.2 per-hunk selective apply — build the resulting REAL graph ─────────

const cloneEl = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export type HunkSelection = {
  /** `add` / `remove` hunk id → accept it (default: not accepted) */
  accept: Record<string, boolean>
  /** `change` hunk id → field name → 'proposed' (take theirs) | 'yours' (keep
   *  mine, the default for any unlisted field) */
  fieldChoices: Record<string, Record<string, 'proposed' | 'yours'>>
}
export type SelectiveApplyResult =
  | { ok: true; nodes: LoopNode[]; edges: LoopEdge[] }
  | { ok: false; reason: 'invalid-selection'; detail: string }

/**
 * §R7.2 — `target content + accepted hunks`. Operates on the REAL editor graphs
 * (not canonical) so element identity / render fields survive. Rejected hunks
 * leave the target untouched → unselected fields are byte-identical (D-cond 6).
 *
 * There is **NO implicit cascade** (Slice 2 review round 2). A node with a
 * `blockedBy` incident edge (no hunk can resolve it) is a structural conflict
 * and cannot be removed. Otherwise the dependency check is **reference-based**:
 * after every accepted hunk is applied, any edge still pointing at a missing
 * node — an accepted `add` edge whose node was not selected, or an incident
 * edge that was neither removed nor retargeted with the node — is refused as an
 * `invalid-selection` **before anything is loaded** (nothing is mutated in
 * place; the result is built in scratch maps).
 */
export function buildSelectiveApply(input: {
  target: { nodes: LoopNode[]; edges: LoopEdge[] }
  proposedFull: { nodes: LoopNode[]; edges: LoopEdge[] }
  plan: ThreeWayPlan
  selection: HunkSelection
}): SelectiveApplyResult {
  const { target, proposedFull, plan, selection } = input
  const bad = (detail: string): SelectiveApplyResult => ({ ok: false, reason: 'invalid-selection', detail })

  // ── structural conflicts refuse the selection up front ──
  for (const h of plan.hunks) {
    if (h.kind === 'remove' && h.elementType === 'node' && selection.accept[h.id] && h.blockedBy?.length) {
      return bad(
        `Node ${h.id} can't be removed — edge ${h.blockedBy.join(', ')} points at it and the proposal offers no way to move or drop it. Keep the node.`,
      )
    }
  }

  const nodes = new Map<string, LoopNode>(target.nodes.map((n) => [n.id, cloneEl(n)]))
  const edges = new Map<string, LoopEdge>(target.edges.map((e) => [e.id, cloneEl(e)]))
  const pNodes = new Map<string, LoopNode>(proposedFull.nodes.map((n) => [n.id, n]))
  const pEdges = new Map<string, LoopEdge>(proposedFull.edges.map((e) => [e.id, e]))

  const setField = (el: Record<string, unknown>, field: string, value: unknown) => {
    // a `cosmetic` key the proposal drops (`route` / `waypoints` back to Bézier,
    // a cleared `resourceType`) diffs as `proposed: undefined` — take that as
    // "remove the key", never a literal `undefined` value (§R3-6 / R3-INV-9).
    if (field.startsWith('data.')) {
      const key = field.slice(5)
      const data = { ...(el.data as Record<string, unknown>) }
      if (value === undefined) delete data[key]
      else data[key] = cloneEl(value)
      el.data = data
    } else if (value === undefined) {
      delete el[field]
    } else {
      el[field] = cloneEl(value)
    }
  }

  for (const h of plan.hunks) {
    const store = h.elementType === 'node' ? nodes : edges
    const psrc = h.elementType === 'node' ? pNodes : pEdges
    if (h.kind === 'add') {
      if (!selection.accept[h.id]) continue
      const real = psrc.get(h.id)
      if (!real) return bad(`Proposal is missing ${h.elementType} ${h.id}.`)
      store.set(h.id, cloneEl(real) as LoopNode & LoopEdge)
    } else if (h.kind === 'remove') {
      if (!selection.accept[h.id]) continue
      store.delete(h.id)
    } else {
      // change
      const choices = selection.fieldChoices[h.id] ?? {}
      const wantsProposed = (h.fields ?? []).some((f) => choices[f.field] === 'proposed')
      if (!store.has(h.id)) {
        // target deleted this element — "take proposal" re-adds it whole (vec 11)
        if (!wantsProposed) continue
        const real = psrc.get(h.id)
        if (!real) return bad(`Proposal is missing ${h.elementType} ${h.id}.`)
        store.set(h.id, cloneEl(real) as LoopNode & LoopEdge)
        continue
      }
      const el = store.get(h.id) as unknown as Record<string, unknown>
      for (const f of h.fields ?? []) {
        if (choices[f.field] === 'proposed') setField(el, f.field, f.proposed)
      }
    }
  }

  // reference-based dependency check — after the selection, any edge still
  // pointing at a missing node is refused (no silent prune). Retargeting an
  // endpoint to a surviving node satisfies the dependency just like removing
  // the edge does.
  const hasEdgeHunk = new Set(plan.hunks.filter((h) => h.elementType === 'edge').map((h) => h.id))
  for (const [id, e] of edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) {
      const missing = !nodes.has(e.source) ? e.source : e.target
      return bad(
        hasEdgeHunk.has(id)
          ? `Edge ${id} still points at removed node ${missing} — also remove or retarget edge ${id}, or keep the node.`
          : `Edge ${id} still points at removed node ${missing} — keep that node, or drop the edge first.`,
      )
    }
  }

  // keep target order, then append accepted adds in proposal order
  const outNodes: LoopNode[] = []
  for (const n of target.nodes) if (nodes.has(n.id)) outNodes.push(nodes.get(n.id)!)
  for (const n of proposedFull.nodes) if (nodes.has(n.id) && !target.nodes.some((t) => t.id === n.id)) outNodes.push(nodes.get(n.id)!)
  const outEdges: LoopEdge[] = []
  for (const e of target.edges) if (edges.has(e.id)) outEdges.push(edges.get(e.id)!)
  for (const e of proposedFull.edges) if (edges.has(e.id) && !target.edges.some((t) => t.id === e.id)) outEdges.push(edges.get(e.id)!)

  return { ok: true, nodes: outNodes, edges: outEdges }
}

// ── §2 — validate the WHOLE result before it can be applied ────────────────

/**
 * `SEMANTICS-M.md §M1.3` / §M2 — a `parameter` / `register` node has **no
 * ports**, so **no edge** may name it as `source` or `target`. This is the ONE
 * rule shared by import isolation, whole Apply, and selective Apply (a
 * hand-authored / malformed file can carry such an edge; the engine also
 * ignores it, and the loader isolates it with a warning). Deterministic,
 * id-sorted; empty ⇒ clean.
 */
export function graphStructureIssues(nodes: LoopNode[], edges: LoopEdge[]): string[] {
  const kindOf = new Map<string, unknown>(nodes.map((n) => [n.id, (n.data as { kind?: unknown } | undefined)?.kind]))
  const out: string[] = []
  for (const e of [...edges].sort(byId)) {
    for (const [end, id] of [['source', e.source], ['target', e.target]] as const) {
      const k = kindOf.get(id)
      if (typeof k === 'string' && MODEL_KINDS.has(k)) {
        out.push(`Edge ${e.id}: its ${end} "${id}" is a ${k}, which has no ports and cannot be connected.`)
      }
    }
  }
  return out
}

export type ResultValidation = { ok: true } | { ok: false; reasons: string[] }

/**
 * Full-GraphDoc validation of a selective-apply result (Slice 2 review round 2).
 * Endpoint existence alone is not enough — a field combination can produce an
 * invalid doc, and `normalizeGraph` would then *silently repair* it. Any failure
 * blocks the apply with a concrete list of reasons; nothing is mutated.
 */
export function validateResultGraph(
  nodes: LoopNode[],
  edges: LoopEdge[],
  recommendedRunConfig?: RecommendedRunConfig,
): ResultValidation {
  const reasons: string[] = []
  const nodeIds = new Set(nodes.map((n) => n.id))

  // 1. node kind + shape (before the projection — an unknown kind would crash it)
  let kindsOk = true
  for (const n of nodes) {
    const kind = (n.data as { kind?: unknown } | undefined)?.kind
    if (typeof kind !== 'string' || !NODE_KINDS.has(kind)) {
      reasons.push(`Node ${n.id}: unknown kind "${String(kind)}".`)
      kindsOk = false
    } else if (n.type !== kind) {
      reasons.push(`Node ${n.id}: type "${n.type}" ≠ data.kind "${kind}".`)
    }
    const p = n.position as { x?: unknown; y?: unknown } | undefined
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') reasons.push(`Node ${n.id}: missing numeric position.`)
  }

  // 2. non-finite / out-of-domain numbers anywhere in the projection (skip when
  //    a kind is already unknown — the projection would throw for that reason)
  if (kindsOk) {
    try {
      canonicalContent({ nodes, edges })
    } catch {
      reasons.push('A node or edge holds a non-finite number (NaN / Infinity).')
    }
  }

  // 3. edges — endpoints exist, kind, and handle compatibility, plus the shared
  //    "no port on a model node" rule (import / whole Apply / selective Apply
  //    all use `graphStructureIssues` for that part).
  const seenEdge = new Set<string>()
  for (const e of edges) {
    if (seenEdge.has(e.id)) reasons.push(`Edge ${e.id}: duplicate id.`)
    seenEdge.add(e.id)
    if (!nodeIds.has(e.source)) reasons.push(`Edge ${e.id}: source node ${e.source} does not exist.`)
    if (!nodeIds.has(e.target)) reasons.push(`Edge ${e.id}: target node ${e.target} does not exist.`)
    const ek = (e.data as { kind?: unknown } | undefined)?.kind
    const sState = typeof e.sourceHandle === 'string' && e.sourceHandle.startsWith('state')
    const tState = typeof e.targetHandle === 'string' && e.targetHandle.startsWith('state')
    if (ek === 'state') {
      if (!sState || !tState) reasons.push(`Edge ${e.id}: a state edge must use state handles on both ends.`)
    } else if (ek === 'resource') {
      if (sState || tState) reasons.push(`Edge ${e.id}: a resource edge must not use state handles.`)
    } else {
      reasons.push(`Edge ${e.id}: unknown kind "${String(ek)}".`)
    }
  }
  reasons.push(...graphStructureIssues(nodes, edges))

  // 4. recommendedRunConfig.tracked must reference real pools (revision content
  //    never carries rrc today, but guard it anyway)
  const tracked = recommendedRunConfig?.tracked
  if (Array.isArray(tracked)) {
    for (const id of tracked) if (typeof id === 'string' && !nodeIds.has(id)) reasons.push(`recommendedRunConfig.tracked: node ${id} does not exist.`)
  }

  // 5. normalize must not need to REPAIR anything (blank handles, missing data
  //    defaults, absent `type`) — a silent fix would mean the picked fields
  //    made an invalid doc.
  try {
    const norm = normalizeGraph({ nodes, edges })
    const keySorted = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.map(keySorted)
        : x && typeof x === 'object'
          ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, keySorted((x as Record<string, unknown>)[k])]))
          : x
    const before = JSON.stringify(keySorted({ nodes, edges }))
    const after = JSON.stringify(keySorted(norm))
    if (before !== after) reasons.push('The result is not already normalized — importing it would silently change it.')
  } catch {
    reasons.push('The result cannot be normalized.')
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}

// ── defensive `project` reader (§R10 steps 3/6) ──────────────────────────

export type ReadProjectOk = {
  ok: true
  project: ProjectPayload
  /** for a proposal: the base's canonical content, already validated */
  proposalBase?: ProposalBase
}
export type ReadProjectDropped = { ok: false; warning: string }
export type ReadProjectResult = ReadProjectOk | ReadProjectDropped

function trimAuthor(a: unknown): ProjectAuthor | undefined {
  if (!a || typeof a !== 'object') return undefined
  const o = a as Record<string, unknown>
  const out: ProjectAuthor = {}
  if (typeof o.name === 'string') out.name = truncBytes(o.name, AUTHOR_NAME_MAX_BYTES)
  if (typeof o.note === 'string') out.note = truncBytes(o.note, AUTHOR_NOTE_MAX_BYTES)
  return out.name != null || out.note != null ? out : undefined
}

function readMeta(m: unknown): ProjectMeta | undefined {
  if (!m || typeof m !== 'object') return undefined
  const o = m as Record<string, unknown>
  const out: ProjectMeta = {}
  if (typeof o.title === 'string') out.title = o.title
  if (typeof o.createdAt === 'string') out.createdAt = o.createdAt
  if (typeof o.tool === 'string') out.tool = o.tool
  const author = trimAuthor(o.author)
  if (author) out.author = author
  return Object.keys(out).length ? out : undefined
}

/**
 * §R10 — validate a raw `project` value. Returns `{ ok: true, project }` only
 * for a strictly-valid `loop-revision/1` payload; otherwise `{ ok: false,
 * warning }` and the caller loads the graph / workspace alone. Never throws.
 */
/**
 * §R10 steps 3/6 — validate a raw `project` value against the strict format
 * rules and, when the loaded graph's canonical content is supplied, cross-check
 * the header's claimed `contentDigest` against the actual GraphDoc. Any failure
 * returns `{ ok: false, warning }`; the caller loads the graph / workspace
 * alone (R-INV-10). Never throws.
 *
 * @param loadedContent  `canonicalContent(the file's own nodes/edges/rrc)`. When
 *   given and `project.contentDigest` is present, a mismatch drops `project`.
 *
 * The **ordered** §R2-5 pipeline for the file's own graph
 * (normalise → defensive read → version predicate → version-appropriate digest
 * verify → v2 lift) is `readRevisionSide`. The import layer routes the raw
 * graph through it and passes the resulting `content` in as `loadedContent`;
 * that wiring lands with the editor / apply slice — `readProject` itself only
 * does the format + digest checks on an already-projected `loadedContent`.
 */
export function readProject(raw: unknown, loadedContent?: CanonicalContent): ReadProjectResult {
  const drop = (w: string): ReadProjectDropped => ({ ok: false, warning: w })
  if (!raw || typeof raw !== 'object') return drop("this file's project data is not readable")
  const o = raw as Record<string, unknown>

  if (o.schema !== PROJECT_SCHEMA || o.version !== PROJECT_VERSION) {
    return drop("this file's project data is not a supported version")
  }
  if (!isProjectId(o.projectId) || !isRevisionId(o.revisionId)) {
    return drop("this file's project data has malformed ids")
  }
  if (o.parentId !== null && !isRevisionId(o.parentId)) {
    return drop("this file's project data has a malformed parent id")
  }

  // integrity: the header's claimed digest must match the file's actual graph
  if (loadedContent && o.contentDigest !== undefined) {
    if (typeof o.contentDigest !== 'string' || !HEX64.test(o.contentDigest)) {
      return drop("this file's project content digest is malformed")
    }
    if (digestOfCanonical(loadedContent) !== o.contentDigest) {
      return drop("this file's project data does not match its graph (edited outside Loop Studio?)")
    }
  }

  const role: ProjectRole = o.role === 'proposal' ? 'proposal' : 'revision'

  const lineage = Array.isArray(o.lineage)
    ? o.lineage.filter((x): x is string => isRevisionId(x)).slice(0, LINEAGE_MAX)
    : undefined

  const project: ProjectPayload = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    projectId: o.projectId,
    revisionId: o.revisionId,
    parentId: (o.parentId as string | null) ?? null,
    role,
    ...(lineage ? { lineage } : {}),
    ...(readMeta(o.meta) ? { meta: readMeta(o.meta) } : {}),
  }

  if (isAppliedProposal(o.appliedProposal)) project.appliedProposal = o.appliedProposal

  if (role === 'proposal') {
    const base = readProposalBase(o.base)
    if (!base) return drop("this proposal's base snapshot is missing or inconsistent")
    project.base = base
    return { ok: true, project, proposalBase: base }
  }
  return { ok: true, project }
}

function isAppliedProposal(x: unknown): x is AppliedProposal {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return isRevisionId(o.proposalId) && isRevisionId(o.baseId) && typeof o.baseDigest === 'string'
}


function readProposalBase(x: unknown): ProposalBase | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (!isRevisionId(o.revisionId)) return null
  if (typeof o.contentDigest !== 'string' || !HEX64.test(o.contentDigest)) return null
  const content = readCanonicalContent(o.content)
  if (!content) return null
  // §R6 / R-INV-6 — the stored digest MUST match the stored snapshot
  if (digestOfCanonical(content) !== o.contentDigest) return null
  return { revisionId: o.revisionId, contentDigest: o.contentDigest, content }
}

/** shallow structural check that a value is a `CanonicalContent` (id-sorted
 *  arrays of the right shape). Does not re-project — the file supplies the
 *  canonical form directly. */
function readCanonicalContent(x: unknown): CanonicalContent | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return null
  const nodes: CanonicalNode[] = []
  for (const n of o.nodes) {
    if (!n || typeof n !== 'object') return null
    const nn = n as Record<string, unknown>
    const pos = nn.position as Record<string, unknown> | undefined
    if (typeof nn.id !== 'string') return null
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null
    if (!nn.data || typeof nn.data !== 'object') return null
    // loop-revision/2 (§R2-1.1 / §R2-5.1) — a base-snapshot `parameter` /
    // `register` whose shape cannot be seated makes the whole `project` payload
    // malformed (⇒ the caller drops it, the graph still loads).
    const dk = (nn.data as { kind?: unknown }).kind
    if (dk === 'parameter' && !readParameterData(nn.data).ok) return null
    if (dk === 'register' && !readRegisterData(nn.data).ok) return null
    nodes.push({ id: nn.id, position: { x: pos.x as number, y: pos.y as number }, data: nn.data as Record<string, unknown> })
  }
  const edges: CanonicalEdge[] = []
  for (const e of o.edges) {
    if (!e || typeof e !== 'object') return null
    const ee = e as Record<string, unknown>
    if (typeof ee.id !== 'string' || typeof ee.source !== 'string' || typeof ee.target !== 'string') return null
    if (!ee.data || typeof ee.data !== 'object') return null
    edges.push({
      id: ee.id,
      source: ee.source,
      target: ee.target,
      sourceHandle: (ee.sourceHandle as string | null) ?? null,
      targetHandle: (ee.targetHandle as string | null) ?? null,
      data: ee.data as Record<string, unknown>,
    })
  }
  // must already be id-sorted (§R4.2)
  if (!isSortedById(nodes) || !isSortedById(edges)) return null
  const out: CanonicalContent = { nodes, edges }
  if (o.recommendedRunConfig && typeof o.recommendedRunConfig === 'object') {
    out.recommendedRunConfig = o.recommendedRunConfig as Record<string, unknown>
  }
  return out
}

const isSortedById = (xs: { id: string }[]): boolean =>
  xs.every((x, i) => i === 0 || xs[i - 1].id <= x.id)

// ── author name / note byte truncation (§R8 / R11) ───────────────────────

/** truncate `s` to at most `max` UTF-8 bytes, at a code-point boundary. */
export function truncBytes(s: string, max: number): string {
  if (utf8ByteLength(s) <= max) return s
  let out = ''
  let bytes = 0
  for (const ch of s) {
    const b = utf8ByteLength(ch)
    if (bytes + b > max) break
    out += ch
    bytes += b
  }
  return out
}

// ── pure export planners (§R2.1 / §R6) ──────────────────────────────────

export type GraphDocInput = {
  schema: 'loop-studio/graph'
  version: 1
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
  workspace?: unknown
}

export type RevisionExportPlan = {
  ok: true
  /** the exact file text to download */
  text: string
  bytes: number
  /** the header the session baseline commits to AFTER a successful download
   *  dispatch (§R2.1 / Slice 1B); its `revisionId` is the current one when the
   *  content is unchanged, or a freshly-minted one when `dirty`. */
  pendingHeader: {
    projectId: string
    revisionId: string
    parentId: string | null
    role: 'revision'
    lineage: string[]
    meta: ProjectMeta
    /** digest of the content that was actually written (§R2.1 clarification —
     *  if the live graph changed after this was computed, the caller records
     *  THIS as the baseline and re-marks the document dirty). */
    baselineDigest: string
  }
}
export type ExportTooLarge = { ok: false; reason: 'too-large'; bytes: number; cap: number }
export type RevisionExportResult = RevisionExportPlan | ExportTooLarge

/**
 * §R2.1 — build (but do not write, do not commit) a `Project revision` file.
 * Pure: given the graph, the current project header, the `dirty` flag, the
 * author meta, and (for the dirty path) an `idFactory`, it returns the file
 * text + the header the baseline will commit to on a successful dispatch.
 * `mintId` is injected so tests can drive the id and its failure mode.
 */
export function planRevisionExport(input: {
  doc: Omit<GraphDocInput, 'schema' | 'version'>
  project: { projectId: string; revisionId: string; parentId: string | null; lineage: string[] }
  dirty: boolean
  meta: ProjectMeta
  /** wall-clock for a newly-minted revision's `meta.createdAt`; the old
   *  `createdAt` is kept verbatim on the not-dirty path */
  now: string
  mint?: (p: 'rev') => string
  /** cap override — dev/E2E only, mirrors `loop-workspace/1`'s
   *  `window.__workspaceMaxBytes`; defaults to `REVISION_FILE_MAX_BYTES` */
  maxBytes?: number
}): RevisionExportResult {
  const cap = input.maxBytes ?? REVISION_FILE_MAX_BYTES
  const canon = canonicalContent(input.doc)
  const baselineDigest = digestOfCanonical(canon)
  const mkId = input.mint ?? ((p: 'rev') => mintId(p))

  let revisionId = input.project.revisionId
  let parentId = input.project.parentId
  let lineage = input.project.lineage
  let meta = input.meta

  if (input.dirty) {
    revisionId = mkId('rev') // may throw SecureRandomUnavailableError — the caller aborts
    parentId = input.project.revisionId
    lineage = [input.project.revisionId, ...input.project.lineage].slice(0, LINEAGE_MAX)
    meta = { ...input.meta, createdAt: input.now }
  }

  const project: ProjectPayload = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    projectId: input.project.projectId,
    revisionId,
    parentId,
    role: 'revision',
    contentDigest: baselineDigest, // §R10 integrity — the file's own content
    lineage,
    meta,
  }
  const file = buildFile(input.doc, project)
  const text = JSON.stringify(file, null, 2)
  const bytes = utf8ByteLength(text)
  if (bytes > cap) {
    return { ok: false, reason: 'too-large', bytes, cap }
  }
  return {
    ok: true,
    text,
    bytes,
    pendingHeader: {
      projectId: input.project.projectId,
      revisionId,
      parentId,
      role: 'revision',
      lineage,
      meta,
      baselineDigest,
    },
  }
}

export type ProposalExportPlan = {
  ok: true
  text: string
  bytes: number
  proposalRevisionId: string
}
export type ExportDirtyOrigin = { ok: false; reason: 'dirty-origin' }
export type ProposalExportResult = ProposalExportPlan | ExportTooLarge | ExportDirtyOrigin

/**
 * §R6 — build a `Make a proposal` file from a **non-dirty** origin revision: the
 * proposed graph at top level plus a complete `base.content` snapshot (the
 * canonical projection of that same, current revision content) and its digest.
 *
 * **`dirty === true` ⇒ `{ ok: false, reason: 'dirty-origin' }`** with nothing
 * minted and no file built: the open document differs from `project.revisionId`,
 * so that id cannot honestly be `base.revisionId`. The caller must first
 * `Export → Project revision` to pin the current content as a new revision,
 * then retry. (An implicit revision here would collide with the two-phase
 * commit transaction of §R2.1 — Slice 1B.)
 *
 * The origin session is untouched — this function only reads.
 */
export function planProposalExport(input: {
  /** the proposed content (top-level graph of the file) */
  doc: Omit<GraphDocInput, 'schema' | 'version'>
  project: { projectId: string; revisionId: string; lineage: string[] }
  /** origin dirtiness — only checked when `pinnedBase` is absent (a first
   *  `Make a proposal` from an open revision) */
  dirty: boolean
  /**
   * The **pinned** base to write verbatim. Supplied when re-exporting a
   * proposal that has since been edited: the base MUST stay the revision the
   * proposal was first authored against (§R6), not the current proposed
   * content. When absent, the base is `canonicalContent(doc)` and `dirty` is
   * enforced.
   */
  pinnedBase?: { revisionId: string; content: CanonicalContent }
  meta: ProjectMeta
  now: string
  mint?: (p: 'rev') => string
  maxBytes?: number
}): ProposalExportResult {
  const cap = input.maxBytes ?? REVISION_FILE_MAX_BYTES
  const mkId = input.mint ?? ((p: 'rev') => mintId(p))
  const proposedDigest = digestOfCanonical(canonicalContent(input.doc))

  // resolve the base BEFORE minting — a dirty-origin refusal mints no id (R14.5)
  let base: ProposalBase
  if (input.pinnedBase) {
    base = {
      revisionId: input.pinnedBase.revisionId,
      contentDigest: digestOfCanonical(input.pinnedBase.content),
      content: input.pinnedBase.content,
    }
  } else {
    if (input.dirty) return { ok: false, reason: 'dirty-origin' }
    const c = canonicalContent(input.doc) // proposed === base on first creation
    base = { revisionId: input.project.revisionId, contentDigest: digestOfCanonical(c), content: c }
  }

  const proposalRevisionId = mkId('rev')

  const project: ProjectPayload = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    projectId: input.project.projectId,
    revisionId: proposalRevisionId,
    parentId: base.revisionId,
    role: 'proposal',
    contentDigest: proposedDigest, // the file's own (proposed) content
    base,
    lineage: [base.revisionId, ...input.project.lineage].slice(0, LINEAGE_MAX),
    meta: { ...input.meta, createdAt: input.now },
  }
  const file = buildFile(input.doc, project)
  const text = JSON.stringify(file, null, 2)
  const bytes = utf8ByteLength(text)
  if (bytes > cap) {
    return { ok: false, reason: 'too-large', bytes, cap }
  }
  return { ok: true, text, bytes, proposalRevisionId }
}

function buildFile(doc: Omit<GraphDocInput, 'schema' | 'version'>, project: ProjectPayload): Record<string, unknown> {
  const file: Record<string, unknown> = {
    schema: 'loop-studio/graph',
    version: 1,
    nodes: doc.nodes,
    edges: doc.edges,
  }
  if (doc.recommendedRunConfig && typeof doc.recommendedRunConfig === 'object') {
    file.recommendedRunConfig = doc.recommendedRunConfig
  }
  if (doc.workspace && typeof doc.workspace === 'object') file.workspace = doc.workspace
  file.project = project
  return file
}

// re-export the shared byte helper for callers that measure elsewhere
export { utf8ByteLength }
