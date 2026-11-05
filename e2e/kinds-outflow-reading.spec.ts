import type { Page } from '@playwright/test'
import { unwrapIsolates } from '../src/i18n/bidiIsolate'
import { expect, importGraph, openApp, test } from './support/loop'
import { openInputsTab } from './support/workbenchMenus'

// SEMANTICS-M4.md §M4-9 (#471) — the Kinds panel reads a boundary outflow in a
// unit the person picks. The document here is built for this spec and is no
// bundled Template: a Pool drains 400 m³ a day on a 1 h step, so a row is
// 400/24 m³, which no decimal holds. The text rules are in src/model/viewUnits.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const STEPS = 3

function drained(display?: string): string {
  return JSON.stringify({
    schema: 'loop-studio/graph/4', version: 1,
    nodes: [
      { id: 'tank', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'automatic', initial: 100000, capacity: null, mode: 'pushAny', resourceType: 'water' } },
      { id: 'out', type: 'drain', position: { x: 320, y: 0 }, data: { kind: 'drain', label: 'Outlet', activation: 'automatic', mode: 'pullAny' } },
    ],
    edges: [{ id: 'e', source: 'tank', target: 'out', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '0.4', unit: 'MLD' } }],
    kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'MLD', factor: '1000', per: 'd' }] }],
    time: { step: { value: 1, unit: 'h' }, ...(display ? { display } : {}) },
  })
}

async function open(page: Page, display?: string) {
  await openApp(page)
  await importGraph(page, drained(display))
  await openInputsTab(page)
  await page.evaluate((steps) => {
    for (let i = 0; i < steps; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  }, STEPS)
  await expect(row(page)).toBeVisible()
}

const row = (page: Page) => page.locator('.mp-row--outflow').first()
const reading = (page: Page) => page.locator('.mp-row--reading select')
/** the text a reader sees: the isolates around each value are invisible */
const expectRow = (page: Page, text: string) => expect.poll(async () => unwrapIsolates(await row(page).innerText())).toBe(text)

/** everything a reading must leave alone */
const stored = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return JSON.stringify({ nodes: g.nodes, edges: g.edges, kinds: g.kinds, time: g.time, past: g.past.length, rev: g.simulationRev, series: s.series, values: s.values, step: s.stepIndex, outflow: s.boundaryOutflow })
  })

test('a reading changes the row and nothing stored, and the run is not reset', async ({ page }) => {
  await open(page)
  const before = await stored(page)
  await expectRow(page,'water into Outlet: 16.666666667 m³ per step')

  await reading(page).selectOption('MLD')
  await expectRow(page,'water into Outlet: ≈ 0.4 MLD')
  await reading(page).selectOption('L')
  await expectRow(page,'water into Outlet: ≈ 16666.6666666667 L per step')
  await reading(page).selectOption('m³/h')
  await expectRow(page,'water into Outlet: ≈ 16.6666666666667 m³/h')
  expect(await stored(page)).toBe(before)

  await reading(page).selectOption('')
  await expectRow(page,'water into Outlet: 16.666666667 m³ per step')
  expect(await stored(page)).toBe(before)
})

test('a document that declares time.display opens in it, and a base reading can still be chosen', async ({ page }) => {
  await open(page, 'd')
  await expect(reading(page)).toHaveValue('m³/d')
  await expectRow(page,'water into Outlet: ≈ 400 m³/d')
  await reading(page).selectOption('')
  await expectRow(page,'water into Outlet: 16.666666667 m³ per step')
})

test('the edit lock leaves the reading on, and a long row stays inside the panel', async ({ page }) => {
  await open(page)
  await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
  await reading(page).selectOption('L/s')
  await expect(row(page)).toContainText('L/s')
  const fits = await page.locator('.mpanel--kinds').evaluate((panel) => {
    const edge = panel.getBoundingClientRect().right
    return [...panel.querySelectorAll('.mp-row--outflow .mp-row__label, .mp-row--reading select')].every((el) => el.getBoundingClientRect().right <= edge + 0.5)
  })
  expect(fits).toBe(true)
})
