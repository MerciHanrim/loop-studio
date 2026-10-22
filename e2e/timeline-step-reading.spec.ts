import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, runMc, test } from './support/loop'

// docs/timeline-series-contract.md §7a — the step reading (Hanrim's request,
// Lumi's scope, 2026-10-20): a click on the run chart picks the nearest
// RECORDED step and holds a line and the values of the series the chart draws
// at that step; another click moves it, the close button or Escape (with the
// chart focused) ends it, and the left / right arrow keys walk the recorded
// steps. It is a reading: it never changes the run, and the run going on
// keeps it. A reset, another document, or the record dropping the step ends
// it. Not on the Monte-Carlo distribution.
//
// Where each step lies is read from the drawn line itself (one vertex per
// recorded step), not from the chart's own x mapping.

type Bridge = { __loop: Record<string, { getState: () => any }> }

async function seed(page: Page) {
  await page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    l.graph.getState().loadDoc(
      {
        nodes: [
          { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
          { id: 'p1', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Stock', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
          { id: 'reg', type: 'register', position: { x: 400, y: 0 }, data: { kind: 'register', label: 'Twice', expr: '@p1 * 2' } },
        ],
        edges: [{ id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
      },
      { mode: 'document-boundary', canvasLocked: false },
    )
    l.mc.getState().applyRecommended({})
  })
}
/** `n` committed steps through the pure commit path (no playback clock) */
/** a Source feeding `n` Pools (q0, q1, …), each drawn on the chart */
async function seedPools(page: Page, n: number) {
  await page.evaluate((count) => {
    const l = (window as unknown as Bridge).__loop
    const nodes: unknown[] = [{ id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } }]
    const edges: unknown[] = []
    for (let i = 0; i < count; i++) {
      nodes.push({ id: `q${i}`, type: 'pool', position: { x: 200, y: i * 80 }, data: { kind: 'pool', label: `Stock ${i}`, activation: 'passive', initial: i, capacity: null, mode: 'pullAny' } })
      edges.push({ id: `e${i}`, source: 'src', target: `q${i}`, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } })
    }
    l.graph.getState().loadDoc({ nodes, edges }, { mode: 'document-boundary', canvasLocked: false })
    l.mc.getState().applyRecommended({})
  }, n)
}
const steps = (page: Page, n: number) =>
  page.evaluate((k) => {
    for (let i = 0; i < k; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  }, n)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return { stepIndex: s.stepIndex as number, epoch: s.commitEpoch as number, steps: (s.series as { step: number }[]).map((p) => p.step), values: (s.series as { values: Record<string, number> }[]).map((p) => p.values.p1) }
  })
/** the client point of the Stock line's vertex `i` (one per recorded step) */
const vertex = (page: Page, i: number) =>
  page.locator('.timeline__line[data-series="p1"]').evaluate((el, i) => {
    const nums = (el.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number)
    const svg = (el as SVGPathElement).ownerSVGElement!.getBoundingClientRect()
    return { x: svg.left + nums[i * 2]!, y: svg.top + nums[i * 2 + 1]! }
  }, i)
const reading = (page: Page) => page.locator('.timeline__reading')
const plot = (page: Page) => page.locator('.timeline__plot')

async function open(page: Page) {
  await openApp(page)
  await resetAll(page)
  await seed(page)
  await steps(page, 6)
  await expect(page.locator('.timeline__line[data-series="p1"]')).toBeVisible()
}

test.describe('the step reading on the run chart (§7a)', () => {
  test('a click picks the nearest recorded step: its line, and every drawn series\' value there; another click moves it', async ({ page }) => {
    await open(page)
    const before = await sim(page)
    const v2 = await vertex(page, 2)
    await page.mouse.click(v2.x + 3, v2.y - 20) // near step 2, not on it
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[2]))
    await expect(reading(page).locator('.timeline__reading-step')).toHaveText(`Step ${before.steps[2]}`)
    await expect(reading(page).locator('[data-series="p1"] .timeline__reading-value')).toHaveText(String(before.values[2]))
    await expect(reading(page).locator('[data-series="reg"] .timeline__reading-value')).toHaveText(String(before.values[2]! * 2))
    // the line stands at that step's x
    const lineX = await page.locator('.timeline__pin').evaluate((l) => (l as SVGLineElement).getBoundingClientRect().x)
    expect(Math.abs(lineX - v2.x)).toBeLessThan(2)
    // another point moves it; the same point again keeps it
    const v5 = await vertex(page, 5)
    await page.mouse.click(v5.x - 2, v5.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[5]))
    await page.mouse.click(v5.x - 2, v5.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[5]))
    // a reading: the run is exactly where it was
    expect(await sim(page)).toEqual(before)
  })

  test('the keyboard: the focused chart walks the recorded steps with the arrow keys and Home / End; Escape ends the reading', async ({ page }) => {
    await open(page)
    const { steps: s } = await sim(page)
    await plot(page).focus()
    await page.keyboard.press('ArrowLeft') // nothing picked yet: the latest step
    await expect(reading(page)).toHaveAttribute('data-step', String(s[s.length - 1]))
    await page.keyboard.press('ArrowLeft')
    await expect(reading(page)).toHaveAttribute('data-step', String(s[s.length - 2]))
    await page.keyboard.press('Home')
    await expect(reading(page)).toHaveAttribute('data-step', String(s[0]))
    await page.keyboard.press('ArrowLeft') // stays at the first
    await expect(reading(page)).toHaveAttribute('data-step', String(s[0]))
    await page.keyboard.press('ArrowRight')
    await expect(reading(page)).toHaveAttribute('data-step', String(s[1]))
    await page.keyboard.press('End')
    await expect(reading(page)).toHaveAttribute('data-step', String(s[s.length - 1]))
    await page.keyboard.press('Escape')
    await expect(reading(page)).toHaveCount(0)
    await expect(plot(page)).toBeFocused()
  })

  test('the close button ends it and gives the focus back to the chart', async ({ page }) => {
    await open(page)
    const v1 = await vertex(page, 1)
    await page.mouse.click(v1.x, v1.y)
    await expect(reading(page)).toBeVisible()
    await reading(page).getByRole('button', { name: 'Close the step reading' }).click()
    await expect(reading(page)).toHaveCount(0)
    await expect(plot(page)).toBeFocused()
  })

  test('the run going on keeps the reading at its step and its values; a reset ends it', async ({ page }) => {
    await open(page)
    const v3 = await vertex(page, 3)
    await page.mouse.click(v3.x, v3.y)
    const at = await sim(page)
    await expect(reading(page)).toHaveAttribute('data-step', String(at.steps[3]))
    await steps(page, 4)
    expect((await sim(page)).stepIndex).toBe(at.stepIndex + 4)
    await expect(reading(page)).toHaveAttribute('data-step', String(at.steps[3]))
    await expect(reading(page).locator('[data-series="p1"] .timeline__reading-value')).toHaveText(String(at.values[3]))
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await expect(reading(page)).toHaveCount(0)
  })

  test('another document ends it', async ({ page }) => {
    await open(page)
    const v3 = await vertex(page, 3)
    await page.mouse.click(v3.x, v3.y)
    await expect(reading(page)).toBeVisible()
    await seed(page)
    await steps(page, 6)
    await expect(reading(page)).toHaveCount(0)
  })

  test('the record dropping the picked step ends it (the record keeps the last 400 steps)', async ({ page }) => {
    await open(page)
    const v0 = await vertex(page, 0)
    await page.mouse.click(v0.x + 1, v0.y)
    await expect(reading(page)).toHaveAttribute('data-step', '0')
    await steps(page, 400)
    expect((await sim(page)).steps[0]).toBeGreaterThan(0)
    await expect(reading(page)).toHaveCount(0)
  })

  // Lumi, 2026-10-20: the reading is not held inside the short plot of the
  // 152 px analysis area — it opens upward over the canvas as far as its rows
  // need; the area, the zoom and the run stay as they are
  test('four series at the default 152 px: every row shown without a scroll, the step and close button with them, all on screen above the status bar; nothing else changes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await seedPools(page, 4)
    await steps(page, 8)
    await expect(page.locator('.timeline__line[data-series="q0"]')).toBeVisible()
    const areaH = () => page.evaluate(() => Math.round((document.querySelector('.timeline') as HTMLElement).getBoundingClientRect().height))
    expect(await areaH()).toBe(152)
    const vp0 = await page.evaluate(() => (window as any).__loop.rf.getViewport())
    const run0 = await sim(page)
    const v = await page.locator('.timeline__line[data-series="q0"]').evaluate((el) => {
      const nums = (el.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number)
      const svg = (el as SVGPathElement).ownerSVGElement!.getBoundingClientRect()
      return { x: svg.left + nums[8]!, y: svg.top + nums[9]! }
    })
    await page.mouse.click(v.x, v.y)
    await expect(reading(page)).toBeVisible()
    await expect(reading(page).locator('.timeline__reading-row')).toHaveCount(4)
    const g = await reading(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const list = el.querySelector('.timeline__reading-rows') as HTMLElement
      const status = document.querySelector('.wb-status')!.getBoundingClientRect()
      const x = el.querySelector('.timeline__reading-x')!.getBoundingClientRect()
      const head = el.querySelector('.timeline__reading-step')!.getBoundingClientRect()
      const rows = [...el.querySelectorAll('.timeline__reading-row')].map((row) => row.getBoundingClientRect())
      return {
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        statusTop: status.top,
        scrolls: list.scrollHeight > list.clientHeight + 1,
        rowsInside: rows.every((b) => b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5),
        closeInside: x.top >= r.top && x.bottom <= r.bottom && x.top >= 0,
        headInside: head.top >= r.top && head.bottom <= r.bottom,
        vw: innerWidth,
      }
    })
    expect(g.scrolls, 'four rows need no scroll').toBe(false)
    expect(g.rowsInside, 'every row inside the box').toBe(true)
    expect(g.closeInside && g.headInside, 'the step and the close button are on screen').toBe(true)
    expect(g.box.top, 'inside the window').toBeGreaterThanOrEqual(0)
    expect(g.box.bottom, 'above the status bar').toBeLessThanOrEqual(g.statusTop)
    expect(g.box.left).toBeGreaterThanOrEqual(0)
    expect(g.box.right).toBeLessThanOrEqual(g.vw)
    // the reading changed nothing else
    expect(await areaH(), 'the analysis area keeps its height').toBe(152)
    expect(await page.evaluate(() => (window as any).__loop.rf.getViewport())).toEqual(vp0)
    expect(await sim(page)).toEqual(run0)
  })

  // Lumi, 2026-10-20: on screen is not enough — the box must not cover the
  // work. At most 320 px tall, heading included, less where there is less
  // room; the step and the close button stay put and only the values scroll,
  // to the last one
  const readingGeometry = (page: Page) =>
    reading(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const list = el.querySelector('.timeline__reading-rows') as HTMLElement
      const lr = list.getBoundingClientRect()
      const status = document.querySelector('.wb-status')!.getBoundingClientRect()
      const plot = document.querySelector('.timeline__plot')!.getBoundingClientRect()
      const col = document.querySelector('.canvas-col')!.getBoundingClientRect()
      const x = el.querySelector('.timeline__reading-x')!.getBoundingClientRect()
      const head = el.querySelector('.timeline__reading-step')!.getBoundingClientRect()
      const rows = el.querySelectorAll('.timeline__reading-row')
      const last = rows[rows.length - 1]!.getBoundingClientRect()
      return {
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        statusTop: status.top,
        room: plot.bottom - col.top,
        scrolls: list.scrollHeight > list.clientHeight + 1,
        close: { top: x.top, bottom: x.bottom },
        head: { top: head.top, bottom: head.bottom },
        lastInList: last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5,
        rows: rows.length,
      }
    })
  for (const [n, size] of [
    [30, { width: 1280, height: 800 }],
    [60, { width: 1280, height: 800 }],
    // a short window: less room above the plot than 320 px
    [30, { width: 1280, height: 380 }],
  ] as const) {
    test(`${n} series at ${size.width} × ${size.height}: a box of at most 320 px (less if the room is less); the step and close stay put, the values scroll to the last; nothing else changes`, async ({ page }) => {
      await page.setViewportSize(size)
      await openApp(page)
      await resetAll(page)
      await seedPools(page, n)
      await page.evaluate(() => (window as any).__loop.sim.getState().setTimelineSeries('all'))
      await steps(page, 4)
      const areaH = () => page.evaluate(() => Math.round((document.querySelector('.timeline') as HTMLElement).getBoundingClientRect().height))
      const area0 = await areaH()
      const vp0 = await page.evaluate(() => (window as any).__loop.rf.getViewport())
      const run0 = await sim(page)
      await page.locator('.timeline__plot').focus()
      await page.keyboard.press('ArrowLeft')
      await expect(reading(page)).toBeVisible()
      await expect(reading(page).locator('.timeline__reading-row')).toHaveCount(n)
      const g = await readingGeometry(page)
      expect(g.height, 'at most 320 px').toBeLessThanOrEqual(320.5)
      expect(g.height, 'no taller than the room above the plot').toBeLessThanOrEqual(g.room)
      // (420 px tall leaves exactly 320, measured 2026-10-20)
      if (size.height <= 380) expect(g.room, 'the short window really has less than 320 px of room').toBeLessThan(320)
      expect(g.scrolls, `${n} values scroll inside`).toBe(true)
      expect(g.top).toBeGreaterThanOrEqual(0)
      expect(g.bottom, 'above the status bar').toBeLessThanOrEqual(g.statusTop)
      // to the last value: the list scrolls, the step and the close button do not move
      await reading(page).locator('.timeline__reading-rows').evaluate((el) => (el.scrollTop = el.scrollHeight))
      const end = await readingGeometry(page)
      expect(end.lastInList, 'the last value is reached').toBe(true)
      expect(end.close).toEqual(g.close)
      expect(end.head).toEqual(g.head)
      // the reading changed nothing else
      expect(await areaH()).toBe(area0)
      expect(await page.evaluate(() => (window as any).__loop.rf.getViewport())).toEqual(vp0)
      expect(await sim(page)).toEqual(run0)
    })
  }

  test('the Monte-Carlo distribution has no reading', async ({ page }) => {
    await open(page)
    const v3 = await vertex(page, 3)
    await page.mouse.click(v3.x, v3.y)
    await expect(reading(page)).toBeVisible()
    await runMc(page, { baseSeed: 1, runs: 10, steps: 6, tracked: ['p1'] })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    await expect(reading(page)).toBeHidden()
    await expect(page.locator('.timeline__pin')).toBeHidden()
  })
})

// a tablet (docs/workbench.md §WB1a — a secondary, touch environment): a tap
// picks the step and a tap on the close button ends the reading, landscape
// and portrait
for (const size of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test.describe(`the step reading by touch, ${size.width} × ${size.height}`, () => {
    test.use({ hasTouch: true, viewport: size })
    test('a tap picks the nearest step; a tap on its close button ends it', async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await seed(page)
      await steps(page, 6)
      await expect(page.locator('.timeline__line[data-series="p1"]')).toBeVisible()
      const { steps: s } = await sim(page)
      const v4 = await vertex(page, 4)
      await page.touchscreen.tap(v4.x, v4.y)
      await expect(reading(page)).toHaveAttribute('data-step', String(s[4]))
      const r = await reading(page).boundingBox()
      expect(r!.y).toBeGreaterThanOrEqual(0)
      expect(r!.y + r!.height).toBeLessThanOrEqual(size.height)
      const x = await reading(page).getByRole('button', { name: 'Close the step reading' }).boundingBox()
      await page.touchscreen.tap(x!.x + x!.width / 2, x!.y + x!.height / 2)
      await expect(reading(page)).toHaveCount(0)
    })
  })
}
