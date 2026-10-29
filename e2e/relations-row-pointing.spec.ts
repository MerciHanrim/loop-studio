import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// The properties panel's Relations rows (src/components/workbench/Relations.tsx):
// pointing at a row identifies its line on the canvas (`edge-hover`); a click
// SELECTS that line, and the panel then shows the line instead of the node, so
// the row goes away under the pointer. Its pointing goes with it: the line stays
// selected, and it is not left drawn as pointed at once the pointer is elsewhere.
//
// Also: Relations reads the model and changes nothing, so under the edit lock
// its rows still select (a line, either end of it), and the document stays as
// it was.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const node = (id: string, kind: string, data: Record<string, unknown>, x: number, y: number) => ({ id, type: kind, position: { x, y }, data: { kind, label: id, ...data } })
const res = (id: string, s: string, t: string) => ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
const DOC = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [
    node('src', 'source', { label: 'Supply', activation: 'automatic' }, 0, 0),
    node('pool', 'pool', { label: 'Store', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 320, 0),
    node('sink', 'drain', { label: 'Use', activation: 'automatic' }, 640, 0),
  ],
  edges: [res('e_in', 'src', 'pool'), res('e_out', 'pool', 'sink')],
})

const panel = (page: Page) => page.locator('.app__body > :last-child')
const pick = async (page: Page, name: string) => {
  await page.locator('.wb-left').getByText(name, { exact: true }).first().click()
  await expect(panel(page).locator('.wb-rel')).toBeVisible()
}
const state = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    return {
      hover: l.ui.getState().hoverEdgeId as string | null,
      selectedEdges: (l.graph.getState().edges as { id: string; selected?: boolean }[]).filter((e) => e.selected).map((e) => e.id),
      selectedNodes: (l.graph.getState().nodes as { id: string; selected?: boolean }[]).filter((n) => n.selected).map((n) => n.id),
      drawnHover: [...document.querySelectorAll('.react-flow__edge-path.edge-hover')].map((p) => p.closest('.react-flow__edge')?.getAttribute('data-id')),
    }
  })
const doc = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return JSON.stringify({ nodes: g.nodes.map((n: any) => ({ id: n.id, p: n.position, d: n.data })), edges: g.edges.map((e: any) => ({ id: e.id, s: e.source, t: e.target, d: e.data })) })
  })

// issue #393 C — "Connections that use this value" came from a substring test
// (`expr.includes('@' + id)` / `flow === '@' + id`): a Parameter whose id is
// the start of another's listed the other's connections, and the `@{id}`
// spelling was never listed. The rows now come from the same parsed,
// exact-id scanner the delete check uses (`findReferences`).
test.describe('Relations — connections that use a Parameter (#393 C)', () => {
  const PARAMS = JSON.stringify({
    schema: 'loop-studio/graph/2',
    version: 1,
    nodes: [
      node('a', 'parameter', { label: 'a', value: 2 }, 0, 200),
      node('ab', 'parameter', { label: 'ab', value: 3 }, 0, 320),
      node('src', 'source', { label: 'Supply', activation: 'automatic' }, 0, 0),
      node('pool', 'pool', { label: 'Store', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 320, 0),
      node('sink', 'drain', { label: 'Use', activation: 'automatic' }, 640, 0),
    ],
    edges: [
      { ...res('e_ab', 'src', 'pool'), data: { kind: 'resource', flow: '@ab' } },
      { ...res('e_a_braced', 'pool', 'sink'), data: { kind: 'resource', flow: '@{a}' } },
      // an activator reading `ab`: the old `expr.includes('@a')` listed it under `a`
      { id: 'e_act_ab', source: 'pool', target: 'sink', type: 'loop', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>=@ab' } },
    ],
  })
  const usesRows = (page: Page) => panel(page).locator('.wb-rel__sec[aria-label="Connections that use this value"] .wb-rel__row')
  const rowEdges = (page: Page) => usesRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-edge')))
  // the plain click (not `pick`): with no row at all the panel shows "none" and `.wb-rel` is absent
  const select = (page: Page, name: string) => page.locator('.wb-left').getByText(name, { exact: true }).first().click()

  test('`a` lists only the `@{a}` connection; `ab` lists its flow and its activator', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, PARAMS)
    await select(page, 'a')
    await expect.poll(() => rowEdges(page), 'a: the braced reference, and not ab’s activator').toEqual(['e_a_braced'])
    await select(page, 'ab')
    await expect.poll(() => rowEdges(page), 'ab: its flow and its activator').toEqual(['e_ab', 'e_act_ab'])
  })
})

test.describe('Relations rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, DOC)
  })

  test('a row pointed at, then clicked: the line stays selected, its pointing ends with the row', async ({ page }) => {
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_out"]')
    await row.hover()
    await expect.poll(async () => (await state(page)).hover, 'pointing at the row identifies its line').toBe('e_out')
    await row.click()
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    // the pointer moves off, to the panel's empty foot (no line under it)
    const box = (await panel(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8)
    const s = await state(page)
    expect(s.selectedEdges, 'the click selected the line').toEqual(['e_out'])
    expect(s.hover, 'no line is left pointed at').toBeNull()
    expect(s.drawnHover).toEqual([])
    // and once the line is deselected, nothing is drawn as pointed at either
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, null)
      g.onEdgesChange(g.edges.filter((e: { selected?: boolean }) => e.selected).map((e: { id: string }) => ({ id: e.id, type: 'select', selected: false })))
    })
    await expect.poll(async () => (await state(page)).drawnHover).toEqual([])
  })

  test('a row reached by the keyboard: focus identifies the line, Enter selects it, and nothing is left pointed at', async ({ page }) => {
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_in"]')
    await row.focus()
    await expect.poll(async () => (await state(page)).hover).toBe('e_in')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    const s = await state(page)
    expect(s.selectedEdges).toEqual(['e_in'])
    expect(s.hover).toBeNull()
  })

  test('under the edit lock: a row selects its line and each end selects its node; the document does not change', async ({ page }) => {
    const before = await doc(page)
    await page.locator('.wb-toolrow [data-tool="lock"]').click()
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(1)
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_out"]')
    await expect(row).toBeEnabled()
    await row.click()
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    expect((await state(page)).selectedEdges).toEqual(['e_out'])
    const ends = panel(page).locator('.wb-rel__link')
    await expect(ends).toHaveCount(2)
    await expect(ends.nth(1)).toBeEnabled()
    await ends.nth(1).click()
    await expect.poll(async () => (await state(page)).selectedNodes).toEqual(['sink'])
    // the panel's editing fields stay locked
    await expect(panel(page).locator('input:not([type="hidden"]), select, textarea').first()).toBeDisabled()
    expect(await doc(page), 'reading under the lock changes nothing in the document').toBe(before)
  })
})
