import { useEffect } from 'react'
import { useMcStore } from '../../store/mcStore'
import { useSimStore } from '../../store/simStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { useT } from '../../i18n'

// docs/mobile.md §MV4 — the fixed bottom run bar. Reset / Step / Play·Pause /
// Monte Carlo + the step counter + a Timeline-sheet toggle. No speed slider or
// seed field on mobile (view/run uses the defaults).

export function MobileRunBar() {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
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
    <div className="pstrip pstrip--mobile" role="toolbar" aria-label={t('runbar.ariaLabel')} data-tour="mobile-run">
      <div className="pstrip__group">
        <button type="button" className="pb-btn" onClick={reset} aria-label={t('playbar.reset.title')}>
          ⟲
        </button>
        <button
          type="button"
          className="pb-btn"
          onClick={stepOnce}
          disabled={running}
          aria-label={t('playbar.step.title')}
        >
          ⏭
        </button>
        <button
          type="button"
          className={`pb-btn pb-btn--primary${running ? ' is-running' : ''}`}
          onClick={onPrimary}
        >
          {ended ? t('playbar.replay') : running ? t('playbar.pause') : t('playbar.play')}
        </button>
      </div>

      <span className="pstrip__step">
        {ended ? t('playbar.stepEnded', { n: stepIndex }) : t('playbar.step', { n: stepIndex })}
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
        >
          {t('playbar.mc')}
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
    </div>
  )
}
