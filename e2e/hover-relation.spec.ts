import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #444 (Lumi, 2026-11-01) — docs/large-graph-readability.md §LGR2.1:
// on a computer, the mouse resting on a node (~80 ms), or keyboard focus on
// the node itself, marks its one-hop relation — the node (`rel-center`), the
// nodes at the other end of its connections (`rel-neighbour`) and those
// connections (`rel-edge`) — and nothing else; leaving clears it at once. The
// rest of the canvas is not lowered. Off under Focus view, during a node drag
// or a connection gesture, and on touch. A selected node or connection keeps
// its blue mark alone. A connection the pointer is on keeps its own hover
// look. Nothing in the selection, the document, Undo or the digest changes.

type Bridge = {
  __loop: {
    graph: { getState: () => { nodes: { id: string; className?: string }[]; edges: { id: string; source: string; target: string }[]; selectedNodeId: string | null; past: unknown[] } }
    ui: { getState: () => { relationHoverId: string | null; relationFocusId: string | null; toggleFocusMode: () => void; focusMode: boolean } }
    revisionIO: { currentTargetDigest: () => string | Promise<string> }
  }
}
const N = 'ore_stock'
const L = (page: Page) => page.evaluate(() => ({ hover: (window as unknown as Bridge).__loop.ui.getState().relationHoverId, focus: (window as unknown as Bridge).__loop.ui.getState().relationFocusId }))

/** what the canvas marks, by id */
const marked = (page: Page) =>
  page.evaluate(() => {
    const ids = (sel: string) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-id') ?? el.getAttribute('data-testid')?.replace(/^rf__edge-/, '') ?? '').sort()
    return { center: ids('.react-flow__node.rel-center'), neighbours: ids('.react-flow__node.rel-neighbour'), edges: ids('.react-flow__edge.rel-edge') }
  })
const none = { center: [], neighbours: [], edges: [] }
/** the one-hop set from the document */
const oneHop = (page: Page, id: string) =>
  page.evaluate((nid) => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const edges = g.edges.filter((e) => e.source === nid || e.target === nid)
    return { center: [nid], neighbours: [...new Set(edges.map((e) => (e.source === nid ? e.target : e.source)))].sort(), edges: edges.map((e) => e.id).sort() }
  }, id)
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
const centreOf = async (page: Page, id: string) => {
  const b = (await node(page, id).locator('.nodef').boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
/** an empty spot of the pane: its top-right corner */
const emptySpot = async (page: Page) => {
  const b = (await page.locator('.react-flow__pane').boundingBox())!
  return { x: b.x + b.width - 12, y: b.y + 12 }
}
const restOn = async (page: Page, id: string) => {
  const c = await centreOf(page, id)
  await page.mouse.move(c.x, c.y)
}

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(node(page, N)).toBeVisible()
}

test.describe('the hover relation (#444)', () => {
  test('the mouse resting on a node marks exactly its one hop after ~80 ms, and leaving clears it at once', async ({ page }) => {
    await load(page)
    const want = await oneHop(page, N)
    expect(want.edges.length).toBeGreaterThan(0)
    // the timing, in the page: a pointer that has just arrived shows nothing at 30 ms, the relation by 160 ms
    const timing = await page.evaluate(async (nid) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"] .nodef`)!
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      const ui = (window as unknown as Bridge).__loop.ui
      await new Promise((r) => setTimeout(r, 30))
      const early = ui.getState().relationHoverId
      await new Promise((r) => setTimeout(r, 130))
      const late = ui.getState().relationHoverId
      el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
      return { early, late, after: ui.getState().relationHoverId }
    }, N)
    expect(timing).toEqual({ early: null, late: N, after: null })

    // the real mouse
    await restOn(page, N)
    await expect.poll(() => marked(page)).toEqual(want)
    const off = await emptySpot(page)
    await page.mouse.move(off.x, off.y)
    expect(await L(page)).toEqual({ hover: null, focus: null }) // cleared with the move, no wait
    await expect.poll(() => marked(page)).toEqual(none)
  })

  // the node matrix's steps: a click re-renders the node under the resting
  // pointer, and the `pointerout` that follows went to a detached element;
  // the relation stayed on after the pointer had left (fixed by listening on
  // the document)
  test('after a click on a node and a move off the canvas, nothing stays marked', async ({ page }) => {
    await load(page)
    for (let i = 0; i < 3; i++) {
      await node(page, N).locator('.nodef').click()
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120))) // the pointer rests: the relation shows
      await node(page, (await oneHop(page, N)).neighbours[0]).focus()
      await page.mouse.move(2, 2)
      expect((await L(page)).hover, `round ${i + 1}`).toBeNull()
      await expect.poll(() => marked(page)).toEqual(none)
    }
  })

  test('the pointer leaving the browser window, straight from the node, clears it too', async ({ page }) => {
    await load(page)
    await restOn(page, N)
    await expect.poll(() => marked(page)).not.toEqual(none)
    // out of the page: past the viewport's top-left corner
    await page.mouse.move(-20, -20)
    expect((await L(page)).hover).toBeNull()
    await expect.poll(() => marked(page)).toEqual(none)
  })

  test('keyboard focus on the node shows the same relation at once; a click’s focus does not; blur clears it', async ({ page }) => {
    await load(page)
    const want = await oneHop(page, N)
    await page.keyboard.press('Escape') // a keyboard interaction first: the focus below is keyboard focus
    await node(page, N).focus()
    expect((await L(page)).focus).toBe(N)
    await expect.poll(() => marked(page)).toEqual(want)
    await page.locator('.wb-tabs [role="tab"]').first().focus()
    expect((await L(page)).focus).toBeNull()
    await expect.poll(() => marked(page)).toEqual(none)
    // a mouse click focuses the node but is not keyboard focus
    await node(page, N).click()
    expect((await L(page)).focus).toBeNull()
  })

  test('nothing in the selection, the document, Undo or the digest changes', async ({ page }) => {
    await load(page)
    const snap = () =>
      page.evaluate(async () => {
        const L = (window as unknown as Bridge).__loop
        const g = L.graph.getState()
        return { selected: g.selectedNodeId, past: g.past.length, digest: await L.revisionIO.currentTargetDigest(), classes: g.nodes.map((n) => n.className ?? '').join('|') }
      })
    const before = await snap()
    await restOn(page, N)
    await expect.poll(() => marked(page)).not.toEqual(none)
    expect(await snap()).toEqual(before)
    await page.keyboard.press('Escape')
    await node(page, N).focus()
    await expect.poll(() => marked(page)).not.toEqual(none)
    expect(await snap()).toEqual(before)
  })

  test('off under Focus view, during a node drag and during a connection gesture', async ({ page }) => {
    await load(page)
    // Focus view
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleFocusMode())
    await restOn(page, N)
    await page.waitForFunction((nid) => (window as unknown as Bridge).__loop.ui.getState().relationHoverId === nid, N)
    expect(await marked(page)).toEqual(none)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleFocusMode())
    await expect.poll(() => marked(page)).not.toEqual(none)

    // a node drag: the mouse is on the node, the relation is shown; the drag hides it
    const c = await centreOf(page, N)
    await page.mouse.down()
    await page.mouse.move(c.x + 30, c.y + 20, { steps: 6 })
    await expect.poll(() => marked(page)).toEqual(none)
    await page.mouse.up()

    // a connection gesture from a source port, resting over another node on the way
    const other = (await oneHop(page, N)).neighbours[0]
    const h = (await node(page, N).locator('.react-flow__handle.source').first().boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    const o = await centreOf(page, other)
    await page.mouse.move(o.x, o.y, { steps: 8 })
    await page.evaluate(() => new Promise((r) => setTimeout(r, 160)))
    expect(await marked(page)).toEqual(none)
    const off = await emptySpot(page)
    await page.mouse.move(off.x, off.y, { steps: 4 })
    await page.mouse.up()
  })

  // Lumi's review of c6455845: the selection box (`.react-flow__nodesselection`)
  // is dragged through React Flow's `onSelectionDrag*`, not `onNodeDrag*`
  test('with several nodes selected, a drag of one of them, or of the selection box, turns the relation off', async ({ page }) => {
    await load(page)
    const hop = await oneHop(page, N)
    const nb = hop.neighbours[0]
    // one of several selected nodes, dragged: the mouse rests on it first
    await node(page, N).locator('.nodef').click()
    await node(page, nb).locator('.nodef').click({ modifiers: ['Control'] })
    await expect(node(page, N)).toHaveClass(/selected/)
    await expect(node(page, nb)).toHaveClass(/selected/)
    const c = await centreOf(page, N)
    await page.mouse.move(c.x, c.y)
    await expect.poll(async () => (await marked(page)).neighbours.length).toBeGreaterThan(0)
    await page.mouse.down()
    await page.mouse.move(c.x + 30, c.y + 20, { steps: 6 })
    await expect.poll(() => marked(page)).toEqual(none)
    await page.mouse.up()

    // the selection box: drawn around the two with region select, then dragged
    // while a keyboard-focus relation stands on another node
    await page.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { setRegionSelectArmed: (v: boolean) => void } } } }).__loop.ui.getState().setRegionSelectArmed(true))
    const ra = (await node(page, N).boundingBox())!
    const rb = (await node(page, nb).boundingBox())!
    const x0 = Math.min(ra.x, rb.x) - 24, y0 = Math.min(ra.y, rb.y) - 24
    const x1 = Math.max(ra.x + ra.width, rb.x + rb.width) + 24, y1 = Math.max(ra.y + ra.height, rb.y + rb.height) + 24
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x1, y1, { steps: 8 })
    await page.mouse.up()
    const box = page.locator('.react-flow__nodesselection-rect')
    await expect(box).toBeVisible()
    const other = await page.evaluate(({ a, b }) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return g.nodes.find((n) => n.id !== a && n.id !== b && g.edges.some((e) => e.source === n.id || e.target === n.id))!.id
    }, { a: N, b: nb })
    await page.keyboard.press('Shift') // a keyboard interaction: the focus below is keyboard focus
    await node(page, other).focus()
    await expect.poll(() => marked(page)).not.toEqual(none)
    const bb = (await box.boundingBox())!
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.mouse.down()
    // what holds it off: the press takes keyboard focus off the node, and the
    // pointer is on the box, not on a node (the drag itself is guarded too)
    expect(await L(page)).toEqual({ hover: null, focus: null })
    await page.mouse.move(bb.x + bb.width / 2 + 30, bb.y + bb.height / 2 + 20, { steps: 6 })
    await expect.poll(() => marked(page)).toEqual(none)
    await page.mouse.up()
  })

  test('a selected node keeps its blue mark alone; hovering another node adds the relation beside it', async ({ page }) => {
    await load(page)
    const hop = await oneHop(page, N)
    const nb = hop.neighbours[0]
    await node(page, nb).click() // select a neighbour of N
    await restOn(page, N)
    await expect.poll(async () => (await marked(page)).center).toEqual([N])
    const m = await marked(page)
    expect(m.neighbours).not.toContain(nb) // the selected one is not ringed in amber
    await expect(node(page, nb)).toHaveClass(/selected/)
    // hovering the selected node itself: no amber on it, its neighbours ringed
    await restOn(page, nb)
    await expect.poll(async () => (await marked(page)).neighbours.length).toBeGreaterThan(0)
    expect((await marked(page)).center).toEqual([])
  })

  test('a connection the pointer is on keeps its own hover look', async ({ page }) => {
    await load(page)
    const hop = await oneHop(page, N)
    await page.keyboard.press('Escape')
    await node(page, N).focus() // the relation, by keyboard
    await expect.poll(() => marked(page)).toEqual(hop)
    // the mouse onto one of its connections, at the middle of the drawn path
    const e = hop.edges[0]
    const p = await page.evaluate((id) => {
      const g = document.querySelector(`.react-flow__edge[data-id="${id}"], [data-testid="rf__edge-${id}"]`)!
      const path = g.querySelector('.react-flow__edge-path') as SVGPathElement
      const len = path.getTotalLength()
      const pt = path.getPointAtLength(len / 2)
      const m = path.getScreenCTM()!
      return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f }
    }, e)
    await page.mouse.move(p.x, p.y)
    const path = page.locator(`.react-flow__edge[data-id="${e}"] .react-flow__edge-path, [data-testid="rf__edge-${e}"] .react-flow__edge-path`).first()
    await expect(path).toHaveClass(/edge-hover/)
    expect(await path.evaluate((el) => getComputedStyle(el).filter)).toBe('none')
  })
})

test.describe('the hover relation on a touch screen (#444)', () => {
  test.use({ hasTouch: true })

  test('a tap selects as before and marks no relation', async ({ page }) => {
    await load(page)
    const c = await centreOf(page, N)
    await page.touchscreen.tap(c.x, c.y)
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId)).toBe(N)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 160)))
    expect((await L(page)).hover).toBeNull()
    expect(await marked(page)).toEqual(none)
  })
})

for (const theme of ['light', 'dark', 'forced'] as const) {
  test(`how it is drawn — ${theme}`, async ({ page }) => {
    await page.emulateMedia(theme === 'forced' ? { forcedColors: 'active' } : { colorScheme: theme, forcedColors: 'none' })
    await load(page)
    const hop = await oneHop(page, N)
    await restOn(page, N)
    await expect.poll(() => marked(page)).toEqual(hop)
    const look = await page.evaluate(({ c, nb, e }) => {
      const st = (sel: string) => getComputedStyle(document.querySelector(sel)!)
      const g = document.querySelector(`.react-flow__edge[data-id="${e}"], [data-testid="rf__edge-${e}"]`)!
      const path = getComputedStyle(g.querySelector('.react-flow__edge-path')!)
      const centre = st(`.react-flow__node[data-id="${c}"] .nodef`)
      const neighbour = st(`.react-flow__node[data-id="${nb}"] .nodef`)
      return {
        centre: { style: centre.outlineStyle, width: centre.outlineWidth, colour: centre.outlineColor },
        neighbour: { style: neighbour.outlineStyle, width: neighbour.outlineWidth },
        edge: { width: path.strokeWidth, filter: path.filter, dash: path.strokeDasharray },
        // every marked connection: its width, and a state connection keeps its dash
        all: [...document.querySelectorAll('.react-flow__edge.rel-edge .react-flow__edge-path')].map((p) => {
          const s = getComputedStyle(p)
          return { width: s.strokeWidth, state: p.classList.contains('edge-state'), dash: s.strokeDasharray }
        }),
        // the rest is not lowered
        restOpacity: [...document.querySelectorAll('.react-flow__node:not(.rel-center):not(.rel-neighbour) .nodef')].map((n) => getComputedStyle(n).opacity).every((o) => o === '1'),
      }
    }, { c: N, nb: hop.neighbours[0], e: hop.edges[0] })
    expect(look.restOpacity).toBe(true)
    expect(look.all.every((e) => e.width === (theme === 'forced' ? '4px' : '2.5px')), JSON.stringify(look.all)).toBe(true)
    for (const e of look.all.filter((x) => x.state)) expect(e.dash, 'a state connection keeps its dash').not.toBe('none')
    if (theme === 'forced') {
      expect(look.centre.style).toBe('double')
      expect(look.neighbour.style).toBe('dashed')
      expect(look.edge).toMatchObject({ width: '4px', filter: 'none' })
    } else {
      expect(look.centre).toMatchObject({ style: 'solid', colour: theme === 'light' ? 'rgb(180, 95, 6)' : 'rgb(242, 169, 59)' })
      expect(look.neighbour.style).toBe('solid')
      // the node's ring is heavier than a neighbour's (a 1x screen floors 2.5 / 1.5 to 2 / 1)
      expect(Number.parseFloat(look.centre.width)).toBeGreaterThan(Number.parseFloat(look.neighbour.width))
      expect(look.edge.width).toBe('2.5px')
      expect(look.edge.filter).toContain('drop-shadow')
    }
  })
}
