import { useEffect, useState, type ReactNode } from 'react'
import { Panel } from '@xyflow/react'
import { useT } from '../i18n'
import { useHintStore, type HintId } from '../store/hintStore'

// docs/contextual-inline-help.md §CIH2 — the shared situational-hint
// mechanism. Never a modal: no backdrop, no focus trap, no Escape handling
// (Escape means other things depending on context — a hint's ✕ is its only
// dismiss path, §CIH2.3). `role="note"`, not `role="alert"` — it never
// demands attention.

/** `trigger` is the hint's OWN situational condition (an empty canvas, Focus
 *  and Filter both still off) — once shown, it going false means the
 *  situation resolved, and the note is gone for good this mount (§CIH3 #4's
 *  "auto-clear"), even if `trigger` later becomes true again. `ready` is
 *  everything else that only SCHEDULES the display (tier/cooldown/priority,
 *  §CIH2.3a, or — for a Canvas-mounted hint that lives for the whole session
 *  — the tour being idle): it purely shows/hides without ever burning the
 *  one-time opportunity, so a hint due to a large graph doesn't get
 *  permanently silenced just because the tour happened to start while it was
 *  up. Defaults to always-ready, for callers (Monte Carlo, Review) whose
 *  whole host dialog unmounts between opens, so there is nothing to gate.
 *
 *  Shows the first time `trigger && ready`, provided `seen[id]` was NOT
 *  already set at mount — captured once, never re-read live, since the very
 *  `markSeen` call below would otherwise flip the live selector and hide the
 *  note on the same tick it appeared. `seen[id]` is recorded the instant it
 *  first shows (§CIH2.1a), not on ✕. */
export function useHintEligible(
  id: HintId,
  trigger: boolean,
  ready: boolean = true,
): { eligible: boolean; close: () => void } {
  const markSeen = useHintStore((s) => s.markSeen)
  const [alreadySeenAtMount] = useState(() => Boolean(useHintStore.getState().seen[id]))
  const [shown, setShown] = useState(false)
  const [closedThisInstance, setClosedThisInstance] = useState(false)

  useEffect(() => {
    if (closedThisInstance) return
    if (shown) {
      if (!trigger) setClosedThisInstance(true)
      return
    }
    if (trigger && ready && !alreadySeenAtMount) {
      setShown(true)
      markSeen(id)
    }
  }, [trigger, ready, shown, closedThisInstance, alreadySeenAtMount, id, markSeen])

  return { eligible: shown && ready && !closedThisInstance, close: () => setClosedThisInstance(true) }
}

type HintNoteProps = {
  id: HintId
  trigger: boolean
  ready?: boolean
  children: ReactNode
}

/** The canvas shape — a `top-center` `<Panel>`, same slot `lgr-focus-hint` /
 *  `lgr-suggest-note` use (§CIH2.3a decides who wins when more than one
 *  wants it; this component only renders what its caller already gated). */
export function CanvasHintNote({ id, trigger, ready, children }: HintNoteProps) {
  const { eligible, close } = useHintEligible(id, trigger, ready)
  const t = useT()
  if (!eligible) return null
  return (
    <Panel position="top-center" className="hint-note" role="note">
      <span>{children}</span>
      <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={close}>
        ✕
      </button>
    </Panel>
  )
}

/** The dialog / sheet-embedded shape — a plain inline block, for a hint that
 *  lives inside an already-open Monte Carlo dialog, Review overlay, or a
 *  mobile sheet row rather than on the canvas. */
export function InlineHintNote({ id, trigger, ready, children }: HintNoteProps) {
  const { eligible, close } = useHintEligible(id, trigger, ready)
  const t = useT()
  if (!eligible) return null
  return (
    <div className="hint-note hint-note--inline" role="note">
      <span>{children}</span>
      <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={close}>
        ✕
      </button>
    </div>
  )
}
