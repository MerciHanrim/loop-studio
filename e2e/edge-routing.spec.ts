import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/edge-routing.md + SEMANTICS-R3.md — Slice 1 through the real app:
//  • the Bézier default path is byte-unchanged by the feature; toggling a route
//    on then off restores the exact `d` and the exact revision digest;
//  • an `orthogonal` edge's visible `d` + hit-area `d` are deterministic across
//    hover / select / zoom / theme and independent of edge input order;
//  • the route map is rebuilt atomically — an incremental node move lands on the
//    SAME paths as loading that final graph cold;
//  • VL-INV: a route toggle is cosmetic — it moves the digest but never the
//    running simulation / timeline;
//  • the Inspector Route control round-trips.

const G2 = (over: { route?: boolean } = {}) =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
      { id: 'gold', type: 'pool', position: { x: 260, y: 140 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'sink', type: 'drain', position: { x: 520, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_sg', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...(over.route ? { route: 'orthogonal' } : {}) } },
      { id: 'e_gd', type: 'loop', source: 'gold', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...(over.route ? { route: 'orthogonal' } : {}) } },
    ],
  })

/** every `path.react-flow__edge-path` d + every `.react-flow__edge-interaction`
 *  d, keyed by the owning edge id, plus each edge's route-* class. */
async function edgePaths(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { d: string; hit: string; cls: string }> = {}
    for (const g of document.querySelectorAll('.react-flow__edge')) {
      const id = (g as HTMLElement).dataset.id ?? g.getAttribute('data-id') ?? '?'
      const vis = g.querySelector('path.react-flow__edge-path') as SVGPathElement | null
      const hit = g.querySelector('path.react-flow__edge-interaction') as SVGPathElement | null
      out[id] = {
        d: vis?.getAttribute('d') ?? '',
        hit: hit?.getAttribute('d') ?? '',
        cls: [...(vis?.classList ?? [])].filter((c) => c.startsWith('route-')).join(' '),
      }
    }
    return out
  })
}

/** wait until React Flow has measured every node (so route geometry is final,
 *  not computed from the DEFAULT_W/H fallback). */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () => {
        const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
        return g.nodes.length > 0 && g.nodes.every((n: any) => n.measured?.width && n.measured?.height)
      },
      { timeout: 4000 },
    )
    .catch(() => {})
  await page.waitForTimeout(60)
}

const digest = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __loop: { revisionIO: { currentTargetDigest: () => string } } }).__loop.revisionIO.currentTargetDigest(),
  )

const edgeData = (page: Page, id: string) =>
  page.evaluate((eid) => {
    const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    return g.edges.find((e: any) => e.id === eid)?.data ?? null
  }, id)

const setRoute = (page: Page, id: string, on: boolean) =>
  page.evaluate(
    ({ eid, on }) => {
      const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
      const e = g.edges.find((x: any) => x.id === eid)
      const { route: _r, waypoints: _w, ...rest } = e.data
      g.setEdgeData(eid, on ? { ...rest, route: 'orthogonal' } : rest)
    },
    { eid: id, on },
  )

test.describe('edge routing — Slice 1', () => {
  test('the Bézier default is byte-unchanged; a route on→off round-trips d and digest exactly', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2())
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path')).toHaveCount(1)
    await settle(page)

    const bezier = await edgePaths(page)
    const bezierDigest = await digest(page)
    // the default really is a cubic Bézier and carries no route-* class
    expect(bezier.e_sg.d).toMatch(/[CQ]/)
    expect(bezier.e_sg.cls).toBe('')

    await setRoute(page, 'e_sg', true)
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
    const routed = await edgePaths(page)
    expect(routed.e_sg.d).not.toBe(bezier.e_sg.d)
    expect(routed.e_sg.d).toMatch(/ L /) // an axis-aligned segment
    expect(await digest(page)).not.toBe(bezierDigest)
    // the OTHER edge is still the untouched Bézier
    expect(routed.e_gd.d).toBe(bezier.e_gd.d)

    await setRoute(page, 'e_sg', false)
    const back = await edgePaths(page)
    expect(back.e_sg.d).toBe(bezier.e_sg.d)
    expect(back.e_sg.cls).toBe('')
    expect(await digest(page)).toBe(bezierDigest)
  })

  test('an orthogonal edge is deterministic across hover / select / zoom / theme and edge input order', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2({ route: true }))
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)

    const base = await edgePaths(page)
    expect(base.e_sg.cls).toContain('route-')
    expect(base.e_sg.hit).not.toBe('')

    await test.step('hover both nodes + select an edge + select a node', async () => {
      await page.locator('.react-flow__node[data-id="gold"]').hover()
      await page.locator('.react-flow__node[data-id="src"]').hover()
      await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_gd'))
      await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('gold', null))
      await page.waitForTimeout(30)
      expect(await edgePaths(page)).toEqual(base)
    })

    await test.step('zoom + pan via the store bridge', async () => {
      await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: -120, y: 60, zoom: 1.9 }))
      await page.waitForTimeout(50)
      expect(await edgePaths(page)).toEqual(base)
      await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }))
    })

    await test.step('theme toggle (dark, then forced-colors)', async () => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(50)
      expect(await edgePaths(page)).toEqual(base)
      await page.emulateMedia({ forcedColors: 'active' })
      await page.waitForTimeout(50)
      expect(await edgePaths(page)).toEqual(base)
      await page.emulateMedia({ colorScheme: null, forcedColors: 'none' })
    })

    await test.step('reversed edge input order ⇒ identical d per edge id', async () => {
      const reversed = JSON.parse(G2({ route: true }))
      reversed.edges.reverse()
      await importGraph(page, JSON.stringify(reversed))
      await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
      await settle(page)
      const after = await edgePaths(page)
      expect(after.e_sg.d).toBe(base.e_sg.d)
      expect(after.e_gd.d).toBe(base.e_gd.d)
      expect(after.e_sg.hit).toBe(base.e_sg.hit)
    })
  })

  test('the route map rebuilds atomically — an incremental node move lands on the cold-load paths', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2({ route: true }))
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)

    // incremental: settle `gold` at a new position through the real change stream
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.onNodesChange([{ type: 'position', id: 'gold', position: { x: 360, y: 40 }, dragging: true }])
      g.onNodesChange([{ type: 'position', id: 'gold', position: { x: 360, y: 40 }, dragging: false }])
    })
    await page.waitForTimeout(50)
    const incremental = await edgePaths(page)

    // cold: load the SAME final graph fresh
    const cold = JSON.parse(G2({ route: true }))
    cold.nodes.find((n: any) => n.id === 'gold').position = { x: 360, y: 40 }
    await importGraph(page, JSON.stringify(cold))
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)
    const coldPaths = await edgePaths(page)

    expect(incremental.e_sg.d).toBe(coldPaths.e_sg.d)
    expect(incremental.e_gd.d).toBe(coldPaths.e_gd.d)
    expect(incremental.e_sg.hit).toBe(coldPaths.e_sg.hit)
  })

  test('VL-INV — a route toggle moves the digest but not the running simulation', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2())
    await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()

    // run a few steps so there is a live timeline to disturb
    for (let i = 0; i < 3; i++) await page.locator('.pstrip button[title="Advance one step"]').click()
    const simBefore = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return JSON.stringify({ step: s.stepIndex, values: s.values, series: s.series, status: s.status })
    })
    const d0 = await digest(page)

    await setRoute(page, 'e_sg', true)
    expect(await digest(page)).not.toBe(d0) // cosmetic still changes the canonical digest
    const simAfter = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return JSON.stringify({ step: s.stepIndex, values: s.values, series: s.series, status: s.status })
    })
    expect(simAfter).toBe(simBefore) // …but the engine / timeline is untouched

    await setRoute(page, 'e_sg', false)
    expect(await digest(page)).toBe(d0) // exact return
  })

  test('the Inspector Route control round-trips', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2())
    await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_sg'))

    const select = page.locator('.inspector select').filter({ has: page.locator('option[value="orthogonal"]') })
    await expect(select).toBeVisible()
    await select.selectOption('orthogonal')
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(1)
    expect(await edgeData(page, 'e_sg')).toMatchObject({ route: 'orthogonal' })

    await select.selectOption('bezier')
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.route-orthogonal')).toHaveCount(0)
    const data = await edgeData(page, 'e_sg')
    expect(data.route).toBeUndefined()
    expect(data.waypoints).toBeUndefined()
  })
})
