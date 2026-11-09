import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// SEMANTICS-M6.md §M6-8 — the stage tag on the real canvas, through real steps. The words
// are in src/ui/stageTag.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const pool = (id: string, x: number, y: number, initial: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny', resourceType: 'water' } })
const line = (id: string, source: string, target: string, flow: string, ports?: Record<string, string>) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, unit: 'CMH', route: 'orthogonal', ...(ports ? { ports } : {}) } })
const FRAME = {
  schema: 'loop-studio/graph/6',
  version: 1,
  kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
  time: { step: { value: 1, unit: 'h' } },
  timetables: [{ id: 'demand', label: 'Demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }],
}
const plant = (feed = 1000, wanted = '25', tableName = 'Demand') =>
  JSON.stringify({
    ...FRAME,
    timetables: [{ ...FRAME.timetables[0], label: tableName, points: [['0', wanted]] }],
    nodes: [
      pool('tank', 0, 0, feed),
      { id: 'ro', type: 'converter', position: { x: 260, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny', run: { table: 'demand', rated: 'feed' } } },
      pool('store', 520, 0, 0),
    ],
    edges: [line('feed', 'tank', 'ro', '100'), line('product', 'ro', 'store', '100')],
  })

const shown = (page: Page, id: string) => page.locator(`[data-stage-tag="${id}"] .stage-tag__shown`)
/** the words without the isolates around a name (U+2066 to U+2069) */
const plain = (s: string | null) => [...(s ?? '')].filter((c) => c.codePointAt(0)! < 0x2066 || c.codePointAt(0)! > 0x2069).join('')
const words = (page: Page, id: string) => shown(page, id).textContent().then(plain)
const full = (page: Page, id: string) => page.locator(`[data-stage-tag="${id}"] .stage-tag__full`)
const advance = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
const select = (page: Page, id: string | null) => page.evaluate((x) => (window as unknown as Bridge).__loop.graph.getState().setSelection(x, null), id)

test('before a run the tag says there is a rule and what it reads', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await expect.poll(() => words(page, 'ro')).toBe('Run rule · reads Demand')
})

test('a stage that met its target says how far it ran, and no more', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant())
  await advance(page)
  await expect.poll(() => words(page, 'ro')).toBe('Run 25 % · reads Demand')
  await expect(page.locator('.react-flow__node[data-id="ro"] [role="img"]')).toHaveAttribute('aria-label', /Run .?25.? % · reads .?Demand/)
})

test('a stage held short says both numbers', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(10))
  await advance(page)
  await expect.poll(() => words(page, 'ro')).toBe('Run 10 %, target 25 % · reads Demand')
})

test('a step moves no line and changes no block', async ({ page }) => {
  await openApp(page)
  await importGraph(page, plant(10))
  const layout = () =>
    page.evaluate(() => {
      const l = (window as unknown as { __loop: Record<string, any> }).__loop
      const block = document.querySelector<HTMLElement>('.react-flow__node[data-id="ro"] .nodef__label')!
      return { block: [block.offsetWidth, block.offsetHeight], lines: [...l.routeMap.all().values()].map((r: any) => r.d) }
    })
  const before = await layout()
  await advance(page)
  await expect(shown(page, 'ro')).toContainText('target')
  expect(await layout()).toEqual(before)
})

// what a run can print is the block's limit: the words of these two steps must fit the
// block that was sized before the run, and the step must move nothing
const CASES: [string, number, string, string][] = [
  // with this name the widest words before #517's review filled their lines exactly
  ['a near miss', 24.96, '25.04', 'Run 24.96 %, target 25.04 % · reads City water demand'],
  ['a run far under 1 %', 1000, '0.0000005', 'Run <0.01 % · reads City water demand'],
  ['a stage stopped far under 1 %', 0.00000004, '0.0000005', 'Stopped, target <0.01 % · reads City water demand'],
]
for (const [name, feed, wanted, words_] of CASES) {
  test(`${name} fits the block, and the step moves no line or chip`, async ({ page }) => {
    await openApp(page)
    await importGraph(page, plant(feed, wanted, 'City water demand'))
    const layout = () =>
      page.evaluate(() => {
        const l = (window as unknown as { __loop: Record<string, any> }).__loop
        const block = document.querySelector<HTMLElement>('.react-flow__node[data-id="ro"] .nodef__label')!
        return {
          block: [block.offsetWidth, block.offsetHeight],
          lines: [...l.routeMap.all().values()].map((r: any) => r.d),
          chips: [...document.querySelectorAll<HTMLElement>('.edge-label[data-edge-id]')].map((c) => c.style.transform),
        }
      })
    const before = await layout()
    await advance(page)
    await expect.poll(() => words(page, 'ro')).toBe(words_)
    expect(await layout()).toEqual(before)
    await select(page, 'ro')
    await expect(full(page, 'ro')).toBeVisible()
    const over = await page.evaluate(() => {
      const tag = document.querySelector('[data-stage-tag="ro"]')!
      const room = tag.querySelector('.stage-tag__size')!.getBoundingClientRect()
      const past = (el: Element) => {
        const r = document.createRange()
        r.selectNodeContents(el)
        return Math.max(...[...r.getClientRects()].map((w) => Math.max(room.left - w.left, w.right - room.right, room.top - w.top, w.bottom - room.bottom)))
      }
      return [past(tag.querySelector('.stage-tag__shown')!), past(tag.querySelector('.stage-tag__full')!)]
    })
    expect(Math.max(...over)).toBeLessThanOrEqual(0.5)
  })
}

test('a folded tag names its tank when the stage or the tank is chosen, or the line pointed at', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openApp(page)
  const doc = JSON.parse(readFileSync(new URL('../examples/desalination.json', import.meta.url), 'utf8'))
  // one rule, so one read line to point at
  for (const n of doc.nodes) delete n.data.run
  const stage = doc.nodes.find((n: { id: string }) => n.id === 'filter')
  stage.data.run = { tank: 'filtered', level: '1', band: '1', side: 'fill' }
  // the tank 120 to the right of the stage, as the Template had it before #540, leaves the
  // tag too little room for its words, so it folds
  doc.nodes.find((n: { id: string }) => n.id === 'filtered').position.x = stage.position.x + 120
  await importGraph(page, JSON.stringify({ ...doc, schema: 'loop-studio/graph/6' }))
  const tank = 'Filtered water tank'
  await expect.poll(() => page.locator('[data-stage-tag="filter"]').getAttribute('data-form')).not.toBe('0')
  await expect(shown(page, 'filter')).not.toContainText(tank)
  await expect(full(page, 'filter')).toBeHidden()

  await select(page, 'filter')
  await expect(full(page, 'filter')).toBeVisible()
  await expect(full(page, 'filter')).toContainText(tank)

  await select(page, 'filtered')
  await expect(full(page, 'filter')).toBeVisible()

  await select(page, null)
  await expect(full(page, 'filter')).toBeHidden()
  // a view with the whole line on the canvas, clear of the side panels
  await page.evaluate(() => (window as unknown as { __loop: Record<string, any> }).__loop.rf.setViewport({ x: -500, y: -100, zoom: 1 }, { duration: 0 }))
  // the middle of the line itself: its box's middle can lie off a line that turns
  const mid = await page.locator('[data-read-edge] .read-edge__line').evaluate((el) => {
    const p = el as SVGPathElement
    const at = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()!
    return { x: m.a * at.x + m.c * at.y + m.e, y: m.b * at.x + m.d * at.y + m.f }
  })
  await page.mouse.move(mid.x, mid.y)
  await expect(full(page, 'filter')).toBeVisible()
})

test('a tag with no room even for … shows no words, and still opens', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openApp(page)
  const doc = JSON.parse(readFileSync(new URL('../examples/desalination.json', import.meta.url), 'utf8'))
  const rules: [string, string][] = [['remin', 'product'], ['ro', 'permeate'], ['filter', 'filtered'], ['adjust', 'brine'], ['thick', 'backwash']]
  for (const [stage, tank] of rules) doc.nodes.find((n: { id: string }) => n.id === stage).data.run = { tank, level: '1', band: '1', side: 'fill', table: 'demand' }
  doc.nodes.find((n: { id: string }) => n.id === 'dpump').data.run = { table: 'demand' }
  // Electrical panel C 130 below Remineralization, as the Template had it before #540, leaves
  // Remineralization's tag no room even for …
  const remin = doc.nodes.find((n: { id: string }) => n.id === 'remin')
  doc.nodes.find((n: { id: string }) => n.id === 'panelC').position.y = remin.position.y + 130
  const timetables = [{ ...FRAME.timetables[0], label: 'City demand' }]
  await importGraph(page, JSON.stringify({ ...doc, schema: FRAME.schema, timetables, time: doc.time ?? FRAME.time }))
  await expect.poll(() => words(page, 'remin')).toBe('')
  await select(page, 'remin')
  await expect(full(page, 'remin')).toBeVisible()
  await expect(full(page, 'remin')).toContainText('Product water tank')
})

test('a stage whose line cannot be drawn says so and names the tank', async ({ page }) => {
  await openApp(page)
  const stage = (i: number) => ({ id: `s${i}`, type: 'converter', position: { x: 420 + (i % 2) * 300, y: 80 + Math.floor(i / 2) * 150 }, data: { kind: 'converter', label: `S${i}`, activation: 'automatic', mode: 'pullAny', run: { tank: 'shared', level: '1', band: '1', side: 'fill' } } })
  await importGraph(
    page,
    JSON.stringify({
      ...FRAME,
      nodes: [{ ...pool('shared', 0, 300, 100), data: { ...pool('shared', 0, 300, 100).data, label: 'Shared tank' } }, pool('n', 0, 0, 0), pool('e', 320, 0, 0), pool('w', -320, 300, 0), ...[0, 1, 2, 3, 4, 5, 6].map(stage)],
      edges: [line('t', 'shared', 'n', '1', { source: 'top', target: 'bottom' }), line('r', 'shared', 'e', '1', { source: 'right', target: 'left' }), line('l', 'shared', 'w', '1', { source: 'left', target: 'right' })],
    }),
  )
  await expect(page.locator('[data-read-edge]')).toHaveCount(6)
  await expect.poll(() => words(page, 's6')).toContain('no line to Shared tank')
  await expect(page.locator('.react-flow__node[data-id="s6"] [role="img"]')).toHaveAttribute('aria-label', /no line to .?Shared tank/)
  await expect(shown(page, 's5')).not.toContainText('no line')
})
