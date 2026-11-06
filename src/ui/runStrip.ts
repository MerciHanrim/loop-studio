// SEMANTICS-M6.md §M6-9 — a ruled group's strip on the Timeline, as a path. A step's
// fraction holds for the whole step, so the line is stairs and never a slope no run made.
// Past one step per pixel a column keeps its lowest and highest, so a single stopped step
// in a long run still shows.

export type StripPoint = { step: number; value: number | null }

type Column = { x: number; first: number; last: number; lo: number; hi: number }

export function runStripPath(points: readonly StripPoint[], x: (step: number) => number, y: (value: number) => number, minStep: number): string {
  const out: string[] = []
  let col: Column | null = null
  let open = false
  const flush = () => {
    if (!col) return
    out.push(`H${col.x} V${y(col.first).toFixed(2)}`)
    if (col.lo !== col.hi) out.push(`V${y(col.lo).toFixed(2)} V${y(col.hi).toFixed(2)} V${y(col.last).toFixed(2)}`)
    col = null
  }
  for (const p of points) {
    if (p.step < minStep) continue
    if (p.value === null) {
      flush()
      open = false
      continue
    }
    const px = Math.round(x(p.step))
    if (!open) {
      out.push(`M${Math.round(x(Math.max(p.step - 1, minStep)))} ${y(p.value).toFixed(2)}`)
      open = true
    }
    if (col && col.x === px) {
      col.lo = Math.min(col.lo, p.value)
      col.hi = Math.max(col.hi, p.value)
      col.last = p.value
    } else {
      flush()
      col = { x: px, first: p.value, last: p.value, lo: p.value, hi: p.value }
    }
  }
  flush()
  return out.join(' ')
}
