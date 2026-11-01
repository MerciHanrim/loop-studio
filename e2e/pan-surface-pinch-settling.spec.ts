import type { CDPSession, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #421 item 2 (Lumi, 2026-11-01) — the pan-capture layer's pinch keeps
// docs/dense-graph-pan.md's `settling` rule: when one of the two pinching
// fingers lifts, the other does nothing until it lifts too (no pan resumes),
// and a new finger landing beside it pinches again. The `lostpointercapture`
// that follows a normal lift does not clear the remaining finger; a capture
// lost while a pointer is still tracked (nothing lifted) cancels that pointer
// safely, as a `pointercancel` does. Until now every `lostpointercapture`
// reset the whole gesture, so the remaining finger was forgotten and a new
// finger panned on its own.
//
// Real touches through CDP (`Input.dispatchTouchEvent`): a `touchStart` lists
// the points down (an existing id stays the same finger), a `touchEnd` lists
// the points that lift.

type Pt = { x: number; y: number; id: number }
type Vp = { x: number; y: number; zoom: number }
const vp = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { rf: { getViewport: () => Vp } } }).__loop.rf.getViewport())
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const tp = (p: Pt) => ({ x: p.x, y: p.y, id: p.id, radiusX: 1, radiusY: 1, force: 1 })
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(tp) })

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow .pan-surface--active')).toHaveCount(1)
  return page.context().newCDPSession(page)
}

test.describe('pinch: one finger lifts, the other settles (#421)', () => {
  test('the remaining finger moving does not pan; a new finger beside it pinches again', async ({ page }) => {
    const cdp = await load(page)
    const A: Pt = { x: 150, y: 400, id: 1 }
    const B: Pt = { x: 250, y: 400, id: 2 }
    await touch(cdp, 'touchStart', [A])
    await touch(cdp, 'touchStart', [A, B])
    await touch(cdp, 'touchMove', [{ ...A, x: 130 }, { ...B, x: 270 }])
    await frames(page)
    const pinched = await vp(page)

    // B lifts; A stays down and moves well past the pan slop
    await touch(cdp, 'touchEnd', [{ ...B, x: 270 }])
    await touch(cdp, 'touchMove', [{ ...A, x: 60, y: 480 }])
    await frames(page)
    expect(await vp(page), 'the remaining finger does not pan').toEqual(pinched)

    // a new finger C lands while A is still down, and moves away from A: a pinch again
    const C: Pt = { x: 220, y: 320, id: 3 }
    await touch(cdp, 'touchStart', [{ ...A, x: 60, y: 480 }, C])
    await touch(cdp, 'touchMove', [{ ...A, x: 60, y: 480 }, { ...C, x: 320, y: 220 }])
    await frames(page)
    const again = await vp(page)
    expect(again.zoom, 'A and C pinch: the zoom changes').toBeGreaterThan(pinched.zoom)

    await touch(cdp, 'touchEnd', [{ ...A, x: 60, y: 480 }, { ...C, x: 320, y: 220 }])
    await frames(page)
    // all lifted: a single finger pans again (the gesture ended cleanly)
    const before = await vp(page)
    const D: Pt = { x: 200, y: 500, id: 4 }
    await touch(cdp, 'touchStart', [D])
    await touch(cdp, 'touchMove', [{ ...D, x: 240, y: 540 }])
    await touch(cdp, 'touchEnd', [{ ...D, x: 240, y: 540 }])
    await frames(page)
    const after = await vp(page)
    expect(after.zoom).toBe(before.zoom)
    expect({ dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }).toEqual({ dx: 40, dy: 40 })
  })

  test('a capture lost while the finger is still down (nothing lifted) cancels that finger: no further pan, no tap', async ({ page }) => {
    const cdp = await load(page)
    // record the layer's pointer ids as the browser assigns them
    await page.evaluate(() => {
      const w = window as unknown as { __ids: number[] }
      w.__ids = []
      document.querySelector('.react-flow .pan-surface--active')!.addEventListener('pointerdown', (e) => w.__ids.push((e as PointerEvent).pointerId))
    })
    const sel = () => page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { selectedNodeId: string | null } } } }).__loop.graph.getState().selectedNodeId)
    const A: Pt = { x: 200, y: 500, id: 1 }
    await touch(cdp, 'touchStart', [A])
    await touch(cdp, 'touchMove', [{ ...A, x: 230 }])
    await frames(page)
    const panned = await vp(page)
    // the capture goes away without a lift (the layer lets go of it)
    await page.evaluate(() => {
      const el = document.querySelector('.react-flow .pan-surface--active') as HTMLElement
      const id = (window as unknown as { __ids: number[] }).__ids.at(-1)!
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
    })
    await frames(page)
    await touch(cdp, 'touchMove', [{ ...A, x: 300, y: 560 }])
    await frames(page)
    expect(await vp(page), 'the cancelled finger pans no more').toEqual(panned)
    await touch(cdp, 'touchEnd', [{ ...A, x: 300, y: 560 }])
    await frames(page)
    expect(await sel(), 'and its lift is no tap').toBeNull()
  })
})
