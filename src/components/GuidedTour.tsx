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
import { Icon } from '../ui/icons'

// docs/guided-tour.md — a read-only overlay that points at the six regions of
// the UI. It drives nothing: starting / Next / Back / Escape / Done mutate no
// GraphDoc, digest, undo, selection, viewport, SimState, or MC state (§GT4).
// Its only persistent trace is one localStorage string (tourStore, §GT6).

const PLATFORM = () => (window.innerWidth < 768 ? 'mobile' : 'desktop') as 'mobile' | 'desktop'

// issue #308 - where focus goes when the tour ends, by Done, Escape or the
// close control, whether it was a first run or a replay: never <body>. The Help
// button, where a replay starts; when the toolbar has folded Help into the
// overflow menu, that menu's button; on a phone the More button, where the
// phone's replay starts. A target that is gone, hidden, inert or disabled is
// skipped. Only when none of them is usable, the last resort is the top bar's
// first usable menu button: opening a menu is harmless. Never a palette piece,
// which Enter would insert, and never <body>.
// `visibility: hidden` keeps an element's boxes, so client rects alone are not
// enough: MEASURED, the overflow button at 1280 px is in the page, hidden that
// way, and focusing it left focus on <body>.
const usable = (el: HTMLElement | null): el is HTMLElement =>
  !!el &&
  el.isConnected &&
  el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility === 'visible' &&
  !el.closest('[inert]') &&
  !(el as HTMLButtonElement).disabled

function tourExitTarget(): HTMLElement | null {
  const named = [
    '[data-tour="help-trigger"]',
    '.toolbar__overflow-btn',
    '[data-tour="mobile-more"]',
  ].map((sel) => document.querySelector<HTMLElement>(sel))
  const found = named.find(usable)
  if (found) return found
  const menus = document.querySelectorAll<HTMLElement>(
    'header.toolbar button[aria-haspopup], header.toolbar button[aria-expanded]',
  )
  return [...menus].find((el) => usable(el) && !el.closest('[data-tour="palette"]')) ?? null
}

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
    // issue #307 - the whole tour layer (scrim, card) is the modal one, so the
    // scrim is not made inert with the page behind it (src/ui/overlayStack.ts)
    <div className="tour" role="presentation" data-modal-layer="">
      {/* §GT4 — the scrim swallows background input; a click on it is inert */}
      <div className="tour-scrim" />
      {/* issue #308 - the question is the dialog's description, read with its
          name when the card opens */}
      <div
        ref={ref}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
        aria-describedby="tour-welcome-body"
      >
        <h2 id="tour-welcome-title" className="tour-card__title">
          {t('tour.welcome.title')}
        </h2>
        <p id="tour-welcome-body" className="tour-card__body">
          {t('tour.welcome.body')}
        </p>
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
// keep the 2 px highlight border + the 3 px forced-colors outline on screen
const SPOT_INSET = 5

function TourPopover() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const step = useTourStore((s) => s.step)
  const platform = useTourStore((s) => s.platform)
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

  // issue #308 - focus starts on Next and stays on Back / Next while the steps
  // change in place
  const nextRef = useRef<HTMLButtonElement>(null)
  const onEscape = useCallback(() => dismiss(), [dismiss])
  useDialogFocus(true, ref, onEscape, tourExitTarget, { initialFocus: () => nextRef.current })

  // issue #308 - each step is announced ONCE. Step 1 is the dialog's name (its
  // `N / 6` and title) and description (its body), read when focus enters it; the live
  // region starts empty, so step 1 is not said twice. A step reached with Next
  // or Back is said once by the live region, as `N / 6. title. body` worded per
  // language (`tour.nav.announce`). It is written by the press itself, so a
  // re-render (a language switch) announces nothing. The visible `N / 6` is
  // not live, nor is the title, so neither repeats it.
  const [announcement, setAnnouncement] = useState('')
  const announce = (to: number) => {
    const s = script[to]
    setAnnouncement(
      t('tour.nav.announce', { n: to + 1, total: TOUR_TOTAL, title: t(s.titleKey), body: t(s.bodyKey) }),
    )
  }
  const onNext = () => {
    if (isLast) return finish()
    announce(step + 1)
    next()
  }
  const onBack = () => {
    // Back is disabled on step 1: focus moves to Next BEFORE it is, or it would
    // fall to <body> inside the dialog
    if (step === 1) nextRef.current?.focus()
    announce(step - 1)
    back()
  }

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

  // the highlight ring hugs the target + 4 px, but is CLAMPED so the whole
  // border line (and its `forced-colors` outline) stays on screen even when the
  // target touches a viewport edge (Canvas / Inspector / Playback / Timeline).
  // The ring shrinks near an edge; it is never moved off the target.
  const spot = rect
    ? (() => {
        const left = Math.max(SPOT_INSET, rect.left - 4)
        const top = Math.max(SPOT_INSET, rect.top - 4)
        const right = Math.min(vw - SPOT_INSET, rect.left + rect.width + 4)
        const bottom = Math.min(vh - SPOT_INSET, rect.top + rect.height + 4)
        return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
      })()
    : null

  return (
    // issue #307 - the whole tour layer (scrim, spotlight, popover) is the
    // modal one (src/ui/overlayStack.ts)
    <div className="tour" role="presentation" data-modal-layer="">
      <div className="tour-scrim" />
      {spot ? <div className="tour-spot" style={spot} /> : null}
      <div
        ref={ref}
        className={`tour-popover${rect ? '' : ' tour-popover--centred'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-pos tour-step-title"
        aria-describedby="tour-step-body"
        style={{ top: pop.top, left: pop.left, width: POP_W }}
      >
        <div className="tour-popover__head">
          {/* §L9.3 — a PINNED numeric pair, not a sentence. `{n} / {total}` is two
              number runs with a neutral slash between them, so inside an RTL
              paragraph the runs swap and step 2 of 6 reads `6 / 2`. MEASURED in
              `e2e/i18n-ar.spec.ts` under `ar`; the characters are identical either
              way, which is why no text assertion could have caught it.
              issue #308 - not live: the step's announcement says it. With the
              title it names the dialog, so step 1 is said with its number. */}
          <span id="tour-step-pos" className="tour-popover__pos" dir="ltr">
            {t('tour.nav.position', { n: step + 1, total: TOUR_TOTAL })}
          </span>
          <button
            type="button"
            className="tour-popover__x"
            onClick={() => dismiss()}
            aria-label={t('tour.nav.close')}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="tour-step-title" className="tour-popover__title">
          {t(cfg.titleKey)}
        </h2>
        <p id="tour-step-body" className="tour-popover__body">
          {t(cfg.bodyKey)}
        </p>
        <div className="tour-popover__foot">
          <button type="button" className="btn" onClick={onBack} disabled={step === 0}>
            {t('tour.nav.back')}
          </button>
          <button ref={nextRef} type="button" className="btn btn--primary" onClick={onNext}>
            {isLast ? t('tour.nav.done') : t('tour.nav.next')}
          </button>
        </div>
        <div className="sr-only tour-popover__announce" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </div>
  )
}
