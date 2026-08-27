import { useEffect, useRef, useState } from 'react'
import { estimateMonteCarloCost, type CostEstimate } from '../engine'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'

// P2 — Monte-Carlo setup. Opens from the simulation strip (an execution mode,
// not an authoring command). Shows an exact memory projection and a time RANGE
// — labelled as a local benchmark or as measured from the last real run, never
// as a parallel prediction. Closing it does not stop a run in progress.

const fmtMs = (ms: number) => (ms < 950 ? `${Math.round(ms / 10) * 10}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtBytes = (b: number) =>
  b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`

const FOCUSABLE =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

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
  const lastThroughput = useMcStore((s) => s.lastThroughput)

  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const probeRef = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // debounced cost probe — on open and on any config change
  useEffect(() => {
    if (!open) return
    probeRef.current?.abort()
    const ac = new AbortController()
    probeRef.current = ac
    setEstimating(true)
    const t = window.setTimeout(async () => {
      const g = useGraphStore.getState()
      const prior =
        lastThroughput && lastThroughput.rev === g.simulationRev
          ? { msPerRunStep: lastThroughput.msPerRunStep }
          : undefined
      try {
        const e = await estimateMonteCarloCost(g.nodes, g.edges, config, { signal: ac.signal, prior })
        if (!ac.signal.aborted) setEstimate(e)
      } finally {
        if (!ac.signal.aborted) setEstimating(false)
      }
    }, 300)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [open, config, lastThroughput])

  // focus in on open (first config field, else Close), restore to the strip
  // button on close
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const d = dialogRef.current
    const target =
      d?.querySelector<HTMLElement>('input, select') ?? d?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
    return () => {
      const back =
        document.querySelector<HTMLButtonElement>('.pstrip__mc button') ?? opener
      back?.focus?.()
    }
  }, [open])

  // Escape closes (does NOT cancel a run); Tab is trapped inside the dialog
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled'),
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
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
        ref={dialogRef}
        className="mcdlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcdlg-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id="mcdlg-title">Monte Carlo</span>
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
              onChange={(e) =>
                setConfig({ baseSeed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
          </label>
          <p className="mcdlg__note">Tracking every Pool. Per-Pool selection comes later.</p>

          <div className={`mcdlg__cost${overLimit ? ' is-over' : ''}`}>
            {estimating && !estimate ? (
              <span>estimating…</span>
            ) : estimate ? (
              <>
                <span className="mcdlg__costline">
                  <span className="mcdlg__costlabel">
                    {estimate.source === 'measured' ? 'Measured (last run)' : 'Local benchmark'}
                  </span>
                  <b>~{fmtMs(estimate.lowMs)}–{fmtMs(estimate.highMs)}</b>
                </span>
                <span className="mcdlg__costline">
                  <span className="mcdlg__costlabel">Execution</span>
                  <span className="mcdlg__path">
                    {estimate.path === 'parallel'
                      ? `Parallel, ${estimate.workers} workers`
                      : estimate.fileProtocol
                        ? 'Local — the screen may freeze during the run'
                        : 'Local'}
                  </span>
                </span>
                <span className="mcdlg__costline">
                  <span className="mcdlg__costlabel">Memory</span>
                  <span>
                    ~{fmtBytes(estimate.memoryBytes)}
                    {overLimit ? (
                      <span className="mcdlg__over"> — over the limit, reduce runs / steps</span>
                    ) : null}
                  </span>
                </span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>

          {running ? (
            <div
              className="mcdlg__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-live="polite"
            >
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
              disabled={overLimit || (estimating && !estimate)}
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
