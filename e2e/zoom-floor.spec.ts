import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { pickTemplate, pressViewRow } from './support/workbenchMenus'

// The canvas's zoom-out limit, split from the whole-diagram fit (Lumi,
// 2026-10-20; Canvas.tsx `zoomFloor`). A hand on the wheel, the pinch or the
// status bar's − stops at 0.2 by default — unless the whole diagram needs less
// to fit the pane, and then just under that fit, computed from the diagram's
// size and the pane's: the Early MMO's View ▸ Reset view
// at 1280 × 800 had stopped at 0.2 with 30 of its 97 nodes off the canvas.
// No name is enlarged and no panel folds.

const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')

const onCanvas = (page: Page) =>
  page.evaluate(() => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const inside = (el: Element) => { const r = el.getBoundingClientRect(); return r.left >= pane.left - 0.5 && r.right <= pane.right + 0.5 && r.top >= pane.top - 0.5 && r.bottom <= pane.bottom + 0.5 }
    const nodes = [...document.querySelectorAll('.react-flow__node .nodef')]
    const names = [...document.querySelectorAll('.react-flow__node .nodef__name')]
    return { zoom: (window as any).__loop.rf.getViewport().zoom as number, nodes: [nodes.filter(inside).length, nodes.length], names: [names.filter(inside).length, names.length] }
  })

async function wheelFarOut(page: Page) {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 400)
  await page.waitForTimeout(300)
}

test('the Early MMO at 1280 × 800: Reset view puts all 97 nodes and names on the canvas; the hand stops just past that fit', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await page.locator('input[type=file][accept*="json"]').first().setInputFiles({ name: 'mmo-progression.json', mimeType: 'application/json', buffer: Buffer.from(MMO, 'utf8') })
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  await expect.poll(async () => { if (await confirm.isVisible().catch(() => false)) await confirm.click(); return page.evaluate(() => (window as any).__loop.graph.getState().nodes.length) }).toBe(97)
  await routesSettled(page)
  await pressViewRow(page, 'reset')
  await expect.poll(async () => (await onCanvas(page)).nodes).toEqual([97, 97])
  const fit = await onCanvas(page)
  expect(fit.names).toEqual([97, 97])
  expect(fit.zoom, 'below the 0.2 a hand stops at for a small document').toBeLessThan(0.2)
  await wheelFarOut(page)
  const out = await onCanvas(page)
  expect(out.zoom, 'the hand stops at the fit, within 3 %').toBeGreaterThan(fit.zoom * 0.97)
  expect(out.nodes).toEqual([97, 97])
  // the status bar's − there changes nothing further
  await page.locator('.wb-status').getByRole('button', { name: 'Zoom out', exact: true }).click()
  await page.waitForTimeout(200)
  expect((await onCanvas(page)).zoom).toBeCloseTo(out.zoom, 4)
})

test('a document that fits above 0.2 keeps 0.2 as the hand\'s limit', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await pickTemplate(page, 'coffee-roastery')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(23)
  await pressViewRow(page, 'reset')
  await expect.poll(async () => (await onCanvas(page)).zoom).toBeGreaterThan(0.2)
  await wheelFarOut(page)
  expect((await onCanvas(page)).zoom).toBeCloseTo(0.2, 4)
})
