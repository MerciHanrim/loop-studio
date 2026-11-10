import { useEffect, useMemo, useState } from 'react'
import type { RunGroupReport } from '../engine/types'
import { useT } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { hasRunRules } from '../model/modelVersion'
import { anyRunRule, ruleOf, runGroupOf } from '../model/runRule'
import { useFrameStore } from '../store/frameStore'
import { useGraphStore } from '../store/graphStore'
import { fullPercent } from '../ui/runMessages'
import { compareStripPlace, runStripPath, stripPlace } from '../ui/runStrip'
import { endWordCentres, WORD_GAP } from '../ui/stripEndLabels'
import { RATE_STRIP_H } from './TimetableRateChart'

// SEMANTICS-M6.md §M6-9 — what a ruled group was asked for and did, step by step, under
// the rate strips. A fraction is neither a stock nor a rate, so it has its own 0 to 100 %
// axis. Target and run differ by line pattern, so neither rests on colour.

const PAD_TOP = 14
const PAD_BOTTOM = 4

export type RunStripGroup = {
  /** the group's first member, as the report and the CSV name it */
  id: string
  /** the stages that hold its rules */
  label: string
}

type Series = readonly { step: number; runs?: readonly RunGroupReport[] }[]

/** the document's ruled groups, by first member, in the order a reader follows the
 *  document: by frame, then by position. A group stands where its earliest rule does. */
export function useRunStrips(): RunStripGroup[] {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const frames = useFrameStore((s) => s.frames)
  return useMemo(() => {
    if (!hasRunRules(modelVersion) || !anyRunRule(nodes)) return []
    const groups = new Map<string, { labels: string[]; place: ReturnType<typeof stripPlace> }>()
    for (const n of nodes) {
      if (ruleOf(n) === null) continue
      const first = runGroupOf(nodes, edges, n.id).members[0]!
      const place = stripPlace(n, frames)
      const was = groups.get(first)
      groups.set(first, { labels: [...(was?.labels ?? []), n.data.label || n.id], place: was && compareStripPlace(was.place, place) < 0 ? was.place : place })
    }
    return [...groups.entries()].sort(([, a], [, b]) => compareStripPlace(a.place, b.place)).map(([id, g]) => ({ id, label: g.labels.join(', ') }))
  }, [nodes, edges, modelVersion, frames])
}

function Strip({ group, series, width, padL, padR, minStep, maxStep, pinStep }: { group: RunStripGroup; series: Series; width: number; padL: number; padR: number; minStep: number; maxStep: number; pinStep: number | null }) {
  const t = useT()
  // #538 (Lumi's review of #546) — in the strips tab the chart's pinned step is read here too:
  // its guide and its shares while the pointer is elsewhere; the pointer's step wins over it
  const [pointer, setHover] = useState<number | null>(null)
  const hover = pointer ?? pinStep
  const pinnedOnly = pointer === null && pinStep !== null
  const iw = Math.max(1, width - padL - padR)
  const span = Math.max(1, maxStep - minStep)
  const x = (step: number) => padL + ((step - minStep) / span) * iw
  const y = (v: number) => RATE_STRIP_H - PAD_BOTTOM - v * (RATE_STRIP_H - PAD_TOP - PAD_BOTTOM)
  const reports = useMemo(() => series.map((p) => ({ step: p.step, report: p.runs?.find((r) => r.members[0] === group.id) ?? null })), [series, group.id])
  const target = runStripPath(reports.map((p) => ({ step: p.step, value: p.report?.target ?? null })), x, y, minStep)
  const moved = runStripPath(reports.map((p) => ({ step: p.step, value: p.report?.moved ?? null })), x, y, minStep)
  const last = reports[reports.length - 1]?.report ?? null
  // #532 prototype — the words at the end of each line, in the gutter right of the plot
  const lastPoint = [...reports].reverse().find((p) => p.report !== null && p.step > minStep) ?? null
  const ends = lastPoint?.report ? endWordCentres(y(lastPoint.report.target), y(lastPoint.report.moved), PAD_TOP, RATE_STRIP_H - 1) : null
  const at = hover === null ? null : (reports.find((p) => p.step === hover) ?? null)
  const stepAt = (clientX: number, box: DOMRect) => Math.min(maxStep, Math.max(minStep, Math.round(minStep + ((clientX - box.left - padL) / iw) * span)))
  const reading = at?.report ? t('timeline.run.at', { step: at.step, target: isolateAuto(fullPercent(at.report.target)), moved: isolateAuto(fullPercent(at.report.moved)) }) : null
  // #538 — the pinned step's reading, said once in a status line (see TimetableRateChart)
  const pinnedText = pinnedOnly ? (reading ?? '') : null
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (pinStep === null) setSaid('')
    else if (pinnedText !== null) setSaid(pinnedText)
  }, [pinStep, pinnedText])
  return (
    <>
    <svg
      className="timeline__rate timeline__run"
      data-run-strip={group.id}
      viewBox={`0 0 ${width} ${RATE_STRIP_H}`}
      width={width}
      height={RATE_STRIP_H}
      role="img"
      aria-label={
        last
          ? t('timeline.run.aria', { label: isolateAuto(group.label), target: isolateAuto(fullPercent(last.target)), moved: isolateAuto(fullPercent(last.moved)) })
          : t('timeline.run.ariaIdle', { label: isolateAuto(group.label) })
      }
      onPointerMove={(e) => setHover(stepAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => setHover(null)}
    >
      <line className="timeline__axis" x1={padL} y1={PAD_TOP} x2={padL} y2={RATE_STRIP_H - PAD_BOTTOM} />
      <line className="timeline__axis" x1={padL} y1={RATE_STRIP_H - PAD_BOTTOM} x2={width - padR} y2={RATE_STRIP_H - PAD_BOTTOM} />
      <text className="timeline__tick" direction="ltr" x={padL - 6} y={PAD_TOP + 4} textAnchor="end">
        100
      </text>
      <text className="timeline__tick" direction="ltr" x={padL - 6} y={RATE_STRIP_H - PAD_BOTTOM} textAnchor="end">
        0
      </text>
      <text className="timeline__tick timeline__rate-name" x={padL + 4} y={10}>
        {t('timeline.run.name', { label: isolateAuto(group.label) })}
      </text>
      <path className="timeline__run-target" d={target} />
      <path className="timeline__rate-line" d={moved} />
      {lastPoint && ends ? (
        <>
          <text className="timeline__tick timeline__strip-end" data-end="target" direction="ltr" x={width - padR + WORD_GAP} y={ends[0]} dy="0.32em">
            {t('timeline.run.endTarget')}
          </text>
          <text className="timeline__tick timeline__strip-end" data-end="ran" direction="ltr" x={width - padR + WORD_GAP} y={ends[1]} dy="0.32em">
            {t('timeline.run.endRan')}
          </text>
        </>
      ) : null}
      {at?.report ? (
        <>
          <line className={`timeline__rate-guide${pinnedOnly ? ' timeline__rate-guide--pin' : ''}`} x1={x(at.step)} y1={PAD_TOP} x2={x(at.step)} y2={RATE_STRIP_H - PAD_BOTTOM} />
          <text className="timeline__tick timeline__rate-value" x={width - padR} y={10} textAnchor="end">
            {reading}
          </text>
        </>
      ) : null}
    </svg>
    {pinStep !== null ? (
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-strip-reading={group.id}>
        {said}
      </span>
    ) : null}
    </>
  )
}

export function RunStrips({ groups, series, width, padL, padR, minStep, maxStep, pinStep = null }: { groups: readonly RunStripGroup[]; series: Series; width: number; padL: number; padR: number; minStep: number; maxStep: number; pinStep?: number | null }) {
  return (
    <>
      {groups.map((g) => (
        <Strip key={g.id} group={g} series={series} width={width} padL={padL} padR={padR} minStep={minStep} maxStep={maxStep} pinStep={pinStep} />
      ))}
    </>
  )
}
