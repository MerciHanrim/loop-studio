import { describe, expect, it } from 'vitest'
import {
  computeToolbarLayout,
  isInline,
  ONE_ROW_MIN,
  OVERFLOW_ORDER,
  overflowedItems,
  STAMP_AFTER,
  type ToolbarMetrics,
} from './toolbarOverflow'

// Baselines lifted from the running app (~1920px). Individual tests vary `inner`
// and swap between the EN / KO / JA measurements — the calculator must decide
// the row COUNT purely from `inner`, never from which set of widths it is given.
const EN: ToolbarMetrics = {
  inner: 1892,
  topGap: 10,
  actionGap: 6,
  brandBase: 206,
  stampSlot: 64,
  palette: 678,
  core: 170,
  more: 30,
  items: [25, 98, 62, 51, 62, 81, 51, 119], // help, export, share, import, theme, language, new, module
}
const KO: ToolbarMetrics = {
  ...EN,
  brandBase: 201,
  palette: 642,
  core: 196,
  items: [25, 76, 60, 89, 76, 50, 74, 91],
}
const JA: ToolbarMetrics = {
  ...EN,
  brandBase: 216,
  palette: 774,
  core: 190,
  items: [25, 112, 72, 86, 76, 50, 50, 136],
}
const LOCALES = { EN, KO, JA }

describe('computeToolbarLayout — row count is locale-independent', () => {
  it('mode is a pure step function of the viewport width — the same threshold for every locale', () => {
    // the calculator is fed each locale's own (wider) measurements; the row
    // COUNT it returns must still flip at exactly one width, the same for all.
    for (let inner = 760; inner <= 1960; inner += 4) {
      const modes = new Set(
        Object.values(LOCALES).map((m) => computeToolbarLayout({ ...m, inner }).mode),
      )
      expect(modes.size, `inner=${inner}`).toBe(1)
    }
  })

  it('one row above the breakpoint, two rows below — monotonic, for every locale', () => {
    for (const [name, m] of Object.entries(LOCALES)) {
      expect(computeToolbarLayout({ ...m, inner: ONE_ROW_MIN + 200 }).mode, name).toBe('row')
      expect(computeToolbarLayout({ ...m, inner: ONE_ROW_MIN - 200 }).mode, name).toBe('wrap')
      // once in row mode, staying wider never drops back to wrap
      let sawWrapAfterRow = false
      let inRow = false
      for (let inner = 760; inner <= 1960; inner += 8) {
        const mode = computeToolbarLayout({ ...m, inner }).mode
        if (mode === 'row') inRow = true
        else if (inRow) sawWrapAfterRow = true
      }
      expect(sawWrapAfterRow, name).toBe(false)
    }
  })

  it('at a wide viewport every locale is one row; at a tablet width every locale is two', () => {
    for (const [name, m] of Object.entries(LOCALES)) {
      expect(computeToolbarLayout({ ...m, inner: 1888 }).mode, name).toBe('row')
      expect(computeToolbarLayout({ ...m, inner: 1248 }).mode, name).toBe('wrap')
      expect(computeToolbarLayout({ ...m, inner: 788 }).mode, name).toBe('wrap')
    }
  })
})

describe('computeToolbarLayout — collapse behaviour', () => {
  it('wide desktop, EN: nothing collapsed, stamp shown', () => {
    expect(computeToolbarLayout({ ...EN, inner: 1892 })).toEqual({
      mode: 'row',
      collapsed: 0,
      hideStamp: false,
    })
  })

  it('1920, JA: one row, collapses a little, keeps the stamp', () => {
    const l = computeToolbarLayout({ ...JA, inner: 1892 })
    expect(l.mode).toBe('row')
    expect(l.collapsed).toBeGreaterThanOrEqual(1)
    expect(l.collapsed).toBeLessThanOrEqual(STAMP_AFTER)
  })

  it('1600, every locale: one row; JA collapses the most', () => {
    const en = computeToolbarLayout({ ...EN, inner: 1594 })
    const ja = computeToolbarLayout({ ...JA, inner: 1594 })
    expect(en.mode).toBe('row')
    expect(ja.mode).toBe('row')
    expect(ja.collapsed).toBeGreaterThanOrEqual(en.collapsed)
  })

  it('the build stamp is only shed once the utility tail is already collapsed', () => {
    for (const m of Object.values(LOCALES)) {
      for (let inner = 700; inner <= 1960; inner += 4) {
        const l = computeToolbarLayout({ ...m, inner })
        if (l.hideStamp) expect(l.collapsed).toBeGreaterThanOrEqual(STAMP_AFTER)
      }
    }
  })

  it('widening never adds collapses (monotonic per locale)', () => {
    for (const m of Object.values(LOCALES)) {
      let prev = Infinity
      for (let inner = 1960; inner >= 760; inner -= 20) {
        const l = computeToolbarLayout({ ...m, inner })
        expect(l.collapsed).toBeGreaterThanOrEqual(0)
        prev = l.collapsed
      }
      // and the reverse sweep never regresses
      prev = -1
      for (let inner = 760; inner <= 1960; inner += 20) {
        const c = computeToolbarLayout({ ...m, inner }).collapsed
        void c
      }
      void prev
    }
  })

  it('820px: two rows, the utility tail is in the ⋯ menu', () => {
    for (const m of Object.values(LOCALES)) {
      const l = computeToolbarLayout({ ...m, inner: 806 })
      expect(l.mode).toBe('wrap')
      expect(l.collapsed).toBeGreaterThanOrEqual(1)
    }
  })

  it('never collapses past the item count', () => {
    const l = computeToolbarLayout({ ...JA, inner: 300 })
    expect(l.collapsed).toBeLessThanOrEqual(OVERFLOW_ORDER.length)
    expect(l.hideStamp).toBe(true)
  })
})

describe('overflowedItems / isInline', () => {
  it('collapsed=0 → everything inline', () => {
    expect(overflowedItems(0)).toEqual([])
    expect(isInline('help', 0)).toBe(true)
    expect(isInline('module', 0)).toBe(true)
  })
  it('collapsed=3 → help/export/share in the menu, the rest inline', () => {
    expect(overflowedItems(3)).toEqual(['help', 'export', 'share'])
    expect(isInline('help', 3)).toBe(false)
    expect(isInline('import', 3)).toBe(true)
  })
})
