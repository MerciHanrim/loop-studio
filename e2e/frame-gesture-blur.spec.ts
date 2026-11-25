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
/** #424 — the frame layer writes a pointer move only in a requestAnimationFrame
 *  callback; two frames on, any write the moves before it asked for is done */
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

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
      await nextFrames(page)
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
    await nextFrames(page)
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
    // a blur AFTER the release: no open gesture, so nothing to restore (the
    // blur listener runs inside the dispatch, and the release cancelled the
    // pending frame, so there is nothing to wait for)
    await blurWindow(page)
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

// #612 item 3 — two more pointer gestures with no end for a lost pointer. A bend point drag
// (src/components/edges/RouteBends.tsx) captures the pointer but ended only on pointerup and
// pointercancel: after a focus loss or a lost capture the point stayed where it was dragged,
// written to the document with no undo entry, and a later pass of the pointer over it with
// no button held moved it again. The Frame tool's draw (FrameLayer.tsx) ended only on Escape
// and contextmenu: its draft stayed and grew with moves made with no button held. MEASURED
// on main 7a507219. Each now ends as #410's frame gesture does: the bend point goes back and
// nothing is recorded; the draft goes and no frame is made. The draw takes no capture, so a
// lost capture does not apply to it.
type Wp = { x: number; y: number }
type BendBridge = { __loop: { graph: { getState: () => any; setState: (s: object) => void }; rf: { setViewport: (v: object, o?: object) => void } } }

/** an orthogonal connection with one bend point, selected and centred: its handle is on screen */
async function bendLoad(page: Page) {
  await page.setViewportSize({ width: 1600, height: 940 })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  const pick = await page.evaluate(() => {
    const l = (window as unknown as BendBridge).__loop
    const g = l.graph.getState()
    const e = g.edges.find((x: { data?: { kind?: string } }) => x.data?.kind === 'resource')
    const s = g.nodes.find((n: { id: string }) => n.id === e.source)
    const t = g.nodes.find((n: { id: string }) => n.id === e.target)
    const at = { x: Math.round((s.position.x + t.position.x) / 2 / 16) * 16, y: Math.round((s.position.y + t.position.y) / 2 / 16) * 16 + 160 }
    g.setEdgeRouting(e.id, { route: 'orthogonal', waypoints: [at] })
    l.rf.setViewport({ x: 800 - at.x, y: 470 - at.y, zoom: 1 }, { duration: 0 })
    l.graph.setState({ edges: l.graph.getState().edges.map((x: { id: string }) => ({ ...x, selected: x.id === e.id })) })
    return { id: e.id as string, at }
  })
  const bend = page.locator(`.route-bend[data-edge-id="${pick.id}"][data-bend="0"]`)
  await expect(bend).toBeVisible()
  const point = () => page.evaluate((id) => ({ ...(window as unknown as BendBridge).__loop.graph.getState().edges.find((x: { id: string }) => x.id === id).data.waypoints[0] }) as Wp, pick.id)
  return { ...pick, bend, point }
}
/** press on the bend point and move it freely (Alt): the gesture is open and the point has followed */
async function startBendDrag(page: Page, bend: ReturnType<Page['locator']>, point: () => Promise<Wp>, at: Wp) {
  const b = (await bend.boundingBox())!
  const x0 = b.x + b.width / 2
  const y0 = b.y + b.height / 2
  await page.keyboard.down('Alt')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0 + 40, y0 + 24, { steps: 4 })
  await expect.poll(point).toEqual({ x: at.x + 40, y: at.y + 24 })
  return { x0, y0 }
}
/** the runner's one release, swallowed whole: a release made in another window reaches the page
 *  as no pointerup, no mouseup and no click. (Once the drag has let its capture go, a mouseup
 *  and a click that got through landed on the canvas under the pointer and deselected the
 *  connection, which a real focus loss never does.) */
const swallowNextRelease = (page: Page) =>
  page.evaluate(() => {
    for (const type of ['pointerup', 'mouseup', 'click']) {
      const eat = (e: Event) => {
        e.stopImmediatePropagation()
        window.removeEventListener(type, eat, true)
      }
      window.addEventListener(type, eat, true)
    }
  })
/** the capture the bend point holds is lost for a reason the app did not choose */
const loseCapture = (page: Page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.route-bend')].find((e) => e.hasPointerCapture(1))
    if (!el) throw new Error('the bend point holds no pointer capture')
    el.releasePointerCapture(1)
  })

test.describe('a bend point drag and a focus or capture loss (#612 item 3)', () => {
  for (const how of ['blur', 'hidden', 'lost capture'] as const) {
    test(`${how} mid-drag: the point goes back, nothing is recorded, and a later pass with no button held moves nothing`, async ({ page }) => {
      const { bend, point, at } = await bendLoad(page)
      const pastBefore = await past(page)
      const { x0, y0 } = await startBendDrag(page, bend, point, at)
      if (how === 'blur') await blurWindow(page)
      else if (how === 'hidden') await hidePage(page)
      else await loseCapture(page)
      await swallowNextRelease(page)
      await page.mouse.up()
      await page.keyboard.up('Alt')
      expect(await point(), 'the point goes back').toEqual(at)
      expect(await past(page), 'nothing is recorded').toBe(pastBefore)
      expect(await busy(page), 'the live layout was ended too').toBe(0)

      // the pointer moves away, then passes over the point again, with no button held
      await page.mouse.move(x0 + 160, y0 + 96, { steps: 4 })
      const nb = (await bend.boundingBox())!
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 2 })
      await page.mouse.move(nb.x + nb.width / 2 + 30, nb.y + nb.height / 2 + 30, { steps: 3 })
      await nextFrames(page)
      expect(await point(), 'a pass with no button held moves nothing').toEqual(at)
      expect(await past(page)).toBe(pastBefore)
    })
  }

  test('control: a normal drag is one entry at the drop, and Undo puts the point back', async ({ page }) => {
    const { bend, point, at } = await bendLoad(page)
    const pastBefore = await past(page)
    await startBendDrag(page, bend, point, at)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    // the capture release that follows a normal drop, and a blur after it, change nothing
    await blurWindow(page)
    expect(await point()).toEqual({ x: at.x + 40, y: at.y + 24 })
    expect(await past(page)).toBe(pastBefore + 1)
    expect(await busy(page)).toBe(0)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    expect(await point()).toEqual(at)
  })
})

test.describe('the Frame tool draw and a focus loss (#612 item 3)', () => {
  const frameCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().frames.length)
  const draft = (page: Page) => page.locator('.lgr-frame__fill--draft')
  async function drawLoad(page: Page) {
    // wide enough that the press below lands on empty canvas, clear of the panels and nodes
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: -400, y: -300, zoom: 1 }))
    await page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { armTool: () => void } } } }).__loop.frame.getState().armTool())
  }
  /** a node on screen with 40 px of empty canvas around it: a frame drawn around it is one the tool makes
   *  (a drawn frame must hold a node, frameGeom.ts `frameIsCreatable`) */
  const around = (page: Page) =>
    page.evaluate(() => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      const boxes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => n.getBoundingClientRect())
      const M = 40
      const fits = (r: DOMRect) =>
        r.left - M > Math.max(pane.left, 0) && r.top - M > Math.max(pane.top, 0) && r.right + M < Math.min(pane.right, innerWidth) && r.bottom + M < Math.min(pane.bottom, innerHeight) &&
        boxes.every((o) => o === r || o.right < r.left - M || o.left > r.right + M || o.bottom < r.top - M || o.top > r.bottom + M)
      const r = boxes.find(fits)
      if (!r) throw new Error('no node with empty canvas around it on screen')
      return { x0: r.left - 24, y0: r.top - 24, x1: r.right + 24, y1: r.bottom + 24 }
    })
  /** a press on empty canvas and a move around a node: the draft is drawn */
  async function startDraw(page: Page) {
    const a = await around(page)
    await page.mouse.move(a.x0, a.y0)
    await page.mouse.down()
    await page.mouse.move(a.x1, a.y1, { steps: 4 })
    await expect(draft(page)).toBeVisible()
    return a
  }

  for (const how of ['blur', 'hidden'] as const) {
    test(`${how} mid-draw: the draft goes, no frame is made, and a later move with no button held draws nothing`, async ({ page }) => {
      await drawLoad(page)
      const framesBefore = await frameCount(page)
      const pastBefore = await past(page)
      const a = await startDraw(page)
      if (how === 'blur') await blurWindow(page)
      else await hidePage(page)
      await swallowNextPointerUp(page)
      await page.mouse.up()
      await expect(draft(page), 'the draft goes').toHaveCount(0)
      await page.mouse.move(a.x1 + 120, a.y1 + 80, { steps: 4 })
      await nextFrames(page)
      await expect(draft(page), 'a move with no button held draws nothing').toHaveCount(0)
      expect(await frameCount(page)).toBe(framesBefore)
      expect(await past(page)).toBe(pastBefore)

      // the tool stays armed: the next draw is its own, and makes one frame
      expect(await page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { toolArmed: boolean } } } }).__loop.frame.getState().toolArmed)).toBe(true)
      await startDraw(page)
      await page.mouse.up()
      expect(await frameCount(page)).toBe(framesBefore + 1)
    })
  }

  test('control: a normal draw makes one frame', async ({ page }) => {
    await drawLoad(page)
    const framesBefore = await frameCount(page)
    await startDraw(page)
    await page.mouse.up()
    await expect(draft(page)).toHaveCount(0)
    expect(await frameCount(page)).toBe(framesBefore + 1)
  })
})
