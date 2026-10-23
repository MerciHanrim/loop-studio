import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { OVERFLOW_GRAPH, readValueRow } from './support/valueOverflow'

// Node structure — the value overflow rule, the TOUCH path (phone project).
// On the phone a tap selects a node and opens the read-only Inspector sheet
// (docs/mobile.md §MV5); the whole value must be readable there, since the
// pointer tooltip does not exist for touch. The desktop keyboard path and the
// elision rule itself are in `node-value-overflow.spec.ts`.

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

async function load(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, OVERFLOW_GRAPH)
  await expect(page.locator('.nodef--outside')).toHaveCount(JSON.parse(OVERFLOW_GRAPH).nodes.length)
  await page.evaluate(() => document.fonts.ready)
}

/** bring a node's body to the middle of the pane at 100 % and tap it */
async function tapNode(page: Page, id: string): Promise<void> {
  await page.evaluate((nid) => {
    const l = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } }; rf: { setViewport: (v: object, o: object) => void } } }).__loop
    const n = l.graph.getState().nodes.find((x) => x.id === nid)!
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
    l.rf.setViewport({ x: pane.width / 2 - n.position.x - 44, y: pane.height / 2 - n.position.y - 28, zoom: 1 }, { duration: 0 })
  }, id)
  // a real touch tap at the body's centre — through the phone's pan surface,
  // the way a user's finger arrives (a locator tap is refused by Playwright's
  // actionability check because that surface is what receives the pointer)
  const b = (await node(page, id).locator('.nodef').boundingBox())!
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
  await expect(node(page, id).locator('.nodef__sel')).toHaveCount(1)
  await expect(page.locator('.sheet--inspector')).toBeVisible()
}

test.describe('node structure — a value wider than the body, on the phone', () => {
  test('the row is elided on the phone too, and a tap opens the sheet with the whole value', async ({ page }) => {
    await load(page)
    // the elision is the same rule on the phone (the symbol is the same size),
    // and the whole value and its capacity are beside the symbol there too
    const row = await readValueRow(page, 'p_cap')
    expect(row.text).toBe('123456789012345')
    expect(row.overflows, `overflows (${row.scrollWidth} > ${row.clientWidth})`).toBe(true)
    expect(row.textOverflow).toBe('ellipsis')
    expect([row.auxValue, row.auxMeaning]).toEqual(['123456789012345', '≤ 999999999999999'])
    // touch: a tap on the body selects the Pool and the sheet shows both numbers in full
    await tapNode(page, 'p_cap')
    await expect(page.locator('.sheet--inspector').getByLabel('Starting amount')).toHaveValue('123456789012345')
    await expect(page.locator('.sheet--inspector').getByLabel('Capacity (blank = unlimited)')).toHaveValue('999999999999999')
    // a Parameter: value and unit in full
    await page.locator('.sheet--inspector').getByRole('button', { name: /close/i }).click()
    await tapNode(page, 'par_neg')
    await expect(page.locator('.sheet--inspector').getByLabel('Value', { exact: true })).toHaveValue('-123456789.125')
    await expect(page.locator('.sheet--inspector').getByLabel('Unit (advisory)')).toHaveValue('credits per second/user')
  })

  test('after a run, a tap reaches the CURRENT count of a Pool in full', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce())
    await expect(node(page, 'p_live').locator('.nodef__value')).toHaveText(/^100000000000$/)
    await tapNode(page, 'p_live')
    await expect(page.locator('.sheet--inspector').getByLabel('Current amount')).toHaveValue('100000000000')
  })
})
