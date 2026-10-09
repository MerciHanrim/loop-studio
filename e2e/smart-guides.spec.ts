import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/diagram-layout.md §DL3.6 (issue #344, Lumi 2026-10-10) — smart guides:
// a drag lands by the port row of a nearby node, then its centre / edges, then
// the 16 px grid; the guides show where during the drag; the grabbed point
// never changes the result; Alt shows them faint and pulls nothing; a selection
// uses its bounding box; an arrow-key move shows its row and column briefly.

type XY = { x: number; y: number }
const POOL = (id: string, x: number, y: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, initial: 0, capacity: null, mode: 'pullAny', activation: 'passive' } })
/** `t`'s port row is at 103 + 28 = 131: off the grid (128 / 144) on purpose */
const SCENE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [POOL('m', 0, 0), POOL('n', 0, 320), POOL('t', 480, 103), POOL('c', 800, 520)],
  edges: [],
})

const positions = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as any).__loop.graph.getState().nodes.map((n: { id: string; position: XY }) => [n.id, { ...n.position }])) as Record<string, XY>)

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, SCENE)
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 100, y: 100, zoom: 1 }, { duration: 0 }))
  await page.waitForTimeout(250)
}

/** a pointer drag of `id` by (dx, dy) screen px, grabbed at `grab` (fractions
 *  of the node box); `during` runs before the button is released */
async function drag(page: Page, id: string, dx: number, dy: number, opts: { grab?: XY; alt?: boolean; during?: () => Promise<void> } = {}) {
  const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!
  const g = opts.grab ?? { x: 0.5, y: 0.2 }
  const x0 = b.x + b.width * g.x
  const y0 = b.y + b.height * g.y
  if (opts.alt) await page.keyboard.down('Alt')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  // start the drag with a nudge: React Flow measures from where the drag
  // STARTS, so a long first step would be lost from the move
  await page.mouse.move(x0 + 1, y0 + 1)
  await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 4 })
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 4 })
  await opts.during?.()
  await page.mouse.up()
  if (opts.alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(120)
}

test.describe('smart guides — issue #344 §DL3.6', () => {
  test('a drag near another node’s port row lands ON it (before the grid), with a strong guide to that node during the drag', async ({ page }) => {
    await load(page)
    let seen: { at: string | null; strong: boolean } | null = null
    await drag(page, 'm', 160, 102, {
      during: async () => {
        const g = page.locator('.smart-guide--port.is-strong')
        await expect(g).toHaveCount(1)
        seen = { at: await g.getAttribute('data-at'), strong: true }
      },
    })
    expect(seen).toEqual({ at: '131', strong: true })
    const p = (await positions(page)).m
    expect(p.y + 28).toBe(131) // the port rows line up: 103, not the grid's 100
    expect(p.x % 16).toBe(0) // nothing to align with across: the grid
    await expect(page.locator('.smart-guides')).toHaveCount(0) // gone at the drop
  })

  test('where the node is grabbed never changes where it lands', async ({ page }) => {
    await load(page)
    await drag(page, 'm', 160, 102, { grab: { x: 0.15, y: 0.15 } })
    const a = (await positions(page)).m
    await load(page)
    await drag(page, 'm', 160, 102, { grab: { x: 0.85, y: 0.8 } })
    const b = (await positions(page)).m
    expect(b).toEqual(a)
  })

  test('far from any node, a drag lands on the 16 px grid, with only the placement lines', async ({ page }) => {
    await load(page)
    await drag(page, 'm', 37, 211, {
      during: async () => {
        await expect(page.locator('.smart-guide--place')).toHaveCount(2)
        await expect(page.locator('.smart-guide.is-strong')).toHaveCount(0)
      },
    })
    const p = (await positions(page)).m
    expect(p.x % 16).toBe(0)
    expect((p.y + 28) % 16).toBe(0)
  })

  test('Alt shows the guides faint and pulls nothing', async ({ page }) => {
    await load(page)
    await drag(page, 'm', 160, 102, {
      alt: true,
      during: async () => {
        await expect(page.locator('.smart-guides.is-faint')).toHaveCount(1)
      },
    })
    const p = (await positions(page)).m
    expect(p.y + 28).not.toBe(131)
    expect(Math.abs(p.y - 102)).toBeLessThan(6) // the pointer's own Δ (less React Flow's drag threshold)
  })

  test('a selection is guided by its bounding box: its centre lines up with a node’s centre', async ({ page }) => {
    await load(page)
    await page.locator('.react-flow__node[data-id="m"]').click()
    await page.locator('.react-flow__node[data-id="n"]').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    const before = await positions(page)
    const h = await page.evaluate(() => (window as any).__loop.graph.getState().nodes.find((x: any) => x.id === 'c').measured.height as number)
    const selH = before.n.y + h - before.m.y // both pools are the same height
    // aim the selection's centre-y close to `c`'s centre-y (520 + h / 2)
    const want = 520 + h / 2 - (before.m.y + selH / 2)
    await drag(page, 'm', 300, want + 3)
    const after = await positions(page)
    expect(after.n.y - after.m.y).toBe(before.n.y - before.m.y) // offsets kept
    expect(after.m.y + selH / 2).toBe(520 + h / 2)
  })

  test('an arrow-key move shows its row and column briefly, then the guides go', async ({ page }) => {
    await load(page)
    await page.locator('.react-flow__node[data-id="m"]').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.smart-guide--place')).toHaveCount(2)
    await expect(page.locator('.smart-guides')).toHaveCount(0, { timeout: 4000 })
  })

  test('the guides are drawn 1 screen px wide at any zoom, and never take a pointer', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 100, y: 100, zoom: 2 }, { duration: 0 }))
    await page.waitForTimeout(200)
    await drag(page, 'm', 160, 100, {
      during: async () => {
        const css = await page.locator('.smart-guide').first().evaluate((el) => ({ ve: getComputedStyle(el).getPropertyValue('vector-effect'), pe: getComputedStyle(el.parentElement!).pointerEvents }))
        expect(css).toEqual({ ve: 'non-scaling-stroke', pe: 'none' })
      },
    })
  })
})
