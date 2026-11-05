import type { Page } from '@playwright/test'
import { unwrapIsolates } from '../src/i18n/bidiIsolate'
import { expect, importGraph, openApp, test } from './support/loop'
import { openInputsTab } from './support/workbenchMenus'

// SEMANTICS-M4.md §M4-10 (#471) — the Inspector reads through the choices the
// Timeline and the Kinds panel already hold. The document here is built for this
// spec and is no bundled Template. The text rules are in src/model/viewUnits.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const DOCUMENT = JSON.stringify({
  schema: 'loop-studio/graph/4', version: 1,
  nodes: [
    { id: 'tank', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'automatic', initial: 200, capacity: 500, mode: 'pushAny', resourceType: 'water' } },
    { id: 'out', type: 'drain', position: { x: 320, y: 0 }, data: { kind: 'drain', label: 'Outlet', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [{ id: 'e', source: 'tank', target: 'out', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '0.4', unit: 'MLD' } }],
  kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'MLD', factor: '1000', per: 'd' }] }],
  time: { step: { value: 1, unit: 'h' } },
})

async function open(page: Page) {
  await openApp(page)
  await importGraph(page, DOCUMENT)
}

const select = (page: Page, kind: 'node' | 'edge', id: string) =>
  page.evaluate(([k, x]) => (window as unknown as Bridge).__loop.graph.getState().setSelection(k === 'node' ? x : null, k === 'edge' ? x : null), [kind, id])

const setViewUnit = (page: Page, unit: string) => page.evaluate((u) => (window as unknown as Bridge).__loop.viewUnits.getState().setViewUnit('water', u), unit)
const setReading = (page: Page, reading: string) => page.evaluate((r) => (window as unknown as Bridge).__loop.viewUnits.getState().setOutflowView('water', r), reading)

const amount = (page: Page) => page.getByLabel('Current amount', { exact: true })
const hints = (page: Page) => page.locator('.field__hint--unit')
const hintTexts = async (page: Page) => (await hints(page).allInnerTexts()).map(unwrapIsolates)

/** everything a reading must leave alone */
const stored = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return JSON.stringify({ nodes: g.nodes.map((n: { id: string; data: unknown }) => [n.id, n.data]), edges: g.edges.map((e: { id: string; data: unknown }) => [e.id, e.data]), kinds: g.kinds, time: g.time, past: g.past.length, rev: g.simulationRev, series: s.series, values: s.values, step: s.stepIndex })
  })

test('the current amount follows the Timeline view unit, and nothing stored moves', async ({ page }) => {
  await open(page)
  await select(page, 'node', 'tank')
  await expect(amount(page)).toHaveValue('200')
  await expect(hints(page)).toHaveCount(0)

  const before = await stored(page)
  await setViewUnit(page, 'L')
  await expect(amount(page)).toHaveValue('200000 L')
  await expect.poll(() => hintTexts(page)).toEqual(['= 200000 L', '= 500000 L'])
  expect(await stored(page)).toBe(before)

  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
  await expect(amount(page)).toHaveValue('≈ 183333.333333333 L')

  // during a run too: the step, the values and the series stay where they are
  const running = await stored(page)
  await setViewUnit(page, '')
  await expect(amount(page)).toHaveValue('183.33')
  await expect(hints(page)).toHaveCount(0)
  expect(await stored(page)).toBe(running)
})

test('a field keeps its name, and points at its hint', async ({ page }) => {
  await open(page)
  await select(page, 'node', 'tank')
  await setViewUnit(page, 'L')
  const field = page.getByLabel('Starting amount', { exact: true })
  await expect(field).toHaveValue('200')
  const id = await field.getAttribute('aria-describedby')
  expect(unwrapIsolates(await page.locator(`[id="${id}"]`).innerText())).toBe('= 200000 L')
  // a line of text: nothing in it takes focus or input
  await expect(hints(page).locator('input, select, textarea, button, [contenteditable], [tabindex]')).toHaveCount(0)
})

test('a rate reads in the Kinds panel reading, and only a plain number has a hint', async ({ page }) => {
  await open(page)
  await select(page, 'edge', 'e')
  await expect.poll(() => hintTexts(page)).toEqual(['≈ 16.6666666666667 m³ per step'])

  const before = await stored(page)
  await setReading(page, 'L/min')
  await expect.poll(() => hintTexts(page)).toEqual(['≈ 277.777777777778 L/min'])
  await setReading(page, 'MLD')
  await expect(hints(page)).toHaveCount(0)
  expect(await stored(page)).toBe(before)

  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
  const running = await stored(page)
  await setReading(page, 'L/min')
  await expect.poll(() => hintTexts(page)).toEqual(['≈ 277.777777777778 L/min'])
  expect(await stored(page)).toBe(running)

  await page.locator('.field').filter({ hasText: 'Flow' }).locator('input').first().fill('all')
  await expect(hints(page)).toHaveCount(0)
})

test('the reading set in its own panel reaches the Inspector', async ({ page }) => {
  await open(page)
  await openInputsTab(page)
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  })
  await page.locator('.mp-row--reading select').selectOption('MLD')
  await select(page, 'edge', 'e')
  await expect(hints(page)).toHaveCount(0)
  await page.locator('.mp-row--reading select').selectOption('L')
  await expect.poll(() => hintTexts(page)).toEqual(['≈ 16666.6666666667 L per step'])
})
