import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { HunkSelection, ProposalHunk, ThreeWayPlan } from '../model/revision'
import { useGraphStore } from '../store/graphStore'
import { useProjectStore, type ApplyClassification, type ApplyFailReason } from '../store/projectStore'
import { useReviewStore } from '../store/reviewStore'
import {
  applyPendingProposal,
  currentTargetDigest,
  openPendingProposalAsDocument,
  threeWayForPending,
} from '../store/revisionIO'
import { useSimStore } from '../store/simStore'
import { useIsMobile } from '../ui/media'
import { reviewModel, type ReviewModel } from '../ui/revisionActions'
import { useT, type MessageKey } from '../i18n'
import { MobileSheet } from './mobile/MobileSheet'

type TFn = ReturnType<typeof useT>

// SEMANTICS-R.md §R7 / §R7A / §R10.5 — the non-destructive Review surface. The
// desktop dialog and the mobile sheet render the SAME body and use the SAME
// apply rules (revisionActions + projectStore). Importing a proposal only opens
// this; nothing in the graph / sim / undo / project moves until Apply or "Open
// as a document".

const GATE_KEY: Record<Exclude<ReviewModel['gate'], 'ok'>, MessageKey> = {
  'wrong-project': 'review.gate.wrongProject',
  'no-target': 'review.gate.noTarget',
  'target-is-proposal': 'review.gate.targetIsProposal',
}

const CLASS_KEY: Record<NonNullable<ReviewModel['classification']>, MessageKey> = {
  exact: 'review.class.exact',
  divergent: 'review.class.divergent',
  unknown: 'review.class.unknown',
}

function DiffSummary({ m }: { m: ReviewModel }) {
  const t = useT()
  const n = m.diff.summary.nodes
  const e = m.diff.summary.edges
  if (m.diff.summary.empty) return <p className="review__diff">{t('review.diff.none')}</p>
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
      {part(t('review.diff.nodes'), n)}
      {part(t('review.diff.edges'), e)}
      {m.diff.summary.runConfigChanged ? (
        <span className="review__diff-part">{t('review.diff.runConfig')}</span>
      ) : null}
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
 *  no-ops for the user (a conflict left unset means "keep mine"). A clean node
 *  `remove` is pre-accepted only when every one of its `dependents` is itself a
 *  `remove` hunk — then those removals are pre-accepted too (visible rows, no
 *  hidden cascade). If any dependent is a retarget, the node `remove` is left
 *  for the user to handle deliberately; a `blockedBy` node is never accepted. */
function defaultSelection(plan: ThreeWayPlan): HunkSelection {
  const byId = new Map(plan.hunks.map((h) => [h.id, h]))
  const accept: Record<string, boolean> = {}
  const fieldChoices: Record<string, Record<string, 'proposed' | 'yours'>> = {}
  for (const h of plan.hunks) {
    if (h.kind === 'change') {
      const fc: Record<string, 'proposed' | 'yours'> = {}
      for (const f of h.fields ?? []) if (f.verdict === 'clean') fc[f.field] = 'proposed'
      if (Object.keys(fc).length) fieldChoices[h.id] = fc
    } else if (h.verdict === 'clean' && !h.blockedBy?.length) {
      const deps = h.dependents ?? []
      const allRemovable = deps.every((d) => byId.get(d)?.kind === 'remove')
      if (h.kind === 'remove' && h.elementType === 'node' && !allRemovable) continue
      accept[h.id] = true
      if (h.kind === 'remove' && h.elementType === 'node') for (const d of deps) accept[d] = true
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
  const t = useT()
  const actionable = plan.hunks.filter(
    (h) => h.verdict !== 'noop' || (h.fields ?? []).some((f) => f.verdict !== 'noop'),
  )
  if (!actionable.length) return <p className="review__stamp">{t('review.hunks.none')}</p>
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
  const t = useT()
  if (h.kind !== 'change') {
    const blocked = !!h.blockedBy?.length
    return (
      <div>
        <label className="review__hunk-head">
          <input
            type="checkbox"
            checked={!!sel.accept[h.id]}
            disabled={h.verdict === 'noop' || blocked}
            onChange={(e) => onToggleAccept(h.id, e.target.checked)}
          />
          <span>
            {h.kind === 'add' ? t('review.hunk.add') : t('review.hunk.remove')} {h.elementType}{' '}
            <code>{h.id}</code>
            {h.verdict === 'conflict' && !blocked ? (
              <span className="review__hunk-tag">{t('review.hunk.bothChanged')}</span>
            ) : null}
          </span>
        </label>
        {h.dependents?.length ? (
          <div className="review__hunk-dep">
            {t('review.hunk.alsoRemove')} {h.dependents.map((e) => <code key={e}>{e}</code>)}
          </div>
        ) : null}
        {blocked ? (
          <div className="review__hunk-dep review__hunk-dep--blocked">
            {t('review.hunk.cantRemove')} {h.blockedBy!.map((e) => <code key={e}>{e}</code>)}{' '}
            {t('review.hunk.toThisNode')}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div>
      <div className="review__hunk-head">
        {t('review.hunk.change')} {h.elementType} <code>{h.id}</code>
        {h.yours === null ? (
          <span className="review__hunk-tag">{t('review.hunk.youDeleted')}</span>
        ) : null}
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
                    {t('review.field.base')} <code>{shortVal(f.base)}</code> ·{' '}
                    {t('review.field.yours')} <code>{shortVal(f.yours)}</code> ·{' '}
                    {t('review.field.theirs')} <code>{shortVal(f.proposed)}</code>
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
                    {t('review.field.takeTheirs')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`${h.id}:${f.field}`}
                      checked={choice === 'yours'}
                      onChange={() => onField(h.id, f.field, 'yours')}
                    />
                    {t('review.field.keepMine')}
                  </label>
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

const FAIL_KEY: Record<
  Exclude<ApplyFailReason, 'needs-confirmation' | 'target-moved' | 'no-effective-change'>,
  MessageKey
> = {
  'wrong-project': 'review.fail.wrongProject',
  'no-target': 'review.fail.noTarget',
  'target-is-proposal': 'review.fail.targetIsProposal',
  'payload-invalid': 'review.fail.payloadInvalid',
  'invalid-selection': 'review.fail.invalidSelection',
}

/** the §R7A whole-proposal confirmation copy — was `confirmationText()` */
function confirmText(t: TFn, m: ReviewModel): string {
  return t(m.classification === 'unknown' ? 'review.confirm.unknown' : 'review.confirm.default')
}

export function ReviewOverlay() {
  const t = useT()
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
  const planCtx = useMemo(
    () =>
      pending && model?.gate === 'ok'
        ? { plan: threeWayForPending(pending), digest: currentTargetDigest() }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, openRev, openRole, simRev, model?.gate],
  )
  const plan = planCtx?.plan ?? null

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
        setErr(t('review.err.targetMoved'))
      }
      return
    }
    setArmed(null)
    setErr(
      res.reason in FAIL_KEY
        ? t(FAIL_KEY[res.reason as keyof typeof FAIL_KEY])
        : t('review.err.generic', { reason: res.reason }),
    )
  }

  const doApplySelected = () => {
    setErr(null)
    const res = applyPendingProposal(pending, {
      selection: sel,
      expectTargetDigest: planCtx?.digest,
    })
    if (res.ok) {
      afterMutation()
      return
    }
    if (res.reason === 'target-moved') {
      // planCtx/sel already re-seed from the fresh plan (deps below) — just say so
      setErr(t('review.err.targetMovedList'))
      return
    }
    if (res.reason === 'no-effective-change') {
      setErr(t('review.err.noEffect'))
      return
    }
    if (res.reason === 'invalid-selection') {
      // `res.reasons` / `res.detail` are structural specifics from the model
      // layer (English) — kept verbatim; the generic phrasing is localized.
      setErr((res.reasons?.length ? res.reasons.join(' ') : res.detail) ?? t('review.fail.invalidSelection'))
      return
    }
    setErr(
      res.reason in FAIL_KEY
        ? t(FAIL_KEY[res.reason as keyof typeof FAIL_KEY])
        : t('review.err.generic', { reason: res.reason }),
    )
  }

  const setField = (id: string, field: string, choice: 'proposed' | 'yours') =>
    setSel((s) => ({ ...s, fieldChoices: { ...s.fieldChoices, [id]: { ...(s.fieldChoices[id] ?? {}), [field]: choice } } }))
  const toggleAccept = (id: string, v: boolean) =>
    setSel((s) => {
      const accept = { ...s.accept, [id]: v }
      // a node removal drags its `remove`-kind dependents along; retarget
      // dependents are left for the user to resolve field-by-field
      const h = plan?.hunks.find((x) => x.id === id)
      if (h?.kind === 'remove' && h.elementType === 'node') {
        for (const dep of h.dependents ?? []) {
          if (plan?.hunks.find((x) => x.id === dep)?.kind === 'remove') accept[dep] = v
        }
      }
      return { ...s, accept }
    })

  const doOpenDoc = () => {
    openPendingProposalAsDocument(pending)
    afterMutation()
  }

  const body = (
    <div className="review__body">
      <p className="review__by">
        {model.authorName ? (
          <>
            {t('review.byPrefix')} <strong>{model.authorName}</strong>
          </>
        ) : (
          t('review.byAnon')
        )}{' '}
        <span className="review__unverified">{t('review.unverified')}</span>
      </p>
      {model.authorNote ? <p className="review__note">“{model.authorNote}”</p> : null}
      {model.createdAt ? (
        <p className="review__stamp">{t('review.fileSays', { stamp: model.createdAt })}</p>
      ) : null}
      {!model.sameProject && model.gate !== 'no-target' ? (
        <p className="review__stamp">{t('review.differentProject')}</p>
      ) : null}

      <DiffSummary m={model} />

      {model.gate === 'ok' ? (
        model.classification ? (
          <p className={`review__class review__class--${model.classification}`}>
            {t(CLASS_KEY[model.classification])}
          </p>
        ) : null
      ) : (
        <p className="review__class review__class--blocked">{t(GATE_KEY[model.gate])}</p>
      )}

      {armed ? (
        <p className="review__warn">{confirmText(t, { ...model, classification: armed.cls })}</p>
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
            {armed ? t('review.action.applyAnyway') : t('review.action.applyProposal')}
          </button>
        ) : null}
        {canApply && mode === 'hunks' ? (
          <button type="button" className="btn btn--primary" onClick={doApplySelected}>
            {t('review.action.applySelected', { count: selectionCount(sel) })}
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
            {mode === 'whole' ? t('review.action.chooseChanges') : t('review.action.wholeProposal')}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={doOpenDoc}>
          {t('review.action.openAsDoc')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={close}>
          {t('review.action.cancel')}
        </button>
      </div>
      <p className="review__foot">
        {t(mode === 'hunks' ? 'review.foot.hunks' : 'review.foot.whole', {
          parent: openRev ? shortId(openRev) : '—',
        })}
      </p>
    </div>
  )

  if (isMobile) {
    return (
      <MobileSheet title={t('review.title')} onClose={close} className="sheet--review">
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
        aria-label={t('review.title')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="review__head">
          <span className="review__title">{t('review.title')}</span>
          <button type="button" className="btn btn--icon" onClick={close} aria-label={t('review.close')}>
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
