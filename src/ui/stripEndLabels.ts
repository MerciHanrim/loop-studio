// #532, SEMANTICS-M6.md §M6-9 — words at the end of a strip's two lines ("target" and "ran", or
// "available" and "moved"), so a line's meaning sits beside the line itself and does not
// rest on its pattern alone. The words stand in a gutter right of the plot, which no line
// enters (Lumi, 2026-11-11: a word placed inside the plot had a line through it in 84 of 416
// cases). Each word is centred on its line's end height; two words closer than a text line
// are pushed apart, the higher line's word above, so both read when the lines meet.

/** the gap between the plot's right edge, where every line ends, and the words */
export const WORD_GAP = 6
/** a word's box is about 14 px tall at the strips' 11 px tick size: two centres closer than
 *  this collide */
const APART = 14
const HALF = APART / 2

/** a word's width at the 11 px mono tick size: 0.6 em for a mono glyph, a whole em for a
 *  wide East Asian glyph, which falls back from the mono face; deterministic, no font load */
export function wordWidth(word: string): number {
  let w = 0
  for (const ch of word) w += /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-｠￠-￦]/.test(ch) ? 11 : 6.7
  return w
}

/** the right padding a Timeline needs so the longest word fits its gutter, never under `least` */
export function stripWordPad(words: readonly string[], least: number): number {
  return Math.max(least, Math.ceil(WORD_GAP + Math.max(0, ...words.map(wordWidth)) + 4))
}

/** centres for the words of line a and line b, whose ends stand at `ya` and `yb`, kept
 *  between `top` and `bottom`: from the plot's top edge, under the strip's name, which can run
 *  into the gutter in a long language, to the strip's own bottom */
export function endWordCentres(ya: number, yb: number, top: number, bottom: number): [number, number] {
  // each word on its own line's end, inside the bounds
  const clamp = (v: number) => Math.min(bottom - HALF, Math.max(top + HALF, v))
  let a = clamp(ya)
  let b = clamp(yb)
  if (Math.abs(a - b) >= APART) return [a, b]
  // too close: the higher line's word above, the other below (on a tie line a's word is
  // above), and only then the pair moved together back inside the bounds
  const mid = (a + b) / 2
  const aAbove = ya <= yb
  a = aAbove ? mid - HALF : mid + HALF
  b = aAbove ? mid + HALF : mid - HALF
  const lo = Math.min(a, b) - HALF
  const hi = Math.max(a, b) + HALF
  const shift = lo < top ? top - lo : hi > bottom ? bottom - hi : 0
  return [a + shift, b + shift]
}
