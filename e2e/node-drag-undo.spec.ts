import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #408 — reproduction on current main, through the real pointer. One
// drag of a node: press, move, hold still for longer than the store's 600 ms
// coalescing window with the button down, move again, release. How many undo
// entries does the one gesture leave, and where does one Undo put the node?

type XY = { x: number; y: number }
type Bridge = {
  __loop: {
    graph: {
      getState: () => {
        nodes: { id: string; position: XY }[]
        past: unknown[]
        undo: () => void
      }
    }
  }
}

const NODE = 'ore_stock'
const state = (page: Page) =>
  page.evaluate((id) => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const n = g.nodes.find((x) => x.id === id)!
    return { past: g.past.length, pos: { x: n.position.x, y: n.position.y } }
  }, NODE)
const undo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())

test.describe('a node drag that pauses mid-gesture (#408)', () => {
  test('pointer: press, move, hold 900 ms, move, release — the history entries and where Undo lands', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    const node = page.locator(`.react-flow__node[data-id="${NODE}"]`)
    await expect(node).toHaveClass(/draggable/)
    const before = await state(page)

    const box = (await node.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 24, { steps: 8 })
    const atPause = await state(page)
    expect(atPause.pos).not.toEqual(before.pos) // the drag is under way
    expect(atPause.past).toBe(before.past + 1) // its one entry so far

    await page.waitForTimeout(900) // the hold, button down, longer than the window

    await page.mouse.move(cx + 120, cy + 72, { steps: 8 })
    await page.mouse.up()
    const released = await state(page)
    expect(released.pos).not.toEqual(atPause.pos)

    // current main: the move after the hold opened a SECOND entry at the pause
    // position, so one Undo lands mid-drag and a second one reaches the origin
    expect(released.past).toBe(before.past + 2)
    await undo(page)
    expect((await state(page)).pos).toEqual(atPause.pos)
    await undo(page)
    expect((await state(page)).pos).toEqual(before.pos)
  })

  test('control: the same drag without the hold is one entry; one Undo returns to the origin', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    const node = page.locator(`.react-flow__node[data-id="${NODE}"]`)
    const before = await state(page)
    const box = (await node.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 24, { steps: 8 })
    await page.mouse.move(cx + 120, cy + 72, { steps: 8 })
    await page.mouse.up()
    const released = await state(page)
    expect(released.pos).not.toEqual(before.pos)
    expect(released.past).toBe(before.past + 1)
    await undo(page)
    expect((await state(page)).pos).toEqual(before.pos)
  })
})
