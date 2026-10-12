// The new node's four-side face handles — mounted only while they are needed
// (the first follow-up of v0.26.0: hidden, they were ~11 idle handles on every
// node, measured as frame time on a large diagram's playback).
//
// The contract, on `e2e/fixtures/node-structure-small.json` (`e_leave` is
// stored bottom → top, every other connection uses its default faces):
//   - at rest a node mounts only the face handles its connections use, hidden;
//     the connection that uses them is drawn and ends on them;
//   - a selected or keyboard-focused node mounts every face handle, shown, and
//     unmounts the unused ones again when that ends;
//   - while a connection is drawn from a handle, every node mounts its face
//     handles, so the drop can choose any face; a new connection to a face
//     keeps that handle mounted afterwards, and undo / redo unmount / mount it
//     with the connection, which is drawn each time.
// A connection's end cannot be dragged to another port here: React Flow draws
// its reconnection anchors only with an `onReconnect` handler, which the
// canvas does not pass (`edgesReconnectable` alone enables nothing), so there
// is no reconnection gesture whose handles could go missing.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { waitForAppReady } from './support/appReady'
import { PORT_COL } from '../src/model/layout/grid'

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')

type Loop = { graph: { getState: () => any }; rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void; getViewport: () => { x: number; y: number; zoom: number } } }

async function openSmall(page: Page): Promise<void> {
  await page.goto('/')
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(5)
  await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)).toBe(1)
}

/** the face handles each node has mounted, by node id, sorted */
const mountedFaces = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string[]> = {}
    for (const n of document.querySelectorAll('.react-flow__node')) {
      const id = (n as HTMLElement).dataset.id!
      out[id] = [...n.querySelectorAll('.react-flow__handle.h--extra')].map((h) => (h as HTMLElement).dataset.handleid!).sort()
    }
    return out
  })

/** the face handles a node has when every face is offered: six state faces,
 *  and three for each resource port the node has */
const allFaces = (inPort: boolean, outPort: boolean) =>
  [
    'state-source@left', 'state-source@right', 'state-source@top',
    'state-target@bottom', 'state-target@left', 'state-target@right',
    ...(inPort ? ['in@bottom', 'in@right', 'in@top'] : []),
    ...(outPort ? ['out@bottom', 'out@left', 'out@top'] : []),
  ].sort()

const AT_REST = { arrivals: [], waiting: [], triage: [], treated: ['out@bottom'], discharged: ['in@top'], rate: [], occupancy: [] }

/** a click on the empty canvas (clears the selection): the pane's lower right,
 *  left of the minimap, where the small graph at 100 % has nothing */
async function clickEmptyCanvas(page: Page): Promise<void> {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!
  const x = pane.x + pane.width * 0.6
  const y = pane.y + pane.height - 40
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false, [x, y])).toBe(true)
  await page.mouse.click(x, y)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId)).toBe(null)
}

/** the screen distance from a connection's end (source or target) to a handle's centre */
const endToHandle = (page: Page, edgeId: string, end: 'start' | 'end', nodeId: string, handleId: string) =>
  page.evaluate(
    ({ edgeId, end, nodeId, handleId }) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`) as SVGPathElement | null
      const h = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`)
      if (!p || !h) return null
      const q = p.getPointAtLength(end === 'start' ? 0 : p.getTotalLength())
      const m = p.getScreenCTM()!
      const s = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }
      const r = h.getBoundingClientRect()
      return Math.hypot(s.x - (r.left + r.right) / 2, s.y - (r.top + r.bottom) / 2)
    },
    { edgeId, end, nodeId, handleId },
  )

test.describe('the new node — face handles mount only while needed', () => {
  test('at rest a node mounts only the faces its connections use, hidden, and that connection ends on them', async ({ page }) => {
    await openSmall(page)
    expect(await mountedFaces(page)).toEqual(AT_REST)
    for (const [node, handle] of [['treated', 'out@bottom'], ['discharged', 'in@top']] as const) {
      const h = page.locator(`.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${handle}"]`)
      await expect(h).toHaveCSS('opacity', '0')
      await expect(h).toHaveAttribute('data-off', '')
    }
    expect(await endToHandle(page, 'e_leave', 'start', 'treated', 'out@bottom')).toBeLessThan(2)
    expect(await endToHandle(page, 'e_leave', 'end', 'discharged', 'in@top')).toBeLessThan(2)
  })

  test('a selected or keyboard-focused node mounts every face, shown; the unused ones go when that ends', async ({ page }) => {
    await openSmall(page)
    await page.locator('.react-flow__node[data-id="triage"] .nodef').click({ position: { x: 30, y: 28 } })
    await expect.poll(async () => (await mountedFaces(page)).triage).toEqual(allFaces(true, true))
    for (const h of await page.locator('.react-flow__node[data-id="triage"] .react-flow__handle.h--extra').all()) await expect(h).toHaveCSS('opacity', '1')
    // the other nodes are unchanged
    const sel = await mountedFaces(page)
    expect({ ...sel, triage: [] }).toEqual(AT_REST)
    // deselected: back to rest
    await page.keyboard.press('Escape')
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
    // keyboard focus (React Flow's focusable node wrapper) mounts them too
    await page.locator('.react-flow__node[data-id="waiting"]').focus()
    await expect.poll(async () => (await mountedFaces(page)).waiting).toEqual(allFaces(true, true))
    await page.locator('.react-flow__node[data-id="waiting"]').blur()
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
  })

  test('drawing a connection mounts every face on every node; the face it lands on stays; undo and redo follow it', async ({ page }) => {
    await openSmall(page)
    const count = () => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().edges.length)
    const n0 = await count()
    // from arrivals' default `out` (no node selected), across the canvas
    const from = page.locator('.react-flow__node[data-id="arrivals"] .react-flow__handle[data-handleid="out"]')
    const fb = (await from.boundingBox())!
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await page.mouse.down()
    await page.mouse.move(fb.x + 30, fb.y + 30, { steps: 4 })
    // mid-drag: every node offers every face
    await expect.poll(async () => (await mountedFaces(page)).discharged).toEqual(allFaces(true, false))
    const mid = await mountedFaces(page)
    expect(mid.triage).toEqual(allFaces(true, true))
    expect(mid.rate.length, 'a Parameter offers its state faces').toBeGreaterThan(0)
    // drop on discharged's bottom `in` face
    const to = page.locator('.react-flow__node[data-id="discharged"] .react-flow__handle[data-handleid="in@bottom"]')
    const tb = (await to.boundingBox())!
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(count).toBe(n0 + 1)
    const made = await page.evaluate(() => { const es = (window as unknown as { __loop: Loop }).__loop.graph.getState().edges; const e = es[es.length - 1]; return { id: e.id as string, source: e.source, target: e.target, ports: e.data?.ports } })
    expect(made).toMatchObject({ source: 'arrivals', target: 'discharged', ports: { target: 'bottom' } })
    // after the drop, with nothing selected (starting the drag selected
    // arrivals; a click on the empty canvas clears it) and nothing focused:
    // discharged keeps the face its new connection uses
    await clickEmptyCanvas(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect.poll(() => mountedFaces(page)).toEqual({ ...AT_REST, discharged: ['in@bottom', 'in@top'] })
    await expect(page.locator(`.react-flow__edge[data-id="${made.id}"] path.react-flow__edge-path`)).toHaveCount(1)
    await expect.poll(() => endToHandle(page, made.id, 'end', 'discharged', 'in@bottom')).toBeLessThan(2)
    // the route really enters from the bottom face, on the `in` lane (routeMap.portPoint)
    const geom = await page.evaluate((id) => {
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const n = g.nodes.find((x: any) => x.id === 'discharged')
      const el = document.querySelector('.react-flow__node[data-id="discharged"] .nodef') as HTMLElement
      const d = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)!.getAttribute('d')!
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      return { x: n.position.x, y: n.position.y, h: el.offsetHeight, end: { x: nums[nums.length - 2], y: nums[nums.length - 1] } }
    }, made.id)
    expect(geom.end.x).toBeCloseTo(geom.x + PORT_COL, 0)
    expect(geom.end.y).toBeCloseTo(geom.y + geom.h, 0)
    // undo: the connection and its face handle go together
    await page.keyboard.press('Control+z')
    await expect.poll(count).toBe(n0)
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
    // redo: both come back, and the connection is drawn on the remounted handle
    await page.keyboard.press('Control+y')
    await expect.poll(count).toBe(n0 + 1)
    await expect.poll(() => mountedFaces(page)).toEqual({ ...AT_REST, discharged: ['in@bottom', 'in@top'] })
    await expect(page.locator(`.react-flow__edge[data-id="${made.id}"] path.react-flow__edge-path`)).toHaveCount(1)
    await expect.poll(() => endToHandle(page, made.id, 'end', 'discharged', 'in@bottom')).toBeLessThan(2)
  })
})
