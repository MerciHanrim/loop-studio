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
import { downloadCsv, downloadText } from '../ui/download'

// P2 distribution view — occupies the timeline area when a Monte-Carlo result
// exists and the LIVE / DISTRIBUTION switch is on DISTRIBUTION.
// Checkpoint 1: header stats + one Export menu. The p10/p50/p90 band chart next.

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

  const saveCsv = (suffix: string, text: string) => {
    downloadCsv(text, `loop-studio-montecarlo-${suffix}`)
    setOpen(false)
  }
  const saveJson = (suffix: string, text: string) => {
    downloadText(text, `loop-studio-montecarlo-${suffix}`)
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
          <button type="button" className="menu__item" role="menuitem" onClick={() => saveCsv('series.csv', toSeriesCsv(result))}>
            <span className="menu__name">{t('dist.export.seriesCsv')}</span>
            <span className="menu__blurb">{t('dist.export.seriesCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => saveCsv('runs.csv', toFinalCsv(result))}>
            <span className="menu__name">{t('dist.export.runsCsv')}</span>
            <span className="menu__blurb">{t('dist.export.runsCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => saveCsv('summary.csv', toFinalSummaryCsv(result))}>
            <span className="menu__name">{t('dist.export.summaryCsv')}</span>
            <span className="menu__blurb">{t('dist.export.summaryCsv.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => saveJson('result.json', toMonteCarloJson(result))}>
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
