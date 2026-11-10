// #537 — the desalination example's run guide, in the real app. Auto-play pauses once per
// run at the first stop of a core process (the five stages the Template marks
// `pauseOnStop`); the reason stays in the run row and its status region; played on, the
// later stops stay in the run notices. Past the 2,160 steps the example is checked over, the
// run row says so, while the model is the example's. The analysis area's least height counts
// the guide's line, so the chart keeps 140 px and the first strip stays whole (#534).
// The store rules, the checked-range key and the save / autosave / share round trips are
// pinned by src/store/simStore.autoPause.test.ts.
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, iso, openApp, resetAll, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, { getState: () => any }> }

const PLOT_MIN = 140
/** the Template's six chemical deliveries (#533); taken out, the plant stops about 48 days in */
const DELIVERIES = ['naoclDel', 'coagDel', 'antiDel', 'limeDel', 'naocl2Del', 'adjDel']
const PAUSE_TEXT = `Auto-play paused at step 1161: ${iso('Discharge adjustment')} stopped, short of what it needs from ${iso('Water-quality chemical tank')}.`
const CHECKED_TEXT = 'Past the 90 days this example is checked over (2160 steps).'

const guide = (page: Page, which: 'pause' | 'checked') => page.locator(`[data-testid="run-guide"] [data-guide="${which}"]`)
const status = (page: Page, which: 'pause' | 'checked') => page.locator(`[data-guide-status="${which}"]`)
const sim = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as Bridge).__loop.sim.getState()
  return { step: s.stepIndex as number, status: s.status as string }
})

async function template(page: Page, opts: { deliveries: boolean }) {
  await resetAll(page)
  await pickTemplate(page, 'desalination')
  await expect(page.locator('.react-flow__node')).toHaveCount(43)
  if (!opts.deliveries) {
    await page.evaluate((ids: string[]) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const id of ids) g.removeNode(id)
    }, DELIVERIES)
    await expect(page.locator('.react-flow__node')).toHaveCount(37)
  }
  await ensureTimelineOpen(page)
}

/** the store's own advance, as Step does, `k` times */
const advance = (page: Page, k: number) =>
  page.evaluate((n: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < n; i++) s.advance()
  }, k)

/** Play at the fastest speed, from the run row's own button */
async function play(page: Page) {
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().setSpeed(120))
  await page.locator('.pstrip .pb-btn--primary').click()
}

test.describe('#537 — the desalination example’s run guide', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
  })

  test('Play pauses once at the first core stop, says why, and plays on past the later stops; reopened from the autosave it pauses again', async ({ page }) => {
    test.setTimeout(180_000)
    await template(page, { deliveries: false })
    await advance(page, 1150)
    await expect(page.locator('[data-testid="run-guide"]')).toHaveCount(0)
    await play(page)
    await expect.poll(() => sim(page), { timeout: 30_000, message: 'auto-play pauses at the first core stop' }).toEqual({ step: 1161, status: 'paused' })
    await expect(guide(page, 'pause')).toHaveText(PAUSE_TEXT)
    await expect(status(page, 'pause')).toHaveText(PAUSE_TEXT)
    await expect(status(page, 'pause')).toHaveAttribute('role', 'status')
    await expect(page.locator('.pstrip .pb-btn--primary')).toHaveText(/Play/)

    // played on: the later stops (1172, 1175, 1181) do not pause it; the reason stays
    await play(page)
    await expect.poll(async () => (await sim(page)).step, { timeout: 60_000, message: 'auto-play runs past the later stops' }).toBeGreaterThanOrEqual(1190)
    expect((await sim(page)).status, 'still running past the later stops').toBe('running')
    await page.locator('.pstrip .pb-btn--primary').click()
    await expect.poll(async () => (await sim(page)).status).toBe('paused')
    await expect(guide(page, 'pause')).toHaveText(PAUSE_TEXT)
    await expect(status(page, 'pause')).toHaveText(PAUSE_TEXT)
    expect(await page.locator('.pstrip-diag li').count(), 'the later stops are in the run notices').toBeGreaterThan(1)

    // reopened from the autosave: the marks came back with the document, and a new run pauses
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await expect(page.locator('.react-flow__node')).toHaveCount(37)
    await ensureTimelineOpen(page)
    await advance(page, 1150)
    await play(page)
    await expect.poll(() => sim(page), { timeout: 30_000, message: 'the reopened document pauses at the same stop' }).toEqual({ step: 1161, status: 'paused' })
    await expect(guide(page, 'pause')).toHaveText(PAUSE_TEXT)
  })

  test('past 2,160 steps the run row says the example is checked over 90 days; an edit removes the note; reopened, it holds again', async ({ page }) => {
    test.setTimeout(180_000)
    await template(page, { deliveries: true })
    await advance(page, 2160)
    await expect(guide(page, 'checked')).toHaveCount(0)
    await expect(status(page, 'checked')).toHaveText('')
    await page.locator('.pstrip__step-btn').click()
    await expect.poll(async () => (await sim(page)).step).toBe(2161)
    await expect(guide(page, 'checked')).toHaveText(CHECKED_TEXT)
    await expect(status(page, 'checked')).toHaveText(CHECKED_TEXT)
    await expect(guide(page, 'pause'), 'the shipped Template never paused').toHaveCount(0)

    // a dose changed: the model is no longer the one checked
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const e = g.edges.find((x: { id: string }) => x.id === 'e_lime_remin')
      g.setEdgeData('e_lime_remin', { ...e.data, flow: '361' })
    })
    await expect(page.locator('[data-testid="run-guide"]')).toHaveCount(0)
    await expect(status(page, 'checked')).toHaveText('')

    // the Template again, then reopened from the autosave: the note comes back past 2,160
    await template(page, { deliveries: true })
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await expect(page.locator('.react-flow__node')).toHaveCount(43)
    await ensureTimelineOpen(page)
    await advance(page, 2161)
    await expect(guide(page, 'checked')).toHaveText(CHECKED_TEXT)
  })

  test('a 600 px window with the pause line, the notices and the strips: the chart keeps 140 px and the first strip stays whole', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1920, height: 600 })
    await template(page, { deliveries: false })
    await advance(page, 1150)
    await play(page)
    await expect.poll(() => sim(page), { timeout: 30_000 }).toEqual({ step: 1161, status: 'paused' })
    await expect(guide(page, 'pause')).toBeVisible()
    await expect(page.locator('.timeline__rates svg.timeline__rate').first()).toBeVisible()

    const splitter = page.locator('.wb-splitter')
    await splitter.focus()
    await page.keyboard.press('Home')
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(Number(await splitter.getAttribute('aria-valuemin')))

    const l = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
      const within = (a: DOMRect, o: DOMRect) => a.top >= o.top - 0.5 && a.bottom <= o.bottom + 0.5
      const area = document.querySelector('.timeline.wb-analysis') as HTMLElement
      const a = area.getBoundingClientRect()
      const rates = r('.timeline__rates')
      const first = r('.timeline__rates svg.timeline__rate')
      return {
        plot: Math.round(r('.timeline__svg').height),
        guide: Math.round(r('.pstrip-guide').height),
        guideWhole: within(r('.pstrip-guide'), a),
        firstStripWhole: within(first, rates) && within(first, a),
        areaOverflows: area.scrollHeight > area.clientHeight + 1,
      }
    })
    test.info().annotations.push({ type: 'guide line', description: `${l.guide} px` })
    expect(l.plot, 'the chart keeps its least height').toBe(PLOT_MIN)
    expect(l.guideWhole, 'the guide line lies inside the area').toBe(true)
    expect(l.firstStripWhole, 'the first strip is whole').toBe(true)
    expect(l.areaOverflows, 'the area does not overflow').toBe(false)
    await test.info().attach('600 px at the floor, paused at 1161', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
