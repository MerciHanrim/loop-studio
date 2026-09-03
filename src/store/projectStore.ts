import { create } from 'zustand'
import {
  AUTHOR_NAME_KEY,
  AUTHOR_NAME_MAX_BYTES,
  AUTHOR_NOTE_MAX_BYTES,
  HEX64,
  LINEAGE_MAX,
  buildSelectiveApply,
  canonicalContent,
  computeThreeWay,
  countThreeWayConflicts,
  digestOfCanonical,
  validateResultGraph,
  isProjectId,
  isRevisionId,
  mintId,
  planProposalExport,
  planRevisionExport,
  truncBytes,
  type AppliedProposal,
  type CanonicalContent,
  type HunkSelection,
  type ProjectMeta,
  type ProjectPayload,
  type ProjectRole,
  type ProposalBase,
  type ProposalExportResult,
  type RevisionExportPlan,
} from '../model/revision'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SavedFrame } from '../model/serialize'
import { bootProjectHeader, setAutosaveProjectHeader, setHistorySidecar, useGraphStore } from './graphStore'
import { useFrameStore } from './frameStore'

// SEMANTICS-R.md §R2 / §R3 / §R6 / §R10 — the OPEN revision, the `dirty` flag,
// and the two-phase Export transaction. Slice 1B (+ review round 2). NO UI.
//
// Consistency rules locked in review round 2:
//  • The Export / Proposal DECISION uses a digest computed *at that instant*,
//    never the debounced display `dirty`.
//  • A pending export plan is single-use: `planId` + identity binding; a stale
//    or double `commitRevisionExport` is a no-op.
//  • The project header autosaves *inside the graph record* (graphStore), so a
//    header can never attach to a graph from another moment.

const TOOL = `loop-studio/${__APP_VERSION__}`

export type OpenProject = {
  projectId: string
  revisionId: string
  parentId: string | null
  role: ProjectRole
  lineage: string[]
  meta: ProjectMeta
  /** digest of the content this revision represents (the last committed /
   *  opened content). `dirty` compares the live graph against this. */
  baselineDigest: string
  /** set on a revision produced by Apply (§R7.1) — provenance only */
  appliedProposal?: AppliedProposal
  /** set only while `role === 'proposal'` — the pinned base the proposal was
   *  first authored against; re-export keeps THIS, not the edited content (§R6) */
  pinnedBase?: { revisionId: string; content: CanonicalContent }
}

export type ApplyClassification = 'exact' | 'divergent' | 'unknown'
export type ApplyFailReason =
  | 'wrong-project'
  | 'no-target'
  | 'target-is-proposal'
  | 'needs-confirmation'
  | 'payload-invalid'
  | 'target-moved'
  | 'invalid-selection'
  | 'no-effective-change'
export type ApplyResult =
  | { ok: true; classification: ApplyClassification; newRevisionId: string; partial?: boolean }
  | {
      ok: false
      reason: ApplyFailReason
      /** the class computed at THIS call (for the confirmation copy) */
      classification?: ApplyClassification
      /** the target digest at THIS call — the caller passes it back as
       *  `expectTargetDigest` so the confirmed apply runs on the same snapshot */
      targetDigest?: string
      /** `invalid-selection` — one short line (dependency / endpoint) */
      detail?: string
      /** `invalid-selection` from full-graph validation — the concrete reasons */
      reasons?: string[]
    }

/** Everything `commitRevisionExport` needs to verify a plan is still current
 *  and to land the right baseline. Returned by `planRevision`. */
export type PendingRevisionPlan = {
  planId: number
  projectId: string
  /** the revision this plan was derived from (`null` when it PROMOTES) */
  baseRevisionId: string | null
  /** `open.baselineDigest` at plan time (`null` when it promotes) */
  baseBaselineDigest: string | null
  /** digest of the content that was written into the file */
  exportedSnapshotDigest: string
  /** the header to adopt on commit */
  pendingHeader: RevisionExportPlan['pendingHeader']
  bytes: number
}

export type PlanRevisionResult =
  | { ok: true; text: string; bytes: number; plan: PendingRevisionPlan }
  | { ok: false; reason: 'too-large'; bytes: number; cap: number }

type PlanProposalResult = ProposalExportResult | { ok: false; reason: 'no-project' }

type ProjectState = {
  open: OpenProject | null
  dirty: boolean
  /** the currently-committable plan id, or `null` — a plan is invalidated by a
   *  newer plan, an Import/Open, or `clear()` */
  activePlanId: number | null

  refreshDirty: () => void
  planRevision: (opts?: PlanOpts) => PlanRevisionResult
  commitRevisionExport: (plan: PendingRevisionPlan) => 'committed' | 'stale' | 'no-op'
  planProposal: (opts?: PlanOpts) => PlanProposalResult
  openRevisionFromFile: (project: ProjectPayload, graphDigest: string) => void
  /** §R10.5 — adopt a proposal file's proposed content as the open document,
   *  pinning its base for re-export. Used by "Open as a document". Atomic: one
   *  `loadDoc` on the proposed graph, then the `proposal` header. */
  openProposalAsDocument: (
    project: ProjectPayload,
    base: ProposalBase,
    proposed: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion?: 1 | 2; frames?: readonly SavedFrame[] },
  ) => void
  /** §R7A.2 — classify a proposal against the open revision without applying
   *  (for the Review UI). Same gates as `applyProposal`. */
  classifyProposal: (input: {
    project: ProjectPayload
    base: ProposalBase
    proposed: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion?: 1 | 2; frames?: readonly SavedFrame[] }
  }) =>
    | { ok: true; classification: ApplyClassification }
    | { ok: false; reason: 'wrong-project' | 'no-target' | 'target-is-proposal' }
  /**
   * §R7 — Apply. Re-gates, re-validates the proposal payload against its own
   * digests. **Whole-proposal** (`opts.selection` absent): RE-CLASSIFIES against
   * the live target; non-`exact` needs `opts.confirmed`; a confirmed apply also
   * passes `opts.expectTargetDigest` so a target that moved since the confirm is
   * refused (`target-moved`). **Per-hunk** (`opts.selection` present, §R7.2):
   * the hunk selection IS the consent — no classification / confirmation gate;
   * `buildSelectiveApply` produces `target + accepted hunks` and an
   * `invalid-selection` (e.g. an accepted edge whose endpoint is absent) is
   * refused before anything changes. Either way: one `loadDoc` (one undo entry,
   * one `simulationRev` bump, paused/step 0), a NEW revision (fresh id,
   * `parentId` = pre-apply, `appliedProposal` recorded), and a single Undo
   * restores the pre-apply GraphDoc AND header (graphStore history sidecar).
   */
  applyProposal: (
    input: {
      project: ProjectPayload
      base: ProposalBase
      proposed: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion?: 1 | 2; frames?: readonly SavedFrame[] }
    },
    opts?: {
      now?: string
      mint?: (p: 'rev') => string
      confirmed?: boolean
      expectTargetDigest?: string
      /** §R7.2 per-hunk selective apply — when present, whole-graph
       *  classification / confirmation is skipped (the selection is consent) */
      selection?: HunkSelection
    },
  ) => ApplyResult
  /** a one-time reboot notice code (currently only: a proposal session that
   *  could not be restored, §R8 reboot rule), or `null`. The UI (`BootNotice`)
   *  maps the code to localized text (`bootNotice.<code>`). */
  bootNotice: 'proposalReboot' | null
  dismissBootNotice: () => void
  clear: () => void
  /** test/boot seam — swap the open header without touching storage */
  _setOpen: (open: OpenProject | null) => void
}

type PlanOpts = { now?: string; mint?: (p: 'proj' | 'rev') => string; maxBytes?: number }

// ── author, header (de)serialisation ───────────────────────────────────────

function readAuthor(): ProjectMeta['author'] {
  try {
    const raw = localStorage.getItem(AUTHOR_NAME_KEY)
    if (!raw) return undefined
    const v = JSON.parse(raw) as { name?: unknown; note?: unknown }
    const name = typeof v.name === 'string' ? truncBytes(v.name, AUTHOR_NAME_MAX_BYTES) : undefined
    const note = typeof v.note === 'string' ? truncBytes(v.note, AUTHOR_NOTE_MAX_BYTES) : undefined
    return name || note ? { ...(name ? { name } : {}), ...(note ? { note } : {}) } : undefined
  } catch {
    return undefined
  }
}

function headerPayload(open: OpenProject) {
  return {
    schema: 'loop-revision/1',
    version: 1,
    projectId: open.projectId,
    revisionId: open.revisionId,
    parentId: open.parentId,
    role: open.role,
    contentDigest: open.baselineDigest,
    lineage: open.lineage,
    meta: open.meta,
    ...(open.appliedProposal ? { appliedProposal: open.appliedProposal } : {}),
  }
}

function isAppliedProposalHeader(x: unknown): x is AppliedProposal {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return isRevisionId(o.proposalId) && isRevisionId(o.baseId) && typeof o.baseDigest === 'string'
}

/** validate a raw autosave `project` header (no graph cross-check here — the
 *  header travels in the SAME record as the graph, so on boot `dirty` is simply
 *  recomputed against that graph). Bad shape ⇒ null. */
function parseHeader(raw: unknown): OpenProject | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.schema !== 'loop-revision/1' || o.version !== 1) return null
  if (!isProjectId(o.projectId) || !isRevisionId(o.revisionId)) return null
  if (o.parentId !== null && !isRevisionId(o.parentId)) return null
  if (typeof o.contentDigest !== 'string' || !HEX64.test(o.contentDigest)) return null
  // §R8 reboot rule — a proposal session's pinned base (`pinnedBase.content`) is
  // never autosaved, so its provenance cannot be honestly restored. Drop the
  // whole header; the caller keeps the graph as a plain document and notifies.
  if (o.role === 'proposal') return null
  return {
    projectId: o.projectId,
    revisionId: o.revisionId,
    parentId: (o.parentId as string | null) ?? null,
    role: 'revision',
    lineage: Array.isArray(o.lineage) ? o.lineage.filter((x): x is string => isRevisionId(x)) : [],
    meta: o.meta && typeof o.meta === 'object' ? (o.meta as ProjectMeta) : {},
    baselineDigest: o.contentDigest,
    ...(isAppliedProposalHeader(o.appliedProposal) ? { appliedProposal: o.appliedProposal } : {}),
  }
}

/** the live graph's canonical content — nodes + edges + the on-screen saved
 *  `frames` (SEMANTICS-R5.md §R5-6: a frame edit is full revision content, it
 *  flips `dirty` and moves this digest exactly like a `label` rename). Computed
 *  fresh every call (§R2, no reliance on the debounced flag). */
function liveContent() {
  const g = useGraphStore.getState()
  return canonicalContent(
    { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
    { modelVersion: g.modelVersion },
  )
}
/** the live graph's canonical digest — see {@link liveContent}. Kept identical
 *  to `revisionIO.currentTargetDigest()`, the value Apply checks it against. */
function liveDigest(): string {
  return digestOfCanonical(liveContent())
}

function persist(open: OpenProject | null): void {
  setAutosaveProjectHeader(open ? headerPayload(open) : null)
}

/** §R7A.2 — three mutually-exclusive classes over the live target (edits
 *  included) and the proposal's `base` + proposed content. `lineage` / parent
 *  are never inputs. */
function classifyAgainst(
  o: OpenProject,
  base: ProposalBase,
  proposed: { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion?: 1 | 2; frames?: readonly SavedFrame[] },
): ApplyClassification {
  // SEMANTICS-R5.md §R5-6 — the target carries the live saved `frames`, so a
  // frames-only local divergence flips it off `exact` and a `frames` conflict
  // feeds `nConf` (⇒ `divergent`), exactly like a `label` conflict.
  const target = liveContent()
  const exact =
    o.revisionId === base.revisionId && digestOfCanonical(target) === base.contentDigest
  if (exact) return 'exact'
  const nConf = countThreeWayConflicts(base.content, target, canonicalContent(proposed, { modelVersion: proposed.modelVersion }))
  return nConf >= 1 ? 'divergent' : 'unknown'
}

// ── store ──────────────────────────────────────────────────────────────────

let planSeq = 0

// §R8 reboot rule — a `role:"proposal"` session cannot be restored from the
// autosave header alone: its provenance (`pinnedBase.content`) is deliberately
// NOT persisted (frozen loop-revision/1). On reboot the header is dropped, the
// graph is kept as a plain document, and a one-time notice (`bootNotice:
// 'proposalReboot'`, rendered by `BootNotice` via `t('bootNotice.…')`) is shown.

export const useProjectStore = create<ProjectState>((set, get) => {
  const rawBoot = bootProjectHeader()
  const open = parseHeader(rawBoot)
  const proposalDropped =
    !open &&
    !!rawBoot &&
    typeof rawBoot === 'object' &&
    (rawBoot as Record<string, unknown>).schema === 'loop-revision/1' &&
    (rawBoot as Record<string, unknown>).role === 'proposal'
  if (proposalDropped) setAutosaveProjectHeader(null) // don't keep re-trying on every boot
  const dirty = open ? liveDigest() !== open.baselineDigest : false

  const authoredMeta = (base: ProjectMeta): ProjectMeta => ({
    ...base,
    tool: TOOL,
    ...(readAuthor() ? { author: readAuthor() } : {}),
  })

  return {
    open,
    dirty,
    activePlanId: null,
    bootNotice: proposalDropped ? 'proposalReboot' : null,

    dismissBootNotice: () => set({ bootNotice: null }),

    refreshDirty: () => {
      const o = get().open
      const d = o ? liveDigest() !== o.baselineDigest : false
      if (d !== get().dirty) set({ dirty: d })
    },

    _setOpen: (o) => set({ open: o, dirty: o ? liveDigest() !== o.baselineDigest : false }),

    planRevision: (opts = {}) => {
      const now = opts.now ?? new Date().toISOString()
      const mkId = opts.mint ?? mintId
      const g = useGraphStore.getState()
      const snapDigest = liveDigest() // §R5-6 — includes the on-screen saved frames
      const o = get().open
      const isDirty = o != null && snapDigest !== o.baselineDigest

      // keep the display flag consistent with the decision just made
      if (get().dirty !== isDirty) set({ dirty: isDirty })

      let projectId: string
      let baseRevisionId: string | null
      let baseBaselineDigest: string | null
      let pr

      if (!o) {
        // PROMOTE — mint a project + its root revision (may throw
        // SecureRandomUnavailableError; the caller aborts)
        projectId = mkId('proj')
        baseRevisionId = null
        baseBaselineDigest = null
        pr = planRevisionExport({
          doc: { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
          modelVersion: g.modelVersion,
          project: { projectId, revisionId: mkId('rev'), parentId: null, lineage: [] },
          dirty: false,
          meta: authoredMeta({ createdAt: now }),
          now,
          mint: () => mkId('rev'),
          maxBytes: opts.maxBytes,
        })
      } else {
        projectId = o.projectId
        baseRevisionId = o.revisionId
        baseBaselineDigest = o.baselineDigest
        pr = planRevisionExport({
          doc: { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
          modelVersion: g.modelVersion,
          project: { projectId: o.projectId, revisionId: o.revisionId, parentId: o.parentId, lineage: o.lineage },
          dirty: isDirty,
          meta: authoredMeta(o.meta),
          now,
          mint: () => mkId('rev'),
          maxBytes: opts.maxBytes,
        })
      }

      if (!pr.ok) return pr // { ok:false, reason:'too-large', ... } — activePlanId untouched

      const planId = ++planSeq
      set({ activePlanId: planId }) // supersedes any earlier plan
      return {
        ok: true,
        text: pr.text,
        bytes: pr.bytes,
        plan: {
          planId,
          projectId,
          baseRevisionId,
          baseBaselineDigest,
          exportedSnapshotDigest: pr.pendingHeader.baselineDigest,
          pendingHeader: pr.pendingHeader,
          bytes: pr.bytes,
        },
      }
    },

    commitRevisionExport: (plan) => {
      if (plan.planId !== get().activePlanId) return 'stale' // superseded / double / from another session
      set({ activePlanId: null }) // consume — a repeat call is a no-op below

      const o = get().open
      if (plan.baseRevisionId === null) {
        // a PROMOTE plan — only valid while still anonymous
        if (o !== null) return 'stale'
      } else {
        // identity + baseline must be exactly what the plan was built against
        if (
          !o ||
          o.projectId !== plan.projectId ||
          o.revisionId !== plan.baseRevisionId ||
          o.baselineDigest !== plan.baseBaselineDigest
        ) {
          return 'stale'
        }
      }

      const h = plan.pendingHeader
      const next: OpenProject = {
        projectId: h.projectId,
        revisionId: h.revisionId,
        parentId: h.parentId,
        role: 'revision',
        lineage: h.lineage,
        meta: h.meta,
        baselineDigest: plan.exportedSnapshotDigest, // the digest of what was WRITTEN
      }
      set({ open: next })
      persist(next)
      get().refreshDirty() // §R2.1 — if the live graph moved on, it's dirty again
      return 'committed'
    },

    planProposal: (opts = {}) => {
      const o = get().open
      if (!o) return { ok: false, reason: 'no-project' }
      const now = opts.now ?? new Date().toISOString()
      const mkId = opts.mint ?? mintId
      const g = useGraphStore.getState()
      const snapDigest = liveDigest() // §R5-6 — includes the on-screen saved frames
      const isDirty = snapDigest !== o.baselineDigest
      if (get().dirty !== isDirty) set({ dirty: isDirty })

      return planProposalExport({
        modelVersion: g.modelVersion,
        doc: { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
        project: { projectId: o.projectId, revisionId: o.revisionId, lineage: o.lineage },
        dirty: isDirty,
        // §R6 — re-exporting an edited proposal keeps the ORIGINAL pinned base,
        // not the current (edited) content; the dirty-origin gate is skipped.
        pinnedBase: o.role === 'proposal' ? o.pinnedBase : undefined,
        meta: authoredMeta(o.meta),
        now,
        mint: () => mkId('rev'),
        maxBytes: opts.maxBytes,
      })
      // no session mutation — the origin revision is untouched (§R6)
    },

    openRevisionFromFile: (project, graphDigest) => {
      const next: OpenProject = {
        projectId: project.projectId,
        revisionId: project.revisionId,
        parentId: project.parentId,
        role: 'revision',
        lineage: project.lineage ?? [],
        meta: project.meta ?? {},
        baselineDigest: graphDigest,
      }
      set({ open: next, dirty: false, activePlanId: null }) // any pending export plan is now stale
      persist(next)
    },

    openProposalAsDocument: (project, base, proposed) => {
      // §R10.5 — one atomic swap: load the proposed graph, then adopt a
      // `proposal` header that PINS the original base for §R6 re-export. The
      // graphStore history sidecar captures this header on the frame it creates,
      // so undo restores the prior document AND its header.
      // LGR Slice 5 — adopt the proposal's saved frames too (`[]` when it has
      // none ⇒ a clean replace); part of the same one `loadDoc` history entry.
      useGraphStore.getState().loadDoc({ nodes: proposed.nodes, edges: proposed.edges }, undefined, proposed.frames)
      const digest = digestOfCanonical(canonicalContent(proposed, { modelVersion: proposed.modelVersion }))
      const next: OpenProject = {
        projectId: project.projectId,
        revisionId: project.revisionId,
        parentId: project.parentId,
        role: 'proposal',
        lineage: project.lineage ?? [],
        meta: project.meta ?? {},
        baselineDigest: digest,
        pinnedBase: { revisionId: base.revisionId, content: base.content },
      }
      set({ open: next, dirty: false, activePlanId: null })
      persist(next)
    },

    classifyProposal: ({ project, base, proposed }) => {
      const o = get().open
      if (!o) return { ok: false, reason: 'no-target' }
      if (o.projectId !== project.projectId) return { ok: false, reason: 'wrong-project' }
      if (o.role === 'proposal') return { ok: false, reason: 'target-is-proposal' }
      return { ok: true, classification: classifyAgainst(o, base, proposed) }
    },

    applyProposal: ({ project, base, proposed }, opts = {}) => {
      // Everything is re-checked HERE, at the click — never trust the class the
      // Review panel computed when it opened (the target may have been edited or
      // swapped since).

      // §R7A.1 gates
      const o = get().open
      if (!o) return { ok: false, reason: 'no-target' }
      if (o.projectId !== project.projectId) return { ok: false, reason: 'wrong-project' }
      if (o.role === 'proposal') return { ok: false, reason: 'target-is-proposal' }

      // §R6 / §R10 — the proposal payload must still hash to its own digests
      const proposedCanon = canonicalContent(proposed, { modelVersion: proposed.modelVersion })
      if (
        digestOfCanonical(base.content) !== base.contentDigest ||
        (project.contentDigest != null && digestOfCanonical(proposedCanon) !== project.contentDigest)
      ) {
        return { ok: false, reason: 'payload-invalid' }
      }

      const targetDigest = liveDigest()
      const classification = classifyAgainst(o, base, proposed)
      const g = useGraphStore.getState()

      // ── build the resulting graph ──
      let resultNodes: LoopNode[]
      let resultEdges: LoopEdge[]
      // LGR Slice 5 (§R5-6) — `frames` is ONE atomic cosmetic hunk: a
      // whole-proposal Apply adopts the proposal's saved frames wholesale;
      // a per-hunk selective Apply leaves the target's frames untouched
      // (`undefined` ⇒ `loadDoc` keeps them).
      let resultFrames: readonly SavedFrame[] | undefined
      let partial = false
      if (opts.selection) {
        // §R7.2 / §R7A.4 — per-hunk: the selection is the consent, no
        // classification / whole-loss confirmation gate.

        // freshness — the selection was made against ONE three-way result; a
        // target that moved since must not silently reuse it (review round 2).
        if (opts.expectTargetDigest != null && opts.expectTargetDigest !== targetDigest) {
          return { ok: false, reason: 'target-moved', targetDigest }
        }
        const plan = computeThreeWay(base.content, liveContent(), proposedCanon)
        const built = buildSelectiveApply({
          target: { nodes: g.nodes, edges: g.edges },
          proposedFull: proposed, // carries `frames` — the atomic `frames` hunk source (§R5-6)
          plan,
          selection: opts.selection,
        })
        if (!built.ok) return { ok: false, reason: 'invalid-selection', detail: built.detail }
        // the picked field combination must yield a valid GraphDoc — normalize
        // must not need to repair it (review round 2)
        const valid = validateResultGraph(built.nodes, built.edges)
        if (!valid.ok) return { ok: false, reason: 'invalid-selection', reasons: valid.reasons }
        // SEMANTICS-R5.md §R5-6 — selecting the `frames` hunk yields
        // `built.frames` (the proposal's whole array, `[]` = clear);
        // `undefined` ⇒ keep the target's frames.
        resultFrames = built.frames
        // an effective no-op mints no revision / undo entry / simulationRev bump.
        // The `frames` swap counts: compare the WHOLE resulting content
        // (nodes + edges + the effective frames) against the live target.
        const resultDigest = digestOfCanonical(
          canonicalContent(
            { nodes: built.nodes, edges: built.edges, frames: resultFrames ?? useFrameStore.getState().snapshot() },
            { modelVersion: g.modelVersion },
          ),
        )
        if (resultDigest === targetDigest) {
          return { ok: false, reason: 'no-effective-change' }
        }
        resultNodes = built.nodes
        resultEdges = built.edges
        partial = true
      } else {
        // §R7 whole-proposal: re-classify, gate the confirmation
        if (classification !== 'exact') {
          if (opts.expectTargetDigest != null && opts.expectTargetDigest !== targetDigest) {
            return { ok: false, reason: 'target-moved', classification, targetDigest }
          }
          if (!opts.confirmed) {
            return { ok: false, reason: 'needs-confirmation', classification, targetDigest }
          }
        }
        resultNodes = proposed.nodes
        resultEdges = proposed.edges
        resultFrames = proposed.frames // adopt the proposal's saved frames atomically
      }

      const now = opts.now ?? new Date().toISOString()
      const mkId = opts.mint ?? mintId

      const preHeader = o

      // §R7.3 — exactly one loadDoc ⇒ one simulationRev bump, sim paused@0, one
      // undo entry. The history sidecar captures `preHeader` on that frame, so a
      // single Undo restores the pre-apply graph AND this header together.
      useGraphStore.getState().loadDoc({ nodes: resultNodes, edges: resultEdges }, undefined, resultFrames)
      // the new baseline is the WHOLE post-apply content — `frameStore` now
      // holds the effective frames (swapped when `resultFrames` was set, kept
      // otherwise), so read them back here (SEMANTICS-R5.md §R5-6).
      const postGraphDigest = digestOfCanonical(
        canonicalContent(
          { nodes: resultNodes, edges: resultEdges, frames: useFrameStore.getState().snapshot() },
          { modelVersion: g.modelVersion },
        ),
      )

      // §R7.1 — a brand-new revision derived from the target
      const meta: ProjectMeta = { ...preHeader.meta, tool: TOOL, createdAt: now }
      const applier = readAuthor()
      if (applier) meta.author = applier
      else delete meta.author

      const postHeader: OpenProject = {
        projectId: preHeader.projectId,
        revisionId: mkId('rev'),
        parentId: preHeader.revisionId,
        role: 'revision',
        lineage: [preHeader.revisionId, ...preHeader.lineage].slice(0, LINEAGE_MAX),
        meta,
        baselineDigest: postGraphDigest,
        appliedProposal: {
          proposalId: project.revisionId,
          baseId: base.revisionId,
          baseDigest: base.contentDigest,
        },
      }
      set({ open: postHeader, dirty: false, activePlanId: null })
      persist(postHeader)
      return { ok: true, classification, newRevisionId: postHeader.revisionId, ...(partial ? { partial: true } : {}) }
    },

    clear: () => {
      set({ open: null, dirty: false, activePlanId: null })
      persist(null)
    },
  }
})

// keep the DISPLAY `dirty` flag fresh as the graph is edited — debounced,
// latest-wins (a late timer from an older edit is discarded), only while a
// project is open. The Export/Proposal DECISION never depends on this.
let dirtyGen = 0
let dirtyTimer: ReturnType<typeof setTimeout> | undefined
useGraphStore.subscribe(() => {
  if (!useProjectStore.getState().open) return
  const gen = ++dirtyGen
  clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(() => {
    if (gen !== dirtyGen) return // a newer edit already scheduled a fresher check
    useProjectStore.getState().refreshDirty()
  }, 250)
})

// §R7.3 — every undo-history frame carries the project header that was current
// when it was captured (graphStore sidecar). `get` hands graphStore the live
// header to store on a frame; `set` restores the header a frame carries when
// undo/redo lands on it. Plain edits capture the unchanged header (restoring it
// is a no-op); only an Apply frame differs from its neighbour, so only crossing
// an Apply actually moves the header — for ANY sequence of applies + edits +
// undo/redo, with no global bookkeeping.
setHistorySidecar({
  get: () => useProjectStore.getState().open,
  set: (h) => {
    const open = (h ?? null) as OpenProject | null
    useProjectStore.setState({
      open,
      dirty: open ? liveDigest() !== open.baselineDigest : false,
    })
    persist(open)
  },
})
