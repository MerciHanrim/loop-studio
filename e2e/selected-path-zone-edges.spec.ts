import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Colour review 2026-11-11, implementation PR 2.
//  - `hsel`: a connection touching a SELECTED node (`.lgr-selpath`, Canvas.tsx) keeps 2 px on
//    screen at every zoom and is never thinner than its own width (index.css). Only those
//    connections; the class leaves with the selection; Focus mode and the hover relation (#444)
//    compose with it.
//  - `sfw` (2026-11-14): in forced colours the pin of unselected STATE lines at 1.5 px outranked
//    `hsel`. Over a light system palette a selected node's state lines now keep 2 px on screen
//    too; over a dark one they keep the pin.
//  - zone edges: the five frame accents at chroma 0.12 in light and dark, an accented frame's
//    edge at full opacity, its fill kept at 0.06; the same token draws the label chip's border and
//    the colour picker's swatch.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: 20, mode: 'pullAny', resourceType: 'Gold' } },
    { id: 'split', type: 'gate', position: { x: 480, y: 0 }, data: { kind: 'gate', label: 'Split', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'sink', type: 'drain', position: { x: 720, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sg', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_gs', type: 'loop', source: 'gold', target: 'split', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
    { id: 'e_sd', type: 'loop', source: 'split', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 's_fb', type: 'loop', source: 'gold', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
    // a state line that does not touch `gold`
    { id: 's_ot', type: 'loop', source: 'split', target: 'sink', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})
const OWN = ['e_sg', 'e_gs', 's_fb'] // the connections touching `gold`
const OTHER = 'e_sd'

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => (window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: false }))
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(GRAPH, 'utf8') })
  await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
}

async function zoomTo(page: Page, zoom: number): Promise<void> {
  await page.evaluate((zoom) => {
    const w = window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    w.__loop.rf.setViewport({ x: pane.width / 2 - 380 * zoom, y: pane.height / 2 - 40 * zoom, zoom }, { duration: 0 })
  }, zoom)
  await expect(page.locator('.canvas')).toHaveAttribute('style', new RegExp(`--canvas-zoom: ${zoom}(;|$)`))
}

const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`)
const width = (page: Page, id: string) => edge(page, id).locator('.react-flow__edge-path').evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth))
/** select `gold` by a click and move the pointer away: no hover and no keyboard focus, so the
 *  #444 relation (hover or :focus-visible) is off and the selection alone is read */
const selectGold = async (page: Page) => {
  const gold = page.locator('.react-flow__node[data-id="gold"]')
  await gold.locator('.nodef__stroke').click({ force: true })
  await page.mouse.move(2, 2)
  await expect(gold.locator('.nodef__sel')).toHaveCount(1)
  await expect(edge(page, 'e_gs')).not.toHaveClass(/rel-edge/)
}

test.describe('hsel — a selected node’s own connections keep 2 px on screen', () => {
  test('only the selected node’s connections, at every zoom, never thinner than their own width; gone with the selection', async ({ page }) => {
    await load(page)
    for (const id of [...OWN, OTHER]) await expect(edge(page, id)).not.toHaveClass(/lgr-selpath/)
    await selectGold(page)
    for (const id of OWN) await expect(edge(page, id)).toHaveClass(/lgr-selpath/)
    await expect(edge(page, OTHER)).not.toHaveClass(/lgr-selpath/)

    for (const zoom of [0.2, 0.6, 1, 2]) {
      await test.step(`zoom ${zoom}`, async () => {
        await zoomTo(page, zoom)
        // a flow (own width 1.5) and a state line (own width 1): max(own, 2 / zoom) world px
        expect(await width(page, 'e_sg')).toBeCloseTo(Math.max(1.5, 2 / zoom), 2)
        expect(await width(page, 's_fb')).toBeCloseTo(Math.max(1, 2 / zoom), 2)
        // a connection that does not touch the selection keeps its own width
        expect(await width(page, OTHER)).toBeCloseTo(1.5, 2)
      })
    }

    // the selection cleared (a click on the empty pane): the class and the width go
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__sel')).toHaveCount(0)
    for (const id of OWN) await expect(edge(page, id)).not.toHaveClass(/lgr-selpath/)
    await zoomTo(page, 0.2)
    expect(await width(page, 'e_sg')).toBeCloseTo(1.5, 2)
  })

  test('Focus mode on and off: the selected node’s connections stay at full strength and 2 px; the rest dim and keep their width', async ({ page }) => {
    await load(page)
    await selectGold(page)
    await zoomTo(page, 0.4)
    const setFocus = (on: boolean) =>
      page.evaluate((on) => (window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: on }), on)
    await setFocus(true)
    await expect(edge(page, OTHER)).toHaveClass(/lgr-deemph/)
    for (const id of OWN) {
      await expect(edge(page, id)).toHaveClass(/lgr-selpath/)
      await expect(edge(page, id)).not.toHaveClass(/lgr-deemph/)
    }
    expect(await width(page, 'e_gs')).toBeCloseTo(2 / 0.4, 2)
    expect(await width(page, OTHER)).toBeCloseTo(1.5, 2)
    await setFocus(false)
    await expect(edge(page, OTHER)).not.toHaveClass(/lgr-deemph/)
    for (const id of OWN) await expect(edge(page, id)).toHaveClass(/lgr-selpath/)
    expect(await width(page, 'e_gs')).toBeCloseTo(2 / 0.4, 2)
  })

  test('the hover relation on the selected node: one step heavier, never under 2 px on screen', async ({ page }) => {
    await load(page)
    await selectGold(page)
    for (const zoom of [0.3, 1]) {
      await zoomTo(page, zoom)
      await page.locator('.react-flow__node[data-id="gold"] .nodef__stroke').hover({ force: true })
      await expect(edge(page, 'e_gs')).toHaveClass(/rel-edge/)
      expect(await width(page, 'e_gs')).toBeCloseTo(Math.max(2.5, 2 / zoom), 2)
      await page.mouse.move(2, 2)
      await expect(edge(page, 'e_gs')).not.toHaveClass(/rel-edge/)
    }
  })

  // `sfw` (Lumi, 2026-11-14) — forced colours pin every state line that is not
  // itself selected at 1.5 px (world), with a rule that outranked `hsel`: at
  // the overview a selected node's state lines were a quarter of a pixel on
  // screen. Over a LIGHT system palette they now keep 2 px on screen, as the
  // node's flows do; over a dark one they are left as they were. The dashes
  // are the same in both, and no other line changes.
  const dash = (page: Page, id: string) => edge(page, id).locator('.react-flow__edge-path').evaluate((el) => getComputedStyle(el).strokeDasharray)

  test('forced colours, light: a selected node’s state line keeps 2 px on screen, its dashes as they were; other state lines keep the pinned 1.5 px', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' })
    await load(page)
    expect(await page.evaluate(() => matchMedia('(forced-colors: active) and (prefers-color-scheme: light)').matches), 'forced colours over a light palette').toBe(true)
    const dashBefore = await dash(page, 's_fb')
    await zoomTo(page, 0.2)
    // nothing selected: every state line at the pinned width
    expect(await width(page, 's_fb')).toBeCloseTo(1.5, 2)
    expect(await width(page, 's_ot')).toBeCloseTo(1.5, 2)
    await selectGold(page)
    for (const zoom of [0.2, 0.4, 1, 2]) {
      await test.step(`zoom ${zoom}`, async () => {
        await zoomTo(page, zoom)
        // 2 px on screen, and never under the pinned 1.5 px of world
        expect(await width(page, 's_fb'), 'the selected node’s state line').toBeCloseTo(Math.max(1.5, 2 / zoom), 2)
        expect((await width(page, 's_fb')) * zoom, 'on screen').toBeGreaterThanOrEqual(2 - 0.01)
        // its flows, as before
        expect(await width(page, 'e_sg')).toBeCloseTo(Math.max(1.5, 2 / zoom), 2)
        // a state line that does not touch the selection, and a flow that does not
        expect(await width(page, 's_ot'), 'another node’s state line').toBeCloseTo(1.5, 2)
        expect(await width(page, OTHER)).toBeCloseTo(1.5, 2)
        expect(await dash(page, 's_fb'), 'the dashes are not changed').toBe(dashBefore)
      })
    }
    // the selection cleared: back to the pinned width
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
    await expect(edge(page, 's_fb')).not.toHaveClass(/lgr-selpath/)
    await zoomTo(page, 0.2)
    expect(await width(page, 's_fb')).toBeCloseTo(1.5, 2)
  })

  test('forced colours, dark: a selected node’s state line keeps its pinned 1.5 px; its flow takes the 2 px', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
    await load(page)
    expect(await page.evaluate(() => matchMedia('(forced-colors: active) and (prefers-color-scheme: dark)').matches), 'forced colours over a dark palette').toBe(true)
    const dashBefore = await dash(page, 's_fb')
    await selectGold(page)
    for (const zoom of [0.2, 0.4, 1, 2]) {
      await test.step(`zoom ${zoom}`, async () => {
        await zoomTo(page, zoom)
        expect(await width(page, 's_fb'), 'the selected node’s state line, as before').toBeCloseTo(1.5, 2)
        expect(await width(page, 's_ot')).toBeCloseTo(1.5, 2)
        expect(await width(page, 'e_sg')).toBeCloseTo(Math.max(1.5, 2 / zoom), 2)
        expect(await dash(page, 's_fb')).toBe(dashBefore)
      })
    }
  })

  test('forced colours, light: a state line that is itself selected keeps its own 2 px', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' })
    await load(page)
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { setSelection: (n: string | null, e: string | null) => void; onEdgesChange: (c: object[]) => void } } } }).__loop.graph.getState()
      g.setSelection(null, 's_fb')
      g.onEdgesChange([{ id: 's_fb', type: 'select', selected: true }])
    })
    await expect(edge(page, 's_fb')).toHaveClass(/selected/)
    await zoomTo(page, 0.2)
    // the `.selected` group is outside both the pin and this rule
    expect(await width(page, 's_fb')).toBeCloseTo(2, 2)
  })
})

const ACCENTS = {
  light: { slate: '#077eae', sage: '#51883f', gold: '#a37309', violet: '#7f5da9', rose: '#a45585' },
  dark: { slate: '#3eabdc', sage: '#80b669', gold: '#cd9e44', violet: '#b190e1', rose: '#d480b0' },
} as const

test.describe('zone edges — the stronger frame accents, edge at full opacity, fill 0.06', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(scheme, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await load(page)
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
      for (const [name, hex] of Object.entries(ACCENTS[scheme])) {
        await test.step(name, async () => {
          const id = await page.evaluate(
            (c) => (window as unknown as { __loop: { frame: { getState: () => { adoptFrame: (r: object, l: string, c?: string) => string } } } }).__loop.frame.getState().adoptFrame({ x: -40, y: -60, w: 340, h: 200 }, `Zone ${c}`, c),
            name,
          )
          const fill = page.locator(`.lgr-frame__fill[data-color="${name}"]`)
          await expect(fill).toHaveCount(1)
          // read it unselected (a selected frame takes its own weight and 0.95 opacity, §FC3)
          await page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { selectFrame: (i: string | null) => void } } } }).__loop.frame.getState().selectFrame(null))
          await expect(fill).not.toHaveClass(/is-selected/)
          const s = await fill.evaluate((el) => { const c = getComputedStyle(el); return { stroke: c.stroke, fill: c.fill, so: c.strokeOpacity, fo: c.fillOpacity } })
          expect(s.stroke).toBe(rgb(hex))
          expect(s.fill).toBe(rgb(hex))
          expect(Number(s.so)).toBe(1)
          expect(Number(s.fo)).toBeCloseTo(0.06, 5)
          // the label chip's border takes the same token
          const chip = page.locator(`.lgr-frame[data-color="${name}"] .lgr-frame__label`).first()
          await expect(chip).toHaveCSS('border-top-color', rgb(hex))
          // and the colour picker's swatch for it
          await chip.click()
          await expect(page.locator(`.lgr-frame__swatch[data-color="${name}"]`)).toHaveCSS('background-color', rgb(hex))
          await page.keyboard.press('Escape')
          await page.evaluate((i) => (window as unknown as { __loop: { frame: { getState: () => { removeFrame: (i: string) => void } } } }).__loop.frame.getState().removeFrame(i), id)
          await expect(fill).toHaveCount(0)
        })
      }
    })
  }
})
