import { useEffect, useMemo, useRef, useState } from 'react'
import type { MonteCarloResult } from '../engine'

// P2 band chart — one Pool. Low-opacity p10–p90 area (data, not decoration),
// a 1.5px p50 Track, a Bead at the last point, and an optional 4-4 dashed mean.
// No gradient, no thick p10/p90 outline, no per-Pool overlay. Termination is a
// header number, not shading here.

const PAD = { l: 40, r: 16, t: 12, b: 20 }
const HUES = ['--hue-pool', '--hue-gate', '--hue-converter', '--hue-drain', '--hue-source', '--hue-end']
const hueVar = (i: number) => `var(${HUES[i % HUES.length]})`

const NICE = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  return (NICE.find((s) => n <= s + 1e-9) ?? 10) * mag
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function BandChart({ result }: { result: MonteCarloResult }) {
  const pools = result.pools
  const [poolId, setPoolId] = useState(pools[0]?.id ?? '')
  const [showMean, setShowMean] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 720, h: 118 })

  useEffect(() => {
    if (!pools.some((p) => p.id === poolId)) setPoolId(pools[0]?.id ?? '')
  }, [pools, poolId])

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

  const view = useMemo(() => {
    const { w, h } = size
    const iw = w - PAD.l - PAD.r
    const ih = h - PAD.t - PAD.b
    if (!band) return null
    let peak = 0
    for (const v of band.p90) peak = Math.max(peak, v)
    const top = niceCeil(peak * 1.1) || 1
    const x = (s: number) => PAD.l + (steps === 0 ? 0 : (s / steps) * iw)
    const y = (v: number) => PAD.t + ih - (v / top) * ih

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
      x,
      y,
      area,
      p50: line(band.p50),
      mean: line(band.mean),
      beadX: x(lastS),
      beadY: y(band.p50[lastS] ?? 0),
      lastP50: band.p50[lastS] ?? 0,
    }
  }, [band, size, steps])

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
            aria-label="Pool"
          >
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="band__pool band__pool--single">{pools[0]?.label}</span>
        )}
        <span className="band__key" style={{ color: hue }}>
          <span className="band__swatch" style={{ background: hue }} /> p10–p90 · p50{' '}
          <b>{fmt(view.lastP50)}</b>
        </span>
        <button
          type="button"
          className={`band__mean${showMean ? ' is-on' : ''}`}
          onClick={() => setShowMean((v) => !v)}
          aria-pressed={showMean}
        >
          mean
        </button>
      </div>

      <div className="band__plot" ref={wrapRef}>
        <svg className="band__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          <line className="band__axis" x1={PAD.l} y1={h - PAD.b} x2={w - PAD.r} y2={h - PAD.b} />
          <line className="band__axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={h - PAD.b} />
          {[0, view.top / 2, view.top].map((v) => (
            <g key={v}>
              <line className="band__grid" x1={PAD.l} x2={w - PAD.r} y1={view.y(v)} y2={view.y(v)} />
              <text className="band__tick" x={PAD.l - 6} y={view.y(v) + 3.5} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          <text className="band__tick" x={w - PAD.r} y={h - 6} textAnchor="end">
            step {steps}
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
