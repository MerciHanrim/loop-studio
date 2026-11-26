import { describe, expect, it } from 'vitest'
import { livePoolColours, ownPoolSeries } from './poolColours'

// issue #614 item 2 — the colour the Live chart draws a Pool in, which the Distribution chart
// now draws it in too: its flow colour, else the palette by its place among the document's
// Pools (never among the Pools a Monte Carlo run tracked), told apart where drawn lines share one.

const node = (id: string, kind: string, accent?: string) => ({ id, data: { kind, label: id, ...(accent ? { accent } : {}) } })
const NODES = [node('src', 'source'), node('a', 'pool'), node('b', 'pool', '#D9480F'), node('r', 'register'), node('c', 'pool'), node('d', 'pool', '#D9480F')]

describe('a Pool’s chart colour', () => {
  it('is its flow colour, else the palette by its place among the document’s Pools', () => {
    const own = ownPoolSeries(NODES, false)
    expect(own.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(own.find((p) => p.id === 'a')!.color).toBe('var(--series-1)')
    expect(own.find((p) => p.id === 'b')!.color.toLowerCase()).toBe('#d9480f')
    expect(own.find((p) => p.id === 'c')!.color, 'Gamma is the third Pool, whatever else is tracked').toBe('var(--series-3)')
  })

  it('in Live: a later drawn Pool of a shared colour takes a palette colour of its own', () => {
    const live = livePoolColours(NODES, 'auto', false)
    expect(live.get('b')!.toLowerCase()).toBe('#d9480f')
    expect(live.get('d')).toMatch(/^var\(--series-\d\)$/)
    expect(new Set(live.values()).size).toBe(4)
  })

  it('a Pool Live does not draw keeps its own colour', () => {
    const live = livePoolColours(NODES, ['b'], false)
    expect(live.get('d')!.toLowerCase(), 'Delta is not drawn beside Beta').toBe('#d9480f')
  })

  it('forced colours: the palette by index, no flow colour', () => {
    const live = livePoolColours(NODES, 'auto', true)
    expect([...live.values()]).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'])
  })
})
