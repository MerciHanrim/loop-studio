import { useEffect, useMemo, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { PlayBar } from './PlayBar'

// A — chart discipline: the canvas token, carried down onto the time axis.
// Data line = resource-track weight; current value = the same solid Bead;
// only the latest point is marked. No area fill, no gradient. Pixel-space
// coordinates (measured) so beads stay round and mono text stays crisp.

const PAD = { l: 40, r: 20, t: 14, b: 20 }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const NICE = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]

/** smallest clean value ≥ v — round ticks without huge headroom */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = NICE.find((s) => n <= s + 1e-9) ?? 10
  return step * mag
}

export function TimelineChart() {
  const [collapsed, setCollapsed] = useState(false)
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 760, h: 116 })

  const series = useSimStore((s) => s.series)
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const arrivedPoolIds = useSimStore((s) => s.arrivedPoolIds)
  const nodes = useGraphStore((s) => s.nodes)

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
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
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed])

  const pools = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'pool')
        .map((n) => ({ id: n.id, label: n.data.label })),
    [nodes],
  )

  const view = useMemo(() => {
    const { w, h } = size
    let peak = 0
    let maxStep = 1
    for (const pt of series) {
      maxStep = Math.max(maxStep, pt.step)
      for (const p of pools) peak = Math.max(peak, pt.values[p.id] ?? 0)
    }
    const top = niceCeil(peak * 1.12)
    const iw = w - PAD.l - PAD.r
    const ih = h - PAD.t - PAD.b
    const x = (stp: number) => PAD.l + (maxStep === 0 ? 0 : (stp / maxStep) * iw)
    const y = (v: number) => PAD.t + ih - (v / top) * ih

    const lines = pools.map((p) => {
      const last = series.length ? series[series.length - 1].values[p.id] ?? 0 : 0
      let seg: { d: string; len: number } | null = null
      if (series.length >= 2) {
        const a = series[series.length - 2]
        const b = series[series.length - 1]
        const ax = x(a.step)
        const ay = y(a.values[p.id] ?? 0)
        const bx = x(b.step)
        const by = y(b.values[p.id] ?? 0)
        seg = {
          d: `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`,
          len: Math.max(1, Math.round(Math.hypot(bx - ax, by - ay))),
        }
      }
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
        seg,
      }
    })

    const guideX = status === 'paused' && maxStep > 0 ? x(stepIndex) : null
    return { w, h, top, maxStep, x, y, lines, guideX }
  }, [series, pools, status, stepIndex, size])

  const rm = reducedMotion()
  const { w, h } = view
  // before the first Step there is nothing to observe yet — axes only
  const hasRun = series.length >= 2

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

          <div className="timeline__plot" ref={plotRef}>
            <svg className="timeline__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
              <line
                className="timeline__axis"
                x1={PAD.l}
                y1={h - PAD.b}
                x2={w - PAD.r}
                y2={h - PAD.b}
              />
              <line className="timeline__axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={h - PAD.b} />

              {[0, view.top / 2, view.top].map((v) => (
                <g key={v}>
                  <line
                    className="timeline__grid"
                    x1={PAD.l}
                    x2={w - PAD.r}
                    y1={view.y(v)}
                    y2={view.y(v)}
                  />
                  <text
                    className="timeline__tick"
                    x={PAD.l - 6}
                    y={view.y(v) + 3.5}
                    textAnchor="end"
                  >
                    {fmt(v)}
                  </text>
                </g>
              ))}
              {hasRun ? (
                <text className="timeline__tick" x={w - PAD.r} y={h - 6} textAnchor="end">
                  step {view.maxStep}
                </text>
              ) : null}

              {view.guideX != null ? (
                <line
                  className="timeline__guide"
                  x1={view.guideX}
                  y1={PAD.t}
                  x2={view.guideX}
                  y2={h - PAD.b}
                />
              ) : null}

              {hasRun
                ? view.lines.map((l) => (
                    <path key={l.id} className="timeline__line" d={l.d} fill="none" />
                  ))
                : null}

              {hasRun && !rm
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

              {hasRun
                ? view.lines.map((l) => (
                    <g key={`b-${l.id}`}>
                      {arrivedPoolIds.includes(l.id) ? (
                        <circle
                          key={`ar-${stepIndex}`}
                          className="timeline__arrival"
                          cx={l.endX}
                          cy={l.endY}
                          r="7"
                        />
                      ) : null}
                      <circle className="timeline__bead" cx={l.endX} cy={l.endY} r="2.5" />
                      <text
                        className="timeline__endlabel"
                        x={l.endX - 5}
                        y={l.endY}
                        dy="-5"
                        textAnchor="end"
                      >
                        {fmt(l.last)}
                      </text>
                    </g>
                  ))
                : null}
            </svg>
          </div>
        </div>
      ) : null}
    </div>
  )
}
