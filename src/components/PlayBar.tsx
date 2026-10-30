import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { Icon } from '../ui/icons'
import { topOverlay } from '../ui/overlayStack'
// measured on the children's boxes: a right-to-left row spills on its start
// side, which `scrollWidth` does not count (ar-XB at 900 px, 2026-10-20)
import { fitsRow } from './workbench/toolRowFit'

// P2 — playback lives in the chart-header strip, treated as part of the time
// axis rather than the editing toolbar.

// The slider maps to `speedMs` (the per-step beat, docs/simulation-playback.md
// §PB6 — wall-clock only; the engine / RNG / MC result is byte-identical at any
// speed). Range: 120 ms/step (fastest) … 2400 ms/step (slowest — ~1 change you
// can follow by eye), still available for detailed step-by-step observation
// or debugging. The default (simStore, `speedMs`) is 600 — a brisk-but-still-
// followable middle ground, NOT the slowest stop: a fresh document / template
// opening at the slowest possible speed reads as sluggish for the common case
// (a large graph, or a many-run Monte Carlo comparison) where the point is to
// see the aggregate result quickly, not linger on every single step.
const SPEED_MIN = 120
const SPEED_MAX = 2400
const toSlider = (ms: number) => SPEED_MIN + SPEED_MAX - ms
const fromSlider = (v: number) => SPEED_MIN + SPEED_MAX - v

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
}

// The run row is ONE row at every desktop width (Lumi, 2026-10-20). Short of
// room it gives up, in steps, what has another way in — never Reset, Step,
// Play, the current step or the run's STATE beside it (the steady state: the
// run's state comes before its settings, Lumi 2026-10-20):
//   1 — the Monte-Carlo button (Run ▸ Monte Carlo… opens the same dialog;
//       a run in progress keeps its progress and Cancel here)
//   2 — also Speed and Seed, folded into "Run settings" (the same two inputs,
//       in a popover over the row)
//   3 — last, the steady-state text may shorten (an ellipsis, its whole text
//       on the tooltip and announced as before)
// The step is the first that fits, measured on the row itself after every
// render: the step readout, the ended note and a Monte-Carlo progress change
// its width as a run goes on. The steady-state status keeps its room whether
// shown or not, so it never moves a control when it appears.
const RUN_ROW_STEPS = 3
function fitRunRow(row: HTMLElement): void {
  for (let step = 0; step <= RUN_ROW_STEPS; step++) {
    if (step === 0) delete row.dataset.fit
    else row.dataset.fit = String(step)
    if (fitsRow(row)) return
  }
}

export function PlayBar({ collapsed, onToggleCollapse }: Props) {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const seed = useSimStore((s) => s.seed)
  const steadyState = useSimStore((s) => s.steadyState)
  const initError = useSimStore((s) => s.initError)
  const play = useSimStore((s) => s.play)
  const pause = useSimStore((s) => s.pause)
  const stepOnce = useSimStore((s) => s.stepOnce)
  const reset = useSimStore((s) => s.reset)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const setSeed = useSimStore((s) => s.setSeed)

  const mcStatus = useMcStore((s) => s.status)
  const mcProgress = useMcStore((s) => s.progress)
  const mcMessage = useMcStore((s) => s.message)
  const openMcDialog = useMcStore((s) => s.openDialog)
  const cancelMc = useMcStore((s) => s.cancel)
  const mcRunning = mcStatus === 'running'
  const t = useT()

  const running = status === 'running'
  const ended = status === 'ended'

  // the step the timeline was last open at: the run going past it while the
  // timeline is folded is a new result; a reset below it clears the mark
  // (adjusted while rendering, React's pattern for state that follows a prop)
  const [seenStep, setSeenStep] = useState(stepIndex)
  if ((!collapsed || stepIndex < seenStep) && seenStep !== stepIndex) setSeenStep(stepIndex)
  const newResult = collapsed && stepIndex > seenStep
  const collapseLabel = collapsed
    ? newResult
      ? `${t('playbar.timeline.show')}, ${t('playbar.timeline.newResult')}`
      : t('playbar.timeline.show')
    : t('playbar.timeline.hide')

  // docs/simulation-playback-ordering.md §PBO5 — the "Steady state — flows
  // continue" status, beside the current step. Its room is kept whether it is
  // shown or not (`visibility`), so it never shifts a control or the strip
  // height when it appears; the row folds its settings to keep it (above).
  // (Until 2026-10-20 it was out of flow and hidden wherever it would meet a
  // control — at 1280 × 800 with the default panels, always.)
  const stripRef = useRef<HTMLDivElement>(null)
  const showSteady = steadyState && running

  // Re-check after every render (PlayBar re-renders on step / status / speed /
  // seed / MC changes — frequent enough during a run that a stale verdict
  // self-corrects within a frame) and on window resize. No ResizeObserver — a
  // measure that also `setState`s inside an RO callback trips the benign
  // "ResizeObserver loop" warning, and the render-driven re-check is enough here.
  // "Run settings" (fit step 2): Speed and Seed in a popover
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (settingsRef.current?.contains(t) || settingsBtnRef.current?.contains(t)) return
      setSettingsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // issue #413 (Lumi, 2026-10-30) — the popover is not an overlay-stack
      // entry; while a dialog or a sheet is open above it the Escape is theirs:
      // this capture listener must neither close the popover nor stop the
      // event (it runs before the dialog's own listener). The next Escape,
      // with the stack empty again, closes the popover and returns the focus.
      if (topOverlay() != null) return
      e.stopPropagation()
      setSettingsOpen(false)
      settingsBtnRef.current?.focus()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [settingsOpen])

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const measure = () => {
      fitRunRow(strip)
      // a fold the row no longer needs closes its popover
      if (strip.dataset.fit !== '2' && strip.dataset.fit !== '3' && settingsOpen) setSettingsOpen(false)
      // the open popover stands over its button (2026-10-20: it was pinned to
      // the row's start, and drifted from the button once the steady state
      // took its room beside the step), pulled in where the row's end is near
      const btn = settingsBtnRef.current
      const pop = settingsRef.current
      if (settingsOpen && btn && pop) {
        const room = strip.clientWidth - pop.offsetWidth - 12
        pop.style.left = `${Math.max(12, Math.min(btn.offsetLeft, room))}px`
        pop.style.right = 'auto'
      } else if (pop) {
        pop.style.left = ''
        pop.style.right = ''
      }
    }
    measure()
    const onResize = () => requestAnimationFrame(measure)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

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

  // §PBO5 accessibility — announce ONCE on first entry into `steadyState &&
  // running`. If the detector turns true while stopped (e.g. the user stepped
  // manually to a fixed point) nothing is spoken — the chip is hidden and it
  // would be wrong to read "flows continue" while paused; pressing Play then
  // announces it. Pause → Resume is the same steady verdict → no re-announce.
  // The "already announced" flag resets only when `steadyState` goes false, so
  // a genuine re-settle after a disruption does announce again.
  const [announce, setAnnounce] = useState('')
  const announcedRef = useRef(false)
  useEffect(() => {
    if (!steadyState) {
      announcedRef.current = false
      setAnnounce('') // '' → string next time is a real change, so SR re-announces
      return
    }
    if (running && !announcedRef.current) {
      announcedRef.current = true
      setAnnounce(t('playbar.steady'))
    }
  }, [steadyState, running, t])

  return (
    <div
      ref={stripRef}
      className="pstrip"
      data-placeholder="P2 — chart-header strip"
      data-tour="playback"
    >
      <div className="pstrip__group">
        <button type="button" className="pb-btn pb-btn--transport pstrip__reset" onClick={reset} title={t('playbar.reset.title')} aria-label={t('playbar.reset.title')}>
          <Icon name="run-reset" />
        </button>
        <button
          type="button"
          className="pb-btn pb-btn--transport pstrip__step-btn"
          onClick={stepOnce}
          disabled={running || initError != null}
          title={t('playbar.step.title')}
          aria-label={t('playbar.step.title')}
        >
          <Icon name="run-step" />
        </button>
        <button
          type="button"
          className={`pb-btn pb-btn--transport pb-btn--primary${running ? ' is-running' : ''}`}
          onClick={onPrimary}
          disabled={initError != null}
        >
          <Icon name={ended ? 'run-replay' : running ? 'run-pause' : 'run-play'} className="icon--lead" />
          {ended ? t('playbar.replay') : running ? t('playbar.pause') : t('playbar.play')}
        </button>
      </div>

      {initError != null ? (
        // the graph cannot be initialised for a run (simStore.initError — e.g.
        // a Pool with a negative `initial` from a hand-edited file). Play /
        // Step are disabled above; this names the reason (the engine's text).
        <span className="pstrip__step pstrip__initerr" role="alert" title={initError}>
          {t('playbar.initError', { detail: initError })}
        </span>
      ) : (
        <span className="pstrip__step">
          {ended ? t('playbar.stepEnded', { n: stepIndex }) : t('playbar.step', { n: stepIndex })}
        </span>
      )}

      {/* the run's state beside its step: its room is kept while hidden; the
          screen reader hears it once, from the status region below */}
      <span className={`pstrip__steady${showSteady ? ' is-on' : ''}`} aria-hidden="true" title={showSteady ? t('playbar.steady') : undefined}>
        {/* the row's last fit step shows the short wording, not an ellipsis
            (the whole text stays on the tooltip and in the status region) */}
        <span className="pstrip__steady-full">{t('playbar.steady')}</span>
        <span className="pstrip__steady-short">{t('playbar.steadyShort')}</span>
      </span>

      <button
        ref={settingsBtnRef}
        type="button"
        className={`pb-btn pstrip__settings-btn${settingsOpen ? ' is-open' : ''}`}
        aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? settingsId : undefined}
        onClick={() => setSettingsOpen((v) => !v)}
      >
        {t('playbar.settings')}
      </button>
      {/* Speed and Seed: in the row, or — folded (fit step 2) — the popover's
          content; one pair of inputs either way */}
      <div
        ref={settingsRef}
        id={settingsId}
        className={`pstrip__settings${settingsOpen ? ' is-open' : ''}`}
        role="group"
        aria-label={t('playbar.settings')}
      >
      <label className="pstrip__field">
        <span>{t('playbar.speed')}</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={20}
          value={toSlider(speedMs)}
          onChange={(e) => setSpeed(fromSlider(Number(e.target.value)))}
        />
      </label>

      <label className="pstrip__field" title={t('playbar.seed.title')}>
        <span>{t('playbar.seed')}</span>
        <input dir="ltr"
          className="pstrip__seed"
          type="number"
          min={0}
          step={1}
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
        />
      </label>
      </div>

      <span className="pstrip__mc">
        {mcRunning ? (
          <>
            <span className="pstrip__mcprog" title={t('playbar.mc.progress.title')}>
              {t('playbar.mc.progress', { pct: Math.round(mcProgress * 100) })}
            </span>
            <button type="button" className="pb-btn" onClick={cancelMc}>
              {t('playbar.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            // a cancelled / failed run's note is the run's state, not a
            // setting: the button carrying it is not folded (2026-10-20)
            className={`pb-btn pstrip__mc-btn${mcMessage ? ' has-note' : ''}`}
            onClick={openMcDialog}
            title={t('playbar.mc.title')}
          >
            {mcMessage
              ? t('playbar.mc.withNote', {
                  note: mcMessage === 'cancelled' ? t('playbar.mc.cancelled') : t('playbar.mc.failed'),
                })
              : t('playbar.mc')}
          </button>
        )}
      </span>

      <button
        type="button"
        className={`pb-btn pstrip__collapse${newResult ? ' has-new' : ''}`}
        onClick={onToggleCollapse}
        // docs/timeline-series-contract.md §7 — the state is exposed, not only
        // implied by the swapped title (the section headers and the legend
        // trigger both expose `aria-expanded`; this one did not)
        aria-expanded={!collapsed}
        aria-label={collapseLabel}
        title={collapseLabel}
      >
        {/* folded, the button names what it opens and says when the run has
            gone on since (2026-10-25, Lumi: "결과 보기 · 새 결과" — in words,
            not by colour alone); the words go first when the row is short */}
        {collapsed && (
          <span className="pstrip__collapse-text" aria-hidden="true">
            {t('playbar.timeline.short')}
            {newResult && <> · {t('playbar.timeline.newResult')}</>}
          </span>
        )}
        {newResult && <span className="pstrip__new-dot" aria-hidden="true" />}
        <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} />
      </button>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  )
}
