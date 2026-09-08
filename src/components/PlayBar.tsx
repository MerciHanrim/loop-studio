import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'

// P2 — playback lives in the chart-header strip, treated as part of the time
// axis rather than the editing toolbar.

// The slider maps to `speedMs` (the per-step beat, docs/simulation-playback.md
// §PB6 — wall-clock only; the engine / RNG / MC result is byte-identical at any
// speed). Range: 120 ms/step (fastest) … 2400 ms/step (slowest — ~1 change you
// can follow by eye). The 120 → 1600 band is unchanged so the user can drag
// straight up to the old speeds; 2400 just extends the slow end and is the new
// default (simStore).
const SPEED_MIN = 120
const SPEED_MAX = 2400
const toSlider = (ms: number) => SPEED_MIN + SPEED_MAX - ms
const fromSlider = (v: number) => SPEED_MIN + SPEED_MAX - v

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
}

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5

export function PlayBar({ collapsed, onToggleCollapse }: Props) {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const seed = useSimStore((s) => s.seed)
  const steadyState = useSimStore((s) => s.steadyState)
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

  // docs/simulation-playback-ordering.md §PBO5 — the "Steady state — flows
  // continue" chip. It is `position: absolute` (out of flow — it never shifts a
  // control or the strip height, appearing or not) and only shows when it fits
  // WITHOUT overlapping any control; when the strip is too tight it is hidden.
  const stripRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLDivElement>(null)
  const [chipFits, setChipFits] = useState(false)
  const wantChip = steadyState && running

  useLayoutEffect(() => {
    const strip = stripRef.current
    const chip = chipRef.current
    if (!strip || !chip) return
    const measure = () => {
      const cr = chip.getBoundingClientRect()
      const sr = strip.getBoundingClientRect()
      if (cr.width === 0 || cr.left < sr.left + 4 || cr.right > sr.right - 2) {
        setChipFits(false)
        return
      }
      const controls = strip.querySelectorAll<HTMLElement>(
        '.pstrip__group, .pstrip__step, .pstrip__field, .pstrip__mc, .pstrip__collapse',
      )
      for (const el of controls) {
        if (intersects(cr, el.getBoundingClientRect())) {
          setChipFits(false)
          return
        }
      }
      setChipFits(true)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [steadyState, running, mcRunning, mcMessage, collapsed, t])

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

  // §PBO5 accessibility — announce ONCE on the false → true edge; while steady
  // persists across many committed steps the text does not change, so a screen
  // reader is not re-notified every step.
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    setAnnounce(steadyState ? t('playbar.steady') : '')
  }, [steadyState, t])

  return (
    <div
      ref={stripRef}
      className="pstrip"
      data-placeholder="P2 — chart-header strip"
      data-tour="playback"
    >
      <div className="pstrip__group">
        <button type="button" className="pb-btn" onClick={reset} title={t('playbar.reset.title')}>
          ⟲
        </button>
        <button
          type="button"
          className="pb-btn"
          onClick={stepOnce}
          disabled={running}
          title={t('playbar.step.title')}
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
        <input
          className="pstrip__seed"
          type="number"
          min={0}
          step={1}
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
        />
      </label>

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
            className="pb-btn"
            onClick={openMcDialog}
            title={t('playbar.mc.title')}
          >
            {mcMessage ? t('playbar.mc.withNote', { note: mcMessage }) : t('playbar.mc')}
          </button>
        )}
      </span>

      <button
        type="button"
        className="pb-btn pstrip__collapse"
        onClick={onToggleCollapse}
        title={collapsed ? t('playbar.timeline.show') : t('playbar.timeline.hide')}
      >
        {collapsed ? '▴' : '▾'}
      </button>

      {/* out of flow; always rendered so its box can be measured, shown only
          when it fits with no overlap (§PBO5) */}
      <div
        ref={chipRef}
        className={`pstrip__steady${wantChip && chipFits ? ' is-on' : ''}`}
        aria-hidden="true"
      >
        {t('playbar.steady')}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  )
}
