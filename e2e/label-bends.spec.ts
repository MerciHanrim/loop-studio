import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'
import { openPanelDetails, WORKBENCH_ROOMY_VIEWPORT } from './support/panel'

// the reopen re-fits the view; in the workbench's 664 × 468 canvas at
// 1280 × 800 that fit is below the label threshold (measured 2026-10-20 on
// connection-shapes' revision: zoom 0.715, no label drawn), so this runs with
// a canvas as wide as the two-tier bar's (./support/panel)
test.use({ viewport: WORKBENCH_ROOMY_VIEWPORT })

// docs/edge-routing.md §ER14.3 — a routed label keeps off its own connection's
// stored bend points, so the bend markers drawn while it is selected do not sit
// under it; and the place does not depend on the selection, the zoom, an undo /
// redo round trip or a reopen. On the small node-structure fixture: e_treat
// (Triage desk → Treated today) with one bend put where its label sits now.

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
type Pt = { x: number; y: number }
type L = {
  graph: { getState: () => any }
  ui: { getState: () => any }
  rf: { setViewport: (v: object, o?: object) => void }
  routeMap: { get: (id: string) => { label: Pt | null; points: Pt[] } | null }
  autosave: { flush: () => void }
}
const loop = (page: Page) => page.evaluate.bind(page)

async function open(page: Page) {
  await openApp(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await routesSettled(page)
}
/** the label's centre in flow coordinates, from the route map the canvas draws */
const labelAt = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop.routeMap.get('e_treat')?.label ?? null)
const near = (a: Pt | null, b: Pt | null) => !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5

async function selectEdge(page: Page) {
  const p = await page.locator('.react-flow__edge[data-id="e_treat"] path.react-flow__edge-path').evaluate((el) => {
    const s = el as SVGPathElement
    const q = s.getPointAtLength(s.getTotalLength() * 0.15)
    const m = s.getScreenCTM()!
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
  })
  await page.mouse.click(p.x, p.y)
  // the Ends group lives in the panel's More settings (docs/workbench.md §WB6)
  await openPanelDetails(page)
  await expect(page.locator('.inspector .ends')).toBeVisible()
}

test.describe('a label keeps off its own bend points (§ER14.3)', () => {
  test('the label leaves the bend put under it; selected, no bend marker is under it; the place holds through selection, zoom, undo / redo and a reopen', async ({ page }) => {
    await open(page)
    const before = await labelAt(page)
    expect(before).not.toBeNull()
    // one bend exactly where the label is now (one undo step, as a bend click)
    const bend = { x: Math.round(before!.x), y: Math.round(before!.y) }
    await loop(page)((b) => (window as unknown as { __loop: L }).__loop.graph.getState().setEdgeRouting('e_treat', { route: 'orthogonal', waypoints: [b] }), bend)
    await routesSettled(page)
    const bent = await labelAt(page)
    expect(bent).not.toBeNull()
    expect(near(bent, before), 'the label left the bend').toBe(false)

    // selected: the rendered label box and the rendered bend markers do not meet
    await selectEdge(page)
    const marker = page.locator('.route-bend')
    await expect(marker).toHaveCount(1)
    const lb = (await page.locator('.edge-label[data-edge-id="e_treat"]').boundingBox())!
    const mb = (await marker.boundingBox())!
    const meet = lb.x < mb.x + mb.width && mb.x < lb.x + lb.width && lb.y < mb.y + mb.height && mb.y < lb.y + lb.height
    expect(meet, 'label box over the bend marker').toBe(false)
    expect(near(await labelAt(page), bent), 'selecting does not move it').toBe(true)

    // deselected
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.click(pane.x + 20, pane.y + 20)
    await expect(page.locator('.route-bend')).toHaveCount(0)
    expect(near(await labelAt(page), bent), 'deselecting does not move it').toBe(true)

    // zoom in and back
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1.6 }, { duration: 0 }))
    await routesSettled(page)
    expect(near(await labelAt(page), bent), 'zoom does not move it').toBe(true)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
    await routesSettled(page)
    expect(near(await labelAt(page), bent)).toBe(true)

    // undo the bend: back to the first place; redo: the bent place again
    await page.keyboard.press('Control+z')
    await routesSettled(page)
    await expect.poll(() => labelAt(page).then((p) => near(p, before))).toBe(true)
    await page.keyboard.press('Control+Shift+z')
    await routesSettled(page)
    await expect.poll(() => labelAt(page).then((p) => near(p, bent))).toBe(true)

    // reopen (autosave, reload): the same place
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await routesSettled(page)
    // the reload fits the view again: the label must be drawn to be read
    await expect.poll(() => labelAt(page), { message: 'the label is drawn after the reopen' }).not.toBeNull()
    await expect.poll(() => labelAt(page).then((p) => near(p, bent))).toBe(true)
  })

  test('a connection without bends keeps the place it had', async ({ page }) => {
    await open(page)
    const a = await labelAt(page)
    await selectEdge(page)
    expect(near(await labelAt(page), a)).toBe(true)
  })
})
