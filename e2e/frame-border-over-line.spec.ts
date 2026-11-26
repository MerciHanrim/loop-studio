import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'
import { WORKBENCH_ROOMY_VIEWPORT } from './support/panel'

// #623 item 8 — where a connection's line passes under a frame's border, the
// frame's edge strip (`.lgr-frame__edge-hit`, 6 px each side of the border,
// drawn above nodes and lines) takes the click: the frame is selected, the line
// is not. One step past the strip, the same line takes the click. The existing
// priority, as `./support/edgePoint` records it; that helper looks for a point
// where the line itself is reached, so no other spec clicks the crossing.
// On the small node-structure fixture: e_leave (Treated today → Discharged
// home) runs down across the Clinic floor's bottom border.

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')

test.use({ viewport: WORKBENCH_ROOMY_VIEWPORT })
type L = {
  graph: { getState: () => { selectedNodeId: string | null; selectedEdgeId: string | null; edges: { id: string; selected?: boolean }[]; nodes: { selected?: boolean }[] } }
  frame: { getState: () => { selectedId: string | null } }
  rf: { setViewport: (v: object, o?: object) => void }
}

async function open(page: Page) {
  await openApp(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await routesSettled(page)
}

/** walks e_leave's drawn line in 400 steps and returns:
 *  `crossing` — the middle of the first run of points whose topmost element is
 *  the Clinic floor's edge strip while e_leave's own line is under the same
 *  point (both from the page's hit test, not from geometry);
 *  `clear` — the nearest step past that run where e_leave's line is on top. */
const walk = (page: Page) =>
  page.locator('.react-flow__edge[data-id="e_leave"] path.react-flow__edge-path').evaluate((el) => {
    const s = el as SVGPathElement
    const m = s.getScreenCTM()!
    const len = s.getTotalLength()
    const at = (f: number) => {
      const q = s.getPointAtLength(len * f)
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
    }
    const kind = (p: { x: number; y: number }) => {
      const stack = document.elementsFromPoint(p.x, p.y)
      const top = stack[0]
      const strip = top?.closest('[data-frame-id="clinic"] .lgr-frame__edge-hit')
      const lineUnder = stack.some((e) => e.closest('.react-flow__edge')?.getAttribute('data-id') === 'e_leave')
      const lineOnTop = top?.closest('.react-flow__edge')?.getAttribute('data-id') === 'e_leave'
      return { strip: strip ? (strip.getAttribute('class') ?? '') : null, lineUnder, lineOnTop }
    }
    const N = 400
    let run: number[] = []
    for (let i = 0; i <= N; i++) {
      const k = kind(at(i / N))
      if (k.strip && k.lineUnder) run.push(i)
      else if (run.length) break
    }
    if (!run.length) return { crossing: null, crossingKind: null, clear: null, steps: 0 }
    const mid = run[Math.floor(run.length / 2)]
    let clear: { x: number; y: number } | null = null
    for (let d = 1; d <= 40 && !clear; d++) {
      for (const i of [run[run.length - 1] + d, run[0] - d]) {
        if (i < 0 || i > N) continue
        if (kind(at(i / N)).lineOnTop) {
          clear = at(i / N)
          break
        }
      }
    }
    return { crossing: at(mid / N), crossingKind: kind(at(mid / N)), clear, steps: run.length }
  })

const selection = (page: Page) =>
  page.evaluate(() => {
    const L = (window as unknown as { __loop: L }).__loop
    const g = L.graph.getState()
    return {
      frame: L.frame.getState().selectedId,
      edge: g.selectedEdgeId,
      node: g.selectedNodeId,
      edgesFlagged: g.edges.filter((e) => e.selected).map((e) => e.id),
      nodesFlagged: g.nodes.filter((n) => n.selected).length,
    }
  })

test.describe('a line under a frame border (#623 item 8)', () => {
  test('a click where the line passes under the border strip selects the frame, not the line', async ({ page }) => {
    await open(page)
    const w = await walk(page)
    // the click point is really on the line AND on the border strip
    expect(w.crossing, 'a point of e_leave under the Clinic floor border').not.toBeNull()
    expect(w.crossingKind).toEqual({ strip: expect.stringContaining('lgr-frame__edge-hit--bottom'), lineUnder: true, lineOnTop: false })
    expect(w.steps).toBeGreaterThan(0)
    expect(await selection(page)).toEqual({ frame: null, edge: null, node: null, edgesFlagged: [], nodesFlagged: 0 })

    await page.mouse.click(w.crossing!.x, w.crossing!.y)
    expect(await selection(page)).toEqual({ frame: 'clinic', edge: null, node: null, edgesFlagged: [], nodesFlagged: 0 })
    await expect(page.locator('.react-flow__edge[data-id="e_leave"].selected')).toHaveCount(0)
  })

  test('one step past the strip, the same line takes the click', async ({ page }) => {
    await open(page)
    const w = await walk(page)
    expect(w.clear, 'a point of e_leave next to the strip where the line is on top').not.toBeNull()
    await page.mouse.click(w.clear!.x, w.clear!.y)
    expect(await selection(page)).toEqual({ frame: null, edge: 'e_leave', node: null, edgesFlagged: ['e_leave'], nodesFlagged: 0 })
  })
})
