import { describe, expect, it } from 'vitest'
import { SERIES_DASHES, seriesDashes } from './seriesDash'

const series = (...colors: string[]) => colors.map((color, i) => ({ id: `s${i}`, color }))
const all = (list: { id: string }[]) => new Set(list.map((s) => s.id))
const dashes = (list: { id: string; color: string }[], drawn = all(list)) => [...seriesDashes(list, drawn).values()]

describe('a series told apart by more than its colour', () => {
  it('leaves a colour used once solid', () => {
    expect(dashes(series('a', 'b', 'c'))).toEqual([undefined, undefined, undefined])
  })

  it('gives each later series of a colour the next pattern', () => {
    expect(dashes(series('a', 'b', 'a', 'a'))).toEqual([undefined, undefined, '8 3', '2 3'])
  })

  it('leaves a line solid when nothing drawn shares its colour, hidden series or not', () => {
    const list = series('a', 'a', 'b')
    expect(dashes(list, new Set(['s1', 's2']))).toEqual([undefined, undefined, undefined])
  })

  it('keeps a line’s pattern when another of its colour is hidden: it never passes to a neighbour', () => {
    const list = series('a', 'a', 'a')
    expect(dashes(list, new Set(['s1', 's2']))).toEqual([undefined, '8 3', '2 3'])
  })

  it('wraps past the last pattern rather than running out', () => {
    const many = dashes(series(...Array.from({ length: SERIES_DASHES.length + 1 }, () => 'a')))
    expect(many[SERIES_DASHES.length]).toBeUndefined()
  })

  it('never uses a Register’s own pattern', () => {
    expect(SERIES_DASHES).not.toContain('4 3')
  })
})
