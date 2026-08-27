import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'

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
    <div className="pstrip" data-placeholder="P2 — chart-header strip">
      <div className="pstrip__group">
        <button type="button" className="pb-btn" onClick={reset} title="Reset to step 0">
          ⟲
        </button>
        <button
          type="button"
          className="pb-btn"
          onClick={stepOnce}
          disabled={running}
          title="Advance one step"
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

      <span className="pstrip__step">
        step {stepIndex}
        {ended ? ' · ended' : ''}
      </span>

      <label className="pstrip__field">
        <span>speed</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={20}
          value={toSlider(speedMs)}
          onChange={(e) => setSpeed(fromSlider(Number(e.target.value)))}
        />
      </label>

      <label className="pstrip__field" title="Random seed — same seed reproduces the run; changing it restarts">
        <span>seed</span>
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
            <span className="pstrip__mcprog" title="Monte-Carlo run in progress">
              Monte Carlo {Math.round(mcProgress * 100)}%
            </span>
            <button type="button" className="pb-btn" onClick={cancelMc}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="pb-btn"
            onClick={openMcDialog}
            title="Run the diagram many times and see the distribution"
          >
            Monte Carlo{mcMessage ? ` · ${mcMessage}` : ''}
          </button>
        )}
      </span>

      <button
        type="button"
        className="pb-btn pstrip__collapse"
        onClick={onToggleCollapse}
        title={collapsed ? 'Show timeline' : 'Hide timeline'}
      >
        {collapsed ? '▴' : '▾'}
      </button>
    </div>
  )
}
