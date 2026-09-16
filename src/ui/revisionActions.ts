import {
  canonicalContent,
  computeRevisionDiff,
  type RevisionDiff,
} from '../model/revision'
import { useProjectStore, type PlanRevisionResult } from '../store/projectStore'
import {
  classifyPendingProposal,
  proposedGraph,
  type PendingProposal,
} from '../store/revisionIO'
import { downloadText } from './download'
import { t } from '../i18n'

// SEMANTICS-R.md §R2.1 / §R6 / §R8 — the desktop menu and the mobile sheet
// share every non-trivial decision here: the two-phase Project-revision export,
// the `Make a proposal` gate, the author-info disclosure, and the Review model.

const mib = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`

// The Project-revision disclosure and the author-info disclosure are now
// in-app dialog copy, keyed in the i18n catalog (docs/localization.md Slice 2b).

export type ExportStatus = { ok: true } | { ok: false; message: string }

/**
 * §R2.1 — build the plan (pure), dispatch the download, then commit the
 * baseline. A failure before the download commits nothing.
 */
export function exportProjectRevision(): ExportStatus {
  let plan: PlanRevisionResult
  try {
    plan = useProjectStore.getState().planRevision({})
  } catch {
    return { ok: false, message: t('revision.export.noSecureRandom') }
  }
  if (!plan.ok) {
    return { ok: false, message: t('revision.export.tooLarge', { size: mib(plan.bytes), cap: mib(plan.cap) }) }
  }
  downloadText(plan.text, 'loop-studio-revision.json')
  useProjectStore.getState().commitRevisionExport(plan.plan) // download dispatched ⇒ commit
  return { ok: true }
}

/** §R6 — `Make a proposal`. Refuses (no file, no id) on a dirty or anonymous
 *  origin, or over the file cap; the caller shows the message. */
export function makeProposal(): ExportStatus {
  const res = useProjectStore.getState().planProposal({})
  if (!('text' in res) || !res.ok) {
    if (res.reason === 'no-project') return { ok: false, message: t('proposal.needProject') }
    if (res.reason === 'dirty-origin') return { ok: false, message: t('proposal.dirtyOrigin') }
    return { ok: false, message: t('proposal.tooLarge', { size: mib(res.bytes), cap: mib(res.cap) }) }
  }
  downloadText(res.text, 'loop-studio-proposal.json')
  return { ok: true }
}

// ── the Review model (desktop panel === mobile sheet) ─────────────────────

export type ReviewGate = 'ok' | 'wrong-project' | 'no-target' | 'target-is-proposal' | 'version-mismatch'

export type ReviewModel = {
  /** unverified, self-asserted (§R8) — render as "claimed, not verified" */
  authorName?: string
  authorNote?: string
  createdAt?: string
  sameProject: boolean
  gate: ReviewGate
  /** present only when `gate === 'ok'` */
  classification?: 'exact' | 'divergent' | 'unknown'
  diff: RevisionDiff
}

export function reviewModel(p: PendingProposal): ReviewModel {
  const c = classifyPendingProposal(p)
  // the ONE proposal reader — carries the routed (possibly legacy-recovered)
  // model version, so the diff is projected at the version the digest proved
  const proposed = proposedGraph(p)
  const diff = computeRevisionDiff(
    p.base.content,
    // SEMANTICS-R5.md §R5-6 — carry the proposal's saved `frames` so the diff
    // surfaces the cosmetic `frames` hunk (`base.content` already has it).
    canonicalContent(
      { nodes: proposed.nodes, edges: proposed.edges, frames: proposed.frames },
      { modelVersion: proposed.modelVersion },
    ),
  )
  return {
    authorName: p.project.meta?.author?.name,
    authorNote: p.project.meta?.author?.note,
    createdAt: p.project.meta?.createdAt,
    sameProject: p.sameProject,
    gate: c.ok ? 'ok' : c.reason,
    classification: c.ok ? c.classification : undefined,
    diff,
  }
}

// §R7A.4 — the loss statement for a non-`exact` whole apply is now the keyed
// `review.confirm.default` / `review.confirm.unknown` (rendered in ReviewOverlay).
