import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, importGraph, openApp, test } from './support/loop'
import { openFileMenu, openInputsTab } from './support/workbenchMenus'

// SEMANTICS-M4.md §M4-3 — the step length is declared by choosing its unit. Review P1: with no
// step length, the count field showed 1 and a Tab through it (nothing typed) declared 1 hour:
// the document moved to /graph/4 one-way, an undo entry appeared, the run reset, and rates
// authored per day changed their amounts per step. Keyboard only, as a person tabs through
// the Kinds panel; the stores are only read.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const paletteChip = (page: Page, name: string) => page.locator('.toolbar__palette').getByRole('button', { name, exact: true })
const count = (page: Page) => page.getByRole('spinbutton', { name: 'Step length value' })
const unit = (page: Page) => page.getByRole('combobox', { name: 'Step length', exact: true })

const doc = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    const file = JSON.parse(g.exportJSON())
    return {
      time: g.time ?? null,
      version: g.modelVersion as number,
      history: g.past.length as number,
      file: { schema: file.schema as string, time: file.time ?? null },
      run: { step: s.stepIndex as number, status: s.status as string },
    }
  })

/** Tab from the last kind row's units input into the step row and on past it, typing nothing */
async function tabThrough(page: Page) {
  await openInputsTab(page)
  await page.locator('.mp-row--kind').last().getByLabel(/^Units of /).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(count(page)).not.toBeFocused()
}

async function stepTo3(page: Page) {
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Advance one step' }).first().click()
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(i)
  }
}

// a document saved at /graph/3: a declared kind, rates per step, no step length
const v3Doc = JSON.stringify({
  schema: 'loop-studio/graph/3',
  version: 1,
  nodes: [
    { id: 'well', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Well', activation: 'automatic', resourceType: 'water' } },
    { id: 'tank', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, resourceType: 'water' } },
  ],
  edges: [{ id: 'fill', source: 'well', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '5', resourceType: 'water' } }],
  kinds: [{ name: 'water', conserved: false, baseUnit: 'm³' }],
})

test('a new document: tabbing through the step length declares nothing', async ({ page }) => {
  await openApp(page)
  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /^New/ }).click()
  await page.getByRole('button', { name: 'New graph', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  await paletteChip(page, 'Pool').click()
  await page.locator('.react-flow__node').first().click()
  await page.getByText('More settings', { exact: true }).click()
  await page.getByLabel(/Resource type/).fill('water')
  await page.getByLabel(/Resource type/).blur()
  const before = await doc(page)
  expect(before.time).toBeNull()

  await tabThrough(page)

  expect(await doc(page)).toEqual(before) // no step length, no version change, no undo entry, file unchanged
  await expect(count(page)).toBeDisabled()
  await expect(count(page)).toHaveValue('')
  await expect(unit(page)).toHaveValue('')
})

test('a saved /graph/3 document: tabbing through keeps its version, its history and its run', async ({ page }) => {
  await openApp(page)
  await importGraph(page, v3Doc)
  await stepTo3(page)
  const before = await doc(page)
  expect(before).toMatchObject({ time: null, version: 3, history: 0, file: { schema: 'loop-studio/graph/3', time: null }, run: { step: 3, status: 'paused' } })

  await tabThrough(page)

  expect(await doc(page)).toEqual(before)
  await expect(count(page)).toBeDisabled()
})

test('choosing a unit declares one of it; the count then edits it; not declared takes it away', async ({ page }) => {
  await openApp(page)
  await importGraph(page, v3Doc)
  await openInputsTab(page)

  await unit(page).selectOption('h')
  await expect.poll(() => doc(page)).toMatchObject({ time: { step: { value: 1, unit: 'h' } }, version: 4, history: 1, file: { schema: 'loop-studio/graph/4', time: { step: { value: 1, unit: 'h' } } } })
  await expect(count(page)).toBeEnabled()
  await expect(count(page)).toHaveValue('1')

  // a Tab through the count of a declared step changes nothing
  await tabThrough(page)
  expect(await doc(page)).toMatchObject({ time: { step: { value: 1, unit: 'h' } }, history: 1 })

  await count(page).fill('2')
  await count(page).press('Tab')
  await expect.poll(() => doc(page)).toMatchObject({ time: { step: { value: 2, unit: 'h' } }, history: 2 })

  await unit(page).selectOption('')
  await expect.poll(() => doc(page)).toMatchObject({ time: null, version: 4, history: 3 })
  await expect(count(page)).toBeDisabled()
  await expect(count(page)).toHaveValue('')
})

test('a document that declares its step: tabbing through changes nothing and the run goes on', async ({ page }) => {
  await openApp(page)
  await importGraph(page, readFileSync('examples/coffee-roasting-batch.json', 'utf8'))
  await stepTo3(page)
  const before = await doc(page)
  expect(before).toMatchObject({ time: { step: { value: 1, unit: 'min' } }, history: 0, run: { step: 3 } })

  await tabThrough(page)

  expect(await doc(page)).toEqual(before)
  await expect(count(page)).toHaveValue('1')
})
