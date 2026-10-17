import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'

// The face handles while a connection is drawn (share note 58): when a drag
// begins every node mounts its faces and ONE measurement covers every node
// (src/components/nodes/faceBatch.ts); when it ends the unused faces go and one
// measurement on the next frame follows. On the small node-structure fixture:
//   - one drag can land on an unused face of EVERY node: React Flow picks the
//     closest handle from its measured bounds (`connectingto`), so a node left
//     out of the measurement would offer none;
//   - a drag released and started again in the same task (before the end's
//     measurement has run), and five drags started and released back to back,
//     leave the next connection made on the face it is dropped on, ending on
//     that handle, its line drawn on every frame, the faces back afterwards;
//   - a refused drawing (a repeat of a connection drawn the same way) makes
//     nothing and the next connection is made;
//   - Esc cancels a drag of an end grip (the canvas's one Esc-cancellable
//     drag; drawing a new connection has no Esc cancel), the faces go back,
//     and the next connection is made;
//   - no React Flow 008 warning in any of it (printed by development builds).
// The cancel-and-restart checks dispatch mouse events in the page (React
// Flow's handle drag listens to `mousedown` on the handle, then `mousemove` /
// `mouseup` on the document), so the order inside one task is exact.

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
type L = { graph: { getState: () => any }; rf: { setViewport: (v: object, o?: object) => void } }
const AT_REST = { arrivals: [], waiting: [], triage: [], treated: ['out@bottom'], discharged: ['in@top'], rate: [], occupancy: [] }

async function open(page: Page, warnings: string[]) {
  page.on('console', (m) => {
    if (/Couldn't create edge|error#008/.test(m.text())) warnings.push(m.text().slice(0, 160))
  })
  await openApp(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await routesSettled(page)
}

const mountedFaces = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string[]> = {}
    for (const n of document.querySelectorAll('.react-flow__node'))
      out[(n as HTMLElement).dataset.id!] = [...n.querySelectorAll('.react-flow__handle.h--extra')].map((h) => (h as HTMLElement).dataset.handleid!).sort()
    return out
  })
const edges = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: L }).__loop.graph.getState()
    return { past: g.past.length as number, list: g.edges.map((e: any) => ({ id: e.id as string, source: e.source as string, target: e.target as string, ports: e.data?.ports ?? null })) }
  })
const face = (page: Page, node: string, handle: string) => page.locator(`.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${handle}"]`)
const centreOf = async (page: Page, node: string, handle: string) => {
  const b = (await face(page, node, handle).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** an empty spot of the pane, away from every node and line: the first point
 *  of a grid, from the lower right, where the pane itself is on top */
async function emptySpot(page: Page) {
  const p = await page.evaluate(() => {
    const r = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
    for (let y = r.bottom - 40; y > r.top + 40; y -= 24)
      for (let x = r.right - 380; x > r.left + 40; x -= 24)
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y }
    return null
  })
  expect(p, 'an empty spot of the pane').not.toBeNull()
  return p!
}

/** after a drop: nothing selected, nothing focused, so each node shows the faces its connections use */
async function settle(page: Page) {
  const e = await emptySpot(page)
  await page.mouse.click(e.x, e.y)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

/** the connection's end is on the handle's centre, within 2 px */
const endToHandle = (page: Page, edgeId: string, node: string, handle: string) =>
  page.evaluate(
    ({ edgeId, node, handle }) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`) as SVGPathElement | null
      const h = document.querySelector(`.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${handle}"]`)
      if (!p || !h) return null
      const q = p.getPointAtLength(p.getTotalLength())
      const m = p.getScreenCTM()!
      const r = h.getBoundingClientRect()
      return Math.hypot(m.a * q.x + m.c * q.y + m.e - (r.left + r.right) / 2, m.b * q.x + m.d * q.y + m.f - (r.top + r.bottom) / 2)
    },
    { edgeId, node, handle },
  )

/** the connection's path is in the DOM with a `d` on every animation frame for 1 s; the frames without it */
const framesWithoutPath = (page: Page, edgeId: string) =>
  page.evaluate(
    (edgeId) =>
      new Promise<number>((res) => {
        let missing = 0
        const t0 = performance.now()
        const tick = () => {
          const p = document.querySelector(`.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`)
          if (!p || !p.getAttribute('d')) missing++
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
          else res(missing)
        }
        requestAnimationFrame(tick)
      }),
    edgeId,
  )

/** draw from `from`'s handle onto `to`'s face with the real pointer */
async function draw(page: Page, from: [string, string], to: [string, string]) {
  const a = await centreOf(page, ...from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 30, a.y + 30, { steps: 4 })
  await expect(face(page, ...to)).toHaveCount(1)
  const b = await centreOf(page, ...to)
  await page.mouse.move(b.x, b.y, { steps: 12 })
  await page.mouse.up()
}

/** the last connection is `from` → `to` on the target face, drawn on its handle on every frame */
async function expectMade(page: Page, n0: number, source: string, target: string, handle: string, side: string) {
  await expect.poll(async () => (await edges(page)).list.length).toBe(n0 + 1)
  const made = (await edges(page)).list.at(-1)!
  expect(made).toMatchObject({ source, target, ports: { target: side } })
  await expect.poll(() => endToHandle(page, made.id, target, handle)).toBeLessThan(2)
  expect(await framesWithoutPath(page, made.id), 'animation frames without the new line').toBe(0)
  return made
}

/** in-page mouse events on a handle and the document, in React Flow's order */
const dispatch = (page: Page, steps: ([string, string, string] | ['move' | 'up', number, number])[]) =>
  page.evaluate((steps) => {
    let rafRan = false
    requestAnimationFrame(() => (rafRan = true))
    const fire = (t: EventTarget, type: string, x: number, y: number, buttons: number) =>
      t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, view: window }))
    let last = { x: 0, y: 0 }
    for (const s of steps) {
      if (s[0] === 'down') {
        const h = document.querySelector(`.react-flow__node[data-id="${s[1]}"] .react-flow__handle[data-handleid="${s[2]}"]`)!
        const r = h.getBoundingClientRect()
        last = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
        fire(h, 'mousedown', last.x, last.y, 1)
      } else if (s[0] === 'move') {
        last = { x: last.x + (s[1] as number), y: last.y + (s[2] as number) }
        fire(document, 'mousemove', last.x, last.y, 1)
      } else {
        fire(document.elementFromPoint(last.x, last.y) ?? document, 'mouseup', last.x, last.y, 0)
      }
    }
    return { rafRan }
  }, steps)

test.describe('drawing a connection: the face handles of every node (share note 58)', () => {
  test('one drag can land on an unused face of every node; the faces go when it ends', async ({ page }) => {
    const warnings: string[] = []
    await open(page, warnings)
    const a = await centreOf(page, 'arrivals', 'out')
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x + 30, a.y + 30, { steps: 4 })
    // every node that takes an input offers its unused faces, and React Flow
    // finds each (the Register has no resource input: its state input face)
    for (const [node, handle] of [['waiting', 'in@top'], ['triage', 'in@bottom'], ['treated', 'in@top'], ['discharged', 'in@bottom'], ['occupancy', 'state-target@left']] as const) {
      await expect(face(page, node, handle)).toHaveCount(1)
      const b = await centreOf(page, node, handle)
      await page.mouse.move(b.x, b.y, { steps: 6 })
      await expect(face(page, node, handle), `${node} ${handle}: measured, so React Flow picks it`).toHaveClass(/\bconnectingto\b/)
    }
    const n0 = (await edges(page)).list.length
    const e = await emptySpot(page)
    await page.mouse.move(e.x, e.y, { steps: 6 })
    await page.mouse.up()
    await settle(page)
    expect((await edges(page)).list.length).toBe(n0)
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
    expect(warnings).toEqual([])
  })

  test('released and started again in one task, then dropped on a face: made on that face', async ({ page }) => {
    const warnings: string[] = []
    await open(page, warnings)
    const n0 = (await edges(page)).list.length
    const e = await emptySpot(page)
    const out = await centreOf(page, 'arrivals', 'out')
    const { rafRan } = await dispatch(page, [
      ['down', 'arrivals', 'out'],
      ['move', 30, 30],
      ['move', e.x - out.x - 30, e.y - out.y - 30],
      ['up', 0, 0],
      ['down', 'arrivals', 'out'],
      ['move', 30, 30],
    ])
    expect(rafRan, 'the new drag started before the next animation frame').toBe(false)
    await expect.poll(async () => (await mountedFaces(page)).discharged).toContain('in@bottom')
    // the rest of the drag with the real pointer is not possible (its button is
    // not down), so it is finished in the page too, onto discharged's bottom face
    const t = await centreOf(page, 'discharged', 'in@bottom')
    await page.evaluate(({ x, y }) => {
      const fire = (tg: EventTarget, type: string, b: number) => tg.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: b, view: window }))
      fire(document, 'mousemove', 1)
      fire(document.elementFromPoint(x, y) ?? document, 'mouseup', 0)
    }, t)
    await expectMade(page, n0, 'arrivals', 'discharged', 'in@bottom', 'bottom')
    await settle(page)
    await expect.poll(() => mountedFaces(page)).toEqual({ ...AT_REST, discharged: ['in@bottom', 'in@top'] })
    expect(warnings).toEqual([])
  })

  test('five drags started and released back to back, then a connection drawn onto a face', async ({ page }) => {
    const warnings: string[] = []
    await open(page, warnings)
    const n0 = (await edges(page)).list.length
    const e = await emptySpot(page)
    for (const [node, handle] of [['arrivals', 'out'], ['waiting', 'out'], ['triage', 'out'], ['arrivals', 'out'], ['waiting', 'out']] as const) {
      const c = await centreOf(page, node, handle)
      await dispatch(page, [['down', node, handle], ['move', 25, 25], ['move', e.x - c.x - 25, e.y - c.y - 25], ['up', 0, 0]])
    }
    expect((await edges(page)).list.length, 'the cancelled drags made nothing').toBe(n0)
    await draw(page, ['waiting', 'out'], ['treated', 'in@top'])
    await expectMade(page, n0, 'waiting', 'treated', 'in@top', 'top')
    await settle(page)
    await expect.poll(() => mountedFaces(page)).toEqual({ ...AT_REST, treated: ['in@top', 'out@bottom'] })
    expect(warnings).toEqual([])
  })

  test('a refused drawing makes nothing, the faces go back, and the next connection is made', async ({ page }) => {
    const warnings: string[] = []
    await open(page, warnings)
    const before = await edges(page)
    // arrivals → waiting on the default faces repeats e_arrive: refused
    await draw(page, ['arrivals', 'out'], ['waiting', 'in'])
    await settle(page)
    const after = await edges(page)
    expect(after.list).toEqual(before.list)
    expect(after.past, 'nothing recorded').toBe(before.past)
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
    await draw(page, ['arrivals', 'out'], ['discharged', 'in@bottom'])
    await expectMade(page, before.list.length, 'arrivals', 'discharged', 'in@bottom', 'bottom')
    expect(warnings).toEqual([])
  })

  test('every node gone during a drag (its insert undone) does not stop the next drag measuring every node', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (/Couldn't create edge|error#008/.test(m.text())) warnings.push(m.text().slice(0, 160))
    })
    await openApp(page)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().newGraph())
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    // one undo step that adds every node: a module insert
    const menu = page.locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: 'Insert module' }) })
    await menu.getByRole('button', { name: 'Insert module' }).click()
    await menu.locator('.menu__item').filter({ has: page.locator('.menu__name', { hasText: 'Reward split loop' }) }).click()
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(2)
    await routesSettled(page)
    await settle(page)
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].map((n) => ({
        id: (n as HTMLElement).dataset.id!,
        out: !!n.querySelector('.react-flow__handle[data-handleid="out"]'),
        in: !!n.querySelector('.react-flow__handle[data-handleid="in"]'),
      })),
    )
    const from = ids.find((n) => n.out)!
    const to = ids.find((n) => n.in && n.id !== from.id)!
    // a drag from a node, then Ctrl+Z takes every node away while it is held,
    // and the drag is released on the empty canvas: no node sees it end
    const a = await centreOf(page, from.id, 'out')
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x + 30, a.y + 30, { steps: 4 })
    await expect.poll(async () => (await mountedFaces(page))[to.id]?.length ?? 0).toBeGreaterThan(0)
    await page.keyboard.press('Control+z')
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    const e = await emptySpot(page)
    await page.mouse.move(e.x, e.y, { steps: 4 })
    await page.mouse.up()
    // the nodes come back; a new drag must offer — and React Flow must find — an unused face of another node
    await page.keyboard.press('Control+y')
    await expect(page.locator('.react-flow__node')).toHaveCount(ids.length)
    await routesSettled(page)
    // the redo selects the inserted nodes again (§MS3.5): clear that through
    // the store (a click on the empty pane did not clear it here — not traced),
    // so the target's faces are the used ones until the drag starts
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: L }).__loop.graph.getState()
      g.onNodesChange(g.nodes.map((n: any) => ({ type: 'select', id: n.id, selected: false })))
      g.setSelection(null, null)
    })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().nodes.filter((n: any) => n.selected).length))
      .toBe(0)
    await expect.poll(async () => ((await mountedFaces(page))[to.id] ?? []).length).toBeLessThan(12)
    const rest = (await mountedFaces(page))[to.id] ?? []
    const b0 = await centreOf(page, from.id, 'out')
    await page.mouse.move(b0.x, b0.y)
    await page.mouse.down()
    await page.mouse.move(b0.x + 30, b0.y + 30, { steps: 4 })
    await expect.poll(async () => (await mountedFaces(page))[to.id]?.length ?? 0).toBeGreaterThan(rest.length)
    const unused = ((await mountedFaces(page))[to.id] ?? []).find((h) => h.startsWith('in@') && !rest.includes(h))!
    expect(unused, 'an unused input face of the target').toBeTruthy()
    const t = await centreOf(page, to.id, unused)
    await page.mouse.move(t.x, t.y, { steps: 8 })
    await expect(face(page, to.id, unused), 'measured at this drag\'s start, so React Flow picks it').toHaveClass(/\bconnectingto\b/)
    await page.mouse.move(e.x, e.y, { steps: 4 })
    await page.mouse.up()
    expect(warnings).toEqual([])
  })

  test('Esc cancels an end grip drag, the faces go back, and the next connection is made', async ({ page }) => {
    const warnings: string[] = []
    await open(page, warnings)
    const before = await edges(page)
    // select e_leave on its own line, so its end grips show
    const p = await page.locator('.react-flow__edge[data-id="e_leave"] path.react-flow__edge-path').evaluate((el) => {
      const s = el as SVGPathElement
      const q = s.getPointAtLength(s.getTotalLength() * 0.3)
      const m = s.getScreenCTM()!
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
    })
    await page.mouse.click(p.x, p.y)
    const grip = page.locator('.end-grip[data-end="target"]')
    await expect(grip).toHaveCount(1)
    const g = (await grip.boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2 + 20, g.y + g.height / 2 + 20, { steps: 5 })
    await expect.poll(async () => (await mountedFaces(page)).waiting).toContain('in@top')
    await page.keyboard.press('Escape')
    await expect(page.locator('.react-flow__connection')).toHaveCount(0)
    await page.mouse.up()
    await settle(page)
    expect((await edges(page)).list).toEqual(before.list)
    await expect.poll(() => mountedFaces(page)).toEqual(AT_REST)
    await draw(page, ['arrivals', 'out'], ['discharged', 'in@bottom'])
    await expectMade(page, before.list.length, 'arrivals', 'discharged', 'in@bottom', 'bottom')
    expect(warnings).toEqual([])
  })
})
