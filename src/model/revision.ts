// Project Revision / Proposal — pure foundation (SEMANTICS-R.md, loop-revision/1).
//
// Slice 1A: types + constants, id validation + a secure mint, the canonical
// revision projection / JSON / digest (§R4), the RevisionDiff (§R5), the
// defensive `project` reader (§R10 steps 3/6), and the *pure* export planners
// (§R2.1 / §R6). NO store, NO autosave, NO UI, NO download side effects — the
// lifecycle that consumes these lands in Slice 1B.

import { defaultData } from './factory'
import { normalizeGraph } from './serialize'
import type { RecommendedRunConfig } from './serialize'
import type { LoopEdge, LoopNode, NodeKind } from './types'
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

/** node `data` keys, in the frozen emit order, by kind (§R4.2 FIELDS_BY_KIND) */
const NODE_FIELDS: Record<NodeKind, readonly string[]> = {
  pool: ['kind', 'label', 'activation', 'initial', 'capacity', 'mode'],
  source: ['kind', 'label', 'activation', 'mode'],
  drain: ['kind', 'label', 'activation', 'mode'],
  gate: ['kind', 'label', 'activation', 'distribution', 'mode'],
  converter: ['kind', 'label', 'activation', 'mode'],
  end: ['kind', 'label', 'activation', 'mode'],
}
/** edge `data` keys, in the frozen emit order, by kind (§R4.2 EDGE_FIELDS_BY_KIND) */
const EDGE_FIELDS: Record<'resource' | 'state', readonly string[]> = {
  resource: ['kind', 'flow'],
  state: ['kind', 'mode', 'expr', 'delay'],
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

function projectNode(n: LoopNode): CanonicalNode {
  const kind = n.data.kind
  const fields = NODE_FIELDS[kind]
  const src = normNodeData(n)
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    let v = src[f]
    if (f === 'capacity') {
      // pool capacity: number (finite) or null (unbounded); absent ⇒ null
      v = v == null ? null : numOrThrow(v as number, `node ${n.id} data.capacity`)
    } else if (f === 'initial') {
      v = numOrThrow((v ?? 0) as number, `node ${n.id} data.initial`)
    }
    data[f] = v
  }
  return {
    id: n.id,
    position: {
      x: numOrThrow(n.position?.x ?? 0, `node ${n.id} position.x`),
      y: numOrThrow(n.position?.y ?? 0, `node ${n.id} position.y`),
    },
    data,
  }
}

function projectEdge(e: LoopEdge): CanonicalEdge {
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
export function canonicalContent(doc: {
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
}): CanonicalContent {
  const g = normalizeGraph({ nodes: doc.nodes, edges: doc.edges })
  const out: CanonicalContent = {
    nodes: g.nodes.map(projectNode).sort(byId),
    edges: g.edges.map(projectEdge).sort(byId),
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

// ── engine vs cosmetic (§R4.4 / §R5.2) ────────────────────────────────────

/** a node `data` field is `cosmetic` iff it is `label`; `position` is cosmetic;
 *  everything else in the projection is `engine`. */
export function fieldTag(kind: 'node' | 'edge', field: string): 'engine' | 'cosmetic' {
  if (kind === 'node' && (field === 'label' || field === 'position' || field === 'data.label')) {
    return 'cosmetic'
  }
  return 'engine'
}

// ── RevisionDiff (§R5) ───────────────────────────────────────────────────

export type FieldChange = { field: string; base: unknown; proposed: unknown; tag: 'engine' | 'cosmetic' }
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
      empty,
    },
  }
}

// ── §R7A.3 three-way conflict count (feeds §R7A.2 divergent vs unknown) ───

/** read one projection field, `data.*` or a top-level key. */
function fieldOf(el: CanonicalNode | CanonicalEdge, field: string): unknown {
  const o = el as Record<string, unknown>
  if (field.startsWith('data.')) {
    const d = (o.data ?? {}) as Record<string, unknown>
    return d[field.slice(5)]
  }
  return o[field]
}

/**
 * §R7A.3 — for every proposal hunk (`base` → `proposed`) look at the target's
 * current value for that id and count conflicts. Whole-element granularity for
 * `add` / `remove`; per changed field for `change`. This is `nConf` in §R7A.2:
 * `nConf === 0` ⇒ `unknown ancestry`, `nConf ≥ 1` ⇒ `divergent`. The per-hunk
 * *apply* (Slice 2) resolves the same conflicts one by one; here we only count.
 *
 * All three inputs are canonical GraphDoc projections (nodes/edges — the
 * `loop-revision/1` exporters never emit `recommendedRunConfig` into a
 * revision's content, so it plays no part in the count).
 */
export function countThreeWayConflicts(
  base: CanonicalContent,
  target: CanonicalContent,
  proposed: CanonicalContent,
): number {
  let n = 0
  type El = CanonicalNode | CanonicalEdge
  for (const kind of ['node', 'edge'] as const) {
    const pick = (c: CanonicalContent): El[] => (kind === 'node' ? c.nodes : c.edges)
    const b = indexById<El>(pick(base))
    const t = indexById<El>(pick(target))
    const p = indexById<El>(pick(proposed))
    for (const id of new Set<string>([...b.keys(), ...p.keys()])) {
      const bv = b.get(id)
      const pv = p.get(id)
      const tv = t.get(id)
      if (!bv && pv) {
        // proposal ADDs id — conflict only if the target also added it, differently
        if (tv && !deepEq(tv, pv)) n++
      } else if (bv && !pv) {
        // proposal REMOVEs id — conflict if the target changed it vs the base
        if (tv && !deepEq(tv, bv)) n++
      } else if (bv && pv && !deepEq(bv, pv)) {
        // proposal CHANGEs id
        if (!tv) {
          n++ // target deleted what the proposal edits
        } else {
          for (const f of diffElement(kind, bv as never, pv as never)) {
            const cur = fieldOf(tv, f.field)
            if (!deepEq(cur, f.base) && !deepEq(cur, f.proposed)) n++ // a third value
          }
        }
      }
    }
  }
  return n
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
