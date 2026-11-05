import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { unwrapIsolates } from '../src/i18n/bidiIsolate'
import { dragHandle, expect, importGraph, openApp, test } from './support/loop'
import { fileExportRow, openFileMenu, openInputsTab } from './support/workbenchMenus'

// SEMANTICS-M5.md §M5-10 to §M5-12 — a timetable made with the screen alone: from
// an empty document, through a run, a save and a reopen. Nothing here reaches into
// a store to change anything; the store is only read, to compare the run with the
// numbers the table must give. The table is an example assumption: 10 then 20 then
// 30 m³ an hour, with row 3 a gap the person fills with a straight line.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const PASTE = 'hour,flow\n0,10\n1,\n2,20\n4,30\n'
const AMOUNTS = [10, 15, 20, 20, 30, 30] // read as hold, 1 h steps, to the proposed end of 6 h
const TOTAL = 125

const paletteChip = (page: Page, name: string) => page.locator('.toolbar__palette').getByRole('button', { name, exact: true })
const textOf = async (dl: Download) => readFileSync((await dl.path())!, 'utf8')
const stepBtn = (page: Page) => page.locator('.pstrip button[title="Advance one step"]')
const sim = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const s = l.sim.getState()
    const tank = l.graph.getState().nodes.find((n: { data: { kind: string } }) => n.data.kind === 'pool').id
    return { step: s.stepIndex, status: s.status, tank: s.values[tank], planned: s.series.map((p: { timetableLines?: { planned: number }[] }) => p.timetableLines?.[0]?.planned ?? null) }
  })

async function buildDocument(page: Page) {
  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /^New/ }).click()
  await page.getByRole('button', { name: 'New graph', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  await paletteChip(page, 'Source').click()
  await paletteChip(page, 'Pool').click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  const ids = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-id')!, pool: e.className.includes('pool') })))
  const pool = ids.find((n) => n.pool)!.id
  const source = ids.find((n) => !n.pool)!.id
  await dragHandle(page, { nodeId: source, handle: 'out' }, { nodeId: pool, handle: 'in' })
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)

  await page.locator(`.react-flow__node[data-id="${pool}"]`).click()
  await page.getByText('More settings', { exact: true }).click()
  await page.getByLabel(/Resource type/).fill('water')
  await page.getByLabel(/Resource type/).blur()

  await openInputsTab(page)
  await page.getByLabel('Base unit of water').fill('m³')
  await page.getByLabel('Base unit of water').blur()
  await page.getByLabel('Units of water').fill('CMH=1/h')
  await page.getByLabel('Units of water').blur()
  await page.locator('.mp-row__time-value').fill('1')
  await page.locator('.mp-row__time-value').blur()
}

async function makeTable(page: Page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  await dialog.getByLabel('Paste times and rates').fill(PASTE)
  await expect(dialog.getByText('Rows read: 4')).toBeVisible()
  const add = dialog.getByRole('button', { name: 'Add timetable' })

  // a gap stops the import: nothing can be added until the person chooses
  await expect(dialog.getByText('These rows have no rate: 3.', { exact: false })).toBeVisible()
  await dialog.getByLabel('Name').fill('Intake by tide')
  await dialog.getByLabel('Where the numbers came from').fill('Example assumption')
  await expect(add).toBeDisabled()
  await dialog.getByLabel('Draw a straight line across the gap').check()

  // the proposal is shown in its own field: the last point plus the last interval
  await expect(dialog.getByLabel('The table ends at')).toHaveValue('6')
  await expect(dialog.getByText('Proposed from your rows', { exact: false })).toBeVisible()
  await expect(add).toBeEnabled()
  await add.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.mp-row--timetable')).toContainText('Intake by tide')
}

async function assignTable(page: Page) {
  // the chip sits on the line, and the line's wide hit area takes the click there
  await page.locator('.react-flow__edgelabel-renderer').getByText('1', { exact: true }).click({ force: true })
  await page.getByLabel('Read a timetable').selectOption({ label: 'Intake by tide' })
  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('Intake by tide')).toBeVisible()
  const notes = (await page.locator('.inspector__note').allInnerTexts()).map(unwrapIsolates)
  expect(notes).toContain('Origin: Example assumption (filled by a straight line, rows: 3)')
  expect(notes).toContain('The run stops after step 6')
}

async function run(page: Page) {
  for (let i = 1; i <= AMOUNTS.length; i++) {
    await stepBtn(page).click()
    await expect.poll(async () => (await sim(page)).step).toBe(i) // a step plays out before the next
  }
  await stepBtn(page).click()
  await expect.poll(async () => (await sim(page)).status).toBe('ended')
}

test('an empty document, a table made on screen, a run, a save and a reopen give the same numbers', async ({ page }) => {
  test.setTimeout(90_000)
  await openApp(page)
  await buildDocument(page)
  await makeTable(page)
  await assignTable(page)

  // the rate has its own strip, under the chart, with its own unit
  await expect(page.locator('.timeline__rate')).toHaveCount(1)
  await expect(page.locator('.timeline__rate-name')).toHaveText('Intake by tide (CMH)')

  await run(page)
  const first = await sim(page)
  expect(first).toMatchObject({ step: 6, status: 'ended', tank: TOTAL })
  expect(first.planned).toEqual([null, ...AMOUNTS])
  await expect(page.locator('.pstrip-diag').getByText(/The run ended here: .*Intake by tide/)).toBeVisible()

  // the export holds the run's own numbers
  const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('.timeline__csv').first().click()])
  const rows = (await textOf(csv)).replace(/^﻿/, '').trimEnd().split('\r\n').map((r) => r.split(','))
  expect(rows[0].slice(-2).map((h) => h.replace(/ \[[^\]]*\]$/, ''))).toEqual(['Intake by tide (planned) [m³]', 'Intake by tide (moved) [m³]'])
  for (const row of rows) expect(row).toHaveLength(rows[0].length)
  expect(rows.slice(2).map((r) => Number(r[r.length - 2]))).toEqual(AMOUNTS)
  expect(rows.slice(2).map((r) => Number(r[r.length - 1]))).toEqual(AMOUNTS)
  expect(Number(rows[rows.length - 1][1])).toBe(TOTAL)

  // save, start again, and open the file
  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /Export/ }).hover()
  const [saved] = await Promise.all([page.waitForEvent('download'), (await fileExportRow(page, /Graph/)).click()])
  const text = await textOf(saved)
  const doc = JSON.parse(text)
  expect(doc.schema).toBe('loop-studio/graph/5')
  expect(doc.timetables[0].points).toEqual([['0', '10'], ['1', '15'], ['2', '20'], ['4', '30']])
  expect(doc.timetables[0].end).toBe('6')

  await openFileMenu(page)
  await page.getByRole('menuitem', { name: /^New/ }).click()
  await page.getByRole('button', { name: 'New graph', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'tide.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('Intake by tide')).toBeVisible()
  await expect(page.locator('.timeline__rate')).toHaveCount(1)
  await run(page)
  const again = await sim(page)
  expect(again).toEqual(first)
})

const withKinds = (timetables: object[], unit = 'h') =>
  JSON.stringify({
    schema: 'loop-studio/graph/5', version: 1,
    nodes: [
      { id: 'sea', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Sea', activation: 'automatic' } },
      { id: 'tank', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 0, capacity: null, resourceType: 'water', activation: 'automatic' } },
    ],
    edges: [{ id: 'e', source: 'sea', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: timetables.length ? '~big' : '1' } }],
    kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
    time: { step: { value: 1, unit } },
    timetables,
  })

test('a new text does not inherit the last text’s column, gap or end choice', async ({ page }) => {
  await openApp(page)
  await importGraph(page, withKinds([]))
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  const paste = dialog.getByLabel('Paste times and rates')

  // three columns, rate in the last, an end typed by hand
  await paste.fill('site,hour,flow\nA,0,10\nA,2,\nA,4,30\n')
  await dialog.getByLabel('Time column').selectOption({ label: 'hour' })
  await dialog.getByLabel('Rate column').selectOption({ label: 'flow' })
  await dialog.getByLabel('Hold the last value').check()
  await dialog.getByLabel('The table ends at').fill('9')

  // a two-column text: both columns are its own, no gap, and the end is proposed again
  await paste.fill('hour,flow\n0,10\n2,20\n')
  await expect(dialog.getByLabel('Time column')).toHaveCount(0)
  await expect(dialog.getByText('These rows have no rate', { exact: false })).toHaveCount(0)
  await expect(dialog.getByLabel('The table ends at')).toHaveValue('4')
  await dialog.getByLabel('Name').fill('Second table')
  await dialog.getByLabel('Where the numbers came from').fill('Example assumption')
  await dialog.getByRole('button', { name: 'Add timetable' }).click()
  const table = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().timetables[0])
  expect(table.points).toEqual([['0', '10'], ['2', '20']])
  expect(table.end).toBe('4')
})

test('a new text with the same columns keeps the column choice and asks again about its gap and its end', async ({ page }) => {
  await openApp(page)
  await importGraph(page, withKinds([]))
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  const paste = dialog.getByLabel('Paste times and rates')
  const add = dialog.getByRole('button', { name: 'Add timetable' })
  const end = dialog.getByLabel('The table ends at')
  await dialog.getByLabel('Name').fill('Second file')
  await dialog.getByLabel('Where the numbers came from').fill('Example assumption')

  // the first file: columns chosen, its gap held, its end typed
  await paste.fill('site,hour,flow\nA,0,10\nA,2,\nA,4,30\n')
  await dialog.getByLabel('Time column').selectOption({ label: 'hour' })
  await dialog.getByLabel('Rate column').selectOption({ label: 'flow' })
  await dialog.getByLabel('Hold the last value').check()
  await end.fill('9')
  await expect(add).toBeEnabled()

  // another file, the same columns: they stay, and nothing else does
  await paste.fill('site,hour,flow\nB,0,50\nB,2,\nB,4,70\n')
  await expect(dialog.getByLabel('Time column')).toHaveValue('1')
  await expect(dialog.getByLabel('Rate column')).toHaveValue('2')
  await expect(dialog.getByText('These rows have no rate: 3.', { exact: false })).toBeVisible()
  await expect(dialog.getByLabel('Hold the last value')).not.toBeChecked()
  await expect(add).toBeDisabled() // the new gap waits for its own choice

  await dialog.getByLabel('Draw a straight line across the gap').check()
  await expect(end).toHaveValue('6') // proposed from these rows, not the 9 typed for the last ones
  await add.click()
  const table = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().timetables[0])
  expect(table.points).toEqual([['0', '50'], ['2', '60'], ['4', '70']])
  expect(table.end).toBe('6')
})

test('a choice made on a text is asked again when the rate column changes', async ({ page }) => {
  await openApp(page)
  await importGraph(page, withKinds([]))
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  const dialog = page.locator('.mcdlg--timetable')
  await dialog.getByLabel('Paste times and rates').fill('hour,a,b\n0,1,5\n1,,\n2,3,7\n')
  await dialog.getByLabel('Hold the last value').check()
  await dialog.getByLabel('Rate column').selectOption({ label: 'b' })
  await expect(dialog.getByLabel('Hold the last value')).not.toBeChecked()
})

test('a one-point spike in a table of 20,000 points reaches the chart and its axis', async ({ page }) => {
  // hour 12345 is day 514, inside the chart’s last 400 steps at step 600
  await openApp(page)
  const points = Array.from({ length: 20_000 }, (_, i) => [String(i), i === 12_345 ? '9000' : '100'])
  await importGraph(page, withKinds([{ id: 'big', label: 'Big', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'hold', end: '20000', after: 'stop', points }], 'd'))
  await page.evaluate(() => {
    for (let i = 0; i < 600; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  })
  const strip = page.locator('.timeline__rate')
  await expect(strip.locator('.timeline__tick').first()).toHaveText('10000')
  const height = await strip.locator('.timeline__rate-line').evaluate((p) => (p as SVGPathElement).getBBox().height)
  expect(height).toBeGreaterThan(30) // from the baseline of 100 up to the spike
})

test('Help says a tank fills first, in the words the engine test pins', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'How a step fills and empties a Pool' }).click()
  const dialog = page.getByRole('dialog', { name: 'How a step fills and empties a Pool' })
  await expect(dialog).toContainText('fill the Pool first')
  await expect(dialog).toContainText('flattens at 2200, not at 3000')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
