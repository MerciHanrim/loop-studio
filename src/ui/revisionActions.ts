import {
  canonicalContent,
  computeRevisionDiff,
  InvalidRevisionContentError,
  type RevisionDiff,
  SecureRandomUnavailableError,
} from '../model/revision'
import { isolateAuto } from '../i18n/bidiIsolate'
import { type InvalidTargetNode, useProjectStore, type PlanProposalResult, type PlanRevisionResult } from '../store/projectStore'
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
 * #420 — the message for an error a revision or proposal PLAN threw. The plan
 * can meet exactly two causes: no secure random source to mint an id, and
 * content the canonical projection refuses (a node of an unknown kind is named;
 * a non-finite number or an unseatable model node gets the general text). Each
 * is told apart by its class — before #420 every throw read "no secure random
 * source". Anything else is a defect, not a refusal, and still throws.
 */
function planFailureMessage(e: unknown): string {
  if (e instanceof SecureRandomUnavailableError) return t('revision.export.noSecureRandom')
  if (e instanceof InvalidRevisionContentError) {
    if (e.node) {
      return t('revision.export.unknownKind', { node: isolateAuto(e.node.label || e.node.id), kind: isolateAuto(e.node.kind) })
    }
    return t('revision.export.invalidContent')
  }
  throw e
}

/**
 * §R2.1 — build the plan (pure), dispatch the download, then commit the
 * baseline. A failure before the download commits nothing.
 */
export function exportProjectRevision(): ExportStatus {
  let plan: PlanRevisionResult
  try {
    plan = useProjectStore.getState().planRevision({})
  } catch (e) {
    return { ok: false, message: planFailureMessage(e) }
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
  let res: PlanProposalResult
  try {
    res = useProjectStore.getState().planProposal({})
  } catch (e) {
    // #420 — the proposal plan projects the live graph and mints an id too;
    // before, either throw left the click handler with no message at all
    return { ok: false, message: planFailureMessage(e) }
  }
  if (!('text' in res) || !res.ok) {
    if (res.reason === 'no-project') return { ok: false, message: t('proposal.needProject') }
    if (res.reason === 'dirty-origin') return { ok: false, message: t('proposal.dirtyOrigin') }
    return { ok: false, message: t('proposal.tooLarge', { size: mib(res.bytes), cap: mib(res.cap) }) }
  }
  downloadText(res.text, 'loop-studio-proposal.json')
  return { ok: true }
}

// ── the Review model (desktop panel === mobile sheet) ─────────────────────

/** `invalid-target` (#420): the OPEN document cannot be projected, so it cannot
 *  be compared with the proposal — Review shows the refusal, Apply is refused */
export type ReviewGate = 'ok' | 'wrong-project' | 'no-target' | 'target-is-proposal' | 'version-mismatch' | 'invalid-target'

export type ReviewModel = {
  /** unverified, self-asserted (§R8) — render as "claimed, not verified" */
  authorName?: string
  authorNote?: string
  createdAt?: string
  sameProject: boolean
  gate: ReviewGate
  /** present only when `gate === 'ok'` */
  classification?: 'exact' | 'divergent' | 'unknown'
  /** present only when `gate === 'invalid-target'` and one node is the cause */
  invalidNode?: InvalidTargetNode
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
    ...(!c.ok && c.reason === 'invalid-target' && c.node ? { invalidNode: c.node } : {}),
    diff,
  }
}

/**
 * #420 — the refusal text for an open document that cannot be projected, shown
 * by Review as its gate and by Apply as its error: the node and its kind when
 * one node is the cause, the general text otherwise. Neither offers anything
 * the refused path cannot do; "Open as a document" stays available on its own
 * button, behind its own confirmation.
 */
export function invalidTargetText(node: InvalidTargetNode | undefined): string {
  if (node) return t('review.gate.invalidTarget', { node: isolateAuto(node.label || node.id), kind: isolateAuto(node.kind) })
  return t('review.gate.invalidContent')
}

// §R7A.4 — the loss statement for a non-`exact` whole apply is now the keyed
// `review.confirm.default` / `review.confirm.unknown` (rendered in ReviewOverlay).
