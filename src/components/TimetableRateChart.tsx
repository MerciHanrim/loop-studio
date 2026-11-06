import { useMemo, useState } from 'react'
import { useT } from '../i18n'
import { exactDouble, plainDecimal, toDouble, toSignificant15 } from '../model/rational'
import { ruleTables } from '../model/runRule'
import { timetableLines, timetablePolyline, timetableRateAt, type Timetable } from '../model/timetable'
import { stepSeconds, TIME_UNIT_SECONDS } from '../model/units'
import { useGraphStore } from '../store/graphStore'

// SEMANTICS-M5.md §M5-11 — a table's rate on its own chart under the tanks. A rate
// and a stock are different quantities, so they never share an axis: each table
// has a strip of its own, with its own unit, on the same step scale as the chart
// above it. It draws the table itself, not the run: hold reads as stairs, linear
// as straight stretches, and past the end of a `stop` table there is no line.

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

function Strip({ table, width, padL, padR, minStep, maxStep, stepSec }: { table: Timetable; width: number; padL: number; padR: number; minStep: number; maxStep: number; stepSec: number }) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  const unitSec = TIME_UNIT_SECONDS[table.timeUnit]
  const toTime = (step: number) => (step * stepSec) / unitSec
  const iw = Math.max(1, width - padL - padR)
  const span = Math.max(1, maxStep - minStep)
  const x = (step: number) => padL + ((step - minStep) / span) * iw
  const line = useMemo(() => timetablePolyline(table, toTime(minStep), toTime(maxStep), Math.max(64, Math.round(iw) * 2)), [table, minStep, maxStep, iw, stepSec])
  const top = niceTop(Math.max(0, ...line.map((p) => p.rate)))
  const y = (v: number) => RATE_STRIP_H - PAD_BOTTOM - (v / top) * (RATE_STRIP_H - PAD_TOP - PAD_BOTTOM)
  const path = line.map((p, i) => `${i === 0 ? 'M' : 'L'}${x((p.time * unitSec) / stepSec).toFixed(2)} ${y(p.rate).toFixed(2)}`).join(' ')
  const at = hover === null ? null : toDouble(timetableRateAt(table, exactDouble(toTime(hover))))
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
      aria-label={t('timeline.rate.aria', { label: table.label, unit: table.unit })}
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
        {table.label} ({table.unit})
      </text>
      <path className="timeline__rate-line" d={path} />
      {hover !== null && at !== null ? (
        <>
          <line className="timeline__rate-guide" x1={x(hover)} y1={PAD_TOP} x2={x(hover)} y2={RATE_STRIP_H - PAD_BOTTOM} />
          <text className="timeline__tick" direction="ltr" x={width - padR} y={10} textAnchor="end">
            {shown(at)} {table.unit}
          </text>
        </>
      ) : null}
    </svg>
  )
}

export function TimetableRateChart({ tables, width, padL, padR, minStep, maxStep }: { tables: readonly Timetable[]; width: number; padL: number; padR: number; minStep: number; maxStep: number }) {
  const time = useGraphStore((s) => s.time)
  const stepSec = stepSeconds(time)
  if (stepSec === undefined || tables.length === 0) return null
  return (
    <>
      {tables.map((table) => (
        <Strip key={table.id} table={table} width={width} padL={padL} padR={padR} minStep={minStep} maxStep={maxStep} stepSec={stepSec} />
      ))}
    </>
  )
}
