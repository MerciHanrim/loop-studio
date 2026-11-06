// Workspace Export / Import — pure format layer (SEMANTICS-W.md, loop-workspace/1;
// SEMANTICS-W2.md, loop-workspace/2 — the engine revision beside a saved result).
//
// Slice A: constants, the canonical *semantic* graph digest (§W3.1 / §W11), a
// Web-Crypto-or-@noble/hashes SHA-256, a UTF-8 byte length.
// Slice B: `buildWorkspacePayload` (assemble) and `readWorkspace` (the §W5
// defensive reader). Still store-free and UI-free — the store wiring lives in
// `src/store/workspaceIO.ts`.

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { ENGINE_REVISION } from '../engine/revision'
import { MAX_SERIES } from './limits'
import type { LoopEdge, LoopNode } from './types'
import { hasKindsTable, hasModelLayer, hasRunRules, hasTimetables, hasUnits, modelSemanticsLabel, type ModelSemanticsVersion } from './modelVersion'
import { readKindsAt, type ResourceKindDecl } from './kinds'
import { canonicalDocTime, type DocTime } from './units'
import { canonicalTimetable, type Timetable } from './timetable'

/** the `workspace.schema` string written (§W2-4) */
export const WORKSPACE_SCHEMA = 'loop-workspace/2'
/** the `workspace.version` written (§W2-4); the reader restores exactly this
 *  pair, or exactly the `loop-workspace/1` / `1` pair (§W2-2), nothing else */
export const WORKSPACE_VERSION = 2
/** the one earlier pair the reader still restores (§W2-2, §W2-3) */
const WORKSPACE_SCHEMA_1 = 'loop-workspace/1'
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
    /** the `ENGINE_REVISION` that produced the result (SEMANTICS-W2.md §W2-1);
     *  present exactly when `result` is, carried verbatim */
    engineRevision?: number
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
  /** loop-model/6 — the stored rule, whole */
  run?: unknown
  activation?: string
  mode?: string
  distribution?: string
  initial?: number
  capacity?: number | null
  /** issue #409 (erratum to §W3.1 / §W11, 2026-10-30) — a Parameter's `value`,
   *  under the loop-model/2 projection ONLY: since SEMANTICS-M2 §M2-8 a
   *  `flow: "@p"` and the activator param-terms resolve it at every step, so
   *  two documents that differ in it compute different runs. Under v1 the
   *  value is not an engine input and the bytes stay as they were (M2-INV-9). */
  value?: number
  /** loop-model/4 (SEMANTICS-M4.md §M4-6) — a Pool's authored unit, under the
   *  version-4 projection only */
  unit?: string
}
type EdgeProjection = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  /** §M4-6 — a resource connection's authored unit, version 4 only */
  unit?: string
  kind: string
  flow?: string
  mode?: string
  delay?: number | null
  expr?: string
  /** CSU / loop-state/3 (SEMANTICS-S3.md, CSU9-D4; SEMANTICS-R6.md §R6-2) —
   *  `label` only, emitted verbatim whenever stored and non-default (absent /
   *  the literal `"phase0"` normalises away for `timing`; ANY stored `when`
   *  is emitted) — including an unrecognised value, since the engine
   *  fail-closes it (CSU3-5) rather than treating it as the default, a real
   *  behavioural difference that must move this digest too. Deliberately
   *  engine-affecting, unlike `route` / `waypoints`: they change what a step
   *  computes. */
  timing?: string
  when?: string
}

function projectNode(n: LoopNode, modelVersion?: ModelSemanticsVersion): NodeProjection {
  const d = (n.data ?? {}) as LoopNode['data']
  if (typeof d !== 'object') return { id: n.id, kind: undefined as unknown as string }
  const p: NodeProjection = { id: n.id, kind: d.kind }
  if ('activation' in d) p.activation = d.activation
  if ('mode' in d && d.mode !== undefined) p.mode = d.mode
  if (d.kind === 'gate') p.distribution = d.distribution
  if (d.kind === 'pool') {
    p.initial = d.initial
    p.capacity = d.capacity
    // loop-model/4 (SEMANTICS-M4.md §M4-6) — the authored unit scales what the
    // engine reads, so it is part of the engine-relevant projection; absent ⇒
    // the earlier bytes
    if (hasUnits(modelVersion) && typeof d.unit === 'string' && d.unit !== '') p.unit = d.unit
  }
  // issue #409 — the engine input of loop-model/2 (see NodeProjection.value)
  if (d.kind === 'parameter' && hasModelLayer(modelVersion)) p.value = d.value
  // loop-model/6 (SEMANTICS-M6.md) — a run rule sets what the stage moves. Whatever
  // node holds it: a rule on the wrong kind refuses the run, so it moves the digest too
  const run = (d as unknown as { run?: unknown }).run
  if (hasRunRules(modelVersion) && run !== undefined) p.run = run
  return p
}

function projectEdge(e: LoopEdge, modelVersion?: ModelSemanticsVersion): EdgeProjection {
  const p: EdgeProjection = {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    kind: e.data?.kind ?? 'resource',
  }
  if (e.data?.kind === 'resource') {
    p.flow = e.data.flow
    // §M4-6 — see projectNode
    if (hasUnits(modelVersion) && typeof e.data.unit === 'string' && e.data.unit !== '') p.unit = e.data.unit
  } else if (e.data?.kind === 'state') {
    p.mode = e.data.mode
    p.expr = e.data.expr ?? ''
    p.delay = e.data.delay ?? null
    // SEMANTICS-R6.md §R6-2 — normalise absent / "phase0" (the legacy default)
    // away so a fully-legacy graph's digest is byte-identical; otherwise carry
    // the stored value VERBATIM, valid or not (an unrecognised value still
    // changes what the engine does — CSU3-5 fail-closed — so it must move
    // this digest too).
    if (e.data.timing !== undefined && e.data.timing !== 'phase0') p.timing = e.data.timing
    if (e.data.when !== undefined) p.when = e.data.when
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
  graph: { nodes: LoopNode[]; edges: LoopEdge[]; kinds?: readonly ResourceKindDecl[]; time?: DocTime; timetables?: readonly Timetable[] },
  modelVersion?: ModelSemanticsVersion,
): string {
  const modelSemantics = modelSemanticsLabel(modelVersion)
  // loop-model/3 (SEMANTICS-M3.md §M3-6) — the kinds table is engine input (a
  // conserved kind can refuse the run), so a different table is a different
  // graph digest; absent / empty ⇒ the key is absent and the bytes are v2's.
  // loop-model/4 (SEMANTICS-M4.md §M4-6) — the unit lists ride the table at
  // version 4 and are stripped below it; the step length is engine input too
  // (`time.step` only — `display` is presentation), under the same rule.
  const kinds = graph.kinds && hasKindsTable(modelVersion) ? readKindsAt(graph.kinds, modelVersion) : []
  const time = hasUnits(modelVersion) ? canonicalDocTime(graph.time) : undefined
  // loop-model/5 (SEMANTICS-M5.md §M5-7) — a table's points set what every step
  // moves, so a different table is a different graph digest
  const timetables = hasTimetables(modelVersion) ? (graph.timetables ?? []).map(canonicalTimetable) : []
  return stableStringify({
    nodes: [...graph.nodes].map((n) => projectNode(n, modelVersion)).sort(byId),
    edges: [...graph.edges].map((e) => projectEdge(e, modelVersion)).sort(byId),
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(time !== undefined ? { time: { step: time.step } } : {}),
    ...(timetables.length > 0 ? { timetables } : {}),
    ...(modelSemantics !== undefined ? { modelSemantics } : {}),
  })
}

/**
 * §W3.1 — SHA-256 (lowercase hex) of the canonical, id-sorted, engine-relevant
 * projection of the graph. Cross-verified against Web Crypto on standard vectors
 * in the tests; the synchronous path (`sha256Js`, `@noble/hashes`) is used where
 * `crypto.subtle` is absent (a non-secure context such as plain `http://` on a
 * non-local host).
 */
export async function semanticDigest(
  graph: { nodes: LoopNode[]; edges: LoopEdge[]; kinds?: readonly ResourceKindDecl[]; time?: DocTime; timetables?: readonly Timetable[] },
  modelVersion?: ModelSemanticsVersion,
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

/** Web Crypto when available, else `sha256Js` (`@noble/hashes`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
      return toHex(new Uint8Array(buf))
    } catch {
      /* fall through to the synchronous path */
    }
  }
  return sha256Js(bytes)
}

/** SHA-256 over `bytes` → lowercase hex, synchronously, with no Web Crypto
 *  dependency: `@noble/hashes` (issue #301 - the hand-written FIPS 180-4 code
 *  this replaced had no recorded origin). The synchronous revision digest
 *  (`digestOfCanonical`) and the fallback of `sha256Hex` both come here. */
export function sha256Js(bytes: Uint8Array): string {
  return toHex(nobleSha256(bytes))
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
  /** a usable restored result, or undefined (none / corrupt / omitted).
   *  `engineRevision` is the file's value, verbatim — `null` when it had none */
  result?: { result: unknown; resultGraphDigest: string; engineRevision: number | null; stale: boolean }
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
  /** the reading app's engine revision — a parameter so a test can stand in
   *  for another app; the app passes nothing */
  engineRevision: number = ENGINE_REVISION,
): { restored: RestoredWorkspace | null; warnings: string[] } {
  const warnings: string[] = []
  if (!isObj(raw)) return { restored: null, warnings }

  // §W5.3 / §W2-2 — restore ONLY an exact `loop-workspace/2` / `2` payload, or
  // an exact `loop-workspace/1` / `1` one (whose result then has no revision
  // and is attached stale below). Anything else (a newer version, a `0` /
  // negative / fractional version, a string `"2"`, an unknown schema) ⇒ graph
  // only + warning. Never throw. This is the path that keeps an older app safe
  // from a newer file, and this app safe from the next revision's.
  const exact2 = raw.schema === WORKSPACE_SCHEMA && raw.version === WORKSPACE_VERSION
  const exact1 = raw.schema === WORKSPACE_SCHEMA_1 && raw.version === 1
  if (!exact2 && !exact1) {
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
    // §W2-1 — the file's revision, verbatim; `null` when it has none (a
    // hand-edited `/2` file). A `loop-workspace/1` file has no such field by
    // its spec: one found there is not read (§W2-2 (2) — a `/1` result is
    // always stale), so a `/1` file cannot present a result as current.
    const fileRevision = exact2 && Number.isInteger(rawMc.engineRevision) ? (rawMc.engineRevision as number) : null
    if (!validateResultShape(r, nodeIds)) {
      warnings.push('the saved distribution was corrupt and has been discarded')
    } else if (!HEX64.test(digest)) {
      result = { result: r, resultGraphDigest: digest, engineRevision: fileRevision, stale: true }
      warnings.push('the saved distribution could not be verified against this graph and is marked stale')
    } else {
      const matches = digest === currentGraphDigest
      // §W2-2 (3) — missing or different in EITHER direction is stale: this
      // app cannot reproduce the number, whichever engine made it
      const sameEngine = fileRevision === engineRevision
      result = {
        result: r,
        resultGraphDigest: digest, // §W3.2 — verbatim, never recomputed
        engineRevision: fileRevision,
        stale: matches && sameEngine ? rawMc.stale === true : true,
      }
      if (!matches) {
        warnings.push('the saved distribution is from an earlier version of this graph and is marked stale')
      }
      if (!sameEngine) {
        warnings.push(
          'the saved distribution was computed by a different version of the engine and is marked stale; run Monte Carlo again',
        )
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
