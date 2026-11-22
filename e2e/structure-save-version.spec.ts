import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// Review M1 (2026-11-22) — File ▸ Save selected structure… on the seawater
// desalination Template. A selection holding a line that reads an `available`
// table (a chemical delivery and its tank) threw: the extract picked its model
// version with a ladder that stopped at 6, `serialize` refused the table below
// 7, and nothing on screen said so. The version now comes from the rule the
// file's checks use, so that selection is saved as a /graph/7 file; a delivery
// alone (/graph/4) and the Delivery pump with its run rule (/graph/6) are saved
// as before. The fixture's own check fails any test that sees a page error.

test.use({ viewport: { width: 1280, height: 800 } })

/** a click on a point of the canvas with no node, line or control near it */
async function clearSelection(page: Page) {
  const empty = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const taken = [...document.querySelectorAll('.react-flow__node, .react-flow__edge, .react-flow__controls')].map((el) => el.getBoundingClientRect())
    for (let y = pane.top + 30; y < pane.bottom - 30; y += 15)
      for (let x = pane.left + 30; x < pane.right - 30; x += 15)
        if (!taken.some((r) => r.width > 0 && x > r.left - 20 && x < r.right + 20 && y > r.top - 20 && y < r.bottom + 20)) return { x, y }
    return null
  })
  expect(empty, 'an empty point on the canvas').not.toBeNull()
  await page.mouse.click(empty!.x, empty!.y)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
}

/** open the Template, select `ids` by click and Ctrl+click, save the structure; the file */
async function saveStructure(page: Page, ids: string[]) {
  await openApp(page)
  await resetAll(page)
  await pickTemplate(page, 'desalination')
  await expect(page.locator('.react-flow__node[data-id="naocl"]')).toBeVisible()
  await routesSettled(page)
  await clearSelection(page)
  for (const [i, id] of ids.entries()) {
    await page.locator(`.react-flow__node[data-id="${id}"]`).click({ modifiers: i === 0 ? [] : ['ControlOrMeta'], force: true })
  }
  const selected = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.getAttribute('data-id')).sort())
  expect(selected, 'the selection made').toEqual([...ids].sort())

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.locator('.toolbar__filemenu-pop [role="menuitem"]').filter({ has: page.locator('.menu__name', { hasText: 'Save selected structure…' }) }).click()
  // the Template has saved frames: the notice that they are not included comes first
  await page.getByRole('button', { name: 'Continue' }).click()
  const text = readFileSync((await (await download).path())!, 'utf8')
  return JSON.parse(text) as { schema: string; nodes: { id: string }[]; edges: unknown[]; timetables?: { id: string; means?: string }[] }
}

test('a delivery and its tank: the line reads an `available` table, and the file is /graph/7 with that table', async ({ page }) => {
  const doc = await saveStructure(page, ['naoclDel', 'naocl'])
  expect(doc.schema).toBe('loop-studio/graph/7')
  expect(doc.nodes).toHaveLength(2)
  expect(doc.edges).toHaveLength(1)
  expect(doc.timetables?.map((t) => `${t.id}:${t.means ?? 'plan'}`)).toEqual(['naoclDeliveries:available'])
})

test('control: the delivery alone is still a /graph/4 file', async ({ page }) => {
  const doc = await saveStructure(page, ['naoclDel'])
  expect(doc.schema).toBe('loop-studio/graph/4')
  expect(doc.timetables ?? []).toEqual([])
})

test('control: the Delivery pump with its run rule is still a /graph/6 file with its plan table', async ({ page }) => {
  const doc = await saveStructure(page, ['dpump', 'city'])
  expect(doc.schema).toBe('loop-studio/graph/6')
  expect(doc.timetables?.map((t) => `${t.id}:${t.means ?? 'plan'}`)).toEqual(['demand:plan'])
})
