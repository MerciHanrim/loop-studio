import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useMcStore } from '../../store/mcStore'
import { useSimStore } from '../../store/simStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { useT } from '../../i18n'

// docs/mobile.md §MV4 — the fixed bottom run bar. Reset / Step / Play·Pause /
// Monte Carlo + the step counter + a Timeline-sheet toggle. No speed slider or
// seed field on mobile (view/run uses the defaults).

/** the CSS variable that carries the bar's measured height (issue #303) */
export const RUN_BAR_HEIGHT_VAR = '--mob-runbar-real'

/**
 * The bar's real height, written to `--mob-runbar-real` on the root element.
 *
 * The layout used to reserve a constant 52 px for the bar (`--mob-runbar-h`)
 * while the bar's own height was `auto`. MEASURED on main 3ce52f4: the bar
 * wraps to two rows and is 101 px tall at 320 and 340 px in every language, at
 * 360 px in eleven languages including Arabic, and still at 390 px in six
 * (es-419, pt-BR, es-ES, pt-PT, ru, tr); one row is 53 px against the 52
 * reserved. 49 px of canvas and the whole attribution line sat under the bar,
 * and the Timeline sheet and the More sheet were anchored 49 px too low. The
 * run-refusal row (`initError`) adds a row too. One height, measured where it
 * is, read by everything that keeps clear of it; the constant stays as the
 * minimum and as the fallback before the first measurement.
 *
 * Setting a variable is not `setState`, and the bar is fixed at the bottom, so
 * the padding it drives never changes the bar's own size: no observer loop.
 */
function useRunBarHeight(ref: RefObject<HTMLDivElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!active || !el) {
      root.style.removeProperty(RUN_BAR_HEIGHT_VAR)
      return
    }
    const write = () => root.style.setProperty(RUN_BAR_HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`)
    write()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(write) : null
    ro?.observe(el)
    window.addEventListener('resize', write)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', write)
      root.style.removeProperty(RUN_BAR_HEIGHT_VAR)
    }
  }, [ref, active])
}

export function MobileRunBar() {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const initError = useSimStore((s) => s.initError)
  const play = useSimStore((s) => s.play)
  const pause = useSimStore((s) => s.pause)
  const stepOnce = useSimStore((s) => s.stepOnce)
  const reset = useSimStore((s) => s.reset)

  const mcStatus = useMcStore((s) => s.status)
  const mcProgress = useMcStore((s) => s.progress)
  const mcDialogOpen = useMcStore((s) => s.dialogOpen)
  const openMcDialog = useMcStore((s) => s.openDialog)
  const cancelMc = useMcStore((s) => s.cancel)

  const overlay = useUiStore(selectOverlay)
  const toggleOverlay = useUiStore((s) => s.toggleOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const isMobile = useIsMobile()
  const t = useT()
  const barRef = useRef<HTMLDivElement>(null)
  useRunBarHeight(barRef, isMobile)

  // the MC dialog is part of the exclusive set (§MV5): opening it closes any
  // open sheet. The forward direction (a sheet closing the dialog) is in
  // uiStore.openOverlay.
  useEffect(() => {
    if (mcDialogOpen) closeOverlay()
  }, [mcDialogOpen, closeOverlay])

  if (!isMobile) return null

  const running = status === 'running'
  const ended = status === 'ended'
  const mcRunning = mcStatus === 'running'

  const onPrimary = () => {
    if (ended) {
      reset()
      play()
    } else if (running) {
      pause()
    } else {
      play()
    }
  }

  return (
    <div
      ref={barRef}
      className={`pstrip pstrip--mobile${initError != null ? ' has-initerr' : ''}`}
      role="toolbar"
      aria-label={t('runbar.ariaLabel')}
      data-tour="mobile-run"
    >
      <div className="pstrip__group">
        <button type="button" className="pb-btn" onClick={reset} aria-label={t('playbar.reset.title')}>
          ⟲
        </button>
        <button
          type="button"
          className="pb-btn"
          onClick={stepOnce}
          disabled={running || initError != null}
          aria-label={t('playbar.step.title')}
        >
          ⏭
        </button>
        <button
          type="button"
          className={`pb-btn pb-btn--primary${running ? ' is-running' : ''}`}
          onClick={onPrimary}
          disabled={initError != null}
          title={initError != null ? t('playbar.initError', { detail: initError }) : undefined}
        >
          {ended ? t('playbar.replay') : running ? t('playbar.pause') : t('playbar.play')}
        </button>
      </div>

      {/* the run bar is tight at 390px; a CJK "step N" / "Monte Carlo" label
          crowds the row. Show a compact glyph, keep the full phrase as the
          accessible name (docs/mobile.md §MV4). */}
      <span
        className="pstrip__step"
        dir="ltr"
        aria-label={
          ended ? t('playbar.stepEnded', { n: stepIndex }) : t('playbar.step', { n: stepIndex })
        }
        title={t('playbar.step', { n: stepIndex })}
      >
        {ended ? `${stepIndex} ·` : stepIndex}
      </span>

      {mcRunning ? (
        <button type="button" className="pb-btn" onClick={cancelMc}>
          {t('runbar.mc.cancel', { pct: Math.round(mcProgress * 100) })}
        </button>
      ) : (
        <button
          type="button"
          className="pb-btn"
          onClick={openMcDialog}
          title={t('playbar.mc.title')}
          aria-label={t('playbar.mc')}
        >
          MC
        </button>
      )}

      <button
        type="button"
        className="pb-btn pstrip__tl"
        data-tour="mobile-timeline"
        aria-haspopup="dialog"
        aria-expanded={overlay === 'timeline'}
        onClick={() => toggleOverlay('timeline')}
      >
        {t('runbar.timeline')} {overlay === 'timeline' ? '▾' : '▴'}
      </button>

      {/* the graph cannot be initialised for a run (simStore.initError). A
          touch user cannot hover a disabled button's `title`, so the reason
          is a VISIBLE second row of the bar, not a tooltip. */}
      {initError != null ? (
        <div className="pstrip__initerr pstrip__initerr--mobile" role="alert">
          {t('playbar.initError', { detail: initError })}
        </div>
      ) : null}
    </div>
  )
}
