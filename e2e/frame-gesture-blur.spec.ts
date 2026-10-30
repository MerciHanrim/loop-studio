import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #410 — the frame move / resize pointer gesture and a focus loss
// (Lumi, 2026-10-30). The strip and the resize handle capture the pointer; a
// focus loss (`blur`, the page hidden) and a lost capture take the cancel path
// of Esc / pointercancel: the origin comes back and nothing is recorded — the
// app never learned where the pointer was let go. Each end acts only on an
// OPEN gesture, so the `lostpointercapture` after a normal release does
// nothing. Until v0.31.0 the gesture outlived the focus loss: a later move
// with no button held moved the frame, and the next release anywhere
// committed it.
//
// The focus loss is modelled by the events a real one produces: `blur` on
// window (or `visibilitychange` with the page hidden), then pointermoves with
// no button held. The one release the runner must send to let go of its
// button is swallowed before any app listener sees it, as a window without
// focus never sees it either.

type Rect = { x: number; y: number; w: number; h: number }
type Bridge = {
  __loop: {
    frame: { getState: () => { frames: { id: string; rect: Rect }[]; addFrame: (r: Rect) => string; selectFrame: (id: string | null) => void } }
    graph: { getState: () => { past: unknown[]; undo: () => void } }
    rf: { setViewport: (v: { x: number; y: number; zoom: number }) => void }
  }
}

const frameRect = (page: Page, id: string) =>
  page.evaluate((fid) => ({ ...(window as unknown as Bridge).__loop.frame.getState().frames.find((f) => f.id === fid)!.rect }), id)
const past = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)
const busy = (page: Page) => page.locator('.canvas[aria-busy="true"]').count()

const swallowNextPointerUp = (page: Page) =>
  page.evaluate(() => {
    const eat = (e: Event) => {
      e.stopImmediatePropagation()
      window.removeEventListener('pointerup', eat, true)
    }
    window.addEventListener('pointerup', eat, true)
  })
const blurWindow = (page: Page) => page.evaluate(() => void window.dispatchEvent(new Event('blur')))
const hidePage = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
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
  const frame = page.locator('.lgr-frame').last()
  const strip = frame.locator('.lgr-frame__edge-hit--top')
  await expect(strip).toBeVisible()
  const b = (await strip.boundingBox())!
  return { id, frame, x0: b.x + 40, y0: b.y + b.height / 2 }
}

/** press on the strip and move: the gesture is open and the rect has followed */
async function startMove(page: Page, id: string, origin: Rect, x0: number, y0: number) {
  await page.keyboard.down('Alt') // a free move: the rect follows the pointer exactly
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0 + 40, y0 + 24, { steps: 4 })
  await expect.poll(() => frameRect(page, id)).toEqual({ ...origin, x: origin.x + 40, y: origin.y + 24 })
}

/** the window loses focus with the button held and the release happens elsewhere */
async function loseFocus(page: Page, how: 'blur' | 'hidden') {
  if (how === 'blur') await blurWindow(page)
  else await hidePage(page)
  await swallowNextPointerUp(page)
  await page.mouse.up()
  await page.keyboard.up('Alt')
}

test.describe('a frame pointer gesture and a focus loss (#410)', () => {
  for (const how of ['blur', 'hidden'] as const) {
    test(`${how} mid-drag: the origin comes back, nothing is recorded, a later move with no button held moves nothing, and the next drag is one fresh entry`, async ({ page }) => {
      const { id, x0, y0 } = await load(page)
      const origin = await frameRect(page, id)
      const pastBefore = await past(page)

      await startMove(page, id, origin, x0, y0)
      await loseFocus(page, how)
      expect(await frameRect(page, id)).toEqual(origin) // restored, as Esc would
      expect(await past(page)).toBe(pastBefore) // nothing recorded
      expect(await busy(page)).toBe(0) // the live layout was ended too

      // the window is back; the pointer moves with no button down
      await page.mouse.move(x0 + 160, y0 + 96, { steps: 4 })
      await page.waitForTimeout(100)
      expect(await frameRect(page, id)).toEqual(origin) // the frame does not follow
      expect(await past(page)).toBe(pastBefore)

      // the next drag is its own gesture: one entry, from THIS origin
      const b = (await page.locator('.lgr-frame').last().locator('.lgr-frame__edge-hit--top').boundingBox())!
      await page.keyboard.down('Alt')
      await page.mouse.move(b.x + 40, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 40 + 48, b.y + b.height / 2 + 32, { steps: 4 })
      await page.mouse.up()
      await page.keyboard.up('Alt')
      expect(await frameRect(page, id)).toEqual({ ...origin, x: origin.x + 48, y: origin.y + 32 })
      expect(await past(page)).toBe(pastBefore + 1)
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
      expect(await frameRect(page, id)).toEqual(origin)
    })
  }

  test('the resize handle captures too: blur mid-resize restores the size and records nothing', async ({ page }) => {
    const { id, frame } = await load(page)
    const origin = await frameRect(page, id)
    const pastBefore = await past(page)
    await page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(fid), id)
    const handle = frame.locator('.lgr-frame__resize')
    await expect(handle).toBeVisible()
    const hb = (await handle.boundingBox())!
    await page.keyboard.down('Alt')
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2 + 24, { steps: 4 })
    await expect.poll(async () => (await frameRect(page, id)).w).toBe(origin.w + 40)
    await loseFocus(page, 'blur')
    expect(await frameRect(page, id)).toEqual(origin)
    expect(await past(page)).toBe(pastBefore)
    await page.mouse.move(hb.x + 200, hb.y + 120, { steps: 4 })
    await page.waitForTimeout(100)
    expect(await frameRect(page, id)).toEqual(origin)
  })

  test('a normal release is unchanged: one entry at the drop, and the capture release that follows it does nothing; Escape still restores', async ({ page }) => {
    const { id, x0, y0 } = await load(page)
    const origin = await frameRect(page, id)
    const pastBefore = await past(page)

    await startMove(page, id, origin, x0, y0)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    const dropped = { ...origin, x: origin.x + 40, y: origin.y + 24 }
    expect(await frameRect(page, id)).toEqual(dropped)
    expect(await past(page)).toBe(pastBefore + 1)
    // a blur AFTER the release: no open gesture, so nothing to restore
    await blurWindow(page)
    await page.waitForTimeout(50)
    expect(await frameRect(page, id)).toEqual(dropped)
    expect(await past(page)).toBe(pastBefore + 1)
    expect(await busy(page)).toBe(0)

    // Escape mid-drag, as before
    const b = (await page.locator('.lgr-frame').last().locator('.lgr-frame__edge-hit--top').boundingBox())!
    await page.keyboard.down('Alt')
    await page.mouse.move(b.x + 40, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 80, b.y + b.height / 2 + 24, { steps: 4 })
    await expect.poll(() => frameRect(page, id)).not.toEqual(dropped)
    await page.keyboard.press('Escape')
    expect(await frameRect(page, id)).toEqual(dropped)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    expect(await past(page)).toBe(pastBefore + 1)
  })
})
