import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// loop-model/4 (docs/specs/SEMANTICS-M4.md §M4-4; #471 U1 stage 2) — the two
// user paths that change what a field means: a unit change that is not exact
// waits for consent (cancel stores nothing, confirm stores the rounded value,
// one undo restores the authored one), an exact one applies at once; a step
// length change that moves a Converter's balance verdict names it and waits.

type Edge = { id: string; data?: { flow?: string; unit?: string } }
type GS = { edges: Edge[]; time?: { step: { value: number; unit: string } }; past: unknown[] }
const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return { edges: g.edges.map((e) => ({ id: e.id, data: e.data })), time: g.time, past: g.past }
  })
const feed = async (page: Page) => (await gs(page)).edges.find((e) => e.id === 'feed')!.data

/** sea (water, 2000 L) → RO → perm; water conserved, base m³, `L` and `MLD`;
 *  one step is 1 h */
function plant(feedFlow: string, feedUnit: string, outFlow: string): string {
  const pool = (id: string, x: number, extra: Record<string, unknown> = {}) => ({
    id, type: 'pool', position: { x, y: 0 },
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'water', ...extra },
  })
  return JSON.stringify({
    schema: 'loop-studio/graph/4', version: 1,
    nodes: [
      pool('sea', 0, { initial: 2000, unit: 'L' }),
      { id: 'ro', type: 'converter', position: { x: 256, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAll' } },
      pool('perm', 512),
    ],
    edges: [
      { id: 'feed', source: 'sea', target: 'ro', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: feedFlow, unit: feedUnit } },
      { id: 'out', source: 'ro', target: 'perm', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: outFlow } },
    ],
    kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'MLD', factor: '1000', per: 'd' }] }],
    time: { step: { value: 1, unit: 'h' } },
  })
}

const selectFeed = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: { graph: { setState: (s: object) => void } } }).__loop.graph.setState({ selectedEdgeId: 'feed', selectedNodeId: null }))
const unitSelect = (page: Page) =>
  page.locator('.inspector .field').filter({ has: page.locator('.field__label', { hasText: /^Unit$/ }) }).locator('select')

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('a unit change that is not exact waits: cancel stores nothing, confirm stores the rounded value, one undo restores it', async ({ page }) => {
  await importGraph(page, plant('7', 'L/d', '0.06'))
  await selectFeed(page)
  await expect(unitSelect(page)).toHaveValue('L/d')
  const pastBefore = (await gs(page)).past.length

  // 7 L/d in m³ per 1 h step is 7/24000 — it does not terminate
  await unitSelect(page).selectOption('')
  const sheet = page.getByRole('dialog', { name: 'Round the value?' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('≈ 0.000291666666666667')
  await expect(sheet).toContainText('0.000000000000000000333333333333333') // the deviation, in plain digits
  expect(await feed(page)).toMatchObject({ flow: '7', unit: 'L/d' })

  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toBeHidden()
  expect(await feed(page)).toMatchObject({ flow: '7', unit: 'L/d' })
  await expect(unitSelect(page)).toHaveValue('L/d')
  expect((await gs(page)).past.length).toBe(pastBefore)

  await unitSelect(page).selectOption('')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Store the rounded value' }).click()
  await expect(sheet).toBeHidden()
  const stored = await feed(page)
  expect(stored?.flow).toBe('0.000291666666666667')
  expect(stored?.unit).toBeUndefined()
  await expect(unitSelect(page)).toHaveValue('')
  expect((await gs(page)).past.length).toBe(pastBefore + 1)

  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect.poll(async () => (await feed(page))?.unit).toBe('L/d')
  expect((await feed(page))?.flow).toBe('7')
  // undo ends with nothing selected (graphStore `restoredSelection`); reselect to read the field
  await selectFeed(page)
  await expect(unitSelect(page)).toHaveValue('L/d')
})

test('an exact unit change applies at once, with no sheet', async ({ page }) => {
  await importGraph(page, plant('7', 'L/d', '0.06'))
  await selectFeed(page)
  // 7 L/d = 0.000007 MLD exactly
  await unitSelect(page).selectOption('MLD')
  await expect.poll(async () => (await feed(page))?.unit).toBe('MLD')
  expect((await feed(page))?.flow).toBe('0.000007')
  await expect(page.getByRole('dialog', { name: 'Round the value?' })).toHaveCount(0)
})

test('a step length change that moves a balance verdict names the Converter and waits; cancel keeps the step, confirm and undo', async ({ page }) => {
  // 1 L/min in, 0.06 m³ per step out: balanced at 1 h, broken at 1 min
  await importGraph(page, plant('1', 'L/min', '0.06'))
  const tab = page.locator('.wb-left [role="tab"]', { hasText: 'Inputs' })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const stepUnit = page.locator('.mpanel--kinds .mp-row--time select')
  await expect(stepUnit).toHaveValue('h')

  await stepUnit.selectOption('min')
  const sheet = page.getByRole('dialog', { name: 'Change the step length?' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('RO')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toBeHidden()
  expect((await gs(page)).time).toEqual({ step: { value: 1, unit: 'h' } })
  await expect(stepUnit).toHaveValue('h')

  await stepUnit.selectOption('min')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Change the step length' }).click()
  await expect(sheet).toBeHidden()
  expect((await gs(page)).time).toEqual({ step: { value: 1, unit: 'min' } })
  await expect(page.locator('.mpanel--kinds .mp-row--finding')).toContainText('RO')

  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect.poll(async () => (await gs(page)).time?.step.unit).toBe('h')
  await expect(stepUnit).toHaveValue('h')
})
