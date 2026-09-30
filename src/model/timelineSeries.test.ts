import { describe, expect, it } from 'vitest'
import { DEFAULT_SERIES_CAP, resolveTimelineSeries } from './timelineSeries'

// docs/timeline-series-contract.md §3 — "Resolution, verified as a pure
// function over nine cases", plus the §4 zero-series case and the order rule.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${String(i).padStart(2, '0')}`)

describe('resolveTimelineSeries — the drawn set', () => {
  it('the cap is 8', () => {
    expect(DEFAULT_SERIES_CAP).toBe(8)
  })

  it('1. auto with more series than the cap → the first 8, document order', () => {
    expect(resolveTimelineSeries('auto', ids(55))).toEqual(ids(8))
  })

  it('2. auto with fewer series than the cap → all of them', () => {
    expect(resolveTimelineSeries('auto', ids(3))).toEqual(ids(3))
  })

  it("3. 'all' → every current id, in document order", () => {
    expect(resolveTimelineSeries('all', ids(55))).toEqual(ids(55))
  })

  it("4. 'all' includes a series added afterwards; an explicit list does not", () => {
    const before = ids(3)
    const after = [...before, 'new']
    expect(resolveTimelineSeries('all', after)).toContain('new')
    expect(resolveTimelineSeries(before, after)).toEqual(before)
    expect(resolveTimelineSeries(before, after)).not.toContain('new')
  })

  it('5. an explicit list → exactly those ids, DOCUMENT order (not the stored sorted order)', () => {
    // stored sorted: ['a', 'z']; document order puts z first
    expect(resolveTimelineSeries(['a', 'z'], ['z', 'm', 'a'])).toEqual(['z', 'a'])
  })

  it('6. an id that no longer exists is dropped silently', () => {
    expect(resolveTimelineSeries(['s01', 'ghost'], ids(3))).toEqual(['s01'])
  })

  it('7. a list that names nothing here falls back to auto rather than an empty chart', () => {
    expect(resolveTimelineSeries(['ghost-1', 'ghost-2'], ids(12))).toEqual(ids(8))
  })

  it('8. an empty list is "nothing left" — same fallback', () => {
    expect(resolveTimelineSeries([], ids(12))).toEqual(ids(8))
  })

  it('9. an explicit list above the cap is NOT capped — the cap is for auto only', () => {
    expect(resolveTimelineSeries(ids(20), ids(55))).toEqual(ids(20))
  })

  it('zero eligible series → empty for every state (contract §6.2), never a throw', () => {
    expect(resolveTimelineSeries('auto', [])).toEqual([])
    expect(resolveTimelineSeries('all', [])).toEqual([])
    expect(resolveTimelineSeries(['a'], [])).toEqual([])
  })

  it('never mutates its inputs and never returns the caller’s array', () => {
    const all = ids(4)
    const sel = ['s03', 's01']
    const out = resolveTimelineSeries(sel, all)
    expect(out).toEqual(['s01', 's03'])
    expect(sel).toEqual(['s03', 's01'])
    expect(resolveTimelineSeries('all', all)).not.toBe(all)
  })
})
