import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #344 Step 1 — docs/diagram-layout.md §DL1–§DL3: the 16 px grid, the
// resource port row fixed 28 px below a node's top, snapping for pointer drags
// (Alt = free), arrow keys (16 / Shift 64 px), frames (Ctrl / ⌘ = the frame
// alone), new nodes, the one-time conversion of a pre-grid file (no undo
// entry) and Tidy to grid (one undo entry).

type XY = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }
type Bridge = {
  __loop: {
    graph: { getState: () => { nodes: { id: string; position: XY; selected?: boolean; measured?: { width: number; height: number } }[]; canUndo: boolean; undo: () => void; tidyToGrid: () => number } }
    frame: { getState: () => { frames: { id: string; rect: Rect }[]; addFrame: (r: Rect) => string } }
    ui: { getState: () => { setCanvasLocked: (v: boolean) => void } }
    rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void }
  }
}
const onGrid = (p: XY) => Math.abs(p.x % 16) === 0 && Math.abs((p.y + 28) % 16) === 0

const POOL = (id: string, x: number, y: number, label = id) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label, initial: 0, capacity: null, mode: 'pullAny', activation: 'passive' } })
/** off-grid on purpose: the scene a user had before the grid */
const SCENE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [POOL('a', 3, 7), POOL('b', 205, 11), POOL('c', 410, 160, 'A much longer pool title that wraps')],
  edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
})

const positions = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as unknown as Bridge).__loop.graph.getState().nodes.map((n) => [n.id, { ...n.position }])))
const canUndo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)

async function load(page: Page, opts: { legacyLayout?: boolean } = {}) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, SCENE, opts)
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 120, y: 160, zoom: 1 }, { duration: 0 }))
  await page.waitForTimeout(250)
}

/** a real pointer drag on node `id` by (dx, dy) screen px (zoom 1) */
async function dragNode(page: Page, id: string, dx: number, dy: number, alt = false) {
  const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!
  const x0 = b.x + b.width / 2
  const y0 = b.y + 12
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 4 })
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 4 })
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(150)
}

test('a resource port sits 28 px below the node top, whatever the height, on the outline', async ({ page }) => {
  await load(page)
  const rows = await page.evaluate(() =>
    ['a', 'c'].map((id) => {
      const n = document.querySelector(`.react-flow__node[data-id="${id}"]`)!
      const box = n.querySelector('.nodef')!.getBoundingClientRect()
      const h = (sel: string) => n.querySelector(sel)!.getBoundingClientRect()
      const inH = h('.react-flow__handle.h--in'), outH = h('.react-flow__handle.h--out')
      return { id, height: box.height, inRow: inH.top + inH.height / 2 - box.top, outRow: outH.top + outH.height / 2 - box.top, inX: inH.left + inH.width / 2 - box.left, outX: box.right - (outH.left + outH.width / 2) }
    }),
  )
  expect(rows[1].height, 'c wraps to a taller box').toBeGreaterThan(rows[0].height + 10)
  for (const r of rows) {
    expect(Math.abs(r.inRow - 28), `${r.id} in`).toBeLessThan(0.6)
    expect(Math.abs(r.outRow - 28), `${r.id} out`).toBeLessThan(0.6)
    // a Pool's slanted sides: the port is drawn on the outline, inside the box edge
    expect(r.inX, `${r.id} in on the outline`).toBeGreaterThan(8)
    expect(r.outX, `${r.id} out on the outline`).toBeGreaterThan(8)
  }
})

test('a pointer drag lands on the grid; Alt held moves freely and the free position is kept', async ({ page }) => {
  await load(page)
  await dragNode(page, 'a', 37, 23)
  const p1 = await positions(page)
  expect(onGrid(p1.a)).toBe(true)
  await dragNode(page, 'b', 37, 23, true)
  const p2 = await positions(page)
  expect(onGrid(p2.b)).toBe(false)
  // free: the pointer's own Δ (less React Flow's few-px drag threshold)
  expect(Math.abs(p2.b.x - (205 + 37))).toBeLessThan(6)
  expect(Math.abs(p2.b.y - (11 + 23))).toBeLessThan(6)
  // and kept: re-reading later changes nothing
  await page.waitForTimeout(300)
  expect((await positions(page)).b).toEqual(p2.b)
})

test('a selection moves as a group: the grabbed node lands on the grid, offsets are kept', async ({ page }) => {
  await load(page)
  const p0 = await positions(page)
  await page.locator('.react-flow__node[data-id="a"]').click()
  await page.locator('.react-flow__node[data-id="b"]').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await dragNode(page, 'a', 50, 31)
  const p1 = await positions(page)
  expect(onGrid(p1.a)).toBe(true)
  expect({ x: p1.b.x - p1.a.x, y: p1.b.y - p1.a.y }).toEqual({ x: p0.b.x - p0.a.x, y: p0.b.y - p0.a.y })
})

test('the arrow keys move by one grid step, Shift by four, onto the grid', async ({ page }) => {
  await load(page)
  await page.locator('.react-flow__node[data-id="a"]').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  const p1 = (await positions(page)).a
  expect(onGrid(p1)).toBe(true)
  await page.keyboard.press('ArrowRight')
  expect((await positions(page)).a).toEqual({ x: p1.x + 16, y: p1.y })
  await page.keyboard.press('Shift+ArrowDown')
  expect((await positions(page)).a).toEqual({ x: p1.x + 16, y: p1.y + 64 })
})

test('a frame drag lands on the grid; Ctrl / Command moves the frame alone; Alt moves it freely', async ({ page }) => {
  await load(page)
  const id = await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().addFrame({ x: -45, y: -37, w: 520, h: 140 }))
  const rect = () => page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().frames.find((f) => f.id === fid)!.rect, id)
  const strip = page.locator('.lgr-frame').first().locator('.lgr-frame__edge-hit--top')
  const drag = async (dx: number, dy: number, mod?: 'Control' | 'Alt') => {
    const b = (await strip.boundingBox())!
    const x0 = b.x + 40, y0 = b.y + b.height / 2
    if (mod) await page.keyboard.down(mod)
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0 + dx, y0 + dy, { steps: 6 })
    await page.mouse.up()
    if (mod) await page.keyboard.up(mod)
    await page.waitForTimeout(150)
  }
  const n0 = await positions(page)
  await drag(30, 21)
  const r1 = await rect()
  expect(Math.abs(r1.x % 16)).toBe(0)
  expect(Math.abs(r1.y % 16)).toBe(0)
  const n1 = await positions(page)
  expect(n1.a, 'a node inside rides along by the same Δ').toEqual({ x: n0.a.x + (r1.x + 45), y: n0.a.y + (r1.y + 37) })
  await drag(32, 0, 'Control')
  expect((await rect()).x).toBe(r1.x + 32)
  expect(await positions(page), 'Ctrl: the frame alone').toEqual(n1)
  await drag(5, 3, 'Alt')
  expect((await rect()).x).toBe(r1.x + 32 + 5)
})

test('a palette click places the new node on the grid, clear of the nodes already there', async ({ page }) => {
  await load(page)
  await page.getByRole('button', { name: /^Pool/ }).first().click()
  const nodes = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.map((n) => ({ id: n.id, ...n.position })))
  const added = nodes.find((n) => !['a', 'b', 'c'].includes(n.id))!
  expect(onGrid(added)).toBe(true)
})

test('a pre-grid file is re-placed once when it is opened, with no undo entry', async ({ page }) => {
  await load(page, { legacyLayout: true })
  const p = await positions(page)
  for (const id of ['a', 'b', 'c']) expect(onGrid(p[id]), id).toBe(true)
  expect(await canUndo(page)).toBe(false)
  // the two connected Pools' port rows (35 and 39) share one row
  expect(p.a.y).toBe(p.b.y)
})

test('Tidy to grid re-places the document as one undo step, and is disabled while locked', async ({ page }) => {
  await load(page)
  const button = page.locator('.react-flow__controls .rf-tidy')
  await expect(button).toBeEnabled()
  await button.click()
  const p1 = await positions(page)
  for (const id of ['a', 'b', 'c']) expect(onGrid(p1[id]), id).toBe(true)
  expect(await canUndo(page)).toBe(true)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  expect((await positions(page)).a).toEqual({ x: 3, y: 7 })
  await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
  await expect(button).toBeDisabled()
})
