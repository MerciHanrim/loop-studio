import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, routesSettled, test } from './support/loop'

// issue #344 step 3 (docs/diagram-layout.md §DL4, docs/edge-routing.md §ER15–§ER16,
// SEMANTICS-R10.md) — the connection shapes and the bend-point editor, end to end:
//
//   • the Inspector shape select writes the stored form of each shape, one undo
//     entry each, and never resets the run;
//   • Straight is drawn as a straight line, Curved as today's Bézier, and the
//     label of either sits in a free slot ON its own drawn line;
//   • Add bend inserts one snapped bend point where the route is clicked;
//   • a bend point drags on the grid (Alt: free), moves with the arrow keys,
//     goes with Delete, and Escape cancels the gesture in progress — each edit
//     one undo entry;
//   • a drop inside a node or on the port stub puts the point back;
//   • the edit lock and the phone offer no route editing.

const node = (id: string, type: string, x: number, y: number) => ({
  id,
  type,
  position: { x, y },
  data:
    type === 'source'
      ? { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' }
      : type === 'drain'
        ? { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' }
        : { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
})
const edge = (id: string, source: string, target: string, routing: Record<string, unknown>) => ({
  id,
  type: 'loop',
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  data: { kind: 'resource', flow: '1', ...routing },
})
const doc = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges })

/** one connection a → b with a bend in the automatic route */
const ONE = (routing: Record<string, unknown>) => doc([node('a', 'source', 0, 0), node('b', 'drain', 480, 192)], [edge('e', 'a', 'b', routing)])

type Wp = { x: number; y: number }
const edgeData = (page: Page, id: string) =>
  page.evaluate((eid) => (window as any).__loop.graph.getState().edges.find((e: any) => e.id === eid)?.data ?? null, id)
const history = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().past.length as number)
const simRev = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().simulationRev as number)

/** the client point at fraction `f` of an edge's drawn path */
const pathPoint = (page: Page, id: string, f: number) =>
  page.evaluate(
    ({ eid, f }) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`) as SVGPathElement
      const pt = p.getPointAtLength(p.getTotalLength() * f)
      const m = p.getScreenCTM()!
      return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }
    },
    { eid: id, f },
  )
/** flow → client, through the edge layer's own transform */
const toClient = (page: Page, id: string, q: Wp) =>
  page.evaluate(
    ({ eid, q }) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`) as SVGPathElement
      const m = p.getScreenCTM()!
      return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f, zoom: m.a }
    },
    { eid: id, q },
  )
const selectEdge = async (page: Page, id: string, f = 0.5) => {
  const c = await pathPoint(page, id, f)
  await page.mouse.click(c.x, c.y)
  await expect(page.locator('.inspector select').filter({ has: page.locator('option[value="straight"]') })).toBeVisible()
}
const shapeSelect = (page: Page) => page.locator('.inspector select').filter({ has: page.locator('option[value="straight"]') })
const bend = (page: Page, i = 0) => page.locator(`.route-bend[data-edge-id="e"][data-bend="${i}"]`)
async function dragBend(page: Page, i: number, to: { x: number; y: number }, opts: { alt?: boolean; beforeUp?: () => Promise<void> } = {}) {
  const box = (await bend(page, i).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  if (opts.alt) await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await opts.beforeUp?.()
  await page.mouse.up()
  if (opts.alt) await page.keyboard.up('Alt')
}

test.describe('connection shapes — issue #344 step 3', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('the shape select writes each stored form, one undo entry each, and leaves the run alone', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal' }))
    await selectEdge(page, 'e')
    const rev = await simRev(page)
    const h0 = await history(page)
    const path = page.locator('.react-flow__edge[data-id="e"] path.react-flow__edge-path')

    await shapeSelect(page).selectOption('straight')
    expect(await edgeData(page, 'e')).toMatchObject({ route: 'straight' })
    await expect(path).toHaveAttribute('d', /^M [-\d.]+,[-\d.]+L [-\d.]+,[-\d.]+$/)

    await shapeSelect(page).selectOption('curved')
    const curved = await edgeData(page, 'e')
    expect(curved.route).toBeUndefined()
    expect(curved.waypoints).toBeUndefined()
    await expect(path).toHaveAttribute('d', /C/)

    await shapeSelect(page).selectOption('orthogonal')
    expect(await edgeData(page, 'e')).toMatchObject({ route: 'orthogonal' })
    await expect(page.locator('.react-flow__edge[data-id="e"] path.route-orthogonal')).toHaveCount(1)
    await expect(page.locator('.inspector')).toContainText('Automatic route')

    expect(await history(page)).toBe(h0 + 3)
    expect(await simRev(page)).toBe(rev)
  })

  test('a Curved and a Straight label sit in a free slot on their own drawn line, off a node on its middle', async ({ page }) => {
    await importGraph(
      page,
      doc(
        [node('a', 'source', 0, 0), node('b', 'drain', 480, 0), node('mid', 'pool', 240, 0), node('c', 'source', 0, 320), node('d', 'drain', 480, 320), node('mid2', 'pool', 240, 320)],
        [edge('st', 'a', 'b', { route: 'straight' }), edge('cv', 'c', 'd', {})],
      ),
    )
    const found = await page.evaluate(() => {
      const out: Record<string, { onLine: number; overNode: boolean; hidden: boolean }> = {}
      for (const [id, nid] of [['st', 'mid'], ['cv', 'mid2']] as const) {
        const label = document.querySelector(`.edge-label[data-edge-id="${id}"]`) as HTMLElement
        const r = label.getBoundingClientRect()
        const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        const p = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`) as SVGPathElement
        const m = p.getScreenCTM()!
        let best = Infinity
        const L = p.getTotalLength()
        for (let i = 0; i <= 400; i++) {
          const q = p.getPointAtLength((L * i) / 400)
          best = Math.min(best, Math.hypot(m.a * q.x + m.e - c.x, m.d * q.y + m.f - c.y))
        }
        const n = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!.getBoundingClientRect()
        out[id] = {
          onLine: best,
          overNode: r.x < n.right && n.x < r.right && r.y < n.bottom && n.y < r.bottom,
          hidden: getComputedStyle(label).visibility === 'hidden',
        }
      }
      return out
    })
    for (const id of ['st', 'cv']) {
      expect(found[id]!.hidden, `${id} label shown`).toBe(false)
      expect(found[id]!.onLine, `${id} label centred on its line`).toBeLessThan(1.5)
      expect(found[id]!.overNode, `${id} label clear of the node on its middle`).toBe(false)
    }
  })

  test('Add bend inserts one snapped bend point where the route is clicked; one undo returns to Auto', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal' }))
    await selectEdge(page, 'e')
    const h0 = await history(page)
    const add = page.getByRole('button', { name: 'Add bend' })
    await add.click()
    await expect(add).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.inspector')).toContainText('Click the connection where the bend goes')

    const route = await page.evaluate(() => (window as any).__loop.routeMap.get('e').points as { x: number; y: number }[])
    const c = await pathPoint(page, 'e', 0.55)
    await page.mouse.click(c.x, c.y)
    const data = await edgeData(page, 'e')
    expect(data.route).toBe('orthogonal')
    expect(data.waypoints).toHaveLength(1)
    const [w] = data.waypoints as Wp[]
    // §ER16.2 — on a segment of the route as it was, snapped ALONG it: adding
    // the bend moved nothing
    const onSegment = route.some((a, i) => {
      const b = route[i + 1]
      if (!b) return false
      if (a.y === b.y) return w!.y === a.y && w!.x % 16 === 0 && w!.x >= Math.min(a.x, b.x) && w!.x <= Math.max(a.x, b.x)
      return w!.x === a.x && w!.y % 16 === 0 && w!.y >= Math.min(a.y, b.y) && w!.y <= Math.max(a.y, b.y)
    })
    expect(onSegment, `bend ${JSON.stringify(w)} on ${JSON.stringify(route)}`).toBe(true)
    expect(await history(page)).toBe(h0 + 1)
    await expect(add).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.inspector')).toContainText('Manual route')
    await expect(page.getByRole('button', { name: 'Reset to automatic' })).toBeVisible()
    await expect(bend(page)).toHaveAccessibleName('Bend point 1 of 1')

    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    expect((await edgeData(page, 'e')).waypoints).toBeUndefined()
  })

  test('Escape disarms Add bend; a click then changes nothing', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal' }))
    await selectEdge(page, 'e')
    const add = page.getByRole('button', { name: 'Add bend' })
    await add.click()
    await page.keyboard.press('Escape')
    await expect(add).toHaveAttribute('aria-pressed', 'false')
    const c = await pathPoint(page, 'e', 0.55)
    await page.mouse.click(c.x, c.y)
    expect((await edgeData(page, 'e')).waypoints).toBeUndefined()
  })

  test('a bend point drags on the grid, Alt drags it freely, each drop one undo entry', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }] }))
    await selectEdge(page, 'e', 0.8)
    await expect(bend(page)).toBeVisible()
    const h0 = await history(page)
    const z = (await toClient(page, 'e', { x: 0, y: 0 })).zoom

    const t1 = await toClient(page, 'e', { x: 304 + 48 + 5, y: 96 })
    await dragBend(page, 0, t1)
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 352, y: 96 }])
    expect(await history(page)).toBe(h0 + 1)

    const t2 = await toClient(page, 'e', { x: 352 + 7, y: 96 })
    await dragBend(page, 0, t2, { alt: true })
    const [w] = (await edgeData(page, 'e')).waypoints as Wp[]
    expect(Math.abs(w!.x - 359), `free x (zoom ${z})`).toBeLessThan(0.75)
    expect(w!.x % 16).not.toBe(0)
    expect(await history(page)).toBe(h0 + 2)
  })

  test('arrow keys move a bend point a grid step (Shift: four), a held gesture is one entry, Escape cancels it', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }] }))
    await selectEdge(page, 'e', 0.8)
    const h0 = await history(page)
    await bend(page).focus()

    await page.keyboard.press('ArrowRight')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 320, y: 96 }])
    await page.keyboard.press('Shift+ArrowDown')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 320, y: 160 }])
    expect(await history(page)).toBe(h0 + 2)

    // two keys held together are one gesture
    await page.keyboard.down('ArrowLeft')
    await page.keyboard.down('ArrowUp')
    await page.keyboard.up('ArrowLeft')
    await page.keyboard.up('ArrowUp')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 144 }])
    expect(await history(page)).toBe(h0 + 3)

    // Escape while a key is held puts the point back and records nothing
    await page.keyboard.down('ArrowRight')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 320, y: 144 }])
    await page.keyboard.press('Escape')
    await page.keyboard.up('ArrowRight')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 144 }])
    expect(await history(page)).toBe(h0 + 3)
  })

  test('Escape during a drag puts the bend point back; nothing is recorded', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }] }))
    await selectEdge(page, 'e', 0.8)
    const h0 = await history(page)
    const t = await toClient(page, 'e', { x: 400, y: 128 })
    await dragBend(page, 0, t, { beforeUp: () => page.keyboard.press('Escape') })
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 96 }])
    expect(await history(page)).toBe(h0)
  })

  test('a drop inside a node or on the port stub puts the bend point back, with a dashed cue while there', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }] }))
    await selectEdge(page, 'e', 0.8)
    const h0 = await history(page)
    const inNode = await toClient(page, 'e', { x: 540, y: 216 })
    await dragBend(page, 0, inNode, {
      beforeUp: async () => {
        await expect(bend(page)).toHaveClass(/is-invalid/)
        expect(await bend(page).evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed')
      },
    })
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 96 }])
    // a's out port is on its right side, on the port row (y 28)
    const aw = await page.evaluate(() => (window as any).__loop.graph.getState().nodes.find((n: any) => n.id === 'a').measured.width as number)
    const onStub = await toClient(page, 'e', { x: aw + 8, y: 28 })
    await dragBend(page, 0, onStub)
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 96 }])
    expect(await history(page)).toBe(h0)
    await expect(bend(page)).not.toHaveClass(/is-invalid/)
  })

  test('Delete removes a bend point (the last one makes the route automatic), Reset drops them all; one entry each', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }, { x: 352, y: 144 }] }))
    await selectEdge(page, 'e', 0.8)
    const h0 = await history(page)
    await bend(page, 1).focus()
    await page.keyboard.press('Delete')
    expect((await edgeData(page, 'e')).waypoints).toEqual([{ x: 304, y: 96 }])
    expect(await page.evaluate(() => (window as any).__loop.graph.getState().edges.length), 'the connection itself stays').toBe(1)
    await page.getByRole('button', { name: 'Reset to automatic' }).click()
    const data = await edgeData(page, 'e')
    expect(data.route).toBe('orthogonal')
    expect(data.waypoints).toBeUndefined()
    expect(await history(page)).toBe(h0 + 2)
    await expect(page.locator('.route-bend')).toHaveCount(0)
  })

  test('under the edit lock there are no bend handles, the shape tools are disabled and the store refuses', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal', waypoints: [{ x: 304, y: 96 }] }))
    await selectEdge(page, 'e', 0.8)
    await expect(bend(page)).toBeVisible()
    await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
    await expect(page.locator('.route-bend')).toHaveCount(0)
    await expect(shapeSelect(page)).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Add bend' })).toBeDisabled()
    await page.evaluate(() => (window as any).__loop.graph.getState().setEdgeRouting('e', { route: 'straight' }))
    expect((await edgeData(page, 'e')).route).toBe('orthogonal')
  })

  test('the phone draws every shape and offers no route editing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await importGraph(
      page,
      doc(
        [node('a', 'source', 0, 0), node('b', 'drain', 480, 0), node('c', 'source', 0, 192), node('d', 'drain', 480, 384), node('f', 'source', 0, 576), node('g', 'drain', 480, 576)],
        [edge('st', 'a', 'b', { route: 'straight' }), edge('e', 'c', 'd', { route: 'orthogonal', waypoints: [{ x: 304, y: 240 }] }), edge('cv', 'f', 'g', {})],
      ),
    )
    await expect(page.locator('.react-flow__edge[data-id="st"] path.react-flow__edge-path')).toHaveAttribute('d', /^M [-\d.]+,[-\d.]+L [-\d.]+,[-\d.]+$/)
    await expect(page.locator('.react-flow__edge[data-id="e"] path.route-orthogonal')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="cv"] path.react-flow__edge-path')).toHaveAttribute('d', /C/)
    await page.evaluate(() => {
      const g = (window as any).__loop.graph
      g.setState({ edges: g.getState().edges.map((x: any) => ({ ...x, selected: x.id === 'e' })) })
      g.getState().setSelection(null, 'e')
    })
    await expect(page.locator('.react-flow__edge[data-id="e"].selected')).toHaveCount(1)
    await expect(page.locator('.route-bend')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add bend' })).toHaveCount(0)
  })
})

test.describe('connection shapes — keyboard Add bend and the record label rule (issue #344 step 3)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('armed Add bend + Enter adds a bend on the longest segment, focuses its handle; one undo entry', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal' }))
    await selectEdge(page, 'e')
    const before = await page.locator('.react-flow__edge[data-id="e"] path.react-flow__edge-path').getAttribute('d')
    const h0 = await history(page)
    const add = page.getByRole('button', { name: 'Add bend' })
    await add.focus()
    await page.keyboard.press('Enter') // arms (the button)
    await expect(add).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.inspector')).toContainText('press Enter to add one')
    await page.keyboard.press('Enter') // adds
    const wps = (await edgeData(page, 'e')).waypoints as Wp[]
    expect(wps).toHaveLength(1)
    expect(await history(page)).toBe(h0 + 1)
    await expect(add).toHaveAttribute('aria-pressed', 'false')
    // the new point is on the route as it was drawn: adding it moved nothing
    const off = await page.evaluate(
      ({ d, p }) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        el.setAttribute('d', d)
        const L = el.getTotalLength()
        let best = Infinity
        for (let i = 0; i <= 2000; i++) {
          const q = el.getPointAtLength((L * i) / 2000)
          best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y))
        }
        return best
      },
      { d: before!, p: wps[0]! },
    )
    expect(off, 'on the drawn route').toBeLessThan(0.75)
    // the focus is on the new handle: the arrow keys move it at once
    await expect(bend(page)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    expect(((await edgeData(page, 'e')).waypoints as Wp[])[0]!.x).toBe(wps[0]!.x + 16)
    expect(await history(page)).toBe(h0 + 2)
  })

  test('with no segment that can take a bend, Enter changes nothing and says so', async ({ page }) => {
    // two nodes so close that the route is its two stubs
    await importGraph(page, doc([node('a', 'source', 0, 0), node('b', 'drain', 176, 0)], [edge('e', 'a', 'b', { route: 'orthogonal' })]))
    await selectEdge(page, 'e')
    const h0 = await history(page)
    const add = page.getByRole('button', { name: 'Add bend' })
    await add.click()
    await add.focus()
    await page.keyboard.press('Enter')
    expect((await edgeData(page, 'e')).waypoints).toBeUndefined()
    expect(await history(page)).toBe(h0)
    await expect(add).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.inspector')).toContainText('No segment of this connection has room for a bend point')
    await expect(page.locator('[id^="react-flow__aria-live"]').first()).toContainText('No segment of this connection has room for a bend point')
    await page.keyboard.press('Escape')
    await expect(add).toHaveAttribute('aria-pressed', 'false')
  })

  test('the Inspector note says, in one statement, what restarts the run and what does not', async ({ page }) => {
    await importGraph(page, ONE({ route: 'orthogonal' }))
    await selectEdge(page, 'e')
    const note = page.locator('.inspector .inspector__note', { hasText: 'simulation settings' })
    await expect(note).toHaveCount(1)
    await expect(note).toHaveText('Changing a connection’s simulation settings restarts the current run. Route, bends, and colour are drawing-only and do not restart it.')
    await expect(page.locator('.inspector')).not.toContainText('Editing a connection restarts the run')
  })

  test('a revision recorded before /10 keeps its Curved labels where they were recorded, until a shape edit; undo restores it', async ({ page }) => {
    await openRecord(page, readFileSync(new URL('../examples/revision/base.revision.json', import.meta.url), 'utf8'))
    expect(await recordRule(page)).toBe(true)
    const recorded = await fromRecorded(page)
    expect(Object.keys(recorded).length).toBeGreaterThan(0)
    for (const [id, d] of Object.entries(recorded)) expect(d, `${id} at its recorded place`).toBeLessThan(1)

    // a shape edit moves the document to the current rule, in one undo entry
    const first = Object.keys(recorded)[0]!
    await page.evaluate((id) => (window as any).__loop.graph.getState().setEdgeRouting(id, { route: 'straight' }), first)
    expect(await recordRule(page)).toBe(false)
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    await routesSettled(page)
    expect(await recordRule(page)).toBe(true)
    for (const [id, d] of Object.entries(await fromRecorded(page))) expect(d, `${id} back at its recorded place`).toBeLessThan(1)
  })

  test('the record rule survives a reload of the Project (labelLayoutVersion in the autosaved header)', async ({ page }) => {
    await openRecord(page, readFileSync(new URL('../examples/revision/base.revision.json', import.meta.url), 'utf8'))
    expect(await recordRule(page)).toBe(true)
    await page.evaluate(() => (window as any).__loop.autosave.flush())
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loop-studio:graph:v1')!).project.labelLayoutVersion)).toBe(0)
    await page.reload()
    await page.waitForFunction(() => Boolean((window as any).__loop) && (window as any).__loop.project.getState().open != null)
    await routesSettled(page)
    expect(await recordRule(page)).toBe(true)
    for (const [id, d] of Object.entries(await fromRecorded(page))) expect(d, `${id} at its recorded place after the reload`).toBeLessThan(1)
    // after a shape edit, the reload brings the current rule back instead
    const first = Object.keys(await fromRecorded(page))[0]!
    await page.evaluate((id) => (window as any).__loop.graph.getState().setEdgeRouting(id, { route: 'orthogonal' }), first)
    await page.evaluate(() => (window as any).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as any).__loop) && (window as any).__loop.project.getState().open != null)
    expect(await recordRule(page)).toBe(false)
  })

  test('a record whose header declares /10 takes the current placement, though it has no straight connection', async ({ page }) => {
    // a Curved-only graph, recorded by this build
    await importGraph(page, doc([node('a', 'source', 0, 0), node('b', 'drain', 480, 0), node('mid', 'pool', 240, 0)], [edge('cv', 'a', 'b', {})]))
    const text = await page.evaluate(() => {
      const r = (window as any).__loop.project.getState().planRevision()
      return r.ok ? (r.text as string) : ''
    })
    expect(JSON.parse(text).project.semantics).toBe('loop-revision/10')
    expect(text).not.toContain('"straight"')
    await resetAll(page)
    await openRecord(page, text)
    expect(await recordRule(page)).toBe(false)
    expect(await page.evaluate(() => (window as any).__loop.routeMap.free().has('cv')), 'its Curved label takes a free slot').toBe(true)
  })
})

/** open a Project revision file through the File input and wait for its routes */
async function openRecord(page: Page, text: string) {
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'record.revision.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') })
  await page.waitForFunction(() => (window as any).__loop.project.getState().open != null)
  await routesSettled(page)
}
const recordRule = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().recordLabels as boolean)
/** each Curved label's distance from its Bézier's t = 0.5 point (where it was recorded) */
const fromRecorded = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, number> = {}
    for (const g of document.querySelectorAll('.react-flow__edge')) {
      const id = g.getAttribute('data-id')!
      const p = g.querySelector('path.react-flow__edge-path') as SVGPathElement
      const m = /^M\s*([-\d.]+),([-\d.]+)\s*C\s*([-\d.]+),([-\d.]+)\s+([-\d.]+),([-\d.]+)\s+([-\d.]+),([-\d.]+)$/.exec(p.getAttribute('d')!.trim())
      const label = document.querySelector(`.edge-label[data-edge-id="${id}"]`) as HTMLElement | null
      if (!m || !label) continue
      const n = m.slice(1).map(Number)
      const bx = 0.125 * n[0]! + 0.375 * n[2]! + 0.375 * n[4]! + 0.125 * n[6]!
      const by = 0.125 * n[1]! + 0.375 * n[3]! + 0.375 * n[5]! + 0.125 * n[7]!
      const ctm = p.getScreenCTM()!
      const r = label.getBoundingClientRect()
      out[id] = Math.hypot(ctm.a * bx + ctm.e - (r.x + r.width / 2), ctm.d * by + ctm.f - (r.y + r.height / 2))
    }
    return out
  })
