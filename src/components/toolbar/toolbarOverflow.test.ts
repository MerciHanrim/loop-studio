import { describe, expect, it } from 'vitest'
import {
  computeToolbarLayout,
  isInline,
  OVERFLOW_ORDER,
  overflowedItems,
  type ToolbarMetrics,
} from './toolbarOverflow'

// Baselines lifted from the running app (~1920px), grouped per the two-tier
// contract — Tier 1 (this file) is always one row; Tier 2 (the palette) is
// always its own row and is never measured here. `OVERFLOW_ORDER` order:
// help, data, settings, file, share, module.
const EN: ToolbarMetrics = {
  inner: 1892,
  topGap: 10,
  actionGap: 6,
  brandBase: 206,
  core: 170,
  more: 30,
  items: [25, 70, 90, 60, 62, 119], // help, data, settings, file, share, module
}
const KO: ToolbarMetrics = {
  ...EN,
  brandBase: 201,
  core: 196,
  items: [25, 60, 80, 55, 60, 91],
}
const JA: ToolbarMetrics = {
  ...EN,
  brandBase: 216,
  core: 190,
  items: [25, 75, 95, 65, 72, 136],
}
const LOCALES = { EN, KO, JA }

describe('computeToolbarLayout — Tier 1 collapse count', () => {
  it('widening never adds collapses (monotonic per locale)', () => {
    for (const m of Object.values(LOCALES)) {
      let prev = -1
      for (let inner = 700; inner <= 1960; inner += 8) {
        const c = computeToolbarLayout({ ...m, inner }).collapsed
        if (prev >= 0) expect(c, `inner=${inner}`).toBeLessThanOrEqual(prev)
        prev = c
      }
    }
  })

  it('wide desktop, EN: nothing collapsed', () => {
    expect(computeToolbarLayout({ ...EN, inner: 1892 })).toEqual({ collapsed: 0 })
  })

  it('1920, JA: collapses a little at the widest shipped locale', () => {
    const l = computeToolbarLayout({ ...JA, inner: 1892 })
    expect(l.collapsed).toBeGreaterThanOrEqual(0)
    expect(l.collapsed).toBeLessThanOrEqual(OVERFLOW_ORDER.length)
  })

  it('1600, every locale: JA collapses at least as much as EN', () => {
    const en = computeToolbarLayout({ ...EN, inner: 1594 })
    const ja = computeToolbarLayout({ ...JA, inner: 1594 })
    expect(ja.collapsed).toBeGreaterThanOrEqual(en.collapsed)
  })

  it('820px: some collapse is expected, never past the group count', () => {
    for (const m of Object.values(LOCALES)) {
      const l = computeToolbarLayout({ ...m, inner: 806 })
      expect(l.collapsed).toBeGreaterThanOrEqual(0)
      expect(l.collapsed).toBeLessThanOrEqual(OVERFLOW_ORDER.length)
    }
  })

  it('never collapses past the group count', () => {
    const l = computeToolbarLayout({ ...JA, inner: 300 })
    expect(l.collapsed).toBeLessThanOrEqual(OVERFLOW_ORDER.length)
  })
})

describe('overflowedItems / isInline', () => {
  it('collapsed=0 → everything inline', () => {
    expect(overflowedItems(0)).toEqual([])
    expect(isInline('help', 0)).toBe(true)
    expect(isInline('module', 0)).toBe(true)
  })
  it('collapsed=3 → help/data/settings in the menu, the rest inline', () => {
    expect(overflowedItems(3)).toEqual(['help', 'data', 'settings'])
    expect(isInline('settings', 3)).toBe(false)
    expect(isInline('file', 3)).toBe(true)
  })
})
