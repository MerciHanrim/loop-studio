import { useEffect, useRef, useState } from 'react'
import { useMcStore } from '../store/mcStore'
import { BandChart } from './BandChart'
import {
  toFinalCsv,
  toFinalSummaryCsv,
  toMonteCarloJson,
  toSeriesCsv,
  type MonteCarloResult,
} from '../engine'

// P2 distribution view — occupies the timeline area when a Monte-Carlo result
// exists and the LIVE / DISTRIBUTION switch is on DISTRIBUTION.
// Checkpoint 1: header stats + one Export menu. The p10/p50/p90 band chart next.

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function endedPct(r: MonteCarloResult): number {
  const last = r.endedRuns.atOrBeforeStep.at(-1) ?? 0
  return r.completedRuns ? Math.round((last / r.completedRuns) * 100) : 0
}

function ExportMenu({ result, disabled }: { result: MonteCarloResult; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const save = (suffix: string, text: string, mime: string) => {
    download(`loop-studio-montecarlo-${suffix}`, text, mime)
    setOpen(false)
  }

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="timeline__csv"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? 'Result is stale — re-run to export' : 'Export this run'}
        onClick={() => setOpen((v) => !v)}
      >
        Export ▾
      </button>
      {open ? (
        <div className="menu__pop menu__pop--up" role="menu">
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('series.csv', toSeriesCsv(result), 'text/csv')}>
            <span className="menu__name">Series CSV</span>
            <span className="menu__blurb">per-step p10/p50/p90/mean/min/max</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('runs.csv', toFinalCsv(result), 'text/csv')}>
            <span className="menu__name">Runs CSV</span>
            <span className="menu__blurb">terminal value per run · run, seed, pools</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('summary.csv', toFinalSummaryCsv(result), 'text/csv')}>
            <span className="menu__name">Summary CSV</span>
            <span className="menu__blurb">final-value summary per pool</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('result.json', toMonteCarloJson(result), 'application/json')}>
            <span className="menu__name">JSON</span>
            <span className="menu__blurb">full MonteCarloResult</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function DistributionPanel() {
  const result = useMcStore((s) => s.result)
  const stale = useMcStore((s) => s.stale)
  if (!result) return null

  return (
    <div className="dist">
      <div className="dist__stats">
        <span className="dist__stat">
          <b>{result.completedRuns}</b> runs
        </span>
        <span className="dist__stat">
          <b>{result.config.steps}</b> steps
        </span>
        <span className="dist__stat">
          seed <b>{result.config.baseSeed}</b>
        </span>
        <span className="dist__stat">
          Ended <b>{endedPct(result)}%</b>
        </span>
        {stale ? <span className="dist__stale">stale — graph changed; re-run to refresh</span> : null}
        <span className="dist__spacer" />
        <ExportMenu result={result} disabled={stale} />
      </div>

      <BandChart result={result} />
    </div>
  )
}
