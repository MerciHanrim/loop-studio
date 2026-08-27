import { useMemo, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { PlayBar } from './PlayBar'

// A — chart discipline: data never pressed against the frame, a clean 3-tick
// axis, and only the newest segment animates in. Colour/typography come with
// the theme pass.

const VW = 800
const VH = 132
const PAD = { l: 38, r: 18, t: 14, b: 20 }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const NICE = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]

/** smallest clean value ≥ v — keeps axis ticks round without huge headroom */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = NICE.find((s) => n <= s + 1e-9) ?? 10
  return step * mag
}

export function TimelineChart() {
  const [collapsed, setCollapsed] = useState(false)
  const series = useSimStore((s) => s.series)
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const nodes = useGraphStore((s) => s.nodes)

  const pools = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'pool')
        .map((n) => ({ id: n.id, label: n.data.label })),
    [nodes],
  )

  const view = useMemo(() => {
    let peak = 0
    let maxStep = 1
    for (const pt of series) {
      maxStep = Math.max(maxStep, pt.step)
      for (const p of pools) peak = Math.max(peak, pt.values[p.id] ?? 0)
    }
    const top = niceCeil(peak * 1.12) // 12% headroom above the real max
    const iw = VW - PAD.l - PAD.r
    const ih = VH - PAD.t - PAD.b
    const x = (stp: number) => PAD.l + (maxStep === 0 ? 0 : (stp / maxStep) * iw)
    const y = (v: number) => PAD.t + ih - (v / top) * ih

    const lines = pools.map((p) => {
      const last = series.length ? series[series.length - 1].values[p.id] ?? 0 : 0
      return {
        id: p.id,
        label: p.label,
        last,
        d: series
          .map(
            (pt, i) =>
              `${i === 0 ? 'M' : 'L'} ${x(pt.step).toFixed(1)} ${y(pt.values[p.id] ?? 0).toFixed(1)}`,
          )
          .join(' '),
        endX: x(maxStep),
        endY: y(last),
        seg:
          series.length >= 2
            ? (() => {
                const a = series[series.length - 2]
                const b = series[series.length - 1]
                const ax = x(a.step)
                const ay = y(a.values[p.id] ?? 0)
                const bx = x(b.step)
                const by = y(b.values[p.id] ?? 0)
                return {
                  d: `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`,
                  len: Math.round(Math.hypot(bx - ax, by - ay)) || 1,
                }
              })()
            : null,
      }
    })

    const guideX =
      status === 'paused' && maxStep > 0 ? x(stepIndex) : null

    return { top, maxStep, x, y, lines, guideX }
  }, [series, pools, status, stepIndex])

  const rm = reducedMotion()

  return (
    <div className={`timeline${collapsed ? ' is-collapsed' : ''}`}>
      <PlayBar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />

      {!collapsed ? (
        <div className="timeline__panel">
          <div className="timeline__head">
            <span>timeline</span>
            <span className="timeline__legend">
              {view.lines.map((l) => (
                <span key={l.id} className="timeline__key">
                  <span className="timeline__mark" />
                  {l.label} {fmt(l.last)}
                </span>
              ))}
            </span>
          </div>
          <svg className="timeline__svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            {/* axes */}
            <line
              className="timeline__axis"
              x1={PAD.l}
              y1={VH - PAD.b}
              x2={VW - PAD.r}
              y2={VH - PAD.b}
            />
            <line className="timeline__axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={VH - PAD.b} />

            {/* 3 y ticks: 0 / mid / top */}
            {[0, view.top / 2, view.top].map((v) => (
              <g key={v}>
                <line
                  className="timeline__grid"
                  x1={PAD.l}
                  x2={VW - PAD.r}
                  y1={view.y(v)}
                  y2={view.y(v)}
                />
                <text className="timeline__tick" x={PAD.l - 6} y={view.y(v) + 3} textAnchor="end">
                  {fmt(v)}
                </text>
              </g>
            ))}
            <text className="timeline__tick" x={VW - PAD.r} y={VH - 6} textAnchor="end">
              step {view.maxStep}
            </text>

            {view.guideX != null ? (
              <line
                className="timeline__guide"
                x1={view.guideX}
                y1={PAD.t}
                x2={view.guideX}
                y2={VH - PAD.b}
              />
            ) : null}

            {view.lines.map((l) => (
              <path key={l.id} className="timeline__line" d={l.d} fill="none" />
            ))}

            {/* newest segment eases in on each step */}
            {!rm
              ? view.lines.map((l) =>
                  l.seg ? (
                    <path
                      key={`${l.id}-${view.maxStep}`}
                      className="timeline__seg"
                      d={l.seg.d}
                      style={{ strokeDasharray: l.seg.len, strokeDashoffset: l.seg.len }}
                    />
                  ) : null,
                )
              : null}

            {series.length
              ? view.lines.map((l) => (
                  <text
                    key={`e-${l.id}`}
                    className="timeline__endlabel"
                    x={l.endX}
                    y={l.endY}
                    dy="-4"
                    textAnchor="end"
                  >
                    {fmt(l.last)}
                  </text>
                ))
              : null}
          </svg>
        </div>
      ) : null}
    </div>
  )
}
