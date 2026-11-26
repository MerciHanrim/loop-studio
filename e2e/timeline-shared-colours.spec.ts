// Hanrim / Lumi, 2026-11-11 — the desalination example's four water tanks drew in its one water
// blue, told apart only by pattern. Where a pattern tells shared-colour lines apart, each later
// line now also takes a chart colour of its own, the same in the line, its legend chip and the
// step reading; the patterns stay, so colour is never the only tell. The canvas keeps the flow
// colour. Forced colours are unchanged. docs/timeline-series-contract.md.
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, runMc, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

const advance = (page: Page, n: number) =>
  page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, n)

/** each drawn Pool line: its colour and pattern in the chart, its legend chip and its reading row */
const read = (page: Page) =>
  page.evaluate(() => {
    const mark = (m: Element | null) => {
      if (!m) return null
      if (m.tagName.toLowerCase() === 'svg') {
        const l = m.querySelector('line')!
        return { color: getComputedStyle(l).stroke, dash: getComputedStyle(l).strokeDasharray }
      }
      return { color: getComputedStyle(m).backgroundColor, dash: 'none' }
    }
    const lines = [...document.querySelectorAll('.timeline__svg path.timeline__line:not(.timeline__line--register)')] as SVGPathElement[]
    return lines.map((l) => {
      const id = l.getAttribute('data-series')!
      const label = (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === id)?.data.label as string
      const chip = [...document.querySelectorAll('.timeline__key')].find((k) => (k.textContent ?? '').replace(/[⁦-⁩]/g, '').startsWith(label))
      const row = document.querySelector(`.timeline__reading-row[data-series="${id}"]`)
      return {
        id,
        line: { color: getComputedStyle(l).stroke, dash: getComputedStyle(l).strokeDasharray },
        chip: mark(chip?.querySelector('.timeline__mark') ?? null),
        reading: mark(row?.querySelector('.timeline__mark') ?? null),
      }
    })
  })

async function pinStep(page: Page) {
  const box = (await page.locator('.timeline__svg').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await expect(page.locator('.timeline__reading')).toBeVisible()
}

test.describe('shared-colour Pools in the Timeline', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the four water tanks of the desalination example read four colours, the same in line, legend and reading, patterns kept`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await resetAll(page)
      await pickTemplate(page, 'desalination')
      await ensureTimelineOpen(page)
      await advance(page, 24)
      await pinStep(page)
      const s = await read(page)
      expect(s.length).toBe(4)
      // one colour per line, and each the same in its chip and its reading row
      expect(new Set(s.map((x) => x.line.color)).size).toBe(4)
      for (const x of s) {
        expect(x.chip, `${x.id}: the legend chip`).toEqual(x.line)
        expect(x.reading, `${x.id}: the reading row`).toEqual(x.line)
      }
      // the patterns stay, by document rank: the four drawn tanks are the 2nd to 5th water Pools
      // (the intake basin, the first, is not drawn), so each has a pattern of its own
      expect(s.map((x) => x.line.dash)).toEqual(['8px, 3px', '9px, 3px, 2px, 3px', '12px, 3px, 2px, 3px, 2px, 3px', '16px, 3px, 4px, 3px'])
      // the canvas keeps the water colour on every tank
      const accents = await page.evaluate((ids: string[]) => ids.map((id) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === id)?.data.accent), s.map((x) => x.id))
      expect(new Set(accents)).toEqual(new Set(['#638EA5']))
    })
  }

  // Lumi (2026-11-11): a colour is chosen among the lines drawn, so hiding or showing a line can
  // change another's colour — the line, its chip and its reading row must still agree right
  // after each switch, and the lines in view must still differ
  test('right after hiding a tank and showing it again, line, legend and reading agree, and the lines in view differ', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await ensureTimelineOpen(page)
    await advance(page, 24)
    const before = await read(page)
    const target = before[1]
    const label = await page.evaluate((id: string) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === id)?.data.label as string, target.id)
    const toggle = async () => {
      await page.locator('.timeline__series').click()
      await page.locator('.tl-series__item', { hasText: label }).locator('.tl-series__check').click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.tl-series')).toHaveCount(0)
    }
    const agree = async (n: number) => {
      if (!(await page.locator('.timeline__reading').isVisible())) await pinStep(page)
      const s = await read(page)
      expect(s.length).toBe(n)
      expect(new Set(s.map((x) => x.line.color)).size, 'the lines in view differ').toBe(n)
      for (const x of s) {
        expect(x.chip, `${x.id}: the legend chip`).toEqual(x.line)
        expect(x.reading, `${x.id}: the reading row`).toEqual(x.line)
      }
      return s
    }
    await toggle()
    const hidden = await agree(3)
    expect(hidden.map((x) => x.id)).not.toContain(target.id)
    await toggle()
    const shown = await agree(4)
    // the pattern never moves with a switch
    expect(shown.find((x) => x.id === target.id)!.line.dash).toBe(target.line.dash)
  })

  test('forced colours: the palette by index as before, the patterns kept', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await ensureTimelineOpen(page)
    await advance(page, 24)
    await pinStep(page)
    const s = await read(page)
    expect(s.length).toBe(4)
    expect(new Set(s.map((x) => x.line.color)).size).toBe(4)
    for (const x of s) expect(x.chip, `${x.id}: the legend chip`).toEqual(x.line)
  })
})

// issue #614 item 2 — the Distribution chart drew a Pool by its place in the Monte Carlo
// result and never by its own colour, so the same Pool read one colour in Live and another in
// Distribution once a colour was set or only some Pools were tracked. It now draws each Pool
// in the colour the Live chart gives it.
const pool = (id: string, label: string, y: number, accent?: string) => ({
  id,
  type: 'pool',
  position: { x: 300, y },
  data: { kind: 'pool', label, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...(accent ? { accent } : {}) },
})
const feed = (id: string, target: string, flow: string) => ({ id, source: 'src', target, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
/** Alpha and Gamma have no colour of their own; Beta has one, and Delta the same one, so the
 *  Live chart gives Delta a palette colour of its own (see above) */
const FOUR = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Source', activation: 'automatic' } },
    pool('a', 'Alpha', -225),
    pool('b', 'Beta', -75, '#D9480F'),
    pool('c', 'Gamma', 75),
    pool('d', 'Delta', 225, '#D9480F'),
  ],
  edges: [feed('e_a', 'a', '1'), feed('e_b', 'b', '2'), feed('e_c', 'c', '1d3'), feed('e_d', 'd', '3')],
})

test.describe('#614 item 2 — a Pool is the same colour in Live and in Distribution', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  /** each Pool's line colour in the Live chart */
  const liveColours = (page: Page) =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.timeline__svg path.timeline__line:not(.timeline__line--register)')].map((l) => [l.getAttribute('data-series')!, getComputedStyle(l).stroke]),
      ),
    )
  /** a Monte Carlo run over `tracked`, then the Distribution chart's colour for `id` */
  async function distributionColour(page: Page, tracked: string[], id: string): Promise<string> {
    await runMc(page, { baseSeed: 1, runs: 20, steps: 5, tracked })
    await page.evaluate((p) => {
      const m = (window as unknown as Bridge).__loop.mc
      m.setState({ distributionPoolId: p })
      m.getState().setView('distribution')
    }, id)
    await expect(page.locator('.band .band__p50')).toHaveCount(1)
    await expect(page.locator('.band__pool')).toHaveValue(id)
    const colour = await page.evaluate(() => getComputedStyle(document.querySelector('.band .band__p50')!).stroke)
    await page.evaluate(() => (window as unknown as Bridge).__loop.mc.getState().setView('live'))
    return colour
  }
  async function setUp(page: Page) {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, FOUR)
    await ensureTimelineOpen(page)
    await advance(page, 5)
    const live = await liveColours(page)
    expect(Object.keys(live).sort(), 'the Live chart draws the four Pools').toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(Object.values(live)).size, 'four colours in Live').toBe(4)
    return live
  }

  test('a Pool with its own colour, a Pool tracked alone, and a Pool whose colour Live told apart', async ({ page }) => {
    const live = await setUp(page)
    expect(await distributionColour(page, ['b', 'c'], 'b'), 'Beta, its own colour, tracked with Gamma').toBe(live.b)
    expect(await distributionColour(page, ['c'], 'c'), 'Gamma, tracked alone').toBe(live.c)
    expect(await distributionColour(page, ['b', 'd'], 'd'), 'Delta, the colour Live gives it beside Beta').toBe(live.d)
  })

  test('control: every Pool tracked, a Pool with no colour of its own keeps its Live colour', async ({ page }) => {
    const live = await setUp(page)
    expect(await distributionColour(page, ['a', 'b', 'c', 'd'], 'a'), 'Alpha').toBe(live.a)
    expect(await distributionColour(page, ['a', 'b', 'c', 'd'], 'c'), 'Gamma').toBe(live.c)
  })
})
