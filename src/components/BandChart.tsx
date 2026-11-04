import { useEffect, useMemo, useRef, useState } from 'react'
import type { MonteCarloResult } from '../engine'
import { axisMark, axisPad, axisUnit, chartNumber, compactText, shownNumber, viewIsOn } from '../model/viewUnits'
import { useMcStore } from '../store/mcStore'
import { usePoolViews } from '../store/viewUnitsStore'
import { useT } from '../i18n'

// P2 band chart — one Pool. Low-opacity p10–p90 area (data, not decoration),
// a 1.5px p50 Track, a Bead at the last point, and an optional 4-4 dashed mean.
// No gradient, no thick p10/p90 outline, no per-Pool overlay. Termination is a
// header number, not shading here.

const PAD = { l: 40, r: 16, t: 12, b: 20 }
// the run chart's series tokens (index.css `--series-*`, 2026-10-21: their own,
// at the kind hues' values and order they used to read)
const HUES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6']
const hueVar = (i: number) => `var(${HUES[i % HUES.length]})`

const NICE = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  return (NICE.find((s) => n <= s + 1e-9) ?? 10) * mag
}

export function BandChart({ result }: { result: MonteCarloResult }) {
  const t = useT()
  const pools = result.pools
  // selection lives in the store so a Workspace file can save / restore it
  const storedPoolId = useMcStore((s) => s.distributionPoolId)
  const setPoolId = useMcStore((s) => s.setDistributionPoolId)
  const showMean = useMcStore((s) => s.showMean)
  const setShowMean = useMcStore((s) => s.setShowMean)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 720, h: 118 })

  const poolId = storedPoolId && pools.some((p) => p.id === storedPoolId) ? storedPoolId : (pools[0]?.id ?? '')

  useEffect(() => {
    if (storedPoolId == null || !pools.some((p) => p.id === storedPoolId)) {
      setPoolId(pools[0]?.id ?? null)
    }
  }, [pools, storedPoolId, setPoolId])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setSize((prev) => {
          const w = Math.round(r.width)
          const h = Math.round(r.height)
          return prev.w === w && prev.h === h ? prev : { w, h }
        })
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const poolIndex = Math.max(0, pools.findIndex((p) => p.id === poolId))
  const band = result.series[poolId]
  const steps = result.config.steps
  // SEMANTICS-M4.md §M4-8 — the same view unit as the live chart. The chart draws
  // one Pool, so its axis always has one unit. The result itself is untouched.
  const poolView = usePoolViews().get(poolId)

  const view = useMemo(() => {
    const { w, h } = size
    const ids = [poolId]
    const views = new Map(poolView ? [[poolId, poolView]] : [])
    if (!band) return null
    let peak = 0
    for (const v of band.p90) peak = Math.max(peak, shownNumber(v, poolView))
    const top = niceCeil(peak * 1.1) || 1
    const on = viewIsOn(ids, views)
    const mark = on ? axisMark : chartNumber
    const padL = on ? axisPad([mark(top), mark(top / 2)], PAD.l) : PAD.l
    const iw = w - padL - PAD.r
    const ih = h - PAD.t - PAD.b
    const x = (s: number) => padL + (steps === 0 ? 0 : (s / steps) * iw)
    const y = (raw: number) => PAD.t + ih - (shownNumber(raw, poolView) / top) * ih
    const yMark = (v: number) => PAD.t + ih - (v / top) * ih

    const line = (arr: number[]) =>
      arr.map((v, s) => `${s === 0 ? 'M' : 'L'} ${x(s).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    const area =
      band.p10.map((v, s) => `${s === 0 ? 'M' : 'L'} ${x(s).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') +
      ' ' +
      [...band.p90]
        .map((v, s) => ({ v, s }))
        .reverse()
        .map(({ v, s }) => `L ${x(s).toFixed(1)} ${y(v).toFixed(1)}`)
        .join(' ') +
      ' Z'

    const lastS = band.p50.length - 1
    return {
      w,
      h,
      top,
      padL,
      mark,
      yMark,
      unit: axisUnit(ids, views),
      x,
      y,
      area,
      p50: line(band.p50),
      mean: line(band.mean),
      beadX: x(lastS),
      beadY: y(band.p50[lastS] ?? 0),
      lastP50: band.p50[lastS] ?? 0,
    }
  }, [band, size, steps, poolId, poolView])

  if (!band || !view) return null
  const hue = hueVar(poolIndex)
  const { w, h } = view

  return (
    <div className="band" style={{ '--band-hue': hue } as React.CSSProperties}>
      <div className="band__ctrls">
        {pools.length > 1 ? (
          <select
            className="band__pool"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            aria-label={t('band.pool')}
          >
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="band__pool band__pool--single" dir="auto">{pools[0]?.label}</span>
        )}
        <span className="band__key" style={{ color: hue }}>
          <span className="band__swatch" style={{ background: hue }} /> p10–p90 · p50{' '}
          <b dir="ltr">{compactText(view.lastP50, poolView)}</b>
        </span>
        <button
          type="button"
          className={`band__mean${showMean ? ' is-on' : ''}`}
          onClick={() => setShowMean(!showMean)}
          aria-pressed={showMean}
        >
          {t('band.mean')}
        </button>
      </div>

      <div className="band__plot" ref={wrapRef}>
        <svg className="band__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          <line className="band__axis" x1={view.padL} y1={h - PAD.b} x2={w - PAD.r} y2={h - PAD.b} />
          <line className="band__axis" x1={view.padL} y1={PAD.t} x2={view.padL} y2={h - PAD.b} />
          {[0, view.top / 2, view.top].map((v) => (
            <g key={v}>
              <line className="band__grid" x1={view.padL} x2={w - PAD.r} y1={view.yMark(v)} y2={view.yMark(v)} />
              <text className="band__tick" x={view.padL - 6} y={view.yMark(v) + 3.5} textAnchor="end" direction="ltr">
                {view.mark(v)}
              </text>
            </g>
          ))}
          {view.unit.kind === 'one' ? (
            <text className="band__tick band__tick--unit" x={view.padL + 4} y={10} textAnchor="start" direction="ltr">
              {view.unit.unit}
            </text>
          ) : null}
          <text className="band__tick" x={w - PAD.r} y={h - 6} textAnchor="end">
            {t('timeline.axis.step', { n: steps })}
          </text>

          <path className="band__area" d={view.area} />
          {showMean ? <path className="band__meanline" d={view.mean} fill="none" /> : null}
          <path className="band__p50" d={view.p50} fill="none" />
          <circle className="band__bead" cx={view.beadX} cy={view.beadY} r="2.6" />
        </svg>
      </div>
    </div>
  )
}
