import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// SEMANTICS-M5.md §M5-10 — a Template that holds a timetable, opened from the menu as a
// person opens it, and stepped with the real button. Import has its own path, so a file
// that runs by import proved nothing here: the Template path once dropped the table, and
// the run refused it. No bundled Template holds a table yet, so the dev server's module
// for one Template is answered with this document.

type Bridge = { __loop: Record<string, any> }

const pool = (id: string, x: number, initial: number) => ({ id, type: 'pool', position: { x, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny', resourceType: 'water' } })
const line = (id: string, source: string, target: string, flow: string, unit?: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, ...(unit ? { unit } : {}) } })

const DOCUMENT = {
  schema: 'loop-studio/graph/6',
  version: 1,
  nodes: [
    pool('feed', 0, 1000),
    { id: 'ro', type: 'converter', position: { x: 260, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny', run: { table: 'demand', rated: 'made' } } },
    pool('store', 520, 0),
  ],
  edges: [line('in', 'feed', 'ro', '100', 'CMH'), line('made', 'ro', 'store', '100', 'CMH')],
  kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
  time: { step: { value: 1, unit: 'h' } },
  timetables: [{ id: 'demand', label: 'Demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }],
  recommendedRunConfig: { timelineSeries: ['store'] },
}

const answerTemplate = (page: Page) =>
  page.route('**/examples/desalination.json*', (route) => route.fulfill({ contentType: 'text/javascript', body: `export default ${JSON.stringify(DOCUMENT)}` }))

const opened = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return { version: g.modelVersion as number, tables: (g.timetables as { id: string }[]).map((t) => t.id), series: l.sim.getState().timelineSeries as unknown, store: l.sim.getState().values?.store as number | undefined }
  })

test('a Template with a timetable opens from the menu and steps', async ({ page }) => {
  await answerTemplate(page)
  await openApp(page)
  await pickTemplate(page, 'desalination')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(3)

  const state = await opened(page)
  expect(state.version).toBe(6)
  expect(state.tables).toEqual(['demand'])
  expect(state.series).toEqual(['store'])
  await expect(page.getByText(/Can.t run/)).toHaveCount(0)

  // the real control, twice: what arrives in a step reaches the tank at its end
  await page.getByRole('button', { name: 'Advance one step' }).click()
  await expect.poll(async () => (await opened(page)).store).toBe(25)
  await page.getByRole('button', { name: 'Advance one step' }).click()
  await expect.poll(async () => (await opened(page)).store).toBe(50)
  await expect(page.locator('[data-stage-tag="ro"]')).toContainText('Demand')
})
