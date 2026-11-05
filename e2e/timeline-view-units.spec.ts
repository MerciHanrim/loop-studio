import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, runMc, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// SEMANTICS-M4.md §M4-8 (#471) — the Timeline's view unit on a small plant kept
// for this spec, so the contract does not depend on a bundled example: `water`
// has L beside its base m³, `power` has none. The screen changes; the document,
// the run and the plain file do not. The text rules themselves are in
// src/model/viewUnits.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const STEPS = 24
const PLANT = readFileSync(new URL('./fixtures/units-plant.json', import.meta.url), 'utf8')

async function openPlant(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, PLANT)
  await expect(page.locator('.react-flow__node')).toHaveCount(9)
  await page.evaluate((steps) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    sim.reset()
    for (let i = 0; i < steps; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  }, STEPS)
  await expect(page.locator('.timeline__key').first()).toContainText('m³')
}

/** everything the view must leave alone */
const stored = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return JSON.stringify({ nodes: g.nodes, edges: g.edges, kinds: g.kinds, time: g.time, past: g.past.length, rev: g.simulationRev, series: s.series, values: s.values, step: s.stepIndex, status: s.status })
  })

async function chooseUnit(page: Page, unit: string) {
  await page.locator('.timeline__series').click()
  await page.locator('.tl-series__unit select').selectOption(unit === 'm³' ? '' : unit)
  await page.keyboard.press('Escape')
  await expect(page.locator('.tl-series')).toHaveCount(0)
}

const axisNote = (page: Page) => page.locator('.timeline__tick--unit')
const textOf = async (dl: Download): Promise<string> => readFileSync((await dl.path())!, 'utf8')

test('a view unit changes the screen and nothing stored, and the base view comes back exactly', async ({ page }) => {
  await openPlant(page)
  const before = await stored(page)
  const svgBefore = await page.locator('.timeline__svg').innerHTML()

  // the base view: two units on one axis, each value naming its own
  await expect(axisNote(page)).toHaveText('Mixed units')
  await expect(page.locator('.timeline__key').first()).toHaveText(/Feed tank 500\.0 m³/)
  await expect(page.locator('.timeline__tick', { hasText: /^600$/ })).toHaveCount(1)

  await chooseUnit(page, 'L')
  await expect(page.locator('.timeline__key').first()).toHaveText(/Feed tank ≈ 500000 L/)
  await expect(page.locator('.timeline__key').nth(1)).toHaveText(/Power supply 125 kWh/)
  await expect(axisNote(page)).toHaveText('Mixed units')
  await expect(page.locator('.timeline__tick', { hasText: /^600000$/ })).toHaveCount(1)
  await expect(page.locator('.timeline__endlabel').first()).toContainText(/ (L|kWh)$/)
  expect(await stored(page)).toBe(before)

  await chooseUnit(page, 'm³')
  expect(await page.locator('.timeline__svg').innerHTML()).toBe(svgBefore)
  expect(await stored(page)).toBe(before)
})

test('one shared unit is named once on the axis', async ({ page }) => {
  await openPlant(page)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().setTimelineSeries(['feed', 'permeate', 'brine']))
  await expect(axisNote(page)).toHaveText('m³')
  await chooseUnit(page, 'L')
  await expect(axisNote(page)).toHaveText('L')
})

test('the plain CSV ignores the view; the file with shown values reduces to it and matches the step reading', async ({ page }) => {
  await openPlant(page)
  const save = async (click: () => Promise<void>) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), click()])
    return { name: dl.suggestedFilename(), text: await textOf(dl) }
  }
  const plainButton = page.locator('.timeline__csv').first()
  await expect(plainButton).not.toHaveAttribute('aria-haspopup', 'true')
  const plain = await save(() => plainButton.click())
  expect(plain.name).toBe('loop-studio-run.csv')

  await chooseUnit(page, 'L')
  const menu = page.locator('.timeline__legend .timeline__csv')
  await expect(menu).toHaveAttribute('aria-haspopup', 'true')

  await menu.click()
  const again = await save(() => page.getByRole('menuitem').first().click())
  expect(again.text).toBe(plain.text)

  await menu.click()
  const shown = await save(() => page.getByRole('menuitem', { name: /CSV with shown values/ }).click())
  expect(shown.name).toBe('loop-studio-run-shown.csv')
  const bom = String.fromCodePoint(0xfeff)
  expect(shown.text.startsWith(bom)).toBe(true)
  expect(plain.text.startsWith(bom)).toBe(true)
  const rows = shown.text.slice(bom.length).trimEnd().split('\r\n').map((r) => r.split(','))
  const head = rows[0]
  expect(head.slice(1, 4)).toEqual(['Feed tank [m³] [feed]', 'Feed tank (shown) [L] [feed]', 'Feed tank (approx) [feed]'])
  expect(head).toContain('Power supply [kWh] [power]')
  expect(head.join()).not.toContain('Power supply (shown)')
  expect(rows.flat()).not.toContain('')
  const added = head.flatMap((h, i) => (/\((shown|approx)\)/.test(h) ? [i] : []))
  expect(added).toHaveLength(6)
  expect(`${rows.map((r) => r.filter((_, i) => !added.includes(i)).join(',')).join('\r\n')}\r\n`).toBe(plain.text.slice(bom.length))

  // a (shown) cell is the step reading's text at that step
  const box = (await page.locator('.timeline__svg').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2)
  const reading = page.locator('.timeline__reading')
  await expect(reading).toBeVisible()
  const step = Number(await reading.getAttribute('data-step'))
  const cell = rows[step + 1][head.indexOf('Product water (shown) [L] [permeate]')]
  await expect(page.locator('.timeline__reading-row[data-series="permeate"] .timeline__reading-value')).toHaveText(`${cell} L`)
})

test('the Distribution tab reads in the same unit; its files do not change', async ({ page }) => {
  await openPlant(page)
  await runMc(page, { baseSeed: 1, runs: 5, steps: STEPS, tracked: [] })
  const save = async () => {
    await page.locator('.dist__stats .menu button').first().click()
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem').nth(2).click()])
    return textOf(dl)
  }
  const summary = await save()
  await page.locator('.band__pool').first().selectOption('permeate')
  await expect(page.locator('.band__key b')).toHaveText(/m³$/)
  await expect(page.locator('.band__tick--unit')).toHaveText('m³')

  await page.getByRole('tab', { name: 'Live' }).click()
  await chooseUnit(page, 'L')
  await page.getByRole('tab', { name: 'Distribution' }).click()
  await expect(page.locator('.band__key b')).toHaveText(/ L$/)
  await expect(page.locator('.band__tick--unit')).toHaveText('L')
  expect(await save()).toBe(summary)
})

test('from an empty document, a person makes a Pool, a kind and a unit on screen, and reads the run in it', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  await page.locator('.toolbar__palette').getByRole('button', { name: 'Pool', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.locator('.react-flow__node').first().click()
  const starting = page.locator('.inspector .field').filter({ has: page.locator('.field__label', { hasText: /^Starting amount$/ }) }).locator('input')
  await starting.fill('2')
  await starting.press('Tab')
  const kind = page.locator('.inspector input[list="resource-type-builtins"]')
  // the kind field sits in the folded Details section of the Pool's properties
  await page.locator('.inspector .wb-panel__summary').click()
  await kind.fill('fuel')
  await kind.press('Tab')

  await page.getByRole('tab', { name: 'Inputs' }).click()
  const baseUnit = page.getByLabel('Base unit of fuel')
  if (!(await baseUnit.isVisible())) await page.getByRole('button', { name: /^Kinds/ }).click()
  await baseUnit.fill('m³')
  await baseUnit.press('Enter')
  const units = page.getByLabel('Units of fuel')
  await units.fill('L=0.001')
  await units.press('Enter')

  // the Pool's own field offers the new unit, and an exact change applies at once
  await page.locator('.react-flow__node').first().click()
  const poolUnit = page.locator('.inspector .field').filter({ has: page.locator('.field__label', { hasText: /^Unit$/ }) }).locator('select')
  await poolUnit.selectOption('L')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes[0].data))
    .toMatchObject({ unit: 'L', initial: 2000 })

  const step = page.getByRole('button', { name: 'Advance one step' })
  for (let i = 0; i < 3; i++) await step.click()
  await expect(page.locator('.timeline__key').first()).toHaveText(/ 2 m³$/)
  await expect(axisNote(page)).toHaveText('m³')
  await page.locator('.timeline__series').click()
  await page.locator('.tl-series__unit select').selectOption('L')
  await page.keyboard.press('Escape')
  await expect(page.locator('.timeline__key').first()).toHaveText(/ 2000 L$/)
  await expect(axisNote(page)).toHaveText('L')
})

test('another document starts in its base units, and one with no amount unit shows nothing new', async ({ page }) => {
  await openPlant(page)
  await chooseUnit(page, 'L')
  await importGraph(page, PLANT)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.viewUnits?.getState().views))
    .toEqual({})

  await pickTemplate(page, 'equilibrium')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.locator('.timeline__series').click()
  await expect(page.locator('.tl-series')).toBeVisible()
  await expect(page.locator('.tl-series__units')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(axisNote(page)).toHaveCount(0)
})
