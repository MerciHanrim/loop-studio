// Node structure, first implementation — the small graph
// (scratch/share/connection-editing-2/17-implementation-rules.md §1, §5).
// The new node is drawn while `?nodes=outside` switches the view
// (uiStore.nodeStructure); the document, its digests and today's node are
// untouched without the switch. Checked here, on `e2e/fixtures/
// node-structure-small.json` (7 nodes, 5 connections, one frame):
//   - the body at the compact height with W1's width, the name OUTSIDE it,
//     shown at level 1 and hidden at level 0 with the body;
//   - body + name + the gap between them = ONE hit region: pointing at any of
//     them identifies the node, clicking any of them selects it, and the
//     identification does not drop while the pointer crosses the gap;
//   - moving by a drag of the name and by the arrow keys, each undone;
//   - four-side ports: a stored face draws the route from that face, a new
//     connection made from a face handle stores its face, and undo removes it;
//   - the save round trip: the engine digest ignores faces, the revision
//     content carries them, a document without faces is byte-identical;
//   - frames: a frame holds the same nodes under both structures.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { waitForAppReady } from './support/appReady'

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')

type Loop = { graph: { getState: () => any }; rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void; getViewport: () => { x: number; y: number; zoom: number }; fitView: (o?: object) => void }; ui: { getState: () => any } }

async function openSmall(page: Page, structure: 'outside' | 'inside'): Promise<void> {
  // the new node is the default; the previous structure is reached by `?nodes=inside`
  await page.goto(structure === 'outside' ? '/' : '/?nodes=inside')
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(5)
  // 100 %, the graph at the top-left so every node is on screen
  await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)).toBe(1)
}

const nodeBox = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef`)
const nodeName = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__name`)
const nodeBridge = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__bridge`)
const posOf = (page: Page, id: string) => page.evaluate((nid) => { const n = (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.find((x: any) => x.id === nid); return { x: n.position.x, y: n.position.y } }, id)

test.describe('node structure — the small graph under the new node', () => {
  test('the body is compact and W1-wide, the name is outside and shows at level 1 only', async ({ page }) => {
    await openSmall(page, 'outside')
    await expect(page.locator('.nodef--outside')).toHaveCount(7)
    // no title inside any body; a name outside every node; the Pool shows `count / capacity`
    await expect(page.locator('.nodef--outside .nodef__title')).toHaveCount(0)
    await expect(page.locator('.nodef__name')).toHaveCount(7)
    await expect(nodeName(page, 'waiting')).toHaveText('Waiting room')
    await expect(nodeBox(page, 'waiting').locator('.nodef__value')).toHaveText(/^4 \/ 20$/)
    // a Parameter's unit rides its value row (it was reserved by W1, so it shows)
    await expect(nodeBox(page, 'rate').locator('.nodef__unit')).toHaveText(/people/)
    await expect(nodeBox(page, 'rate').locator('.nodef__value')).toHaveText(/^3\s+people$/)
    await expect(nodeBox(page, 'rate').locator('.nodef__value')).toHaveAttribute('title', '3 people')
    // W1: every body is the width the rule reserves from the document, 88–260, at the compact height
    const widths = await page.evaluate(async () => {
      const { reservedWidth } = await import('/src/components/nodes/nodeWidth.ts')
      const nodes = (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes
      return nodes.map((n: any) => { const el = document.querySelector(`.react-flow__node[data-id="${n.id}"] .nodef`) as HTMLElement; return { id: n.id, drawn: el.offsetWidth, h: el.offsetHeight, expected: reservedWidth(n) } })
    })
    for (const w of widths) {
      expect(w.drawn, `${w.id} width`).toBe(w.expected)
      expect(w.expected).toBeGreaterThanOrEqual(88)
      expect(w.expected).toBeLessThanOrEqual(260)
      expect(w.h, `${w.id} height`).toBe(56)
    }
    // the inner role symbol (set A) sits in a value-less body, and the word it
    // stands for joins the accessible name, so the meaning never rests on the
    // symbol alone; Converter / End carry no symbol
    await expect(nodeBox(page, 'triage').locator('.nodef__role')).toHaveCount(1)
    await expect(nodeBox(page, 'triage')).toHaveAttribute('aria-label', /^Gate Triage desk, deterministic/)
    await expect(nodeBox(page, 'arrivals')).toHaveAttribute('aria-label', /^Source Daily arrivals, automatic/)
    await expect(nodeBox(page, 'triage').locator('.nodef__role title')).toHaveText('deterministic')
    // the name's face follows the connections (the candidate rule): a node whose
    // left, right and bottom faces carry ports puts the name on top; a node with
    // only left and bottom ports puts it right; the others below
    await expect(nodeBox(page, 'waiting')).toHaveAttribute('data-name-face', 'top')
    await expect(nodeBox(page, 'treated')).toHaveAttribute('data-name-face', 'right')
    await expect(nodeBox(page, 'arrivals')).toHaveAttribute('data-name-face', 'bottom')
    // level 1 (zoom 0.6): the name stays visible; level 0 (zoom 0.3): hidden with the body
    const visibility = (id: string) => page.evaluate((nid) => getComputedStyle(document.querySelector(`.react-flow__node[data-id="${nid}"] .nodef__name`)!).visibility, id)
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 0.6 }, { duration: 0 }))
    await expect(nodeBox(page, 'waiting')).toHaveClass(/lod-L1/)
    expect(await visibility('waiting')).toBe('visible')
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 0.3 }, { duration: 0 }))
    await expect(nodeBox(page, 'waiting')).toHaveClass(/lod-L0/)
    expect(await visibility('waiting')).toBe('hidden')
  })

  test('body, name and the gap are one node to point at and to select', async ({ page }) => {
    await openSmall(page, 'outside')
    const box = nodeBox(page, 'triage')
    // pointing at the name identifies the node; pointing at the gap keeps it
    await nodeName(page, 'triage').hover()
    await expect(box).toHaveClass(/is-hover/)
    await nodeBridge(page, 'triage').hover({ force: true })
    await expect(box).toHaveClass(/is-hover/)
    // crossing from the body's centre through the gap to the name: never a step without the node
    const body = (await box.boundingBox())!
    const name = (await nodeName(page, 'triage').boundingBox())!
    const from = { x: body.x + body.width / 2, y: body.y + body.height / 2 }
    const to = { x: from.x, y: name.y + name.height / 2 }
    await page.mouse.move(from.x, from.y)
    const steps = Math.ceil(to.y - from.y)
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x, from.y + i)
      if (i % 4 === 0 || i === steps) await expect(box, `hover kept at step ${i} of ${steps}`).toHaveClass(/is-hover/)
    }
    // leaving past the name drops it
    await page.mouse.move(to.x, name.y + name.height + 40)
    await expect(box).not.toHaveClass(/is-hover/)
    // clicking the name selects the node (the body shows the selection ring, the store agrees)
    await nodeName(page, 'triage').click()
    await expect(box).toHaveClass(/is-selected/)
    expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId)).toBe('triage')
    // clicking another node's body moves the selection
    await nodeBox(page, 'treated').click({ position: { x: 30, y: 28 } })
    await expect(nodeBox(page, 'treated')).toHaveClass(/is-selected/)
    await expect(box).not.toHaveClass(/is-selected/)
    // pointing is for reading: the face handles stay hidden on hover and show
    // only on the selected node (and while a connection is dragged)
    const extra = (id: string) => page.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle.h--extra`).first()
    await nodeName(page, 'triage').hover()
    await expect(box).toHaveClass(/is-hover/)
    await expect(extra('triage')).toHaveCSS('opacity', '0')
    await expect(extra('treated')).toHaveCSS('opacity', '1')
  })

  test('the whole-diagram fit contains the outside names, not only the bodies', async ({ page }) => {
    await openSmall(page, 'outside')
    await page.evaluate(() => (window as unknown as { __loop: Loop & { rf: { fitAll: () => Promise<void> } } }).__loop.rf.fitAll())
    await page.waitForTimeout(200)
    const cut = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      return [...document.querySelectorAll('.nodef__name')].map((n) => { const r = n.getBoundingClientRect(); return { id: n.closest('.react-flow__node')!.getAttribute('data-id'), inside: r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom } }).filter((x) => !x.inside).map((x) => x.id)
    })
    expect(cut, 'names cut by the fit').toEqual([])
  })

  test('a drag of the name and the arrow keys move the node; each is undone; the name face holds', async ({ page }) => {
    await openSmall(page, 'outside')
    const before = await posOf(page, 'triage')
    const faceBefore = await nodeBox(page, 'triage').getAttribute('data-name-face')
    // drag by the name: 64 px right, 32 px down (grid 16, so the snap keeps it)
    const name = (await nodeName(page, 'triage').boundingBox())!
    const sx = name.x + name.width / 2
    const sy = name.y + name.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + 20, sy + 10)
    await page.mouse.move(sx + 64, sy + 32, { steps: 8 })
    await page.mouse.up()
    // the node followed the name (issue #344 §DL3: the drop snaps the grabbed
    // node's own correction — its port row to a grid line — so the exact landing
    // point is the snap's, within the drag's reach)
    await expect.poll(async () => { const p = await posOf(page, 'triage'); return p.x !== before.x || p.y !== before.y }).toBe(true)
    const after = await posOf(page, 'triage')
    expect(after.x).toBeGreaterThanOrEqual(before.x + 32)
    expect(after.x).toBeLessThanOrEqual(before.x + 80)
    expect(after.y).toBeGreaterThanOrEqual(before.y + 8)
    expect(after.y).toBeLessThanOrEqual(before.y + 48)
    expect((after.y + 28) % 16, 'the port row sits on a grid line').toBe(0)
    expect(await nodeBox(page, 'triage').getAttribute('data-name-face')).toBe(faceBefore)
    await page.keyboard.press('Control+z')
    await expect.poll(() => posOf(page, 'triage')).toEqual(before)
    // arrow keys on the focused node: 16 px, Shift 64 px, undone
    await nodeBox(page, 'triage').click({ position: { x: 30, y: 28 } })
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => posOf(page, 'triage')).toEqual({ x: before.x + 16, y: before.y })
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => posOf(page, 'triage')).toEqual({ x: before.x + 16, y: before.y + 64 })
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(() => posOf(page, 'triage')).toEqual(before)
    expect(await nodeBox(page, 'triage').getAttribute('data-name-face')).toBe(faceBefore)
  })

  test('four-side ports: a stored face routes from that face; a new connection from a face handle stores its face', async ({ page }) => {
    await openSmall(page, 'outside')
    // e_leave is stored bottom → top: its route starts on the bottom edge of `treated`
    // at the `out` lane 20 px from the right corner (routeMap.portPoint), and ends on
    // the top edge of `discharged` at the `in` lane 20 px from the left corner
    const geom = await page.evaluate(() => {
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const at = (id: string) => { const n = g.nodes.find((x: any) => x.id === id); const el = document.querySelector(`.react-flow__node[data-id="${id}"] .nodef`) as HTMLElement; return { x: n.position.x, y: n.position.y, w: el.offsetWidth, h: el.offsetHeight } }
      const d = document.querySelector('.react-flow__edge[data-id="e_leave"] path.react-flow__edge-path')!.getAttribute('d')!
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      return { treated: at('treated'), discharged: at('discharged'), start: { x: nums[0], y: nums[1] }, end: { x: nums[nums.length - 2], y: nums[nums.length - 1] } }
    })
    expect(geom.start.x).toBeCloseTo(geom.treated.x + geom.treated.w - 20, 0)
    expect(geom.start.y).toBeCloseTo(geom.treated.y + geom.treated.h, 0)
    expect(geom.end.x).toBeCloseTo(geom.discharged.x + 20, 0)
    expect(geom.end.y).toBeCloseTo(geom.discharged.y, 0)
    // a new connection from triage's bottom `out` handle to discharged's default `in`
    const count = () => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().edges.length)
    const n0 = await count()
    // the face handles show on the SELECTED node (pointing alone reveals none)
    await nodeBox(page, 'triage').click({ position: { x: 30, y: 28 } })
    const from = page.locator('.react-flow__node[data-id="triage"] .react-flow__handle[data-handleid="out@bottom"]')
    await expect(from).toHaveCSS('opacity', '1')
    const fb = (await from.boundingBox())!
    const tb = (await page.locator('.react-flow__node[data-id="discharged"] .react-flow__handle[data-handleid="in"]').boundingBox())!
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await page.mouse.down()
    await page.mouse.move(fb.x + 10, fb.y + 40)
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(count).toBe(n0 + 1)
    const made = await page.evaluate(() => { const es = (window as unknown as { __loop: Loop }).__loop.graph.getState().edges; const e = es[es.length - 1]; return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data } })
    expect(made.source).toBe('triage')
    expect(made.target).toBe('discharged')
    // the document keeps the plain handle ids; the non-default face is stored, the default one is not
    expect(made.sourceHandle).toBe('out')
    expect(made.targetHandle).toBe('in')
    expect(made.data.ports).toEqual({ source: 'bottom' })
    await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(6)
    // N1 (Lumi, 2026-10-12) — triage now uses all four faces and its name keeps
    // the bottom face (the fallback); the new line leaves that face through the
    // node's BRIDGE (the 12 px gap, part of the node's hit region), so the short
    // run there answers the pointer as the node — the name itself is clear — and
    // the connection is selected from any other segment (here its last one).
    const n1 = await page.evaluate((edgeId) => {
      const root = document.querySelector('.react-flow')!.getBoundingClientRect()
      const v = (window as unknown as { __loop: Loop }).__loop.rf.getViewport()
      const toScreen = (p: { x: number; y: number }) => ({ x: root.left + v.x + p.x * v.zoom, y: root.top + v.y + p.y * v.zoom })
      const d = document.querySelector(`.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`)!.getAttribute('d')!
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
      const br = (document.querySelector('.react-flow__node[data-id="triage"] .nodef') as HTMLElement).getBoundingClientRect()
      const nr = (document.querySelector('.react-flow__node[data-id="triage"] .nodef__name') as HTMLElement).getBoundingClientRect()
      let inBridge: { x: number; y: number } | null = null
      for (let i = 0; i + 1 < pts.length && !inBridge; i++) {
        const a = toScreen(pts[i])
        const b = toScreen(pts[i + 1])
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (m.x >= br.left && m.x <= br.right && m.y >= br.bottom && m.y <= nr.top) inBridge = m
      }
      const hit = inBridge ? document.elementFromPoint(inBridge.x, inBridge.y) : null
      const who = hit?.closest('.react-flow__node')?.getAttribute('data-id') ?? hit?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null
      const nameHit = document.elementFromPoint(nr.left + nr.width / 2, nr.top + nr.height / 2)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
      // a point on the route's LONGEST segment, 30 % along it (off the label at
      // the middle and off every bridge): what answers the pointer there
      let best = 0
      for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > Math.hypot(pts[best + 1].x - pts[best].x, pts[best + 1].y - pts[best].y)) best = i
      const a = toScreen(pts[best])
      const b = toScreen(pts[best + 1])
      const other = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 }
      const otherHit = document.elementFromPoint(other.x, other.y)?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null
      return { hasBridgeRun: inBridge !== null, who, nameHit, other, otherHit }
    }, made.id)
    expect(n1.hasBridgeRun, 'the new line has a run inside the bridge').toBe(true)
    expect(n1.who, 'that run answers the pointer as the node').toBe('triage')
    expect(n1.nameHit, 'the name is clear').toBe('triage')
    expect(n1.otherHit, 'another segment of the same line answers as the line').toBe(made.id)
    await page.mouse.click(n1.other.x, n1.other.y)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedEdgeId)).toBe(made.id)
    await page.keyboard.press('Escape')
    // undo removes the connection
    await page.keyboard.press('Control+z')
    await expect.poll(count).toBe(n0)
  })

  // SCOPE (Lumi's review, 2026-10-12): "no face = same bytes" is checked as
  // "the serialized document of a face-less graph mentions no `ports`" on the
  // CURRENT code; a direct comparison against bytes written by the code before
  // this change is not made here (the sha256 baseline fixture of the examples,
  // run by the unit suite, is the before-and-after guard for the bundled files).
  test('save round trip: the engine digest ignores faces, the revision content carries them, no face = same bytes', async ({ page }) => {
    await openSmall(page, 'outside')
    const r = await page.evaluate(async () => {
      const ws = await import('/src/model/workspace.ts')
      const rev = await import('/src/model/revision.ts')
      const ser = await import('/src/model/serialize.ts')
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const strip = (edges: any[]) => edges.map((e) => { const { ports, ...rest } = e.data ?? {}; void ports; return { ...e, data: rest } })
      const withFaces = { nodes: g.nodes, edges: g.edges }
      const noFaces = { nodes: g.nodes, edges: strip(g.edges) }
      const engineA = ws.canonicalGraphString(withFaces)
      const engineB = ws.canonicalGraphString(noFaces)
      const revA = rev.canonicalJson(rev.canonicalContent(withFaces))
      const revB = rev.canonicalJson(rev.canonicalContent(noFaces))
      // the serialized document, read back through the normaliser, serialized again
      const text = ser.serialize(g.nodes, g.edges)
      const parsed = JSON.parse(text)
      const back = ser.normalizeGraph({ nodes: parsed.nodes, edges: parsed.edges })
      const text2 = ser.serialize(back.nodes, back.edges)
      const leave = parsed.edges.find((e: any) => e.id === 'e_leave')
      // a document whose edges never had a face: its bytes do not mention ports
      const textNoFaces = ser.serialize(g.nodes, strip(g.edges))
      return { engineSame: engineA === engineB, revSame: revA === revB, revHasPorts: revA.includes('"ports"'), roundTripSame: text === text2, leavePorts: leave?.data?.ports ?? null, leaveHandles: [leave?.sourceHandle, leave?.targetHandle], noFacesMentionsPorts: textNoFaces.includes('"ports"') }
    })
    expect(r.engineSame, 'engine digest input identical with and without faces').toBe(true)
    expect(r.revSame, 'revision content differs when a face is stored').toBe(false)
    expect(r.revHasPorts).toBe(true)
    expect(r.roundTripSame, 'serialize → normalise → serialize is stable').toBe(true)
    expect(r.leavePorts).toEqual({ source: 'bottom', target: 'top' })
    expect(r.leaveHandles).toEqual(['out', 'in'])
    expect(r.noFacesMentionsPorts).toBe(false)
  })

  // SCOPE (Lumi's review, 2026-10-12): this compares the product's containment
  // verdict (`rectContains` on body boxes) over THIS fixture's one frame under
  // both structures. It is not a check of membership preservation across
  // existing user documents, and it does not drag a frame — the frame-move
  // regression on real documents is the later stage's check.
  test('the frame holds the same nodes under both structures', async ({ page }) => {
    const members = async (structure: 'outside' | 'inside') => {
      await openSmall(page, structure)
      return page.evaluate(async () => {
        const { rectContains } = await import('/src/components/frames/frameGeom.ts')
        const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
        // the fixture's frame, wide enough for today's wider Pool and the new body
        // alike — a frame drawn for one structure only would carry a different set
        // (17-implementation-rules.md §2 Frames: the regression this guards)
        const frame = { x: 208, y: 96, w: 688, h: 176 }
        return g.nodes
          .filter((n: any) => { const el = document.querySelector(`.react-flow__node[data-id="${n.id}"] .nodef`) as HTMLElement; return rectContains(frame, { x: n.position.x, y: n.position.y, w: el.offsetWidth, h: el.offsetHeight }) })
          .map((n: any) => n.id)
          .sort()
      })
    }
    const outside = await members('outside')
    const inside = await members('inside')
    expect(outside).toEqual(['treated', 'triage', 'waiting'])
    expect(inside).toEqual(outside)
  })

  // SCOPE (Lumi's review, 2026-10-12): the fired check reads the ticks' attributes
  // and the absence of today's wave under the default motion setting; it does not
  // run the step twice (motion on / reduced) and compare — the mark is a STATIC
  // element (no animation declared on it), and the reduced-motion capture is the
  // study's visual record. The focus check enters the node BY KEYBOARD (Tab from
  // the pane), not by a click.
  test('the fired mark is the ticks ring, a static element; keyboard entry gives the name its own form', async ({ page }) => {
    await openSmall(page, 'outside')
    // one step: the automatic Source fires
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce())
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex)).toBe(1)
    const fired = page.locator('.nodef--outside .nodef__fired-ticks')
    await expect(fired.first()).toBeAttached()
    // the ticks: the 9–11 px band (stroke 22 masked from 9) with the 8 / 24 repeat; today's scaled wave is not drawn under the new structure
    await expect(fired.first()).toHaveAttribute('stroke-dasharray', '8 24')
    await expect(fired.first()).toHaveAttribute('stroke-width', '22')
    await expect(page.locator('.nodef--outside .nodef__wave')).toHaveCount(0)
    // no animation is declared on the mark: it is the same element whatever the motion setting
    const anim = await fired.first().evaluate((el) => getComputedStyle(el).animationName + '|' + getComputedStyle(el).transitionProperty)
    expect(anim).toBe('none|all')
    // keyboard entry: the pane has focus (an empty click), Tab reaches a node; that
    // node's name is underlined DASHED (the dashed inner ring is the body's tell;
    // the hover underline is solid). The pointer is parked away from every node.
    await page.mouse.move(5, 5)
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
    const reached = await (async () => {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)
        if (id) return id
      }
      return null
    })()
    expect(reached, 'Tab from the pane reaches a node').not.toBeNull()
    await expect(nodeBox(page, reached!)).toHaveClass(/is-focused/)
    await expect(nodeBox(page, reached!)).not.toHaveClass(/is-hover/)
    const deco = await nodeName(page, reached!).evaluate((el) => getComputedStyle(el).textDecorationStyle + ' ' + getComputedStyle(el).textDecorationLine)
    expect(deco).toBe('dashed underline')
    // the accessible name of the reached node carries the role word and, for a symbol kind, its enum word
    const label = await page.locator(`.react-flow__node[data-id="${reached}"] .nodef`).getAttribute('aria-label')
    expect(label).toBeTruthy()
  })

  // Lumi (2026-10-12): the frame's chrome yields to a node's outside name —
  // the name and its bridge answer the pointer before the transparent EDGE
  // strips (they select / move the frame; resizing is the corner handle, next
  // test), the frame can still be selected and moved from the border a name
  // does not cover, and the title chip MOVES off a name instead of covering
  // it. Membership is the body rectangle and is not touched (F1: nothing grows
  // by itself).
  test("a frame's chrome yields to the outside names: the edge strips are cut around a name and its bridge, the title chip moves, the free border still answers", async ({ page }) => {
    const tight = { x: 224, y: 148, w: 587, h: 88 }
    // through the dev bridge's store handle (a page-side `import()` of the store
    // module can land on a second instance once HMR has stamped the app's import URL)
    const setTight = () => page.evaluate((r) => (window as unknown as { __loop: { frame: { getState: () => { resizeFrame: (id: string, rect: typeof r) => void } } } }).__loop.frame.getState().resizeFrame('clinic', r), tight)
    const read = () => page.evaluate(() => {
      const who = (x: number, y: number) => { const el = document.elementFromPoint(x, y); return el?.closest('.react-flow__node')?.getAttribute('data-id') ?? (el?.closest('.lgr-frame__label') ? 'chip' : el?.closest('.lgr-frame__edge-hit') ? 'strip' : null) }
      const name = (id: string) => (document.querySelector(`.react-flow__node[data-id="${id}"] .nodef__name`) as HTMLElement).getBoundingClientRect()
      const w = name('waiting'), tr = name('triage'), te = name('treated')
      const chip = (document.querySelector('.lgr-frame__label') as HTMLElement).getBoundingClientRect()
      const frame = (document.querySelector('.lgr-frame') as HTMLElement).getBoundingClientRect()
      return {
        waitingCentre: who(w.left + w.width / 2, w.top + w.height / 2),
        triageCentre: who(tr.left + tr.width / 2, tr.top + tr.height / 2),
        treatedOuter: who(te.right - 2, te.top + te.height / 2),
        chipClearOfName: chip.left >= w.right || chip.right <= w.left || chip.bottom <= w.top || chip.top >= w.bottom,
        chipLeftOfFrameRight: chip.right <= frame.right + 0.5,
        // a point on the top border well right of Waiting room's name and bridge
        freeTop: who(frame.right - 40, frame.top),
        // a point on the right border above Treated today's bridge
        freeRight: who(frame.right, frame.top + 6),
        strips: document.querySelectorAll('.lgr-frame__edge-hit').length,
      }
    })
    await openSmall(page, 'outside')
    // the shipped frame (sized for today's taller Pool) is already cut once: Treated
    // today's bridge and name lie on its right border (share 20 §1)
    const before = await page.locator('.lgr-frame__edge-hit').count()
    expect(before).toBeGreaterThanOrEqual(4)
    await setTight()
    await expect.poll(async () => (await read()).strips).toBeGreaterThan(before)
    const r = await read()
    expect(r.waitingCentre, 'the top-face name is not under the title chip').toBe('waiting')
    expect(r.triageCentre, 'the bottom-face name is not under the bottom strip').toBe('triage')
    expect(r.treatedOuter, 'the right-face name is not under the right strip').toBe('treated')
    expect(r.chipClearOfName).toBe(true)
    expect(r.chipLeftOfFrameRight).toBe(true)
    expect(r.freeTop, 'the free part of the top border still answers').toBe('strip')
    expect(r.freeRight, 'the free part of the right border still answers').toBe('strip')
    // the member set did not move: still the three bodies
    const members = await page.evaluate(async (fr) => {
      const { rectContains } = await import('/src/components/frames/frameGeom.ts')
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      return g.nodes.filter((n: any) => { const el = document.querySelector(`.react-flow__node[data-id="${n.id}"] .nodef`) as HTMLElement; return rectContains(fr, { x: n.position.x, y: n.position.y, w: el.offsetWidth, h: el.offsetHeight }) }).map((n: any) => n.id).sort()
    }, tight)
    expect(members).toEqual(['treated', 'triage', 'waiting'])
    // today's structure: the same tight frame keeps four whole strips and the chip at home
    await openSmall(page, 'inside')
    await setTight()
    await expect(page.locator('.lgr-frame__edge-hit')).toHaveCount(4)
    const home = await page.evaluate(() => { const c = document.querySelector('.lgr-frame__label') as HTMLElement; return { left: c.style.left, inside: c.classList.contains('is-inside') } })
    expect(home).toEqual({ left: '0px', inside: false })
  })

  // Lumi (2026-10-12): the corner case — a name across the frame's bottom-right
  // corner, where the RESIZE HANDLE of a selected frame sits. Both must hold:
  // the name is read and selects its node, and the frame can still be resized
  // (the handle moves off the name; a thin strip piece is never the only way).
  test('a name across the resize corner: the name still answers and selects its node, the handle moves and still resizes the frame', async ({ page }) => {
    await openSmall(page, 'outside')
    // the frame's right edge runs through the MIDDLE of Triage desk's name (below
    // its body); the name's width depends on the font the runner has, so the
    // edge is taken from the rendered name, not hard-coded
    const nameMidX = await page.evaluate(() => {
      const root = document.querySelector('.react-flow')!.getBoundingClientRect()
      const v = (window as unknown as { __loop: Loop }).__loop.rf.getViewport()
      const nb = (document.querySelector('.react-flow__node[data-id="triage"] .nodef__name') as HTMLElement).getBoundingClientRect()
      return Math.round((nb.left + nb.width / 2 - root.left - v.x) / v.zoom)
    })
    const corner = { x: 224, y: 148, w: nameMidX - 224, h: 88 }
    await page.evaluate((r) => (window as unknown as { __loop: { frame: { getState: () => { resizeFrame: (id: string, rect: typeof r) => void; selectFrame: (id: string) => void } } } }).__loop.frame.getState().resizeFrame('clinic', r), corner)
    await page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { selectFrame: (id: string) => void } } } }).__loop.frame.getState().selectFrame('clinic'))
    const handle = page.locator('.lgr-frame__resize')
    await expect(handle).toHaveCount(1)
    const r = await page.evaluate(() => {
      const name = (document.querySelector('.react-flow__node[data-id="triage"] .nodef__name') as HTMLElement).getBoundingClientRect()
      const h = (document.querySelector('.lgr-frame__resize') as HTMLElement)
      const hb = h.getBoundingClientRect()
      const frame = (document.querySelector('.lgr-frame') as HTMLElement).getBoundingClientRect()
      const at = (x: number, y: number) => document.elementFromPoint(x, y)
      const cornerHit = at(frame.right, frame.bottom)
      return {
        nameCentre: at(name.left + name.width / 2, name.top + name.height / 2)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
        // the corner point itself lies on the name: the node answers there too
        cornerAnswers: cornerHit?.closest('.react-flow__node')?.getAttribute('data-id') ?? cornerHit?.className ?? null,
        debug: { name: { l: name.left, t: name.top, r: name.right, b: name.bottom }, frame: { r: frame.right, b: frame.bottom }, cornerTag: cornerHit?.tagName, cornerClass: typeof cornerHit?.className === 'string' ? cornerHit.className : null },
        handleClearOfName: hb.right <= name.left || hb.left >= name.right || hb.bottom <= name.top || hb.top >= name.bottom,
        handleOnBottomBorder: Math.abs((hb.top + hb.height / 2) - frame.bottom) < 1 && hb.left >= frame.left && hb.right <= frame.right + 1,
        handlePlacement: h.getAttribute('data-placement'),
        handleCentre: { x: hb.left + hb.width / 2, y: hb.top + hb.height / 2 },
      }
    })
    expect(r.nameCentre).toBe('triage')
    expect(r.cornerAnswers, JSON.stringify(r.debug)).toBe('triage')
    expect(r.handleClearOfName).toBe(true)
    expect(r.handleOnBottomBorder).toBe(true)
    expect(r.handlePlacement).toBeNull()
    // the moved handle still resizes the same corner: a 48 × 16 drag grows the rect (snapped to the grid)
    const rectOf = () => page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } } } }).__loop.frame.getState().frames.find((f) => f.id === 'clinic')!.rect)
    await page.mouse.move(r.handleCentre.x, r.handleCentre.y)
    await page.mouse.down()
    await page.mouse.move(r.handleCentre.x + 20, r.handleCentre.y + 8)
    await page.mouse.move(r.handleCentre.x + 48, r.handleCentre.y + 16, { steps: 6 })
    await page.mouse.up()
    const grown = await rectOf()
    expect(grown.x).toBe(corner.x)
    expect(grown.y).toBe(corner.y)
    expect(grown.w).toBeGreaterThan(corner.w)
    expect(grown.h).toBeGreaterThan(corner.h)
    expect((grown.x + grown.w) % 16, 'the dragged corner lands on the grid').toBe(0)
    expect((grown.y + grown.h) % 16).toBe(0)
    await page.keyboard.press('Control+z')
    await expect.poll(rectOf).toEqual(corner)
    // and the name selects its node
    await nodeName(page, 'triage').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId)).toBe('triage')
  })

  test("today's structure is untouched without the switch", async ({ page }) => {
    await openSmall(page, 'inside')
    await expect(page.locator('.nodef--outside')).toHaveCount(0)
    await expect(page.locator('.nodef__name')).toHaveCount(0)
    await expect(page.locator('.nodef__title')).toHaveCount(7)
    // the stored face is drawn at the default face there: e_leave leaves the right side of `treated`
    const d = await page.locator('.react-flow__edge[data-id="e_leave"] path.react-flow__edge-path').getAttribute('d')
    const nums = d!.match(/-?\d+(\.\d+)?/g)!.map(Number)
    const treated = await page.evaluate(() => { const el = document.querySelector('.react-flow__node[data-id="treated"] .nodef') as HTMLElement; return { w: el.offsetWidth } })
    // on the right side of the body (past its middle): the default `out` face,
    // not the stored bottom one — today's node draws today's ports
    expect(nums[0]).toBeGreaterThan(656 + treated.w / 2)
    expect(nums[1]).toBeGreaterThanOrEqual(164)
    expect(nums[1]).toBeLessThanOrEqual(164 + 132)
  })
})
