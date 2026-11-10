// #538 — the Timeline tabs (Lumi, 2026-11-10). With two or more strips, the pools' chart and
// the strips are two tabs in one analysis area of a fixed height: 216 px with nothing above the
// chart, raised only by the run guide line and the notices, never by a tab. The strips tab shows
// one strip, picked from a list in that tab. The pinned step, the CSV and the picked strip are
// kept across a switch. The tabs are a tablist. One strip stays under the chart. The end labels
// keep clear of the x axis's "step N" label. docs/workbench.md §WB7.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, test } from './support/loop'
import { showStrip, stripKeys } from './support/timelineTabs'
import { pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

const tab = (page: Page, k: 'stock' | 'strips') => page.locator(`.timeline__tabs [data-tab="${k}"]`)
const areaH = (page: Page) => page.locator('.timeline.wb-analysis').evaluate((el) => Math.round(el.getBoundingClientRect().height))
const plotH = (page: Page) => page.locator('.timeline__svg').evaluate((el) => Math.round(el.getBoundingClientRect().height))

async function template(page: Page, id: string, steps: number) {
  await resetAll(page)
  await pickTemplate(page, id)
  await page.waitForTimeout(400)
  await ensureTimelineOpen(page)
  await page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, steps)
}

async function csvText(page: Page): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.timeline__csv').click()])
  return readFileSync((await dl.path())!, 'utf8')
}

/** end labels whose box meets an axis label's or another end label's */
const labelTouches = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector('.timeline__svg')!
    const hit = (p: DOMRect, q: DOMRect) => p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5
    const ticks = [...svg.querySelectorAll('text.timeline__tick')]
    const ends = [...svg.querySelectorAll('text.timeline__endlabel')]
    return [
      ...ends.flatMap((e) => ticks.filter((t) => hit(e.getBoundingClientRect(), t.getBoundingClientRect())).map((t) => `end "${e.textContent}" on axis "${t.textContent}"`)),
      ...ends.flatMap((e, i) => ends.slice(i + 1).filter((f) => hit(e.getBoundingClientRect(), f.getBoundingClientRect())).map((f) => `end "${e.textContent}" on end "${f.textContent}"`)),
    ]
  })

test.describe('#538 — the Timeline tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
  })

  test('the desalination Template: two tabs in one 216 px area; the strips tab shows the picked strip; the height never changes', async ({ page }) => {
    await template(page, 'desalination', 48)
    await expect(page.getByRole('tablist', { name: 'Timeline' })).toBeVisible()
    await expect(tab(page, 'stock')).toHaveText('Pools')
    await expect(tab(page, 'strips')).toHaveText('Timetables and run rules')
    await expect(tab(page, 'stock')).toHaveAttribute('aria-selected', 'true')
    expect(await areaH(page), 'the area opens at 216 px, not raised for 13 strips').toBe(216)
    expect(await plotH(page)).toBe(140)
    await expect(page.locator('.timeline__rates')).toHaveCount(0)

    await tab(page, 'strips').click()
    expect(await areaH(page), 'the strips tab keeps the height').toBe(216)
    await expect(page.locator('.timeline__plot')).toBeHidden()
    await expect(page.locator('.timeline__rates[role="tabpanel"]')).toBeVisible()
    await expect(page.locator('.timeline__rates[role="tabpanel"]')).toHaveAttribute('aria-labelledby', (await tab(page, 'strips').getAttribute('id'))!)
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
    const keys = await stripKeys(page)
    expect(keys).toHaveLength(13)
    expect(keys[0]).toBe('table:demand')
    // the chips give way on the strips tab; Series and CSV stay
    await expect(page.locator('.timeline__keyrow')).toHaveClass(/is-off/)
    await expect(page.locator('.timeline__series')).toBeVisible()
    await expect(page.locator('.timeline__csv')).toBeVisible()
    for (const key of keys) {
      await showStrip(page, key)
      await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
      expect(await areaH(page), `${key}: the area keeps its height`).toBe(216)
    }
  })

  test('a switch keeps the pinned step, the CSV and the picked strip', async ({ page }) => {
    await template(page, 'desalination', 48)
    await page.locator('.timeline__plot').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    const reading = page.locator('.timeline__reading')
    await expect(reading).toHaveAttribute('data-step', '47')
    const before = await reading.innerText()
    const csvStock = await csvText(page)

    await showStrip(page, 'run:dpump')
    await expect(reading, 'the reading stands beside the chart, so it shows on the pools tab only').toHaveCount(0)
    expect(await csvText(page), 'the CSV does not depend on the tab').toBe(csvStock)
    await tab(page, 'stock').click()
    await expect(reading, 'the pinned step comes back with the chart').toHaveAttribute('data-step', '47')
    expect(await reading.innerText(), 'with the same reading').toBe(before)
    await tab(page, 'strips').click()
    await expect(page.locator('.timeline__strip-pick select'), 'the picked strip is kept').toHaveValue('run:dpump')
    await expect(page.locator('[data-run-strip="dpump"]')).toBeVisible()
  })

  test('the keyboard: one Tab stop, Left / Right / Home / End move and choose, then Tab reaches the picker past the hidden chips', async ({ page }) => {
    await template(page, 'desalination', 24)
    await expect(tab(page, 'stock')).toHaveAttribute('tabindex', '0')
    await expect(tab(page, 'strips')).toHaveAttribute('tabindex', '-1')
    await tab(page, 'stock').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'strips')).toBeFocused()
    await expect(tab(page, 'strips')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'stock')).toHaveAttribute('tabindex', '-1')
    await page.keyboard.press('Home')
    await expect(tab(page, 'stock')).toBeFocused()
    await expect(tab(page, 'stock')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(tab(page, 'strips')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, 'stock')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    // Tab on from the chosen tab: never a hidden chip, and the picker is reached
    const select = page.locator('.timeline__strip-pick select')
    let reached = false
    for (let i = 0; i < 8 && !reached; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.timeline__keyrow')), `Tab ${i + 1} is not on a hidden chip`).toBe(false)
      reached = await select.evaluate((el) => el === document.activeElement)
    }
    expect(reached, 'Tab reaches the strip picker').toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
  })

  test('one strip: no tabs, the strip under the chart as before', async ({ page }) => {
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await expect(page.locator('.react-flow__node')).toHaveCount(43)
    // the deliveries and five of the six run rules taken out (the demand table is read only by
    // the Delivery pump's rule): only the Thickener's run strip is left
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const id of ['naoclDel', 'coagDel', 'antiDel', 'limeDel', 'naocl2Del', 'adjDel']) g.removeNode(id)
      for (const id of ['filter', 'ro', 'remin', 'dpump', 'adjust']) g.setRunRule(id, null)
    })
    await ensureTimelineOpen(page)
    await expect(page.locator('.timeline__tabs')).toHaveCount(0)
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
    await expect(page.locator('.timeline__plot')).toBeVisible()
  })

  test('the end labels keep clear of the axis labels and of each other, the MMO Deaths at step 30 among them', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    for (const [id, steps] of [['mmo-progression', 30], ['mmo-progression', 60], ['gacha-banner-zones', 30], ['desalination', 30], ['coffee-roastery', 30]] as const) {
      await template(page, id, steps)
      await page.waitForTimeout(300)
      expect(await plotH(page), `${id} at ${steps}: the chart at its floor`).toBe(140)
      expect(await labelTouches(page), `${id} at step ${steps}`).toEqual([])
      if (id === 'mmo-progression' && steps === 30) await test.info().attach('MMO at step 30: the end labels', { body: await page.locator('.timeline.wb-analysis').screenshot(), contentType: 'image/png' })
    }
  })

  test('the phone: the sheet keeps its stacked strips, no tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    // the phone has no desktop File menu: the Template's file, imported
    await importGraph(page, readFileSync(new URL('../examples/desalination.json', import.meta.url), 'utf8'))
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      for (let i = 0; i < 4; i++) s.advance()
    })
    await ensureTimelineOpen(page)
    await expect(page.locator('.timeline__tabs')).toHaveCount(0)
    await expect.poll(() => page.locator('.timeline__rates svg.timeline__rate').count()).toBeGreaterThan(1)
  })
})
