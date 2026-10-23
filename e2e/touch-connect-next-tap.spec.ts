import { readFileSync } from 'node:fs'
import type { CDPSession, Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { openPanelDetails, WORKBENCH_ROOMY_VIEWPORT } from './support/panel'
import { reachablePointOnEdge } from './support/edgePoint'

// src/components/edges/connectTouchHold.ts — after a connection drawn by touch
// (lifted while the finger still moved), the next tap made no click: the
// control under it did nothing (measured 2026-10-22 under Chromium touch
// emulation; React Flow's connection drag never prevents the document's
// touchmove). A touch that starts on a port, or on an end grip, now holds its
// own moves until it ends. These checks are Chromium touch emulation, not a
// real device.

type L = {
  graph: { getState: () => { nodes: { id: string }[]; edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[] } }
  sim: { getState: () => { stepIndex: number } }
  rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: object, o?: object) => void }
}
const edges = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.length)
const stepIndex = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop.sim.getState().stepIndex)
const viewport = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.getViewport())
const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
type P = { x: number; y: number }

/** a one-finger touch drag, lifted while it still moves */
async function touchDrag(cdp: CDPSession, a: P, b: P, opts: { cancel?: boolean } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] })
  for (let i = 1; i <= 24; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 24, y: a.y + ((b.y - a.y) * i) / 24, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: opts.cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
}

/** the window's touch listeners registered in the capture phase (the hold's) */
async function heldListeners(cdp: CDPSession): Promise<number> {
  const { result } = (await cdp.send('Runtime.evaluate', { expression: 'window' })) as { result: { objectId: string } }
  const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })) as { listeners: { type: string; useCapture: boolean }[] }
  return listeners.filter((l) => l.useCapture && ['touchmove', 'touchend', 'touchcancel'].includes(l.type)).length
}

const port = (page: Page, node: string, h: 'in' | 'out') => page.locator(`.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${h}"]`)
const zoomIn = (page: Page) => page.locator('.wb-status').getByRole('button', { name: 'Zoom in', exact: true })
const stepBtn = (page: Page) => page.locator('button[title="Advance one step"]').first()

/** a tap is a click: Zoom in zooms */
async function expectTapZooms(page: Page, why: string) {
  const z0 = (await viewport(page)).zoom
  const c = await centre(zoomIn(page))
  await page.touchscreen.tap(c.x, c.y)
  await expect.poll(async () => (await viewport(page)).zoom, { message: `${why}: the first tap on Zoom in zooms` }).toBeGreaterThan(z0)
}

/** two pools, built by mouse so only what the test does is a touch gesture */
async function twoPools(page: Page): Promise<[string, string, CDPSession, number]> {
  await openApp(page)
  await resetAll(page)
  for (let i = 0; i < 2; i++) await page.locator('.chip.chip--pool').first().click()
  const ids = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.map((n) => n.id))
  const cdp = await page.context().newCDPSession(page)
  return [ids[0], ids[1], cdp, await heldListeners(cdp)]
}

for (const o of [
  { name: 'landscape', width: 1024, height: 768 },
  { name: 'portrait', width: 768, height: 1024 },
]) {
  test.describe(`a connection drawn by touch, then the next tap — tablet ${o.name}`, () => {
    test.use({ viewport: { width: o.width, height: o.height }, hasTouch: true })

    test('a connection made: the first tap on Step steps', async ({ page }) => {
      const [a, b, cdp, base] = await twoPools(page)
      await touchDrag(cdp, await centre(port(page, a, 'out')), await centre(port(page, b, 'in')))
      await expect.poll(() => edges(page)).toBe(1)
      expect(await heldListeners(cdp), 'nothing held after the finger lifted').toBe(base)
      const s = await centre(stepBtn(page))
      await page.touchscreen.tap(s.x, s.y)
      // one step commits when its playback transition settles
      await expect.poll(() => stepIndex(page), { timeout: 6000 }).toBe(1)
    })

    test('a connection made: the first tap on another control (Zoom in) works', async ({ page }) => {
      const [a, b, cdp] = await twoPools(page)
      await touchDrag(cdp, await centre(port(page, a, 'out')), await centre(port(page, b, 'in')))
      await expect.poll(() => edges(page)).toBe(1)
      await expectTapZooms(page, 'after a connection')
    })

    test('dropped on the empty canvas, refused (a repeat), cancelled: nothing made, and the next tap works each time', async ({ page }) => {
      const [a, b, cdp, base] = await twoPools(page)
      const pane = (await page.locator('.react-flow').boundingBox())!
      const empty = { x: pane.x + 40, y: pane.y + pane.height - 60 }
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'), [empty.x, empty.y] as const), 'the drop point is the empty canvas').toBe(true)
      await touchDrag(cdp, await centre(port(page, a, 'out')), empty)
      expect(await edges(page)).toBe(0)
      expect(await heldListeners(cdp)).toBe(base)
      await expectTapZooms(page, 'after a drop on the empty canvas')

      // the same pair twice: the second is refused (duplicate)
      await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
      await touchDrag(cdp, await centre(port(page, a, 'out')), await centre(port(page, b, 'in')))
      await expect.poll(() => edges(page)).toBe(1)
      await expectTapZooms(page, 'after a connection')
      await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
      await touchDrag(cdp, await centre(port(page, a, 'out')), await centre(port(page, b, 'in')))
      expect(await edges(page), 'the repeat is refused').toBe(1)
      expect(await heldListeners(cdp)).toBe(base)
      await expectTapZooms(page, 'after a refused connection')

      // cancelled by the system (touchcancel) mid-drag
      await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
      await touchDrag(cdp, await centre(port(page, b, 'out')), empty, { cancel: true })
      expect(await edges(page)).toBe(1)
      expect(await heldListeners(cdp)).toBe(base)
      await expectTapZooms(page, 'after a cancelled drag')
    })

    test('a second finger during the connection: no connection made by it, nothing held after, and the canvas pans again', async ({ page }) => {
      const [a, , cdp, base] = await twoPools(page)
      const pane = (await page.locator('.react-flow').boundingBox())!
      const p1 = await centre(port(page, a, 'out'))
      const p2 = { x: pane.x + 40, y: pane.y + pane.height - 120 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p1.x, y: p1.y, id: 1 }] })
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p1.x + 6 * i, y: p1.y + 8 * i, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p1.x + 48, y: p1.y + 64, id: 1 }, { x: p2.x, y: p2.y, id: 2 }] })
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p1.x + 48 + 4 * i, y: p1.y + 64 + 4 * i, id: 1 }, { x: p2.x + 6 * i, y: p2.y - 4 * i, id: 2 }] })
      expect(await heldListeners(cdp), 'held while the connection’s finger is down').toBe(base + 3)
      // the connection's finger lifts first, on the empty canvas; the other one
      // follows (CDP's touchEnd releases the points it lists — checked: this
      // gives touchend changedTouches = the first finger, touches = the second)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p1.x + 80, y: p1.y + 96, id: 1 }] })
      expect(await heldListeners(cdp), 'nothing held once the connection’s finger is up').toBe(base)
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p2.x + 48 + 6 * i, y: p2.y - 32, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(200)
      expect(await edges(page), 'no connection made').toBe(0)
      expect(await heldListeners(cdp)).toBe(base)
      // a one-finger pan on the empty canvas moves the view
      const v0 = await viewport(page)
      await touchDrag(cdp, { x: pane.x + 40, y: pane.y + pane.height - 60 }, { x: pane.x + 120, y: pane.y + pane.height - 120 })
      await expect.poll(async () => (await viewport(page)).x).not.toBe(v0.x)
    })

    // a second finger that lands on ANOTHER node's port while the connection's
    // finger is down (2026-10-23; reproduced 2026-10-22: the hold moved to the
    // new finger, was released when it lifted, the connection was lost and
    // the next tap made no click). The hold stays with the first finger.
    test('a second finger on another port during the connection: the first connection is kept, nothing held after, the next tap works', async ({ page }) => {
      const [a, b, cdp, base] = await twoPools(page)
      await page.locator('.chip.chip--pool').first().click()
      const c = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.map((n) => n.id).pop()!)
      const pA = await centre(port(page, a, 'out'))
      const pB = await centre(port(page, b, 'in'))
      const pC = await centre(port(page, c, 'in'))
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.react-flow__handle'), [pC.x, pC.y] as const), 'the second finger lands on a port').toBe(true)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pA.x, y: pA.y, id: 1 }] })
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pA.x + 5 * i, y: pA.y + 5 * i, id: 1 }] })
      const f1 = { x: pA.x + 30, y: pA.y + 30 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...f1, id: 1 }, { ...pC, id: 2 }] })
      for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f1.x + 3 * i, y: f1.y + 3 * i, id: 1 }, { ...pC, id: 2 }] })
      expect(await heldListeners(cdp), 'held while both fingers are down').toBe(base + 3)
      // the second finger lifts; the connection's finger is still down
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...pC, id: 2 }] })
      expect(await heldListeners(cdp), 'still held: the connection’s finger is down').toBe(base + 3)
      const f1b = { x: f1.x + 12, y: f1.y + 12 }
      for (let i = 1; i <= 16; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f1b.x + ((pB.x - f1b.x) * i) / 16, y: f1b.y + ((pB.y - f1b.y) * i) / 16, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.map((e) => `${e.source}>${e.target}`)), { message: 'the first finger’s connection is made, and only it' }).toEqual([`${a}>${b}`])
      expect(await heldListeners(cdp), 'nothing held after').toBe(base)
      await expectTapZooms(page, 'after a second finger on a port')
    })

    test('a second finger on another port, then the system cancels the touch: nothing made, nothing held, the next tap works', async ({ page }) => {
      const [a, , cdp, base] = await twoPools(page)
      await page.locator('.chip.chip--pool').first().click()
      const c = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.map((n) => n.id).pop()!)
      const pA = await centre(port(page, a, 'out'))
      const pC = await centre(port(page, c, 'in'))
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pA.x, y: pA.y, id: 1 }] })
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pA.x + 5 * i, y: pA.y + 5 * i, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pA.x + 30, y: pA.y + 30, id: 1 }, { ...pC, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pA.x + 36, y: pA.y + 36, id: 1 }, { ...pC, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await page.waitForTimeout(200)
      expect(await edges(page), 'nothing made').toBe(0)
      expect(await heldListeners(cdp), 'nothing held after the cancel').toBe(base)
      await expectTapZooms(page, 'after a cancelled two-finger touch')
    })

    test('a pinch on the canvas still zooms; a tap on a port, five connections and a mouse connection leave nothing held', async ({ page }) => {
      const [a, b, cdp, base] = await twoPools(page)
      const pane = (await page.locator('.react-flow').boundingBox())!
      // a pinch that starts on the empty canvas (not on a port) is the canvas's
      const c = { x: pane.x + pane.width / 2, y: pane.y + pane.height - 120 }
      const z0 = (await viewport(page)).zoom
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 30, y: c.y, id: 1 }, { x: c.x + 30, y: c.y, id: 2 }] })
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 30 - 8 * i, y: c.y, id: 1 }, { x: c.x + 30 + 8 * i, y: c.y, id: 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(async () => (await viewport(page)).zoom, { message: 'the pinch zooms in' }).toBeGreaterThan(z0)
      expect(await heldListeners(cdp)).toBe(base)

      // a tap on a port: held while the finger is down, released after
      await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
      const po = await centre(port(page, a, 'out'))
      await page.touchscreen.tap(po.x, po.y)
      expect(await heldListeners(cdp)).toBe(base)

      // five connections by touch, removed again each time
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
        await touchDrag(cdp, await centre(port(page, a, 'out')), await centre(port(page, b, 'in')))
        await expect.poll(() => edges(page)).toBe(1)
        await page.evaluate(() => (window as unknown as { __loop: { graph: { setState: (s: object) => void } } }).__loop.graph.setState({ edges: [] }))
        expect(await heldListeners(cdp), `after connection ${i + 1}`).toBe(base)
      }

      // by mouse nothing is ever held
      await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
      const m0 = await centre(port(page, a, 'out'))
      const m1 = await centre(port(page, b, 'in'))
      await page.mouse.move(m0.x, m0.y)
      await page.mouse.down()
      await page.mouse.move(m0.x + 6, m0.y + 6, { steps: 4 })
      await page.mouse.move(m1.x, m1.y, { steps: 12 })
      expect(await heldListeners(cdp), 'a mouse connection in progress holds nothing').toBe(base)
      await page.mouse.up()
      await expect.poll(() => edges(page)).toBe(1)
      expect(await heldListeners(cdp)).toBe(base)
    })
  })
}

// the end grips (§ER18) start the same connection engine; shown the way
// connection-ends.spec.ts shows them (its fixture, 1600 × 940, zoom 1.5)
test.describe('an end grip dragged by touch, then the next tap', () => {
  test.use({ viewport: WORKBENCH_ROOMY_VIEWPORT, hasTouch: true })
  const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
  async function open(page: Page): Promise<CDPSession> {
    await openApp(page)
    await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
    await expect(page.locator('.react-flow__node')).toHaveCount(7)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
    await routesSettled(page)
    const p = await reachablePointOnEdge(page, 'e_leave')
    await page.mouse.click(p.x, p.y)
    await openPanelDetails(page)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: -200, y: -120, zoom: 1.5 }, { duration: 0 }))
    await expect(page.locator('.end-grip[data-end="target"]')).toHaveCount(1)
    return page.context().newCDPSession(page)
  }
  const leave = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.find((e) => e.id === 'e_leave'))

  test('dropped on the empty canvas: the end is unchanged and the next tap works', async ({ page }) => {
    const cdp = await open(page)
    const base = await heldListeners(cdp)
    const before = await leave(page)
    const pane = (await page.locator('.react-flow').boundingBox())!
    const empty = { x: pane.x + pane.width - 60, y: pane.y + pane.height - 60 }
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'), [empty.x, empty.y] as const)).toBe(true)
    await touchDrag(cdp, await centre(page.locator('.end-grip[data-end="target"]')), empty)
    await page.waitForTimeout(200)
    expect(await leave(page)).toEqual(before)
    expect(await heldListeners(cdp)).toBe(base)
    await expectTapZooms(page, 'after a grip drag to the empty canvas')
  })

  test('dropped on another node’s face: the end moves and the next tap works', async ({ page }) => {
    const cdp = await open(page)
    const base = await heldListeners(cdp)
    const g = await centre(page.locator('.end-grip[data-end="target"]'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y, id: 1 }] })
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x + 4 * i, y: g.y + 4 * i, id: 1 }] })
    const face = page.locator('.react-flow__node[data-id="waiting"] .react-flow__handle[data-handleid="in@top"]')
    await expect(face).toHaveCount(1)
    const f = await centre(face)
    for (let i = 1; i <= 15; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x + 20 + ((f.x - g.x - 20) * i) / 15, y: g.y + 20 + ((f.y - g.y - 20) * i) / 15, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => (await leave(page))?.target).toBe('waiting')
    expect(await heldListeners(cdp)).toBe(base)
    await expectTapZooms(page, 'after a grip drag onto a face')
  })
})
