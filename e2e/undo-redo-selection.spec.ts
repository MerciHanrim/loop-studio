import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'

// Undo / redo end with nothing selected, on the canvas as in the Inspector. A
// history entry kept React Flow's `selected` flags, so an undo could leave a
// connection marked while the Inspector showed nothing — a click on it then
// changed nothing, and Delete or an arrow key acted on what the Inspector did
// not show — or bring back a selection from the history. On the small
// node-structure fixture, as a user does it: pointer clicks, the Inspector's
// Reverse, the keyboard. The one exception is a module insert
// (docs/module-system.md §MS3.5): its undo restores the selection from before
// the insert and its redo the inserted set, the canvas marks and the
// Inspector's ids together.

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
type L = { graph: { getState: () => any }; rf: { setViewport: (v: object, o?: object) => void } }

async function open(page: Page) {
  await openApp(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await routesSettled(page)
}

/** a click on the connection's own line, as a user selects it */
async function clickEdge(page: Page, id: string) {
  const p = await page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate((el) => {
    const s = el as SVGPathElement
    const q = s.getPointAtLength(s.getTotalLength() * 0.3)
    const m = s.getScreenCTM()!
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
  })
  await page.mouse.click(p.x, p.y)
}

async function clickNode(page: Page, id: string) {
  const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

/** an empty spot of the pane, away from every node and line */
async function clickEmpty(page: Page) {
  const b = (await page.locator('.react-flow__pane').boundingBox())!
  await page.mouse.click(b.x + b.width - 380, b.y + b.height - 40)
}

const marks = (page: Page) => page.locator('.react-flow__edge.selected, .react-flow__node.selected')
const ends = (page: Page) => page.locator('.inspector .ends')
const reverse = (page: Page) => ends(page).getByRole('button', { name: 'Reverse direction' })
const store = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: L }).__loop.graph.getState()
    return {
      ids: [g.selectedNodeId, g.selectedEdgeId] as (string | null)[],
      flagged: [...g.nodes.filter((n: any) => n.selected), ...g.edges.filter((e: any) => e.selected)].map((x: any) => x.id as string),
      edges: g.edges.map((e: any) => e.id as string),
      past: g.past.length as number,
      future: g.future.length as number,
    }
  })
const nodePos = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.find((n: any) => n.id === id).position as { x: number; y: number }, id)

/** nothing selected anywhere: no canvas mark, no flag, no Inspector element */
async function nothingSelected(page: Page) {
  await expect(marks(page)).toHaveCount(0)
  await expect(ends(page)).toHaveCount(0)
  await expect.poll(async () => { const s = await store(page); return [...s.ids, ...s.flagged] }).toEqual([null, null])
}

test.describe('undo / redo end with nothing selected', () => {
  test('a connection selected across its own Reverse: undo leaves no mark, and a click selects it again', async ({ page }) => {
    await open(page)
    await clickEdge(page, 'e_treat')
    await reverse(page).click()
    await page.keyboard.press('Control+z')
    await nothingSelected(page)
    await clickEdge(page, 'e_treat')
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="e_treat"]')).toHaveClass(/\bselected\b/)
    await expect(ends(page).locator('.ends__summary')).toHaveText(/Triage desk.*→.*Treated today/)
    // redo with it selected again: nothing selected, and a click selects again
    await page.keyboard.press('Control+y')
    await nothingSelected(page)
    await clickEdge(page, 'e_treat')
    await expect(ends(page).locator('.ends__summary')).toHaveText(/Treated today.*→.*Triage desk/)
  })

  test('undo and redo bring no old selection back', async ({ page }) => {
    await open(page)
    await clickEdge(page, 'e_treat')
    await reverse(page).click()
    await clickEmpty(page)
    await nothingSelected(page)
    await page.keyboard.press('Control+z')
    await nothingSelected(page)
    await page.keyboard.press('Control+y')
    await nothingSelected(page)
  })

  test('after an undo, Delete deletes nothing the Inspector does not show', async ({ page }) => {
    await open(page)
    await clickEdge(page, 'e_treat')
    await reverse(page).click()
    await page.keyboard.press('Control+z')
    await nothingSelected(page)
    const before = await store(page)
    await page.keyboard.press('Delete')
    const after = await store(page)
    expect(after.edges).toEqual(before.edges)
    expect([after.past, after.future]).toEqual([before.past, before.future])
  })

  test('a node: undoing its move leaves it unselected, an arrow key then moves nothing, a click selects it', async ({ page }) => {
    await open(page)
    const id = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.find((n: any) => n.type === 'pool').id as string)
    const p0 = await nodePos(page, id)
    await clickNode(page, id)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => nodePos(page, id)).not.toEqual(p0)
    await page.keyboard.press('Control+z')
    await expect.poll(() => nodePos(page, id)).toEqual(p0)
    await nothingSelected(page)
    const before = await store(page)
    await page.keyboard.press('ArrowRight')
    expect(await nodePos(page, id)).toEqual(p0)
    expect((await store(page)).future, 'the redo branch is kept').toBe(before.future)
    await clickNode(page, id)
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveClass(/\bselected\b/)
    await expect.poll(async () => (await store(page)).ids).toEqual([id, null])
    // deselected before the undo of a second move: the undo brings no selection back
    await page.keyboard.press('ArrowRight')
    await clickEmpty(page)
    await page.keyboard.press('Control+z')
    await nothingSelected(page)
  })
})

/** the canvas marks are exactly the flagged elements */
async function marksMatchFlags(page: Page) {
  await expect
    .poll(async () => {
      const dom = await marks(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!).sort())
      return JSON.stringify(dom) === JSON.stringify([...(await store(page)).flagged].sort())
    })
    .toBe(true)
}

test.describe('a module insert restores its own selection (§MS3.5)', () => {
  test('undo: the node selected before the insert, in the Inspector too; redo: the inserted block', async ({ page }) => {
    await open(page)
    const id = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.find((n: any) => n.type === 'pool').id as string)
    await clickNode(page, id)
    await expect.poll(async () => (await store(page)).ids).toEqual([id, null])
    const before = (await store(page)).edges.length
    const menu = page.locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: 'Insert module' }) })
    await menu.getByRole('button', { name: 'Insert module' }).click()
    await menu.locator('.menu__item').filter({ has: page.locator('.menu__name', { hasText: 'Reward split loop' }) }).click()
    await expect.poll(async () => (await store(page)).edges.length).toBeGreaterThan(before)
    const inserted = [...(await store(page)).flagged].sort()
    expect(inserted).not.toContain(id)
    await marksMatchFlags(page)

    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await store(page)).flagged).toEqual([id])
    await expect.poll(async () => (await store(page)).ids).toEqual([id, null])
    await marksMatchFlags(page)
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveClass(/\bselected\b/)

    await page.keyboard.press('Control+y')
    await expect.poll(async () => [...(await store(page)).flagged].sort()).toEqual(inserted)
    await marksMatchFlags(page)

    // an ordinary step after it still ends with nothing selected
    await page.keyboard.press('Control+z')
    await clickEmpty(page)
    await clickEdge(page, 'e_treat')
    await reverse(page).click()
    await page.keyboard.press('Control+z')
    await nothingSelected(page)
  })
})
