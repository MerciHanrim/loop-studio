import { useEffect } from 'react'
import { useMcStore } from '../../store/mcStore'
import { useSimStore } from '../../store/simStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'

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
    <div className="pstrip pstrip--mobile" role="toolbar" aria-label="Run controls">
      <div className="pstrip__group">
        <button type="button" className="pb-btn" onClick={reset} aria-label="Reset to step 0">
          ⟲
        </button>
        <button
          type="button"
          className="pb-btn"
          onClick={stepOnce}
          disabled={running}
          aria-label="Advance one step"
        >
          ⏭
        </button>
        <button
          type="button"
          className={`pb-btn pb-btn--primary${running ? ' is-running' : ''}`}
          onClick={onPrimary}
        >
          {ended ? '⟳ Replay' : running ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      <span className="pstrip__step">step {stepIndex}{ended ? ' · ended' : ''}</span>

      {mcRunning ? (
        <button type="button" className="pb-btn" onClick={cancelMc}>
          MC {Math.round(mcProgress * 100)}% · Cancel
        </button>
      ) : (
        <button
          type="button"
          className="pb-btn"
          onClick={openMcDialog}
          title="Run the diagram many times and see the distribution"
        >
          Monte Carlo
        </button>
      )}

      <button
        type="button"
        className="pb-btn pstrip__tl"
        aria-haspopup="dialog"
        aria-expanded={overlay === 'timeline'}
        onClick={() => toggleOverlay('timeline')}
      >
        Timeline {overlay === 'timeline' ? '▾' : '▴'}
      </button>
    </div>
  )
}
