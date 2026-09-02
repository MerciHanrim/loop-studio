// Workspace Export / Import — pure format layer (SEMANTICS-W.md, loop-workspace/1).
//
// Slice A: constants, the canonical *semantic* graph digest (§W3.1 / §W11), a
// Web-Crypto-or-pure-JS SHA-256, a UTF-8 byte length.
// Slice B: `buildWorkspacePayload` (assemble) and `readWorkspace` (the §W5
// defensive reader). Still store-free and UI-free — the store wiring lives in
// `src/store/workspaceIO.ts`.

import { MAX_SERIES } from './limits'
import type { LoopEdge, LoopNode } from './types'

/** the `workspace.schema` string (§W11) */
export const WORKSPACE_SCHEMA = 'loop-workspace/1'
/** a reader loads graph-only when the file's `workspace.version` exceeds this (§W11) */
export const WORKSPACE_VERSION = 1
/** hard cap on the serialized Workspace file, measured not estimated (§W4 / §W11) */
export const WORKSPACE_MAX_BYTES = 8 * 1024 * 1024

/** the only v1 reason a result is left out of a Workspace file (§W4) */
export type ResultOmittedReason = 'size-limit'

/**
 * The shape of `workspace` on a Workspace file. Slice A defines the type; the
 * builder / reader are slice B.
 */
export type WorkspacePayload = {
  schema: typeof WORKSPACE_SCHEMA
  version: number
  mc: {
    config: { baseSeed: number; runs: number; steps: number; tracked: string[] }
    /** a MonteCarloResult (kept loosely typed here — the engine owns its shape) */
    result?: unknown
    /** present only when a result existed but was omitted (§W4) */
    resultOmitted?: ResultOmittedReason
    /** semantic digest of the graph that PRODUCED the result (§W3.2) */
    resultGraphDigest?: string
    stale: boolean
  }
  view: {
    timeline: 'live' | 'distribution'
    distributionPoolId: string | null
    showMean: boolean
  }
  canvas: { x: number; y: number; zoom: number }
  simulation: {
    /** the PlayBar single-run seed (simStore.seed), NOT mc.config.baseSeed (§W2 / D9) */
    seed: number
    step: number
    ended: boolean
    values: Record<string, number>
    fired: string[]
    triggerQueue: { edgeId: string; target: string; deliveryStep: number }[]
    stateEvents: unknown[]
    series: { step: number; values: Record<string, number> }[]
  }
}

// ── semantic digest (§W3.1) ──────────────────────────────────────────────
// Only the fields that change what the engine computes. Cosmetic edits (move,
// rename, select) must NOT change the digest — mirroring `simulationRev`, which
// a pure `label` change already does not bump.

type NodeProjection = {
  id: string
  kind: string
  activation?: string
  mode?: string
  distribution?: string
  initial?: number
  capacity?: number | null
}
type EdgeProjection = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  kind: string
  flow?: string
  mode?: string
  delay?: number | null
  expr?: string
}

function projectNode(n: LoopNode): NodeProjection {
  const d = (n.data ?? {}) as LoopNode['data']
  if (typeof d !== 'object') return { id: n.id, kind: undefined as unknown as string }
  const p: NodeProjection = { id: n.id, kind: d.kind }
  if ('activation' in d) p.activation = d.activation
  if ('mode' in d && d.mode !== undefined) p.mode = d.mode
  if (d.kind === 'gate') p.distribution = d.distribution
  if (d.kind === 'pool') {
    p.initial = d.initial
    p.capacity = d.capacity
  }
  return p
}

function projectEdge(e: LoopEdge): EdgeProjection {
  const p: EdgeProjection = {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    kind: e.data?.kind ?? 'resource',
  }
  if (e.data?.kind === 'resource') p.flow = e.data.flow
  else if (e.data?.kind === 'state') {
    p.mode = e.data.mode
    p.expr = e.data.expr ?? ''
    p.delay = e.data.delay ?? null
  }
  return p
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** whitespace-free JSON with every object's keys in lexicographic order (§W11) */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')
  return `{${body}}`
}

/** the exact string that is hashed for `semanticDigest` (exported for tests).
 *  loop-model/2 (SEMANTICS-M2.md §M2-8): a v2 document adds a trailing
 *  `modelSemantics: "loop-model/2"` key so the same `flow: "@p"` — a v1 fallback
 *  vs. a resolved Parameter — hashes differently. Absent ⇒ v1 bytes untouched. */
export function canonicalGraphString(
  graph: { nodes: LoopNode[]; edges: LoopEdge[] },
  modelVersion?: 1 | 2,
): string {
  return stableStringify({
    nodes: [...graph.nodes].map(projectNode).sort(byId),
    edges: [...graph.edges].map(projectEdge).sort(byId),
    ...(modelVersion === 2 ? { modelSemantics: 'loop-model/2' } : {}),
  })
}

/**
 * §W3.1 — SHA-256 (lowercase hex) of the canonical, id-sorted, engine-relevant
 * projection of the graph. Cross-verified against Web Crypto on standard vectors
 * in the tests; the pure-JS path (`sha256Js`) is used where `crypto.subtle` is
 * absent (some `file://` contexts).
 */
export async function semanticDigest(
  graph: { nodes: LoopNode[]; edges: LoopEdge[] },
  modelVersion?: 1 | 2,
): Promise<string> {
  return sha256Hex(utf8Bytes(canonicalGraphString(graph, modelVersion)))
}

// ── SHA-256 ──────────────────────────────────────────────────────────────

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
/** UTF-8 byte length — the measurement §W4's size check uses */
export function utf8ByteLength(s: string): number {
  return utf8Bytes(s).length
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Web Crypto when available, else the pure-JS fallback. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
      return toHex(new Uint8Array(buf))
    } catch {
      /* fall through to the pure-JS path */
    }
  }
  return sha256Js(bytes)
}

/** FIPS 180-4 SHA-256 over `bytes` → lowercase hex. No Web Crypto dependency. */
export function sha256Js(bytes: Uint8Array): string {
  // prettier-ignore
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  const bitLen = bytes.length * 8
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false)
  dv.setUint32(padded.length - 4, bitLen >>> 0, false)

  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]
      const b = w[i - 2]
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0
    H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0
    H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0
    H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0
    H[7] = (H[7] + h) | 0
  }

  let out = ''
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0')
  return out
}

// ════════════════════════════════════════════════════════════════════════
//  Slice B — assemble a payload, and the §W5 defensive reader
// ════════════════════════════════════════════════════════════════════════

const HEX64 = /^[0-9a-f]{64}$/
/** sanity band for a restored zoom; React Flow clamps further on setViewport */
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 16

export type RestoredWorkspace = {
  /** engine-validated MC config patch (fields present only when valid) */
  mcConfig: { baseSeed?: number; runs?: number; steps?: number; tracked?: string[] }
  /** a usable restored result, or undefined (none / corrupt / omitted) */
  result?: { result: unknown; resultGraphDigest: string; stale: boolean }
  /** present when a result existed in the file but was left out (§W4) */
  resultOmitted?: ResultOmittedReason
  view: { timeline: 'live' | 'distribution'; distributionPoolId: string | null; showMean: boolean }
  canvas?: { x: number; y: number; zoom: number }
  simulation?: {
    /** null => keep the store's current seed */
    seed: number | null
    step: number
    ended: boolean
    values: Record<string, number>
    fired: string[]
    triggerQueue: { edgeId: string; target: string; deliveryStep: number }[]
    stateEvents: unknown[]
    series: { step: number; values: Record<string, number> }[]
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const uint32 = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v >>> 0 : null

/** Build the `workspace` payload from already-collected plain data (store-free). */
export function buildWorkspacePayload(input: {
  mc: WorkspacePayload['mc']
  view: WorkspacePayload['view']
  canvas: WorkspacePayload['canvas']
  simulation: WorkspacePayload['simulation']
}): WorkspacePayload {
  return { schema: WORKSPACE_SCHEMA, version: WORKSPACE_VERSION, ...input }
}

/** §W4 — the same payload with the MC result removed and the omission recorded.
 *  A no-op when there was no result to drop. */
export function omitResult(p: WorkspacePayload): WorkspacePayload {
  if (p.mc.result === undefined) return p
  const { result: _result, ...mcRest } = p.mc
  return { ...p, mc: { ...mcRest, resultOmitted: 'size-limit' } }
}

/**
 * §W5 — validate a raw `workspace` blob against the freshly-loaded graph.
 * Pure: no stores. `currentGraphDigest` is `semanticDigest(graph)` computed by
 * the caller (it is async). Returns the pieces to apply plus human warnings;
 * `restored: null` means "skip the workspace, keep the graph" (§W5.3).
 */
export function readWorkspace(
  raw: unknown,
  graph: { nodes: LoopNode[]; edges: LoopEdge[] },
  currentGraphDigest: string,
): { restored: RestoredWorkspace | null; warnings: string[] } {
  const warnings: string[] = []
  if (!isObj(raw)) return { restored: null, warnings }

  // §W5.3 — restore ONLY an exact `loop-workspace/1` payload. Anything else
  // (a newer version, a `0` / negative / fractional version, a string `"1"`,
  // an unknown schema) ⇒ graph only + warning. Never throw.
  if (raw.schema !== WORKSPACE_SCHEMA || raw.version !== WORKSPACE_VERSION) {
    return {
      restored: null,
      warnings: ["this file's saved workspace is not a supported version; the graph opened without it"],
    }
  }

  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const pools = graph.nodes.filter((n) => n.data.kind === 'pool')
  const poolIds = pools.map((n) => n.id)
  const poolIdSet = new Set(poolIds)
  const initialOf = new Map(pools.map((n) => [n.id, (n.data as { initial: number }).initial]))
  const triggerEdgeIds = new Set(
    graph.edges.filter((e) => e.data?.kind === 'state' && e.data.mode === 'trigger').map((e) => e.id),
  )
  const edgeIds = new Set(graph.edges.map((e) => e.id))

  // ── mc.config ────────────────────────────────────────────────────────
  const mcConfig: RestoredWorkspace['mcConfig'] = {}
  const rawMc = isObj(raw.mc) ? raw.mc : {}
  const cfg = isObj(rawMc.config) ? rawMc.config : {}
  {
    const s = uint32(cfg.baseSeed)
    if (s !== null) mcConfig.baseSeed = s
    if (Number.isInteger(cfg.runs) && (cfg.runs as number) >= 1) mcConfig.runs = cfg.runs as number
    if (Number.isInteger(cfg.steps) && (cfg.steps as number) >= 1) mcConfig.steps = cfg.steps as number
    if (Array.isArray(cfg.tracked)) {
      if (cfg.tracked.length === 0) mcConfig.tracked = []
      else {
        const wanted = new Set(cfg.tracked.filter((x): x is string => typeof x === 'string'))
        const kept = poolIds.filter((id) => wanted.has(id))
        mcConfig.tracked = kept.length > 0 ? kept : poolIds.length > 0 ? [poolIds[0]] : []
      }
    }
  }

  // ── mc.result ────────────────────────────────────────────────────────
  let result: RestoredWorkspace['result']
  let resultOmitted: ResultOmittedReason | undefined
  if (rawMc.resultOmitted != null) {
    resultOmitted = 'size-limit'
    warnings.push(
      'the saved workspace left its distribution out because the file was too large; re-run Monte Carlo to regenerate it',
    )
  } else if (rawMc.result != null) {
    const r = rawMc.result
    const digest = typeof rawMc.resultGraphDigest === 'string' ? rawMc.resultGraphDigest : ''
    if (!validateResultShape(r, nodeIds)) {
      warnings.push('the saved distribution was corrupt and has been discarded')
    } else if (!HEX64.test(digest)) {
      result = { result: r, resultGraphDigest: digest, stale: true }
      warnings.push('the saved distribution could not be verified against this graph and is marked stale')
    } else {
      const matches = digest === currentGraphDigest
      result = {
        result: r,
        resultGraphDigest: digest, // §W3.2 — verbatim, never recomputed
        stale: matches ? rawMc.stale === true : true,
      }
      if (!matches) {
        warnings.push('the saved distribution is from an earlier version of this graph and is marked stale')
      }
    }
  }

  const haveUsableResult = !!result

  // ── view ─────────────────────────────────────────────────────────────
  const rawView = isObj(raw.view) ? raw.view : {}
  let timeline: 'live' | 'distribution' = rawView.timeline === 'distribution' ? 'distribution' : 'live'
  const trackedPoolIds = haveUsableResult ? resultPoolIds(result!.result) : null
  const wantPool = typeof rawView.distributionPoolId === 'string' ? rawView.distributionPoolId : null
  const poolOk = (id: string | null): boolean =>
    id !== null && poolIdSet.has(id) && (trackedPoolIds ? trackedPoolIds.has(id) : true)
  let distributionPoolId: string | null = null
  if (poolOk(wantPool)) distributionPoolId = wantPool
  else if (trackedPoolIds && trackedPoolIds.size > 0) distributionPoolId = [...trackedPoolIds][0]
  else if (!haveUsableResult && poolIds.length > 0) distributionPoolId = poolIds[0]
  if (timeline === 'distribution' && !haveUsableResult) timeline = 'live'
  const view = { timeline, distributionPoolId, showMean: rawView.showMean === true }

  // ── canvas ───────────────────────────────────────────────────────────
  let canvas: RestoredWorkspace['canvas']
  const rawCanvas = isObj(raw.canvas) ? raw.canvas : null
  if (rawCanvas && finite(rawCanvas.x) && finite(rawCanvas.y) && finite(rawCanvas.zoom)) {
    canvas = { x: rawCanvas.x, y: rawCanvas.y, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawCanvas.zoom)) }
  }

  // ── simulation snapshot ──────────────────────────────────────────────
  let simulation: RestoredWorkspace['simulation']
  const rawSim = isObj(raw.simulation) ? raw.simulation : null
  if (rawSim) {
    if (!Number.isInteger(rawSim.step) || (rawSim.step as number) < 0) {
      warnings.push('the saved run position was invalid; the simulation was reset to step 0')
    } else {
      const step = rawSim.step as number
      const seed = uint32(rawSim.seed)
      const ended = rawSim.ended === true

      const values: Record<string, number> = {}
      const savedValues = isObj(rawSim.values) ? rawSim.values : {}
      for (const id of poolIds) {
        const v = savedValues[id]
        values[id] = finite(v) && v >= 0 ? v : (initialOf.get(id) ?? 0)
      }
      for (const [k, v] of Object.entries(savedValues)) {
        if (!poolIdSet.has(k) && nodeIds.has(k) && finite(v) && v >= 0) values[k] = v
      }

      const fired = Array.isArray(rawSim.fired)
        ? rawSim.fired.filter((x): x is string => typeof x === 'string' && nodeIds.has(x))
        : []

      const triggerQueue = (Array.isArray(rawSim.triggerQueue) ? rawSim.triggerQueue : [])
        .filter(isObj)
        .map((q) => ({ edgeId: String(q.edgeId), target: String(q.target), deliveryStep: Number(q.deliveryStep) }))
        .filter(
          (q) =>
            triggerEdgeIds.has(q.edgeId) &&
            nodeIds.has(q.target) &&
            Number.isInteger(q.deliveryStep) &&
            q.deliveryStep > step,
        )
        .sort((a, b) => a.deliveryStep - b.deliveryStep || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))

      let stateEvents: unknown[] = []
      if (Array.isArray(rawSim.stateEvents)) {
        const kept = rawSim.stateEvents.filter(
          (e): e is Record<string, unknown> =>
            isObj(e) && typeof e.edgeId === 'string' && edgeIds.has(e.edgeId),
        )
        if (kept.length === rawSim.stateEvents.length) {
          stateEvents = [...kept].sort((a, b) => {
            const x = a.edgeId as string
            const y = b.edgeId as string
            return x < y ? -1 : x > y ? 1 : 0
          })
        } // a partly-malformed array is dropped whole — it re-derives on the next step()
      }

      const seriesResult = readSeries(rawSim.series, poolIdSet, values)
      warnings.push(...seriesResult.warnings)

      simulation = { seed, step, ended, values, fired, triggerQueue, stateEvents, series: seriesResult.series }
    }
  }

  return { restored: { mcConfig, result, resultOmitted, view, canvas, simulation }, warnings }
}

/**
 * §W5 `series` rules — validation only, no fabrication:
 *  - per frame: keep a Pool key only when it names a Pool in the graph and the
 *    value is finite (a bad key is dropped on its own);
 *  - cap to the newest `MAX_SERIES` frames;
 *  - the last frame's value for a Pool MUST equal that Pool's restored current
 *    value. If it doesn't, that **Pool's series** is dropped (its key removed
 *    from every frame). The frame structure, the other Pools' series, and the
 *    snapshot are untouched. Nothing is replaced or appended.
 */
function readSeries(
  raw: unknown,
  poolIdSet: Set<string>,
  currentValues: Record<string, number>,
): { series: { step: number; values: Record<string, number> }[]; warnings: string[] } {
  if (!Array.isArray(raw)) return { series: [], warnings: [] }
  const frames: { step: number; values: Record<string, number> }[] = []
  for (const f of raw) {
    if (!isObj(f) || !Number.isInteger(f.step)) continue
    const vals = isObj(f.values) ? f.values : {}
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(vals)) {
      if (poolIdSet.has(k) && finite(v)) values[k] = v
    }
    frames.push({ step: f.step as number, values })
  }
  const series = frames.slice(-MAX_SERIES)
  const warnings: string[] = []
  if (series.length > 0) {
    const last = series[series.length - 1].values
    const misaligned = Object.keys(last).filter((k) => poolIdSet.has(k) && last[k] !== currentValues[k])
    if (misaligned.length > 0) {
      for (const fr of series) for (const k of misaligned) delete fr.values[k]
      warnings.push(
        `the saved timeline history for ${misaligned.length} Pool(s) did not line up with the restored run position and was dropped`,
      )
    }
  }
  return { series, warnings }
}

// ── result-shape helpers ────────────────────────────────────────────────

function validateResultShape(r: unknown, nodeIds: Set<string>): boolean {
  if (!isObj(r)) return false
  if (!Array.isArray(r.pools) || !isObj(r.config) || !Array.isArray(r.runSeeds)) return false
  if (!isObj(r.series) || !isObj(r.final)) return false
  const steps = (r.config as { steps?: unknown }).steps
  const runs = (r.config as { runs?: unknown }).runs
  if (!Number.isInteger(steps) || !Number.isInteger(runs)) return false
  if ((r.runSeeds as unknown[]).length !== runs) return false
  if (!(r.runSeeds as unknown[]).every(finite)) return false
  for (const p of r.pools as unknown[]) {
    if (!isObj(p) || typeof p.id !== 'string' || !nodeIds.has(p.id)) return false
    const s = (r.series as Record<string, unknown>)[p.id]
    if (!isObj(s)) return false
    for (const band of Object.values(s)) {
      if (!Array.isArray(band) || band.length !== (steps as number) + 1 || !band.every(finite)) return false
    }
    const fin = (r.final as Record<string, unknown>)[p.id]
    if (!isObj(fin) || !Array.isArray(fin.values) || !fin.values.every(finite)) return false
  }
  return true
}

function resultPoolIds(r: unknown): Set<string> {
  const out = new Set<string>()
  if (isObj(r) && Array.isArray(r.pools)) {
    for (const p of r.pools) if (isObj(p) && typeof p.id === 'string') out.add(p.id)
  }
  return out
}
