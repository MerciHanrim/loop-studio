// docs/register-expression-authoring.md §RXA3 — the reference-aware Register
// expression editor. A usability layer only: the stored `expr` string, its
// canonical form, `refsOf`, `evaluateRegisters`, and the `loop-revision/2`
// digest are byte-identical to before (RXA-INV-1). Nothing here parses or
// evaluates the whole expression a second time — the read-back's verdict is a
// presentation of the `RegisterOutcome` the M3.5 pass already produced
// (RXA-INV-8); it only adds a per-reference value lookup.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { parseExpr, type ExprParseCode } from '../model/expr'
import {
  readBackExpr,
  referenceCandidates,
  scoreCandidate,
  type MeaningToken,
  type ReadBack,
  type RefCandidate,
  type RefResolveKind,
} from '../model/exprRefs'
import { canonicalRef } from '../model/expr'
import { initialPoolValues, type RegisterOutcome } from '../model/model'
import { useGraphStore } from '../store/graphStore'
import { useRegisterOutcomes } from '../store/registers'
import { useSimStore } from '../store/simStore'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { useT, type MessageKey } from '../i18n'

/** §RXA6 / RXA-D7 — popover ceiling; the rest is a "+N — keep typing" footer. */
const RXA_MAX_ROWS = 12

// the `loop-expr/1` parse-error codes → the shared `error.EXPR_*` message keys
// (moved here from Inspector with the old RegisterFields). Literal values so the
// check-i18n.mjs call-site scan sees each key as referenced.
const EXPR_CODE_KEY: Record<ExprParseCode, MessageKey> = {
  EXPR_EMPTY: 'error.EXPR_EMPTY.message',
  EXPR_SYNTAX: 'error.EXPR_SYNTAX.message',
  EXPR_UNCLOSED_PAREN: 'error.EXPR_UNCLOSED_PAREN.message',
  EXPR_UNCLOSED_REF: 'error.EXPR_UNCLOSED_REF.message',
  EXPR_BAD_ESCAPE: 'error.EXPR_BAD_ESCAPE.message',
  EXPR_NUMBER_RANGE: 'error.EXPR_NUMBER_RANGE.message',
  EXPR_BAD_TOKEN: 'error.EXPR_BAD_TOKEN.message',
}

/** the read-back's `total` — `= <value>` verbatim, or a `→ <EVAL_CODE>` verdict
 *  the helper leaves raw (so it stays pure / testable). Localise the verdict
 *  here (§RXA3.5). */
function totalText(t: ReturnType<typeof useT>, total: string): string {
  if (!total.startsWith('→')) return total
  const code = total.slice(1).trim()
  const key = REF_ROW_KEY[code]
  return key ? t(key) : total
}

// §RXA3.5 — the diagnostic codes `errors.ts` / `registers.ts` already produce,
// mapped 1:1 to a user-facing message key. An unknown code → the generic row.
const REF_ROW_KEY: Record<string, MessageKey> = {
  M_REG_UNKNOWN_REF: 'regExpr.row.unknownRef',
  REF_UNKNOWN: 'regExpr.row.unknownRef',
  M_REG_WRONG_KIND: 'regExpr.row.wrongKind',
  REF_WRONG_KIND: 'regExpr.row.wrongKind',
  M_REG_INVALID_ID: 'regExpr.row.invalidId',
  REF_INVALID_ID: 'regExpr.row.invalidId',
  M_REG_CYCLE: 'regExpr.row.cycle',
  REF_NOT_FINITE: 'regExpr.row.notFinite',
  EVAL_DIV_ZERO: 'regExpr.row.divZero',
  EVAL_NOT_FINITE: 'regExpr.row.notFinite',
  M_REG_EVAL: 'regExpr.row.notFinite', // a bare eval error with no finer detail
  M_REG_DEPENDS_ON_INVALID: 'regExpr.row.dependsInvalid',
}

type PoolValue = (id: string) => number

function usePoolValue(): PoolValue {
  const nodes = useGraphStore((s) => s.nodes)
  const values = useSimStore((s) => s.values)
  return useCallback(
    (id: string) => {
      const live = values?.[id]
      if (typeof live === 'number' && Number.isFinite(live)) return live
      const seed = initialPoolValues(nodes)[id]
      return typeof seed === 'number' ? seed : 0
    },
    [nodes, values],
  )
}

// ── the `@…` token under the caret ────────────────────────────────────────
// matches a trailing `@`, optional `{`, then the partial ref text (canonical
// refs never contain whitespace or an operator, so the token ends at one).
const AT_TOKEN = /@(\{?)([^\s+\-*/()@}]*)$/

type AtMatch = { start: number; query: string } | null
function atTokenBefore(value: string, caret: number): AtMatch {
  const m = AT_TOKEN.exec(value.slice(0, caret))
  return m ? { start: caret - m[0].length, query: m[2] } : null
}

// ─────────────────────────────────────────────────────────────────────────
// The reference-picker listbox (shared with EdgeFlowField, §RXA7).
// ─────────────────────────────────────────────────────────────────────────

function candidateName(t: ReturnType<typeof useT>, c: RefCandidate): string {
  const kind = t(`canvas.nodeKind.${c.kind}` as MessageKey)
  const val = c.valueText
  const reason = c.block
    ? c.block.reason === 'self'
      ? t('regExpr.block.self')
      : t('regExpr.block.cycle', { name: c.block.withName })
    : ''
  // "<Name>, <Kind>, current value <n>[, <reason>]" (RXA5 SR name)
  return t('regExpr.pick.optionAria', { name: c.name, kind, value: val }) + (reason ? `, ${reason}` : '')
}

function RefListbox({
  id,
  candidates,
  query,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: {
  id: string
  candidates: RefCandidate[]
  query: string
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onPick: (c: RefCandidate) => void
}) {
  const t = useT()
  const ranked = useMemo(() => {
    const scored = candidates
      .map((c) => ({ c, s: scoreCandidate(c, query) }))
      .filter((x) => x.s >= 0)
    // stable: score desc, then the §RXA4 order `candidates` already carries
    scored.sort((a, b) => b.s - a.s || candidates.indexOf(a.c) - candidates.indexOf(b.c))
    return scored.map((x) => x.c)
  }, [candidates, query])

  const shown = ranked.slice(0, RXA_MAX_ROWS)
  const overflow = ranked.length - shown.length

  useEffect(() => {
    if (activeIndex >= shown.length) onActiveIndexChange(shown.length ? 0 : -1)
  }, [shown.length, activeIndex, onActiveIndexChange])

  if (ranked.length === 0) {
    return (
      <ul className="regref" id={id} role="listbox" aria-label={t('regExpr.pick.listLabel')}>
        <li className="regref__empty" role="presentation">
          {t('regExpr.pick.noMatch')}
        </li>
      </ul>
    )
  }

  return (
    <ul className="regref" id={id} role="listbox" aria-label={t('regExpr.pick.listLabel')}>
      {shown.map((c, i) => (
        <li
          key={c.id}
          id={`${id}-opt-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          aria-disabled={c.block ? true : undefined}
          // ONE clean accessible name — the visible fragments below are
          // `aria-hidden` so they are not re-concatenated into it (§RXA5)
          aria-label={candidateName(t, c)}
          className={
            'regref__opt' +
            (i === activeIndex ? ' is-active' : '') +
            (c.block ? ' is-blocked' : '')
          }
          // combobox pattern — focus stays in the input; a pointer pick must not
          // blur it
          onMouseDown={(e) => {
            e.preventDefault()
            if (!c.block) onPick(c)
          }}
          onMouseEnter={() => onActiveIndexChange(i)}
        >
          <span className="regref__row" aria-hidden="true">
            <span className="regref__name">{c.name}</span>
            <span className={`regref__kind regref__kind--${c.kind}`}>
              {t(`canvas.nodeKind.${c.kind}` as MessageKey)}
            </span>
            <span className="regref__val">= {c.valueText}</span>
            {c.block && (
              <span className="regref__reason">
                {c.block.reason === 'self'
                  ? t('regExpr.block.self')
                  : t('regExpr.block.cycle', { name: c.block.withName })}
              </span>
            )}
          </span>
        </li>
      ))}
      {overflow > 0 && (
        <li className="regref__more" role="presentation">
          {t('regExpr.pick.more', { n: overflow })}
        </li>
      )}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// The name read-back (line 1) + value breakdown (line 2), shown together.
// ─────────────────────────────────────────────────────────────────────────

function ReadBackBlock({
  rb,
  onPeek,
  errText,
}: {
  rb: ReadBack
  onPeek: (ids: readonly string[]) => void
  errText: (r: Extract<ReadBack, { ok: true }>['result']) => string | null
}) {
  const t = useT()

  if (!rb.ok) {
    const msgKey = EXPR_CODE_KEY[rb.parse.code as ExprParseCode] ?? 'error.unknownCode'
    // keeps the `inspector__note--warn` hook the live-edit-trap regression guard
    // (`model-nodes.spec.ts`, PR #136) asserts on
    return (
      <p className="regrb regrb--parse inspector__note inspector__note--warn" role="status">
        {rb.parse.code} · {t(msgKey, { column: rb.parse.column })}
      </p>
    )
  }
  if (rb.result.kind === 'empty' && rb.meaning.length === 0) {
    return (
      <p className="regrb regrb--empty" aria-live="polite">
        {t('regExpr.empty')}
      </p>
    )
  }

  const refIds = rb.meaning.filter((m): m is Extract<MeaningToken, { t: 'ref' }> => m.t === 'ref').map((m) => m.id)

  return (
    <div
      className="regrb"
      aria-live="polite"
      onMouseEnter={() => onPeek(refIds)}
      onMouseLeave={() => onPeek([])}
    >
      {/* line 1 — meaning: names substituted into the canonical text */}
      <p className="regrb__line regrb__line--meaning" role="list">
        {rb.meaning.map((m, i) =>
          m.t === 'text' ? (
            <span key={i} className="regrb__op">
              {m.s}
            </span>
          ) : (
            <span
              key={i}
              className={
                'regrb__chip' +
                (m.refKind === 'missing' || m.refKind === 'other' ? ' regrb__chip--warn' : '')
              }
              role="listitem"
              tabIndex={0}
              title={`@${m.id}`}
              aria-description={`@${m.id}`}
              onMouseEnter={() => onPeek([m.id])}
              onFocus={() => onPeek([m.id])}
              onBlur={() => onPeek(refIds)}
            >
              {m.name}
              {m.refKind === 'missing' && ` ${t('regExpr.chip.deleted')}`}
              {m.refKind === 'other' && ` ${t('regExpr.chip.wrongKind')}`}
            </span>
          ),
        )}
      </p>

      {/* line 2 — result: each reference shown as its resolved value */}
      {rb.result.kind === 'value' ? (
        <p className="regrb__line regrb__line--result">
          {rb.result.parts.map((p, i) =>
            p.t === 'text' ? (
              <span key={i} className="regrb__op">
                {p.s}
              </span>
            ) : p.t === 'val' ? (
              <span
                key={i}
                className="regrb__valref"
                onMouseEnter={() => onPeek([p.id])}
                onMouseLeave={() => onPeek(refIds)}
              >
                <span className="regrb__valname">{p.name}</span>{' '}
                <span className="regrb__num">{p.s}</span>
              </span>
            ) : (
              <span key={i} className="regrb__chip">
                {p.name}
              </span>
            ),
          )}{' '}
          <span
            className={
              'regrb__total' + (rb.result.total.startsWith('→') ? ' regrb__total--bad' : '')
            }
          >
            {totalText(t, rb.result.total)}
          </span>
        </p>
      ) : (
        <p className="regrb__line regrb__line--result regrb__line--bad">
          {errText(rb.result)}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// The whole field: <input> + `@` popover + read-back block.
// ─────────────────────────────────────────────────────────────────────────

export function RegisterExprField({
  id,
  expr,
  outcome,
  onCommit,
  label,
}: {
  id: string
  expr: string
  outcome: RegisterOutcome | undefined
  onCommit: (expr: string) => void
  label: string
}) {
  const t = useT()
  const nodes = useGraphStore((s) => s.nodes)
  const outcomes = useRegisterOutcomes()
  const poolValue = usePoolValue()
  const setPeek = useUiStore((s) => s.setPeekRefNodeIds)
  // §RXA5 — the canvas is edit-locked on mobile, and the desktop lock wraps the
  // Inspector in `<fieldset disabled>`. In both, drop the input + popover and
  // show only the two read-back lines (names + values).
  const lockedDesktop = useUiStore((s) => s.canvasLocked)
  const readOnly = useIsMobile() || lockedDesktop

  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)

  const [draft, setDraft] = useState(expr)
  useEffect(() => setDraft(expr), [id, expr])

  const [at, setAt] = useState<AtMatch>(null)
  const [active, setActive] = useState(0)
  // the `@…` token start the user dismissed with Esc — don't re-open the popover
  // for the same token on the next keyup / click (cleared on any value change)
  const dismissedStartRef = useRef<number | null>(null)

  // §RXA8 — arm-and-click reference insertion
  const armRefInsert = useUiStore((s) => s.armRefInsert)
  const disarmRefInsert = useUiStore((s) => s.disarmRefInsert)
  const clearRefInsertPick = useUiStore((s) => s.clearRefInsertPick)
  const armed = useUiStore((s) => s.refInsert?.editingId === id)
  const armHint = useUiStore((s) => (s.refInsert?.editingId === id ? s.refInsert.hint : null))
  const pendingPick = useUiStore((s) => (s.refInsertPick?.editingId === id ? s.refInsertPick : null))
  const [srMsg, setSrMsg] = useState('')
  // the exact `refInsertPick` object this field has already inserted — guards
  // the consume effect against a re-run (a fresh `onCommit` identity from the
  // parent re-render) before the store clear lands, which would double-insert
  // the same `@id`. Identity, not `seq`: the seq resets when the pick clears.
  const consumedPick = useRef<unknown>(null)
  // true between a completed pick and the next arm — so the disarm that a pick
  // triggers is not also announced as "cancelled"
  const justInsertedRef = useRef(false)

  // clear the canvas peek whenever this field goes away (RXA-INV-3)
  useEffect(() => () => setPeek([]), [setPeek])

  // disarm arm-and-click when this field goes away (edit lock, a different
  // Inspector target, a template load / graph reset — all unmount it)
  useEffect(
    () => () => {
      if (useUiStore.getState().refInsert?.editingId === id) disarmRefInsert()
    },
    [id, disarmRefInsert],
  )

  // a pointer press anywhere outside this field closes the popover (standard
  // combobox dismissal — covers a click that doesn't move DOM focus)
  useEffect(() => {
    if (at == null) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setAt(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [at])

  const kindLabel = useCallback((k: RefResolveKind) => t(`canvas.nodeKind.${k}` as MessageKey), [t])

  const candidates = useMemo(
    () => referenceCandidates(nodes, poolValue, outcomes, id, kindLabel),
    [nodes, poolValue, outcomes, id, kindLabel],
  )

  const rb = useMemo<ReadBack>(
    () => readBackExpr(draft, nodes, poolValue, outcomes, outcome, id, kindLabel),
    [draft, nodes, poolValue, outcomes, outcome, id, kindLabel],
  )

  const errText = useCallback(
    (r: Extract<ReadBack, { ok: true }>['result']): string | null => {
      if (r.kind !== 'error') return null
      const key = REF_ROW_KEY[r.code] ?? 'regExpr.row.generic'
      return t(key, { name: r.badRefName ?? '', id: r.badRefId ?? '', code: r.code })
    },
    [t],
  )

  const recomputeAt = useCallback(() => {
    const el = inputRef.current
    if (!el || composingRef.current || readOnly) {
      setAt(null)
      return
    }
    const caret = el.selectionStart ?? el.value.length
    const m = el.selectionStart === el.selectionEnd ? atTokenBefore(el.value, caret) : null
    if (m && dismissedStartRef.current === m.start) {
      setAt(null)
      return
    }
    setAt(m)
    if (m) setActive(0)
  }, [readOnly])

  const commitIfValid = useCallback(
    (v: string) => {
      setDraft(v)
      dismissedStartRef.current = null // a fresh edit re-arms the popover
      if (parseExpr(v).ok) onCommit(v)
    },
    [onCommit],
  )

  const pick = useCallback(
    (c: RefCandidate) => {
      const el = inputRef.current
      if (!el || !at) return
      const caret = el.selectionStart ?? el.value.length
      const next = el.value.slice(0, at.start) + c.insert + el.value.slice(caret)
      const newCaret = at.start + c.insert.length
      commitIfValid(next)
      setAt(null)
      // restore focus + caret after React commits the new value
      requestAnimationFrame(() => {
        const e2 = inputRef.current
        if (!e2) return
        e2.focus()
        e2.setSelectionRange(newCaret, newCaret)
      })
    },
    [at, commitIfValid],
  )

  const ranked = useMemo(() => {
    if (!at) return []
    return candidates
      .map((c) => ({ c, s: scoreCandidate(c, at.query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || candidates.indexOf(a.c) - candidates.indexOf(b.c))
      .slice(0, RXA_MAX_ROWS)
      .map((x) => x.c)
  }, [at, candidates])

  // ── §RXA8 arm-and-click: consume a canvas pick, announce the mode ─────────
  useEffect(() => {
    if (!pendingPick || pendingPick === consumedPick.current) return
    consumedPick.current = pendingPick
    const el = inputRef.current
    const ins = canonicalRef(pendingPick.nodeId)
    if (el) {
      const s = Math.min(pendingPick.caretStart, el.value.length)
      const e = Math.min(pendingPick.caretEnd, el.value.length)
      const next = el.value.slice(0, s) + ins + el.value.slice(e)
      commitIfValid(next)
      const newCaret = s + ins.length
      // return focus + caret to the input once React and React Flow have
      // finished re-rendering from the disarm (RF re-enables node focus on the
      // same tick, so a bare rAF can lose the race — settle on a macrotask).
      const refocus = () => {
        const e2 = inputRef.current
        if (!e2) return
        e2.focus()
        e2.setSelectionRange(newCaret, newCaret)
      }
      requestAnimationFrame(refocus)
      setTimeout(refocus, 0)
    }
    const nm = candidates.find((c) => c.id === pendingPick.nodeId)?.name ?? pendingPick.nodeId
    justInsertedRef.current = true
    setSrMsg(t('regExpr.insert.done', { name: nm }))
    clearRefInsertPick()
  }, [pendingPick, candidates, commitIfValid, clearRefInsertPick, t])

  useEffect(() => {
    if (armed) {
      justInsertedRef.current = false
      setSrMsg(t('regExpr.insert.armed'))
    } else if (!justInsertedRef.current) {
      // any disarm that is NOT a completed pick (Esc, empty-canvas click, focus
      // loss to the lock / another target) — the pick effect above runs first
      setSrMsg((m) => (m ? t('regExpr.insert.cancelled') : m))
    }
  }, [armed, t])

  useEffect(() => {
    if (!armHint) return
    setSrMsg(
      armHint.reason === 'self'
        ? t('regExpr.block.self')
        : armHint.reason === 'cycle'
          ? t('regExpr.block.cycle', { name: armHint.name ?? '' })
          : t('regExpr.insert.wrongKind'),
    )
  }, [armHint, t])

  const toggleArm = useCallback(() => {
    if (armed) {
      disarmRefInsert()
      inputRef.current?.focus()
      return
    }
    const el = inputRef.current
    const caretStart = el?.selectionStart ?? draft.length
    const caretEnd = el?.selectionEnd ?? draft.length
    armRefInsert({ editingId: id, caretStart, caretEnd })
  }, [armed, disarmRefInsert, armRefInsert, id, draft.length])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!at || ranked.length === 0 || composingRef.current) {
        if (e.key === 'Escape' && at) {
          dismissedStartRef.current = at.start
          setAt(null)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % ranked.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + ranked.length) % ranked.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const c = ranked[active]
        if (c && !c.block) {
          e.preventDefault()
          pick(c)
        } else if (e.key === 'Enter') {
          e.preventDefault() // a blocked row: don't submit, don't insert
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        dismissedStartRef.current = at.start
        setAt(null)
      }
    },
    [at, ranked, active, pick],
  )

  const peekAllOnFocus = useCallback(() => {
    if (rb.ok) {
      const ids = rb.meaning.filter((m): m is Extract<MeaningToken, { t: 'ref' }> => m.t === 'ref').map((m) => m.id)
      if (ids.length) setPeek(ids)
    }
  }, [rb, setPeek])

  if (readOnly) {
    // §RXA5 mobile / locked — lines 1 & 2 only, no input, no popover
    return (
      <div className="field">
        <span className="field__label">{label}</span>
        <ReadBackBlock rb={rb} onPeek={setPeek} errText={errText} />
      </div>
    )
  }

  return (
    <div className={`field regexpr${armed ? ' regexpr--arming' : ''}`} ref={rootRef}>
      <label className="field__label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="regexpr__row">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={at != null && ranked.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            at != null && ranked.length > 0 && active >= 0 ? `${listId}-opt-${active}` : undefined
          }
          style={{ fontFamily: 'var(--font-mono, monospace)' }}
          onChange={(e) => {
            commitIfValid(e.target.value)
            recomputeAt()
          }}
          onKeyUp={recomputeAt}
          onClick={recomputeAt}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
            setAt(null)
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            recomputeAt()
          }}
          onFocus={peekAllOnFocus}
          onBlur={(e) => {
            // keep the popover if focus went into it (pointer pick handles its own).
            // NOT disarming the §RXA8 mode here — the next click is on the canvas,
            // which necessarily blurs this input.
            if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest?.('.regref')) {
              setAt(null)
              if (!armed) setPeek([])
            }
          }}
        />
        {/* §RXA8 — arm a one-shot "click a node on the canvas" insert */}
        <button
          type="button"
          className={`regexpr__pick${armed ? ' is-armed' : ''}`}
          aria-pressed={armed}
          title={armed ? t('regExpr.insert.armedTitle') : t('regExpr.insert.title')}
          aria-label={armed ? t('regExpr.insert.armedTitle') : t('regExpr.insert.title')}
          onClick={toggleArm}
        >
          ＋
        </button>
      </div>
      {at != null && (
        <RefListbox
          id={listId}
          candidates={candidates}
          query={at.query}
          activeIndex={active}
          onActiveIndexChange={setActive}
          onPick={pick}
        />
      )}
      {armed && (
        <p className="regexpr__hint">
          {armHint
            ? armHint.reason === 'self'
              ? t('regExpr.block.self')
              : armHint.reason === 'cycle'
                ? t('regExpr.block.cycle', { name: armHint.name ?? '' })
                : t('regExpr.insert.wrongKind')
            : t('regExpr.insert.hint')}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {srMsg}
      </span>
      <ReadBackBlock rb={rb} onPeek={setPeek} errText={errText} />
    </div>
  )
}
