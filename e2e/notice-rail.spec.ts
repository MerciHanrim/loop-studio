import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { waitForAppReady } from './support/appReady'

// The notice rail (src/ui/noticeRail.tsx) — Lumi's conditions (2026-10-12):
// a note that comes or goes must not move anything on the canvas. The rail
// takes the pane's height, so Canvas.tsx shifts the viewport by the rail's
// height change in the same layout pass: every node keeps its screen place,
// and what is under the pointer stays under the pointer — also mid-gesture,
// because the tier-1 frame-move note appears the moment a saved frame is
// selected, i.e. on the pointer-down that starts a frame drag.
//
// This spec needs the hint to APPEAR, so the shared "every canvas hint seen"
// seed is off here; the hint-free scenes of every other spec are the default.
test.use({ hintsSeen: false })

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')

type Loop = { rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void; getViewport: () => { x: number; y: number; zoom: number } } }

async function openSmall(page: Page): Promise<void> {
  await page.goto('/')
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expect(page.locator('.lgr-frame')).toHaveCount(1)
  await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 40, y: 80, zoom: 1 }, { duration: 0 }))
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)).toBe(1)
  await expect(page.locator('.hint-note')).toHaveCount(0)
}

const railHeight = (page: Page) => page.evaluate(() => document.getElementById('notice-rail')!.getBoundingClientRect().height)
const nodeRects = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.react-flow__node')].map((el) => {
      const r = el.getBoundingClientRect()
      return [el.getAttribute('data-id'), Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10].join(',')
    }),
  )
const frameRect = (page: Page) => page.locator('.lgr-frame').first().evaluate((el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left * 10) / 10, top: Math.round(r.top * 10) / 10 } })
/** the node (id) whose element is under a SCREEN point */
const nodeAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null, [x, y] as const)

test.describe('the notice rail keeps the canvas still', () => {
  test('a hint that appears on frame selection does not move a single node on screen, nor what is under the pointer; closing it neither', async ({ page }) => {
    await openSmall(page)
    const h0 = await railHeight(page)
    const rects0 = await nodeRects(page)
    // a screen point on the Pool's body, and what it hits
    const pool = (await page.locator('.react-flow__node[data-id="waiting"] .nodef').boundingBox())!
    const px = pool.x + pool.width / 2
    const py = pool.y + pool.height / 2
    expect(await nodeAt(page, px, py)).toBe('waiting')

    // select the saved frame by its top edge strip (a real click): the tier-1
    // frame-move note appears in the rail
    const strip = page.locator('.lgr-frame').first().locator('.lgr-frame__edge-hit--top')
    const sb = (await strip.boundingBox())!
    await page.mouse.click(sb.x + 40, sb.y + sb.height / 2)
    await expect(page.locator('.hint-note')).toHaveCount(1)
    await expect.poll(() => railHeight(page)).toBeGreaterThan(h0)

    // nothing moved on screen, the same node is under the same point
    // (the compensation lands with the next transform update: poll, no sleep)
    await expect.poll(() => nodeRects(page), { message: 'node screen rects after the hint appeared' }).toEqual(rects0)
    expect(await nodeAt(page, px, py)).toBe('waiting')

    // closing the note: the rail collapses, still nothing moves
    await page.locator('.hint-note__x').click()
    await expect(page.locator('.hint-note')).toHaveCount(0)
    await expect.poll(() => railHeight(page)).toBe(h0)
    await expect.poll(() => nodeRects(page), { message: 'node screen rects after the hint closed' }).toEqual(rects0)
    expect(await nodeAt(page, px, py)).toBe('waiting')
  })

  test('a frame drag whose pointer-down selects the frame: the note waits for the release, the frame moves by exactly the pointer delta', async ({ page }) => {
    await openSmall(page)
    const strip = page.locator('.lgr-frame').first().locator('.lgr-frame__edge-hit--top')
    const sb = (await strip.boundingBox())!
    const f0 = await frameRect(page)
    const h0 = await railHeight(page)
    const x0 = sb.x + 40
    const y0 = sb.y + sb.height / 2
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    // the selection on pointer-down makes the frame-move note due — but a note
    // never enters the rail while the button is held (the pane would move under
    // the gesture); it appears once the pointer is released
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x0 + 8 * i, y0 + 6 * i)
      expect(await railHeight(page), `rail still empty at move ${i}`).toBe(h0)
    }
    await expect(page.locator('.hint-note')).toHaveCount(0)
    await page.mouse.up()
    await expect(page.locator('.hint-note')).toHaveCount(1)
    await expect.poll(() => railHeight(page)).toBeGreaterThan(h0)
    // the frame moved by the pointer's own delta (64, 48) — snapped to the 16 px
    // grid, no 40 px jump from the rail — and stays there once the note is up
    const f1 = await frameRect(page)
    expect(f1.left - f0.left, 'frame moved by the pointer dx').toBe(64)
    expect(f1.top - f0.top, 'frame moved by the pointer dy — no jump from the rail').toBe(48)
    expect(await nodeAt(page, x0 + 64 + 8, y0 + 48 + 40), 'the carried Pool is where the pointer left it').toBe('waiting')
  })

  test('the first-run update notice: closing it keeps every node where it was on screen', async ({ page, context }) => {
    // a returning profile that has not seen the newest release: the notice is up at boot
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('loop-studio/whats-new/seen')
        localStorage.removeItem('loop-studio/whats-new/announced')
      } catch {
        /* opaque origin */
      }
    })
    await page.goto('/')
    await waitForAppReady(page)
    const notice = page.locator('.whatsnew-notice')
    test.skip((await notice.count()) === 0, 'no update notice on this profile — covered by whats-new.spec.ts')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    const rects0 = await nodeRects(page)
    const z0 = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)
    await notice.getByRole('button').last().click()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => nodeRects(page)).toEqual(rects0)
    expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)).toBe(z0)
  })
})
