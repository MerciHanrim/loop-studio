import { describe, expect, it } from 'vitest'
import { endWordCentres, stripWordPad, WORD_GAP, wordWidth } from './stripEndLabels'

// #532, SEMANTICS-M6.md §M6-9 — the strips' end words stand in a gutter right of the plot. A
// strip is 56 px tall; its plot runs from 14 (under the strip's name) to 52.
const TOP = 14
const BOTTOM = 55

describe('where a strip’s two end words stand', () => {
  it('keeps each word on its own line’s end when the two are a text line apart', () => {
    expect(endWordCentres(24, 44, TOP, BOTTOM)).toEqual([24, 44])
  })

  it('pushes two words closer than a text line apart, the higher line’s word above', () => {
    const [a, b] = endWordCentres(40, 34, TOP, BOTTOM)
    expect(a - b).toBe(14)
    expect((a + b) / 2).toBe(37)
  })

  it('puts the first word above when the two lines meet', () => {
    const [a, b] = endWordCentres(30, 30, TOP, BOTTOM)
    expect(b - a).toBe(14)
  })

  it('keeps a word under the strip’s name when its line runs along the top', () => {
    const [a] = endWordCentres(TOP, 52, TOP, BOTTOM)
    expect(a - 7).toBeGreaterThanOrEqual(TOP)
  })

  it('moves only the word that would leave the strip, not a far word with it', () => {
    // a run at 100 % and its target at 0: the top word comes down, the bottom word stays put
    // (a shared shift pushed "ran" below the strip in 48 cases of the re-measurement)
    const [a, b] = endWordCentres(TOP, 52, TOP, BOTTOM)
    expect(a).toBe(TOP + 7)
    expect(b).toBe(BOTTOM - 7)
  })

  it('moves a pair that meets at an edge back inside, both together', () => {
    const [a, b] = endWordCentres(52, 52, TOP, BOTTOM)
    expect(b - a).toBe(14)
    expect(b + 7).toBeLessThanOrEqual(BOTTOM)
    expect(a - 7).toBeGreaterThanOrEqual(TOP)
  })
})

describe('how wide the gutter is', () => {
  it('fits the longest word, with the gap before it and a margin after', () => {
    expect(stripWordPad(['target', 'ran', 'available', 'moved'], 20)).toBe(Math.ceil(WORD_GAP + 9 * 6.7 + 4))
  })

  it('counts a wide East Asian glyph as a whole em', () => {
    expect(wordWidth('가용')).toBe(22)
    expect(wordWidth('利用可能')).toBe(44)
  })

  it('never goes under the chart’s own right padding', () => {
    expect(stripWordPad(['a'], 20)).toBe(20)
  })
})
