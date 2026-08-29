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
  type RevisionExportResult,
} from '../model/revision'
import { useGraphStore } from './graphStore'

// SEMANTICS-R.md §R2 / §R3 / §R13 — the OPEN revision of the current project,
// the `dirty` flag, and the two-phase Export transaction. Slice 1B: lifecycle
// + autosave header + the plan/commit split. NO UI (Slice 1C).

const PROJECT_STORAGE_KEY = 'loop-studio:project:v1'
const TOOL = `loop-studio/${__APP_VERSION__}`

export type OpenProject = {
  projectId: string
  revisionId: string
  parentId: string | null
  role: ProjectRole
  lineage: string[]
  meta: ProjectMeta
  /** digest of the content this revision represents — the last committed /
   *  opened content. `dirty` compares the live graph against this. */
  baselineDigest: string
}

type ProjectState = {
  open: OpenProject | null
  dirty: boolean

  /** recompute `dirty` from the live graph (sync, pure-JS SHA-256) */
  refreshDirty: () => void

  /**
   * §R2.1 phase 1 — build (do NOT commit) a `Project revision` file. If no
   * project is open this PROMOTES: mints a projectId + a root revisionId. The
   * returned `pendingHeader` is committed by `commitRevisionExport` only after
   * the download is dispatched (Slice 1C).
   */
  planRevision: (opts?: { now?: string; mint?: (p: 'proj' | 'rev') => string; maxBytes?: number }) => RevisionExportResult

  /** §R2.1 phase 2 — apply a dispatched export's `pendingHeader` to the session
   *  baseline + the autosaved header. Idempotent-safe; call once per successful
   *  dispatch. */
  commitRevisionExport: (pendingHeader: RevisionExportPlan['pendingHeader']) => void

  /** §R6 — build a `Make a proposal` file. `{ ok:false, reason:'dirty-origin' }`
   *  when the session is dirty; `{ ok:false, reason:'no-project' }` when no
   *  project is open. Never mutates the session. */
  planProposal: (opts?: { now?: string; mint?: (p: 'proj' | 'rev') => string; maxBytes?: number }) =>
    | ProposalExportResult
    | { ok: false; reason: 'no-project' }

  /** §R10 step 4 — adopt a loaded revision file's header. `graphDigest` is
   *  `digestOfCanonical(canonicalContent(loaded graph))`. */
  openRevisionFromFile: (project: ProjectPayload, graphDigest: string) => void

  /** on `New` / a plain-file open */
  clear: () => void
}

// ── author name/note from the device-local setting (§R8) ────────────────────

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

// ── autosave header (§R2.1) ────────────────────────────────────────────────

/** the small `project` header persisted alongside the graph — never
 *  `base.content`, never `workspace` */
function persistHeader(open: OpenProject | null): void {
  try {
    if (!open) {
      localStorage.removeItem(PROJECT_STORAGE_KEY)
      return
    }
    const payload = {
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
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* storage unavailable — the header just won't survive a reload */
  }
}

function restoreHeader(): OpenProject | null {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Record<string, unknown>
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
      meta: (o.meta && typeof o.meta === 'object' ? (o.meta as ProjectMeta) : {}),
      baselineDigest: o.contentDigest,
    }
  } catch {
    return null
  }
}

// ── live-graph digest ──────────────────────────────────────────────────────

function liveDigest(): string {
  const g = useGraphStore.getState()
  return digestOfCanonical(canonicalContent({ nodes: g.nodes, edges: g.edges }))
}

// ── store ──────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>((set, get) => {
  const open = restoreHeader()
  const dirty = open ? liveDigest() !== open.baselineDigest : false

  return {
    open,
    dirty,

    refreshDirty: () => {
      const o = get().open
      const d = o ? liveDigest() !== o.baselineDigest : false
      if (d !== get().dirty) set({ dirty: d })
    },

    planRevision: (opts = {}) => {
      get().refreshDirty()
      const now = opts.now ?? new Date().toISOString()
      const mkId = opts.mint ?? mintId
      const o = get().open

      if (!o) {
        // PROMOTE — mint a new project + its root revision. May throw
        // SecureRandomUnavailableError (R-INV-12) — the caller aborts.
        const projectId = mkId('proj')
        const revisionId = mkId('rev')
        return planRevisionExport({
          doc: { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
          project: { projectId, revisionId, parentId: null, lineage: [] },
          dirty: false, // the root revision IS the current content
          meta: { createdAt: now, tool: TOOL, ...(readAuthor() ? { author: readAuthor() } : {}) },
          now,
          mint: () => mkId('rev'),
          maxBytes: opts.maxBytes,
        })
      }

      return planRevisionExport({
        doc: { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
        project: { projectId: o.projectId, revisionId: o.revisionId, parentId: o.parentId, lineage: o.lineage },
        dirty: get().dirty,
        meta: { ...o.meta, tool: TOOL, ...(readAuthor() ? { author: readAuthor() } : {}) },
        now,
        mint: () => mkId('rev'),
        maxBytes: opts.maxBytes,
      })
    },

    commitRevisionExport: (h) => {
      const next: OpenProject = {
        projectId: h.projectId,
        revisionId: h.revisionId,
        parentId: h.parentId,
        role: 'revision',
        lineage: h.lineage,
        meta: h.meta,
        baselineDigest: h.baselineDigest,
      }
      set({ open: next })
      persistHeader(next)
      // §R2.1 clarification — if the live graph changed since planning, it no
      // longer matches the exported snapshot ⇒ still dirty against the new
      // baseline.
      get().refreshDirty()
    },

    planProposal: (opts = {}) => {
      const o = get().open
      if (!o) return { ok: false, reason: 'no-project' }
      get().refreshDirty()
      const now = opts.now ?? new Date().toISOString()
      const mkId = opts.mint ?? mintId
      return planProposalExport({
        doc: { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
        project: { projectId: o.projectId, revisionId: o.revisionId, lineage: o.lineage },
        dirty: get().dirty,
        meta: { ...o.meta, tool: TOOL, ...(readAuthor() ? { author: readAuthor() } : {}) },
        now,
        mint: () => mkId('rev'),
        maxBytes: opts.maxBytes,
      })
      // NB: no session mutation — the origin revision is untouched (§R6).
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
      set({ open: next, dirty: false })
      persistHeader(next)
    },

    clear: () => {
      set({ open: null, dirty: false })
      persistHeader(null)
    },
  }
})

// keep `dirty` fresh as the graph is edited (debounced; only while a project is
// open). Mirrors mcStore's graphStore subscription.
let dirtyTimer: ReturnType<typeof setTimeout> | undefined
useGraphStore.subscribe(() => {
  if (!useProjectStore.getState().open) return
  clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(() => useProjectStore.getState().refreshDirty(), 250)
})
