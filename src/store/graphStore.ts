import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { useAutosaveStore } from './autosaveStore'
import { useI18n } from '../i18n/store'
import { defaultNodeLabel } from '../i18n/nodeDefaults'
import { relabelFramesForLocale, relabelNodesForLocale } from '../i18n/templateLabels/relabel'
import { relabelModuleNodesForLocale } from '../i18n/moduleLabelSync'
import { createNode, defaultData, nextId } from '../model/factory'
import { uniqueNodeLabel } from '../model/nodeLabel'
import { insertGraph, type GraphDocLike } from '../model/moduleGraph'
import {
  clearModuleProvenance,
  detachModuleProvenance,
  moduleProvenanceSnapshot,
  registerModuleProvenance,
  restoreModuleProvenanceSnapshot,
  type ModuleProvenanceSnapshot,
} from '../model/moduleProvenance'
import { buildImportCommit, type ImportCommitResult, type PlacementChoice } from '../model/dataImportCommit'
import type { ValidatedImportPlan } from '../model/dataImportValidate'
import { buildRefreshCommit, parameterLabel, type RefreshCommitResult, type RefreshDiffPlan, type RefreshResolution } from '../model/dataImportRefresh'
import { parseActivatorExpr } from '../engine'
import {
  deserialize,
  loadFromStorage,
  DI_LABEL_MAX,
  type ModelSemanticsVersion,
  normalizeGraph,
  saveToStorage,
  serialize,
} from '../model/serialize'
import {
  readTimelineSeries,
  type ImportSourceTable,
  type RecommendedRunConfig,
  type SavedFrame,
  type TimelineSeries,
} from '../model/serialize'
import { readAccent } from '../model/model'
import type { InitialView } from '../model/templates'
import type { LoopEdge, LoopEdgeData, LoopNode, NodeKind } from '../model/types'

type XY = { x: number; y: number }
type Snapshot = { nodes: LoopNode[]; edges: LoopEdge[] }
/** docs/module-system.md §MS3 — `insertModule`'s outcome. `reason:
 *  'needs-v2-consent'` is the one non-error refusal: the caller re-invokes with
 *  `confirmedPromotion: true` once the user accepts the v1 → v2 promotion. */
export type InsertModuleResult =
  | { ok: true; insertedNodeIds: string[]; promotedToV2: boolean }
  | { ok: false; reason: string }
/** Issue #334 — what a user-edit action that reports a result returns when the
 *  edit lock refused it. The UI disables those entry points first, so a caller
 *  only has to return quietly on it; it is never shown as a message. */
export type LockedRefusal = { ok: false; reason: 'locked' }
/** Issue #334 — how a whole-graph load relates to the open document. Required,
 *  with no default, so a new caller has to say which one it is:
 *  - `document-boundary`: another document replaces this one (a file, a share
 *    link, a Workspace, a project revision, Open proposal as document). The
 *    history is emptied and `canvasLocked` is the NEW document's lock, written
 *    once as part of the swap.
 *  - `revision-apply`: the open document is edited in place (SEMANTICS-R.md
 *    R-INV-8 — one undo entry); refused while the edit lock is on. */
export type LoadDocOptions = (
  | { mode: 'document-boundary'; canvasLocked: boolean }
  | { mode: 'revision-apply' }
) & {
  modelVersion?: ModelSemanticsVersion
  /** LGR Slice 5 — the doc's saved manual frames (already defensively read).
   *  An array (incl. `[]`) REPLACES `frameStore`; `undefined` KEEPS the
   *  current frames (a revision Apply that carries no `frames` change must not
   *  wipe them). Part of this ONE load — no per-frame undo entry (§SF11). */
  frames?: readonly SavedFrame[]
  /** `loop-revision/8` — the doc's saved data-import source records (already
   *  defensively read); same `undefined`-keeps rule as `frames`. */
  dataImports?: readonly ImportSourceTable[]
}
/** a Template load (or a pasted graph) — always a document boundary */
export type LoadGraphOptions = {
  /** the Template's own `recommendedRunConfig.canvasLocked === true` */
  canvasLocked: boolean
  modelVersion?: ModelSemanticsVersion
  /** docs/mmo-multilingual-layout.md §MML3 — a menu-opened Template's framing */
  initialView?: InitialView | null
  /** docs/template-label-overlay.md §TLO12 — a bundled Template MAY ship group
   *  frames (already run through `readSavedFrames`). Absent ⇒ `frameStore` is
   *  cleared. A pasted graph never passes this. */
  frames?: readonly SavedFrame[]
  /** `loop-revision/8` — a bundled Template's saved data-import source
   *  records, if it ever ships any. Absent ⇒ cleared, same posture as `frames`. */
  dataImports?: readonly ImportSourceTable[]
}
/** one undo-history frame: the graph, its `modelVersion`, AND an opaque sidecar
 *  (the loop-revision/1 project header at that instant), so a single undo/redo
 *  restores all of them together even across several Apply / edit steps
 *  (SEMANTICS-R.md §R7.3). `modelVersion` rides along so an insert that promoted
 *  v1 → v2 (docs/module-system.md §MS3.5) — or the leading-`@` flow commit that
 *  latches v2 — is reverted as one unit by the same Ctrl+Z that removes it. */
type HistoryEntry = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
  sidecar: unknown
}
/** docs/large-graph-readability-saved-frames.md §SF11.1 "Move" — an opaque
 *  pre-gesture history entry handed out by `captureGestureSnapshot()` and
 *  pushed back by `pushGestureEntry()` when the gesture really moved something.
 *  Opaque on purpose: the frame layer owns the transaction, never its shape. */
export type GestureSnapshot = { readonly __gestureSnapshot: true }

type GraphStore = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null

  /** bumped only on changes that alter what a simulation computes — structure
   *  (add/remove/connect) and simulation-relevant node/edge data. NOT position,
   *  selection, or a pure `label` rename. The sim store and the Monte-Carlo
   *  store watch this (to reset / to mark results stale). */
  simulationRev: number

  /** bumped only when the WHOLE graph is (re)loaded — `newGraph`, `loadGraph`,
   *  `loadDoc` (so: doc open, template load, Share / Workspace import, revision
   *  Apply). NOT an edit. docs/large-graph-readability.md §LGR3.4 — the filter
   *  store watches this to drop its ephemeral selections on a graph swap. */
  loadRev: number

  /** bumped only by `loadGraph` — a Templates load or a pasted graph: a
   *  whole-graph swap that carries NO viewport of its own and lands on top of
   *  another graph the user was already looking at. The Canvas watches this to
   *  re-fit the camera to the new graph once React Flow has measured it.
   *  Excluded on purpose: `newGraph` (empty canvas, nothing to fit) and
   *  `loadDoc` (file / Workspace / Share / revision import — a Workspace
   *  restores its own saved view, a plain file import keeps the camera). */
  fitRev: number

  /** docs/mmo-multilingual-layout.md §MML3 — a one-shot camera-framing hint set
   *  only by `loadGraph` when a Template carries `initialView` (currently just
   *  the MMO demo). The Canvas consumes it on the next `fitRev` swap instead of
   *  fit-all, then it is left in place but never re-read (a plain reload boots a
   *  fresh store with `null` here; language change / Undo / Import never call
   *  `loadGraph`). NOT part of the GraphDoc — never serialized, diffed or
   *  undone. `null` for a pasted graph or any Template without a framing. */
  pendingInitialView: InitialView | null

  /** true only while this session is still showing the untouched first-run
   *  sample (no `localStorage` graph at boot, nothing changed since). Cleared
   *  permanently by any edit / Import / Template / undo / redo / restore. A
   *  share link opens without a replace prompt only while this holds
   *  (SEMANTICS-U.md §U5.6 / D5). */
  pristineSample: boolean

  /** loop-model/2 (SEMANTICS-M2.md §M2-1) — the current document's
   *  model-semantics version. Set from the loaded `schema`, latched to `2` by
   *  the first leading-`@` `flow` commit (§M2-1.1), reset to `1` by `newGraph`.
   *  Passed to `serialize()` / autosave and to `step()` / Monte-Carlo. One-way
   *  per document: never returns to `1` except on a full new / v1 load. */
  modelVersion: ModelSemanticsVersion

  past: HistoryEntry[]
  future: HistoryEntry[]
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** LGR Slice 5 (§SF11) — `frameStore` calls this BEFORE a saved-frame
   *  mutation so the graph undo history gets one entry at the §SF11.1
   *  granularity. `framesOverride` pins the PRE-gesture frames (a resize/move
   *  commits once, at the first move). The entry's node/edge snapshot is the
   *  current graph; its sidecar carries the given (or current) frames. */
  commitHistory: (tag: string, framesOverride?: unknown) => void
  /** LGR Slice 5 — `frameStore` calls this AFTER a mutation so a frame-only
   *  change still schedules the autosave write (which serialises the live
   *  `frameStore.frames`). */
  notifyFrameChange: () => void

  /** §SF11.1 "Move" — the frame-move / resize gesture TRANSACTION (2026-09-20).
   *  `captureGestureSnapshot()` at pointer-down freezes the pre-gesture graph +
   *  every sidecar (saved frames included); the gesture then writes through
   *  `applyGesturePositions` / `frameStore.setRectsSilently` (no history, no
   *  `simulationRev`); `pushGestureEntry(snapshot)` at pointer-up records
   *  EXACTLY ONE entry, only when something moved; a cancelled gesture writes
   *  the origin back and pushes nothing. Never leans on the 600 ms tag
   *  coalescing — a paused drag is still one entry. */
  captureGestureSnapshot: () => GestureSnapshot
  pushGestureEntry: (snapshot: GestureSnapshot) => void
  /** move the listed nodes to the given ABSOLUTE positions and replace the
   *  listed edges' manual `waypoints` — silently: no history entry, no
   *  `simulationRev` (a position is not engine content), autosave scheduled. */
  applyGesturePositions: (
    positions: Readonly<Record<string, XY>>,
    waypoints: Readonly<Record<string, readonly XY[]>>,
  ) => void

  onNodesChange: (changes: NodeChange<LoopNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LoopEdge>[]) => void
  onConnect: (conn: Connection) => void

  addNodeAt: (kind: NodeKind, position: XY) => void
  /** docs/module-system.md §MS3 — merge a module (a plain graph fragment) into
   *  the open graph as ONE atomic history entry: every module node/edge id is
   *  re-issued, every `register` expr `@ref` / v2 `@param` flow is rewritten,
   *  and the whole candidate is validated FIRST — on any failure nothing
   *  changes (§MS3.6 / B4). The inserted nodes end up selected, nothing else
   *  (§MS3.3). A v1 host + v2 module needs `opts.confirmedPromotion` (the caller
   *  shows the consent dialog — §MS3.4 / MS7-2); without it the call returns
   *  `{ ok: false, reason: 'needs-v2-consent' }` and changes nothing.
   *  `recommendedRunConfig` / `frames` are not part of `GraphDocLike` — insert
   *  never touches `mcStore` or `frameStore` (§MS4a-B2 / B3). */
  insertModule: (
    module: GraphDocLike,
    opts: { at: XY; confirmedPromotion?: boolean; bundledModuleId?: string },
  ) => InsertModuleResult
  /** docs/data-import.md §DI16 Phase 1B — commit a validated multi-table
   *  import as ONE atomic history entry: every generated Parameter, every
   *  new `dataImports` table record, and any newly-created frame land
   *  together, so one Ctrl+Z reverts the whole batch. `plan` can only come
   *  from `validateDrafts` (the type is the trust boundary — see
   *  `dataImportValidate.ts`), so this action can never commit unvalidated
   *  data. Mirrors `insertModule`'s pure-build-then-apply shape:
   *  `buildImportCommit` (pure, includes its own pre-commit collision gate)
   *  runs first and can refuse with `ok:false` before anything changes. */
  commitDataImport: (plan: ValidatedImportPlan, placement: PlacementChoice) => ImportCommitResult | LockedRefusal
  /** docs/data-import.md §DI11/§DI16 Phase 2 — commit a validated refresh
   *  diff as ONE atomic history entry: every created/updated/removed node
   *  AND the refreshed table's stored record land together, so one Ctrl+Z
   *  reverts the whole batch. `plan` can only come from `diffRefresh` (the
   *  branded type is the trust boundary), and `buildRefreshCommit` (pure,
   *  includes its own referenced-node / missing-row-dependency refusal
   *  gates) runs first and can refuse with `ok:false` before anything
   *  changes. `newNodeOrigin` mirrors `commitDataImport`'s own
   *  `PlacementChoice.origin` — the current viewport centre. */
  commitRefresh: (plan: RefreshDiffPlan, resolution: RefreshResolution, newNodeOrigin: XY) => RefreshCommitResult | LockedRefusal
  /** §DI-D19 item 2 — rename a bound table's display `label` and recompose
   *  every `labelAutoComposed: true` Parameter that draws on it (this
   *  table's own, via §DI10's 4th label constituent) as ONE atomic Undo
   *  entry, however many Parameters it touches. Guards mirror
   *  `validateDrafts`'s own storage rules (`empty-table-name`/
   *  `label-too-long`) — a rename path must never store a name first import
   *  could never have produced. */
  renameDataImportTable: (id: string, newLabel: string) => { ok: true } | { ok: false; reason: 'empty-table-name' | 'label-too-long' } | LockedRefusal
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  setEdgeData: (id: string, data: LoopEdgeData) => void
  /** docs/flow-colour-and-compact-nodes.md FC-2.4 — set (`#RRGGBB` in any
   *  form `readAccent` takes) or remove (`null`) the flow colour of these
   *  nodes and edges as ONE undo entry. Elements that already have it are
   *  left alone; when nothing changes, no entry. Never a simulation change. */
  setAccent: (nodeIds: readonly string[], edgeIds: readonly string[], accent: string | null) => void
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  setSelection: (nodeId: string | null, edgeId: string | null) => void
  /** a new, empty document: a document boundary, unlocked (#334) */
  newGraph: () => void
  loadGraph: (snapshot: Snapshot, opts: LoadGraphOptions) => void
  loadDoc: (doc: { nodes: LoopNode[]; edges: LoopEdge[] }, opts: LoadDocOptions) => void
  /** a document boundary (#334); returns the file's `recommendedRunConfig` (if
   *  any) for the caller to apply — its lock is already applied */
  loadJSON: (text: string) => RecommendedRunConfig | undefined
  exportJSON: (recommendedRunConfig?: RecommendedRunConfig) => string
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

// The lightweight loop-revision/1 project *header* (or null) that autosaves in
// the SAME `localStorage` record as the graph — one atomic write, so a graph
// and its project lineage can never come from two different moments
// (SEMANTICS-R.md review round 2). `projectStore` is the only writer, via
// `setAutosaveProjectHeader`; graphStore just carries the opaque value.
let autosaveProjectHeader: unknown = null

// The CURRENT Timeline visible-series selection (simStore, UI-only) rides in the
// SAME autosave record as the graph — the only `recommendedRunConfig` slice that
// survives a `localStorage` restore (serialize.ts), so a plain reload restores
// the selection instead of falling back to "every series shown, no collapse".
// This is reload state, not a reinterpretation of the file-level field.
// `simStore` is the only writer, via `setAutosaveTimelineSeries`; graphStore
// just carries the value so its own graph-edit saves don't drop it. Seeded from
// the boot record below. `'auto'` ⇒ the record carries no field.
let autosaveTimelineSeries: TimelineSeries = 'auto'

/** Set (or clear with `null`) the project header persisted alongside the graph,
 *  and flush it immediately with the current graph in one write. Called by
 *  `projectStore` on commit / open / clear. */
export function setAutosaveProjectHeader(header: unknown): void {
  autosaveProjectHeader = header ?? null
  writeAutosaveNow()
}

/** Persist the Timeline visible-series selection into the autosave record and
 *  flush it immediately with the current graph in one write (mirrors
 *  `setAutosaveProjectHeader`). Called by `simStore` on every legend toggle /
 *  `setTimelineSeries`, so the choice survives a plain reload even with no
 *  intervening graph edit. `'auto'` clears the field; `'all'` writes it. */
export function setAutosaveTimelineSeries(ts: TimelineSeries): void {
  autosaveTimelineSeries = Array.isArray(ts) ? [...ts] : ts
  writeAutosaveNow()
}

/** Seed the Timeline selection for a document being LOADED — updates what the
 *  next autosave will carry WITHOUT flushing a write of its own. The load
 *  itself (`loadDoc` → `persist()`) already schedules the debounced graph save,
 *  and that save picks this value up; an extra immediate write here is exactly
 *  what `docs/timeline-series-contract.md` §3.2 forbids ("loading or resolving
 *  `timelineSeries` must not cause an additional immediate autosave"). USER
 *  actions go through `setAutosaveTimelineSeries`, where the flush is right. */
export function seedAutosaveTimelineSeries(ts: TimelineSeries): void {
  autosaveTimelineSeries = Array.isArray(ts) ? [...ts] : ts
}

/** The raw project header from the last autosave record — read once by
 *  `projectStore` on boot. */
export function bootProjectHeader(): unknown {
  return loadFromStorage()?.project ?? null
}

/** The Timeline visible-series selection from the last autosave record — read
 *  once by `simStore` to seed its initial `timelineSeries`. `'auto'` when the
 *  record is absent / has no `timelineSeries`. */
export function bootTimelineSeries(): TimelineSeries {
  return autosaveTimelineSeries
}

// The undo history carries opaque per-frame "sidecars" alongside the graph.
// `projectStore` registers one (the loop-revision/1 project header lineage,
// SEMANTICS-R.md §R7.3); LGR Slice 5 (`SEMANTICS-R5.md` / §SF11) registers a
// second (the saved manual `frameStore.frames`), so a single undo / redo
// restores the graph AND its saved frames together. Each is a `get`/`set`
// pair — not store state, no re-renders.
type Sidecar = { get: () => unknown; set: (h: unknown) => void }
/** LGR Slice 5 + §TLO12 — the frame sidecar also exposes a label-only remap so
 *  a locale switch can retitle the live frames without a `loadFrames` (which
 *  would reset selection / tool / ordinal). */
type FrameSidecar = Sidecar & { relabel: (titles: Readonly<Record<string, string>>) => void }
let projectSidecar: Sidecar | null = null
let frameSidecar: FrameSidecar | null = null
/** `loop-revision/8` (SEMANTICS-R8.md) — the saved data-import source records
 *  sidecar, registered by the (Phase 1B) data-import store, same shape /
 *  purpose as `frameSidecar`. No `relabel`: these records hold user-typed /
 *  spreadsheet-sourced text, never an app-authored template label a locale
 *  switch would retitle. */
let dataImportSidecar: Sidecar | null = null
export function setHistorySidecar(s: Sidecar | null): void {
  projectSidecar = s
}
/** LGR Slice 5 — `frameStore` registers its saved-frames snapshot/restore pair
 *  (plus the §TLO12 `relabel`) here so a graph undo / redo carries the frames
 *  with it (§SF11) and a locale switch can retitle them. */
export function setFrameHistorySidecar(s: FrameSidecar | null): void {
  frameSidecar = s
}
/** `loop-revision/8` — the data-import store registers its saved-records
 *  snapshot/restore pair here so a graph undo / redo carries them with it,
 *  mirroring `setFrameHistorySidecar`. */
export function setDataImportHistorySidecar(s: Sidecar | null): void {
  dataImportSidecar = s
}
// Issue #334 — the Canvas edit lock (docs/canvas-edit-lock.md). This store
// cannot import `uiStore` (uiStore → mcStore → graphStore would be a cycle), so
// `editPolicy.ts` registers here, the way the history sidecars do: the guard
// that blocks every user edit while the canvas is locked, and the sink a
// document replacement writes the new document's lock through. Unregistered (a
// bare store in a unit test) ⇒ nothing is blocked and nothing is written.
let editGuard: () => boolean = () => false
let documentLockSink: ((locked: boolean) => void) | null = null
export function setEditGuard(fn: (() => boolean) | null): void {
  editGuard = fn ?? (() => false)
}
export function setDocumentLockSink(fn: ((locked: boolean) => void) | null): void {
  documentLockSink = fn
}
/** true while the edit lock blocks user edits; `frameStore` and `projectStore`
 *  ask before their own document changes */
export function isEditBlocked(): boolean {
  return editGuard()
}
/** #334 — a React Flow `replace` change that differs from the current element
 *  ONLY in `selected` (what `setNodes((ns) => ns.map(n => ({ ...n, selected })))`
 *  produces): a selection, which the edit lock lets through */
function selectionOnlyReplace(
  c: { type: string; id?: string; item?: unknown },
  current: readonly { id: string }[],
): boolean {
  if (c.type !== 'replace' || !c.item) return false
  const cur = current.find((x) => x.id === c.id) as Record<string, unknown> | undefined
  if (!cur) return false
  const next = c.item as Record<string, unknown>
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)])
  keys.delete('selected')
  for (const k of keys) if (!Object.is(cur[k], next[k])) return false
  return true
}
// docs/bundled-module-label-localization.md §MLS3.2 — `m` rides along on the
// SAME sidecar bundle as `p`/`f`/`d`, purely in-memory (never serialize()d),
// so a `commit()` / `undo()` / `redo()` carries a document's module-tracking
// state with it exactly like the project header and saved frames do.
type SidecarBundle = { p: unknown; f: unknown; d: unknown; m: ModuleProvenanceSnapshot }
const sidecarNow = (framesOverride?: unknown): SidecarBundle => ({
  p: projectSidecar?.get() ?? null,
  f: framesOverride !== undefined ? framesOverride : (frameSidecar?.get() ?? null),
  d: dataImportSidecar?.get() ?? null,
  m: moduleProvenanceSnapshot(),
})
const restoreSidecar = (sc: unknown): void => {
  const b = (sc ?? { p: null, f: null, d: null, m: [] }) as SidecarBundle
  // `frameSidecar`/`dataImportSidecar` first: `projectSidecar.set` (via
  // `projectStore`'s own `persist()`) synchronously flushes an autosave
  // write immediately, reading `liveFrames()`/`liveDataImports()` at that
  // instant AND cancelling the debounced `persist()` timer already
  // scheduled by this same undo/redo -- restoring project last ensures that
  // immediate flush sees the fully-restored frames/data-imports rather than
  // a stale pre-restore value that then never gets corrected.
  frameSidecar?.set(b.f ?? null)
  dataImportSidecar?.set(b.d ?? null)
  restoreModuleProvenanceSnapshot(b.m) // §MLS3.2 -- no autosave interaction, order doesn't matter
  projectSidecar?.set(b.p ?? null)
}
/** LGR Slice 5 — the live saved manual frames, for `serialize` / autosave. The
 *  `frameStore` snapshot is already `SavedFrame`-shaped (id / label / rect /
 *  color; no `n`). `undefined` when no frames or before `frameStore` registers. */
const liveFrames = (): readonly SavedFrame[] | undefined => {
  const f = frameSidecar?.get()
  return Array.isArray(f) && f.length > 0 ? (f as SavedFrame[]) : undefined
}
/** `loop-revision/8` — the live saved data-import source records, for
 *  `serialize` / autosave, mirroring `liveFrames`. */
const liveDataImports = (): readonly ImportSourceTable[] | undefined => {
  const d = dataImportSidecar?.get()
  return Array.isArray(d) && d.length > 0 ? (d as ImportSourceTable[]) : undefined
}

/** THE autosave write: the live graph + project header + Timeline series +
 *  saved frames + data-import records, one `localStorage` record. Cancels any
 *  pending debounced write (it would only rewrite the same state) and reports
 *  the outcome to `autosaveStore` — a refused write (storage quota, storage
 *  blocked) is a visible, persistent state, never a silent skip (audit ①-4). */
function writeAutosaveNow(): void {
  clearTimeout(saveTimer)
  saveTimer = undefined
  const s = useGraphStore.getState()
  useAutosaveStore.getState().report(
    saveToStorage(
      s.nodes,
      s.edges,
      autosaveProjectHeader,
      autosaveTimelineSeries,
      s.modelVersion,
      liveFrames(),
      liveDataImports(),
    ),
  )
}

/** Write the pending debounced autosave RIGHT NOW, if there is one. Called on
 *  `pagehide` and when the tab goes hidden: the 400 ms debounce otherwise
 *  loses an edit made just before a close / reload / app switch (reproduced:
 *  an edit 150 ms before a reload was gone). A no-op when nothing is pending. */
export function flushAutosave(): void {
  if (saveTimer === undefined) return
  writeAutosaveNow()
}

/** Issue #297 — write the live document NOW, pending or not: the first write
 *  of a session that just became personal (the person confirmed that the open
 *  diagram is to be saved in this browser), and the seed of a temporary
 *  session that took the open diagram along. */
export function persistNow(): void {
  writeAutosaveNow()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // `pagehide` fires for a close, a reload and a navigation (also on iOS,
  // where `beforeunload` does not); the hidden transition covers a mobile
  // app switch that never comes back. Both are allowed a synchronous
  // localStorage write.
  window.addEventListener('pagehide', flushAutosave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave()
  })
}

// ── save boundary (SEMANTICS of an undo step) ───────────────────────────────
// One history entry per discrete action. Continuous actions coalesce: a node
// drag is one entry; rapid edits to the same field within COALESCE_MS are one
// entry. Selection and simulation never create history.
const COALESCE_MS = 600
const HISTORY_MAX = 100

// docs/flow-colour-and-compact-nodes.md FC-2.4 — a flow colour is not a model
// change: setting, removing, undoing or redoing one never resets the run.
const accentOf = (data: unknown): unknown => (data as { accent?: unknown } | undefined)?.accent
const withoutAccent = (data: unknown): string => {
  if (!data || typeof data !== 'object') return JSON.stringify(data)
  const { accent: _accent, ...rest } = data as Record<string, unknown>
  return JSON.stringify(rest)
}
/** true when `a` and `b` differ ONLY in some element's `data.accent` (and at
 *  least one accent does differ): same model version, same elements in the
 *  same order, same positions, handles and every other data field. */
export function onlyAccentsDiffer(
  a: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion: ModelSemanticsVersion },
  b: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion: ModelSemanticsVersion },
): boolean {
  if (a.modelVersion !== b.modelVersion) return false
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  let accentChanged = false
  for (let i = 0; i < a.nodes.length; i++) {
    const p = a.nodes[i]!, q = b.nodes[i]!
    if (p === q) continue
    if (p.id !== q.id || p.type !== q.type || p.position?.x !== q.position?.x || p.position?.y !== q.position?.y) return false
    if (p.data === q.data) continue
    if (withoutAccent(p.data) !== withoutAccent(q.data)) return false
    if (accentOf(p.data) !== accentOf(q.data)) accentChanged = true
  }
  for (let i = 0; i < a.edges.length; i++) {
    const p = a.edges[i]!, q = b.edges[i]!
    if (p === q) continue
    if (
      p.id !== q.id || p.source !== q.source || p.target !== q.target ||
      (p.sourceHandle ?? null) !== (q.sourceHandle ?? null) || (p.targetHandle ?? null) !== (q.targetHandle ?? null)
    ) return false
    if (p.data === q.data) continue
    if (withoutAccent(p.data) !== withoutAccent(q.data)) return false
    if (accentOf(p.data) !== accentOf(q.data)) accentChanged = true
  }
  return accentChanged
}

/** docs/flow-colour-and-compact-nodes.md FC-5 — what a colour choice applies
 *  to: every node and edge React Flow marks `selected`; with none marked, the
 *  one `selectedNodeId` / `selectedEdgeId` the Inspector shows. The selection
 *  model itself is unchanged, and the flags never reach a document (`serialize`
 *  writes id, type, position and data only). */
export function accentTargets(s: {
  nodes: LoopNode[]
  edges: LoopEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
}): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds = s.nodes.filter((n) => n.selected).map((n) => n.id)
  const edgeIds = s.edges.filter((e) => e.selected).map((e) => e.id)
  if (nodeIds.length > 0 || edgeIds.length > 0) return { nodeIds, edgeIds }
  return {
    nodeIds: s.selectedNodeId != null && s.nodes.some((n) => n.id === s.selectedNodeId) ? [s.selectedNodeId] : [],
    edgeIds: s.selectedEdgeId != null && s.edges.some((e) => e.id === s.selectedEdgeId) ? [s.selectedEdgeId] : [],
  }
}
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
      },
      {
        id: 'sample-e2',
        source: 'sample-pool',
        target: 'sample-drain',
        type: 'loop',
        data: { kind: 'resource', flow: '1' },
      },
    ],
  }
}

/** docs/large-graph-readability.md §LGR12.3 — how many nodes carry React
 *  Flow's `selected` flag. A primitive selector: a subscriber re-renders only
 *  when the COUNT changes, never on a node move. Shared by the desktop right
 *  column (DesktopInspector) and the mobile Inspector sheet. */
export const selectSelectedNodeCount = (s: { nodes: { selected?: boolean }[] }): number =>
  s.nodes.reduce((n, x) => n + (x.selected ? 1 : 0), 0)

export const useGraphStore = create<GraphStore>((set, get) => {
  const stored = loadFromStorage()
  const boot = normalizeGraph(stored ?? makeSample())
  const bootModelVersion: ModelSemanticsVersion = stored?.modelVersion ?? 1
  autosaveProjectHeader = stored?.project ?? null
  autosaveTimelineSeries = readTimelineSeries(stored?.recommendedRunConfig?.timelineSeries)

  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(writeAutosaveNow, 400)
  }
  /** any full-document swap starts with "no project"; a project-aware caller
   *  (`projectStore.openRevisionFromFile`) re-sets the header right after. */
  const dropProjectHeader = () => {
    autosaveProjectHeader = null
  }

  /** One-way latch: the first edit / undo / redo / structural change ends the
   *  "pristine sample" state for the rest of the session (SEMANTICS-U.md §U5.6). */
  const clearPristine = () => {
    if (get().pristineSample) set({ pristineSample: false })
  }

  /** Snapshot the CURRENT state into history before a mutation is applied.
   *  `framesOverride` (LGR Slice 5) lets a caller pin the PRE-gesture saved
   *  frames — e.g. a frame resize/move commits once, at the first move, with
   *  the rect the frame had when the drag started (§SF11.1). */
  const commit = (tag: string, framesOverride?: unknown) => {
    const now = Date.now()
    const coalesce = tag !== '' && tag === lastTag && now - lastTagAt < COALESCE_MS
    lastTag = tag
    lastTagAt = now
    // 'remove' coalesces only within a single tick (node + cascaded edges),
    // never across two separate deletions.
    if (tag === 'remove') queueMicrotask(() => { if (lastTag === 'remove') lastTag = '' })
    clearPristine() // any edit / load / template — even a coalesced one — ends "pristine"
    if (coalesce) return
    const { nodes, edges, modelVersion } = get()
    set({
      past: [...get().past, { nodes, edges, modelVersion, sidecar: sidecarNow(framesOverride) }].slice(-HISTORY_MAX),
      future: [], // a fresh action discards the redo branch AND its sidecars
      canUndo: true,
      canRedo: false,
    })
  }

  /** Signal a simulation-relevant change (structure or node/edge data). */
  const bump = () => {
    clearPristine() // covers undo / redo / structural changes that skip `commit`
    set({ simulationRev: get().simulationRev + 1 })
  }

  /** Issue #334 — entering another document (New, a Template, a file, a share
   *  link, a Workspace, a project revision, Open proposal as document). The new
   *  document's lock is written first, once, as its FINAL value: a locked
   *  Template or file stays locked throughout, a document without one unlocks;
   *  there is no unlock-then-relock. Returns the history reset for the caller's
   *  one `set` of the new graph, so Undo can never cross into the previous
   *  document. One synchronous pass: nothing renders or autosaves in between. */
  const enterDocument = (canvasLocked: boolean) => {
    documentLockSink?.(canvasLocked)
    lastTag = ''
    return { past: [], future: [], canUndo: false, canRedo: false, pristineSample: false }
  }

  return {
    commitHistory: (tag, framesOverride) => commit(tag, framesOverride),
    notifyFrameChange: () => persist(),

    captureGestureSnapshot: () => {
      const { nodes, edges, modelVersion } = get()
      const entry: HistoryEntry = { nodes, edges, modelVersion, sidecar: sidecarNow() }
      return entry as unknown as GestureSnapshot
    },
    pushGestureEntry: (snapshot) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      lastTag = '' // the next node drag / edit starts its own entry
      clearPristine()
      set({
        past: [...get().past, snapshot as unknown as HistoryEntry].slice(-HISTORY_MAX),
        future: [], // a fresh action discards the redo branch AND its sidecars
        canUndo: true,
        canRedo: false,
      })
    },
    applyGesturePositions: (positions, waypoints) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      const nIds = Object.keys(positions)
      const eIds = Object.keys(waypoints)
      if (nIds.length === 0 && eIds.length === 0) return
      const cur = get()
      set({
        nodes: nIds.length
          ? cur.nodes.map((n) => {
              const p = positions[n.id]
              return p ? { ...n, position: { x: p.x, y: p.y } } : n
            })
          : cur.nodes,
        edges: eIds.length
          ? cur.edges.map((e) => {
              const wp = waypoints[e.id]
              if (!wp || !e.data) return e
              return { ...e, data: { ...e.data, waypoints: wp.map((q) => ({ x: q.x, y: q.y })) } as LoopEdgeData }
            })
          : cur.edges,
      })
      persist()
    },

    nodes: boot.nodes,
    edges: boot.edges,
    selectedNodeId: null,
    selectedEdgeId: null,
    simulationRev: 0,
    loadRev: 0,
    fitRev: 0,
    pendingInitialView: null,
    pristineSample: stored == null,
    modelVersion: bootModelVersion,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      const { past, future, nodes, edges, modelVersion } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      lastTag = ''
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        modelVersion: prev.modelVersion,
        past: past.slice(0, -1),
        future: [{ nodes, edges, modelVersion, sidecar: sidecarNow() }, ...future].slice(0, HISTORY_MAX),
        canUndo: past.length > 1,
        canRedo: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      // FC-2.4 — undoing a flow colour is not a model change
      if (onlyAccentsDiffer({ nodes, edges, modelVersion }, prev)) clearPristine()
      else bump()
      persist()
      restoreSidecar(prev.sidecar) // restore the project header + saved frames this entry carried
    },

    redo: () => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      const { past, future, nodes, edges, modelVersion } = get()
      if (!future.length) return
      const next = future[0]
      lastTag = ''
      set({
        nodes: next.nodes,
        edges: next.edges,
        modelVersion: next.modelVersion,
        past: [...past, { nodes, edges, modelVersion, sidecar: sidecarNow() }].slice(-HISTORY_MAX),
        future: future.slice(1),
        canUndo: true,
        canRedo: future.length > 1,
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      // FC-2.4 — redoing a flow colour is not a model change
      if (onlyAccentsDiffer({ nodes, edges, modelVersion }, next)) clearPristine()
      else bump()
      persist()
      restoreSidecar(next.sidecar) // restore the project header + saved frames this entry carried
    },

    onNodesChange: (all) => {
      // #334 — while locked, selection and size measurements still apply;
      // a move, add, remove or replace does not (a `replace` that only flips
      // `selected` — React Flow's `setNodes` from a panel's reveal — is a
      // selection, and passes)
      const changes = editGuard()
        ? all.filter((c) => c.type === 'select' || c.type === 'dimensions' || selectionOnlyReplace(c, get().nodes))
        : all
      if (changes.length === 0 && all.length > 0) return
      const dragging = changes.some((c) => c.type === 'position' && c.dragging)
      const settled = changes.some((c) => c.type === 'position' && c.dragging === false)
      const removed = changes.some((c) => c.type === 'remove')
      // 'remove' tag: a node deletion and the connected-edge deletions React Flow
      // cascades arrive as separate calls in the same tick — coalesce them into
      // one history entry so a single undo brings the node AND its edges back.
      if (removed) commit('remove')
      else if (dragging) commit('move')
      set({ nodes: applyNodeChanges(changes, get().nodes) })
      if (removed) bump()
      if (settled) lastTag = '' // end of a drag gesture
      persist()
    },

    onEdgesChange: (all) => {
      const changes = editGuard() ? all.filter((c) => c.type === 'select' || selectionOnlyReplace(c, get().edges)) : all // #334 — see onNodesChange
      if (changes.length === 0 && all.length > 0) return
      const removed = changes.some((c) => c.type === 'remove')
      if (removed) commit('remove')
      set({ edges: applyEdgeChanges(changes, get().edges) })
      if (removed) bump()
      persist()
    },

    onConnect: (conn) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      if (!conn.source || !conn.target) return
      const viaState =
        conn.sourceHandle?.startsWith('state') || conn.targetHandle?.startsWith('state')
      const edge: LoopEdge = viaState
        ? {
            id: nextId('e'),
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle?.startsWith('state')
              ? conn.sourceHandle
              : 'state-source',
            targetHandle: conn.targetHandle?.startsWith('state')
              ? conn.targetHandle
              : 'state-target',
            type: 'loop',
            data: { kind: 'state', mode: 'trigger', expr: '' },
          }
        : {
            id: nextId('e'),
            source: conn.source,
            target: conn.target,
            // resource edges always ride the side circular ports
            sourceHandle: 'out',
            targetHandle: 'in',
            type: 'loop',
            data: { kind: 'resource', flow: '1' },
          }
      commit('')
      set({ edges: addEdge(edge, get().edges) })
      bump()
      persist()
    },

    addNodeAt: (kind, position) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      commit('')
      // docs/localization.md §L3.4a — the name is resolved for the CURRENT UI
      // language at placement, then de-duplicated against the graph's display
      // names. This is the only node-creation path that localizes a name;
      // import / template / duplicate / paste keep their stored names.
      const base = defaultNodeLabel(kind, useI18n.getState().activeCatalog)
      const label = uniqueNodeLabel(
        base,
        get().nodes.map((n) => n.data.label),
      )
      const node = createNode(kind, position, label)
      set({
        nodes: [...get().nodes, node],
        selectedNodeId: node.id,
        selectedEdgeId: null,
      })
      bump()
      persist()
    },

    updateNodeData: (id, patch) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      commit(`data:${id}`)
      // docs/bundled-module-label-localization.md §MLS3.1 (revision 3) —
      // detach EAGERLY, right here at the actual edit, never deferred to the
      // next locale switch: a lazy content-comparison can't distinguish
      // "never edited" from "edited, then edited back to the exact same
      // text" before any switch happens, and the kickoff contract requires
      // the latter to stay excluded forever regardless. `commit()` above has
      // already snapshotted the PRE-edit (still-managed) provenance into
      // `past`; this only mutates the LIVE map, so Undo restores the
      // managed state and Redo restores the detached one, each correctly.
      // A patch that doesn't touch `label`, or sets it to the same value it
      // already has, is not an edit — nothing to detach.
      if (typeof patch.label === 'string') {
        const cur = get().nodes.find((n) => n.id === id)?.data.label
        if (patch.label !== cur) detachModuleProvenance(id)
      }
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } as LoopNode['data'] } : n,
        ),
      })
      // a pure `label` rename does not change what a simulation computes, and
      // neither does a flow colour (FC-2.4)
      if (Object.keys(patch).some((k) => k !== 'label' && k !== 'accent')) bump()
      persist()
    },

    setAccent: (nodeIds, edgeIds, accent) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      const value = accent == null ? undefined : readAccent(accent)
      if (accent != null && value === undefined) return
      const nodeSet = new Set(nodeIds)
      const edgeSet = new Set(edgeIds)
      const differs = (data: unknown) => accentOf(data) !== value
      const { nodes, edges } = get()
      if (!nodes.some((n) => nodeSet.has(n.id) && differs(n.data)) && !edges.some((e) => edgeSet.has(e.id) && differs(e.data))) {
        return
      }
      commit('')
      const recolour = <D,>(data: D): D => {
        const next = { ...(data as Record<string, unknown>) }
        if (value === undefined) delete next.accent
        else next.accent = value
        return next as D
      }
      set({
        nodes: nodes.map((n) => (nodeSet.has(n.id) && differs(n.data) ? { ...n, data: recolour(n.data) } : n)),
        edges: edges.map((e) => (edgeSet.has(e.id) && differs(e.data) ? { ...e, data: recolour(e.data) } : e)),
      })
      persist()
    },

    setEdgeData: (id, data) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      commit(`edge:${id}`)
      const before = get().edges.find((e) => e.id === id)?.data as Record<string, unknown> | undefined
      set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data } : e)) })
      // loop-revision/3 §R3-3 — `route` / `waypoints` are cosmetic: they change
      // the canonical digest but NOTHING a simulation computes, so a routing-only
      // edit must not bump `simulationRev` (mirrors the pure-`label` exemption).
      const after = data as unknown as Record<string, unknown>
      // docs/flow-colour-and-compact-nodes.md FC-2.4 — so is a flow colour
      const COSMETIC = new Set(['route', 'waypoints', 'accent'])
      const touched = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter(
        (k) => !Object.is(before?.[k], after[k]),
      )
      // loop-model/2 (SEMANTICS-M2.md §M2-1.1) — the leading-`@` commit boundary:
      // the user editing a resource-edge `flow` and committing a value whose
      // trimmed form starts with `@` (reference well-formed OR malformed) is the
      // explicit action that promotes a v1 document to v2. One-way; opening /
      // saving a stored `@…` string never triggers this (it never calls here).
      if (
        get().modelVersion === 1 &&
        after.kind === 'resource' &&
        typeof after.flow === 'string' &&
        after.flow.trim().startsWith('@') &&
        !Object.is(before?.flow, after.flow)
      ) {
        set({ modelVersion: 2 })
      }
      // docs/parameter-activator.md §PA11-D4 — the SAME one-way latch extends
      // to a state-edge `activator` whose committed `expr` is a `param-term`
      // (`>= @hard_pity - 1`, PA4). Parsed under `modelVersion: 2` to detect
      // whether the string MEANS a reference — the same asymmetry the
      // resource-`flow` check above doesn't need, because a bare leading `@`
      // has no OTHER meaning to parse under v1, while an activator's `@`
      // sits after an operator and must be parsed to tell "a param-term" from
      // "coincidentally contains an at-sign" (unreachable today, but the
      // parse is cheap and exact rather than a heuristic substring check).
      if (
        get().modelVersion === 1 &&
        after.kind === 'state' &&
        after.mode === 'activator' &&
        typeof after.expr === 'string' &&
        !Object.is(before?.expr, after.expr)
      ) {
        const parsedAsV2 = parseActivatorExpr(after.expr, 2)
        if (parsedAsV2.ok && parsedAsV2.rhs.kind === 'param') set({ modelVersion: 2 })
      }
      if (touched.length === 0 || !touched.every((k) => COSMETIC.has(k))) bump()
      persist()
    },

    removeNode: (id) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      commit('')
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
      })
      bump()
      persist()
    },

    removeEdge: (id) => {
      if (editGuard()) return // #334 — refused while the edit lock is on
      commit('')
      set({ edges: get().edges.filter((e) => e.id !== id), selectedEdgeId: null })
      bump()
      persist()
    },

    setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),

    newGraph: () => {
      const fresh = enterDocument(false) // #334 — a new document starts unlocked
      dropProjectHeader()
      clearModuleProvenance() // docs/bundled-module-label-localization.md §MLS4.2
      set({
        ...fresh,
        nodes: [],
        edges: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion: 1,
        loadRev: get().loadRev + 1,
        pendingInitialView: null, // §MML3 — no menu framing survives a New
        // `newGraph` does NOT bump `fitRev`: an empty canvas has nothing to fit,
        // and every e2e `resetAll()` calls this right before an `importGraph` —
        // bumping `fitRev` here would arm the Canvas re-fit against the graph
        // that import then loads.
      })
      frameSidecar?.set([]) // §SF6 — an empty canvas has no saved frames
      dataImportSidecar?.set([]) // loop-revision/8 — an empty canvas has no import records
      bump()
      persist()
    },

    loadGraph: (snapshot, { canvasLocked, modelVersion = 1, initialView = null, frames, dataImports }) => {
      // templates and pasted graphs go through the same handle/field backfill
      const { nodes, edges } = normalizeGraph(snapshot)
      const fresh = enterDocument(canvasLocked)
      dropProjectHeader()
      clearModuleProvenance() // docs/bundled-module-label-localization.md §MLS4.2
      set({
        ...fresh,
        nodes,
        edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion,
        loadRev: get().loadRev + 1,
        fitRev: get().fitRev + 1,
        // §MML3 — a menu-opened Template's framing hint; `null` for a paste
        pendingInitialView: initialView,
      })
      // §TLO12 — a Template MAY ship group frames; a pasted graph never does.
      // `undefined` ⇒ clear, byte-identical to the pre-#4A behaviour.
      frameSidecar?.set(frames ? [...frames] : [])
      // loop-revision/8 — same posture as `frames`; no bundled Template ships
      // any yet, but a future one could.
      dataImportSidecar?.set(dataImports ? [...dataImports] : [])
      bump()
      persist()
    },

    loadJSON: (text) => {
      const { nodes, edges, recommendedRunConfig, modelVersion, frames, dataImports } = deserialize(text)
      get().loadDoc(
        { nodes, edges },
        { mode: 'document-boundary', canvasLocked: recommendedRunConfig?.canvasLocked === true, modelVersion, frames, dataImports },
      )
      return recommendedRunConfig
    },

    /** load already-deserialized (and normalized) nodes/edges — one `bump()`.
     *  Used by `loadJSON`, the Workspace importer, the share link, the project
     *  revision paths and revision Apply, so the whole restore is a single
     *  `simulationRev` step (SEMANTICS-W.md §W5.1). `opts.mode` (#334) says
     *  whether this is another document (empty history, its own lock) or a
     *  revision Apply on this one (one undo entry, refused while locked). */
    loadDoc: ({ nodes, edges }, opts) => {
      const { modelVersion = 1, frames, dataImports } = opts
      let history: ReturnType<typeof enterDocument> | null = null
      if (opts.mode === 'document-boundary') history = enterDocument(opts.canvasLocked)
      else {
        if (editGuard()) return // #334 — a revision Apply is an edit
        commit('')
        lastTag = ''
      }
      dropProjectHeader()
      clearModuleProvenance() // docs/bundled-module-label-localization.md §MLS4.2
      set({
        ...(history ?? {}),
        nodes,
        edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        modelVersion,
        loadRev: get().loadRev + 1,
        pendingInitialView: null, // §MML3 — file / Share / Workspace keeps its own camera
      })
      if (frames !== undefined) frameSidecar?.set(frames) // §SF6 — replace with the doc's saved frames
      if (dataImports !== undefined) dataImportSidecar?.set(dataImports) // loop-revision/8 — same rule
      bump()
      persist()
    },

    insertModule: (mod, opts) => {
      if (editGuard()) return { ok: false, reason: 'locked' } // #334 — the edit lock
      const g = get()
      const built = insertGraph(
        { nodes: g.nodes, edges: g.edges, modelVersion: g.modelVersion },
        mod,
        { at: opts.at },
      )
      if (!built.ok) return { ok: false, reason: built.reason }
      // §MS3.4 / MS7-2 — a v1 host + v2 module promotion is never silent. Bail
      // (changing nothing) until the caller re-invokes with the user's consent.
      if (built.promotedToV2 && !opts.confirmedPromotion) {
        return { ok: false, reason: 'needs-v2-consent' }
      }
      // §MS3.5 / B5 — ONE history entry. `commit('')` snapshots the pre-insert
      // nodes + edges + `modelVersion` + both sidecars; the single `set` below
      // binds the re-issued ids, the v2 promotion, the whole inserted set, and
      // the selection change together. One Ctrl+Z reverts all of it.
      commit('')
      lastTag = ''
      // docs/bundled-module-label-localization.md §MLS4.1 — registered only
      // now that the insert has actually committed (past the v2-consent
      // bail-out above); a no-op when `bundledModuleId` is undefined (a
      // file-inserted module never reaches this with one set). `label` is
      // each node's ACTUAL applied label right now (the EN canonical or the
      // KO/JA overlay's entry `cloneModuleDoc` already wrote before this
      // call), so `lastAppliedLabel` starts in sync with the real node.
      registerModuleProvenance(
        Object.entries(built.idMap).map(([canonicalId, freshId]) => ({
          freshId,
          canonicalId,
          label: built.nodes.find((n) => n.id === freshId)?.data.label ?? '',
        })),
        opts.bundledModuleId,
      )
      const inserted = new Set(built.insertedNodeIds)
      set({
        nodes: built.nodes.map((n) =>
          inserted.has(n.id)
            ? { ...n, selected: true }
            : n.selected
              ? { ...n, selected: false } // §MS3.3 — inserted nodes, and nothing else
              : n,
        ),
        edges: built.edges,
        modelVersion: built.modelVersion,
        selectedNodeId: built.insertedNodeIds.length === 1 ? built.insertedNodeIds[0] : null,
        selectedEdgeId: null,
      })
      bump()
      persist()
      return { ok: true, insertedNodeIds: built.insertedNodeIds, promotedToV2: built.promotedToV2 }
    },

    commitDataImport: (plan, placement) => {
      if (editGuard()) return { ok: false, reason: 'locked' } // #334 — the edit lock
      const g = get()
      const existingFrames = (frameSidecar?.get() as SavedFrame[] | null) ?? []
      const existingTables = (dataImportSidecar?.get() as ImportSourceTable[] | null) ?? []
      const built = buildImportCommit(plan, placement, { nodes: g.nodes, edges: g.edges }, existingFrames, existingTables)
      if (!built.ok) return built // includes the pre-commit collision gate -- nothing mutated yet
      commit('')
      lastTag = ''
      set({ nodes: [...g.nodes, ...built.createdNodes], selectedNodeId: null, selectedEdgeId: null })
      if (built.createdFrames.length) frameSidecar?.set([...existingFrames, ...built.createdFrames])
      dataImportSidecar?.set([...existingTables, ...built.tables])
      bump()
      persist()
      return built
    },

    commitRefresh: (plan, resolution, newNodeOrigin) => {
      if (editGuard()) return { ok: false, reason: 'locked' } // #334 — the edit lock
      const g = get()
      const existingFrames = (frameSidecar?.get() as SavedFrame[] | null) ?? []
      const existingTables = (dataImportSidecar?.get() as ImportSourceTable[] | null) ?? []
      const built = buildRefreshCommit(existingTables, plan, resolution, { nodes: g.nodes, edges: g.edges }, g.modelVersion, newNodeOrigin, existingFrames)
      if (!built.ok) return built // referenced-node / missing-row-dependency refusal -- nothing mutated yet
      commit('')
      lastTag = ''
      const updatedById = new Map(built.updatedNodes.map((n) => [n.id, n]))
      const removedIds = new Set(built.removedNodeIds)
      set({
        nodes: [...g.nodes.filter((n) => !removedIds.has(n.id)).map((n) => updatedById.get(n.id) ?? n), ...built.createdNodes],
        selectedNodeId: null,
        selectedEdgeId: null,
      })
      // replace each updated table IN PLACE at its existing position --
      // never remove-then-append, which would silently reorder the
      // `dataImports` array (moving the refreshed table to the bottom of
      // the Manage-bindings list) and needlessly change the serialized
      // order / document digest for tables that didn't change at all.
      // Mirrors `renameDataImportTable`'s own `.map()` replace exactly.
      const updatedTableById = new Map(built.updatedTables.map((t) => [t.sourceTableId, t]))
      dataImportSidecar?.set(existingTables.map((t) => updatedTableById.get(t.sourceTableId) ?? t))
      bump()
      persist()
      return built
    },

    renameDataImportTable: (id, newLabel) => {
      if (editGuard()) return { ok: false, reason: 'locked' } // #334 — the edit lock
      if (newLabel.trim() === '') return { ok: false, reason: 'empty-table-name' }
      if (newLabel.length > DI_LABEL_MAX) return { ok: false, reason: 'label-too-long' }
      const existingTables = (dataImportSidecar?.get() as ImportSourceTable[] | null) ?? []
      const table = existingTables.find((t) => t.sourceTableId === id)
      if (!table) return { ok: true } // no matching binding -- nothing to rename
      const renamedTable: ImportSourceTable = { ...table, label: newLabel }
      const nextTables = existingTables.map((t) => (t.sourceTableId === id ? renamedTable : t))

      const g = get()
      const updatedNodes: LoopNode[] = []
      for (const n of g.nodes) {
        if (n.data.kind !== 'parameter' || n.data.sourceTableId !== id || n.data.labelAutoComposed !== true) continue
        if (!n.data.sourceKey || !n.data.sourceColumnId) continue
        const label = parameterLabel(nextTables, id, n.data.sourceKey, n.data.sourceColumnId)
        if (label === null || label === n.data.label) continue
        updatedNodes.push({ ...n, data: { ...n.data, label } })
      }

      // §DI-D19 item 2 -- the rename lands as ONE atomic Undo entry
      // regardless of whether any Parameter's label actually needed
      // recomposing: a pure-lookup table (no number column, so zero
      // Parameters) or one whose every Parameter is already hand-detached
      // still renames the BINDING itself, and that change alone must still
      // be committed and persisted -- skipping `commit()`/`persist()` here
      // left such a rename un-undoable and, worse, unsaved (an immediate
      // reload silently lost it, since `persist()` is what schedules the
      // autosave write).
      commit('')
      lastTag = ''
      if (updatedNodes.length > 0) {
        const byId = new Map(updatedNodes.map((n) => [n.id, n]))
        set({ nodes: g.nodes.map((n) => byId.get(n.id) ?? n) })
      }
      dataImportSidecar?.set(nextTables)
      bump()
      persist()
      return { ok: true }
    },

    exportJSON: (recommendedRunConfig) =>
      serialize(
        get().nodes,
        get().edges,
        recommendedRunConfig,
        undefined,
        undefined,
        get().modelVersion,
        liveFrames(),
        liveDataImports(),
      ),
  }
})

// ── docs/template-label-overlay.md §TLO11 + §TLO12 — official-template label /
// frame-title locale switch, joined by
// docs/bundled-module-label-localization.md §MLS4.3 — official-bundled-MODULE
// label locale switch (a per-instance provenance lookup, chained after the
// Template pass; §MLS2 explains why modules can't share the Template's
// static-id-table mechanism).
// When the UI language changes, re-seed the OFFICIAL bundled-template node
// labels AND frame titles, AND the OFFICIAL bundled-module instance labels
// (only a string that is EXACTLY one of that id's shipped-locale strings) in
// the live graph and in every undo/redo snapshot, so a switch never leaves a
// half-translated document and an undo cannot bring the old language back.
// String-only: no history entry, no `simulationRev` / `loadRev` / `fitRev` /
// `pristineSample` change, no recommended-config touch. Idempotent — a
// re-select or a same-locale boot writes nothing. Three change axes are
// judged independently: `liveNodesChanged`, `liveFramesChanged`,
// `historyChanged` (nodes OR the frame sidecar in any past/future entry). A
// history-only diff still commits the new `past` / `future`; autosave (which
// stores the LIVE doc only) fires once, and only when something LIVE changed.
let lastLocaleForLabels = useI18n.getState().activeLocale
useI18n.subscribe((s) => {
  if (s.activeLocale === lastLocaleForLabels) return
  lastLocaleForLabels = s.activeLocale
  const loc = s.activeLocale

  const g = useGraphStore.getState()

  // live nodes — Template pass, then the module-instance pass (which also
  // returns a possibly-updated LIVE provenance snapshot: a successful
  // relabel bumps `lastAppliedLabel`, a detachment (§MLS3.1) drops an
  // entry). Each pass keeps the same array reference when it changes
  // nothing, so chaining costs nothing extra when neither (or only one)
  // applies.
  const tNodes = relabelNodesForLocale(g.nodes, loc)
  const liveProvBefore = moduleProvenanceSnapshot()
  const { nodes, provenance: liveProvAfter } = relabelModuleNodesForLocale(tNodes, loc, liveProvBefore)
  const liveNodesChanged = nodes !== g.nodes
  const liveProvChanged = liveProvAfter !== liveProvBefore

  // live frames (via the sidecar — `relabelFramesForLocale` keeps the ref when
  // unchanged, so identity is a safe "changed?" signal)
  const curFrames = (frameSidecar?.get() as SavedFrame[] | null) ?? []
  const relFrames = relabelFramesForLocale(curFrames, loc)
  const liveFramesChanged = relFrames !== curFrames

  // history — remap BOTH the node labels (Template + module) and the frame
  // sidecar of every entry. Each entry's module pass uses THAT ENTRY's OWN
  // sidecar snapshot (`sc.m`), never the live one — a node detached live may
  // still have been under management at an earlier point in history (and a
  // node the live map still tracks may already have been detached at an
  // earlier point), so each point in time is relabeled against its own
  // recorded state, exactly like `nodes`/`edges`/`modelVersion` themselves.
  const remap = (h: HistoryEntry): HistoryEntry => {
    const n0 = relabelNodesForLocale(h.nodes, loc)
    const sc = h.sidecar as { p: unknown; f: unknown; d?: unknown; m?: ModuleProvenanceSnapshot } | null | undefined
    const mProvBefore = sc?.m ?? []
    const { nodes: n, provenance: mProvAfter } = relabelModuleNodesForLocale(n0, loc, mProvBefore)
    const f0 = (sc?.f as SavedFrame[] | null) ?? null
    const f1 = f0 ? relabelFramesForLocale(f0, loc) : f0
    const nChg = n !== h.nodes
    const fChg = f1 !== f0
    const mChg = mProvAfter !== mProvBefore
    if (!nChg && !fChg && !mChg) return h
    return {
      ...h,
      ...(nChg ? { nodes: n } : {}),
      ...(fChg || mChg
        ? {
            sidecar: {
              ...(sc ?? { p: null, f: null, d: null, m: [] }),
              ...(fChg ? { f: f1 } : {}),
              ...(mChg ? { m: mProvAfter } : {}),
            },
          }
        : {}),
    }
  }
  const past = g.past.map(remap)
  const future = g.future.map(remap)
  const pastChanged = past.some((h, i) => h !== g.past[i])
  const futureChanged = future.some((h, i) => h !== g.future[i])
  const historyChanged = pastChanged || futureChanged

  if (!liveNodesChanged && !liveProvChanged && !liveFramesChanged && !historyChanged) return

  // live provenance: a label-only remap's bookkeeping, same posture as the
  // frame-title relabel below — no undo entry, no autosave interaction.
  if (liveProvChanged) restoreModuleProvenanceSnapshot(liveProvAfter)

  // live frame titles: a label-only remap — no undo entry, no autosave here
  if (liveFramesChanged) {
    const titles: Record<string, string> = {}
    for (const f of relFrames) titles[f.id] = f.label
    frameSidecar?.relabel(titles)
  }

  if (liveNodesChanged || historyChanged) {
    useGraphStore.setState({
      ...(liveNodesChanged ? { nodes } : {}),
      ...(pastChanged ? { past } : {}),
      ...(futureChanged ? { future } : {}),
    })
  }

  // persist once — autosave stores the LIVE doc, so a history-only remap needs
  // no write.
  if (liveNodesChanged || liveFramesChanged) writeAutosaveNow()
})
