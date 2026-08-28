// Workspace Export / Import — foundation layer (SEMANTICS-W.md, loop-workspace/1).
//
// Slice A: the pure pieces only — constants, the canonical *semantic* graph
// digest (§W3.1 / §W11), a Web-Crypto-or-pure-JS SHA-256, and a UTF-8 byte
// length. No serialization, no store, no UI — those are slices B and C.

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
  const d = n.data
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

/** the exact string that is hashed for `semanticDigest` (exported for tests) */
export function canonicalGraphString(graph: { nodes: LoopNode[]; edges: LoopEdge[] }): string {
  return stableStringify({
    nodes: [...graph.nodes].map(projectNode).sort(byId),
    edges: [...graph.edges].map(projectEdge).sort(byId),
  })
}

/**
 * §W3.1 — SHA-256 (lowercase hex) of the canonical, id-sorted, engine-relevant
 * projection of the graph. Cross-verified against Web Crypto on standard vectors
 * in the tests; the pure-JS path (`sha256Js`) is used where `crypto.subtle` is
 * absent (some `file://` contexts).
 */
export async function semanticDigest(graph: { nodes: LoopNode[]; edges: LoopEdge[] }): Promise<string> {
  return sha256Hex(utf8Bytes(canonicalGraphString(graph)))
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
