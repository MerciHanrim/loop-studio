import { useMcStore } from '../store/mcStore'
import {
  toFinalCsv,
  toFinalSummaryCsv,
  toMonteCarloJson,
  toSeriesCsv,
  type MonteCarloResult,
} from '../engine'

// P2 distribution view — occupies the timeline area when a Monte-Carlo result
// exists and the LIVE / DISTRIBUTION switch is on DISTRIBUTION.
// Checkpoint 1: header stats + export. The p10/p50/p90 band chart is next.

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

export function DistributionPanel() {
  const result = useMcStore((s) => s.result)
  const stale = useMcStore((s) => s.stale)
  if (!result) return null

  const canExport = !stale
  const ex = (suffix: string, text: string, mime: string) =>
    download(`loop-studio-montecarlo-${suffix}`, text, mime)

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
        <span className="dist__exports">
          <button
            type="button"
            className="timeline__csv"
            disabled={!canExport}
            onClick={() => ex('series.csv', toSeriesCsv(result), 'text/csv')}
            title="Per-step p10/p50/p90/mean/min/max, one row per (step, pool)"
          >
            CSV series
          </button>
          <button
            type="button"
            className="timeline__csv"
            disabled={!canExport}
            onClick={() => ex('final.csv', toFinalCsv(result), 'text/csv')}
            title="Terminal value per run (run, seed, per pool)"
          >
            CSV final
          </button>
          <button
            type="button"
            className="timeline__csv"
            disabled={!canExport}
            onClick={() => ex('final-summary.csv', toFinalSummaryCsv(result), 'text/csv')}
            title="Final-value summary, one row per pool"
          >
            CSV summary
          </button>
          <button
            type="button"
            className="timeline__csv"
            disabled={!canExport}
            onClick={() => ex('result.json', toMonteCarloJson(result), 'application/json')}
            title="Full MonteCarloResult"
          >
            JSON
          </button>
        </span>
      </div>

      <div className="dist__plot dist__plot--placeholder">
        p10 · p50 · p90 band chart — next checkpoint
      </div>
    </div>
  )
}
