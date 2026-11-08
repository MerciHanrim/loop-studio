import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, test } from './support/loop'
import { openInputsTab } from './support/workbenchMenus'

// SEMANTICS-M6.md §M6-9 — a rule made on the screen and read on the others, through the
// real controls. The rule's numbers are in src/engine/run-rule.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const pool = (id: string, x: number, initial: number, capacity: number | null = null) => ({ id, type: 'pool', position: { x, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny', resourceType: 'water' } })
const line = (id: string, source: string, target: string, flow: string, unit?: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, ...(unit ? { unit } : {}) } })

/** a plant with no rule yet, on the version before rules */
const plant = (feed = 100000) =>
  JSON.stringify({
    schema: 'loop-studio/graph/5',
    version: 1,
    nodes: [
      pool('feed', 0, feed),
      { id: 'ro', type: 'converter', position: { x: 260, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny' } },
      pool('store', 520, 0),
      { id: 'out', type: 'drain', position: { x: 780, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
    ],
    edges: [line('in', 'feed', 'ro', '100', 'CMH'), line('made', 'ro', 'store', '100', 'CMH'), line('use', 'store', 'out', '~demand')],
    kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
    time: { step: { value: 1, unit: 'h' } },
    timetables: [{ id: 'demand', label: 'Demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }],
  })

const graph = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return { version: g.modelVersion as number, run: g.nodes.find((n: { id: string }) => n.id === 'ro').data.run as Record<string, string> | undefined }
  })
const advance = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
const choose = (page: Page, id: string) => page.evaluate((x) => (window as unknown as Bridge).__loop.graph.getState().setSelection(x, null), id)
const section = (page: Page) => page.locator('[data-run-rule="ro"]')
const field = (page: Page, name: string) => section(page).locator('label.field').filter({ has: page.locator('.field__label', { hasText: new RegExp(`^${name}$`) }) }).locator('select, input')

async function makeRule(page: Page) {
  await choose(page, 'ro')
  await section(page).getByLabel('Runs at').selectOption('rule')
  await field(page, 'Tank').selectOption('store')
  await section(page).getByLabel('Target level').fill('150')
  await section(page).getByLabel('Target level').press('Tab')
  await section(page).getByLabel('Band').fill('150')
  await section(page).getByLabel('Band').press('Tab')
}

test('a rule made in the Inspector is stored only once it reads, and promotes the document', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await choose(page, 'ro')
  await expect(section(page).getByLabel('Runs at')).toHaveValue('full')
  await section(page).getByLabel('Runs at').selectOption('rule')
  await expect(section(page).getByText('Choose a tank, a timetable, or both.')).toBeVisible()
  await field(page, 'Tank').selectOption('store')
  await expect(section(page).getByText('Not in use yet')).toBeVisible()
  expect(await graph(page)).toEqual({ version: 5, run: undefined })
  await section(page).getByLabel('Target level').fill('150')
  await section(page).getByLabel('Target level').press('Tab')
  expect(await graph(page)).toEqual({ version: 5, run: undefined })
  await section(page).getByLabel('Band').fill('150')
  await section(page).getByLabel('Band').press('Tab')
  await expect.poll(() => graph(page)).toEqual({ version: 6, run: { tank: 'store', level: '150', band: '150', side: 'fill' } })
  await expect(section(page).getByText('Not in use yet')).toHaveCount(0)
  await expect(section(page).getByText(/Level and band are in .*m³/)).toBeVisible()
  // the canvas takes it at once: the tag and the read line
  await expect(page.locator('[data-stage-tag="ro"]')).toBeVisible()
  await expect(page.locator('.read-edge__line').first()).toBeAttached()
})

/** the plant with a second tank, in litres, that nothing runs through */
const twoUnits = () => {
  const doc = JSON.parse(plant())
  doc.kinds[0].units = [{ name: 'L', factor: '0.001' }]
  doc.nodes.push({ ...pool('litres', 520, 0), position: { x: 520, y: 240 } })
  doc.nodes.at(-1).data.unit = 'L'
  return JSON.stringify(doc)
}
const runState = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    return { rev: l.graph.getState().simulationRev as number, steps: l.sim.getState().series.length as number }
  })

test('choosing a tank in another unit changes no rule and no run until its level and band are typed', async ({ page }) => {
  await openApp(page)
  await importGraph(page, twoUnits())
  await makeRule(page)
  const stored = (await graph(page)).run
  await advance(page)
  await expect.poll(async () => (await runState(page)).steps).toBeGreaterThan(1)
  const before = await runState(page)

  await field(page, 'Tank').selectOption('litres')
  // the choice alone: the same rule, the same run, and nothing typed for the new tank
  expect((await graph(page)).run).toEqual(stored)
  expect(await runState(page)).toEqual(before)
  await expect(section(page).getByLabel('Target level')).toHaveValue('')
  await expect(section(page).getByLabel('Band')).toHaveValue('')
  await expect(section(page).getByText(/Level and band are in .*L/)).toBeVisible()
  await expect(section(page).getByText('Not in use yet')).toBeVisible()
  await expect(section(page).getByText(/Until then the rule keeps reading .*store/)).toBeVisible()

  // one value is still not a rule
  await section(page).getByLabel('Target level').fill('150000')
  await section(page).getByLabel('Target level').press('Tab')
  expect((await graph(page)).run).toEqual(stored)
  expect(await runState(page)).toEqual(before)

  await section(page).getByLabel('Band').fill('150000')
  await section(page).getByLabel('Band').press('Tab')
  await expect.poll(async () => (await graph(page)).run).toEqual({ tank: 'litres', level: '150000', band: '150000', side: 'fill' })
  await expect(section(page).getByText('Not in use yet')).toHaveCount(0)
})

test('going back to the tank the rule reads ends the draft, with its numbers', async ({ page }) => {
  await openApp(page)
  await importGraph(page, twoUnits())
  await makeRule(page)
  await field(page, 'Tank').selectOption('litres')
  await expect(section(page).getByText('Not in use yet')).toBeVisible()
  await field(page, 'Tank').selectOption('store')
  await expect(section(page).getByText('Not in use yet')).toHaveCount(0)
  await expect(section(page).getByLabel('Target level')).toHaveValue('150')
  await expect(section(page).getByLabel('Band')).toHaveValue('150')
})

test('a Pool’s unit change keeps the amount its rule reads, in one undo', async ({ page }) => {
  await openApp(page)
  await importGraph(page, twoUnits())
  await makeRule(page)
  await section(page).getByLabel('Band').fill('300')
  await section(page).getByLabel('Band').press('Tab')
  await choose(page, 'store')
  await page.locator('.inspector label.field').filter({ has: page.locator('.field__label', { hasText: /^Unit$/ }) }).locator('select').selectOption('L')
  await expect.poll(async () => (await graph(page)).run).toEqual({ tank: 'store', level: '150000', band: '300000', side: 'fill' })
  await choose(page, 'ro')
  await advance(page)
  await expect.poll(async () => (await section(page).locator('[data-run-reading]').innerText()).replace(/[⁦-⁩]/g, '')).toContain('This step: target 50 %, ran 50 %.')
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
  await expect.poll(async () => (await graph(page)).run?.band).toBe('300')
  expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === 'store').data.unit)).toBeUndefined()
})

test('a rule that names its own unit keeps it when the Pool’s unit changes', async ({ page }) => {
  await openApp(page)
  const doc = JSON.parse(twoUnits())
  doc.schema = 'loop-studio/graph/6'
  doc.nodes.find((n: { id: string }) => n.id === 'ro').data.run = { tank: 'store', level: '150', band: '300', side: 'fill', unit: 'm³' }
  await importGraph(page, JSON.stringify(doc))
  await choose(page, 'store')
  await page.locator('.inspector label.field').filter({ has: page.locator('.field__label', { hasText: /^Unit$/ }) }).locator('select').selectOption('L')
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === 'store').data.unit)).toBe('L')
  expect((await graph(page)).run).toEqual({ tank: 'store', level: '150', band: '300', side: 'fill', unit: 'm³' })
})

test('a band of 0 and a letter in a field never reach the document', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await makeRule(page)
  const band = section(page).getByLabel('Band')
  await band.fill('0')
  await expect(section(page).getByText('Use a number above 0.')).toBeVisible()
  await band.press('Tab')
  await expect(band).toHaveValue('150')
  await section(page).getByLabel('Target level').fill('12x')
  await expect(section(page).getByText('Use a plain number, such as 1500.')).toBeVisible()
  await section(page).getByLabel('Target level').press('Tab')
  expect((await graph(page)).run).toEqual({ tank: 'store', level: '150', band: '150', side: 'fill' })
})

test('a table needs its 100 % line, and the refusal stands beside the field until it has one', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await makeRule(page)
  await section(page).getByLabel('Timetable').selectOption('demand')
  await expect(section(page).getByText(/the 100 % line of the run rule on .*RO/i)).toBeVisible()
  await section(page).getByLabel('100 % line').selectOption('made')
  await expect(section(page).getByText(/the 100 % line of the run rule on .*RO/i)).toHaveCount(0)
  await section(page).getByLabel('Lowest run, %').fill('50')
  await section(page).getByLabel('Lowest run, %').press('Tab')
  await expect.poll(async () => (await graph(page)).run).toEqual({ tank: 'store', level: '150', band: '150', side: 'fill', table: 'demand', rated: 'made', lowest: '0.5' })
})

test('Full removes the rule, and undo brings back the rule and the version', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await makeRule(page)
  await section(page).getByLabel('Runs at').selectOption('full')
  await expect.poll(async () => (await graph(page)).run).toBeUndefined()
  expect((await graph(page)).version).toBe(6)
  await expect(page.locator('[data-stage-tag="ro"]')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
  await expect.poll(async () => (await graph(page)).run?.band).toBe('150')
  await choose(page, 'ro')
  await expect(section(page).getByLabel('Runs at')).toHaveValue('rule')
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
  await expect.poll(() => graph(page)).toEqual({ version: 5, run: undefined })
})

test('the Inspector, the Inputs list and the strip read the same step', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await ensureTimelineOpen(page)
  await makeRule(page)
  await section(page).getByLabel('Band').fill('300')
  await section(page).getByLabel('Band').press('Tab')
  await advance(page)
  // an empty tank at a level of 150 and a band of 300 asks for half a run
  await expect(section(page).locator('[data-run-reading]')).toContainText('This step: target')
  const reading = await section(page).locator('[data-run-reading]').innerText()
  expect(reading.replace(/[⁦-⁩]/g, '')).toContain('This step: target 50 %, ran 50 %.')
  await openInputsTab(page)
  const row = page.locator('[data-run-row="ro"]')
  await expect(row).toContainText('Run')
  expect((await row.innerText()).replace(/[⁦-⁩]/g, '')).toContain('Run 50 %')
  await expect(row).toContainText('store')
  await choose(page, 'store')
  await row.getByRole('button').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId)).toBe('ro')
  const strip = page.locator('[data-run-strip="ro"]')
  await expect(strip).toBeVisible()
  expect((await strip.getAttribute('aria-label'))!.replace(/[⁦-⁩]/g, '')).toBe('Run of RO. Last step: target 50 %, ran 50 %.')
  await expect(strip.locator('.timeline__run-target')).toHaveAttribute('d', /H/)
})

test('the step reading gives a ruled stage’s numbers to a keyboard', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await ensureTimelineOpen(page)
  await makeRule(page)
  await section(page).getByLabel('Band').fill('300')
  await section(page).getByLabel('Band').press('Tab')
  await advance(page)
  await page.locator('.timeline__plot').focus()
  await page.keyboard.press('End')
  const reading = page.locator('.timeline__reading')
  await expect(reading).toContainText('RO')
  expect((await reading.innerText()).replace(/[⁦-⁩]/g, '')).toContain('Run 50 %')
})

test('strips follow the frames, then the position inside a frame, not the ids', async ({ page }) => {
  await openApp(page)
  const stage = (id: string, x: number, y: number, tank: string) => ({ id, type: 'converter', position: { x, y }, data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny', run: { tank, level: '10', band: '10', side: 'fill' } } })
  const doc = {
    schema: 'loop-studio/graph/6', version: 1,
    nodes: [
      pool('t1', 0, 0), stage('zz_first', 200, 100, 't1'), pool('s1', 400, 0),
      { ...pool('t2', 1000, 0), position: { x: 1000, y: 100 } }, stage('aa_last', 1200, 200, 't2'), { ...pool('s2', 1400, 0), position: { x: 1400, y: 200 } },
      { ...pool('t3', 1000, 0), position: { x: 1000, y: 0 } }, stage('mm_middle', 1200, 50, 't3'), { ...pool('s3', 1400, 0), position: { x: 1400, y: 50 } },
    ],
    edges: [line('a', 't1', 'zz_first', '1'), line('b', 'zz_first', 's1', '1'), line('c', 't2', 'aa_last', '1'), line('d', 'aa_last', 's2', '1'), line('e', 't3', 'mm_middle', '1'), line('f', 'mm_middle', 's3', '1')],
    frames: [{ id: 'one', label: '1', rect: { x: 0, y: -50, w: 600, h: 400 }, color: 'sage' }, { id: 'two', label: '2', rect: { x: 900, y: -50, w: 700, h: 400 }, color: 'sage' }],
  }
  await importGraph(page, JSON.stringify(doc))
  await ensureTimelineOpen(page)
  await expect.poll(() => page.locator('[data-run-strip]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.runStrip))).toEqual(['zz_first', 'mm_middle', 'aa_last'])
})

test('a document with strips keeps a chart a change can be read on', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await ensureTimelineOpen(page)
  await makeRule(page)
  await expect.poll(() => page.locator('.timeline__plot').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(130)
})

test('lines that share a colour differ by pattern, in the chart, the legend and the reading, and hiding one repaints no other', async ({ page }) => {
  await openApp(page)
  const doc = JSON.parse(plant())
  for (const n of doc.nodes) if (n.data.kind === 'pool') n.data.accent = '#638EA5'
  doc.recommendedRunConfig = { timelineSeries: ['feed', 'store'] }
  doc.nodes.push({ ...pool('third', 520, 5), position: { x: 520, y: 240 } })
  doc.nodes.at(-1).data.accent = '#638EA5'
  doc.recommendedRunConfig.timelineSeries = 'all'
  await importGraph(page, JSON.stringify(doc))
  await ensureTimelineOpen(page)
  await advance(page)
  await advance(page)
  const dash = (id: string) => page.locator(`.timeline__line[data-series="${id}"]`).evaluate((el) => (el as SVGPathElement).style.strokeDasharray)
  await expect.poll(() => dash('feed')).toBe('')
  const second = await dash('store')
  const third = await dash('third')
  expect(second).not.toBe('')
  expect(third).not.toBe('')
  expect(third).not.toBe(second)
  await expect(page.locator('.timeline__key .timeline__mark--line')).toHaveCount(2)
  await expect(page.locator(`.timeline__key .timeline__mark--line[data-dash="${second.replace(/px/g, '').replace(/, /g, ' ')}"]`)).toHaveCount(1)
  // hide the solid line: the other two keep their own patterns
  await page.locator('.timeline__key', { hasText: 'feed' }).click()
  await expect.poll(() => dash('store')).toBe(second)
  expect(await dash('third')).toBe(third)
  // hide one more: nothing left shares the colour, so nothing needs a pattern
  await page.locator('.timeline__key', { hasText: 'store' }).click()
  await expect.poll(() => dash('third')).toBe('')
})

test('a table read only by a rule cannot be removed, and draws its rate', async ({ page }) => {
  await openApp(page)
  const doc = JSON.parse(plant())
  doc.edges = doc.edges.filter((e: { id: string }) => e.id !== 'use')
  await importGraph(page, JSON.stringify(doc))
  await openInputsTab(page)
  await expect(page.getByRole('button', { name: 'Remove timetable Demand' })).toBeVisible()
  await choose(page, 'ro')
  await section(page).getByLabel('Runs at').selectOption('rule')
  await section(page).getByLabel('Timetable').selectOption('demand')
  await expect(page.getByRole('button', { name: 'Remove timetable Demand' })).toHaveCount(0)
  await ensureTimelineOpen(page)
  await expect(page.locator('.timeline__rate:not(.timeline__run)')).toHaveCount(1)
})

test('a held stage says what held it in the tank’s own unit, in the Inspector and the run bar alike', async ({ page }) => {
  await openApp(page)
  const doc = JSON.parse(plant(10))
  doc.kinds[0].units = [{ name: 'L', factor: '0.001' }]
  doc.nodes[0].data.unit = 'L'
  doc.nodes[0].data.initial = 10000
  await importGraph(page, JSON.stringify(doc))
  await makeRule(page)
  await advance(page)
  const words = /ran below its target: .*feed.* held .*10000 L.* of the .*100000 L.* it needed\. Steps in a row: 1\./
  await expect(section(page).getByText(words)).toBeVisible()
  await expect(page.getByTestId('run-diagnostics').getByText(words)).toBeVisible()
})

test('a band under one full step warns with both numbers, and a shorter step clears it', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await makeRule(page)
  await section(page).getByLabel('Band').fill('50')
  await section(page).getByLabel('Band').press('Tab')
  const warning = section(page).getByText(/The band of .*50 m³.* is under the .*100 m³.* this stage moves at .*store/)
  await expect(warning).toBeVisible()
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setTime({ step: { value: 15, unit: 'min' } }))
  await expect(warning).toHaveCount(0)
})

test('a longer step that a rule cannot stand is announced before it applies', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await makeRule(page)
  await openInputsTab(page)
  const value = page.getByRole('spinbutton', { name: 'Step length value' })
  await value.fill('6')
  await value.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('too coarse')
  await expect(page.getByRole('dialog')).toContainText('RO')
  expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().time.step.value)).toBe(1)
})

// #520 — no rule here: the warning belongs to any `pull all` group
test('a step that leaves a pull all loop short at the start is announced, and the stage says why', async ({ page }) => {
  await openApp(page)
  await importGraph(
    page,
    JSON.stringify({
      schema: 'loop-studio/graph/5',
      version: 1,
      nodes: [
        pool('feed', 0, 100000),
        pool('own', 0, 100, 1000),
        { id: 'ro', type: 'converter', position: { x: 260, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAll' } },
        pool('store', 520, 0),
      ],
      edges: [line('in', 'feed', 'ro', '100', 'CMH'), line('take', 'own', 'ro', '60', 'CMH'), line('made', 'ro', 'store', '100', 'CMH'), line('back', 'ro', 'own', '60', 'CMH')],
      kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
      time: { step: { value: 1, unit: 'h' } },
    }),
  )
  await choose(page, 'ro')
  await expect(section(page)).toBeVisible()
  await expect(section(page)).not.toContainText('starts with')

  await openInputsTab(page)
  const value = page.getByRole('spinbutton', { name: 'Step length value' })
  await value.fill('6')
  await value.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('may not start')
  await expect(dialog).toContainText('RO')
  await expect(dialog).not.toContainText('too coarse')
  expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().time.step.value)).toBe(1)

  await dialog.locator('.btn--primary').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().time.step.value)).toBe(6)
  await expect(section(page)).toContainText('starts with')
  await expect(section(page)).toContainText('no supply reaches it unless this group runs first, so pull all may never start')
})

// #520, Lumi's review of #531 — two pull all groups that refill each other: the other
// group does refill each tank, so the warning must not say only this group does. It says
// what the supply waits on.
test('two groups that refill each other: each stage says no supply reaches its tank unless it runs first', async ({ page }) => {
  await openApp(page)
  const stage = (id: string, label: string, x: number) => ({ id, type: 'converter', position: { x, y: 200 }, data: { kind: 'converter', label, activation: 'automatic', mode: 'pullAll' } })
  await importGraph(
    page,
    JSON.stringify({
      schema: 'loop-studio/graph/5',
      version: 1,
      nodes: [pool('feedA', 0, 100000), pool('tankA', 200, 1, 1000), stage('ga', 'Stage A', 0), pool('feedB', 400, 100000), pool('tankB', 600, 1, 1000), stage('gb', 'Stage B', 400)],
      edges: [
        line('fa', 'feedA', 'ga', '10'), line('ta', 'tankA', 'ga', '5'), line('ab', 'ga', 'tankB', '5'),
        line('fb', 'feedB', 'gb', '10'), line('tb', 'tankB', 'gb', '5'), line('ba', 'gb', 'tankA', '5'),
      ],
      kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
      time: { step: { value: 1, unit: 'h' } },
    }),
  )
  for (const [id, tank] of [['ga', 'tankA'], ['gb', 'tankB']] as const) {
    await choose(page, id)
    const warning = page.locator(`[data-run-rule="${id}"]`)
    await expect(warning).toContainText(tank)
    await expect(warning).toContainText('starts with')
    await expect(warning).toContainText('no supply reaches it unless this group runs first, so pull all may never start')
    await expect(warning).not.toContainText('only this group refills it')
  }
})

test('a stage whose tag shows no words can be read in the Inspector and the Inputs list', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openApp(page)
  const doc = JSON.parse(readFileSync(new URL('../examples/desalination.json', import.meta.url), 'utf8'))
  const rules: [string, string][] = [['remin', 'product'], ['ro', 'permeate'], ['filter', 'filtered'], ['adjust', 'brine'], ['thick', 'backwash']]
  for (const [stage, tank] of rules) doc.nodes.find((n: { id: string }) => n.id === stage).data.run = { tank, level: '1', band: '1', side: 'fill', table: 'demand' }
  doc.nodes.find((n: { id: string }) => n.id === 'dpump').data.run = { table: 'demand' }
  const timetables = [{ id: 'demand', label: 'City demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }]
  await importGraph(page, JSON.stringify({ ...doc, schema: 'loop-studio/graph/6', timetables, time: doc.time ?? { step: { value: 1, unit: 'h' } } }))
  // no words on the canvas, with nothing chosen
  await expect.poll(() => page.locator('[data-stage-tag="remin"] .stage-tag__shown').innerText()).toBe('')
  await openInputsTab(page)
  await expect(page.locator('[data-run-row="remin"]')).toContainText('Product water tank')
  await expect(page.locator('[data-run-row="remin"]')).toContainText('City demand')
  await page.locator('[data-run-row="remin"]').getByRole('button').click()
  await expect(page.locator('[data-run-reading]')).toContainText('Product water tank')
  await expect(page.locator('[data-run-reading]')).toContainText('City demand')
})

test('Help says how a rule reads a tank, on the desktop menu', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'How a run rule reads a tank' }).click()
  await expect(page.getByRole('dialog')).toContainText('a tank at 750 asks for 50 %')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
