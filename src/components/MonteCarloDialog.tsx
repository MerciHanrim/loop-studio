import { useEffect, useRef, useState } from 'react'
import { estimateMonteCarloCost, type CostEstimate } from '../engine'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'

// P2 — Monte-Carlo setup. Opens from the simulation strip (an execution mode,
// not an authoring command). Shows an exact memory projection and a measured
// time RANGE before the run. Closing it does not stop a run in progress.

const fmtMs = (ms: number) => (ms < 950 ? `${Math.round(ms / 10) * 10}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtBytes = (b: number) =>
  b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`

export function MonteCarloDialog() {
  const open = useMcStore((s) => s.dialogOpen)
  const close = useMcStore((s) => s.closeDialog)
  const config = useMcStore((s) => s.config)
  const setConfig = useMcStore((s) => s.setConfig)
  const run = useMcStore((s) => s.run)
  const cancel = useMcStore((s) => s.cancel)
  const status = useMcStore((s) => s.status)
  const progress = useMcStore((s) => s.progress)
  const completedRuns = useMcStore((s) => s.completedRuns)

  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const probeRef = useRef<AbortController | null>(null)

  // debounced cost probe — re-runs on open and on any config change
  useEffect(() => {
    if (!open) return
    probeRef.current?.abort()
    const ac = new AbortController()
    probeRef.current = ac
    setEstimating(true)
    const t = window.setTimeout(async () => {
      const g = useGraphStore.getState()
      try {
        const e = await estimateMonteCarloCost(g.nodes, g.edges, config, { signal: ac.signal })
        if (!ac.signal.aborted) setEstimate(e)
      } finally {
        if (!ac.signal.aborted) setEstimating(false)
      }
    }, 300)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [open, config])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const running = status === 'running'
  const overLimit = estimate?.overLimit ?? false
  const num = (v: string, lo: number) => Math.max(lo, Math.floor(Number(v) || lo))

  return (
    <div className="mcdlg__scrim" onMouseDown={close}>
      <div
        className="mcdlg"
        role="dialog"
        aria-label="Monte Carlo"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span>Monte Carlo</span>
          <button type="button" className="mcdlg__x" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mcdlg__body">
          <label className="mcdlg__field">
            <span>runs</span>
            <input
              type="number"
              min={1}
              step={50}
              value={config.runs}
              disabled={running}
              onChange={(e) => setConfig({ runs: num(e.target.value, 1) })}
            />
          </label>
          <label className="mcdlg__field">
            <span>steps</span>
            <input
              type="number"
              min={1}
              step={5}
              value={config.steps}
              disabled={running}
              onChange={(e) => setConfig({ steps: num(e.target.value, 1) })}
            />
          </label>
          <label className="mcdlg__field">
            <span>base seed</span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.baseSeed}
              disabled={running}
              onChange={(e) => setConfig({ baseSeed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
          </label>
          <p className="mcdlg__note">Tracking every Pool. Per-Pool selection comes later.</p>

          <div className={`mcdlg__cost${overLimit ? ' is-over' : ''}`}>
            {estimating && !estimate ? (
              <span>estimating…</span>
            ) : estimate ? (
              <>
                <span className="mcdlg__costline">
                  <b>~{fmtMs(estimate.lowMs)}–{fmtMs(estimate.highMs)}</b>
                  <span className="mcdlg__path">
                    {estimate.path === 'parallel'
                      ? `Parallel · ${estimate.workers} workers`
                      : estimate.fileProtocol
                        ? 'Local · the screen may freeze during the run'
                        : 'Local'}
                  </span>
                </span>
                <span className="mcdlg__costline">
                  <span>memory ~{fmtBytes(estimate.memoryBytes)}</span>
                  {overLimit ? <span className="mcdlg__over">over the limit — reduce runs / steps</span> : null}
                </span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>

          {running ? (
            <div className="mcdlg__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <span className="mcdlg__bar" style={{ width: `${progress * 100}%` }} />
              <span className="mcdlg__pct">
                {completedRuns} / {config.runs}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mcdlg__foot">
          {running ? (
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={overLimit || estimating}
              onClick={() => void run()}
            >
              Run {config.runs}×
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {running ? 'Close (keep running)' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
