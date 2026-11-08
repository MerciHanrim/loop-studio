// #534 — the analysis area's least height keeps the chart readable. The area's floor is
// what it must show (the splitter, the run row, one notice row when there are notices,
// the panel's head, the chart at PLOT_MIN and one strip when there are strips); when the
// area is short the notices and the strips give way first and scroll inside, and the
// chart keeps its 140 px. docs/workbench.md §WB7.
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, openApp, resetAll, test } from './support/loop'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, { getState: () => any }> }

const PLOT_MIN = 140
const CANVAS_MIN = 160
/** the desalination Template's six run rules; lifted, the document has no strips */
const RULED = ['filter', 'ro', 'remin', 'dpump', 'adjust', 'thick']

async function desalination(page: Page, opts: { steps: number; strips: boolean; labels?: Record<string, string> }): Promise<void> {
  await resetAll(page)
  await pickTemplate(page, 'desalination')
  await expect(page.locator('.react-flow__node')).toHaveCount(37)
  if (opts.labels) {
    await page.evaluate((labels: Record<string, string>) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const [id, label] of Object.entries(labels)) g.updateNodeData(id, { label })
    }, opts.labels)
  }
  if (!opts.strips) {
    await page.evaluate((ids: string[]) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const id of ids) g.setRunRule(id, null)
    }, RULED)
  }
  await ensureTimelineOpen(page)
  await page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, opts.steps)
}

/** the splitter's Home key: the area goes to its least height */
async function toFloor(page: Page): Promise<void> {
  const splitter = page.locator('.wb-splitter')
  await splitter.focus()
  await page.keyboard.press('Home')
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(Number(await splitter.getAttribute('aria-valuemin')))
}

const layout = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null)
    const area = document.querySelector('.timeline.wb-analysis') as HTMLElement
    const a = area.getBoundingClientRect()
    const svg = document.querySelector('.timeline__svg') as SVGSVGElement
    const s = svg.getBoundingClientRect()
    const ticks = [...svg.querySelectorAll('text.timeline__tick')].map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }))
    // the y axis's three labels, top to bottom
    const yTicks = [...svg.querySelectorAll('text.timeline__tick[text-anchor="end"][direction="ltr"]')]
      .map((t) => t.getBoundingClientRect())
      .sort((p, q) => p.top - q.top)
    const bar = box(document.querySelector('.pstrip'))!
    const status = box(document.querySelector('.wb-status'))
    const within = (r: DOMRect, o: DOMRect) => r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5
    const runControls = [...document.querySelectorAll('.pstrip button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0)
    return {
      plot: Math.round(s.height),
      yTickGaps: yTicks.slice(1).map((r, i) => Math.round(r.top - yTicks[i]!.bottom)),
      // the labels that do not lie wholly inside the chart; 2 px of slack, because a text
      // box is the font's whole ascent, which rises above the ink (the unit label "m³" at
      // y = 10 has a box 1 px over the chart's top at every height)
      ticksOut: ticks
        .filter(({ r }) => !(r.top >= s.top - 2 && r.bottom <= s.bottom + 2 && r.left >= s.left - 2 && r.right <= s.right + 2))
        .map(({ text, r }) => `${text} [${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}] in [${Math.round(s.left)},${Math.round(s.top)}–${Math.round(s.right)},${Math.round(s.bottom)}]`),
      plotInArea: within(s, a),
      runRowWhole: within(bar, a) && bar.bottom <= window.innerHeight && runControls.every((r) => within(r, bar)),
      areaOverflows: area.scrollHeight > area.clientHeight + 1,
      aboveStatus: status ? a.bottom <= status.top + 0.5 : a.bottom <= window.innerHeight,
      canvas: Math.round(box(document.querySelector('.react-flow'))!.height),
    }
  })

/** every item of a scrolling list that lies wholly inside it */
const inView = (page: Page, list: string, item: string) =>
  page.evaluate(
    ([l, i]) => {
      const el = document.querySelector(l)!
      const o = el.getBoundingClientRect()
      return [...el.querySelectorAll(i)].map((r) => r.getBoundingClientRect()).map((r) => r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5)
    },
    [list, item] as const,
  )

async function expectChartWhole(page: Page) {
  const l = await layout(page)
  expect(l.plot, 'the chart keeps its least height').toBeGreaterThanOrEqual(PLOT_MIN)
  for (const g of l.yTickGaps) expect(g, 'the y axis labels stay apart').toBeGreaterThan(0)
  expect(l.yTickGaps).toHaveLength(2)
  expect(l.ticksOut, 'every axis label lies inside the chart').toEqual([])
  expect(l.plotInArea, 'the chart lies inside the area').toBe(true)
  expect(l.runRowWhole, 'the run row and its controls are whole').toBe(true)
  expect(l.areaOverflows, 'the area does not overflow').toBe(false)
  expect(l.aboveStatus, 'the area stays above the status bar').toBe(true)
  expect(l.canvas, 'the canvas keeps its least height').toBeGreaterThanOrEqual(CANVAS_MIN)
  return l
}

test.describe('#534 — the analysis area keeps the chart readable', () => {
  test('a 600 px window with nine notices and seven strips: the chart keeps 140 px, and the notices and strips scroll to reach', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1920, height: 600 })
    await openApp(page)
    await desalination(page, { steps: 1300, strips: true })
    await expect(page.locator('.pstrip-diag li')).toHaveCount(9)
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(7)
    await toFloor(page)
    const l = await expectChartWhole(page)
    expect(l.plot).toBe(PLOT_MIN)

    // the notices give way to one row and scroll; the wheel reaches the last notice
    const notices = await inView(page, '.pstrip-diag', 'li')
    expect(notices[0], 'the first notice is in view').toBe(true)
    expect(notices.at(-1), 'the last notice starts out of view').toBe(false)
    await page.locator('.pstrip-diag').hover()
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await inView(page, '.pstrip-diag', 'li')).at(-1), { message: 'scrolling reaches the last notice' }).toBe(true)

    // the strips give way to one strip and scroll; the wheel reaches the next strip, then the last
    const strips = await inView(page, '.timeline__rates', 'svg.timeline__rate')
    expect(strips[0], 'the first strip is in view').toBe(true)
    expect(strips[1], 'the next strip starts out of view').toBe(false)
    await page.locator('.timeline__rates').hover()
    await page.locator('.timeline__rates').evaluate((el) => el.scrollBy({ top: (el.querySelector('svg.timeline__rate') as SVGElement).getBoundingClientRect().height }))
    await expect.poll(async () => (await inView(page, '.timeline__rates', 'svg.timeline__rate'))[1], { message: 'scrolling reaches the next strip' }).toBe(true)
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await inView(page, '.timeline__rates', 'svg.timeline__rate')).at(-1), { message: 'scrolling reaches the last strip' }).toBe(true)

    // scrolling the lists moves nothing else: the chart and the run row stay whole
    await expectChartWhole(page)
  })

  test('a document with no notices and no strips: the chart keeps 140 px at the floor, its labels apart', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1920, height: 600 })
    await openApp(page)
    await desalination(page, { steps: 48, strips: false })
    await expect(page.locator('.pstrip-diag')).toHaveCount(0)
    await expect(page.locator('.timeline__rates')).toHaveCount(0)
    await toFloor(page)
    const l = await expectChartWhole(page)
    expect(l.plot).toBe(PLOT_MIN)
  })

  test('a long Korean notice that wraps: the chart labels and the run row stay whole', async ({ page }) => {
    test.setTimeout(120_000)
    // the Template's own Korean notices fit one line even at 1024 px; a long process name,
    // as a user may give one, runs its two notices to two lines
    await page.setViewportSize({ width: 1024, height: 600 })
    await openApp(page)
    await pickLocale(page, 'ko')
    await desalination(page, { steps: 1300, strips: true, labels: { adjust: '방류수 수질 조정 설비 (2호기, 응집제와 pH 조정제를 함께 투입하는 계통)' } })
    await expect(page.locator('.pstrip-diag li')).toHaveCount(9)
    await toFloor(page)
    // at least one notice runs to more than one line
    const lines = await page.locator('.pstrip-diag li').evaluateAll((items) =>
      items.map((li) => Math.round(li.getBoundingClientRect().height / parseFloat(getComputedStyle(li).lineHeight))),
    )
    expect(Math.max(...lines), `a notice wraps (lines per notice: ${lines.join(', ')})`).toBeGreaterThan(1)
    const l = await expectChartWhole(page)
    expect(l.plot).toBe(PLOT_MIN)
    await page.locator('.pstrip-diag').hover()
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await inView(page, '.pstrip-diag', 'li')).at(-1), { message: 'scrolling reaches the last notice' }).toBe(true)
    await expectChartWhole(page)
  })
})
