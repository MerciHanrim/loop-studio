import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'

// P2 — playback lives in the chart-header strip, treated as part of the time
// axis rather than the editing toolbar.

const SPEED_MIN = 120
const SPEED_MAX = 1600
const toSlider = (ms: number) => SPEED_MIN + SPEED_MAX - ms
const fromSlider = (v: number) => SPEED_MIN + SPEED_MAX - v

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
}

export function PlayBar({ collapsed, onToggleCollapse }: Props) {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const seed = useSimStore((s) => s.seed)
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
    <div className="pstrip" data-placeholder="P2 — chart-header strip" data-tour="playback">
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
    </div>
  )
}
