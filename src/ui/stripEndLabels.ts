// #532 prototype — words at the end of a strip's two lines ("target" and "ran", or
// "available" and "moved"), so a line's meaning sits beside the line itself and does not
// rest on its pattern alone. Each label stands just above its line's end, or below it where
// the line runs along the top; two lines that meet split their labels, one above, one below.

/** the text's height above its baseline, in px, at the strips' 11 px tick size */
const RISE = 9
/** the gap between a label's baseline and its line */
const ABOVE = 3
const BELOW = 12
/** two baselines closer than this collide: an 11 px label's box is about 14 px tall (the
 *  first measurement, at 10, had every pair of labels overlapping) */
const APART = 14

/** baselines for the labels of line a and line b, whose ends stand at `ya` and `yb`, inside
 *  the strip's plot from `top` to `bottom` */
export function endLabelBaselines(ya: number, yb: number, top: number, bottom: number): [number, number] {
  const above = (y: number) => y - ABOVE
  const below = (y: number) => y + BELOW
  const fitsAbove = (y: number) => above(y) - RISE >= top
  const fitsBelow = (y: number) => below(y) <= bottom
  const one = (y: number) => (fitsAbove(y) ? above(y) : below(y))
  let a = one(ya)
  let b = one(yb)
  if (Math.abs(a - b) >= APART) return [a, b]
  // the lines meet: the higher one's label goes above, the lower one's below
  const aHigher = ya <= yb
  const hi = Math.min(ya, yb)
  const lo = Math.max(ya, yb)
  let up = above(hi)
  let down = below(lo)
  if (up - RISE < top) {
    // no room above: both below, one under the other
    up = below(lo)
    down = up + APART
  } else if (!fitsBelow(lo)) {
    // no room below: both above, one over the other
    down = above(hi)
    up = down - APART
  }
  ;[a, b] = aHigher ? [up, down] : [down, up]
  return [a, b]
}
