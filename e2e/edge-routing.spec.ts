import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/edge-routing.md + SEMANTICS-R3.md — Slice 1 through the real app:
//  • the Bézier default path is byte-unchanged by the feature; toggling a route
//    on then off restores the exact `d` and the exact revision digest;
//  • an `orthogonal` edge's visible `d` + hit-area `d` are deterministic across
//    hover / select / zoom / theme and independent of edge input order;
//  • the route map is rebuilt atomically — one obstacle move recomputes EVERY
//    orthogonal edge in a single generation; no mixed stale/fresh DOM frame;
//    the previous route is never an input; incremental == cold recompute;
//  • every path consumer (visible, hit, marker, label anchor, flow bead) reads
//    the SAME `d`; reduced-motion leaves a static cue, no travelling element;
//  • VL-INV: a route toggle is cosmetic — it moves the digest but never the
//    running simulation / timeline;
//  • the Inspector Route control round-trips.

/** two crossing orthogonal edges + a free-standing obstacle pool between them;
 *  moving `obst` reroutes BOTH edges. `obst` is an endpoint of neither. */
const GRID = () =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
      { id: 'b', type: 'drain', position: { x: 560, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
      { id: 'c', type: 'source', position: { x: 0, y: 220 }, data: { kind: 'source', label: 'C', activation: 'automatic', mode: 'pushAny' } },
      { id: 'd', type: 'drain', position: { x: 560, y: 220 }, data: { kind: 'drain', label: 'D', activation: 'automatic', mode: 'pullAny' } },
      { id: 'obst', type: 'pool', position: { x: 280, y: -400 }, data: { kind: 'pool', label: 'Obs', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_ab', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
      { id: 'e_cd', type: 'loop', source: 'c', target: 'd', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
    ],
  })

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

  test('one obstacle move recomputes every orthogonal edge in a single atomic generation', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GRID())
    await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.route-orthogonal')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="e_cd"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)

    const genAndPaths = () =>
      page.evaluate(() => {
        const l = (window as any).__loop
        const g = l.graph.getState()
        const domD = (id: string) =>
          (document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`) as SVGPathElement)?.getAttribute('d') ?? ''
        return {
          gen: l.routeMap.genCount(),
          ab: { dom: domD('e_ab'), map: l.routeMap.get('e_ab')?.d ?? '' },
          cd: { dom: domD('e_cd'), map: l.routeMap.get('e_cd')?.d ?? '' },
        }
      })

    const before = await genAndPaths()
    // the render and the route map agree ⇒ one shared generation
    expect(before.ab.dom).toBe(before.ab.map)
    expect(before.cd.dom).toBe(before.cd.map)

    // move the obstacle a long way through both corridors
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.onNodesChange([{ type: 'position', id: 'obst', position: { x: 280, y: 4 }, dragging: true }])
      g.onNodesChange([{ type: 'position', id: 'obst', position: { x: 280, y: 4 }, dragging: false }])
    })
    await settle(page)
    const after = await genAndPaths()

    expect(after.gen).toBe(before.gen + 1) // ONE full rebuild pass, not one-per-edge
    // the move mattered — at least one edge's geometry changed
    expect(after.ab.dom !== before.ab.dom || after.cd.dom !== before.cd.dom).toBe(true)
    // …and NO edge is left on a stale path: DOM == map for BOTH, same frame
    expect(after.ab.dom).toBe(after.ab.map)
    expect(after.cd.dom).toBe(after.cd.map)

    // the previous route is not an input: clearing the cache and recomputing
    // from scratch yields byte-identical paths
    const recomputed = await page.evaluate(() => {
      const l = (window as any).__loop
      l.routeMap.reset()
      return { ab: l.routeMap.get('e_ab')?.d ?? '', cd: l.routeMap.get('e_cd')?.d ?? '' }
    })
    expect(recomputed.ab).toBe(after.ab.map)
    expect(recomputed.cd).toBe(after.cd.map)

    // incremental == cold: import the moved graph fresh
    const cold = JSON.parse(GRID())
    cold.nodes.find((n: any) => n.id === 'obst').position = { x: 280, y: 4 }
    await importGraph(page, JSON.stringify(cold))
    await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)
    const coldPaths = await genAndPaths()
    expect(coldPaths.ab.dom).toBe(after.ab.dom)
    expect(coldPaths.cd.dom).toBe(after.cd.dom)

    // reversed edge input order ⇒ identical per id
    const rev = JSON.parse(JSON.stringify(cold))
    rev.edges.reverse()
    await importGraph(page, JSON.stringify(rev))
    await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)
    const revPaths = await genAndPaths()
    expect(revPaths.ab.dom).toBe(after.ab.dom)
    expect(revPaths.cd.dom).toBe(after.cd.dom)
  })

  test('a waypoint inside an obstacle shows the §ER4 invalid cue and still keeps its value', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    // `mid` pool sits right where e_ac`s single waypoint is pinned
    const g = {
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
        { id: 'c', type: 'drain', position: { x: 520, y: 0 }, data: { kind: 'drain', label: 'C', activation: 'automatic', mode: 'pullAny' } },
        { id: 'mid', type: 'pool', position: { x: 250, y: -20 }, data: { kind: 'pool', label: 'Mid', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e_ac', type: 'loop', source: 'a', target: 'c', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', waypoints: [{ x: 300, y: 12 }] } },
      ],
    }
    await importGraph(page, JSON.stringify(g))
    await expect(page.locator('.react-flow__edge[data-id="e_ac"] path.route-invalid')).toHaveCount(1)
    await settle(page)

    const cue = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__edge[data-id="e_ac"] path.react-flow__edge-path') as SVGPathElement
      const route = (window as any).__loop.routeMap.get('e_ac')
      const g = (window as any).__loop.graph.getState()
      return {
        invalidClass: p.classList.contains('route-invalid'),
        fallback: route?.routeClass,
        invalidFlag: route?.invalidWaypoint,
        dash: getComputedStyle(p).strokeDasharray,
        waypoints: g.edges[0].data.waypoints, // value kept
      }
    })
    expect(cue.invalidFlag).toBe(true)
    expect(cue.invalidClass).toBe(true)
    expect(cue.fallback).toBe('fallback-lz')
    expect(cue.dash).not.toBe('none') // dashed WARNING treatment
    expect(cue.waypoints).toEqual([{ x: 300, y: 12 }]) // not consumed / not moved
  })

  test('the invalid-route cue is distinguishable WITHOUT colour, on resource AND state edges, under forced-colors', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    // p1 → p2 resource (bad waypoint), p2 → p3 state (bad waypoint), p1 → p3
    // resource with NO waypoint = the "normal" control edge. `box` swallows the
    // shared waypoint coordinate for both bad edges.
    const g = {
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'p1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'automatic', initial: 5, capacity: null, mode: 'pushAny' } },
        { id: 'p2', type: 'pool', position: { x: 460, y: 0 }, data: { kind: 'pool', label: 'P2', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        { id: 'p3', type: 'pool', position: { x: 460, y: 260 }, data: { kind: 'pool', label: 'P3', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        { id: 'box', type: 'pool', position: { x: 200, y: -30 }, data: { kind: 'pool', label: 'Box', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e_res', type: 'loop', source: 'p1', target: 'p2', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', waypoints: [{ x: 240, y: 10 }] } },
        { id: 'e_state', type: 'loop', source: 'p2', target: 'p3', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '@p1 > 0', route: 'orthogonal', waypoints: [{ x: 240, y: 10 }] } },
        { id: 'e_ok', type: 'loop', source: 'p1', target: 'p3', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
      ],
    }
    await page.emulateMedia({ forcedColors: 'active' })
    await importGraph(page, JSON.stringify(g))
    await expect(page.locator('.react-flow__edge[data-id="e_res"] path.route-invalid')).toHaveCount(1)
    await settle(page)

    const read = () =>
      page.evaluate(() => {
        const flag = (id: string) => {
          const el = document.querySelector(`.react-flow__edge[data-id="${id}"] g.route-invalid-flag`) as SVGGElement | null
          if (!el) return null
          const text = el.querySelector('text')?.textContent ?? ''
          const box = el.querySelector('circle') != null
          return { name: el.getAttribute('aria-label') ?? '', role: el.getAttribute('role') ?? '', text, box }
        }
        return { res: flag('e_res'), state: flag('e_state'), ok: flag('e_ok') }
      })
    const r = await read()

    // both bad edges carry the glyph badge + an accessible name; the good one does not
    for (const bad of [r.res, r.state]) {
      expect(bad).not.toBeNull()
      expect(bad!.text).toBe('!') // a SHAPE, not a colour
      expect(bad!.box).toBe(true)
      expect(bad!.role).toBe('img')
      expect(bad!.name.toLowerCase()).toContain('invalid route')
    }
    expect(r.ok).toBeNull() // a valid orthogonal edge has no badge

    await page.emulateMedia({ forcedColors: 'none' })
  })

  test('every path consumer reads the same d; reduced-motion leaves only a static cue', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G2({ route: true }))
    await expect(page.locator('.react-flow__edge[data-id="e_gd"] path.route-orthogonal')).toHaveCount(1)
    await settle(page)

    const consumers = await page.evaluate(() => {
      const l = (window as any).__loop
      const edge = document.querySelector('.react-flow__edge[data-id="e_gd"]') as SVGGElement
      const vis = edge.querySelector('path.react-flow__edge-path') as SVGPathElement
      const hit = edge.querySelector('path.react-flow__edge-interaction') as SVGPathElement
      const label = document.querySelector('.edge-label[data-edge-id="e_gd"]') as HTMLElement | null
      const route = l.routeMap.get('e_gd')
      return {
        d: vis.getAttribute('d'),
        hit: hit.getAttribute('d'),
        markerEnd: vis.getAttribute('marker-end') ?? vis.style.markerEnd ?? '',
        labelTransform: label?.style.transform ?? '',
        mid: route ? [Math.round(route.mid.x), Math.round(route.mid.y)] : null,
      }
    })
    expect(consumers.hit).toBe(consumers.d) // BaseEdge draws both from one path
    expect(consumers.markerEnd).toMatch(/url\(#/) // the renderer-owned direction marker
    // the label anchor is the route's arc-length midpoint
    expect(consumers.labelTransform).toContain(`${consumers.mid![0]}px`)
    expect(consumers.labelTransform).toContain(`${consumers.mid![1]}px`)

    await test.step('running sim: the playback token walks the orthogonal d; a selection change does not restart it', async () => {
      // prime one step (tokenless) so `gold` holds a unit and the drain edge `e_gd`
      // actually carries flow on the step we then choreograph
      await page.evaluate(() => (window as any).__loop.sim.getState().advance())
      await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(2200))
      await page.locator('.pstrip button[title="Advance one step"]').click()
      // wait for the token mid-travel and check its position sits on the rendered d
      const tokenOnPath = () =>
        page.evaluate(() => {
          const g = document.querySelector('.react-flow__edge[data-id="e_gd"] .pb-move') as SVGGElement | null
          const vis = document.querySelector('.react-flow__edge[data-id="e_gd"] path.react-flow__edge-path') as SVGPathElement | null
          if (!g || !vis) return null
          const m = (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
          if (!m) return null
          const pt = { x: +m[1], y: +m[2] }
          const total = vis.getTotalLength()
          let best = Infinity
          for (let i = 0; i <= 200; i++) {
            const p = vis.getPointAtLength((i / 200) * total)
            best = Math.min(best, Math.hypot(p.x - pt.x, p.y - pt.y))
          }
          return { dist: best, phase: g.getAttribute('data-playback-phase') }
        })
      await expect.poll(() => tokenOnPath().then((t) => (t && t.phase === 'travel' ? t.dist : 99)), { timeout: 8000 }).toBeLessThan(2)
      const t1 = await tokenOnPath()
      await page.evaluate(() => (window as any).__loop.sim.getState().pause())
      const frozen = await tokenOnPath()
      await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_gd'))
      await page.waitForTimeout(60)
      const afterSelect = await tokenOnPath()
      expect(afterSelect!.dist).toBeCloseTo(frozen!.dist, 1) // no restart / jump
      void t1
      await page.evaluate(() => (window as any).__loop.sim.getState().reset())
    })

    await test.step('prefers-reduced-motion: no travelling element, a static edge cue only', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => {
        const s = (window as any).__loop.sim.getState()
        s.reset()
      })
      await page.locator('.pstrip button[title="Advance one step"]').click()
      await page.waitForTimeout(80)
      const rm = await page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="e_gd"]') as SVGGElement
        const move = edge.querySelectorAll('animateMotion').length
        const pulse = edge.querySelector('path.flow-edge-pulse') as SVGPathElement | null
        const vis = edge.querySelector('path.react-flow__edge-path') as SVGPathElement
        return { move, pulseD: pulse?.getAttribute('d') ?? null, d: vis.getAttribute('d') }
      })
      expect(rm.move).toBe(0) // nothing travels
      if (rm.pulseD !== null) expect(rm.pulseD).toBe(rm.d) // the static cue uses the same path
      await page.emulateMedia({ reducedMotion: null })
    })
  })
})
