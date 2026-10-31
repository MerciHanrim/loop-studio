import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #420 item (4) — one Undo entry per FIELD (Lumi, 2026-10-31), through the real
// Inspector. Confirming a name and then a capacity, quickly, are two actions:
// one Undo takes back only the capacity. The same holds for two fields of a
// connection, whose Inspector passes the whole `data` on every edit. Before:
// the tag was per node / per connection, so both edits within 600 ms were one
// entry and one Undo took both away.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const nodeData = (page: Page, id: string) =>
  page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.id === nid).data, id)
const edgeData = (page: Page, id: string) =>
  page.evaluate((eid) => (window as unknown as Bridge).__loop.graph.getState().edges.find((e: any) => e.id === eid).data, id)
const pastLength = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length as number)
const select = (page: Page, nodeId: string | null, edgeId: string | null) =>
  page.evaluate(([n, e]) => (window as unknown as Bridge).__loop.graph.getState().setSelection(n, e), [nodeId, edgeId] as const)
const undo = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true }).click()

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('a Pool: name, then capacity, confirmed quickly — Undo takes back only the capacity, a second Undo the name', async ({ page }) => {
  const id = await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    g.addNodeAt('pool', { x: 200, y: 100 })
    return (window as unknown as Bridge).__loop.graph.getState().nodes.at(-1).id as string
  })
  await page.waitForTimeout(700) // the add is its own entry
  await select(page, id, null)
  const panel = page.locator('.inspector')
  const name = panel.getByLabel('Label', { exact: true })
  const capacity = panel.getByLabel('Capacity (blank = unlimited)')
  const { label: name0, capacity: capacity0 } = await nodeData(page, id)
  const before = await pastLength(page)

  await name.fill('Gold')
  await capacity.fill('50')
  expect(await nodeData(page, id)).toMatchObject({ label: 'Gold', capacity: 50 })
  expect(await pastLength(page)).toBe(before + 2)

  await undo(page)
  const after1 = await nodeData(page, id)
  expect([after1.label, after1.capacity]).toEqual(['Gold', capacity0])
  await select(page, id, null) // Undo clears the selection — re-select to read the fields
  await expect(name).toHaveValue('Gold')
  await expect(capacity).toHaveValue('')

  await undo(page)
  expect((await nodeData(page, id)).label).toBe(name0)
})

test('a connection: flow, then resource type, confirmed quickly — Undo takes back only the resource type', async ({ page }) => {
  const id = await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    g.addNodeAt('pool', { x: 0, y: 100 })
    g.addNodeAt('pool', { x: 300, y: 100 })
    const [a, b] = (window as unknown as Bridge).__loop.graph.getState().nodes
    g.onConnect({ source: a.id, target: b.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    return (window as unknown as Bridge).__loop.graph.getState().edges.at(-1).id as string
  })
  await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setPanelDetailsOpen(true))
  await page.waitForTimeout(700)
  await select(page, null, id)
  const panel = page.locator('.inspector')
  const flow = panel.getByLabel('Flow', { exact: true })
  const resourceType = panel.getByLabel('Resource type (advisory)')
  const flow0 = (await edgeData(page, id)).flow
  const before = await pastLength(page)

  await flow.fill('3')
  await resourceType.fill('gold')
  expect(await edgeData(page, id)).toMatchObject({ flow: '3', resourceType: 'gold' })
  expect(await pastLength(page)).toBe(before + 2)

  await undo(page)
  const after1 = await edgeData(page, id)
  expect([after1.flow, after1.resourceType]).toEqual(['3', undefined])

  await undo(page)
  expect((await edgeData(page, id)).flow).toBe(flow0)
})
