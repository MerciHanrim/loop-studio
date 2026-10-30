import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #410 — reproduction on current main. The frame move / resize pointer
// gesture listens on `window` and ends only on pointerup / pointercancel /
// Escape: it takes no pointer capture and has no blur end. When the window
// loses focus mid-drag (Alt+Tab, an OS dialog), no pointerup arrives. Does the
// gesture stay open, and does the frame follow the pointer when the window is
// back and the pointer moves with no button down?
//
// The focus loss is modelled by the events a real one produces: `blur` on
// window, then pointermoves with `buttons: 0`. A real Alt+Tab cannot be driven
// from the test runner; the app sees exactly these events either way.

type Rect = { x: number; y: number; w: number; h: number }
type Bridge = {
  __loop: {
    frame: { getState: () => { frames: { id: string; rect: Rect }[]; addFrame: (r: Rect) => string } }
    graph: { getState: () => { past: unknown[]; nodes: { id: string; position: { x: number; y: number } }[] } }
    rf: { setViewport: (v: { x: number; y: number; zoom: number }) => void }
  }
}

const frameRect = (page: Page, id: string) =>
  page.evaluate((fid) => ({ ...(window as unknown as Bridge).__loop.frame.getState().frames.find((f) => f.id === fid)!.rect }), id)
const past = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)
const busy = (page: Page) => page.locator('.canvas[aria-busy="true"]').count()

/** the release that a window without focus never sees: the next pointerup is
 *  stopped at the window's capture phase, before the app's listeners */
const swallowNextPointerUp = (page: Page) =>
  page.evaluate(() => {
    const eat = (e: Event) => {
      e.stopImmediatePropagation()
      window.removeEventListener('pointerup', eat, true)
    }
    window.addEventListener('pointerup', eat, true)
  })
const blurWindow = (page: Page) =>
  page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
  })

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  // zoom 1 (screen px = flow units), panned so the frame below sits inside the
  // canvas pane, clear of the side panels and of every node
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: -400, y: -300, zoom: 1 }))
  // an empty frame away from the nodes, so the gesture carries nothing and the rect is the whole story
  const id = await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().addFrame({ x: 640, y: 480, w: 192, h: 128 }))
  const strip = page.locator('.lgr-frame').last().locator('.lgr-frame__edge-hit--top')
  await expect(strip).toBeVisible()
  const b = (await strip.boundingBox())!
  return { id, x0: b.x + 40, y0: b.y + b.height / 2 }
}

test.describe('a frame pointer gesture when the window loses focus mid-drag (#410)', () => {
  test('blur mid-drag: the gesture stays open — a later move with NO button held moves the frame, and the next release commits it', async ({ page }) => {
    const { id, x0, y0 } = await load(page)
    const origin = await frameRect(page, id)
    const pastBefore = await past(page)

    await page.keyboard.down('Alt') // a free move: the rect follows the pointer exactly
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0 + 40, y0 + 24, { steps: 4 })
    await expect.poll(() => frameRect(page, id)).toEqual({ ...origin, x: origin.x + 40, y: origin.y + 24 })

    // the window loses focus with the button held, and the release happens
    // elsewhere: the page sees `blur` and never a pointerup. Modelled with the
    // real input pipeline: the one pointerup the runner must send to let go of
    // the button is swallowed before any listener sees it.
    await blurWindow(page)
    await swallowNextPointerUp(page)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    const atBlur = await frameRect(page, id)
    expect(atBlur).toEqual({ ...origin, x: origin.x + 40, y: origin.y + 24 })

    // the window is back; the pointer moves with no button down
    await page.mouse.move(x0 + 160, y0 + 96, { steps: 4 })
    await page.waitForTimeout(100) // the gesture applies on an animation frame
    const afterMove = await frameRect(page, id)
    expect(afterMove).not.toEqual(atBlur) // ← current main: still dragging (snapped, Alt no longer held)
    expect(await past(page)).toBe(pastBefore) // nothing committed yet

    // the next release anywhere ends it: one entry for wherever it got to. The
    // frame rides under the pointer, so "anywhere" is off the canvas here (a
    // press on the strip itself would open a fresh gesture over the stale one)
    await page.mouse.move(120, 400, { steps: 4 }) // the model list
    await page.mouse.down()
    await page.mouse.up()
    expect(await past(page)).toBe(pastBefore + 1)
    expect(await frameRect(page, id)).not.toEqual(origin)
  })

  test('control: Escape mid-drag restores the origin and commits nothing; a plain drag commits once', async ({ page }) => {
    const { id, x0, y0 } = await load(page)
    const origin = await frameRect(page, id)
    const pastBefore = await past(page)

    await page.keyboard.down('Alt')
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0 + 40, y0 + 24, { steps: 4 })
    await expect.poll(() => frameRect(page, id)).not.toEqual(origin)
    await page.keyboard.press('Escape')
    expect(await frameRect(page, id)).toEqual(origin)
    await page.mouse.up()
    expect(await past(page)).toBe(pastBefore)

    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0 + 40, y0 + 24, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    expect(await frameRect(page, id)).toEqual({ ...origin, x: origin.x + 40, y: origin.y + 24 })
    expect(await past(page)).toBe(pastBefore + 1)
    expect(await busy(page)).toBe(0)
  })
})
