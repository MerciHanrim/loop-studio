import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { HunkSelection, ProposalHunk, ThreeWayPlan } from '../model/revision'
import { useGraphStore } from '../store/graphStore'
import { useProjectStore, type ApplyClassification, type ApplyFailReason } from '../store/projectStore'
import { useReviewStore } from '../store/reviewStore'
import {
  applyPendingProposal,
  openPendingProposalAsDocument,
  threeWayForPending,
} from '../store/revisionIO'
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

// ── per-hunk selection (§R7.2) ───────────────────────────────────────────

const shortVal = (v: unknown): string => {
  if (v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

/** default: pre-accept everything that applies cleanly; leave conflicts and
 *  no-ops for the user (a conflict left unset means "keep mine"). */
function defaultSelection(plan: ThreeWayPlan): HunkSelection {
  const accept: Record<string, boolean> = {}
  const fieldChoices: Record<string, Record<string, 'proposed' | 'yours'>> = {}
  for (const h of plan.hunks) {
    if (h.kind === 'change') {
      const fc: Record<string, 'proposed' | 'yours'> = {}
      for (const f of h.fields ?? []) if (f.verdict === 'clean') fc[f.field] = 'proposed'
      if (Object.keys(fc).length) fieldChoices[h.id] = fc
    } else if (h.verdict === 'clean') {
      accept[h.id] = true
    }
  }
  return { accept, fieldChoices }
}

function selectionCount(sel: HunkSelection): number {
  let n = Object.values(sel.accept).filter(Boolean).length
  for (const fc of Object.values(sel.fieldChoices)) n += Object.values(fc).filter((c) => c === 'proposed').length
  return n
}

function HunkList({
  plan,
  sel,
  onToggleAccept,
  onField,
}: {
  plan: ThreeWayPlan
  sel: HunkSelection
  onToggleAccept: (id: string, v: boolean) => void
  onField: (id: string, field: string, choice: 'proposed' | 'yours') => void
}) {
  const actionable = plan.hunks.filter(
    (h) => h.verdict !== 'noop' || (h.fields ?? []).some((f) => f.verdict !== 'noop'),
  )
  if (!actionable.length) return <p className="review__stamp">Nothing new to apply — the target already matches.</p>
  return (
    <ul className="review__hunks">
      {actionable.map((h) => (
        <li key={`${h.elementType}:${h.id}`} className={`review__hunk review__hunk--${h.verdict}`}>
          <HunkRow h={h} sel={sel} onToggleAccept={onToggleAccept} onField={onField} />
        </li>
      ))}
    </ul>
  )
}

function HunkRow({
  h,
  sel,
  onToggleAccept,
  onField,
}: {
  h: ProposalHunk
  sel: HunkSelection
  onToggleAccept: (id: string, v: boolean) => void
  onField: (id: string, field: string, choice: 'proposed' | 'yours') => void
}) {
  if (h.kind !== 'change') {
    return (
      <label className="review__hunk-head">
        <input
          type="checkbox"
          checked={!!sel.accept[h.id]}
          disabled={h.verdict === 'noop'}
          onChange={(e) => onToggleAccept(h.id, e.target.checked)}
        />
        <span>
          {h.kind === 'add' ? 'Add' : 'Remove'} {h.elementType} <code>{h.id}</code>
          {h.verdict === 'conflict' ? <span className="review__hunk-tag"> · both sides changed this</span> : null}
        </span>
      </label>
    )
  }
  return (
    <div>
      <div className="review__hunk-head">
        Change {h.elementType} <code>{h.id}</code>
        {h.yours === null ? <span className="review__hunk-tag"> · you deleted this</span> : null}
      </div>
      <div className="review__fields">
        {(h.fields ?? [])
          .filter((f) => f.verdict !== 'noop')
          .map((f) => {
            const choice = (sel.fieldChoices[h.id] ?? {})[f.field] ?? 'yours'
            return (
              <div key={f.field} className={`review__field-row review__field-row--${f.verdict}`}>
                <span className="review__field-name">
                  {f.field} <span className="review__field-tag">{f.tag}</span>
                </span>
                {f.verdict === 'conflict' ? (
                  <span className="review__field-vals">
                    base <code>{shortVal(f.base)}</code> · yours <code>{shortVal(f.yours)}</code> · theirs{' '}
                    <code>{shortVal(f.proposed)}</code>
                  </span>
                ) : (
                  <span className="review__field-vals">
                    <code>{shortVal(f.yours)}</code> → <code>{shortVal(f.proposed)}</code>
                  </span>
                )}
                <span className="review__field-choice">
                  <label>
                    <input
                      type="radio"
                      name={`${h.id}:${f.field}`}
                      checked={choice === 'proposed'}
                      onChange={() => onField(h.id, f.field, 'proposed')}
                    />
                    take theirs
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`${h.id}:${f.field}`}
                      checked={choice === 'yours'}
                      onChange={() => onField(h.id, f.field, 'yours')}
                    />
                    keep mine
                  </label>
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

const FAIL_MSG: Record<Exclude<ApplyFailReason, 'needs-confirmation' | 'target-moved'>, string> = {
  'wrong-project': 'This proposal is for a different project.',
  'no-target': 'No project is open to apply onto.',
  'target-is-proposal': 'Export the open proposal as a Project revision first.',
  'payload-invalid': 'This proposal file failed its integrity check — re-import it.',
  'invalid-selection':
    'That selection can’t be applied — an accepted edge needs a node you didn’t include. Adjust the choices and try again.',
}

export function ReviewOverlay() {
  const pending = useReviewStore((s) => s.pending)
  const close = useReviewStore((s) => s.close)
  const isMobile = useIsMobile()
  const dialogRef = useRef<HTMLDivElement>(null)
  // set once the store has told us a non-`exact` apply needs consent — carries
  // the class + the target digest THAT decision was made against (§R7A.4)
  const [armed, setArmed] = useState<{ cls: ApplyClassification; digest: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'whole' | 'hunks'>('whole')
  const [sel, setSel] = useState<HunkSelection>({ accept: {}, fieldChoices: {} })
  const { fitView } = useReactFlow()

  // Recompute the model against the LIVE store on every relevant change, so a
  // target edited / swapped while this is open is reflected immediately. The
  // store re-checks everything again at the click regardless (authoritative).
  const openRev = useProjectStore((s) => s.open?.revisionId ?? null)
  const openRole = useProjectStore((s) => s.open?.role ?? null)
  const simRev = useGraphStore((s) => s.simulationRev)
  const model = useMemo(
    () => (pending ? reviewModel(pending) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, openRev, openRole, simRev],
  )
  const plan = useMemo(
    () => (pending && model?.gate === 'ok' ? threeWayForPending(pending) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, openRev, openRole, simRev, model?.gate],
  )

  useEffect(() => {
    setArmed(null)
    setErr(null)
    setMode('whole')
  }, [pending])

  // seed the selection whenever the plan is (re)computed
  useEffect(() => {
    if (plan) setSel(defaultSelection(plan))
  }, [plan])

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

  const afterMutation = () => {
    useSimStore.getState().pause()
    requestAnimationFrame(() => fitView({ duration: 0 }))
    close()
  }

  const doApply = () => {
    setErr(null)
    const res = applyPendingProposal(
      pending,
      armed ? { confirmed: true, expectTargetDigest: armed.digest ?? undefined } : {},
    )
    if (res.ok) {
      afterMutation()
      return
    }
    if (res.reason === 'needs-confirmation' || res.reason === 'target-moved') {
      // arm (or re-arm) against the snapshot the store just evaluated
      setArmed({ cls: res.classification ?? 'divergent', digest: res.targetDigest ?? null })
      if (res.reason === 'target-moved') {
        setErr('The document changed since you confirmed — review the change and apply again.')
      }
      return
    }
    setArmed(null)
    setErr(FAIL_MSG[res.reason])
  }

  const doApplySelected = () => {
    setErr(null)
    const res = applyPendingProposal(pending, { selection: sel })
    if (res.ok) {
      afterMutation()
      return
    }
    // per-hunk apply never returns needs-confirmation / target-moved
    setErr(res.reason === 'invalid-selection' ? FAIL_MSG['invalid-selection'] : FAIL_MSG[res.reason as keyof typeof FAIL_MSG] ?? `Could not apply (${res.reason}).`)
  }

  const setField = (id: string, field: string, choice: 'proposed' | 'yours') =>
    setSel((s) => ({ ...s, fieldChoices: { ...s.fieldChoices, [id]: { ...(s.fieldChoices[id] ?? {}), [field]: choice } } }))
  const toggleAccept = (id: string, v: boolean) =>
    setSel((s) => ({ ...s, accept: { ...s.accept, [id]: v } }))

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

      {armed ? (
        <p className="review__warn">{confirmationText({ ...model, classification: armed.cls })}</p>
      ) : null}
      {err ? <p className="review__warn">{err}</p> : null}

      {canApply && mode === 'hunks' && plan ? (
        <div className="review__pick">
          <HunkList plan={plan} sel={sel} onToggleAccept={toggleAccept} onField={setField} />
        </div>
      ) : null}

      <div className="review__actions">
        {canApply && mode === 'whole' ? (
          <button type="button" className="btn btn--primary" onClick={doApply}>
            {armed ? 'Apply anyway' : 'Apply proposal'}
          </button>
        ) : null}
        {canApply && mode === 'hunks' ? (
          <button type="button" className="btn btn--primary" onClick={doApplySelected}>
            Apply {selectionCount(sel)} selected
          </button>
        ) : null}
        {canApply && !model.diff.summary.empty ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setErr(null)
              setArmed(null)
              setMode((m) => (m === 'whole' ? 'hunks' : 'whole'))
            }}
          >
            {mode === 'whole' ? 'Choose changes' : 'Whole proposal'}
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
        {mode === 'hunks' ? 'Applies the target plus the changes you pick' : 'Apply'} makes a new
        local revision (parent {openRev ? shortId(openRev) : '—'}); one Undo reverts it. Nothing is
        written to a file.
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
