import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-5 / docs/mobile.md — on a phone a
// flow colour set on desktop renders, and the read-only Inspector sheet shows
// the colour as one line of text: a dot and the colour's name and hex (its hex
// alone off the palette), Default with an empty ring, Mixed with no dot, and no
// control at all. Runs under the `mobile` project (390 x 844, touch).

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny', accent: '#638EA5' } },
    { id: 'gold', type: 'pool', position: { x: 200, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny', accent: '#B47599' } },
    { id: 'gems', type: 'pool', position: { x: 0, y: 200 }, data: { kind: 'pool', label: 'Gems', activation: 'passive', initial: 0, capacity: 100, mode: 'pullAny' } },
    { id: 'spend', type: 'drain', position: { x: 200, y: 200 }, data: { kind: 'drain', label: 'Spend', activation: 'automatic', mode: 'pullAny', accent: '#336699' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3', accent: '#A78243' } },
  ],
})

/** a tap through the phone's pan-capture overlay (as in mobile.spec.ts) */
async function tapNode(page: Page, node: Locator): Promise<void> {
  const b = (await node.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

const sheet = (page: Page) => page.locator('.sheet[aria-label="Inspector — read only"]')
const colour = (page: Page) => sheet(page).locator('.accent-field')
/** what the Colour section shows: its line's text, its dot (if any), and whether it holds any control */
const summary = (page: Page) =>
  colour(page).evaluate((f) => {
    const line = f.querySelector('.accent-field__summary') as HTMLElement | null
    const dot = f.querySelector('.accent-field__dot') as HTMLElement | null
    const lh = line ? parseFloat(getComputedStyle(line).lineHeight) || 18 : 0
    return {
      text: line?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      oneLine: line ? line.getBoundingClientRect().height <= lh * 1.5 : false,
      dot: dot ? { bg: getComputedStyle(dot).backgroundColor, empty: dot.classList.contains('accent-field__dot--none') } : null,
      controls: f.querySelectorAll('button, input, select, textarea, [tabindex]').length,
    }
  })

async function open(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
  await expect(page.locator('.react-flow__node[data-id="spend"]')).toBeVisible()
}

test('a desktop-set flow colour renders on the phone', async ({ page }) => {
  await open(page)
  const gold = page.locator('.react-flow__node[data-id="gold"]')
  await expect(gold.locator('.nodef')).toHaveAttribute('data-accent', '#B47599')
  await expect(gold.locator('.nodef__band')).toHaveCSS('stroke', 'rgb(180, 117, 153)')
  await expect(page.locator('.react-flow__edge[data-id="e1"] path.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(167, 130, 67)')
})

test('the read-only sheet shows the colour as one line of text, with no control', async ({ page }) => {
  await open(page)

  // a palette colour: its dot, its name and its hex
  await tapNode(page, page.locator('.react-flow__node[data-id="gold"]'))
  await expect(sheet(page)).toBeVisible()
  await expect(colour(page)).toBeVisible()
  await expect(colour(page).getByRole('heading', { name: 'Colour' })).toBeVisible()
  expect(await summary(page)).toEqual({ text: 'Rose #B47599', oneLine: true, dot: { bg: 'rgb(180, 117, 153)', empty: false }, controls: 0 })
  await expect(colour(page).locator('.accent-field__hexvalue')).toHaveAttribute('dir', 'ltr')
  await sheet(page).getByRole('button', { name: /close/i }).click()

  // a colour off the palette: its dot and its hex alone
  await tapNode(page, page.locator('.react-flow__node[data-id="spend"]'))
  await expect(colour(page)).toBeVisible()
  expect(await summary(page)).toEqual({ text: '#336699', oneLine: true, dot: { bg: 'rgb(51, 102, 153)', empty: false }, controls: 0 })
  await sheet(page).getByRole('button', { name: /close/i }).click()

  // no colour: Default, with an empty ring
  await tapNode(page, page.locator('.react-flow__node[data-id="gems"]'))
  await expect(colour(page)).toBeVisible()
  const plain = await summary(page)
  expect(plain).toMatchObject({ text: 'Default', oneLine: true, controls: 0 })
  expect(plain.dot?.empty).toBe(true)

  // two elements with different colours: Mixed, and no dot that would read as one colour
  await page.evaluate(() =>
    (window as any).__loop.graph.getState().onNodesChange([
      { id: 'gold', type: 'select', selected: true },
      { id: 'spend', type: 'select', selected: true },
    ]),
  )
  await expect.poll(async () => (await summary(page)).text).toBe('Mixed')
  expect(await summary(page)).toEqual({ text: 'Mixed', oneLine: true, dot: null, controls: 0 })

  // nothing in the sheet changed a colour
  expect(
    await page.evaluate(() => (window as any).__loop.graph.getState().nodes.map((n: { id: string; data: { accent?: string } }) => [n.id, n.data.accent ?? null])),
  ).toEqual([
    ['src', '#638EA5'],
    ['gold', '#B47599'],
    ['gems', null],
    ['spend', '#336699'],
  ])
})

test('the one-line Colour summary, in pixels', async ({ page }) => {
  await open(page)
  await tapNode(page, page.locator('.react-flow__node[data-id="gold"]'))
  await expect(colour(page)).toBeVisible()
  await colour(page).scrollIntoViewIfNeeded()
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await expect(colour(page)).toHaveScreenshot(...snap(page, 'flow-views-phone-summary'))
})
