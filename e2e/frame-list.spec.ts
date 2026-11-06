import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// docs/workbench.md §WB5 (#499) — the Model list's saved frames. The document here
// is built for this spec and is no bundled Template. The fit's numbers are in
// src/components/canvasFit.test.ts.

type Bridge = { __loop: Record<string, any> }

const pool = (id: string, x: number, y: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } })
const frame = (id: string, label: string, x: number, y: number, w = 700, h = 420) => ({ id, label, rect: { x, y, w, h } })

const DOCUMENT = JSON.stringify({
  schema: 'loop-studio/graph/4', version: 1,
  nodes: [pool('alpha', 100, 100), pool('beta', 1100, 100), pool('gamma', 100, 900)],
  edges: [],
  // stored order is not the order of the numbers in the titles
  frames: [frame('f_two', '2 Second', 1000, 0), frame('f_one', '1 First', 0, 0), frame('f_none', '', 0, 800)],
})

const rows = (page: Page) => page.locator('.wb-row[data-frame]')
const row = (page: Page, id: string) => page.locator(`.wb-row[data-frame="${id}"]`)

/** how much of a frame the pane shows, 0 to 1, and the zoom */
const view = (page: Page, id: string) =>
  page.evaluate((frameId) => {
    const l = (window as unknown as Bridge).__loop
    const f = l.frame.getState().frames.find((x: { id: string }) => x.id === frameId)
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)!
    const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const left = f.rect.x * z + x
    const top = f.rect.y * z + y
    const w = Math.min(left + f.rect.w * z, pane.width) - Math.max(left, 0)
    const h = Math.min(top + f.rect.h * z, pane.height) - Math.max(top, 0)
    const share = (Math.max(w, 0) * Math.max(h, 0)) / (f.rect.w * z * f.rect.h * z)
    // how far it fills the pane: on opening, all three frames are whole but small
    const fill = Math.max((f.rect.w * z) / pane.width, (f.rect.h * z) / pane.height)
    return { share: Math.round(share * 1000) / 1000, fill, zoom: z }
  }, id)

/** the frame is whole and fills the pane */
const fitted = async (page: Page, id: string) => {
  const v = await view(page, id)
  return v.share === 1 && v.fill > 0.75 && v.zoom <= 1.2
}
const expectFitted = (page: Page, id: string) => expect.poll(() => fitted(page, id)).toBe(true)

/** the whole document, where no frame fills the pane: every row starts from here */
async function overview(page: Page) {
  await page.getByRole('button', { name: 'Fit the whole diagram' }).click()
  await expect.poll(async () => (await view(page, 'f_two')).fill).toBeLessThan(0.75)
}

/** everything a row must leave alone */
const stored = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const f = l.frame.getState()
    return JSON.stringify({ nodes: g.nodes.map((n: { id: string; position: unknown; selected?: boolean }) => [n.id, n.position, n.selected ?? false]), edges: g.edges, past: g.past.length, node: g.selectedNodeId, edge: g.selectedEdgeId, frames: f.frames, frame: f.selectedId })
  })

async function open(page: Page) {
  await openApp(page)
  await importGraph(page, DOCUMENT)
  await expect(rows(page)).toHaveCount(3)
}

test('the rows are the saved frames in stored order, and an unnamed one has its default name', async ({ page }) => {
  await open(page)
  await expect(rows(page)).toHaveText(['2 Second', '1 First', 'Group 3'])
})

test('a row fits the view to its frame, and changes nothing else', async ({ page }) => {
  await open(page)
  const before = await stored(page)
  for (const id of ['f_two', 'f_one', 'f_none']) {
    await overview(page)
    expect(await fitted(page, id)).toBe(false)
    await row(page, id).click()
    await expectFitted(page, id)
  }
  expect(await stored(page)).toBe(before)
})

test('the keyboard reaches a row, and focus stays on it', async ({ page }) => {
  await open(page)
  await overview(page)
  await row(page, 'f_two').focus()
  await page.keyboard.press('Enter')
  await expectFitted(page, 'f_two')
  await expect(row(page, 'f_two')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(row(page, 'f_one')).toBeFocused()
  await page.keyboard.press('Space')
  await expectFitted(page, 'f_one')
  await expect(row(page, 'f_one')).toBeFocused()
})

test('a row still works under the edit lock', async ({ page }) => {
  await open(page)
  await overview(page)
  await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
  await row(page, 'f_two').click()
  await expectFitted(page, 'f_two')
})

test('Find filters the frames by name, and a match with no node is not "no match"', async ({ page }) => {
  await open(page)
  const find = page.getByRole('searchbox')
  await find.fill('second')
  await expect(rows(page)).toHaveText(['2 Second'])
  await expect(page.locator('.wb-list__none')).toHaveCount(0)
  await find.fill('alpha')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.wb-row[data-node="alpha"]')).toBeVisible()
  await find.fill('nothing here')
  await expect(page.locator('.wb-list__none')).toBeVisible()
})

test('a document with no frame has no group', async ({ page }) => {
  await openApp(page)
  const doc = JSON.parse(DOCUMENT)
  delete doc.frames
  await importGraph(page, JSON.stringify(doc))
  await expect(page.locator('.wb-row[data-node="alpha"]')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
})
