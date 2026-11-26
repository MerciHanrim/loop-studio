import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// issue #616 item 3 — a `#g1=` share link opened with React Flow's own fit, which knows only the
// node boxes, and the canvas leaves a document load out of its own re-fit, so nothing replaced it:
// on main `ba39e719`, three Pools stacked 160 px apart with long names outside them opened with
// the bottom name cut by the pane's edge until Reset view. A share link now opens with the app's
// fit (useFitAll), the one the status bar's "Fit the whole diagram" uses, which counts the
// outside names.

type Bridge = { __loop: Record<string, { getState: () => any }> & { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }

const LONG = 'A very long node name that sits outside its node and runs wide'
const pool = (id: string, label: string, y: number) => ({
  id,
  type: 'pool',
  position: { x: 0, y },
  data: { kind: 'pool', label, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string) => ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
/** three Pools stacked 160 px apart, the first and last with long outside names */
const STACKED = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [pool('top', LONG, 0), pool('mid', 'Middle', 160), pool('bottom', `${LONG} too`, 320)],
  edges: [res('e1', 'top', 'mid'), res('e2', 'mid', 'bottom')],
})

/** the names that reach past the pane's edges */
const cutNames = (page: Page) =>
  page.evaluate(() => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node .nodef__label')]
      .filter((c) => {
        const b = c.getBoundingClientRect()
        return b.left < pane.left - 0.5 || b.right > pane.right + 0.5 || b.top < pane.top - 0.5 || b.bottom > pane.bottom + 0.5
      })
      .map((c) => (c.textContent ?? '').slice(0, 24))
  })
const viewport = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport() as { x: number; y: number; zoom: number })

async function openShared(page: Page) {
  await openApp(page)
  await resetAll(page)
  const payload = await page.evaluate(async (text) => {
    const M = await import('/src/model/share.ts')
    return (await M.encodeShareText(text)).payload
  }, STACKED)
  await page.goto('about:blank')
  page.on('dialog', (d) => void d.accept())
  await page.goto('/#g1=' + payload)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await page.waitForFunction(() => location.hash === '')
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)).toBe(3)
  await expect(page.locator('.react-flow__node .nodef__label')).toHaveCount(3)
}

test.describe('#616 item 3 — a share link opens with the app’s fit', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('every outside name is inside the pane, as after Fit the whole diagram', async ({ page }) => {
    await openShared(page)
    await expect.poll(() => cutNames(page), { timeout: 5000, message: 'no name cut by the pane' }).toEqual([])
    const opened = await viewport(page)
    await page.locator('button.wb-zb[aria-label="Fit the whole diagram"]').click()
    await expect.poll(() => cutNames(page)).toEqual([])
    const fitted = await viewport(page)
    expect(Math.abs(opened.zoom - fitted.zoom), 'the same zoom as the app’s fit').toBeLessThan(0.005)
    expect(Math.abs(opened.x - fitted.x), 'the same x').toBeLessThan(2)
    expect(Math.abs(opened.y - fitted.y), 'the same y').toBeLessThan(2)
  })

  // Lumi's control (2026-11-27): the app's fit replaces only React Flow's own first fit. A camera
  // the user moves before the fit has landed is kept. To open a window the fit cannot land in,
  // animation frames are held from the moment the shared nodes are in the page (the fit waits
  // for at least one frame after the measure pass); a real wheel zoom moves the camera; then
  // the frames are released. On the first version of this fix (head 06450291) the late fit
  // overwrote the zoom: 1.954 became the app's fit, 0.82.
  test('a camera the user moves right after the link opens is kept: the fit that lands later does not overwrite it', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { requestAnimationFrame: typeof requestAnimationFrame; __heldFrames: FrameRequestCallback[]; __holdFrames: boolean; __releaseFrames: () => void }
      const raf = w.requestAnimationFrame.bind(window)
      w.__heldFrames = []
      w.__holdFrames = false
      w.requestAnimationFrame = (cb: FrameRequestCallback) => {
        if (w.__holdFrames) {
          w.__heldFrames.push(cb)
          return -1
        }
        return raf(cb)
      }
      w.__releaseFrames = () => {
        w.__holdFrames = false
        for (const cb of w.__heldFrames.splice(0)) raf(cb)
      }
      // only on the page opened from the share link (its hash is still there when this runs)
      if (!location.hash.startsWith('#g1=')) return
      new MutationObserver((_, obs) => {
        if (document.querySelectorAll('.react-flow__node').length < 3) return
        w.__holdFrames = true
        obs.disconnect()
      }).observe(document, { childList: true, subtree: true })
    })
    await openShared(page)
    const pending = () => page.evaluate(() => (window as unknown as { __loop: { canvas: { swapFitPending: () => boolean } } }).__loop.canvas.swapFitPending())
    expect(await pending(), 'the fit has not landed yet').toBe(true)
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    await page.mouse.wheel(0, -400)
    await expect.poll(async () => (await viewport(page)).zoom, { message: 'the wheel zoomed in' }).toBeGreaterThan(1.3)
    const moved = await viewport(page)
    await page.evaluate(() => (window as unknown as { __releaseFrames: () => void }).__releaseFrames())
    await expect.poll(pending, { message: 'the fit is no longer pending' }).toBe(false)
    await page.waitForTimeout(300)
    const after = await viewport(page)
    expect(Math.abs(after.zoom - moved.zoom), 'the user’s zoom is kept').toBeLessThan(0.001)
    expect(Math.abs(after.x - moved.x), 'the user’s x is kept').toBeLessThan(1)
    expect(Math.abs(after.y - moved.y), 'the user’s y is kept').toBeLessThan(1)
  })

  test('control: after Fit the whole diagram, every outside name is inside the pane', async ({ page }) => {
    await openShared(page)
    await page.locator('button.wb-zb[aria-label="Fit the whole diagram"]').click()
    await expect.poll(() => cutNames(page)).toEqual([])
  })
})
