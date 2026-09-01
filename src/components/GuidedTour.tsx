import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useMcStore } from '../store/mcStore'
import { useProjectStore } from '../store/projectStore'
import { selectUpdateReady, usePwaStore } from '../store/pwaStore'
import { useReviewStore } from '../store/reviewStore'
import { TOUR_TOTAL, readTourKey, useTourStore } from '../store/tourStore'
import { useUiStore } from '../store/uiStore'
import { tourScript } from './tourSteps'
import { useDialogFocus } from './useDialogFocus'

// docs/guided-tour.md — a read-only overlay that points at the six regions of
// the UI. It drives nothing: starting / Next / Back / Escape / Done mutate no
// GraphDoc, digest, undo, selection, viewport, SimState, or MC state (§GT4).
// Its only persistent trace is one localStorage string (tourStore, §GT6).

const PLATFORM = () => (window.innerWidth < 768 ? 'mobile' : 'desktop') as 'mobile' | 'desktop'

export function GuidedTour() {
  const phase = useTourStore((s) => s.phase)
  return (
    <>
      <FirstRunTrigger />
      {phase === 'welcome' ? <WelcomeCard /> : null}
      {phase === 'running' ? <TourPopover /> : null}
    </>
  )
}

// ── §GT6.1 — the auto Welcome card is offered EXACTLY ONCE, a short beat after
//    the boot sequence settles, and ONLY if nothing else is on screen at that
//    moment. If a dialog / sheet / notice is up when the check runs, this visit
//    is over — the card does NOT pop later when that surface closes. A
//    `ConfirmDialog` is local component state, not a store, so a DOM check for
//    its scrim is part of the "something is up" test. ──
const BLOCKING_SEL = '.mcdlg__scrim, .sheet-scrim, .review, .boot-notice, .pwa-update'

function FirstRunTrigger() {
  const appSettled = useTourStore((s) => s.appSettled)
  useEffect(() => {
    if (!appSettled) return
    if (readTourKey() != null) return // a recognised value already decided (§GT6)
    // one delayed check — lets any post-settle surface (BootNotice, a PWA
    // update prompt) mount first, then decide once and for all.
    const id = setTimeout(() => {
      const st = useTourStore.getState()
      if (st.phase !== 'idle') return
      if (typeof document !== 'undefined' && document.querySelector(BLOCKING_SEL)) return
      if (
        useMcStore.getState().dialogOpen ||
        useReviewStore.getState().pending != null ||
        useUiStore.getState().overlay !== 'none' ||
        useProjectStore.getState().bootNotice != null ||
        selectUpdateReady(usePwaStore.getState())
      )
        return // busy visit — skip entirely, no re-check (§GT6.1)
      st.offerWelcome()
    }, 250)
    return () => clearTimeout(id)
  }, [appSettled])

  return null
}

// ── §GT6 — the Welcome card (`Start tour` / `Skip`) ──────────────────────────
function WelcomeCard() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const startFromWelcome = useTourStore((s) => s.startFromWelcome)
  const skipWelcome = useTourStore((s) => s.skipWelcome)

  const onEscape = useCallback(() => skipWelcome(), [skipWelcome])
  useDialogFocus(true, ref, onEscape)

  return (
    <div className="tour" role="presentation">
      {/* §GT4 — the scrim swallows background input; a click on it is inert */}
      <div className="tour-scrim" />
      <div
        ref={ref}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
      >
        <h2 id="tour-welcome-title" className="tour-card__title">
          {t('tour.welcome.title')}
        </h2>
        <p className="tour-card__body">{t('tour.welcome.body')}</p>
        <div className="tour-card__foot">
          <button type="button" className="btn" onClick={() => skipWelcome()}>
            {t('tour.welcome.skip')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => startFromWelcome(PLATFORM())}
          >
            {t('tour.welcome.start')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── §GT2 / §GT3 / §GT4 — the step popover + spotlight ────────────────────────
type Rect = { top: number; left: number; width: number; height: number }

function measure(sel: string): Rect | null {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  // fully outside the viewport ⇒ treat as missing (§GT4)
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) {
    return null
  }
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const MARGIN = 12
const POP_W = 300

function TourPopover() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const step = useTourStore((s) => s.step)
  const platform = useTourStore((s) => s.platform)
  const replay = useTourStore((s) => s.replay)
  const next = useTourStore((s) => s.next)
  const back = useTourStore((s) => s.back)
  const finish = useTourStore((s) => s.finish)
  const dismiss = useTourStore((s) => s.dismiss)

  const script = tourScript(platform)
  const cfg = script[Math.min(step, script.length - 1)]
  const isLast = step >= TOUR_TOTAL - 1

  const [rect, setRect] = useState<Rect | null>(null)
  useLayoutEffect(() => {
    const read = () => setRect(measure(cfg.sel))
    read()
    // one more frame — a target that mounts / lays out this tick (e.g. a node)
    const raf = requestAnimationFrame(read)
    window.addEventListener('resize', read)
    window.addEventListener('scroll', read, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', read)
      window.removeEventListener('scroll', read, true)
    }
  }, [cfg.sel])

  const onEscape = useCallback(() => dismiss(), [dismiss])
  const returnFocusTo = useCallback(
    () =>
      replay
        ? (document.querySelector<HTMLElement>('[data-tour="help-trigger"]') ??
          document.querySelector<HTMLElement>('.mob-more'))
        : null,
    [replay],
  )
  useDialogFocus(true, ref, onEscape, returnFocusTo)

  // popover placement: below the target if it fits, else above, else centred;
  // always clamped to the viewport (§GT4 overflow). No transition (§GT4 RM).
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - POP_W - MARGIN))
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - MARGIN - 96))
  let pop: { top: number; left: number }
  if (rect) {
    const tall = rect.height > vh * 0.6
    if (tall) {
      // a full-height panel (Inspector) — sit beside it, not above/below
      const onRight = rect.left + rect.width / 2 > vw / 2
      const left = onRight ? rect.left - POP_W - MARGIN : rect.left + rect.width + MARGIN
      pop = { top: clampY(rect.top + MARGIN), left: clampX(left) }
    } else {
      const below = rect.top + rect.height + MARGIN
      const wantAbove = below + 160 > vh
      const top = wantAbove ? rect.top - MARGIN - 160 : below
      pop = { top: clampY(top), left: clampX(rect.left + rect.width / 2 - POP_W / 2) }
    }
  } else {
    pop = { top: Math.max(MARGIN, vh / 2 - 90), left: clampX(vw / 2 - POP_W / 2) }
  }

  return (
    <div className="tour" role="presentation">
      <div className="tour-scrim" />
      {rect ? (
        <div
          className="tour-spot"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      ) : null}
      <div
        ref={ref}
        className={`tour-popover${rect ? '' : ' tour-popover--centred'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        style={{ top: pop.top, left: pop.left, width: POP_W }}
      >
        <div className="tour-popover__head">
          <span className="tour-popover__pos" aria-live="polite">
            {t('tour.nav.position', { n: step + 1, total: TOUR_TOTAL })}
          </span>
          <button
            type="button"
            className="tour-popover__x"
            onClick={() => dismiss()}
            aria-label={t('tour.nav.close')}
          >
            ✕
          </button>
        </div>
        <h2 id="tour-step-title" className="tour-popover__title">
          {t(cfg.titleKey)}
        </h2>
        <p className="tour-popover__body">{t(cfg.bodyKey)}</p>
        <div className="tour-popover__foot">
          <button
            type="button"
            className="btn"
            onClick={() => back()}
            disabled={step === 0}
          >
            {t('tour.nav.back')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => (isLast ? finish() : next())}
          >
            {isLast ? t('tour.nav.done') : t('tour.nav.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
