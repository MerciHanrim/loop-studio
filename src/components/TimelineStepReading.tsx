import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useT } from '../i18n'
import { Icon } from '../ui/icons'

// The timeline's step reading (2026-10, Hanrim's request, Lumi's scope): a
// recorded step the user picked on the chart — by a click or a tap, or the
// arrow keys with the chart focused — held on screen with the value of every
// series the chart draws at that step. A READING: it never moves the run, and
// the run moving on never moves it (docs/timeline-series-contract.md §7a).
//
// Where it stands (Lumi, 2026-10-20): the plot under the 152 px analysis area
// is short, so the reading is NOT kept inside it. It stands on the plot's
// bottom edge beside the picked step's line and opens UPWARD, over the
// canvas, as far as its rows need — every row shown, the step and the close
// button with them — but never taller than READING_MAX (Lumi, 2026-10-20: on
// screen is not enough, it must not cover the work), nor than the room up to
// the top of the canvas column. Past that the step heading and the close
// button stay put and only the list of values scrolls. It never changes the
// analysis area's height, the zoom or the run. It sits beside the line on
// the side with more room, kept inside the column.

export type StepReadingRow = { id: string; label: string; color: string; value: string; isRegister: boolean }

/** the box the reading may use: what is above the plot's bottom, inside the
 *  canvas column (the analysis area's own column on the desktop, the sheet on
 *  the phone) */
const columnOf = (plot: HTMLElement): HTMLElement => (plot.closest('.canvas-col, .timeline--sheet') as HTMLElement | null) ?? plot

const GAP = 6 // off the plot's bottom edge, the line and the column's edges
/** the whole box's height at most, heading included (Lumi, 2026-10-20) */
export const READING_MAX = 320

export function TimelineStepReading({
  step,
  rows,
  lineX,
  plotRef,
  onClose,
}: {
  step: number
  rows: StepReadingRow[]
  /** the picked step's x in the plot, to stand beside its line */
  lineX: number
  plotRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const el = ref.current
    const plot = plotRef.current
    if (!el || !plot) return
    const measure = () => {
      const host = (el.offsetParent as HTMLElement | null) ?? document.body
      const hr = host.getBoundingClientRect()
      const pr = plot.getBoundingClientRect()
      const cr = columnOf(plot).getBoundingClientRect()
      const line = pr.left + lineX
      // beside the line, on the side with more of the column
      const toRight = line - cr.left <= cr.right - line
      const room = toRight ? cr.right - GAP - (line + 8) : line - 8 - (cr.left + GAP)
      setPlace({
        bottom: Math.round(hr.bottom - pr.bottom + GAP),
        ...(toRight ? { left: Math.round(line + 8 - hr.left) } : { right: Math.round(hr.right - (line - 8)) }),
        // READING_MAX, or less where the room up to the column's top is less
        maxHeight: Math.max(48, Math.min(READING_MAX, Math.round(pr.bottom - GAP - (cr.top + GAP)))),
        maxWidth: Math.max(140, Math.min(280, Math.round(room))),
      })
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(plot)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [lineX, plotRef, rows.length])

  return (
    <div ref={ref} className="timeline__reading" style={place} data-step={step}>
      <div className="timeline__reading-head">
        <span className="timeline__reading-step" aria-live="polite">
          {t('timeline.reading.step', { n: step })}
        </span>
        <button type="button" className="timeline__reading-x" aria-label={t('timeline.reading.close')} title={t('timeline.reading.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <ul className="timeline__reading-rows">
        {rows.map((r) => (
          <li key={r.id} className="timeline__reading-row" data-series={r.id}>
            <span className={`timeline__mark${r.isRegister ? ' timeline__mark--reg' : ''}`} style={{ background: r.color }} aria-hidden="true" />
            <span className="timeline__reading-name" dir="auto">
              {r.label}
            </span>
            <span className="timeline__reading-value" dir="ltr">
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
