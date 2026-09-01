import { useEffect, useRef, useState } from 'react'
import { useMcStore } from '../store/mcStore'
import { useT } from '../i18n'
import { BandChart } from './BandChart'
import { TerminationSparkline } from './TerminationSparkline'
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
  const t = useT()
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
        title={disabled ? t('dist.export.staleTitle') : t('dist.export.title')}
        onClick={() => setOpen((v) => !v)}
      >
        {t('export.button')}
      </button>
      {open ? (
        <div className="menu__pop menu__pop--up" role="menu">
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('series.csv', toSeriesCsv(result), 'text/csv')}>
            <span className="menu__name">{t('dist.export.seriesCsv')}</span>
            <span className="menu__blurb">{t('dist.export.seriesCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('runs.csv', toFinalCsv(result), 'text/csv')}>
            <span className="menu__name">{t('dist.export.runsCsv')}</span>
            <span className="menu__blurb">{t('dist.export.runsCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('summary.csv', toFinalSummaryCsv(result), 'text/csv')}>
            <span className="menu__name">{t('dist.export.summaryCsv')}</span>
            <span className="menu__blurb">{t('dist.export.summaryCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => save('result.json', toMonteCarloJson(result), 'application/json')}>
            <span className="menu__name">JSON</span>
            <span className="menu__blurb">{t('dist.export.json.blurb')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function DistributionPanel() {
  const t = useT()
  const result = useMcStore((s) => s.result)
  const stale = useMcStore((s) => s.stale)
  if (!result) return null

  return (
    <div className="dist">
      <div className="dist__stats">
        <span className="dist__stat">
          <b>{result.completedRuns}</b> {t('dist.runs')}
        </span>
        <span className="dist__stat">
          <b>{result.config.steps}</b> {t('dist.steps')}
        </span>
        <span className="dist__stat">
          {t('dist.seed')} <b>{result.config.baseSeed}</b>
        </span>
        <span className="dist__stat">
          {t('dist.ended')} <b>{endedPct(result)}%</b>
        </span>
        {stale ? <span className="dist__stale">{t('dist.stale')}</span> : null}
        <span className="dist__spacer" />
        <ExportMenu result={result} disabled={stale} />
      </div>

      <TerminationSparkline result={result} />
      <BandChart result={result} />
    </div>
  )
}
