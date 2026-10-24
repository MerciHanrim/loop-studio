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
//     with the connection, which is drawn each time;
//   - a connection moved to a face its node did not use (Reverse, an end moved
//     from the Ends group or a grip's popover, their undo / redo) has that
//     handle mounted and measured before it is drawn: no React Flow 008, no
//     animation frame without its path.
// A connection's end cannot be dragged to another port here: React Flow draws
// its reconnection anchors only with an `onReconnect` handler, which the
// canvas does not pass (`edgesReconnectable` alone enables nothing), so there
// is no reconnection gesture whose handles could go missing.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { waitForAppReady } from './support/appReady'
import { endToDomHandle, onDrawnOutline } from './support/outlineCheck'
import { openPanelDetails } from './support/panel'

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
 *  where the small graph at 100 % has nothing */
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
    // the route really enters from the bottom face, at that face's anchor
    // (routeMap.portPoint: on the symbol's outline, 2026-10-19 symbol nodes)
    const geom = await page.evaluate(async (id) => {
      const rm = await import('/src/store/routeMap.ts' as string)
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const n = g.nodes.find((x: any) => x.id === 'discharged')
      const d = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)!.getAttribute('d')!
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      return { anchor: rm.portPoint(n, 'bottom', 'in') as { x: number; y: number }, bottom: n.position.y + 28, end: { x: nums[nums.length - 2], y: nums[nums.length - 1] } }
    }, made.id)
    expect(geom.end.x).toBeCloseTo(geom.anchor.x, 0)
    expect(geom.end.y).toBeCloseTo(geom.anchor.y, 0)
    expect(geom.anchor.y, 'below the centre: the bottom face').toBeGreaterThan(geom.bottom)
    // independent of portPoint: on the outline the node DRAWS, and where its DOM handle is
    expect(await onDrawnOutline(page, 'discharged', geom.end), 'the end is on the drawn outline').toBe(true)
    expect(await endToDomHandle(page, made.id, 'end', 'discharged', 'in@bottom')).toBeLessThan(2)
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

  // share note 53 (note 51's error 008): a connection moved to a face no
  // connection of its node used before needs that face's handle mounted AND
  // measured before React Flow draws it. Before, React Flow drew it first: it
  // warned (`Couldn't create edge for … handle id`, error 008, development
  // builds only — this suite runs the dev server) and the path was missing
  // from the DOM for one animation-frame sample. Every way such a move is made
  // by a user, with its undo and redo; on the code before the fix this fails
  // on both counts.
  test('a connection moved to an unused face is drawn on its handle at once: no React Flow 008, no frame without its path', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (/Couldn't create edge|error#008/.test(m.text())) warnings.push(m.text().slice(0, 160))
    })
    await openSmall(page)
    const EDGE = 'e_treat'
    const edgeState = () =>
      page.evaluate((id) => {
        const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
        const e = g.edges.find((x: any) => x.id === id)
        return { source: e.source as string, target: e.target as string, ports: (e.data?.ports ?? null) as Record<string, string> | null, selected: g.selectedEdgeId as string | null }
      }, EDGE)
    // every animation frame, is the connection's path in the DOM
    await page.evaluate((id) => {
      const w = window as unknown as { __missing: number; __frames: number }
      w.__missing = 0
      w.__frames = 0
      const tick = () => {
        w.__frames++
        const p = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)
        if (!p || !(p.getAttribute('d') ?? '')) w.__missing++
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, EDGE)
    // select by a click on the connection's own line; an undo or redo leaves
    // React Flow's mark on it without the selection, so the empty canvas first
    const select = async () => {
      await clickEmptyCanvas(page)
      const at = await page.evaluate((id) => {
        const p = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`) as SVGPathElement
        const len = p.getTotalLength()
        const m = p.getScreenCTM()!
        for (let i = 1; i < 40; i++) {
          const q = p.getPointAtLength((len * i) / 40)
          const x = q.x * m.a + q.y * m.c + m.e
          const y = q.x * m.b + q.y * m.d + m.f
          if ((document.elementFromPoint(x, y)?.closest('.react-flow__edge') as HTMLElement | null)?.dataset.id === id) return { x, y }
        }
        return null
      }, EDGE)
      expect(at, 'a clickable point on the connection').not.toBeNull()
      await page.mouse.click(at!.x, at!.y)
      await expect.poll(async () => (await edgeState()).selected).toBe(EDGE)
    }
    const unusedFace = (node: string) =>
      page.evaluate((nid) => {
        const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
        const used = new Set<string>()
        for (const x of g.edges) {
          const p = x.data?.ports ?? {}
          if (x.source === nid) used.add(p.source ?? (x.sourceHandle?.startsWith('state') ? 'bottom' : 'right'))
          if (x.target === nid) used.add(p.target ?? (x.targetHandle?.startsWith('state') ? 'top' : 'left'))
        }
        return ['top', 'right', 'bottom', 'left'].find((f) => !used.has(f)) ?? null
      }, node)
    const undoRedo = async (after: Awaited<ReturnType<typeof edgeState>>, before: Awaited<ReturnType<typeof edgeState>>) => {
      await page.keyboard.press('Control+z')
      await expect.poll(async () => ({ ...(await edgeState()), selected: null })).toEqual({ ...before, selected: null })
      await page.keyboard.press('Control+Shift+z')
      await expect.poll(async () => ({ ...(await edgeState()), selected: null })).toEqual({ ...after, selected: null })
    }

    // 1. Reverse (Treated today's LEFT face starts it: no connection used it)
    await select()
    // the Ends group lives in the panel's More settings (docs/workbench.md §WB6)
    await openPanelDetails(page)
    const s0 = await edgeState()
    await page.locator('.inspector .ends').getByRole('button', { name: 'Reverse direction' }).click()
    await expect.poll(async () => (await edgeState()).source).toBe(s0.target)
    const s1 = await edgeState()
    expect(s1.ports).toEqual({ source: 'left', target: 'right' })
    await undoRedo(s1, s0)

    // 2. the To end to an unused side, from the Inspector's Ends group
    await select()
    const f2 = await unusedFace(s1.target)
    expect(f2, 'an unused side on the To node').not.toBeNull()
    const ends = page.locator('.inspector .ends')
    await ends.locator('.ends__toggle').click()
    await ends.locator('.ends__end').nth(1).locator('.ends__sides input[type=radio]').nth(['top', 'right', 'bottom', 'left'].indexOf(f2!)).check()
    await ends.locator('.ends__actions button').first().click()
    await expect.poll(async () => (await edgeState()).ports?.target).toBe(f2)
    const s2 = await edgeState()
    await undoRedo(s2, s1)

    // 3. an end to an unused side, from the canvas grip's popover
    await select()
    await expect(page.locator('.end-grip').first()).toBeVisible()
    const end = (await page.locator('.end-grip[data-end="target"]').count()) ? 'target' : 'source'
    const f3 = await unusedFace(end === 'target' ? s2.target : s2.source)
    expect(f3, `an unused side on the ${end} node`).not.toBeNull()
    await page.locator(`.end-grip[data-end="${end}"]`).click()
    await page.locator(`.end-popover[data-end="${end}"] .end-popover__side[data-face="${f3}"]`).click()
    await expect.poll(async () => (await edgeState()).ports?.[end]).toBe(f3)
    const s3 = await edgeState()
    await undoRedo(s3, s2)

    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const dom = await page.evaluate(() => {
      const w = window as unknown as { __missing: number; __frames: number }
      return { missing: w.__missing, frames: w.__frames }
    })
    expect(dom.frames, 'the sampler ran').toBeGreaterThan(30)
    expect(dom.missing, 'animation frames without the connection path').toBe(0)
    expect(warnings, 'React Flow error 008 warnings').toEqual([])
  })
})
