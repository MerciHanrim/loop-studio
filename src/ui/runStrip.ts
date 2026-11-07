// SEMANTICS-M6.md §M6-9 — a ruled group's strip on the Timeline, as a path. A step's
// fraction holds for the whole step, so the line is stairs and never a slope no run made.
// Past one step per pixel a column keeps its lowest and highest, so a single stopped step
// in a long run still shows.

export type StripPoint = { step: number; value: number | null }

type Rect = { x: number; y: number; w: number; h: number }

/** where a stage stands in the reading of a document: the first frame that holds it, in
 *  the document's frame order, then top to bottom and left to right inside it. A stage
 *  in no frame comes after every frame. The id settles a tie, so the order repeats. */
export function stripPlace(stage: { id: string; position: { x: number; y: number } }, frames: readonly { rect: Rect }[]): [number, number, number, string] {
  const { x, y } = stage.position
  const at = frames.findIndex(({ rect: r }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  return [at < 0 ? frames.length : at, y, x, stage.id]
}

/** ascending by `stripPlace` */
export function compareStripPlace(a: readonly [number, number, number, string], b: readonly [number, number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0)
}

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
