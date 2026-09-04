import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

/** the bundled Early-MMO Template — 97 nodes / 144 edges, real Bézier +
 *  orthogonal routing, real crossings. Used only for the dense-graph
 *  edge-tap performance regression test below. */
const readMmoProgression = (): string =>
  readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')

// docs/dense-graph-pan.md — the pan-capture overlay (`PanSurface`).
//
// It is live on mobile (always — view / run only) and on desktop while the
// session-only Pan mode is on. Over that surface a left-drag past `PAN_SLOP`
// (~8 px) pans the canvas even when it starts on top of a node; a shorter
// press resolves a target in the order node → nearest edge → empty canvas
// (§DGP-C1) and selects it. Render / UI only — no GraphDoc, digest, undo,
// `simulationRev`, or node re-layout (DGP D7 / D8).
//
// NOT covered here (DGP7 — needs a real device): two-finger pinch zoom, the
// finger add / remove transitions, `Space + drag`, and the middle button.

// Pools + one long edge `e_ab` running left→right, plus `mid` sitting ON that
// edge line (its own box covers part of the path — for the node-beats-edge
// check). Fixed positions so the geometric hit-tests land where the math
// expects.
const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'b', type: 'pool', position: { x: 460, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'c', type: 'pool', position: { x: 0, y: 300 }, data: { kind: 'pool', label: 'C', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'mid', type: 'pool', position: { x: 200, y: -14 }, data: { kind: 'pool', label: 'Mid', activation: 'passive', initial: 0, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_ab', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '7' } },
  ],
})

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
const panToggle = (page: Page) => page.locator('.react-flow__controls-button.rf-panmode')
const panSurface = (page: Page) => page.locator('.pan-surface')

type Bridge = {
  __loop: {
    graph: {
      getState: () => {
        nodes: { id: string; position: { x: number; y: number }; selected?: boolean }[]
        edges: { id: string; selected?: boolean }[]
        selectedNodeId: string | null
        selectedEdgeId: string | null
        simulationRev: number
        exportJSON: () => string
      }
    }
    ui: { getState: () => { panMode: boolean; focusMode: boolean }; setState: (p: object) => void }
    frame: { getState: () => { armTool: () => void; disarmTool: () => void } }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: object, o: object) => void }
  }
}
const translate = async (page: Page): Promise<{ x: number; y: number }> => {
  const s = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? ''
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(s)
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: NaN, y: NaN }
}

const nodePos = (page: Page, id: string) =>
  page.evaluate((nid) => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const n = g.nodes.find((x) => x.id === nid)
    return n ? { x: n.position.x, y: n.position.y } : null
  }, id)

const selectedId = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId)

const selectedEdge = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedEdgeId)

/** an on-screen point on an edge's drawn path, `frac` along its length */
const edgePoint = async (page: Page, id: string, frac = 0.5): Promise<{ x: number; y: number }> =>
  page.evaluate(
    ({ eid, f }) => {
      const path = document
        .querySelector(`.react-flow__edge[data-id="${eid}"]`)
        ?.querySelector('path.react-flow__edge-path') as SVGPathElement | null
      if (!path) return { x: NaN, y: NaN }
      const p = path.getPointAtLength(path.getTotalLength() * f)
      const ctm = path.getScreenCTM()!
      return { x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f }
    },
    { eid: id, f: frac },
  )

const setPanMode = (page: Page, v: boolean) =>
  page.evaluate((val) => (window as unknown as Bridge).__loop.ui.setState({ panMode: val }), v)

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    try {
      localStorage.removeItem('loop-studio:focus-mode')
    } catch {
      /* ignore */
    }
    ;(window as unknown as Bridge).__loop.ui.setState({ panMode: false, focusMode: false })
  })
  await importGraph(page, GRAPH)
  await expect(node(page, 'b')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e_ab"] path.react-flow__edge-path')).toHaveCount(1)
  // a fixed viewport + measured boxes so the geometry is deterministic
  await page.evaluate(() => {
    ;(window as unknown as Bridge).__loop.rf.setViewport({ x: 200, y: 150, zoom: 1 }, { duration: 0 })
  })
  await page.waitForFunction(() => {
    const n = (window as unknown as Bridge).__loop.graph.getState().nodes.find((x) => x.id === 'b') as
      | { measured?: { width?: number } }
      | undefined
    return Boolean(n?.measured?.width && n.measured.width > 0)
  })
}

test.describe('dense-graph pan — desktop Pan mode', () => {
  test('the Pan-mode toggle is present on desktop and reflects state', async ({ page }) => {
    await load(page)
    await expect(panToggle(page)).toHaveCount(1)
    await expect(panToggle(page)).toHaveAttribute('aria-pressed', 'false')
    await panToggle(page).click()
    await expect(panToggle(page)).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().panMode)).toBe(true)
  })

  test('Pan mode ON: a drag that starts on a node pans — the node is not moved and nothing is selected', async ({
    page,
  }) => {
    await load(page)
    await setPanMode(page, true)
    await expect(panSurface(page)).toHaveClass(/pan-surface--active/)

    const before = await translate(page)
    const pos0 = await nodePos(page, 'b')
    const box = (await node(page, 'b').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 140, cy + 60, { steps: 10 })
    await page.mouse.up()

    const after = await translate(page)
    expect(after.x - before.x).toBeGreaterThan(100) // canvas panned with the drag
    expect(after.y - before.y).toBeGreaterThan(40)
    expect(await nodePos(page, 'b')).toEqual(pos0) // the node itself did not move
    expect(await selectedId(page)).toBeNull() // a pan never selects (DGP D3)
  })

  test('Pan mode ON: a short tap on a node selects it and opens the Inspector', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)

    const box = (await node(page, 'a').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()

    expect(await selectedId(page)).toBe('a')
    await expect(page.locator('.rightcol .inspector__empty')).toHaveCount(0)
    await expect(page.locator('.rightcol .inspector__head')).toBeVisible()
  })

  test('Pan mode ON: a short tap on an edge selects that edge and opens the Inspector (§DGP-C1)', async ({
    page,
  }) => {
    await load(page)
    await setPanMode(page, true)

    const p = await edgePoint(page, 'e_ab', 0.8) // clear of every node box
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.up()

    expect(await selectedEdge(page)).toBe('e_ab')
    expect(await selectedId(page)).toBeNull()
    await expect(page.locator('.rightcol .inspector__empty')).toHaveCount(0)
    await expect(page.locator('.rightcol .inspector__head')).toBeVisible()
  })

  test('Pan mode ON: node beats an overlapping edge', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)

    // `mid`'s box straddles the `e_ab` path — a tap at its centre is the node
    const box = (await node(page, 'mid').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()

    expect(await selectedId(page)).toBe('mid')
    expect(await selectedEdge(page)).toBeNull()
  })

  test('Pan mode ON: a tap well clear of every edge and node clears the selection', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)

    // select the edge first
    const p = await edgePoint(page, 'e_ab', 0.8)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedEdge(page)).toBe('e_ab')

    // now tap ~40 px below the edge — outside EDGE_TAP_TOL, no node there
    await page.mouse.move(p.x, p.y + 40)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedEdge(page)).toBeNull()
    expect(await selectedId(page)).toBeNull()
  })

  test('a dense graph: the endpoint-bbox pre-filter still resolves the tapped edge, and repeats stay correct', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    // a 6×5 grid of pools, each wired to its right and down neighbour → ~49 edges
    const COLS = 6
    const ROWS = 5
    const nodes = []
    const edges = []
    for (let r = 0; r < ROWS; r += 1)
      for (let c = 0; c < COLS; c += 1) {
        const id = `p_${r}_${c}`
        nodes.push({ id, type: 'pool', position: { x: c * 220, y: r * 160 }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, mode: 'pullAny' } })
        if (c < COLS - 1)
          edges.push({ id: `e_${r}_${c}_R`, type: 'loop', source: id, target: `p_${r}_${c + 1}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
        if (r < ROWS - 1)
          edges.push({ id: `e_${r}_${c}_D`, type: 'loop', source: id, target: `p_${r + 1}_${c}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
      }
    await importGraph(page, JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges }))
    await page.waitForFunction(
      (n) => {
        const ns = (window as unknown as Bridge).__loop.graph.getState().nodes as { measured?: { width?: number } }[]
        return ns.length === n && ns.every((x) => Boolean(x.measured?.width && x.measured.width > 0))
      },
      nodes.length,
    )
    await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(edges.length)
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.rf.setViewport({ x: 60, y: 60, zoom: 0.7 }, { duration: 0 })
    })
    await setPanMode(page, true)

    // tap three different interior edges in a row; each must resolve to itself
    for (const eid of ['e_2_2_R', 'e_1_3_D', 'e_3_1_R']) {
      const p = await edgePoint(page, eid, 0.5)
      await page.mouse.move(p.x, p.y)
      await page.mouse.down()
      await page.mouse.up()
      expect(await selectedEdge(page), `tap on ${eid}`).toBe(eid)
    }
  })

  test('perf regression — an edge tap on the 144-edge Early-MMO example resolves well under a second', async ({
    page,
  }) => {
    // Hanrim 2026-09-04: the first cut of `edgeAt` cost ~110ms on a dense
    // crossing here (all of it `getPointAtLength` call volume). Route-aware
    // candidate padding + tolerance-scaled sampling brought a worst case to
    // < 40ms on a dev machine — this pins it well clear of a CI-slow re-run
    // without being a flaky tight bound.
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readMmoProgression())
    await page.waitForFunction(() => {
      const ns = (window as unknown as Bridge).__loop.graph.getState().nodes as { measured?: { width?: number } }[]
      return ns.length > 0 && ns.every((x) => Boolean(x.measured?.width && x.measured.width > 0))
    })
    await setPanMode(page, true)

    const ms = await page.evaluate(() => {
      const el = document.querySelector('.pan-surface') as HTMLElement
      const paths = [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')] as SVGPathElement[]
      // 6 scattered edge midpoints, screen coords via each path's own CTM
      const points = [0.05, 0.25, 0.45, 0.6, 0.8, 0.95].map((frac) => {
        const p = paths[Math.floor(frac * paths.length)]
        const len = p.getTotalLength()
        const mid = p.getPointAtLength(len / 2)
        const ctm = p.getScreenCTM()!
        return { x: ctm.a * mid.x + ctm.c * mid.y + ctm.e, y: ctm.b * mid.x + ctm.d * mid.y + ctm.f }
      })
      const pe = (t: string, x: number, y: number) =>
        new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })
      let worst = 0
      for (const { x, y } of points) {
        const t0 = performance.now()
        el.dispatchEvent(pe('pointerdown', x, y))
        el.dispatchEvent(pe('pointerup', x, y)) // no move → a tap → runs nodeAt then edgeAt synchronously
        worst = Math.max(worst, performance.now() - t0)
      }
      return worst
    })
    expect(ms, 'slowest of 6 taps on a 144-edge graph').toBeLessThan(1000)
  })

  test('the overlay self-heals after a stolen gesture — the next tap still works (§DGP-C2)', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)

    // start a pan on the overlay, then have the browser "steal" it: a
    // pointercancel with no matching pointerup (an OS edge gesture).
    await page.evaluate(() => {
      const el = document.querySelector('.pan-surface') as HTMLElement
      const opt = (t: string, x: number, y: number) =>
        new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, pointerType: 'touch' })
      el.dispatchEvent(opt('pointerdown', 5, 400))
      el.dispatchEvent(opt('pointermove', 40, 400))
      el.dispatchEvent(opt('pointermove', 90, 400))
      el.dispatchEvent(opt('pointercancel', 90, 400))
    })

    // the very next tap on a node must select it
    const box = (await node(page, 'a').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedId(page)).toBe('a')
    expect(
      await panSurface(page).evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('auto') // not wedged into the two-finger hand-off
  })

  test('Pan mode ON: a tap on empty canvas clears the selection', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)

    // select a first
    const box = (await node(page, 'a').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedId(page)).toBe('a')

    // flow (250, 250) — clear of every node box, the Controls and the MiniMap
    const rect = (await page.locator('.canvas').boundingBox())!
    const vp = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    await page.mouse.move(rect.x + 250 * vp.zoom + vp.x, rect.y + 250 * vp.zoom + vp.y)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedId(page)).toBeNull()
  })

  test('Pan mode OFF (default): a node drag still moves the node — no edit regression (DGP D7)', async ({
    page,
  }) => {
    await load(page)
    // overlay is present but inert
    await expect(panSurface(page)).toHaveCount(1)
    await expect(panSurface(page)).not.toHaveClass(/pan-surface--active/)
    expect(
      await panSurface(page).evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('none')

    const vp0 = await translate(page)
    const pos0 = await nodePos(page, 'b')
    const box = (await node(page, 'b').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 })
    await page.mouse.up()

    const pos1 = (await nodePos(page, 'b'))!
    expect(pos1.x - pos0!.x).toBeGreaterThan(80) // the node moved
    expect(pos1.y - pos0!.y).toBeGreaterThan(50)
    expect(await translate(page)).toEqual(vp0) // the viewport did not
  })

  test('Pan mode is session-only — a reload drops it and it never touches localStorage', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().panMode)).toBe(true)

    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().panMode)).toBe(false)

    const panKeys = await page.evaluate(() => {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i)
        if (k && /pan/i.test(k)) out.push(k)
      }
      return out
    })
    expect(panKeys).toEqual([])
  })

  test('independent of Focus / selection / digest (DGP D8)', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.setState({ focusMode: true }))

    // select a
    const abox = (await node(page, 'a').boundingBox())!
    await page.mouse.move(abox.x + abox.width / 2, abox.y + abox.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedId(page)).toBe('a')

    const exp0 = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    const rev0 = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().simulationRev)

    // now pan from on top of node b
    await setPanMode(page, true)
    const bbox = (await node(page, 'b').boundingBox())!
    await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2)
    await page.mouse.down()
    await page.mouse.move(bbox.x + bbox.width / 2 - 120, bbox.y + bbox.height / 2 + 40, { steps: 8 })
    await page.mouse.up()

    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())).toBe(exp0)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().simulationRev)).toBe(rev0)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().focusMode)).toBe(true)
    expect(await selectedId(page)).toBe('a') // a pan left the selection alone
  })

  test('the Frame tool takes precedence — while it is armed the overlay is inert', async ({ page }) => {
    await load(page)
    await setPanMode(page, true)
    await expect(panSurface(page)).toHaveClass(/pan-surface--active/)

    await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().armTool())
    await expect(panSurface(page)).not.toHaveClass(/pan-surface--active/)
    expect(await panSurface(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

    await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().disarmTool())
  })
})

test.describe('dense-graph pan — mobile viewport', () => {
  test('the overlay is always active on mobile; drag on a node pans, a tap selects; no Pan toggle', async ({
    page,
  }) => {
    await load(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.toolbar--mobile')).toBeVisible()

    await expect(panSurface(page)).toHaveClass(/pan-surface--active/) // even though panMode is false
    await expect(panToggle(page)).toHaveCount(0) // desktop-only control

    // pin the viewport so nodes `a` and `c` both sit inside the 390px width
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.rf.setViewport({ x: 140, y: 260, zoom: 1 }, { duration: 0 })
    })
    await expect(node(page, 'a')).toBeVisible()

    const before = await translate(page)
    const pos0 = await nodePos(page, 'a')
    const box = (await node(page, 'a').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 40, { steps: 10 })
    await page.mouse.up()

    const after = await translate(page)
    expect(after.x - before.x).toBeGreaterThan(60) // canvas panned with the one-finger drag
    expect(await nodePos(page, 'a')).toEqual(pos0) // the node itself did not move

    // a short tap on `c` selects it
    const cbox = (await node(page, 'c').boundingBox())!
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect(await selectedId(page)).toBe('c')
  })

  test('mobile: a tap on an edge selects it and opens the read-only Inspector sheet (§DGP-C1)', async ({
    page,
  }) => {
    await load(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.toolbar--mobile')).toBeVisible()
    // put `a` and `b` (hence the edge between them) across the width
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.rf.setViewport({ x: 30, y: 300, zoom: 0.6 }, { duration: 0 })
    })
    await expect(node(page, 'b')).toBeVisible()

    const p = await edgePoint(page, 'e_ab', 0.8)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.up()

    expect(await selectedEdge(page)).toBe('e_ab')
    await expect(page.locator('.sheet[aria-label="Inspector — read only"]')).toBeVisible()
  })
})
