// A series is told apart by more than its colour. Two series can share one: a flow colour
// says what a Pool holds, so four water tanks are one hue, and the palette repeats past
// its end. Where two drawn lines share a colour, the first stays solid and each later one
// takes the next pattern. A series' place is its rank in the document, over every series,
// so a pattern never passes to another line when one is hidden. Where nothing drawn
// shares a colour there is nothing to tell apart, and every line stays solid.

/** solid first, then patterns that stay apart at a 1.5 px line. A Register's `4 3` is not
 *  among them: that pattern says Register. */
export const SERIES_DASHES: readonly (string | undefined)[] = [undefined, '8 3', '2 3', '9 3 2 3', '12 3 2 3 2 3']

export function seriesDashes(series: readonly { id: string; color: string }[], drawn: ReadonlySet<string>): Map<string, string | undefined> {
  const shared = new Map<string, number>()
  for (const { id, color } of series) if (drawn.has(id)) shared.set(color, (shared.get(color) ?? 0) + 1)
  const rank = new Map<string, number>()
  const out = new Map<string, string | undefined>()
  for (const { id, color } of series) {
    const n = rank.get(color) ?? 0
    rank.set(color, n + 1)
    out.set(id, (shared.get(color) ?? 0) > 1 ? SERIES_DASHES[n % SERIES_DASHES.length] : undefined)
  }
  return out
}
