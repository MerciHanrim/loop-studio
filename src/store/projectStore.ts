import { create } from 'zustand'
import {
  AUTHOR_NAME_KEY,
  AUTHOR_NAME_MAX_BYTES,
  AUTHOR_NOTE_MAX_BYTES,
  HEX64,
  canonicalContent,
  digestOfCanonical,
  isProjectId,
  isRevisionId,
  mintId,
  planProposalExport,
  planRevisionExport,
  truncBytes,
  type ProjectMeta,
  type ProjectPayload,
  type ProjectRole,
  type ProposalExportResult,
  type RevisionExportPlan,
} from '../model/revision'
import { bootProjectHeader, setAutosaveProjectHeader, useGraphStore } from './graphStore'

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
  }
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
  return {
    projectId: o.projectId,
    revisionId: o.revisionId,
    parentId: (o.parentId as string | null) ?? null,
    role: o.role === 'proposal' ? 'proposal' : 'revision',
    lineage: Array.isArray(o.lineage) ? o.lineage.filter((x): x is string => isRevisionId(x)) : [],
    meta: o.meta && typeof o.meta === 'object' ? (o.meta as ProjectMeta) : {},
    baselineDigest: o.contentDigest,
  }
}

/** the live graph's canonical digest — computed fresh every call (§R2, no
 *  reliance on the debounced flag) */
function liveDigest(): string {
  const g = useGraphStore.getState()
  return digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
}

function persist(open: OpenProject | null): void {
  setAutosaveProjectHeader(open ? headerPayload(open) : null)
}

// ── store ──────────────────────────────────────────────────────────────────

let planSeq = 0

export const useProjectStore = create<ProjectState>((set, get) => {
  const open = parseHeader(bootProjectHeader())
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
      const snapDigest = digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
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
          doc: { nodes: g.nodes, edges: g.edges },
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
          doc: { nodes: g.nodes, edges: g.edges },
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
      const snapDigest = digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
      const isDirty = snapDigest !== o.baselineDigest
      if (get().dirty !== isDirty) set({ dirty: isDirty })

      return planProposalExport({
        doc: { nodes: g.nodes, edges: g.edges },
        project: { projectId: o.projectId, revisionId: o.revisionId, lineage: o.lineage },
        dirty: isDirty,
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
