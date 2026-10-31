import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #408 — a node pointer drag is ONE undo transaction (Lumi, 2026-10-30):
// the Canvas opens it at React Flow's drag start and closes it at the stop,
// which pushes one entry if a position changed. Until v0.31.0 the drag leaned
// on the store's 600 ms coalescing window, so a hold longer than that mid-drag
// (button down, pointer still) opened a second entry at the pause position
// and one Undo landed mid-drag. The real pointer here, through React Flow.

type XY = { x: number; y: number }
type Bridge = {
  __loop: {
    graph: {
      getState: () => {
        nodes: { id: string; position: XY; selected?: boolean }[]
        past: unknown[]
        future: unknown[]
        undo: () => void
        redo: () => void
      }
    }
    ui: { getState: () => { setCanvasLocked: (v: boolean) => void } }
  }
}

const NODE = 'ore_stock'
const OTHER = 'components'
const state = (page: Page) =>
  page.evaluate(
    ([a, b]) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const at = (id: string) => {
        const n = g.nodes.find((x) => x.id === id)!
        return { x: n.position.x, y: n.position.y }
      }
      return { past: g.past.length, future: g.future.length, pos: at(a), other: at(b), selected: g.nodes.filter((n) => n.selected).map((n) => n.id).sort() }
    },
    [NODE, OTHER] as const,
  )
const undo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
const redo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().redo())

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  const node = page.locator(`.react-flow__node[data-id="${NODE}"]`)
  await expect(node).toHaveClass(/draggable/)
  const box = (await node.boundingBox())!
  return { node, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

test.describe('a node drag is one undo transaction (#408)', () => {
  test('press, move, hold 900 ms, move, release: ONE entry; one Undo returns to the origin, Redo to the drop', async ({ page }) => {
    const { cx, cy } = await load(page)
    const before = await state(page)

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 24, { steps: 8 })
    const atPause = await state(page)
    expect(atPause.pos).not.toEqual(before.pos) // the drag is under way
    expect(atPause.past).toBe(before.past) // and nothing is recorded yet

    // #424 — a deliberate time wait: the hold IS the check. 900 ms, button
    // down, is longer than the store's 600 ms coalescing window the drag once
    // leaned on; there is no state to wait for, the pointer is still.
    await page.waitForTimeout(900)

    await page.mouse.move(cx + 120, cy + 72, { steps: 8 })
    await page.mouse.up()
    const released = await state(page)
    expect(released.pos).not.toEqual(atPause.pos)
    expect(released.past).toBe(before.past + 1)

    await undo(page)
    const undone = await state(page)
    expect(undone.pos).toEqual(before.pos)
    expect(undone.past).toBe(before.past) // the drag's entry was the only one taken
    await redo(page)
    expect((await state(page)).pos).toEqual(released.pos)
  })

  test('the same drag without the hold: one entry too', async ({ page }) => {
    const { cx, cy } = await load(page)
    const before = await state(page)
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

  test('a multi-selection drag with a hold: the two nodes move together, one entry, one Undo restores both', async ({ page }) => {
    const { cx, cy } = await load(page)
    await page.locator(`.react-flow__node[data-id="${OTHER}"]`).click()
    await page.locator(`.react-flow__node[data-id="${NODE}"]`).click({ modifiers: ['Control'] }) // React Flow's multi-selection key
    const before = await state(page)
    expect(before.selected).toEqual([OTHER, NODE].sort())

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 24, { steps: 8 })
    await page.waitForTimeout(900) // #424 — kept: the hold past the 600 ms window, as in the first case
    await page.mouse.move(cx + 120, cy + 72, { steps: 8 })
    await page.mouse.up()
    const released = await state(page)
    expect(released.pos).not.toEqual(before.pos)
    expect(released.other).not.toEqual(before.other)
    expect(released.past).toBe(before.past + 1)

    await undo(page)
    const undone = await state(page)
    expect(undone.pos).toEqual(before.pos)
    expect(undone.other).toEqual(before.other)
  })

  test('a drag that comes back to its origin records nothing', async ({ page }) => {
    const { node, cx, cy } = await load(page)
    // a drop lands on the 16 px grid (§DL3), so first put the node ON the grid
    // with one plain drag (one entry); the out-and-back then really ends where
    // it began
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 24, { steps: 8 })
    await page.mouse.up()
    const before = await state(page)
    expect(before.pos.x % 16).toBe(0)
    const box = (await node.boundingBox())!
    const gx = box.x + box.width / 2
    const gy = box.y + box.height / 2

    await page.mouse.move(gx, gy)
    await page.mouse.down()
    // React Flow measures the drag from its FIRST move event (here the first
    // of the 8 steps, +10 / +6), not from the press point; coming back to
    // that point is a net offset of zero, and a zero offset of an on-grid
    // node snaps to itself
    await page.mouse.move(gx + 80, gy + 48, { steps: 8 })
    await page.waitForTimeout(900) // #424 — kept: the hold past the 600 ms window, as in the first case
    await page.mouse.move(gx + 10, gy + 6, { steps: 8 })
    await page.mouse.up()
    const released = await state(page)
    expect(released.pos).toEqual(before.pos)
    expect(released.past).toBe(before.past)
  })

  test('under the edit lock a drag moves nothing and records nothing', async ({ page }) => {
    const { cx, cy } = await load(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
    const before = await state(page)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 120, cy + 72, { steps: 8 })
    await page.mouse.up()
    const after = await state(page)
    expect(after.pos).toEqual(before.pos)
    expect(after.past).toBe(before.past)
  })
})
