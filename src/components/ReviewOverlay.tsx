import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useProjectStore } from '../store/projectStore'
import { useReviewStore } from '../store/reviewStore'
import { applyPendingProposal, openPendingProposalAsDocument } from '../store/revisionIO'
import { useSimStore } from '../store/simStore'
import { useIsMobile } from '../ui/media'
import { confirmationText, reviewModel, type ReviewModel } from '../ui/revisionActions'
import { MobileSheet } from './mobile/MobileSheet'

// SEMANTICS-R.md §R7 / §R7A / §R10.5 — the non-destructive Review surface. The
// desktop dialog and the mobile sheet render the SAME body and use the SAME
// apply rules (revisionActions + projectStore). Importing a proposal only opens
// this; nothing in the graph / sim / undo / project moves until Apply or "Open
// as a document".

const GATE_MSG: Record<Exclude<ReviewModel['gate'], 'ok'>, string> = {
  'wrong-project': 'This proposal belongs to a different project. You can still open it as a document.',
  'no-target': 'No project is open. Open this proposal as a document, or cancel.',
  'target-is-proposal':
    'You currently have a proposal open. Export it as a Project revision before applying another proposal onto it.',
}

const CLASS_MSG: Record<NonNullable<ReviewModel['classification']>, string> = {
  exact: 'Your open revision is exactly the base this proposal was made from.',
  divergent:
    'Your open revision has changes that overlap this proposal. Applying the whole proposal discards them.',
  unknown:
    "Your open revision has changes and the files can't prove how the two are related. No field conflicts were found.",
}

function DiffSummary({ m }: { m: ReviewModel }) {
  const n = m.diff.summary.nodes
  const e = m.diff.summary.edges
  if (m.diff.summary.empty) return <p className="review__diff">No graph changes.</p>
  const part = (label: string, s: { added: number; removed: number; changed: number }) =>
    s.added || s.removed || s.changed ? (
      <span className="review__diff-part">
        {label}: {s.added ? `+${s.added} ` : ''}
        {s.removed ? `−${s.removed} ` : ''}
        {s.changed ? `~${s.changed}` : ''}
      </span>
    ) : null
  return (
    <p className="review__diff">
      {part('Nodes', n)}
      {part('Edges', e)}
      {m.diff.summary.runConfigChanged ? <span className="review__diff-part">run config</span> : null}
    </p>
  )
}

export function ReviewOverlay() {
  const pending = useReviewStore((s) => s.pending)
  const close = useReviewStore((s) => s.close)
  const isMobile = useIsMobile()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { fitView } = useReactFlow()

  // classification is recomputed against the LIVE target every time this opens
  const model = useMemo(() => (pending ? reviewModel(pending) : null), [pending])
  const openRev = useProjectStore((s) => s.open?.revisionId ?? null)

  useEffect(() => {
    setConfirming(false)
    setErr(null)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  if (!pending || !model) return null

  const canApply = model.gate === 'ok'
  const needsConfirm = canApply && model.classification !== 'exact'

  const afterMutation = () => {
    useSimStore.getState().pause()
    requestAnimationFrame(() => fitView({ duration: 0 }))
    close()
  }

  const doApply = () => {
    if (needsConfirm && !confirming) {
      setConfirming(true)
      return
    }
    const res = applyPendingProposal(pending, { confirmed: needsConfirm })
    if (!res.ok) {
      setErr(
        res.reason === 'needs-confirmation'
          ? 'This apply needs confirmation.'
          : `Could not apply (${res.reason}).`,
      )
      return
    }
    afterMutation()
  }

  const doOpenDoc = () => {
    openPendingProposalAsDocument(pending)
    afterMutation()
  }

  const body = (
    <div className="review__body">
      <p className="review__by">
        {model.authorName ? (
          <>
            Proposed by <strong>{model.authorName}</strong>
          </>
        ) : (
          'Proposal'
        )}{' '}
        <span className="review__unverified">· unverified</span>
      </p>
      {model.authorNote ? <p className="review__note">“{model.authorNote}”</p> : null}
      {model.createdAt ? <p className="review__stamp">file says: {model.createdAt}</p> : null}
      {!model.sameProject && model.gate !== 'no-target' ? (
        <p className="review__stamp">Different project id from the one you have open.</p>
      ) : null}

      <DiffSummary m={model} />

      {model.gate === 'ok' ? (
        model.classification ? (
          <p className={`review__class review__class--${model.classification}`}>
            {CLASS_MSG[model.classification]}
          </p>
        ) : null
      ) : (
        <p className="review__class review__class--blocked">{GATE_MSG[model.gate]}</p>
      )}

      {confirming ? <p className="review__warn">{confirmationText(model)}</p> : null}
      {err ? <p className="review__warn">{err}</p> : null}

      <div className="review__actions">
        {canApply ? (
          <button type="button" className="btn btn--primary" onClick={doApply}>
            {confirming ? 'Apply anyway' : 'Apply proposal'}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={doOpenDoc}>
          Open as a document
        </button>
        <button type="button" className="btn btn--ghost" onClick={close}>
          Cancel
        </button>
      </div>
      <p className="review__foot">
        Apply makes a new local revision (parent {openRev ? shortId(openRev) : '—'}); one Undo
        reverts it. Nothing is written to a file.
      </p>
    </div>
  )

  if (isMobile) {
    return (
      <MobileSheet title="Review proposal" onClose={close} className="sheet--review">
        {body}
      </MobileSheet>
    )
  }

  return (
    <div className="review-scrim" onMouseDown={close}>
      <div
        ref={dialogRef}
        className="review"
        role="dialog"
        aria-label="Review proposal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="review__head">
          <span className="review__title">Review proposal</span>
          <button type="button" className="btn btn--icon" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {body}
      </div>
    </div>
  )
}

function shortId(id: string): string {
  return id.replace(/^rev_/, '').slice(0, 6).toLowerCase()
}
