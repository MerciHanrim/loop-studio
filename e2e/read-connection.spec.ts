import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// SEMANTICS-M6.md §M6-7 — the read connection on the real canvas. It is drawn from the
// rule and exists nowhere else: not in the document, its digest, the undo history, the
// run or a connection list. The router's cases are in src/model/readEdges.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const pool = (id: string, x: number, y: number, initial: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny', resourceType: 'water' } })
const line = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '10', route: 'orthogonal' } })

const plant = (run: unknown) =>
  JSON.stringify({
    schema: 'loop-studio/graph/6', version: 1,
    nodes: [
      pool('feed', 0, 0, 1000),
      { id: 'ro', type: 'converter', position: { x: 260, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny', ...(run ? { run } : {}) } },
      pool('store', 520, 0, 0),
    ],
    edges: [line('in', 'feed', 'ro'), line('out', 'ro', 'store')],
    kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [] }],
  })
const RULE = { tank: 'store', level: '50', band: '10', side: 'fill' }

const graph = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as Bridge).__loop.graph.getState()
  return { edges: g.edges.map((e: { id: string }) => e.id) as string[], node: g.selectedNodeId as string | null, edge: g.selectedEdgeId as string | null, canUndo: g.canUndo as boolean, doc: g.exportJSON() as string }
})
const read = (page: Page) => page.locator('[data-read-edge="read:ro"]')

test('a rule on a tank draws a dash-dot line with no arrow and no chip', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(RULE))
  await expect(read(page)).toHaveCount(1)
  const style = await read(page).locator('.read-edge__line').evaluate((el) => {
    const s = getComputedStyle(el)
    return { dash: s.strokeDasharray, marker: el.getAttribute('marker-end') }
  })
  expect(style.dash.replace(/px/g, '').replace(/,/g, '')).toBe('10 4 2 4')
  expect(style.marker).toBeNull()
  await expect(read(page).locator('.read-edge__ring')).toHaveCount(1)
  await expect(page.locator('.edge-label[data-edge-id^="read:"]')).toHaveCount(0)
})

test('no rule on a tank draws none', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(null))
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  await expect(page.locator('[data-read-edge]')).toHaveCount(0)
})

test('a click on the line selects the stage and nothing else', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(RULE))
  await expect(read(page)).toHaveCount(1)
  const before = await graph(page)
  const box = (await read(page).locator('.read-edge__line').boundingBox())!
  // the line's own top run, clear of both ends
  await page.mouse.click(box.x + box.width / 2, box.y + (box.height < 4 ? box.height / 2 : 0.75))
  await expect.poll(async () => (await graph(page)).node).toBe('ro')
  const after = await graph(page)
  expect(after.edge).toBeNull()
  expect(after.canUndo).toBe(before.canUndo)
  expect(after.doc).toBe(before.doc)
  await expect(read(page)).toHaveClass(/is-related/)
})

test('it stays out of the document, the undo history, the run and the connection lists', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(RULE))
  await expect(read(page)).toHaveCount(1)
  const g = await graph(page)
  expect(g.edges).toEqual(['in', 'out'])
  expect(g.doc).not.toContain('read:')
  expect(g.doc).not.toContain('readPort')
  expect(g.canUndo).toBe(false)
  // the run: nothing it reports or records names the line
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().values?.store)).toBeGreaterThan(0)
  const ran = await page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return JSON.stringify(s, (_k, v) => (typeof v === 'function' ? undefined : v))
  })
  expect(ran).not.toContain('read:')
  expect(await graph(page).then((x) => x.doc)).toBe(g.doc)
  // the run's file holds the two Pools and the stage's rule, and no line
  const csvBtn = page.locator('.timeline__csv').filter({ hasNotText: /▾/ }).first()
  await expect(csvBtn).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), csvBtn.click()])
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).not.toContain('read:')
  // the stage's Relations list holds its two document lines
  await page.locator('.react-flow__node[data-id="ro"]').click()
  await expect(page.locator('.wb-rel__row')).toHaveCount(2)
})

test('it goes when the rule goes', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(RULE))
  await expect(read(page)).toHaveCount(1)
  await importGraph(page, plant(null))
  await expect(page.locator('[data-read-edge]')).toHaveCount(0)
})
