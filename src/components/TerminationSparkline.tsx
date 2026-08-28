import { useEffect, useRef, useState } from 'react'
import type { MonteCarloResult } from '../engine'

// P2 — cumulative termination rate for the whole run set (not per Pool).
// X = step, Y = runs ended at-or-before that step / completedRuns. Same Track
// grammar as the band chart's p50: one solid 1.5px line + a Bead at the last
// point. No area fill, no gradient. If nothing ended, an empty axis + a note.

const PAD = { l: 26, r: 16, t: 6, b: 14 }

type Size = { w: number; h: number }

export type TermChart = {
  anyEnded: boolean
  finalRate: number
  /** cumulative ended / completedRuns at each step (monotone non-decreasing) */
  rates: number[]
  /** polyline through every step, or '' when nothing ended */
  linePath: string
  beadX: number
  beadY: number
}

/** Pure geometry — cumulative ended / completedRuns mapped into the plot box. */
export function buildTermChart(
  r: Pick<MonteCarloResult, 'endedRuns' | 'completedRuns'>,
  size: Size,
): TermChart {
  const cum = r.endedRuns.atOrBeforeStep
  const denom = r.completedRuns || 1
  const lastStep = Math.max(1, cum.length - 1)
  const rates = cum.map((c) => c / denom)
  const finalRate = rates.length ? rates[rates.length - 1] : 0
  const anyEnded = finalRate > 0

  const iw = size.w - PAD.l - PAD.r
  const ih = size.h - PAD.t - PAD.b
  const x = (s: number) => PAD.l + (s / lastStep) * iw
  const y = (rate: number) => PAD.t + ih - rate * ih // rate 0..1, 1 at top

  const linePath = anyEnded
    ? rates.map((rate, s) => `${s === 0 ? 'M' : 'L'} ${x(s).toFixed(1)} ${y(rate).toFixed(1)}`).join(' ')
    : ''

  // At 0% there is no line and no Bead — only the "No runs ended" note. NaN
  // coordinates keep that true even if a caller renders the circle unguarded.
  return {
    anyEnded,
    finalRate,
    rates,
    linePath,
    beadX: anyEnded ? x(lastStep) : NaN,
    beadY: anyEnded ? y(finalRate) : NaN,
  }
}

export function TerminationSparkline({ result }: { result: MonteCarloResult }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 720, h: 34 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) => {
          const w = Math.round(rect.width)
          const h = Math.round(rect.height)
          return prev.w === w && prev.h === h ? prev : { w, h }
        })
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const steps = result.config.steps
  const chart = buildTermChart(result, size)
  const { w, h } = size
  const pct = Math.round(chart.finalRate * 100)

  return (
    <div className="term">
      <div className="term__cap">
        <span>termination</span>
        <span className="term__pct">
          <b>{pct}%</b> ended
        </span>
      </div>
      <div className="term__plot" ref={wrapRef}>
        <svg className="term__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          {/* Y: 0 at the axis, 100% hairline at the top */}
          <line className="term__axis" x1={PAD.l} y1={h - PAD.b} x2={w - PAD.r} y2={h - PAD.b} />
          <line className="term__axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={h - PAD.b} />
          <line className="term__grid" x1={PAD.l} x2={w - PAD.r} y1={PAD.t} y2={PAD.t} />
          <text className="term__tick" x={PAD.l - 5} y={h - PAD.b + 3} textAnchor="end">
            0
          </text>
          <text className="term__tick" x={PAD.l - 5} y={PAD.t + 6} textAnchor="end">
            100%
          </text>
          <text className="term__tick" x={w - PAD.r} y={h - 3} textAnchor="end">
            step {steps}
          </text>

          {chart.anyEnded ? (
            <>
              <path className="term__line" d={chart.linePath} fill="none" />
              <circle className="term__bead" cx={chart.beadX} cy={chart.beadY} r="2.6" />
            </>
          ) : (
            <text className="term__empty" x={(PAD.l + w - PAD.r) / 2} y={(PAD.t + h - PAD.b) / 2 + 3} textAnchor="middle">
              No runs ended
            </text>
          )}
        </svg>
      </div>
    </div>
  )
}
