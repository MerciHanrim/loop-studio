// #532 (Lumi, 2026-11-11) — one pattern, one meaning across the Timeline panel, and words at the
// strips' line ends. A reference (a run strip's target, what an available table offers) is dotted
// with round ends at the run line's own 2 px; a Register keeps `4 3`; the series patterns lost
// `2 3`. Each strip line carries a word at its end, in a gutter right of the plot that no line
// enters; two words closer than a text line are pushed apart; the chart keeps the strips' right
// edge, so a step sits at one x in both. SEMANTICS-M6.md §M6-9, docs/timeline-series-contract.md.
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, test } from './support/loop'
import { showStrip } from './support/timelineTabs'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

// an available table under a chart with a Register: one strip, so no tabs
const SMALL = JSON.stringify({
  schema: 'loop-studio/graph/7', version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Grid', activation: 'automatic' } },
    { id: 'tank', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 0, capacity: 4, resourceType: 'water', activation: 'automatic' } },
    { id: 'reg', type: 'register', position: { x: 320, y: 200 }, data: { kind: 'register', label: 'Twice', expr: '@tank * 2' } },
  ],
  edges: [{ id: 'e', source: 'src', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '~ramp' } }],
  kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
  time: { step: { value: 1, unit: 'h' } },
  timetables: [{ id: 'ramp', label: 'Supply', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'linear', end: '6', after: 'repeat', means: 'available', points: [['0', '0'], ['3', '2']] }],
})

const advance = (page: Page, n: number) =>
  page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, n)

/** the shown strip's words and lines, read from the screen */
const readStrip = (page: Page) =>
  page.locator('.timeline__panel').evaluate((panel) => {
    const svg = [...panel.querySelectorAll('svg.timeline__rate')].find((s) => s.getBoundingClientRect().height > 0)!
    const box = svg.getBoundingClientRect()
    const plotRight = Math.max(...[...svg.querySelectorAll('line.timeline__axis')].map((l) => l.getBoundingClientRect().right))
    const texts = [...svg.querySelectorAll('text')].map((t) => ({ el: t, r: t.getBoundingClientRect() }))
    const lines = [...svg.querySelectorAll('path, line')].filter((p) => getComputedStyle(p).stroke !== 'none' && !/axis|grid/.test(p.getAttribute('class') ?? '')) as SVGGeometryElement[]
    const words = texts.filter((x) => x.el.classList.contains('timeline__strip-end')).map((w) => {
      const overlaps = texts.filter((o) => o !== w && Math.min(w.r.right, o.r.right) - Math.max(w.r.left, o.r.left) > 0.5 && Math.min(w.r.bottom, o.r.bottom) - Math.max(w.r.top, o.r.top) > 0.5).length
      let crossed = 0
      for (const g of lines) {
        const m = g.getScreenCTM()!
        for (let s = 0, len = g.getTotalLength(); s <= len; s += 1) {
          const q = g.getPointAtLength(s)
          const sx = m.a * q.x + m.c * q.y + m.e
          const sy = m.b * q.x + m.d * q.y + m.f
          if (sx > w.r.left + 1 && sx < w.r.right - 1 && sy > w.r.top + 1 && sy < w.r.bottom - 1) { crossed++; break }
        }
      }
      return {
        end: w.el.getAttribute('data-end'),
        inGutter: w.r.left >= plotRight - 0.5,
        inStrip: w.r.left >= box.left - 0.5 && w.r.right <= box.right + 0.5 && w.r.top >= box.top - 0.5 && w.r.bottom <= box.bottom + 0.5,
        overlaps,
        crossed,
        centre: (w.r.top + w.r.bottom) / 2,
      }
    })
    const intoGutter = lines.filter((g) => g.getBoundingClientRect().right > plotRight + 1.5).length
    const pattern = (sel: string) => { const el = svg.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { dash: cs.strokeDasharray, width: cs.strokeWidth, cap: cs.strokeLinecap } }
    return { words, intoGutter, plotRight, reference: pattern('.timeline__run-target'), value: pattern('.timeline__rate-line') }
  })

const chartRight = (page: Page) =>
  page.locator('.timeline__svg').evaluate((svg) => Math.max(...[...svg.querySelectorAll('line.timeline__axis')].map((l) => l.getBoundingClientRect().right)))

function expectWordsClean(s: Awaited<ReturnType<typeof readStrip>>, ends: [string, string]) {
  expect(s.words.map((w) => w.end).sort()).toEqual([...ends].sort())
  for (const w of s.words) {
    expect(w, `${w.end}: in the gutter, inside the strip, over no text and under no line`).toMatchObject({ inGutter: true, inStrip: true, overlaps: 0, crossed: 0 })
  }
  expect(s.intoGutter, 'no line reaches into the gutter').toBe(0)
  expect(Math.abs(s.words[0].centre - s.words[1].centre), 'the two words a text line apart').toBeGreaterThanOrEqual(13.5)
}

test.describe('#532 Timeline strips: patterns and end words', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
    await resetAll(page)
  })

  for (const locale of ['en', 'ko', 'tr'] as const) {
    test(`${locale} 1280: a run that lies on its target still reads both words, in the gutter`, async ({ page }) => {
      if (locale !== 'en') await pickLocale(page, locale)
      await pickTemplate(page, 'desalination')
      await ensureTimelineOpen(page)
      await advance(page, 72)
      await showStrip(page, 'run:filter')
      await expect(page.locator('.timeline__panel .timeline__strip-end')).toHaveCount(2)
      const s = await readStrip(page)
      // the shipped Template's run follows its target exactly here: only the words tell them apart
      expectWordsClean(s, ['ran', 'target'])
      expect(s.reference).toEqual({ dash: '0px, 4px', width: '2px', cap: 'round' })
      expect(s.value).toMatchObject({ dash: 'none', width: '2px' })
    })

    test(`${locale} 1280: an available strip under the chart keeps the chart's right edge`, async ({ page }) => {
      if (locale !== 'en') await pickLocale(page, locale)
      await importGraph(page, SMALL)
      await ensureTimelineOpen(page)
      await advance(page, 18)
      await expect(page.locator('.timeline__panel .timeline__strip-end')).toHaveCount(2)
      const s = await readStrip(page)
      expectWordsClean(s, ['available', 'moved'])
      expect(s.reference).toEqual({ dash: '0px, 4px', width: '2px', cap: 'round' })
      expect(Math.abs((await chartRight(page)) - s.plotRight), 'a step at one x in the chart and its strip').toBeLessThanOrEqual(0.5)
      // a Register keeps its own pattern, apart from the reference's dots
      const reg = await page.locator('.timeline__svg .timeline__line--register').first().evaluate((el) => getComputedStyle(el).strokeDasharray)
      expect(reg).toBe('4px, 3px')
    })
  }

  test('forced colours: the patterns and the words hold', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await importGraph(page, SMALL)
    await ensureTimelineOpen(page)
    await advance(page, 18)
    await expect(page.locator('.timeline__panel .timeline__strip-end')).toHaveCount(2)
    const s = await readStrip(page)
    expectWordsClean(s, ['available', 'moved'])
    expect(s.reference).toEqual({ dash: '0px, 4px', width: '2px', cap: 'round' })
  })

  test('with no strip, the chart keeps its narrow right edge', async ({ page }) => {
    await pickTemplate(page, 'coffee-roastery')
    await ensureTimelineOpen(page)
    await advance(page, 5)
    const gap = await page.locator('.timeline__svg').evaluate((svg) => {
      const right = Math.max(...[...svg.querySelectorAll('line.timeline__axis')].map((l) => l.getBoundingClientRect().right))
      return Math.round(svg.getBoundingClientRect().right - right)
    })
    expect(gap).toBe(20)
  })
})
