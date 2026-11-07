import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, runMc, test } from './support/loop'

// #525, docs/timeline-series-contract.md §7a — a mouse over the run chart previews the
// recorded step nearest to it, as the strips below read the step under the pointer. The
// pointer leaving ends the preview. With a step picked, the reading shows the hovered
// step's values and returns to the picked ones; the picked line and the box stay where
// they are. Held by its entry, so a step recorded meanwhile does not move it. A click
// still picks; the keyboard and touch read as before; never on the distribution.
//
// Where each step lies is read from the drawn line itself (one vertex per recorded
// step), not from the chart's own x mapping.

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
const value = (page: Page) => reading(page).locator('[data-series="p1"] .timeline__reading-value')
const closeButton = (page: Page) => reading(page).getByRole('button', { name: 'Close the step reading' })
/** the words in the box that say its values are a preview (Lumi's review) */
const tag = (page: Page) => reading(page).locator('.timeline__reading-tag')
const lineX = (page: Page, cls: string) => page.locator(cls).evaluate((l) => (l as SVGLineElement).getBoundingClientRect().x)
/** off the plot: the page's top-left corner */
const leave = (page: Page) => page.mouse.move(4, 4)

async function open(page: Page) {
  await openApp(page)
  await resetAll(page)
  await seed(page)
  await steps(page, 6)
  await expect(page.locator('.timeline__line[data-series="p1"]')).toBeVisible()
}

test.describe('the hover preview on the run chart (#525)', () => {
  test('with nothing picked: the nearest recorded step, its dashed line and its values; a move follows; leaving ends it; the run is untouched', async ({ page }) => {
    await open(page)
    const before = await sim(page)
    const v2 = await vertex(page, 2)
    await page.mouse.move(v2.x + 3, v2.y - 20) // near step 2, not on it
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[2]))
    await expect(reading(page)).toHaveAttribute('data-preview', '')
    await expect(tag(page)).toHaveText('Preview')
    await expect(value(page)).toHaveText(String(before.values[2]))
    await expect(reading(page).locator('[data-series="reg"] .timeline__reading-value')).toHaveText(String(before.values[2]! * 2))
    expect(Math.abs((await lineX(page, '.timeline__peek')) - v2.x)).toBeLessThan(2)
    await expect(page.locator('.timeline__pin')).toHaveCount(0)
    // a preview: nothing to close, not a live region, and the pointer under it reads the plot
    await expect(closeButton(page)).toHaveCount(0)
    await expect(reading(page).locator('[aria-live]')).toHaveCount(0)
    expect(await reading(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
    const v4 = await vertex(page, 4)
    await page.mouse.move(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[4]))
    await expect(value(page)).toHaveText(String(before.values[4]))
    await leave(page)
    await expect(reading(page)).toHaveCount(0)
    await expect(page.locator('.timeline__peek')).toHaveCount(0)
    expect(await sim(page)).toEqual(before)
  })

  test('with a step picked: the hovered values show in the box, which stays beside the picked line; leaving returns the picked values; its close button can be reached', async ({ page }) => {
    await open(page)
    const before = await sim(page)
    const v1 = await vertex(page, 1)
    await page.mouse.click(v1.x, v1.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[1]))
    await expect(reading(page)).not.toHaveAttribute('data-preview', '')
    await expect(tag(page)).toBeHidden()
    await expect(reading(page).locator('.timeline__reading-step')).toHaveAttribute('aria-live', 'polite')
    const box = await reading(page).boundingBox()
    const v4 = await vertex(page, 4)
    await page.mouse.move(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[4]))
    await expect(reading(page)).toHaveAttribute('data-preview', '')
    // beside the picked line, the box says in words that these are another step's values
    await expect(tag(page)).toHaveText('Preview')
    await expect(tag(page)).toBeVisible()
    await expect(value(page)).toHaveText(String(before.values[4]))
    await expect(reading(page).locator('[aria-live]')).toHaveCount(0)
    // the pick keeps its line; the preview has its own
    expect(Math.abs((await lineX(page, '.timeline__pin')) - v1.x)).toBeLessThan(2)
    expect(Math.abs((await lineX(page, '.timeline__peek')) - v4.x)).toBeLessThan(2)
    expect(await reading(page).boundingBox()).toEqual(box)
    await leave(page)
    await expect(reading(page)).toHaveAttribute('data-step', String(before.steps[1]))
    await expect(reading(page)).not.toHaveAttribute('data-preview', '')
    await expect(value(page)).toHaveText(String(before.values[1]))
    await expect(tag(page)).toBeHidden()
    await expect(page.locator('.timeline__peek')).toHaveCount(0)
    // from a preview straight to the close button: the box has not moved away from it
    await page.mouse.move(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-preview', '')
    await closeButton(page).click()
    await expect(reading(page)).toHaveCount(0)
    expect(await sim(page)).toEqual(before)
  })

  test('steps recorded meanwhile (as during Play) move neither the preview nor the pick; a reset ends the preview', async ({ page }) => {
    await open(page)
    const at = await sim(page)
    const v2 = await vertex(page, 2)
    await page.mouse.click(v2.x, v2.y)
    const v4 = await vertex(page, 4)
    await page.mouse.move(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(at.steps[4]))
    await steps(page, 5)
    expect((await sim(page)).stepIndex).toBe(at.stepIndex + 5)
    await expect(reading(page)).toHaveAttribute('data-step', String(at.steps[4]))
    await expect(value(page)).toHaveText(String(at.values[4]))
    await leave(page)
    await expect(reading(page)).toHaveAttribute('data-step', String(at.steps[2]))
    await expect(value(page)).toHaveText(String(at.values[2]))
    // nothing picked: a reset drops the previewed entry, and the preview with it
    await closeButton(page).click()
    await expect(reading(page)).toHaveCount(0)
    const v3 = await vertex(page, 3)
    await page.mouse.move(v3.x, v3.y)
    await expect(reading(page)).toHaveAttribute('data-preview', '')
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await expect(reading(page)).toHaveCount(0)
  })

  test('the arrow keys read the picked step even with the mouse resting on the plot', async ({ page }) => {
    await open(page)
    const { steps: s } = await sim(page)
    const v2 = await vertex(page, 2)
    await page.mouse.click(v2.x, v2.y)
    const v4 = await vertex(page, 4)
    await page.mouse.move(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(s[4]))
    await page.locator('.timeline__plot').focus()
    await page.keyboard.press('ArrowRight')
    await expect(reading(page)).toHaveAttribute('data-step', String(s[3]))
    await expect(reading(page)).not.toHaveAttribute('data-preview', '')
    await expect(tag(page)).toBeHidden()
    await expect(page.locator('.timeline__peek')).toHaveCount(0)
  })

  test('no preview on the Monte-Carlo distribution; the live view previews again', async ({ page }) => {
    await open(page)
    const v3 = await vertex(page, 3)
    await runMc(page, { baseSeed: 1, runs: 10, steps: 6, tracked: ['p1'] })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
    await page.mouse.move(v3.x, v3.y)
    await page.mouse.move(v3.x + 2, v3.y)
    await expect(reading(page)).toHaveCount(0)
    await expect(page.locator('.timeline__peek')).toHaveCount(0)
    await page.locator('.timeline__viewtab', { hasText: 'Live' }).click()
    const w3 = await vertex(page, 3)
    await page.mouse.move(w3.x, w3.y)
    await expect(reading(page)).toHaveAttribute('data-preview', '')
  })
})

// touch reads as before: a tap picks, and nothing previews
test.describe('the hover preview by touch, 1024 × 768', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } })
  test('a tap picks the step, with no preview', async ({ page }) => {
    await open(page)
    const { steps: s } = await sim(page)
    const v4 = await vertex(page, 4)
    await page.touchscreen.tap(v4.x, v4.y)
    await expect(reading(page)).toHaveAttribute('data-step', String(s[4]))
    await expect(reading(page)).not.toHaveAttribute('data-preview', '')
    await expect(closeButton(page)).toBeVisible()
    await expect(tag(page)).toBeHidden()
    await expect(page.locator('.timeline__peek')).toHaveCount(0)
  })
})
