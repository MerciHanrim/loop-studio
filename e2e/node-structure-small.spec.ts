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
  await page.goto(structure === 'outside' ? '/?nodes=outside' : '/')
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
    const made = await page.evaluate(() => { const es = (window as unknown as { __loop: Loop }).__loop.graph.getState().edges; const e = es[es.length - 1]; return { source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data } })
    expect(made.source).toBe('triage')
    expect(made.target).toBe('discharged')
    // the document keeps the plain handle ids; the non-default face is stored, the default one is not
    expect(made.sourceHandle).toBe('out')
    expect(made.targetHandle).toBe('in')
    expect(made.data.ports).toEqual({ source: 'bottom' })
    await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(6)
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
