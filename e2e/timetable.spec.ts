import type { Page } from '@playwright/test'
import { unwrapIsolates } from '../src/i18n/bidiIsolate'
import { expect, importGraph, openApp, test } from './support/loop'

// SEMANTICS-M5.md — a timetable in the real app. The document is built for this
// spec: a Source fills a capped tank by a table of 10 then 20 m³ an hour, on a
// 1 h step, and the table stops at 5 h. The arithmetic is in
// src/engine/timetable.test.ts; this checks what a person sees and gets.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const table = {
  id: 'intake', label: 'Intake by tide', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'hold', end: '5', after: 'stop',
  points: [['0', '10'], ['3', '20']],
}

function doc(over: { from?: string; time?: boolean } = {}): string {
  return JSON.stringify({
    schema: 'loop-studio/graph/5', version: 1,
    nodes: [
      { id: 'sea', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Sea', activation: 'automatic' } },
      { id: 'tank', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: 'Tank', initial: 0, capacity: 35, resourceType: 'water', activation: 'automatic' } },
    ],
    edges: [{ id: 'e', source: over.from ?? 'sea', target: 'tank', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '~intake' } }],
    kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
    ...(over.time === false ? {} : { time: { step: { value: 1, unit: 'h' } } }),
    timetables: [table],
  })
}

const advance = (page: Page, n: number) =>
  page.evaluate((steps) => {
    for (let i = 0; i < steps; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
  }, n)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return { step: s.stepIndex, status: s.status, tank: s.values.tank, notices: s.notices, refusals: s.timetableRefusals.length, points: s.series.length }
  })

test('the line shows the table, and the Inspector what it says and where it stops', async ({ page }) => {
  await openApp(page)
  await importGraph(page, doc())
  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('Intake by tide')).toBeVisible()
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, 'e'))
  const notes = page.locator('.inspector__note')
  const text = async () => (await notes.allInnerTexts()).map(unwrapIsolates)
  await expect(notes.first()).toBeVisible()
  await expect.poll(text).toEqual(expect.arrayContaining(['Timetable: Intake by tide', 'Origin: Example assumption', 'Each rate lasts until the next point', 'After its last time: the run stops', 'The run stops after step 5']))
})

test('a table moves its plan, a full tank says what did not move, and the run stops at the end of the table', async ({ page }) => {
  await openApp(page)
  await importGraph(page, doc())
  await advance(page, 3)
  expect(await sim(page)).toMatchObject({ step: 3, tank: 30, notices: [] })
  await advance(page, 1) // 20 planned, 5 of room
  expect(await sim(page)).toMatchObject({ step: 4, tank: 35, notices: [{ kind: 'timetableUnmet', amount: 15 }] })
  await advance(page, 2) // step 5 is covered, step 6 is not
  const ended = await sim(page)
  expect(ended).toMatchObject({ step: 5, status: 'ended', notices: [{ kind: 'timetableEnded', label: 'Intake by tide' }] })
  expect(ended.points).toBe(6) // steps 0 to 5: the end of the table adds no point
})

test('the run keeps planned and moved per step, and a file round trip keeps the table', async ({ page }) => {
  await openApp(page)
  await importGraph(page, doc())
  await advance(page, 4)
  const lines = await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().series.map((p: { timetableLines?: unknown }) => p.timetableLines ?? null))
  expect(lines[0]).toBeNull()
  expect(lines[4]).toEqual([{ edgeId: 'e', tableId: 'intake', planned: 20, moved: 5 }])
  const saved = await page.evaluate(() => JSON.parse((window as unknown as Bridge).__loop.graph.getState().exportJSON()))
  expect(saved.schema).toBe('loop-studio/graph/5')
  expect(saved.timetables).toEqual([table])
})

test('a table on a line that cannot read one refuses the run before Play, and Show selects the line', async ({ page }) => {
  await openApp(page)
  await importGraph(page, doc({ time: false }))
  await expect(page.getByText(/Can’t run: .*Intake by tide.* needs a step length/)).toBeVisible()
  expect((await sim(page)).refusals).toBe(1)
  await advance(page, 1)
  expect(await sim(page)).toMatchObject({ step: 0, tank: 0 })
  await page.locator('.pstrip__refused-show').click()
  expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedEdgeId)).toBe('e')
})

test('a file with a bad table is refused whole, and the row is named', async ({ page }) => {
  await openApp(page)
  const raw = JSON.parse(doc())
  raw.timetables[0].points[1][0] = '0'
  const message = await page.evaluate((text) => {
    try {
      ;(window as unknown as Bridge).__loop.graph.getState().loadJSON(text)
      return null
    } catch (e) {
      return { code: (e as { code?: string }).code, table: (e as { table?: unknown }).table }
    }
  }, JSON.stringify(raw))
  expect(message).toEqual({ code: 'bad-timetable', table: { id: 'intake', row: 2 } })
})
