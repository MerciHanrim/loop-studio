// A series is told apart by more than its colour. Two series can share one: a flow colour
// says what a Pool holds, so four water tanks are one hue, and the palette repeats past
// its end. Where two drawn lines share a colour, the first stays solid and each later one
// takes the next pattern. A series' place is its rank in the document, over every series,
// so a pattern never passes to another line when one is hidden. Where nothing drawn
// shares a colour there is nothing to tell apart, and every line stays solid.

/** solid first, then patterns that stay apart at a 1.5 px line. A Register's `4 3` is not
 *  among them: that pattern says Register. */
// #532: the short `2 3` left the family, as it read like a strip's reference; `16 3 4 3` took
// its place
export const SERIES_DASHES: readonly (string | undefined)[] = [undefined, '8 3', '9 3 2 3', '12 3 2 3 2 3', '16 3 4 3']

// Hanrim / Lumi, 2026-11-11 — a pattern alone was not enough: the desalination example's four
// water tanks all drew in its one water blue and could not be told apart at a glance. Where a
// pattern tells shared-colour lines apart, each later line now also takes a colour of its own
// from the chart palette, in the chart, its legend and the step reading alike; the canvas keeps
// the flow colour. The first line of a colour keeps it. The chart's colour then differs from the
// node's flow colour for those later lines. The colour is chosen among the lines drawn, so the
// lines in view differ; a pattern is still chosen by the document rank and never moves.

/** the chart palette (`--series-1` … `-6`), with its light-theme values to measure distance by;
 *  `src/ui/seriesDash.test.ts` holds them to `src/index.css` */
export const SERIES_PALETTE: readonly { css: string; hex: string }[] = [
  { css: 'var(--series-1)', hex: '#2f78b7' },
  { css: 'var(--series-2)', hex: '#8f7a12' },
  { css: 'var(--series-3)', hex: '#7a5cc4' },
  { css: 'var(--series-4)', hex: '#b5532f' },
  { css: 'var(--series-5)', hex: '#3d8a52' },
  { css: 'var(--series-6)', hex: '#56606b' },
]

/** OKLab, for a distance between two colours that follows what the eye sees */
function oklab(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const lin = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(0), lin(2), lin(4)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363412243 * g + 0.0514990638 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s]
}
const hexOf = (color: string) => SERIES_PALETTE.find((p) => p.css === color)?.hex ?? color

/** each series' chart colour: its own, except a later DRAWN line of a colour another drawn line
 *  has, which takes the palette colour farthest from every colour drawn. The choice is made
 *  among the drawn lines in document order, so the lines in view never share a colour while
 *  the palette lasts; showing or hiding a line can change another's colour (its pattern stays,
 *  `seriesDashes`). A line not drawn keeps its own colour. */
export function seriesColours(series: readonly { id: string; color: string }[], drawn: ReadonlySet<string>): Map<string, string> {
  const shown = series.filter((s) => drawn.has(s.id))
  const taken = [...new Set(shown.map((s) => hexOf(s.color)))].map(oklab).filter((c): c is [number, number, number] => c !== null)
  const used = new Set(shown.map((s) => s.color))
  const seen = new Set<string>()
  const out = new Map<string, string>()
  for (const { id, color } of series) {
    if (!drawn.has(id) || !seen.has(color)) {
      if (drawn.has(id)) seen.add(color)
      out.set(id, color)
      continue
    }
    // a later drawn line of its colour: a palette colour no drawn line has yet
    const fresh = SERIES_PALETTE.filter((p) => !used.has(p.css))
    const pool = fresh.length ? fresh : SERIES_PALETTE
    let best = pool[0]
    let bestD = -1
    for (const p of pool) {
      const c = oklab(p.hex)!
      const d = Math.min(Infinity, ...taken.map((t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2])))
      if (d > bestD) {
        best = p
        bestD = d
      }
    }
    used.add(best.css)
    const c = oklab(best.hex)
    if (c) taken.push(c)
    out.set(id, best.css)
  }
  return out
}

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
