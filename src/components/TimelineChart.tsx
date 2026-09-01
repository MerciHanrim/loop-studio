import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRegisterValue, registerSeriesRuns, registersOfSnapshot } from '../model/model'
import { useGraphStore } from '../store/graphStore'
import { currentRegisterOutcomes } from '../store/registers'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { selectOverlay, useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { useT } from '../i18n'
import { DistributionPanel } from './DistributionPanel'
import { PlayBar } from './PlayBar'

// A — chart discipline: the canvas token, carried down onto the time axis.
// Data line = resource-track weight; current value = the same solid Bead;
// only the latest point is marked. No area fill, no gradient.

const PAD = { l: 40, r: 20, t: 14, b: 20 }
// stable per-pool colour by index — reuses the approved node hues
const HUES = [
  '--hue-pool',
  '--hue-gate',
  '--hue-converter',
  '--hue-drain',
  '--hue-source',
  '--hue-end',
]
const colorFor = (i: number) => `var(${HUES[i % HUES.length]})`

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const NICE = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = NICE.find((s) => n <= s + 1e-9) ?? 10
  return step * mag
}

function downloadCsv(pools: { id: string; label: string }[], series: { step: number; values: Record<string, number> }[]) {
  const head = ['step', ...pools.map((p) => p.label.replace(/[",\n]/g, ' '))].join(',')
  const rows = series.map((pt) =>
    [pt.step, ...pools.map((p) => pt.values[p.id] ?? 0)].join(','),
  )
  const blob = new Blob([[head, ...rows].join('\n') + '\n'], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'loop-studio-run.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function TimelineChart() {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 760, h: 116 })
  const isMobile = useIsMobile()
  const overlay = useUiStore(selectOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)

  const series = useSimStore((s) => s.series)
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const arrivedPoolIds = useSimStore((s) => s.arrivedPoolIds)
  const trackedIds = useSimStore((s) => s.trackedIds)
  const toggleTracked = useSimStore((s) => s.toggleTracked)
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
  }, [collapsed, isMobile, overlay])

  const pools = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'pool')
        .map((n, i) => ({ id: n.id, label: n.data.label, color: colorFor(i) })),
    [nodes],
  )
  const allPoolIds = useMemo(() => pools.map((p) => p.id), [pools])
  // if an explicit list no longer matches any current pool (pools deleted /
  // graph swapped), fall back to tracking everything
  const listMatches =
    Array.isArray(trackedIds) && trackedIds.some((id) => allPoolIds.includes(id))
  const isTracked = (id: string) =>
    trackedIds === 'all' || !listMatches || (trackedIds as string[]).includes(id)
  const tracked = pools.filter((p) => isTracked(p.id))

  // loop-model/1 §M3.5 — R(t) per committed snapshot for each Register.
  // Nothing stored: recomputed from `series[i].values` + the live graph.
  const registers = useMemo(
    () => nodes.filter((n) => n.data.kind === 'register').map((n, i) => ({ id: n.id, label: n.data.label, color: colorFor(pools.length + i) })),
    [nodes, pools.length],
  )
  // one `registersOfSnapshot` per UNIQUE historical snapshot (§M3.5). The live
  // "current step" read reuses the shared `currentRegisterOutcomes` cache so
  // the Canvas / Inspector / this legend never re-evaluate it.
  const regByStep = useMemo(() => {
    if (registers.length === 0) return []
    return series.map((pt) => ({ step: pt.step, outcomes: registersOfSnapshot(nodes, pt.values) }))
  }, [series, nodes, registers.length])
  const currentOutcomes = currentRegisterOutcomes(nodes, useSimStore((s) => s.values))

  const view = useMemo(() => {
    const { w, h } = size
    let peak = 0
    let maxStep = 1
    for (const pt of series) {
      maxStep = Math.max(maxStep, pt.step)
      for (const p of tracked) peak = Math.max(peak, pt.values[p.id] ?? 0)
    }
    // Rolling X domain: the series holds only the last MAX_SERIES steps, so the
    // axis runs from the EARLIEST retained step, not from 0 — otherwise a
    // trimmed run draws starting a fraction of the way in and appears to shrink
    // toward the right as more of the head is dropped. Internal `pt.step`
    // numbers are untouched; only the mapping to pixels changes.
    const minStep = series.length ? series[0].step : 0
    const domainSpan = Math.max(1, maxStep - minStep)
    const top = niceCeil(peak * 1.12)
    const iw = w - PAD.l - PAD.r
    const ih = h - PAD.t - PAD.b
    const x = (stp: number) => PAD.l + ((stp - minStep) / domainSpan) * iw
    const y = (v: number) => PAD.t + ih - (v / top) * ih

    // Register lines use an independent min/max range (values may be negative)
    // and BREAK into separate subpaths at any step where R(t) is invalid — a
    // gap, never bridged (§M6.2). Run-splitting is `registerSeriesRuns`.
    const runsById = new Map(registers.map((r) => [r.id, registerSeriesRuns(regByStep, r.id)]))
    let rlo = Infinity
    let rhi = -Infinity
    for (const runs of runsById.values()) {
      for (const run of runs) {
        for (const p of run) {
          rlo = Math.min(rlo, p.value)
          rhi = Math.max(rhi, p.value)
        }
      }
    }
    const haveReg = Number.isFinite(rlo) && Number.isFinite(rhi)
    const span = haveReg ? rhi - rlo || 1 : 1
    const ry = (v: number) => PAD.t + ih - ((v - rlo) / span) * ih
    const regLines = registers.map((r) => {
      const runs = runsById.get(r.id) ?? []
      const d = runs
        .map((run) =>
          run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.step).toFixed(1)} ${ry(p.value).toFixed(1)}`).join(' '),
        )
        .join(' ')
      const lastRun = runs.length ? runs[runs.length - 1] : null
      const lastValid = lastRun ? lastRun[lastRun.length - 1] : null
      return {
        id: r.id,
        color: r.color,
        d,
        runCount: runs.length,
        lastValid,
        endX: lastValid ? x(lastValid.step) : 0,
        endY: lastValid ? ry(lastValid.value) : 0,
      }
    })

    const lines = tracked.map((p) => {
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
        color: p.color,
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

    // ── endpoint value labels — every dot stays at its real (endX, endY); only
    // the LABELS are laid out to avoid collision. Deterministic: candidates
    // sorted by (y, id); a relaxation pulls each back toward its own dot so an
    // uncrowded label (a lone high value) keeps its exact spot with no leader,
    // and only the crowded ones move. When the band cannot hold every label at
    // the min gap the extras collapse into a "+N" chip (legend order wins — the
    // legend already lists every series and its value). ──────────────────────
    const LABEL_GAP = 16 // ≈ .timeline__endlabel rendered box (~14px) + breathing
    const labelLo = PAD.t + 2
    const labelHi = h - PAD.b
    const bandFit = Math.max(1, Math.floor((labelHi - labelLo) / LABEL_GAP) + 1)

    let endLabels = lines
      .map((l, rank) => ({ id: l.id, color: l.color, x: l.endX, dotY: l.endY, text: fmt(l.last), labelY: l.endY, rank }))
      .sort((a, b) => a.dotY - b.dotY || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    let endMore: { count: number; x: number; y: number } | null = null
    const total = endLabels.length
    if (total > bandFit) {
      const keep = Math.max(1, bandFit - 1) // reserve one slot for the chip
      const kept = new Set([...endLabels].sort((a, b) => a.rank - b.rank).slice(0, keep).map((e) => e.id))
      endMore = { count: total - kept.size, x: endLabels[0].x, y: labelHi }
      endLabels = endLabels.filter((e) => kept.has(e.id))
    }

    const n = endLabels.length
    const allDotY = endLabels.map((e) => e.dotY)
    if (n > 0) {
      // A: top-down min-gap. B: bottom-up min-gap + bottom bound (a label with
      // slack drifts back toward its dot). C: top-down again for the top bound.
      const bottom = endMore ? labelHi - LABEL_GAP : labelHi
      for (let i = 1; i < n; i++) {
        endLabels[i].labelY = Math.max(endLabels[i].labelY, endLabels[i - 1].labelY + LABEL_GAP)
      }
      endLabels[n - 1].labelY = Math.min(endLabels[n - 1].labelY, bottom)
      for (let i = n - 2; i >= 0; i--) {
        endLabels[i].labelY = Math.min(endLabels[i].labelY, endLabels[i + 1].labelY - LABEL_GAP)
      }
      endLabels[0].labelY = Math.max(endLabels[0].labelY, labelLo)
      for (let i = 1; i < n; i++) {
        endLabels[i].labelY = Math.max(endLabels[i].labelY, endLabels[i - 1].labelY + LABEL_GAP)
      }
    }
    // a label carries a leader when it was moved OR when its dot shares space
    // with another series' dot (so the label alone can't say which dot it names)
    const endLabelsOut = endLabels.map((e, i) => {
      const nearestOther = Math.min(
        Infinity,
        ...allDotY.filter((_, j) => j !== i).map((dy) => Math.abs(dy - e.dotY)),
      )
      return { ...e, leader: Math.abs(e.labelY - e.dotY) > 3 || nearestOther < LABEL_GAP }
    })

    const guideX = status === 'paused' && maxStep > 0 ? x(stepIndex) : null
    return { w, h, top, minStep, maxStep, x, y, lines, regLines, guideX, endLabels: endLabelsOut, endMore }
  }, [series, tracked, registers, regByStep, status, stepIndex, size])

  const rm = reducedMotion()
  const { w, h } = view
  const hasRun = series.length >= 2

  const mcResult = useMcStore((s) => s.result)
  const mcView = useMcStore((s) => s.view)
  const setMcView = useMcStore((s) => s.setView)
  const showDistribution = mcResult != null && mcView === 'distribution'

  const panel = (
        <div className="timeline__panel">
          <div className="timeline__head">
            {mcResult != null ? (
              <span className="timeline__viewswitch" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!showDistribution}
                  className={`timeline__viewtab${!showDistribution ? ' is-on' : ''}`}
                  onClick={() => setMcView('live')}
                >
                  {t('timeline.view.live')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={showDistribution}
                  className={`timeline__viewtab${showDistribution ? ' is-on' : ''}`}
                  onClick={() => setMcView('distribution')}
                >
                  {t('timeline.view.distribution')}
                </button>
              </span>
            ) : (
              <span>{t('timeline.title')}</span>
            )}
            <span className="timeline__legend" hidden={showDistribution}>
              {pools.map((p) => {
                const on = isTracked(p.id)
                const last = series.length ? series[series.length - 1].values[p.id] ?? 0 : 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`timeline__key${on ? '' : ' is-off'}`}
                    onClick={() => toggleTracked(p.id, allPoolIds)}
                    title={on ? t('timeline.legend.hide', { label: p.label }) : t('timeline.legend.show', { label: p.label })}
                  >
                    <span className="timeline__mark" style={{ background: p.color }} />
                    {p.label} {fmt(last)}
                  </button>
                )
              })}
              {registers.map((r) => {
                const cur = currentOutcomes.get(r.id)
                return (
                  <span key={r.id} className="timeline__key timeline__key--register" title={t('timeline.legend.register', { label: r.label })}>
                    <span className="timeline__mark" style={{ background: r.color }} />
                    {r.label}{' '}
                    {cur && !cur.invalid ? formatRegisterValue(cur.value) : cur ? '—' : '·'}
                  </span>
                )
              })}
              <button
                type="button"
                className="timeline__csv"
                disabled={!hasRun}
                onClick={() => downloadCsv(pools, series)}
                title={t('timeline.csvTitle')}
              >
                {t('timeline.csv')}
              </button>
            </span>
          </div>

          {showDistribution ? <DistributionPanel /> : null}

          <div className="timeline__plot" ref={plotRef} hidden={showDistribution}>
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
                <>
                  {view.minStep > 0 ? (
                    <text className="timeline__tick" x={PAD.l} y={h - 6} textAnchor="start">
                      {t('timeline.axis.step', { n: view.minStep })}
                    </text>
                  ) : null}
                  <text className="timeline__tick" x={w - PAD.r} y={h - 6} textAnchor="end">
                    {t('timeline.axis.step', { n: view.maxStep })}
                  </text>
                </>
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
                    <path
                      key={l.id}
                      className="timeline__line"
                      d={l.d}
                      fill="none"
                      style={{ stroke: l.color }}
                    />
                  ))
                : null}

              {/* loop-model/1 §M3.5 — Register series, dashed, with gaps where
                  R(t) is invalid (never bridged, §M6.2). */}
              {hasRun
                ? view.regLines.map((l) =>
                    l.d ? (
                      <path
                        key={`reg-${l.id}`}
                        className="timeline__line timeline__line--register"
                        d={l.d}
                        fill="none"
                        style={{ stroke: l.color, strokeDasharray: '4 3', opacity: 0.85 }}
                      />
                    ) : null,
                  )
                : null}

              {hasRun && !rm
                ? view.lines.map((l) =>
                    l.seg ? (
                      <path
                        key={`${l.id}-${view.maxStep}`}
                        className="timeline__seg"
                        d={l.seg.d}
                        style={{
                          stroke: l.color,
                          strokeDasharray: l.seg.len,
                          strokeDashoffset: l.seg.len,
                        }}
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
                      <circle
                        className="timeline__bead"
                        cx={l.endX}
                        cy={l.endY}
                        r="2.5"
                        style={{ fill: l.color }}
                      />
                    </g>
                  ))
                : null}

              {/* endpoint value labels — collision-avoided. Every label is
                  vertically centred on its own `labelY` (consistent box, so a
                  fixed LABEL_GAP guarantees no overlap); a displaced one gets a
                  leader back to its real dot and shifts left to clear it. */}
              {hasRun
                ? view.endLabels.map((e) => (
                    <g key={`el-${e.id}`}>
                      {e.leader ? (
                        <polyline
                          className="timeline__lead"
                          points={`${e.x},${e.dotY} ${e.x - 4},${e.dotY} ${e.x - 8},${e.labelY} ${e.x - 12},${e.labelY}`}
                          style={{ stroke: e.color }}
                        />
                      ) : null}
                      <text
                        className="timeline__endlabel"
                        data-series={e.id}
                        x={e.x - (e.leader ? 14 : 6)}
                        y={e.labelY}
                        dy="0.32em"
                        textAnchor="end"
                      >
                        {e.text}
                      </text>
                    </g>
                  ))
                : null}
              {hasRun && view.endMore ? (
                <text
                  className="timeline__endlabel timeline__endlabel--more"
                  data-series="__more__"
                  x={view.endMore.x - 6}
                  y={view.endMore.y}
                  dy="0.32em"
                  textAnchor="end"
                >
                  +{view.endMore.count}
                </text>
              ) : null}
            </svg>
          </div>
        </div>
  )

  // docs/mobile.md §MV5 / §MV-D8 — on mobile the Timeline is a collapsible
  // bottom sheet, above the fixed run bar, shown only while it is the open
  // overlay. The run controls live in <MobileRunBar>, not here.
  if (isMobile) {
    if (overlay !== 'timeline') return null
    return (
      <div className="timeline timeline--sheet" role="dialog" aria-label={t('timeline.sheetTitle')}>
        <div className="sheet__head">
          <span className="sheet__title">{t('timeline.sheetTitle')}</span>
          <button
            type="button"
            className="sheet__x"
            aria-label={t('dialog.close')}
            onClick={() => closeOverlay('timeline')}
          >
            ✕
          </button>
        </div>
        {panel}
      </div>
    )
  }

  return (
    <div className={`timeline${collapsed ? ' is-collapsed' : ''}`} data-tour="timeline">
      <PlayBar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      {!collapsed ? panel : null}
    </div>
  )
}
