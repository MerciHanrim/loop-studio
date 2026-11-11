import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { SERIES_DASHES, SERIES_PALETTE, seriesColours, seriesDashes } from './seriesDash'

const series = (...colors: string[]) => colors.map((color, i) => ({ id: `s${i}`, color }))
const all = (list: { id: string }[]) => new Set(list.map((s) => s.id))
const dashes = (list: { id: string; color: string }[], drawn = all(list)) => [...seriesDashes(list, drawn).values()]

describe('a series told apart by more than its colour', () => {
  it('leaves a colour used once solid', () => {
    expect(dashes(series('a', 'b', 'c'))).toEqual([undefined, undefined, undefined])
  })

  it('gives each later series of a colour the next pattern', () => {
    expect(dashes(series('a', 'b', 'a', 'a'))).toEqual([undefined, undefined, '8 3', '9 3 2 3'])
  })

  it('leaves a line solid when nothing drawn shares its colour, hidden series or not', () => {
    const list = series('a', 'a', 'b')
    expect(dashes(list, new Set(['s1', 's2']))).toEqual([undefined, undefined, undefined])
  })

  it('keeps a line’s pattern when another of its colour is hidden: it never passes to a neighbour', () => {
    const list = series('a', 'a', 'a')
    expect(dashes(list, new Set(['s1', 's2']))).toEqual([undefined, '8 3', '9 3 2 3'])
  })

  it('wraps past the last pattern rather than running out', () => {
    const many = dashes(series(...Array.from({ length: SERIES_DASHES.length + 1 }, () => 'a')))
    expect(many[SERIES_DASHES.length]).toBeUndefined()
  })

  it('never uses a Register’s own pattern', () => {
    expect(SERIES_DASHES).not.toContain('4 3')
  })

  // #532 — a strip's reference is dotted (`0 4`); the short `2 3` read like it beside the strips
  it('never uses a reference’s dots or the short dash that read like them', () => {
    expect(SERIES_DASHES).not.toContain('0 4')
    expect(SERIES_DASHES).not.toContain('2 3')
  })
})

// Hanrim / Lumi, 2026-11-11 — four water tanks in one blue could not be told apart at a glance
describe('a series that shares a colour takes a chart colour of its own', () => {
  const WATER = '#638EA5'
  const colours = (list: { id: string; color: string }[], drawn = all(list)) => [...seriesColours(list, drawn).values()]

  it('keeps the first line of a colour in it and gives each later one a different palette colour', () => {
    const c = colours(series(WATER, WATER, WATER, WATER))
    expect(c[0]).toBe(WATER)
    expect(new Set(c).size).toBe(4)
    for (const x of c.slice(1)) expect(SERIES_PALETTE.map((p) => p.css)).toContain(x)
  })

  it('never takes the palette colour nearest the shared one (the water blue is not given the palette blue)', () => {
    const c = colours(series(WATER, WATER, WATER, WATER))
    expect(c).not.toContain('var(--series-1)')
  })

  it('leaves a colour used once, or drawn once, as it is', () => {
    expect(colours(series('a', 'b', 'c'))).toEqual(['a', 'b', 'c'])
    const list = series(WATER, WATER, '#B47599')
    expect(colours(list, new Set(['s1', 's2']))).toEqual([WATER, WATER, '#B47599'])
  })

  it('chooses among the lines drawn: they differ even when many hidden lines share the colour', () => {
    // the desalination case: many water Pools and two other shared colours, four drawn
    const list = series(WATER, '#A78243', '#A78243', WATER, WATER, '#B47599', '#B47599', WATER, WATER, WATER, WATER)
    const drawn = new Set(['s3', 's4', 's7', 's10'])
    const c = seriesColours(list, drawn)
    const shown = [...drawn].map((id) => c.get(id))
    expect(new Set(shown).size).toBe(4)
    expect(c.get('s3')).toBe(WATER) // the first drawn line of the colour keeps it
  })

  it('leaves a line that is not drawn in its own colour', () => {
    const c = colours(series(WATER, WATER, WATER), new Set(['s0', 's1']))
    expect(c[2]).toBe(WATER)
  })

  it('does not take a palette colour another line already draws in', () => {
    const list = [...series(WATER, WATER), { id: 'p', color: 'var(--series-3)' }]
    const c = colours(list)
    expect(c[1]).not.toBe('var(--series-3)')
  })

  it('leaves the patterns to the own colour: a recoloured line keeps its pattern', () => {
    const list = series(WATER, WATER, WATER)
    expect(dashes(list)).toEqual([undefined, '8 3', '9 3 2 3'])
  })

  it('measures by the palette’s own light-theme values', () => {
    for (const [i, p] of SERIES_PALETTE.entries()) {
      expect(css).toContain(`--series-${i + 1}: ${p.hex};`)
      expect(p.css).toBe(`var(--series-${i + 1})`)
    }
  })
})
