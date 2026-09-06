import { describe, expect, it } from 'vitest'
import { uniqueNodeLabel } from './nodeLabel'

// docs/localization.md §L3.4a — the auto-name numbering rule. Pure, over the
// DISPLAY names in the graph; no hidden counter, no persisted flag.
describe('uniqueNodeLabel', () => {
  it('returns the base when it is free', () => {
    expect(uniqueNodeLabel('저장소', [])).toBe('저장소')
    expect(uniqueNodeLabel('저장소', ['공급원', '배출구'])).toBe('저장소')
  })

  it('appends the smallest free number when the base is taken', () => {
    expect(uniqueNodeLabel('저장소', ['저장소'])).toBe('저장소 2')
    expect(uniqueNodeLabel('저장소', ['저장소', '저장소 2'])).toBe('저장소 3')
    expect(uniqueNodeLabel('저장소', ['저장소', '저장소 2', '저장소 3'])).toBe('저장소 4')
  })

  it('reuses a freed number (delete → recreate)', () => {
    // '저장소 2' was deleted; base + '저장소 3' remain
    expect(uniqueNodeLabel('저장소', ['저장소', '저장소 3'])).toBe('저장소 2')
  })

  it('is independent per language — an EN Pool does not shift a KO 저장소', () => {
    expect(uniqueNodeLabel('저장소', ['Pool', 'Pool 2'])).toBe('저장소')
    expect(uniqueNodeLabel('Pool', ['저장소', '저장소 2'])).toBe('Pool')
  })

  it('skips past a name the user typed by hand', () => {
    // user hand-named a node '저장소 2'; base is still free
    expect(uniqueNodeLabel('저장소', ['저장소 2'])).toBe('저장소')
    // now base is taken too → next free is 3, not the user's 2
    expect(uniqueNodeLabel('저장소', ['저장소', '저장소 2'])).toBe('저장소 3')
  })

  it('treats an exact-string collision only — "저장소" ≠ "저장소2" (no space)', () => {
    expect(uniqueNodeLabel('저장소', ['저장소2', '저장소_2'])).toBe('저장소')
  })
})
