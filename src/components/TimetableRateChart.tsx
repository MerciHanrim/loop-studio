import { useMemo, useState } from 'react'
import type { TimetableLineReport } from '../engine/types'
import { useT } from '../i18n'
import { isolateAuto, isolateLtr } from '../i18n/bidiIsolate'
import { resolveKinds } from '../model/kinds'
import { hasTableMeaning } from '../model/modelVersion'
import { exactDouble, plainDecimal, toDouble, toSignificant15 } from '../model/rational'
import { ruleTables } from '../model/runRule'
import { amountAsRate, meaningOf, timetableLines, timetablePolyline, timetableRateAt, timetableRateFactor, type Timetable } from '../model/timetable'
import { stepSeconds, TIME_UNIT_SECONDS } from '../model/units'
import { useGraphStore } from '../store/graphStore'

// SEMANTICS-M5.md §M5-11 — a table's rate on its own chart under the tanks. A rate
// and a stock are different quantities, so they never share an axis: each table
// has a strip of its own, with its own unit, on the same step scale as the chart
// above it. It draws the table itself, not the run: hold reads as stairs, linear
// as straight stretches, and past the end of a `stop` table there is no line.
//
// SEMANTICS-M7.md §M7-3 — a table of what a line CAN move draws the table dashed, and
// what each line reading it moved, step by step, solid, as the run strips draw target
// and run: moving less than is available is normal, so the gap is the reading, not a
// warning. A plan table's strip is as it was.

export const RATE_STRIP_H = 56
const PAD_TOP = 14
const PAD_BOTTOM = 4

function niceTop(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s + 1e-9) ?? 10) * mag
}

const shown = (x: number) => plainDecimal(toSignificant15(x))

/** the tables the document's lines and rules read */
export function useReadTables(): Timetable[] {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const timetables = useGraphStore((s) => s.timetables)
  return useMemo(() => {
    const read = new Set([...timetableLines(edges).map((l) => l.tableId), ...ruleTables(nodes)])
    return timetables.filter((t) => read.has(t.id))
  }, [nodes, edges, timetables])
}

type Series = readonly { step: number; timetableLines?: readonly TimetableLineReport[] }[]

/** for an `available` table: each line reading it, as the table's rate it moved per step */
function useMovedRates(table: Timetable, series: Series): { edgeId: string; rates: { step: number; rate: number }[] }[] | null {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  return useMemo(() => {
    if (!hasTableMeaning(modelVersion) || meaningOf(table) !== 'available' || time === undefined) return null
    const edgeKind = resolveKinds(nodes, edges).edgeKind
    return timetableLines(edges)
      .filter((l) => l.tableId === table.id)
      .map(({ edge }) => {
        const factor = timetableRateFactor(table, kinds.find((k) => k.name === edgeKind.get(edge.id)), time)
        const rates = factor === null ? [] : series.flatMap((p) => {
          const hit = p.timetableLines?.find((x) => x.edgeId === edge.id)
          return hit ? [{ step: p.step, rate: amountAsRate(table, factor, time, hit.moved) }] : []
        })
        return { edgeId: edge.id, rates }
      })
  }, [table, series, nodes, edges, kinds, time, modelVersion])
}

function Strip({ table, series, width, padL, padR, minStep, maxStep, stepSec }: { table: Timetable; series: Series; width: number; padL: number; padR: number; minStep: number; maxStep: number; stepSec: number }) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  const unitSec = TIME_UNIT_SECONDS[table.timeUnit]
  const toTime = (step: number) => (step * stepSec) / unitSec
  const iw = Math.max(1, width - padL - padR)
  const span = Math.max(1, maxStep - minStep)
  const x = (step: number) => padL + ((step - minStep) / span) * iw
  const line = useMemo(() => timetablePolyline(table, toTime(minStep), toTime(maxStep), Math.max(64, Math.round(iw) * 2)), [table, minStep, maxStep, iw, stepSec])
  const moved = useMovedRates(table, series)
  const top = niceTop(Math.max(0, ...line.map((p) => p.rate), ...(moved ?? []).flatMap((m) => m.rates.map((r) => r.rate))))
  const y = (v: number) => RATE_STRIP_H - PAD_BOTTOM - (v / top) * (RATE_STRIP_H - PAD_TOP - PAD_BOTTOM)
  const path = line.map((p, i) => `${i === 0 ? 'M' : 'L'}${x((p.time * unitSec) / stepSec).toFixed(2)} ${y(p.rate).toFixed(2)}`).join(' ')
  // a step covers (k − 1, k]: its moved rate is a stair across it
  const movedPaths = (moved ?? []).map((m) => ({
    edgeId: m.edgeId,
    d: m.rates.filter((r) => r.step > minStep).map((r) => `M${x(Math.max(minStep, r.step - 1)).toFixed(2)} ${y(r.rate).toFixed(2)}H${x(r.step).toFixed(2)}`).join(''),
  }))
  const at = hover === null ? null : toDouble(timetableRateAt(table, exactDouble(toTime(hover))))
  const movedAt = hover === null || moved === null ? null : (moved[0]?.rates.find((r) => r.step === Math.max(1, Math.ceil(hover)))?.rate ?? null)
  const stepAt = (clientX: number, box: DOMRect) => {
    const raw = minStep + ((clientX - box.left - padL) / iw) * span
    return Math.min(maxStep, Math.max(minStep, raw))
  }
  return (
    <svg
      className="timeline__rate"
      viewBox={`0 0 ${width} ${RATE_STRIP_H}`}
      width={width}
      height={RATE_STRIP_H}
      role="img"
      aria-label={moved ? t('timeline.rate.availableAria', { label: isolateAuto(table.label), unit: isolateAuto(table.unit) }) : t('timeline.rate.aria', { label: table.label, unit: table.unit })}
      data-means={moved ? 'available' : undefined}
      onPointerMove={(e) => setHover(stepAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => setHover(null)}
    >
      <line className="timeline__axis" x1={padL} y1={PAD_TOP} x2={padL} y2={RATE_STRIP_H - PAD_BOTTOM} />
      <line className="timeline__axis" x1={padL} y1={RATE_STRIP_H - PAD_BOTTOM} x2={width - padR} y2={RATE_STRIP_H - PAD_BOTTOM} />
      <text className="timeline__tick" direction="ltr" x={padL - 6} y={PAD_TOP + 4} textAnchor="end">
        {shown(top)}
      </text>
      <text className="timeline__tick" direction="ltr" x={padL - 6} y={RATE_STRIP_H - PAD_BOTTOM} textAnchor="end">
        0
      </text>
      <text className="timeline__tick timeline__rate-name" x={padL + 4} y={10}>
        {moved ? t('timeline.rate.availableName', { label: isolateAuto(table.label), unit: isolateAuto(table.unit) }) : `${table.label} (${table.unit})`}
      </text>
      <path className={moved ? 'timeline__run-target' : 'timeline__rate-line'} d={path} />
      {movedPaths.map((m) => (
        <path key={m.edgeId} className="timeline__rate-line timeline__rate-moved" data-edge={m.edgeId} d={m.d} />
      ))}
      {hover !== null && at !== null ? (
        <>
          <line className="timeline__rate-guide" x1={x(hover)} y1={PAD_TOP} x2={x(hover)} y2={RATE_STRIP_H - PAD_BOTTOM} />
          <text className="timeline__tick" direction="ltr" x={width - padR} y={10} textAnchor="end">
            {moved && movedAt !== null ? t('timeline.rate.availableAt', { available: isolateLtr(shown(at)), moved: isolateLtr(shown(movedAt)), unit: isolateAuto(table.unit) }) : `${shown(at)} ${table.unit}`}
          </text>
        </>
      ) : null}
    </svg>
  )
}

export function TimetableRateChart({ tables, series, width, padL, padR, minStep, maxStep }: { tables: readonly Timetable[]; series: Series; width: number; padL: number; padR: number; minStep: number; maxStep: number }) {
  const time = useGraphStore((s) => s.time)
  const stepSec = stepSeconds(time)
  if (stepSec === undefined || tables.length === 0) return null
  return (
    <>
      {tables.map((table) => (
        <Strip key={table.id} table={table} series={series} width={width} padL={padL} padR={padR} minStep={minStep} maxStep={maxStep} stepSec={stepSec} />
      ))}
    </>
  )
}
