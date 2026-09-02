import {
  canonicalContent,
  computeRevisionDiff,
  type RevisionDiff,
} from '../model/revision'
import { deserialize } from '../model/serialize'
import { useProjectStore, type PlanRevisionResult } from '../store/projectStore'
import {
  classifyPendingProposal,
  type PendingProposal,
} from '../store/revisionIO'
import { downloadText } from './download'

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
    return {
      ok: false,
      message:
        'This browser has no secure random source, so a revision id cannot be created. Nothing was exported.',
    }
  }
  if (!plan.ok) {
    return {
      ok: false,
      message:
        `This diagram is too large to export as a Project revision ` +
        `(${mib(plan.bytes)}; limit ${mib(plan.cap)}). Use Export → Graph JSON instead.`,
    }
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
    if (res.reason === 'no-project') {
      return {
        ok: false,
        message:
          'Make a proposal needs an open project. Use Export → Project revision first to create one.',
      }
    }
    if (res.reason === 'dirty-origin') {
      return {
        ok: false,
        message:
          'The document has changed since this revision. Use Export → Project revision to pin the changes, then make a proposal.',
      }
    }
    return {
      ok: false,
      message:
        `This proposal is too large to send as one file (${mib(res.bytes)}; limit ${mib(res.cap)}). A plain Graph JSON still works.`,
    }
  }
  downloadText(res.text, 'loop-studio-proposal.json')
  return { ok: true }
}

// ── the Review model (desktop panel === mobile sheet) ─────────────────────

export type ReviewGate = 'ok' | 'wrong-project' | 'no-target' | 'target-is-proposal'

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
  const proposed = deserialize(p.proposedText)
  const diff = computeRevisionDiff(
    p.base.content,
    canonicalContent({ nodes: proposed.nodes, edges: proposed.edges }, { modelVersion: proposed.modelVersion }),
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
