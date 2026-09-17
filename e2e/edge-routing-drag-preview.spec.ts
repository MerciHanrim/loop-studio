import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/edge-routing-drag-preview.md — the drag-time route preview, driven by
// REAL pointer gestures (mouse down → moves → up through React Flow's drag),
// sampled between moves:
//  §DP3.3  an edge incident to the dragged node draws `preview-lz` and follows
//          the handle; every other orthogonal edge keeps its pre-drag `d`
//  DP-INV-4 no generation per move after the first; one at termination
//  DP-INV-2 the post-termination map == a cold import of the moved document
//  §DP4    every termination: drop, blur, node removal, document load, undo,
//          no-move click, an edge change, a forced start-time cache miss
//  DP-D7   a dev-bridge read mid-gesture serves the frozen route, adds nothing
//  DP-INV-3 the exported document never carries the preview

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    routeMap: { genCount: () => number; reset: () => void; get: (id: string) => { d: string; routeClass: string } | null }
  }
}

/** a → b and c → d run in two horizontal corridors; `obst` is a free pool
 *  sitting BETWEEN them (on screen), an endpoint of neither edge; dragging it
 *  up into the a → b corridor forces that edge to reroute. Both edges orthogonal. */
const GRID = () =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
      { id: 'b', type: 'drain', position: { x: 560, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
      { id: 'c', type: 'source', position: { x: 0, y: 220 }, data: { kind: 'source', label: 'C', activation: 'automatic', mode: 'pushAny' } },
      { id: 'd', type: 'drain', position: { x: 560, y: 220 }, data: { kind: 'drain', label: 'D', activation: 'automatic', mode: 'pullAny' } },
      { id: 'obst', type: 'pool', position: { x: 280, y: 100 }, data: { kind: 'pool', label: 'Obs', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_ab', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
      { id: 'e_cd', type: 'loop', source: 'c', target: 'd', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
    ],
  })

const bridge = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.genCount())
const nodePos = (page: Page, id: string) =>
  page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.id === nid)?.position ?? null, id)
const previewActive = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().dragPreview != null)

async function edgePaths(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { d: string; hit: string; cls: string; routeClass: string | null }> = {}
    for (const g of document.querySelectorAll('.react-flow__edge')) {
      const id = g.getAttribute('data-id') ?? '?'
      const vis = g.querySelector('path.react-flow__edge-path') as SVGPathElement | null
      const hit = g.querySelector('path.react-flow__edge-interaction') as SVGPathElement | null
      out[id] = {
        d: vis?.getAttribute('d') ?? '',
        hit: hit?.getAttribute('d') ?? '',
        cls: [...(vis?.classList ?? [])].filter((c) => c.startsWith('route-')).join(' '),
        routeClass: vis?.getAttribute('data-route-class') ?? null,
      }
    }
    return out
  })
}

/** wait until React Flow has measured every node (route geometry is final) */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        return g.nodes.length > 0 && g.nodes.every((n: any) => n.measured?.width && n.measured?.height)
      },
      { timeout: 4000 },
    )
    .catch(() => {})
  await page.waitForTimeout(60)
}

const firstPt = (hit: string) => hit.match(/^M (-?[\d.]+) (-?[\d.]+)/)!.slice(1, 3).map(Number)

async function nodeCentre(page: Page, id: string) {
  const b = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
  if (!b) throw new Error(`node ${id} not on screen`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** press on a node, move in `steps` increments of (dx, dy) screen px with a
 *  short wait each, calling `onMove` after every move; release only if `up`. */
async function dragNode(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps: number,
  onMove?: (i: number) => Promise<void>,
  up = true,
) {
  const c = await nodeCentre(page, id)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x + 3, c.y + 3, { steps: 2 })
  await page.waitForTimeout(20)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x + 3 + dx * i, c.y + 3 + dy * i)
    await page.waitForTimeout(20)
    if (onMove) await onMove(i)
  }
  if (up) {
    await page.mouse.up()
    await page.waitForTimeout(60)
  }
}

/** import the same document with `id` moved to `pos`, fresh, and read the paths */
/** the drag must have moved the node itself (a pan would move the viewport) */
async function expectMoved(page: Page, id: string, before: { x: number; y: number }) {
  const after = await nodePos(page, id)
  expect(after.x !== before.x || after.y !== before.y, `${id} did not move`).toBe(true)
}

async function coldPaths(page: Page, id: string, pos: { x: number; y: number }) {
  const cold = JSON.parse(GRID())
  cold.nodes.find((n: any) => n.id === id).position = pos
  await importGraph(page, JSON.stringify(cold))
  await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.route-orthogonal, .react-flow__edge[data-id="e_ab"] path.route-fallback-lz')).toHaveCount(1)
  await settle(page)
  return edgePaths(page)
}

async function boot(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRID())
  await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.route-orthogonal')).toHaveCount(1)
  await settle(page)
  // the render before the gesture built this generation — the expected warm-cache start
  await page.waitForTimeout(50)
}

test.describe('edge routing — drag-time preview (§DP)', () => {
  test('dragging an endpoint: the incident edge previews and follows the handle, the other edge stays frozen, one generation at the drop, drop == cold import', async ({
    page,
  }) => {
    await boot(page)
    const before = await edgePaths(page)
    const gen0 = await bridge(page)
    const a0 = await nodePos(page, 'a')
    const samples: { i: number; paths: Awaited<ReturnType<typeof edgePaths>>; pos: { x: number; y: number }; gen: number; bridgeCd: string | null; preview: boolean }[] = []
    await dragNode(page, 'a', 0, 9, 12, async (i) => {
      samples.push({
        i,
        paths: await edgePaths(page),
        pos: await nodePos(page, 'a'),
        gen: await bridge(page),
        // DP-D7: a bridge read mid-gesture serves the frozen route
        bridgeCd: await page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.get('e_cd')?.d ?? null),
        preview: await previewActive(page),
      })
    })
    expect(samples.length).toBe(12)
    await expectMoved(page, 'a', a0)
    for (const s of samples) {
      expect(s.preview, `preview active at move ${s.i}`).toBe(true)
      expect(s.paths.e_ab.routeClass, `e_ab is a preview at move ${s.i}`).toBe('preview-lz')
      expect(s.paths.e_ab.cls).toContain('route-preview-lz')
      expect(s.paths.e_cd.d, `e_cd frozen at move ${s.i}`).toBe(before.e_cd.d)
      expect(s.paths.e_cd.routeClass).toBe('orthogonal')
      expect(s.bridgeCd).toBe(before.e_cd.d)
    }
    // DP-INV-4: no generation after the first move (and none at the first with a warm cache)
    for (const s of samples.slice(1)) expect(s.gen, `generation count at move ${s.i}`).toBe(samples[0].gen)
    expect(samples[0].gen).toBe(gen0)
    // DP-INV-5: the preview's first point moves with the node (flow coordinates)
    const a = samples[2], b = samples[10]
    const [ax, ay] = firstPt(a.paths.e_ab.hit), [bx, by] = firstPt(b.paths.e_ab.hit)
    expect(bx - ax).toBeCloseTo(b.pos.x - a.pos.x, 0)
    expect(by - ay).toBeCloseTo(b.pos.y - a.pos.y, 0)

    // the drop: preview gone, exactly one generation, canonical == cold
    const after = await edgePaths(page)
    expect(await previewActive(page)).toBe(false)
    expect(after.e_ab.routeClass).not.toBe('preview-lz')
    expect(await bridge(page)).toBe(gen0 + 1)
    const pos = await nodePos(page, 'a')
    const cold = await coldPaths(page, 'a', pos)
    expect(after.e_ab.d).toBe(cold.e_ab.d)
    expect(after.e_ab.hit).toBe(cold.e_ab.hit)
    expect(after.e_cd.d).toBe(cold.e_cd.d)
  })

  test('dragging a free obstacle through both corridors: both edges stay frozen (no preview class) during the gesture, both reroute once at the drop, drop == cold import', async ({
    page,
  }) => {
    await boot(page)
    const before = await edgePaths(page)
    const gen0 = await bridge(page)
    const gens: number[] = []
    const o0 = await nodePos(page, 'obst')
    // obst sits between the corridors; drag it up into the a → b corridor
    await dragNode(page, 'obst', 0, -9, 14, async () => {
      const p = await edgePaths(page)
      expect(p.e_ab.d).toBe(before.e_ab.d)
      expect(p.e_cd.d).toBe(before.e_cd.d)
      expect(p.e_ab.routeClass).toBe('orthogonal')
      gens.push(await bridge(page))
    })
    expect(new Set(gens.slice(1)).size).toBe(1)
    await expectMoved(page, 'obst', o0)
    const after = await edgePaths(page)
    expect(await bridge(page)).toBe(gen0 + 1)
    expect(after.e_ab.d !== before.e_ab.d || after.e_cd.d !== before.e_cd.d).toBe(true) // the move mattered
    const cold = await coldPaths(page, 'obst', await nodePos(page, 'obst'))
    expect(after.e_ab.d).toBe(cold.e_ab.d)
    expect(after.e_cd.d).toBe(cold.e_cd.d)
  })

  test('termination (a) window blur mid-drag: preview ends and the tag closes; the resumed gesture is a new segment and a new undo step; final == cold', async ({
    page,
  }) => {
    await boot(page)
    const gen0 = await bridge(page)
    const past0 = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)
    await dragNode(page, 'a', 0, 8, 6, undefined, false)
    expect(await previewActive(page)).toBe(true)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)).toBe(past0 + 1)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(40)
    expect(await previewActive(page)).toBe(false)
    expect((await edgePaths(page)).e_ab.routeClass).not.toBe('preview-lz')
    expect(await bridge(page)).toBe(gen0 + 1) // the post-blur generation
    // the pointer is still down: React Flow keeps the gesture; the next moves open a new segment
    const c = await nodeCentre(page, 'a')
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(c.x, c.y + 8 * i)
      await page.waitForTimeout(20)
    }
    expect(await previewActive(page)).toBe(true)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)).toBe(past0 + 2)
    await page.mouse.up()
    await page.waitForTimeout(60)
    expect(await previewActive(page)).toBe(false)
    expect(await bridge(page)).toBe(gen0 + 2)
    const after = await edgePaths(page)
    const cold = await coldPaths(page, 'a', await nodePos(page, 'a'))
    expect(after.e_ab.d).toBe(cold.e_ab.d)
    expect(after.e_cd.d).toBe(cold.e_cd.d)
  })

  test('termination (b) a node removed mid-drag ends the preview; (d) undo mid-drag ends it; the drop still matches a cold import', async ({ page }) => {
    await boot(page)
    // (b) remove the free obstacle through the store while `a` is being dragged
    await dragNode(page, 'a', 0, 8, 5, undefined, false)
    expect(await previewActive(page)).toBe(true)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().removeNode('obst'))
    expect(await previewActive(page)).toBe(false)
    await page.mouse.up()
    await page.waitForTimeout(60)
    let after = await edgePaths(page)
    expect(after.e_ab.routeClass).not.toBe('preview-lz')
    // cold: the same document without obst, a where it landed
    const cold = JSON.parse(GRID())
    cold.nodes = cold.nodes.filter((n: any) => n.id !== 'obst')
    cold.nodes.find((n: any) => n.id === 'a').position = await nodePos(page, 'a')
    await importGraph(page, JSON.stringify(cold))
    await settle(page)
    let coldP = await edgePaths(page)
    expect(after.e_ab.d).toBe(coldP.e_ab.d)
    expect(after.e_cd.d).toBe(coldP.e_cd.d)

    // (d) undo mid-drag
    await boot(page)
    await dragNode(page, 'a', 0, 8, 5, undefined, false)
    expect(await previewActive(page)).toBe(true)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    expect(await previewActive(page)).toBe(false)
    await page.mouse.up()
    await page.waitForTimeout(60)
    after = await edgePaths(page)
    expect(after.e_ab.routeClass).not.toBe('preview-lz')
    coldP = await coldPaths(page, 'a', await nodePos(page, 'a'))
    expect(after.e_ab.d).toBe(coldP.e_ab.d)
  })

  test('termination (c) a document load mid-drag ends the preview and leaves the loaded document canonical', async ({ page }) => {
    await boot(page)
    await dragNode(page, 'a', 0, 8, 5, undefined, false)
    expect(await previewActive(page)).toBe(true)
    const other = JSON.parse(GRID())
    other.nodes.find((n: any) => n.id === 'a').position = { x: 40, y: 300 }
    await importGraph(page, JSON.stringify(other))
    expect(await previewActive(page)).toBe(false)
    await page.mouse.up()
    await page.waitForTimeout(60)
    await settle(page)
    const after = await edgePaths(page)
    expect(after.e_ab.routeClass).not.toBe('preview-lz')
    const coldP = await coldPaths(page, 'a', await nodePos(page, 'a'))
    expect(after.e_ab.d).toBe(coldP.e_ab.d)
    expect(after.e_cd.d).toBe(coldP.e_cd.d)
  })

  test('termination (e) a press-and-release with no movement: no preview leaks, ≤ 1 generation, still canonical', async ({ page }) => {
    await boot(page)
    const before = await edgePaths(page)
    const gen0 = await bridge(page)
    const c = await nodeCentre(page, 'a')
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.waitForTimeout(30)
    await page.mouse.up()
    await page.waitForTimeout(60)
    expect(await previewActive(page)).toBe(false)
    expect((await bridge(page)) - gen0).toBeLessThanOrEqual(1)
    const after = await edgePaths(page)
    expect(after.e_ab.routeClass).toBe('orthogonal')
    expect(after.e_ab.d).toBe(before.e_ab.d)
    expect(after.e_cd.d).toBe(before.e_cd.d)
  })

  test('termination (f) an edge change mid-drag ends the preview, the resumed moves open a new segment, final == cold', async ({ page }) => {
    await boot(page)
    const gen0 = await bridge(page)
    await dragNode(page, 'a', 0, 8, 5, undefined, false)
    expect(await previewActive(page)).toBe(true)
    // toggle e_cd back to Bézier through the store (an Inspector route toggle)
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const e = g.edges.find((x: any) => x.id === 'e_cd')
      const { route: _r, ...rest } = e.data
      g.setEdgeData('e_cd', rest)
    })
    expect(await previewActive(page)).toBe(false)
    expect(await bridge(page)).toBe(gen0 + 1)
    const c = await nodeCentre(page, 'a')
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(c.x, c.y + 8 * i)
      await page.waitForTimeout(20)
    }
    expect(await previewActive(page)).toBe(true)
    expect((await edgePaths(page)).e_ab.routeClass).toBe('preview-lz')
    await page.mouse.up()
    await page.waitForTimeout(60)
    expect(await bridge(page)).toBe(gen0 + 2)
    const after = await edgePaths(page)
    const cold = JSON.parse(GRID())
    delete cold.edges.find((e: any) => e.id === 'e_cd').data.route
    cold.nodes.find((n: any) => n.id === 'a').position = await nodePos(page, 'a')
    await importGraph(page, JSON.stringify(cold))
    await settle(page)
    const coldP = await edgePaths(page)
    expect(after.e_ab.d).toBe(coldP.e_ab.d)
    expect(coldP.e_cd.cls).toBe('') // Bézier now
  })

  test('termination (g) a forced start-time cache miss (bridge routeMap.reset) costs one generation at the first move and none after; ≤ 2 per segment', async ({
    page,
  }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.reset())
    const gen0 = await bridge(page)
    const gens: number[] = []
    await dragNode(page, 'a', 0, 8, 8, async () => {
      gens.push(await bridge(page))
    })
    expect(gens[0]).toBe(gen0 + 1) // the start-time miss, paid on the first move
    for (const g of gens.slice(1)) expect(g).toBe(gen0 + 1) // nothing after the first
    expect(await bridge(page)).toBe(gen0 + 2) // the termination generation
    const after = await edgePaths(page)
    const coldP = await coldPaths(page, 'a', await nodePos(page, 'a'))
    expect(after.e_ab.d).toBe(coldP.e_ab.d)
  })

  test('DP-INV-3: the document exported mid-drag carries no preview and equals the post-drop export', async ({ page }) => {
    await boot(page)
    await dragNode(page, 'a', 0, 8, 5, undefined, false)
    expect(await previewActive(page)).toBe(true)
    const during = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    expect(during).not.toContain('dragPreview')
    expect(during).not.toContain('frozenMap')
    expect(during).not.toContain('preview-lz')
    await page.mouse.up()
    await page.waitForTimeout(60)
    const after = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    expect(after).toBe(during)
  })
})
