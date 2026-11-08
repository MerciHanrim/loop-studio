import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { unwrapIsolates } from '../src/i18n/bidiIsolate'
import { expect, importGraph, openApp, test } from './support/loop'
import { fileExportRow, openFileMenu } from './support/workbenchMenus'

// #519, SEMANTICS-M7.md — a table of what a supply can give, made on screen. The supply
// gives 8 m³ an hour with a stop from hour 2 to 4, into a tank that holds 10 and lets
// nothing out, so from step 2 the tank has no room for what is available. As a plan
// that would be a shortfall at every such step; as `available` it is none. The meaning
// is chosen on the import screen and must survive an autosave reload, an Export and an
// Import.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const PASTE = 'hour,flow\n0,8\n2,0\n4,8\n'
const DOC = JSON.stringify({
  schema: 'loop-studio/graph/5', version: 1,
  nodes: [
    { id: 'grid', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Grid', activation: 'automatic' } },
    { id: 'tank', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 0, capacity: 10, resourceType: 'water', activation: 'automatic' } },
  ],
  edges: [{ id: 'e', source: 'grid', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
  kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
  time: { step: { value: 1, unit: 'h' } },
})

const textOf = async (dl: Download) => readFileSync((await dl.path())!, 'utf8')
const stepBtn = (page: Page) => page.locator('.pstrip button[title="Advance one step"]')
const doc = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return { modelVersion: g.modelVersion as number, tables: (g.timetables as { id: string; means?: string }[]).map((t) => ({ id: t.id, means: t.means ?? null })) }
  })
const strip = (page: Page) => page.locator('.timeline__rate')
const notes = async (page: Page) => (await page.locator('.inspector__note').allInnerTexts()).map(unwrapIsolates)

async function makeAvailableTable(page: Page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  await dialog.getByLabel('Paste times and rates').fill(PASTE)
  await expect(dialog.getByText('Rows read: 3')).toBeVisible()
  await dialog.getByLabel('Name').fill('Grid feed')
  await dialog.getByLabel('Where the numbers came from').fill('Example assumption')
  // a plan by default, and the screen says what each choice means
  const means = dialog.getByLabel('The rates are')
  await expect(means).toHaveValue('plan')
  await expect(dialog.locator('[data-means-note]')).toHaveText('The connection should move this rate. When it moves less, the run says how much did not move.')
  await means.selectOption({ label: 'What is available' })
  await expect(dialog.locator('[data-means-note]')).toHaveText('The connection can move up to this rate, and moving less is normal. Every connection that reads this table reads it the same way.')
  await dialog.getByRole('button', { name: 'Add timetable' }).click()
  await expect(dialog).toHaveCount(0)
}

async function assignTable(page: Page) {
  await page.locator('.react-flow__edgelabel-renderer').getByText('1', { exact: true }).click({ force: true })
  await page.getByLabel('Read a timetable').selectOption({ label: 'Grid feed' })
  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('Grid feed')).toBeVisible()
}

/** the meaning as every surface shows it, with nothing run */
async function expectAvailable(page: Page) {
  expect(await doc(page)).toEqual({ modelVersion: 7, tables: [{ id: 'grid_feed', means: 'available' }] })
  await expect(strip(page)).toHaveAttribute('data-means', 'available')
  await expect.poll(async () => unwrapIsolates((await page.locator('.timeline__rate-name').textContent()) ?? '')).toBe('Grid feed (CMH): available (dashed), moved (solid)')
}

test('a table chosen as available on the import screen raises no shortfall, shows what was available beside what moved, and keeps its meaning through a reload, an Export and an Import', async ({ page }) => {
  test.setTimeout(90_000)
  await openApp(page)
  await importGraph(page, DOC)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await makeAvailableTable(page)
  await assignTable(page)
  await expectAvailable(page)
  expect(await notes(page)).toContain('Available: the connection can move up to this rate. Moving less is normal and is not reported.')

  // six steps: the tank is full from step 2, so the supply moves less than is available
  for (let i = 1; i <= 6; i++) {
    await stepBtn(page).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(i)
  }
  const lines = await page.evaluate(() => ((window as unknown as Bridge).__loop.sim.getState().series as { timetableLines?: { planned: number; moved: number }[] }[]).slice(1).map((p) => p.timetableLines![0]))
  expect(lines).toEqual([{ edgeId: 'e', tableId: 'grid_feed', planned: 8, moved: 8 }, { edgeId: 'e', tableId: 'grid_feed', planned: 8, moved: 2 }, { edgeId: 'e', tableId: 'grid_feed', planned: 0, moved: 0 }, { edgeId: 'e', tableId: 'grid_feed', planned: 0, moved: 0 }, { edgeId: 'e', tableId: 'grid_feed', planned: 8, moved: 0 }, { edgeId: 'e', tableId: 'grid_feed', planned: 8, moved: 0 }])
  // no shortfall in the run bar, at any step
  await expect(page.locator('.pstrip-diag').getByText(/did not move/)).toHaveCount(0)
  // the strip draws what moved, the Inspector gives the last step's two numbers
  await expect(strip(page).locator('.timeline__rate-moved')).toHaveCount(1)
  await page.locator('.react-flow__edgelabel-renderer').getByText('Grid feed').click({ force: true })
  await expect.poll(async () => (await notes(page)).find((n) => n.startsWith('Step '))).toBe('Step 6: 8 m³ available, 0 m³ moved')

  // the run CSV names the first column of the pair `(available)`
  const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('.timeline__csv').first().click()])
  const head = (await textOf(csv)).replace(/^﻿/, '').split('\r\n')[0].split(',')
  expect(head.slice(-2).map((h) => h.replace(/ \[[^\]]*\]$/, ''))).toEqual(['Grid feed (available) [m³]', 'Grid feed (moved) [m³]'])

  // the autosave keeps the meaning across a reload
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((v) => v.includes('"means":"available"') || v.includes('"means": "available"')))).toBe(true)
  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expectAvailable(page)

  // an Export writes it on /graph/7, and an Import of that file reads it back
  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /Export/ }).hover()
  const [saved] = await Promise.all([page.waitForEvent('download'), (await fileExportRow(page, /Graph/)).click()])
  const text = await textOf(saved)
  const file = JSON.parse(text)
  expect(file.schema).toBe('loop-studio/graph/7')
  expect(file.timetables[0].means).toBe('available')
  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /^New/ }).click()
  await page.getByRole('button', { name: 'New graph', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'grid.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expectAvailable(page)
})

test('a table left as a plan keeps the plan as it was: /graph/5, no `means`, the plain strip', async ({ page }) => {
  await openApp(page)
  await importGraph(page, DOC)
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  await dialog.getByLabel('Paste times and rates').fill(PASTE)
  await dialog.getByLabel('Name').fill('Grid feed')
  await dialog.getByLabel('Where the numbers came from').fill('Example assumption')
  await dialog.getByRole('button', { name: 'Add timetable' }).click()
  await assignTable(page)
  expect(await doc(page)).toEqual({ modelVersion: 5, tables: [{ id: 'grid_feed', means: null }] })
  await expect(strip(page)).not.toHaveAttribute('data-means', 'available')
  await expect(page.locator('.timeline__rate-name')).toHaveText('Grid feed (CMH)')
})

// #530 review — the strip's reading of an available table is the hovered step's: what the
// step made available and what each line moved, both as the table's rate averaged over the
// step. A linear ramp from 0 to 2 an hour over the first hour averages 1, so near the end
// of step 1 the rate at the instant (about 1.9) must not stand beside the moved 1.
const RAMP_DOC = (twoLines: boolean) =>
  JSON.stringify({
    schema: 'loop-studio/graph/7', version: 1,
    nodes: [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic' } },
      { id: 'tank', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 0, capacity: null, resourceType: 'water', activation: 'automatic' } },
      ...(twoLines ? [{ id: 'tankB', type: 'pool', position: { x: 320, y: 200 }, data: { kind: 'pool', label: 'Tank B', initial: 0, capacity: 0.5, resourceType: 'water', activation: 'automatic' } }] : []),
    ],
    edges: [
      { id: 'e', source: 'src', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '~ramp' } },
      ...(twoLines ? [{ id: 'e2', source: 'src', target: 'tankB', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '~ramp' } }] : []),
    ],
    kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
    time: { step: { value: 1, unit: 'h' } },
    timetables: [{ id: 'ramp', label: 'Ramp', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'linear', end: '1', after: 'hold', means: 'available', points: [['0', '0'], ['1', '2']] }],
  })

/** the strip's reading with the pointer just before the end of step 1, on the chart's own step scale */
async function readingNearEndOfStep1(page: Page): Promise<string> {
  const x1 = await page.locator('.timeline__line[data-series="tank"]').evaluate((el) => {
    const nums = (el.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number)
    return (el as SVGPathElement).ownerSVGElement!.getBoundingClientRect().left + nums[2]!
  })
  const box = (await strip(page).boundingBox())!
  await page.mouse.move(x1 - 3, box.y + box.height / 2)
  // by its place, the strip's top row and not its name, so the same locator reads an older
  // build, where the reading stood at the row's end
  const text = strip(page).locator('text[y="10"]:not(.timeline__rate-name)')
  await expect(text).toHaveCount(1)
  return unwrapIsolates((await text.textContent()) ?? '')
}

test('a linear table moved in full reads the same available and moved rate for the hovered step', async ({ page }) => {
  await openApp(page)
  await importGraph(page, RAMP_DOC(false))
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  for (let i = 1; i <= 2; i++) {
    await stepBtn(page).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(i)
  }
  expect(await readingNearEndOfStep1(page)).toBe('Step 1: available 1, moved 1 CMH')
})

test('two lines reading one available table: the reading names each line by its ends, with what it moved', async ({ page }) => {
  await openApp(page)
  await importGraph(page, RAMP_DOC(true))
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  for (let i = 1; i <= 2; i++) {
    await stepBtn(page).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(i)
  }
  await expect(strip(page).locator('.timeline__rate-moved')).toHaveCount(2)
  // Tank B holds 0.5, so its line moves half of what is available
  expect(await readingNearEndOfStep1(page)).toBe('Step 1: available 1 CMH on each connection, moved Src → Tank 1; Src → Tank B 0.5')
  // the long reading takes the name's place rather than running into it, and stays in the strip
  await expect(strip(page).locator('.timeline__rate-name')).toHaveCount(0)
  const fits = await strip(page).evaluate((svg) => {
    const box = svg.getBoundingClientRect()
    const r = svg.querySelector('.timeline__rate-reading')!.getBoundingClientRect()
    return r.left >= box.left && r.right <= box.right
  })
  expect(fits).toBe(true)
  // leaving the strip brings the name back
  await page.mouse.move(4, 4)
  await expect(strip(page).locator('.timeline__rate-name')).toHaveCount(1)
})

test('Help ▸ How a timetable is read says that every connection reading a table shares its meaning', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'How a timetable is read' }).click()
  const dialog = page.getByRole('dialog', { name: 'How a timetable is read' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Every connection that reads one table reads it the same way')
  await expect(dialog).toContainText('the run bar shows no warning')
})
