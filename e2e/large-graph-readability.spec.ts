import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test, snap } from './support/loop'

// docs/large-graph-readability.md — Slice 1: the global hit-test rule + the
// selection-driven focus view + de-emphasis. Render / UI-only: no GraphDoc,
// digest, undo, viewport, SimState or node z-order change (§LGR8 / LGR-INV).

// a → b → c → d  (linear), plus `mid` sitting ON the straight a→c line with its
// own a→c edge drawn across it, and an isolated `lone`. Selecting `b` focuses
// {a,b,c} + {e_ab,e_bc}; d, mid, lone and their edges de-emphasise.
const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'b', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'c', type: 'pool', position: { x: 520, y: 0 }, data: { kind: 'pool', label: 'C', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'd', type: 'pool', position: { x: 780, y: 0 }, data: { kind: 'pool', label: 'D', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'mid', type: 'pool', position: { x: 260, y: 170 }, data: { kind: 'pool', label: 'Mid', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'lone', type: 'pool', position: { x: 780, y: 200 }, data: { kind: 'pool', label: 'Lone', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'ma', type: 'pool', position: { x: 0, y: 170 }, data: { kind: 'pool', label: 'MA', activation: 'passive', initial: 0, mode: 'pullAny' } },
    { id: 'mc', type: 'pool', position: { x: 520, y: 170 }, data: { kind: 'pool', label: 'MC', activation: 'passive', initial: 0, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_ab', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_bc', type: 'loop', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_cd', type: 'loop', source: 'c', target: 'd', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    // drawn across `mid`'s box (ma → mc runs left-to-right through x≈260,y≈170)
    { id: 'e_across', type: 'loop', source: 'ma', target: 'mc', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`)
// the edge label renders in a React Flow portal (not inside `.react-flow__edge`);
// it carries `data-edge-id`.
const edgeLabel = (page: Page, id: string) => page.locator(`.edge-label[data-edge-id="${id}"]`)

const selection = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { selectedNodeId: string | null; selectedEdgeId: string | null } } } }).__loop.graph.getState()
    return { node: g.selectedNodeId, edge: g.selectedEdgeId }
  })

// The GraphDoc-relevant shape only: React Flow writes its own view state
// (`selected`, `dragging`, `measured`, …) onto the node/edge objects on every
// click — none of it is serialized. Strip it so the invariance check tracks
// what actually round-trips (§LGR8 / LGR-INV-1).
const snapshot = (page: Page) =>
  page.evaluate(() => {
    type N = { id: string; type?: string; position: unknown; data: unknown }
    type E = { id: string; source: string; target: string; sourceHandle?: unknown; targetHandle?: unknown; type?: string; data: unknown }
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: N[]; edges: E[]; canUndo: boolean } } } }).__loop.graph.getState()
    const doc = {
      nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: g.edges.map((e) => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: e.type, data: e.data,
      })),
    }
    return { graph: JSON.stringify(doc), canUndo: g.canUndo }
  })

const viewport = (page: Page) =>
  page.evaluate(() => {
    const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf
    return rf.getViewport()
  })

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    try {
      localStorage.removeItem('loop-studio:focus-mode')
    } catch {
      /* ignore */
    }
    ;(window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: false })
  })
  await importGraph(page, GRAPH)
  await expect(node(page, 'b')).toBeVisible()
  await expect(edge(page, 'e_bc').locator('path.react-flow__edge-path')).toHaveCount(1)
  // a fixed, L2 (≥ 0.8) zoom so edge flow chips render and node hit-boxes are
  // where the geometry math expects (deterministic across runs).
  await page.evaluate(() => {
    ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      { x: 120, y: 260, zoom: 1 },
      { duration: 0 },
    )
  })
  await expect(edgeLabel(page, 'e_bc')).toHaveCount(1)
}

// §LGR12 helpers.
/** exactly WHICH nodes / edges are selected, sorted — so a restore can be proved
 *  to be the same selection, not merely the same size. */
const selectedIds = (page: Page): Promise<{ nodes: string[]; edges: string[] }> =>
  page.evaluate(() => {
    const g = (
      window as unknown as {
        __loop: {
          graph: {
            getState: () => { nodes: { id: string; selected?: boolean }[]; edges: { id: string; selected?: boolean }[] }
          }
        }
      }
    ).__loop.graph.getState()
    return {
      nodes: g.nodes.filter((n) => n.selected).map((n) => n.id).sort(),
      edges: g.edges.filter((e) => e.selected).map((e) => e.id).sort(),
    }
  })

const viewportTransform = (page: Page): Promise<string> =>
  page.evaluate(() => (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)

/** a point on genuinely EMPTY pane (no node / edge / panel under it). */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const c = (document.querySelector('.react-flow') as HTMLElement).getBoundingClientRect()
    for (let y = c.top + 24; y < c.bottom - 24; y += 13)
      for (let x = c.left + 24; x < c.right - 24; x += 17) {
        const t = document.elementFromPoint(x, y)
        if (
          t &&
          t.closest('.react-flow') &&
          !t.closest('.react-flow__node') &&
          !t.closest('.react-flow__edge') &&
          !t.closest('.react-flow__panel')
        )
          return { x, y }
      }
    return null
  })
  if (!p) throw new Error('no empty point on the pane')
  return p
}

/** drag from a point on genuinely empty pane. */
async function dragOnPane(page: Page, steps: number): Promise<void> {
  const from = await emptyPanePoint(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (200 * i) / steps, from.y + (140 * i) / steps)
    await page.waitForTimeout(18)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
}

type Box = { x0: number; y0: number; x1: number; y1: number }

/** `load()` frames the graph for the focus tests (viewport y 260), which puts
 *  the ma / mid / mc row across the pane's bottom edge (528..592 vs a pane that
 *  ends at 560) and `lone` past its right edge. A marquee around them then has
 *  to leave the pane, and React Flow's `autoPanOnSelection` (default, not set by
 *  Canvas.tsx) pans by however long the pointer spends outside — the box may
 *  end up enclosing nothing, so the test flaked. The region-select tests
 *  re-frame so every node they box sits well inside the pane and no gesture
 *  needs to leave it: zoom 0.8 (still L2, chips render) is the largest zoom at
 *  which the 898 px-wide row plus padding fits between the Controls rail and
 *  the right edge. */
async function frameForMarquee(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      { x: 120, y: 40, zoom: 0.8 },
      { duration: 0 },
    )
  })
  await page.waitForTimeout(120)
}

/** the corners of a box that FULLY contains `ids` (`selectionMode: Full` selects
 *  only nodes wholly inside), padded by `pad` px but CLAMPED to the pane's
 *  visible rect at this moment (React Flow may have panned since the last
 *  gesture, so it is re-read per gesture; the Controls rail counts as outside)
 *  and kept `inset` px off its edges, so
 *  the pointer never leaves the pane and `autoPanOnSelection` never fires.
 *  Asserted, not trusted: the corners are inside the pane AND the clamped box
 *  still encloses every target node — a fixture that does not fit fails loudly
 *  here instead of yielding a smaller box that quietly selects less. */
async function marqueeBox(page: Page, ids: string[], pad = 24, inset = 8): Promise<Box> {
  const g = await page.evaluate(
    ({ nids, pad, inset }) => {
      const rect = (el: Element) => {
        const b = el.getBoundingClientRect()
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
      }
      const pane = rect(document.querySelector('.react-flow__pane')!)
      // the Controls rail is a React Flow Panel OVER the pane's left edge; a
      // press there is a button click, not a marquee start
      const rail = document.querySelector('.react-flow__controls')
      if (rail) pane.left = Math.max(pane.left, rect(rail).right)
      const nodes = nids.map((i) => rect(document.querySelector(`.react-flow__node[data-id="${i}"]`)!))
      const want = {
        x0: Math.min(...nodes.map((r) => r.left)) - pad,
        y0: Math.min(...nodes.map((r) => r.top)) - pad,
        x1: Math.max(...nodes.map((r) => r.right)) + pad,
        y1: Math.max(...nodes.map((r) => r.bottom)) + pad,
      }
      const box = {
        x0: Math.max(want.x0, pane.left + inset),
        y0: Math.max(want.y0, pane.top + inset),
        x1: Math.min(want.x1, pane.right - inset),
        y1: Math.min(want.y1, pane.bottom - inset),
      }
      return { pane, nodes, box }
    },
    { nids: ids, pad, inset },
  )
  const { pane, box } = g
  // inside the pane, with room to spare
  expect(box.x0, 'marquee left inside the pane').toBeGreaterThanOrEqual(pane.left + inset)
  expect(box.y0, 'marquee top inside the pane').toBeGreaterThanOrEqual(pane.top + inset)
  expect(box.x1, 'marquee right inside the pane').toBeLessThanOrEqual(pane.right - inset)
  expect(box.y1, 'marquee bottom inside the pane').toBeLessThanOrEqual(pane.bottom - inset)
  // and still a real box around every target node (Full selection mode)
  for (const [k, r] of g.nodes.entries()) {
    expect(r.left, `${ids[k]} left of the box`).toBeGreaterThan(box.x0)
    expect(r.right, `${ids[k]} right of the box`).toBeLessThan(box.x1)
    expect(r.top, `${ids[k]} above the box`).toBeGreaterThan(box.y0)
    expect(r.bottom, `${ids[k]} below the box`).toBeLessThan(box.y1)
  }
  return box
}

/** press at the box's top-left and drag to its bottom-right in `steps`; the
 *  button is left DOWN so a caller can act mid-gesture (Esc). */
async function dragBoxHold(page: Page, box: Box, steps: number): Promise<void> {
  await page.mouse.move(box.x0, box.y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(box.x0 + ((box.x1 - box.x0) * i) / steps, box.y0 + ((box.y1 - box.y0) * i) / steps)
    await page.waitForTimeout(18)
  }
}

/** rubber-band a box that FULLY contains `ids`, inside the pane. The viewport
 *  is asserted unchanged across the gesture: the pointer never left the pane,
 *  so nothing may have auto-panned. */
async function marqueeOver(page: Page, ids: string[]): Promise<void> {
  const box = await marqueeBox(page, ids)
  const vp = await viewportTransform(page)
  await dragBoxHold(page, box, 12)
  await page.mouse.up()
  await page.waitForTimeout(350)
  expect(await viewportTransform(page), 'a marquee inside the pane never pans').toBe(vp)
}

const focusBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-focus')
const filterBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-filter')
const resetViewBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-resetview')
const filterPanel = (page: Page) => page.locator('.lgr-filter')
// a checkbox row in the panel, by its exact visible label text
const filterRow = (page: Page, label: string) =>
  filterPanel(page).getByRole('checkbox', { name: label, exact: true })
// an edge's drawn path — the reliable "is this edge rendered" probe (the wrapper
// <g> is not a Playwright-"visible" element on its own).
const edgePath = (page: Page, id: string) =>
  edge(page, id).locator('path.react-flow__edge-path')

// docs/large-graph-readability.md §LGR3.2 — a graph with typed pools / edges, a
// state edge, and an End, for the resource-type / edge-class / node-kind axes.
// `st1` (state) shares the `gold` endpoint so a currency filter also drags it.
const GRAPH_RT = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'currency' } },
    { id: 'mana', type: 'pool', position: { x: 480, y: 0 }, data: { kind: 'pool', label: 'Mana', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'power' } },
    { id: 'plain', type: 'pool', position: { x: 240, y: 200 }, data: { kind: 'pool', label: 'Plain', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'end', type: 'end', position: { x: 720, y: 0 }, data: { kind: 'end', label: 'End', activation: 'automatic' } },
  ],
  edges: [
    { id: 're1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', resourceType: 'currency' } },
    { id: 're2', type: 'loop', source: 'gold', target: 'mana', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 're3', type: 'loop', source: 'mana', target: 'end', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', resourceType: 'power' } },
    { id: 'rp', type: 'loop', source: 'plain', target: 'mana', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'st1', type: 'loop', source: 'gold', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } },
  ],
})

async function loadRT(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    try {
      localStorage.removeItem('loop-studio:focus-mode')
      localStorage.removeItem('loop-studio:filter-panel')
    } catch {
      /* ignore */
    }
    const w = window as unknown as { __loop: { ui: { setState: (p: object) => void }; filter: { getState: () => { clear: () => void } } } }
    w.__loop.ui.setState({ focusMode: false, filterPanelOpen: false })
    w.__loop.filter.getState().clear()
  })
  await importGraph(page, GRAPH_RT)
  await expect(node(page, 'gold')).toBeVisible()
  await expect(edgePath(page, 're1')).toHaveCount(1)
  // a fixed viewport so the graph is laid out and every edge path is drawn
  await page.evaluate(() => {
    ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      { x: 120, y: 220, zoom: 1 },
      { duration: 0 },
    )
  })
  await expect(edgePath(page, 'st1')).toHaveCount(1)
}

test.describe('large-graph readability — Slice 1', () => {
  test('Focus toggle: default off, persists to the one global key', async ({ page }) => {
    await load(page)
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')
    await focusBtn(page).click()
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:focus-mode'))).toBe('1')
    await focusBtn(page).click()
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:focus-mode'))).toBe('0')
  })

  test('Focus toggle: ON state is a persistent visual + a state-aware tooltip', async ({ page }) => {
    await load(page)
    const btn = focusBtn(page)

    const style = () =>
      btn.evaluate((el) => {
        const s = getComputedStyle(el)
        return { bg: s.backgroundColor, shadow: s.boxShadow }
      })
    const offStyle = await style()
    const offTip = await btn.getAttribute('title')

    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    const onStyle = await style()
    const onTip = await btn.getAttribute('title')

    // the ON state must look different (background + a persistent inset ring)
    expect(onStyle.bg).not.toBe(offStyle.bg)
    expect(onStyle.shadow).not.toBe(offStyle.shadow)
    expect(onStyle.shadow).not.toBe('none')
    // …and the tooltip names the current state, not just the action
    expect(offTip).not.toBe(onTip)
    expect(offTip?.toLowerCase()).toContain('off')
    expect(onTip?.toLowerCase()).toContain('on')
  })

  test('Focus armed with no selection shows a hint; it clears on selection / toggle-off', async ({ page }) => {
    await load(page)
    const hint = page.locator('.lgr-focus-hint')
    await expect(hint).toHaveCount(0)

    await focusBtn(page).click() // ON, nothing selected
    await expect(hint).toBeVisible()
    expect(await hint.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

    await node(page, 'b').click() // a selection ⇒ the canvas changes, hint goes
    await expect(hint).toHaveCount(0)

    // deselect ⇒ armed again, hint back
    await page.evaluate(() =>
      (window as unknown as { __loop: { graph: { getState: () => { setSelection: (a: null, b: null) => void } } } }).__loop.graph
        .getState()
        .setSelection(null, null),
    )
    await expect(hint).toBeVisible()

    await focusBtn(page).click() // OFF ⇒ no hint
    await expect(hint).toHaveCount(0)
  })

  test('Focus off ⇒ nothing is de-emphasised even with a selection', async ({ page }) => {
    await load(page)
    await node(page, 'b').click()
    await expect(selection(page)).resolves.toMatchObject({ node: 'b' })
    await expect(page.locator('.react-flow__node.lgr-deemph')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge.lgr-deemph')).toHaveCount(0)
  })

  test('Focus on + selection: 1-hop set full-strength, the rest de-emphasised', async ({ page }) => {
    await load(page)
    await focusBtn(page).click()
    await node(page, 'b').click()
    // in the focus set: b (anchor) + a, c (1-hop) ; edges e_ab, e_bc
    for (const id of ['a', 'b', 'c']) await expect(node(page, id)).not.toHaveClass(/lgr-deemph/)
    for (const id of ['e_ab', 'e_bc']) await expect(edge(page, id)).not.toHaveClass(/lgr-deemph/)
    // outside: d, mid, lone, ma, mc ; edges e_cd, e_across
    for (const id of ['d', 'mid', 'lone', 'ma', 'mc']) await expect(node(page, id)).toHaveClass(/lgr-deemph/)
    for (const id of ['e_cd', 'e_across']) await expect(edge(page, id)).toHaveClass(/lgr-deemph/)
  })

  test('§LGR3.1 — no SELECTED node is de-emphasised; non-selected nodes still are', async ({ page }) => {
    await load(page)
    await focusBtn(page).click()
    await node(page, 'b').click()
    // `lone` is isolated, so it is outside b's 1-hop set and starts dimmed
    await expect(node(page, 'lone')).toHaveClass(/lgr-deemph/)

    // Add it to the selection. React Flow reads the multi-selection key from a
    // window `keydown` listener, and Playwright's `click({ modifiers })` only
    // sets the mouse event's modifier bitmask — it does NOT drive that listener,
    // so the key must be held explicitly or this silently selects one node.
    await page.keyboard.down('Control')
    await node(page, 'lone').click()
    await page.keyboard.up('Control')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)

    // both selected nodes render at full strength, whichever one is the anchor
    await expect(node(page, 'b')).not.toHaveClass(/lgr-deemph/)
    await expect(node(page, 'lone')).not.toHaveClass(/lgr-deemph/)
    // and the focus calculation is untouched for everything NOT selected:
    // none of these is 1-hop from `b` or from the isolated `lone`
    for (const id of ['d', 'mid', 'ma', 'mc']) await expect(node(page, id)).toHaveClass(/lgr-deemph/)
    // edges are not exempted — only nodes carry a selection the user can see
    await expect(edge(page, 'e_across')).toHaveClass(/lgr-deemph/)

    // de-select `lone` again ⇒ it goes straight back to the de-emphasis tier
    await page.keyboard.down('Control')
    await node(page, 'lone').click()
    await page.keyboard.up('Control')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    await expect(node(page, 'lone')).toHaveClass(/lgr-deemph/)
  })

  test('§LGR12 region select — one shot: box-drag selects and disarms; Esc cancels the tool only', async ({
    page,
  }) => {
    await load(page)
    await frameForMarquee(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')
    await expect(tool).toBeVisible()
    await expect(tool).toHaveAttribute('aria-pressed', 'false')

    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    await marqueeOver(page, ['ma', 'mc'])
    // the box selected everything it enclosed (ma, mc and `mid`, which sits
    // between them) — i.e. the drag was a selection, not a pan (marqueeOver
    // asserts the viewport did not move) — and the tool is spent. "A pane drag
    // pans" is asserted in the next test, with every tool off.
    for (const id of ['ma', 'mc']) await expect(node(page, id)).toHaveClass(/selected/)
    expect(await page.locator('.react-flow__node.selected').count()).toBeGreaterThan(1)
    await expect(tool).toHaveAttribute('aria-pressed', 'false')

    // Esc cancels the TOOL and leaves the selection exactly as it was
    const selected = await page.locator('.react-flow__node.selected').count()
    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(selected)
  })

  test('§LGR12 region select — mutually exclusive with the Frame tool; pane drag still pans with both off', async ({
    page,
  }) => {
    await load(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')
    const frame = page.locator('.react-flow__controls-button.rf-frame')

    await frame.click()
    await expect(frame).toHaveAttribute('aria-pressed', 'true')
    await tool.click() // arming region select turns the Frame tool off
    await expect(frame).toHaveAttribute('aria-pressed', 'false')
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    await frame.click() // and arming the Frame tool cancels region select
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
    await frame.click()
    await expect(frame).toHaveAttribute('aria-pressed', 'false')

    // with every tool off the pane drag pans, exactly as before either existed
    const before = await viewportTransform(page)
    await dragOnPane(page, 8)
    expect(await viewportTransform(page)).not.toBe(before)
  })

  test('§LGR12 region select — a click with no drag clears the selection and spends the tool', async ({
    page,
  }) => {
    await load(page)
    await frameForMarquee(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')

    // start from a real multi-selection made with the tool
    await tool.click()
    await marqueeOver(page, ['ma', 'mc'])
    expect(await page.locator('.react-flow__node.selected').count()).toBeGreaterThan(1)

    // arm again, then press and release on empty pane WITHOUT moving
    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    const p = await emptyPanePoint(page)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(150)

    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
    await expect(page.locator('.lgr-selection-count')).toHaveCount(0)
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
  })

  test('§LGR12 region select — Pan mode and region select cancel each other', async ({ page }) => {
    await load(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')
    const pan = page.locator('.react-flow__controls-button.rf-panmode')

    await pan.click()
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    await tool.click() // arming region select turns Pan mode off
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    await expect(tool).toHaveAttribute('aria-pressed', 'true')

    await pan.click() // and turning Pan mode on cancels region select
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    await expect(tool).toHaveAttribute('aria-pressed', 'false')

    // back to plain panning: the pane drag pans, and region select is still off
    await pan.click()
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    const before = await viewportTransform(page)
    await dragOnPane(page, 8)
    expect(await viewportTransform(page)).not.toBe(before)
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
  })

  test('§LGR12 region select — a cancelled pointer never leaves the tool armed', async ({ page }) => {
    await load(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')

    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')

    // press and start a box, then have the pointer taken away: `pointercancel`
    // arrives and NO `mouseup`/`pointerup` ever does. Nothing may re-arm or
    // strand the tool, and the canvas must go back to plain panning.
    const p = await emptyPanePoint(page)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 70, p.y + 50)
    await page.waitForTimeout(30)
    await page.dispatchEvent('.react-flow__pane', 'pointercancel', { pointerId: 1, isPrimary: true })
    await page.waitForTimeout(200)

    await expect(tool).toHaveAttribute('aria-pressed', 'false')
    // and no frozen rubber-band box is left behind on the canvas
    await expect(page.locator('.react-flow__selection')).toHaveCount(0)

    // release whatever the browser still thinks is held, then confirm the pane
    // pans again rather than rubber-banding
    await page.mouse.up()
    await page.waitForTimeout(150)
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
    const before = await viewportTransform(page)
    await dragOnPane(page, 8)
    expect(await viewportTransform(page)).not.toBe(before)
  })

  test('§LGR12 region select — Esc DURING a box abandons the gesture and restores the selection', async ({
    page,
  }) => {
    await load(page)
    await frameForMarquee(page)
    const tool = page.locator('.react-flow__controls-button.rf-regionselect')
    const box = page.locator('.react-flow__selection')

    // a selection to protect: the box below deliberately encloses a different node
    await tool.click()
    await marqueeOver(page, ['ma', 'mc'])
    const before = await selectedIds(page)
    expect(before.nodes).toEqual(['ma', 'mc', 'mid']) // exactly what the box enclosed
    // the restore path covers edges too, so the fixture must actually have some
    expect(before.edges.length).toBeGreaterThan(0)

    await tool.click()
    // the second box encloses `lone` only (30 px of padding, inside the pane)
    const r = await marqueeBox(page, ['lone'], 30)
    const vp = await viewportTransform(page)
    await dragBoxHold(page, r, 8)
    // React Flow re-selects live as the box grows, so by now `lone` is selected
    // and the original selection is already gone from the canvas — the mid-drag
    // state the Esc below has to undo. Nothing panned to get here.
    await expect(box).toHaveCount(1)
    await expect(page.locator('.react-flow__node[data-id="lone"]')).toHaveClass(/selected/)
    expect(await selectedIds(page)).toEqual({ nodes: ['lone'], edges: [] })
    expect(await viewportTransform(page)).toBe(vp)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)

    // the rectangle is gone, the tool is off, and the selection is back to what
    // the box started from — "Esc leaves the selection alone" holds mid-drag too.
    // Compared by ID, not by size: the same count of a different set would pass
    // a count check and still be a broken restore.
    await expect(box).toHaveCount(0)
    await expect(tool).toHaveAttribute('aria-pressed', 'false')
    expect(await selectedIds(page)).toEqual(before)
    await expect(page.locator('.react-flow__node[data-id="lone"]')).not.toHaveClass(/selected/)

    // the abandoned drag is dead: moving further draws nothing and the release
    // commits nothing
    await page.mouse.move(r.x1 + 40, r.y1 + 40)
    await page.waitForTimeout(80)
    await expect(box).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(250)
    expect(await selectedIds(page)).toEqual(before)
    await expect(page.locator('.react-flow__node[data-id="lone"]')).not.toHaveClass(/selected/)
  })

  test('§LGR12 the selection count shows under the lock AND after unlocking', async ({ page }) => {
    await load(page)
    const count = page.locator('.lgr-selection-count')
    await expect(count).toHaveCount(0) // nothing selected yet

    const setLocked = (v: boolean) =>
      page.evaluate(
        (locked) =>
          (
            window as unknown as {
              __loop: { ui: { getState: () => { setCanvasLocked: (x: boolean) => void } } }
            }
          ).__loop.ui
            .getState()
            .setCanvasLocked(locked),
        v,
      )

    await setLocked(true)
    await node(page, 'b').click()
    await expect(count).toBeVisible()
    await expect(count).toContainText('unlock editing') // locked ⇒ says why nothing moves

    // the count must SURVIVE the unlock — that is the moment the user acts on it
    await setLocked(false)
    await expect(count).toBeVisible()
    await expect(count).not.toContainText('unlock editing')

    // §LGR12.3 — where it lives: the right column, directly above the
    // Inspector, never inside the canvas; and nothing paints over it.
    const where = await count.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const inspector = document.querySelector('.rightcol .inspector')!.getBoundingClientRect()
      return {
        inRightColumn: el.closest('.rightcol') != null,
        inCanvasDom: el.closest('.react-flow') != null,
        aboveInspector: r.bottom <= inspector.top + 0.5,
        occluded: !(hit && el.contains(hit)),
      }
    })
    expect(where).toEqual({ inRightColumn: true, inCanvasDom: false, aboveInspector: true, occluded: false })
    await expect(page.locator('.react-flow .lgr-selection-count')).toHaveCount(0)
  })

  test('walk the graph: clicking a de-emphasised node re-centres the set', async ({ page }) => {
    await load(page)
    await focusBtn(page).click()
    await node(page, 'b').click()
    await expect(node(page, 'd')).toHaveClass(/lgr-deemph/)
    // d is dimmed but still clickable (§LGR4.2)
    await node(page, 'd').click()
    await expect(selection(page)).resolves.toMatchObject({ node: 'd' })
    // now the set is {c,d}; b leaves it, c stays (1-hop of both)
    await expect(node(page, 'd')).not.toHaveClass(/lgr-deemph/)
    await expect(node(page, 'c')).not.toHaveClass(/lgr-deemph/)
    await expect(node(page, 'b')).toHaveClass(/lgr-deemph/)
    await expect(node(page, 'a')).toHaveClass(/lgr-deemph/)
  })

  test('global hit-test (Focus OFF): a node beats an edge drawn across it', async ({ page }) => {
    await load(page)
    // e_across (ma → mc) runs straight through `mid`'s box. A click at the
    // centre of `mid` must select the NODE, never the edge (§LGR4.1 / #2).
    await node(page, 'mid').click({ position: { x: 20, y: 20 } })
    await expect(selection(page)).resolves.toEqual({ node: 'mid', edge: null })

    // an edge is still selectable OUTSIDE every node body — click the gap on
    // the a→b line, midway between node `a`'s right edge and node `b`'s left.
    const a = await node(page, 'a').boundingBox()
    const b = await node(page, 'b').boundingBox()
    if (!a || !b) throw new Error('nodes not laid out')
    await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2)
    await expect(selection(page)).resolves.toMatchObject({ node: null, edge: 'e_ab' })
  })

  test('edge labels never take the pointer (§LGR4.1)', async ({ page }) => {
    await load(page)
    const pe = await page
      .locator('.edge-label')
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(pe).toBe('none')
  })

  test('out-of-focus badges are HIDDEN, not just dimmed (§LGR3.1)', async ({ page }) => {
    await load(page)
    // all four flow chips render at this zoom, Focus off
    for (const id of ['e_ab', 'e_bc', 'e_cd', 'e_across']) {
      await expect(edgeLabel(page, id)).toHaveCount(1)
    }
    await focusBtn(page).click()
    await node(page, 'b').click()
    // e_cd / e_across are outside the focus set → their flow chips are gone
    await expect(edgeLabel(page, 'e_cd')).toHaveCount(0)
    await expect(edgeLabel(page, 'e_across')).toHaveCount(0)
    // in-focus edges keep their chips
    await expect(edgeLabel(page, 'e_ab')).toHaveCount(1)
    await expect(edgeLabel(page, 'e_bc')).toHaveCount(1)
    // a de-emphasised node's type dot is hidden (visibility, so no reflow)
    const chip = await node(page, 'd')
      .locator('.nodef__chip')
      .evaluate((el) => getComputedStyle(el).visibility)
    expect(chip).toBe('hidden')
    const keptChip = await node(page, 'a')
      .locator('.nodef__chip')
      .evaluate((el) => getComputedStyle(el).visibility)
    expect(keptChip).toBe('visible')
  })

  test('keyboard: bare `f` toggles; a text field and Ctrl/Cmd-F are left alone (§LGR4.3)', async ({ page }) => {
    await load(page)
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')

    await page.locator('body').press('f')
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await page.locator('body').press('f')
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')

    // Ctrl/Cmd-F must NOT toggle (browser find is left to the UA)
    await page.locator('body').press('ControlOrMeta+f')
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')

    // inside a text field, `f` types and does not toggle
    await node(page, 'b').click()
    const field = page.locator('.inspector .field input:not([type="number"])').first()
    await field.click()
    await field.press('f')
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('keyboard: `]` / `[` step the selection through drawn-edge neighbours (§LGR4.3)', async ({ page }) => {
    await load(page)
    // b's neighbours sorted by id: [a, c]
    await node(page, 'b').click()
    await page.locator('body').press(']')
    await expect(selection(page)).resolves.toMatchObject({ node: 'a' })
    // continue the walk from b — next neighbour
    await page.locator('body').press(']')
    await expect(selection(page)).resolves.toMatchObject({ node: 'c' })
    // wraps
    await page.locator('body').press(']')
    await expect(selection(page)).resolves.toMatchObject({ node: 'a' })
    // reverse
    await page.locator('body').press('[')
    await expect(selection(page)).resolves.toMatchObject({ node: 'c' })
    // an isolated node has no neighbours → no-op
    await node(page, 'lone').click()
    await page.locator('body').press(']')
    await expect(selection(page)).resolves.toMatchObject({ node: 'lone' })
  })

  test('mobile: the Focus toggle is in the More sheet, not the canvas controls (§LGR9)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await page.evaluate(() => {
      try {
        localStorage.removeItem('loop-studio:focus-mode')
      } catch {
        /* ignore */
      }
      ;(window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: false })
    })
    // not in the canvas controls on mobile
    await expect(page.locator('.react-flow__controls-button.rf-focus')).toHaveCount(0)
    // …in the More sheet instead
    await page.locator('.mob-more').click()
    const toggle = page.locator('.sheet__row', { hasText: 'Focus selection' }).locator('button')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:focus-mode'))).toBe('1')
  })

  test('invariance: GraphDoc / undo / viewport unchanged by focus (LGR-INV-1/-2)', async ({ page }) => {
    await load(page)
    const before = await snapshot(page)
    const vpBefore = await viewport(page)
    await focusBtn(page).click()
    await node(page, 'b').click()
    await node(page, 'd').click()
    await focusBtn(page).click()
    const after = await snapshot(page)
    const vpAfter = await viewport(page)
    expect(after.graph).toBe(before.graph)
    expect(after.canUndo).toBe(before.canUndo)
    expect(vpAfter).toEqual(vpBefore)
  })

  test('forced-colors: a de-emphasised edge gets a non-opacity tell', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    await focusBtn(page).click()
    await node(page, 'b').click()
    const dash = await edge(page, 'e_cd')
      .locator('path.react-flow__edge-path')
      .evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(dash).not.toBe('none')
    expect(dash.trim().length).toBeGreaterThan(0)
  })

  test('forced-colors: the Focus ON toggle keeps a tell that survives the colour override', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    const style = () =>
      focusBtn(page).evaluate((el) => {
        const s = getComputedStyle(el)
        return { outline: `${s.outlineStyle} ${s.outlineWidth}`, background: s.backgroundColor, color: s.color }
      })
    const off = await style()
    expect(off.outline).toMatch(/none|0px/) // OFF: no outline
    await focusBtn(page).click()
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(640, 700) // off the button — the tell must not depend on hover
    const on = await style()
    // ON: the system "selected" pair (Highlight / HighlightText) — the UA keeps
    // system colours under the override. NOT an outline: `outline` is the
    // keyboard focus ring, and a pressed outline hid it (2026-09-19 audit; the
    // forced-colors block at the end of this spec proves the four states render apart).
    expect(on.background).not.toBe(off.background)
    expect(on.color).not.toBe(off.color)
    expect(on.outline).toMatch(/none|0px/)
  })
})

test.describe('large-graph readability — Slice 2 (transient filters)', () => {
  test('panel toggle: default closed, open state persists to its own key (§LGR3.4)', async ({ page }) => {
    await loadRT(page)
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(filterPanel(page)).toHaveCount(0)
    await filterBtn(page).click()
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(filterPanel(page)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:filter-panel'))).toBe('1')
    // the panel's own × closes it
    await filterPanel(page).locator('.lgr-filter__x').click()
    await expect(filterPanel(page)).toHaveCount(0)
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('resource-type list is built from the graph — exactly its strings + untyped (§LGR3.2 / §LGR10.5)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    const group = filterPanel(page).locator('.lgr-filter__group', { hasText: 'Resource type' })
    await expect(group.locator('.lgr-filter__row span')).toHaveText(['currency', 'power', 'untyped'])
    // no built-in palette leakage
    await expect(group).not.toContainText('Gold')
    await expect(group).not.toContainText('XP')
    await expect(group).not.toContainText('Energy')
  })

  test('the edge-class list is graph-derived — Resource / State only on a plain canvas, no dead Dependency hint (§LGR3.2 / LGR-D4)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    const group = filterPanel(page).locator('.lgr-filter__group', { hasText: 'Edge type' })
    await expect(group.locator('.lgr-filter__row span')).toHaveText(['Resource', 'State'])
    await expect(filterPanel(page)).not.toContainText('Dependency hint')

    // inject a dependency-hint edge (Review-only; can't arrive via Import) —
    // the row appears, and it hides that edge
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { edges: unknown[] }; setState: (p: object) => void } } }).__loop.graph
      const st = g.getState()
      g.setState({
        edges: [
          ...st.edges,
          {
            id: 'dh',
            source: 'gold',
            target: 'mana',
            sourceHandle: 'out',
            targetHandle: 'in',
            type: 'loop',
            data: { kind: 'hint' },
          },
        ],
      })
    })
    await expect(group.locator('.lgr-filter__row span')).toHaveText(['Resource', 'State', 'Dependency hint'])
    await filterRow(page, 'Dependency hint').check()
    await expect(edge(page, 'dh')).toHaveCount(0)
    for (const id of ['re1', 're2', 're3', 'rp', 'st1']) await expect(edgePath(page, id)).toHaveCount(1)
  })

  test('hide an edge class → state edges go, resource edges + nodes stay (§LGR3.2)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await expect(edgePath(page, 'st1')).toHaveCount(1)
    await filterRow(page, 'State').check()
    await expect(edge(page, 'st1')).toHaveCount(0)
    for (const id of ['re1', 're2', 're3', 'rp']) await expect(edgePath(page, id)).toHaveCount(1)
    for (const id of ['src', 'gold', 'mana', 'plain', 'end']) await expect(node(page, id)).toBeVisible()
  })

  test('hide a resource type → only that type of pool / edge, incident edges too (§LGR3.2 / §LGR10.5)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await filterRow(page, 'currency').check()
    await expect(node(page, 'gold')).toHaveCount(0) // the currency pool
    await expect(edge(page, 're1')).toHaveCount(0) // currency-typed edge
    await expect(edge(page, 're2')).toHaveCount(0) // incident to gold
    await expect(edge(page, 'st1')).toHaveCount(0) // state edge incident to gold
    // the rest is untouched
    for (const id of ['src', 'mana', 'plain', 'end']) await expect(node(page, id)).toBeVisible()
    for (const id of ['re3', 'rp']) await expect(edgePath(page, id)).toHaveCount(1)
  })

  test('the node-kind list is graph-derived — GRAPH_RT shows Source / Pool / End only, no dead options (§LGR3.2 / §LGR10.5)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    const group = filterPanel(page).locator('.lgr-filter__group', { hasText: 'Node kind' })
    await expect(group.locator('.lgr-filter__row span')).toHaveText(['Source', 'Pool', 'End'])
    // kinds the graph does not contain are not offered
    for (const dead of ['Gate', 'Converter', 'Drain', 'Parameter', 'Register']) {
      await expect(group).not.toContainText(dead)
    }
    // hiding a present kind removes the node + its incident edges
    await filterRow(page, 'End').check()
    await expect(node(page, 'end')).toHaveCount(0)
    await expect(edge(page, 're3')).toHaveCount(0) // was mana → end
    await expect(node(page, 'mana')).toBeVisible()
  })

  test('Clear filters restores everything and the count reads back', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await filterRow(page, 'currency').check()
    await filterRow(page, 'End').check()
    await expect(filterPanel(page).locator('.lgr-filter__count')).not.toHaveText(/Nothing hidden/)
    await filterPanel(page).locator('.lgr-filter__clear').click()
    for (const id of ['src', 'gold', 'mana', 'plain', 'end']) await expect(node(page, id)).toBeVisible()
    await expect(filterPanel(page).locator('.lgr-filter__count')).toHaveText('Nothing hidden')
    await expect(filterPanel(page).locator('.lgr-filter__clear')).toBeDisabled()
  })

  test('the panel is content-height with nothing filtered — no fixed full-height gap (§LGR3.2)', async ({
    page,
  }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await expect(filterPanel(page)).toBeVisible()
    const g = await filterPanel(page).evaluate((p) => {
      const body = p.querySelector('.lgr-filter__body') as HTMLElement
      const head = p.querySelector('.lgr-filter__head') as HTMLElement
      const rf = document.querySelector('.react-flow') as HTMLElement
      const pr = p.getBoundingClientRect()
      return {
        panelH: pr.height,
        contentH: head.getBoundingClientRect().height + body.scrollHeight,
        panelBottom: pr.bottom,
        canvasBottom: rf.getBoundingClientRect().bottom,
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      }
    })
    // the panel wraps its content — not stretched to the full canvas height
    expect(g.panelH).toBeLessThanOrEqual(g.contentH + 2)
    expect(g.bodyScrolls).toBe(false) // short list ⇒ no internal scroll
    // and it does not reach down over the canvas toward the Timeline
    expect(g.canvasBottom - g.panelBottom).toBeGreaterThan(80)
  })

  test('a resource-type list too long to fit caps at max-height and scrolls inside — header stays put (§LGR3.2)', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const w = window as unknown as { __loop: { ui: { setState: (p: object) => void } } }
      w.__loop.ui.setState({ focusMode: false, filterPanelOpen: false })
    })
    // one pool per distinct resourceType — 30 rows, well past any viewport
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`,
      type: 'pool',
      position: { x: (i % 6) * 180, y: Math.floor(i / 6) * 140 },
      data: { kind: 'pool', label: `P${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: `type-${i}` },
    }))
    await importGraph(page, JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges: [] }))
    await filterBtn(page).click()
    await expect(filterPanel(page)).toBeVisible()
    const g = await filterPanel(page).evaluate((p) => {
      const body = p.querySelector('.lgr-filter__body') as HTMLElement
      const head = p.querySelector('.lgr-filter__head') as HTMLElement
      const rf = document.querySelector('.react-flow') as HTMLElement
      const pr = p.getBoundingClientRect()
      const rfr = rf.getBoundingClientRect()
      return {
        panelH: pr.height,
        cap: rfr.height - 30,
        headH: head.getBoundingClientRect().height,
        headTop: head.getBoundingClientRect().top,
        panelTop: pr.top,
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        panelBottom: pr.bottom,
        canvasBottom: rfr.bottom,
      }
    })
    expect(g.bodyScrolls).toBe(true) // the long list scrolls INSIDE the body
    expect(g.panelH).toBeLessThanOrEqual(g.cap + 2) // never past the max-height cap
    expect(g.panelBottom).toBeLessThanOrEqual(g.canvasBottom - 13) // clear of the Timeline
    expect(Math.abs(g.headTop - g.panelTop)).toBeLessThan(2) // header pinned, not scrolled away
    expect(g.headH).toBeGreaterThan(10)
  })

  test('filter selections are cleared on a graph reload; the panel toggle survives (§LGR3.4)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await filterRow(page, 'State').check()
    await expect(edge(page, 'st1')).toHaveCount(0)
    // re-import the same graph — a whole-graph (re)load
    await importGraph(page, GRAPH_RT)
    await expect(edgePath(page, 'st1')).toHaveCount(1) // selections gone
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'true') // panel open state kept
    await expect(filterPanel(page).locator('.lgr-filter__count')).toHaveText('Nothing hidden')
  })

  test('Reset view clears filters + the focused node, keeps the Focus MODE toggle (§LGR3.4 / LGR-D4)', async ({ page }) => {
    await loadRT(page)
    await focusBtn(page).click() // Focus MODE on
    await node(page, 'gold').click() // a focused anchor
    await filterBtn(page).click()
    await filterRow(page, 'State').check()
    await expect(edge(page, 'st1')).toHaveCount(0)
    await expect(selection(page)).resolves.toMatchObject({ node: 'gold' })

    await resetViewBtn(page).click()
    await expect(edgePath(page, 'st1')).toHaveCount(1) // filters cleared
    await expect(selection(page)).resolves.toEqual({ node: null, edge: null }) // anchor cleared
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'true') // MODE preference kept
  })

  test('Reset view re-fits the screen viewport but never the GraphDoc / node positions / undo (LGR-D4 vs LGR-INV-2)', async ({ page }) => {
    await loadRT(page)
    const before = await snapshot(page)
    // pan / zoom well away from a fitted view
    await page.evaluate(() => {
      ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: -900, y: -700, zoom: 0.35 },
        { duration: 0 },
      )
    })
    const offFit = await viewport(page)

    await filterBtn(page).click()
    await filterRow(page, 'State').check()
    await resetViewBtn(page).click()

    // the on-screen viewport IS changed — that is the point of Reset view
    const afterVp = await viewport(page)
    expect(afterVp).not.toEqual(offFit)

    // …but nothing that serializes / undoes / re-lays-out moved
    const after = await snapshot(page)
    expect(after.graph).toBe(before.graph) // GraphDoc + every node.position
    expect(after.canUndo).toBe(before.canUndo) // the pan/zoom is not an undo entry
  })

  test('filter set / clear never touches the GraphDoc / undo / viewport (LGR-INV-1/-2)', async ({ page }) => {
    await loadRT(page)
    const before = await snapshot(page)
    const vpBefore = await viewport(page)
    await filterBtn(page).click()
    for (const l of ['State', 'currency', 'End']) await filterRow(page, l).check()
    await filterPanel(page).locator('.lgr-filter__clear').click()
    const after = await snapshot(page)
    expect(after.graph).toBe(before.graph)
    expect(after.canUndo).toBe(before.canUndo)
    expect(await viewport(page)).toEqual(vpBefore) // a filter never moves the viewport
  })

  test('composition: filter hides, then Focus dims the remainder (§LGR3.3)', async ({ page }) => {
    await loadRT(page)
    await focusBtn(page).click()
    await filterBtn(page).click()
    await filterRow(page, 'State').check() // st1 gone
    await node(page, 'gold').click() // focus set = {gold, src, mana} + {re1, re2}
    await expect(edge(page, 'st1')).toHaveCount(0) // hidden wins — not merely dimmed
    await expect(node(page, 'end')).toHaveClass(/lgr-deemph/) // outside the set, still visible → dimmed
    await expect(node(page, 'gold')).not.toHaveClass(/lgr-deemph/)
  })

  test('a hidden element is out of the hit path (§LGR4.2)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    await filterRow(page, 'End').check()
    await expect(node(page, 'end')).toHaveCount(0)
    // clicking where `end` was selects nothing (it is not in the DOM at all)
    const box = await node(page, 'mana').boundingBox()
    if (!box) throw new Error('no layout')
    await page.mouse.click(box.x + box.width + 240, box.y + box.height / 2)
    await expect(selection(page)).resolves.toEqual({ node: null, edge: null })
  })

  test('mobile: Filters + Reset view are in the More sheet, not the canvas controls (§LGR9)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await loadRT(page)
    await expect(filterBtn(page)).toHaveCount(0) // no canvas control on mobile
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet__row').filter({ hasText: /^Reset view/ })).toBeVisible()
    await page.locator('.sheet__row').filter({ hasText: /^Filters/ }).click()
    await expect(page.locator('.lgr-filter__body')).toBeVisible()
    await page
      .locator('.lgr-filter__body')
      .getByRole('checkbox', { name: 'State', exact: true })
      .check()
    // it takes effect live behind the sheet
    await expect(edge(page, 'st1')).toHaveCount(0)
  })

  test('forced-colors: the Filters ON toggle keeps a tell that survives the colour override (§LGR9)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadRT(page)
    const style = () =>
      filterBtn(page).evaluate((el) => {
        const s = getComputedStyle(el)
        return { outline: `${s.outlineStyle} ${s.outlineWidth}`, background: s.backgroundColor, color: s.color }
      })
    const off = await style()
    expect(off.outline).toMatch(/none|0px/)
    await filterBtn(page).click()
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(640, 700)
    const on = await style()
    // the system Highlight / HighlightText pair, not an outline (see the Focus
    // toggle test above and the forced-colors block at the end of this spec)
    expect(on.background).not.toBe(off.background)
    expect(on.color).not.toBe(off.color)
    expect(on.outline).toMatch(/none|0px/)
  })
})

// docs/large-graph-readability.md §LGR5 — Slice 3: the run distinction. A
// committed step lights `effective` (a node in `StepReport.fired`) and the
// lighter `evaluated` (a node in `activated` but NOT `fired`). Node-only, and
// flow-execution nodes only — Parameter / Register are never in `activated`.
// Pure read of the committed `StepReport`; no engine / builder / GraphDoc /
// serialize / digest change (§LGR13).
//
//   feed ─3→ store(5) ─1→ busy      feed pushes, busy pulls 1        → effective
//   dry(0) ─1→ idle ─1→ waste       dry is empty, so idle + waste are
//                                   evaluated as targets but move nothing → evaluated
//   store                           receives + is pulled from, but is neither
//                                   `activated` nor `fired` in the report      → no cue
//   iso                             an isolated pool — never activated         → no cue
//   p1 (parameter) · r1 (register) · r_bad (invalid register)
//                                   model nodes — never activated             → no cue
const GRAPH_RUN = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'feed', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Feed', activation: 'automatic', mode: 'pushAny' } },
    { id: 'store', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'Store', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } },
    { id: 'busy', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'Busy', activation: 'automatic', mode: 'pullAny' } },
    { id: 'dry', type: 'pool', position: { x: 0, y: 170 }, data: { kind: 'pool', label: 'Dry', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'idle', type: 'gate', position: { x: 220, y: 170 }, data: { kind: 'gate', label: 'Idle', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'waste', type: 'drain', position: { x: 440, y: 170 }, data: { kind: 'drain', label: 'Waste', activation: 'automatic', mode: 'pullAny' } },
    { id: 'iso', type: 'pool', position: { x: 660, y: 20 }, data: { kind: 'pool', label: 'Iso', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'p1', type: 'parameter', position: { x: 0, y: 320 }, data: { kind: 'parameter', label: 'P1', value: 2 } },
    { id: 'r1', type: 'register', position: { x: 220, y: 320 }, data: { kind: 'register', label: 'R1', expr: '@store', format: 'int' } },
    // an INVALID register — carries the `!` flag; must NOT also carry the
    // `evaluated` arc (model nodes are never in `activated`): the "error +
    // evaluated" comparison cell is really "error, and no evaluated cue".
    { id: 'r_bad', type: 'register', position: { x: 440, y: 320 }, data: { kind: 'register', label: 'Rbad', expr: '1 / (@store - @store)', format: 'float' } },
  ],
  edges: [
    { id: 'e_feed', type: 'loop', source: 'feed', target: 'store', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_sb', type: 'loop', source: 'store', target: 'busy', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_dg', type: 'loop', source: 'dry', target: 'idle', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_gw', type: 'loop', source: 'idle', target: 'waste', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

// a graph that ENDS on step 1: `p` starts with 1, so the End pulls it and the
// run finishes the same step (`src` also fires, pushing into `p`).
const GRAPH_END = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 1, capacity: null, mode: 'pullAny' } },
    { id: 'fin', type: 'end', position: { x: 440, y: 0 }, data: { kind: 'end', label: 'Fin', activation: 'automatic' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'p', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_pf', type: 'loop', source: 'p', target: 'fin', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

type SimHead = { firedNodeIds: string[]; activatedNodeIds: string[]; status: string }
const simHead = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: { sim: { getState: () => SimHead } } }).__loop.sim.getState()
    return {
      firedNodeIds: [...s.firedNodeIds].sort(),
      activatedNodeIds: [...s.activatedNodeIds].sort(),
      status: s.status,
    }
  })

const anyRunCue = (page: Page) =>
  page.evaluate(
    () => document.querySelectorAll('.nodef__wave, .nodef__eval').length,
  )

async function loadRun(page: Page, graph = GRAPH_RUN): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    const w = window as unknown as { __loop: { ui: { setState: (p: object) => void } } }
    w.__loop.ui.setState({ focusMode: false, filterPanelOpen: false })
  })
  await importGraph(page, graph)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await page.evaluate(() =>
    (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      { x: 120, y: 90, zoom: 1 },
      { duration: 0 },
    ),
  )
}

/** commit one engine step. Reduced motion makes `stepOnce()` settle instantly,
 *  so the committed `StepReport` cues are on screen with no wait. */
async function commitOneStep(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce(),
  )
  await expect
    .poll(async () => (await simHead(page)).firedNodeIds.length)
    .toBeGreaterThan(0)
}

const hasWave = (page: Page, id: string) => node(page, id).locator('.nodef__wave')
const hasEval = (page: Page, id: string) => node(page, id).locator('.nodef__eval')
/** the evaluated mark is an OPEN corner bracket — only two borders (left +
 *  bottom) and one rounded corner, never a closed ring or a circle. */
const evalShape = (page: Page, id: string) =>
  hasEval(page, id).evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      left: s.borderLeftStyle,
      bottom: s.borderBottomStyle,
      top: s.borderTopStyle,
      right: s.borderRightStyle,
      radiusBL: s.borderBottomLeftRadius,
      radiusTR: s.borderTopRightRadius,
      opacity: Number(s.opacity),
      w: Math.round(el.getBoundingClientRect().width),
    }
  })

test.describe('LGR Slice 3 — run distinction (evaluated vs effective)', () => {
  // §LGR9 / §LGR10.11 — this block runs under `prefers-reduced-motion: reduce`:
  // the run cues are then STATIC (§LGR5), so the `effective` outline
  // (`.nodef__wave`, held at opacity 0.6 instead of a 0.5 s fade-out) is on
  // screen for the assertions and for the `run-distinction-states` baseline.
  // On the motion path the wave animates to opacity 0 and Playwright's
  // `animations: 'disabled'` fast-forwards it, so a shot taken there shows no
  // effective cue at all (the baseline captured before 2026-09-19 did exactly
  // that). `contextOptions` is the form Playwright applies; a top-level
  // `test.use({ reducedMotion })` is silently ignored.
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test.beforeEach(async ({ page }) => {
    // asserted on the blank page, before any load: the emulation is a context
    // property, so it must already hold here
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      'the context really emulates prefers-reduced-motion: reduce',
    ).toBe(true)
  })

  /** the `effective` cue is a HELD static outline under reduced motion: the
   *  wave path is present, not animating, and visibly opaque. */
  const expectHeldWave = async (page: Page, id: string) => {
    await expect(hasWave(page, id), `${id} ∈ fired → effective`).toHaveCount(1)
    const w = await hasWave(page, id).evaluate((el) => {
      const c = getComputedStyle(el)
      return { animation: c.animationName, opacity: Number(c.opacity) }
    })
    expect(w.animation, `${id} effective outline is static`).toBe('none')
    expect(w.opacity, `${id} effective outline is visible`).toBeGreaterThan(0.3)
  }

  test('every fired node shows `effective`, every activated-not-fired shows `evaluated`, the rest show no cue (§LGR5.1 / §LGR10.6)', async ({ page }) => {
    await loadRun(page)
    await commitOneStep(page)
    const { firedNodeIds, activatedNodeIds } = await simHead(page)

    // the fixture must actually exercise all three weights, or it proves nothing
    const evaluatedOnly = activatedNodeIds.filter((id) => !firedNodeIds.includes(id))
    expect(firedNodeIds.length, 'some node fired').toBeGreaterThan(0)
    expect(evaluatedOnly.length, 'some node was evaluated but did not fire').toBeGreaterThan(0)

    for (const id of firedNodeIds) {
      await expectHeldWave(page, id)
      await expect(hasEval(page, id), `${id} ∈ fired → not the evaluated arc`).toHaveCount(0)
    }
    for (const id of evaluatedOnly) {
      await expect(hasEval(page, id), `${id} ∈ activated∖fired → evaluated`).toHaveCount(1)
      await expect(hasWave(page, id), `${id} not fired → no effective wave`).toHaveCount(0)
      // it is an OPEN corner bracket: left + bottom borders only, one rounded
      // corner — not a closed ring, not a circle, not the top-right `!` disc
      const sh = await evalShape(page, id)
      expect(sh.left, `${id} bracket left stroke`).toBe('solid')
      expect(sh.bottom, `${id} bracket bottom stroke`).toBe('solid')
      expect(sh.top, `${id} bracket has no top stroke`).toBe('none')
      expect(sh.right, `${id} bracket has no right stroke`).toBe('none')
      expect(sh.radiusBL, `${id} rounded at the bracket corner`).not.toBe('0px')
      expect(sh.radiusTR, `${id} not a full-radius ring`).toBe('0px')
      expect(sh.w, `${id} small mark`).toBeLessThan(18)
    }
    // nodes in neither set — no cue at all. `store` is the interesting one: its
    // value changes this step (push in, pull out) yet the report lists it in
    // neither `activated` nor `fired`, so the run distinction gives it no cue
    // (the value bump already signals the change). `iso` is fully idle.
    for (const id of ['store', 'iso']) {
      expect(firedNodeIds, id).not.toContain(id)
      expect(activatedNodeIds, id).not.toContain(id)
      await expect(hasWave(page, id)).toHaveCount(0)
      await expect(hasEval(page, id)).toHaveCount(0)
    }
  })

  test('Parameter / Register (incl. an invalid one) never carry a flow-run cue, even mid-run (§LGR5 — flow-execution only)', async ({ page }) => {
    await loadRun(page)
    await commitOneStep(page)
    const { firedNodeIds, activatedNodeIds } = await simHead(page)
    for (const id of ['p1', 'r1', 'r_bad']) {
      expect(firedNodeIds, `${id} is not a flow node`).not.toContain(id)
      expect(activatedNodeIds, `${id} is not a flow node`).not.toContain(id)
      await expect(hasWave(page, id)).toHaveCount(0)
      await expect(hasEval(page, id)).toHaveCount(0)
    }
    // the invalid register still shows its OWN cue (the `!` flag) — "error"
    // and "evaluated" simply never co-occur (error, and no evaluated arc)
    await expect(node(page, 'r_bad').locator('.nodef__flag')).toHaveText('!')
  })

  test('the run cue is a pure read — stepping never touches GraphDoc / undo', async ({ page }) => {
    await loadRun(page)
    const before = await snapshot(page)
    await commitOneStep(page)
    const after = await snapshot(page)
    expect(after.graph).toBe(before.graph) // serialized GraphDoc byte-identical
    expect(after.canUndo).toBe(before.canUndo)
    expect(await anyRunCue(page)).toBeGreaterThan(0)
  })

  test('run-cue lifecycle — none before a run; the committed step`s cues held through pause / end; gone on Reset or a new graph', async ({ page }) => {
    await loadRun(page)
    // before a run — no cue
    expect(await anyRunCue(page), 'no run cue before the first step').toBe(0)

    // right after a committed step — the StepReport`s cues are on screen
    await commitOneStep(page)
    const firstHead = await simHead(page)
    expect(firstHead.firedNodeIds.length).toBeGreaterThan(0)
    await expect(page.locator('.nodef__wave').first()).toHaveCount(1)
    await expect(page.locator('.nodef__eval').first()).toHaveCount(1)

    // paused (stepOnce leaves status 'paused') — the last committed step`s cues
    // stay; an explicit pause() is a no-op that must not clear them
    expect(firstHead.status).toBe('paused')
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { pause: () => void } } } }).__loop.sim.getState().pause(),
    )
    expect(await anyRunCue(page), 'cues kept while paused').toBeGreaterThan(0)

    // Reset — every run cue goes (the StepReport lifecycle, §LGR5.1)
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    await expect(page.locator('.nodef__wave')).toHaveCount(0)
    await expect(page.locator('.nodef__eval')).toHaveCount(0)

    // a fresh graph load also starts with no run cue
    await commitOneStep(page)
    expect(await anyRunCue(page)).toBeGreaterThan(0)
    await importGraph(page, GRAPH_RUN)
    await expect(page.locator('.nodef__wave')).toHaveCount(0)
    await expect(page.locator('.nodef__eval')).toHaveCount(0)

    // ── ended: a graph that finishes on step 1 keeps its last cues ──
    await loadRun(page, GRAPH_END)
    await commitOneStep(page)
    expect((await simHead(page)).status).toBe('ended')
    const endedCues = await anyRunCue(page)
    expect(endedCues, 'ended keeps the last committed step`s cues').toBeGreaterThan(0)
    // a further step is a no-op while ended — the cues do not change
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce(),
    )
    expect(await anyRunCue(page)).toBe(endedCues)
  })

  test('`evaluated` survives Focus de-emphasis, but a Filter still hides the node (LGR-INV-6 / §LGR3.2)', async ({ page }) => {
    await loadRun(page)
    await commitOneStep(page)
    const head = await simHead(page)
    const target = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!

    // Focus on a DIFFERENT node (`iso`) so `target` is outside the 1-hop set —
    // it de-emphasises, but its run cue must NOT fade with it
    await page.evaluate(() =>
      (window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: true }),
    )
    await node(page, 'iso').click()
    await expect(node(page, target)).toHaveClass(/lgr-deemph/)
    await expect(hasEval(page, target), 'evaluated bracket stays under de-emphasis').toHaveCount(1)
    expect((await evalShape(page, target)).opacity, 'bracket not dimmed toward invisible').toBeGreaterThan(0.5)

    // a Filter that hides the node's kind removes the node — cue and all.
    // `target` is `idle` (first activated∖fired in id order), a Gate.
    expect(target).toBe('idle')
    await page.evaluate(() => {
      const w = window as unknown as { __loop: { ui: { setState: (p: object) => void } } }
      w.__loop.ui.setState({ focusMode: false, filterPanelOpen: true })
    })
    await filterPanel(page).locator('.lgr-filter__body').getByRole('checkbox', { name: 'Gate', exact: true }).check()
    await expect(node(page, target)).toHaveCount(0)
  })

  test('VISUAL — a committed step: effective / evaluated / selected+evaluated / invalid / idle / model-nodes, minimap hidden (§LGR10.6 / §LGR9)', async ({ page }) => {
    await loadRun(page)
    // hide the minimap + attribution so the shot is the real canvas, no mask
    await page.addStyleTag({
      content: '.react-flow__minimap,.react-flow__attribution{display:none!important}',
    })
    await commitOneStep(page)
    const head = await simHead(page)
    const evalTarget = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    // selected + evaluated on `evalTarget`; the other evaluated node stays plain
    await node(page, evalTarget).click()
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    // The frame reads, left→right: Feed/Busy = effective (held static outline +
    // highlighted fired edges) · Idle(selected)+Waste = evaluated · Store =
    // value changed, no run-distinction cue (the disc inside it is the held
    // playback ARRIVAL cue, §VL9 — a different signal) · Iso = idle · P1/R1/Rbad
    // = model nodes, no cue (Rbad also carries the `!` flag). Pinned in the DOM
    // before the pixels so the shot cannot quietly lose a cue again:
    for (const id of head.firedNodeIds) await expectHeldWave(page, id)
    for (const id of head.activatedNodeIds.filter((n) => !head.firedNodeIds.includes(n))) await expect(hasEval(page, id)).toHaveCount(1)
    await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'run-distinction-states'))
  })

  test('§LGR12.3 the selection count never overlaps the canvas or a node in the run-distinction frame', async ({ page }) => {
    // Measured before the fix: the bottom-centre readout intersected `R1` by
    // 23 × 25 px in this exact frame — under the 2 % pixel gate of the shot
    // above, so only a geometric assertion catches it.
    await loadRun(page)
    await commitOneStep(page)
    const head = await simHead(page)
    const evalTarget = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    await node(page, evalTarget).click()
    const count = page.locator('.lgr-selection-count')
    await expect(count).toHaveText(/1 node selected/)
    const g = await page.evaluate(() => {
      const rr = (el: Element) => {
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }
      const c = document.querySelector('.lgr-selection-count')!
      const cr = rr(c)
      const hit = document.elementFromPoint(cr.x + cr.w / 2, cr.y + cr.h / 2)
      return {
        count: cr,
        inCanvasDom: c.closest('.react-flow') != null,
        canvas: rr(document.querySelector('.react-flow')!),
        nodes: [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.getAttribute('data-id'), rect: rr(n) })),
        occluded: !(hit && c.contains(hit)),
      }
    })
    type R = { x: number; y: number; w: number; h: number }
    const disjoint = (a: R, b: R) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
    // a node's VISIBLE part: its rect clipped to the canvas (overflow:hidden
    // cuts anything past the canvas edge; the DOM rect still reports it all)
    const clipTo = (r: R, c: R): R | null => {
      const x = Math.max(r.x, c.x)
      const y = Math.max(r.y, c.y)
      const w = Math.min(r.x + r.w, c.x + c.w) - x
      const h = Math.min(r.y + r.h, c.y + c.h) - y
      return w > 0 && h > 0 ? { x, y, w, h } : null
    }
    expect(g.inCanvasDom).toBe(false)
    expect(disjoint(g.count, g.canvas), 'disjoint from the canvas').toBe(true)
    for (const n of g.nodes) {
      const visible = clipTo(n.rect, g.canvas)
      if (visible) expect(disjoint(g.count, visible), `disjoint from the visible part of ${n.id}`).toBe(true)
    }
    expect(g.occluded).toBe(false)
  })

  test('forced-colors: `evaluated` stays distinct from `effective` by shape, not colour (§LGR5.1 / §LGR9)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadRun(page)
    await commitOneStep(page)
    const head = await simHead(page)
    const evalTarget = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    const firedTarget = head.firedNodeIds[0]

    // `effective` is a full-silhouette <path> pulse (`.nodef__wave`, an SVG
    // stroke); `evaluated` is an open two-border corner bracket. Different
    // element, different shape — the distinction does not rely on colour.
    await expect(hasWave(page, firedTarget)).toHaveCount(1)
    await expect(hasEval(page, evalTarget)).toHaveCount(1)
    const waveTag = await hasWave(page, firedTarget).evaluate((el) => el.tagName.toLowerCase())
    expect(waveTag).toBe('path') // full outline
    const sh = await evalShape(page, evalTarget)
    expect(sh.left).toBe('solid')
    expect(sh.bottom).toBe('solid')
    expect(sh.top).toBe('none') // an OPEN bracket, not a closed ring
    expect(sh.right).toBe('none')
    expect(sh.radiusBL).not.toBe('0px')
  })
})

// docs/large-graph-readability.md §LGR6 — Slice 4a: group frames + the opt-in
// Activity overlay. Render / UI-only against the *engine*: no wire / node
// position / SimState / engine-digest change (§LGR8 / LGR-INV-1); the Activity
// overlay is session-only. NOTE (LGR Slice 5 / `SEMANTICS-R5.md`): a MANUAL
// frame's id / label / rect / color is now DOCUMENT content — create / rename /
// resize / recolour / delete each push ONE graph undo entry and persist; only
// a *pure* auto (suggested) frame stays session-only. A whole-graph swap to a
// frame-free doc still clears frames. `currentTargetDigest()` covers nodes /
// edges only, so it is unaffected by frames (that is the engine digest; the
// full `loop-revision/5` content digest is what carries them).

type FrameHead = { frames: { id: string; n: number; label: string; color?: string; rect: { x: number; y: number; w: number; h: number } }[]; toolArmed: boolean; selectedId: string | null }
const frameHead = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: { frame: { getState: () => FrameHead } } }).__loop.frame.getState()
    return { frames: s.frames.map((f) => ({ ...f })), toolArmed: s.toolArmed, selectedId: s.selectedId }
  })

const frameToolBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-frame')
const activityBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-activity')
const clearFramesBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-frame-clear')

/** drag on the pane from one node's centre-ish to another's, padded out, so the
 *  rect fully encloses the nodes between (a real mouse drag — not a synthetic
 *  event). Assumes the Frame tool is already armed. */
async function drawFrame(page: Page, fromId: string, toId: string, pad = 40) {
  const a = (await node(page, fromId).boundingBox())!
  const b = (await node(page, toId).boundingBox())!
  const x1 = Math.min(a.x, b.x) - pad
  const y1 = Math.min(a.y, b.y) - pad
  const x2 = Math.max(a.x + a.width, b.x + b.width) + pad
  const y2 = Math.max(a.y + a.height, b.y + b.height) + pad
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 })
  await page.mouse.move(x2, y2, { steps: 4 })
  await page.mouse.up()
}

// the ENGINE / structure digest — nodes + edges only, NEVER the saved `frames`
// (LGR Slice 5 / SEMANTICS-R5.md §R5-6: a manual frame is `loop-revision/5`
// cosmetic content, so it moves `revisionIO.currentTargetDigest()` — the full
// revision digest — but must never move this one). Slice 4a / 4b / FC assert a
// frame op leaves THIS untouched.
const gDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[]; edges: unknown[]; modelVersion: 1 | 2 } } } }).__loop.graph.getState()
    return M.digestOfCanonical(
      M.canonicalContent({ nodes: g.nodes as never, edges: g.edges as never }, { modelVersion: g.modelVersion }),
    )
  })

// A graph that exercises every Activity-overlay source in one committed step:
//   • `feed` fires every step                         → a `fired` NODE
//   • `rf` (feed → tank) carries flow                 → an `events` resource EDGE
//   • `act` (tank ⇢ feed, activator) emits each step  → a `stateEvents` state EDGE
//   • `rz` (feed → dead, flow 0) — incident to the fired `feed`, but its own
//     transfer is 0 and it is not a state edge        → the NEGATIVE boundary
//   • `dry0 → gate0 → sink0` never transfers; `gate0` is `activated`-not-`fired`
//                                                     → an `evaluated`-only NODE
const GRAPH_ACT = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'feed', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Feed', activation: 'automatic', mode: 'pushAny' } },
    { id: 'tank', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } },
    { id: 'use', type: 'drain', position: { x: 480, y: 0 }, data: { kind: 'drain', label: 'Use', activation: 'automatic', mode: 'pullAny' } },
    { id: 'dead', type: 'pool', position: { x: 240, y: 150 }, data: { kind: 'pool', label: 'Dead', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'dry0', type: 'pool', position: { x: 0, y: 300 }, data: { kind: 'pool', label: 'Dry', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'gate0', type: 'gate', position: { x: 240, y: 300 }, data: { kind: 'gate', label: 'Idle', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'sink0', type: 'drain', position: { x: 480, y: 300 }, data: { kind: 'drain', label: 'Waste', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'rf', type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'ru', type: 'loop', source: 'tank', target: 'use', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'rz', type: 'loop', source: 'feed', target: 'dead', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '0' } },
    { id: 'dg', type: 'loop', source: 'dry0', target: 'gate0', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'gs', type: 'loop', source: 'gate0', target: 'sink0', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'act', type: 'loop', source: 'tank', target: 'feed', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } },
  ],
})

async function loadAct(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    const w = window as unknown as { __loop: { ui: { setState: (p: object) => void } } }
    w.__loop.ui.setState({ focusMode: false, filterPanelOpen: false })
  })
  await importGraph(page, GRAPH_ACT)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await page.evaluate(() =>
    (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      { x: 120, y: 90, zoom: 1 },
      { duration: 0 },
    ),
  )
  await expect(edgePath(page, 'act')).toHaveCount(1)
}

test.describe('LGR Slice 4a — transient group frames', () => {
  test('draw a frame around some nodes — labelled, and the GraphDoc / digest / undo are untouched (§LGR10.8)', async ({ page }) => {
    await load(page)
    const before = await snapshot(page)
    const digestBefore = await gDigest(page)

    await frameToolBtn(page).click()
    await expect(frameToolBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await drawFrame(page, 'a', 'b')

    const fh = await frameHead(page)
    expect(fh.frames).toHaveLength(1)
    expect(fh.toolArmed, 'the tool is one-shot').toBe(false) // auto-disarmed
    expect(fh.frames[0].n).toBe(1)
    // default label `Group N` shows on the chip (empty stored value)
    await expect(page.locator('.lgr-frame__label').first()).toHaveText('Group 1')
    // it renders BEHIND the nodes and on its own layer
    await expect(page.locator('.lgr-frame-back .lgr-frame__fill')).toHaveCount(1)
    await expect(page.locator('.lgr-frame')).toHaveCount(1)

    const after = await snapshot(page)
    expect(after.graph).toBe(before.graph)
    expect(after.canUndo).toBe(before.canUndo)
    expect(await gDigest(page)).toBe(digestBefore)
  })

  test('a too-small drag, and a drag with no node inside, both make NO frame (§LGR6 answer)', async ({ page }) => {
    await load(page)
    const pane = page.locator('.react-flow__pane')
    const pb = (await pane.boundingBox())!

    // tiny drag
    await frameToolBtn(page).click()
    await page.mouse.move(pb.x + 300, pb.y + 200)
    await page.mouse.down()
    await page.mouse.move(pb.x + 320, pb.y + 215, { steps: 3 })
    await page.mouse.up()
    expect((await frameHead(page)).frames).toHaveLength(0)
    expect((await frameHead(page)).toolArmed, 'a failed draw disarms the tool').toBe(false)

    // big drag over empty canvas (no node fully inside)
    await frameToolBtn(page).click()
    await page.mouse.move(pb.x + 8, pb.y + pb.height - 8)
    await page.mouse.down()
    await page.mouse.move(pb.x + 120, pb.y + pb.height - 120, { steps: 4 })
    await page.mouse.up()
    expect((await frameHead(page)).frames).toHaveLength(0)
  })

  test('a drag that STARTS on a node is a normal node interaction, not a frame draw', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    const nb = (await node(page, 'b').boundingBox())!
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2)
    await page.mouse.down()
    await page.mouse.move(nb.x + nb.width / 2 + 80, nb.y + nb.height / 2 + 60, { steps: 4 })
    await page.mouse.up()
    // no frame; the node still selected / moved as usual (position may change —
    // that's the node drag, nothing to do with frames)
    expect((await frameHead(page)).frames).toHaveLength(0)
  })

  test('direction-agnostic — a right-to-left / bottom-to-top drag makes the same frame', async ({ page }) => {
    await load(page)
    const a = (await node(page, 'a').boundingBox())!
    const b = (await node(page, 'b').boundingBox())!
    const x1 = Math.min(a.x, b.x) - 40
    const y1 = Math.min(a.y, b.y) - 40
    const x2 = Math.max(a.x + a.width, b.x + b.width) + 40
    const y2 = Math.max(a.y + a.height, b.y + b.height) + 40
    await frameToolBtn(page).click()
    await page.mouse.move(x2, y2) // start bottom-right
    await page.mouse.down()
    await page.mouse.move(x1, y1, { steps: 6 }) // drag up-left
    await page.mouse.up()
    const r = (await frameHead(page)).frames[0].rect
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
  })

  test('no membership — moving a node out of the frame leaves the frame exactly where it is (LGR-D9)', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'a', 60) // a small frame around just `a`
    const r0 = (await frameHead(page)).frames[0].rect
    // drag `a` far away
    const nb = (await node(page, 'a').boundingBox())!
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2)
    await page.mouse.down()
    await page.mouse.move(nb.x + 400, nb.y + 250, { steps: 6 })
    await page.mouse.up()
    const r1 = (await frameHead(page)).frames[0].rect
    expect(r1).toEqual(r0) // frame did not react to the node leaving
    expect((await frameHead(page)).frames).toHaveLength(1)
  })

  test('a node inside a frame is still selectable; the border selects the frame; the interior click clears it', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'c', 50) // wide frame over a, b, c

    // the node still selects
    await node(page, 'b').click()
    expect(await selection(page)).toMatchObject({ node: 'b' })

    // the top border hit-strip selects the frame
    const strip = page.locator('.lgr-frame__edge-hit--top').first()
    await strip.click({ position: { x: 10, y: 6 } })
    expect((await frameHead(page)).selectedId).not.toBeNull()

    // a click on a genuinely empty patch of canvas (outside every node, inside
    // the frame) goes to the pane → the frame deselects
    const fr = (await page.locator('.lgr-frame').first().boundingBox())!
    await page.mouse.click(fr.x + fr.width - 12, fr.y + 12) // top-right interior corner
    expect((await frameHead(page)).selectedId).toBeNull()
  })

  test('select → resize handle resizes; delete ✕ removes; Clear frames removes all', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'b')
    // select via border
    await page.locator('.lgr-frame__edge-hit--left').first().click({ position: { x: 6, y: 20 } })
    await expect(page.locator('.lgr-frame__resize')).toHaveCount(1)

    const r0 = (await frameHead(page)).frames[0].rect
    const rh = (await page.locator('.lgr-frame__resize').boundingBox())!
    await page.mouse.move(rh.x + 6, rh.y + 6)
    await page.mouse.down()
    await page.mouse.move(rh.x + 90, rh.y + 70, { steps: 5 })
    await page.mouse.up()
    const r1 = (await frameHead(page)).frames[0].rect
    expect(r1.w).toBeGreaterThan(r0.w)
    expect(r1.h).toBeGreaterThan(r0.h)
    expect({ x: r1.x, y: r1.y }).toEqual({ x: r0.x, y: r0.y }) // top-left pinned

    await page.locator('.lgr-frame__del').click()
    expect((await frameHead(page)).frames).toHaveLength(0)

    // two more, then Clear frames
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'a', 40)
    await frameToolBtn(page).click()
    await drawFrame(page, 'c', 'c', 40)
    expect((await frameHead(page)).frames).toHaveLength(2)
    await clearFramesBtn(page).click()
    expect((await frameHead(page)).frames).toHaveLength(0)
    await expect(clearFramesBtn(page)).toHaveCount(0) // the button hides with no frames
  })

  test('labels — rename, empty ⇒ default, duplicates ok, deleted number not reused; a graph swap clears frames + resets the counter', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'a', 40)
    await frameToolBtn(page).click()
    await drawFrame(page, 'b', 'b', 40)

    // rename #1 → "Loop"
    await page.locator('.lgr-frame__label').first().click()
    await page.locator('.lgr-frame__label--edit').fill('  Loop  ')
    await page.keyboard.press('Enter')
    expect((await frameHead(page)).frames[0].label).toBe('Loop') // trimmed

    // rename #2 → "Loop" too (duplicates allowed)
    await page.locator('.lgr-frame__label').nth(1).click()
    await page.locator('.lgr-frame__label--edit').fill('Loop')
    await page.keyboard.press('Enter')
    expect((await frameHead(page)).frames.map((f) => f.label)).toEqual(['Loop', 'Loop'])

    // empty rename on #1 ⇒ falls back to its default
    await page.locator('.lgr-frame__label').first().click()
    await page.locator('.lgr-frame__label--edit').fill('')
    await page.keyboard.press('Enter')
    expect((await frameHead(page)).frames[0].label).toBe('')
    await expect(page.locator('.lgr-frame__label').first()).toHaveText('Group 1')

    // delete #1, add another ⇒ the new one is "Group 3" (1 is not reused)
    await page.locator('.lgr-frame__edge-hit--top').first().click({ position: { x: 8, y: 6 } })
    await page.locator('.lgr-frame__del').click()
    await frameToolBtn(page).click()
    await drawFrame(page, 'c', 'c', 40)
    const ns = (await frameHead(page)).frames.map((f) => f.n)
    expect(ns).toEqual([2, 3])

    // a language switch does NOT re-translate an existing label
    await page.evaluate(() =>
      (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n
        .getState()
        .setLocale('ko'),
    )
    expect((await frameHead(page)).frames.find((f) => f.label === 'Loop')).toBeTruthy()

    // re-import the graph (whole-graph swap) ⇒ every frame gone, counter back to 1
    await importGraph(page, GRAPH)
    expect((await frameHead(page)).frames).toEqual([])
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'a', 40)
    expect((await frameHead(page)).frames[0].n).toBe(1)
  })

  test('overlap + z — a frame drawn later sits on top of an earlier one; a click in the overlap still reaches the node', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'c', 60) // big
    await frameToolBtn(page).click()
    await drawFrame(page, 'b', 'b', 30) // small, inside the big one

    const chrome = page.locator('.lgr-frame')
    await expect(chrome).toHaveCount(2)
    // later frame is later in the DOM (paints on top)
    const order = await chrome.evaluateAll((els) => els.map((e) => e.querySelector('.lgr-frame__label')?.textContent))
    expect(order).toEqual(['Group 1', 'Group 2'])

    // a click on `b` (in the overlap of both frames) still selects the node
    await node(page, 'b').click()
    expect(await selection(page)).toMatchObject({ node: 'b' })
  })

  test('survives sim Reset and Reset view; a graph swap drops it; render-only across a run', async ({ page }) => {
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'b')
    expect((await frameHead(page)).frames).toHaveLength(1)

    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    expect((await frameHead(page)).frames, 'kept across sim Reset').toHaveLength(1)

    await resetViewBtn(page).click()
    expect((await frameHead(page)).frames, 'kept across Reset view').toHaveLength(1)

    const digestBefore = await gDigest(page)
    await importGraph(page, GRAPH)
    expect((await frameHead(page)).frames, 'dropped on a whole-graph swap').toHaveLength(0)
    // and the digest of an identical graph is unchanged by having had a frame
    await expect.poll(() => gDigest(page)).toBe(digestBefore)
  })

  test('forced-colors — a frame border keeps a non-colour tell', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    await frameToolBtn(page).click()
    await drawFrame(page, 'a', 'b')
    const stroke = await page
      .locator('.lgr-frame__fill')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return { stroke: s.stroke, width: parseFloat(s.strokeWidth) }
      })
    expect(stroke.stroke).not.toBe('none')
    expect(stroke.width).toBeGreaterThan(0)
  })
})

test.describe('LGR Slice 4a — the opt-in Activity overlay', () => {
  test('off by default; the toggle persists and survives sim Reset', async ({ page }) => {
    await load(page)
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:activity-overlay'))).not.toBe('1')

    await activityBtn(page).click()
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:activity-overlay'))).toBe('1')

    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    await expect(activityBtn(page), 'toggle survives Reset').toHaveAttribute('aria-pressed', 'true')
  })

  test('with the overlay ON, stepping tints the parts that were `effective`; sim Reset clears the tint but keeps the toggle; a graph reload clears it', async ({ page }) => {
    await loadRun(page)
    await activityBtn(page).click()
    for (let i = 0; i < 3; i++) await commitOneStep(page)

    const head = await simHead(page)
    // a node that fired ⇒ its silhouette carries a `.nodef__activity` <path>
    // with a positive opacity (a shape tint, NOT a rectangle on the wrapper).
    const firedId = head.firedNodeIds[0]
    const firedTint = node(page, firedId).locator('.nodef__activity')
    await expect(firedTint).toHaveCount(1)
    expect(
      Number(await firedTint.evaluate((el) => getComputedStyle(el).opacity)),
    ).toBeGreaterThan(0)

    // an evaluated-but-not-fired node ⇒ NO tint (activity is `effective`-only)
    const evalOnly = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    await expect(node(page, evalOnly).locator('.nodef__activity')).toHaveCount(0)
    // a fully idle node ⇒ no tint
    await expect(node(page, 'iso').locator('.nodef__activity')).toHaveCount(0)

    // AND the edges: `e_feed` carries flow every step (in StepReport.events) ⇒
    // its <path> gets the tint class + a positive --lgr-activity. React Flow
    // hands the edge object's style to the component, not the wrapper, so this
    // proves LoopEdge applies the tint itself. `e_dg` is on the dead `dry`
    // branch (no transfer) ⇒ no tint.
    const activeEdgePath = page.locator('.react-flow__edge[data-id="e_feed"] .react-flow__edge-path')
    await expect(activeEdgePath).toHaveClass(/lgr-active-tint/)
    expect(
      Number(await activeEdgePath.evaluate((el) => getComputedStyle(el).getPropertyValue('--lgr-activity').trim())),
    ).toBeGreaterThan(0)
    await expect(
      page.locator('.react-flow__edge[data-id="e_dg"] .react-flow__edge-path'),
    ).not.toHaveClass(/lgr-active-tint/)

    const anyTint = () => page.locator('.nodef__activity, .react-flow__edge-path.lgr-active-tint')

    // sim Reset empties the accumulated tint, toggle stays on
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    await expect(anyTint()).toHaveCount(0)
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')

    // a graph reload also clears it
    await commitOneStep(page)
    expect(await anyTint().count()).toBeGreaterThan(0)
    await importGraph(page, GRAPH_RUN)
    await expect(anyTint()).toHaveCount(0)
  })

  test('a state-event edge gets the tint too; a fired-neighbour edge with no event of its own does NOT (§LGR5.1)', async ({ page }) => {
    await loadAct(page)
    await activityBtn(page).click()
    for (let i = 0; i < 3; i++) await commitOneStep(page)

    // sanity: what the engine actually reported this step
    const rep = await page.evaluate(() => {
      const s = (window as unknown as { __loop: { sim: { getState: () => { firedNodeIds: string[]; activeByEdge: Record<string, number>; stateEvents: { edgeId: string }[] } } } }).__loop.sim.getState()
      return { fired: [...s.firedNodeIds], eventEdges: Object.keys(s.activeByEdge), stateEdges: s.stateEvents.map((e) => e.edgeId) }
    })
    expect(rep.fired).toContain('feed')
    expect(rep.eventEdges).toContain('rf')
    expect(rep.stateEdges).toContain('act') // the activator edge emits every step
    expect(rep.eventEdges).not.toContain('rz')

    const tintClass = (id: string) => edgePath(page, id).evaluate((el) => el.classList.contains('lgr-active-tint'))
    // a resource edge that carried flow ⇒ tinted
    expect(await tintClass('rf')).toBe(true)
    // a STATE edge that appeared in StepReport.stateEvents ⇒ tinted (same path)
    expect(await tintClass('act')).toBe(true)
    expect(
      Number(await edgePath(page, 'act').evaluate((el) => getComputedStyle(el).getPropertyValue('--lgr-activity').trim())),
    ).toBeGreaterThan(0)
    // `rz` touches the fired `feed` but carried 0 and is not a state edge ⇒ NO tint
    expect(await tintClass('rz')).toBe(false)
    // the dead evaluated-only branch ⇒ NO tint, on the edge OR the gate node
    expect(await tintClass('dg')).toBe(false)
    await expect(node(page, 'gate0').locator('.nodef__activity')).toHaveCount(0)
  })

  test('pause holds the tint; a normal end holds it; only Reset clears it — the toggle survives all three (§LGR6-cues)', async ({ page }) => {
    const anyTint = () => page.locator('.nodef__activity, .react-flow__edge-path.lgr-active-tint')
    const historyLen = () =>
      page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { activitySteps: string[][] } } } }).__loop.sim.getState().activitySteps.length)

    // ── pause ──────────────────────────────────────────────────────────────
    await loadRun(page)
    await activityBtn(page).click()
    for (let i = 0; i < 2; i++) await commitOneStep(page)
    expect(await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { status: string } } } }).__loop.sim.getState().status)).toBe('paused')
    expect(await historyLen()).toBeGreaterThan(0)
    expect(await anyTint().count()).toBeGreaterThan(0)
    // more idle time at `paused` — still held
    await page.waitForTimeout(200)
    expect(await historyLen()).toBeGreaterThan(0)
    expect(await anyTint().count()).toBeGreaterThan(0)

    // ── a normal end ──────────────────────────────────────────────────────
    await importGraph(page, GRAPH_END) // fresh graph clears history…
    await expect(anyTint()).toHaveCount(0)
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true') // …toggle kept
    await commitOneStep(page)
    expect(await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { status: string } } } }).__loop.sim.getState().status)).toBe('ended')
    const endHistory = await historyLen()
    expect(endHistory).toBeGreaterThan(0)
    expect(await anyTint().count()).toBeGreaterThan(0)
    // still `ended`, still held after idle time
    await page.waitForTimeout(200)
    expect(await historyLen()).toBe(endHistory)
    expect(await anyTint().count()).toBeGreaterThan(0)

    // ── only Reset clears it ──────────────────────────────────────────────
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    expect(await historyLen()).toBe(0)
    await expect(anyTint()).toHaveCount(0)
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
  })

  test('forced-colors: an active node = a dashed SHAPE outline, an active edge = a dashed stroke; the run cues still sit on top (§LGR6-cues / §LGR9)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadRun(page)
    await activityBtn(page).click()
    for (let i = 0; i < 2; i++) await commitOneStep(page)
    const head = await simHead(page)

    // an active NODE: `.nodef__activity` becomes a dashed stroked outline of the
    // silhouette (no coloured fill) — a non-colour tell.
    const firedTint = node(page, head.firedNodeIds[0]).locator('.nodef__activity')
    await expect(firedTint).toHaveCount(1)
    const nf = await firedTint.evaluate((el) => {
      const s = getComputedStyle(el)
      return { fill: s.fill, stroke: s.stroke, dash: s.strokeDasharray, tag: el.tagName.toLowerCase() }
    })
    expect(nf.tag).toBe('path') // the shape, not a rectangle
    expect(nf.fill).toBe('none')
    expect(nf.dash).not.toBe('none')
    expect(nf.dash.trim().length).toBeGreaterThan(0)

    // an active resource EDGE path: a dashed stroke under the UA override
    const ep = await edgePath(page, 'e_feed').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(ep).not.toBe('none')
    expect(ep.trim().length).toBeGreaterThan(0)

    // the required set stays ABOVE the tint: on a fired node the effective pulse
    // is still present; on an evaluated-only node the Slice-3 bracket is still
    // present and that node has NO activity tint.
    await expect(hasWave(page, head.firedNodeIds[0])).toHaveCount(1)
    const evalOnly = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    await expect(hasEval(page, evalOnly)).toHaveCount(1)
    await expect(node(page, evalOnly).locator('.nodef__activity')).toHaveCount(0)
    // DOM order proof: the tint <path> precedes the stroke + every cue in the svg
    const order = await node(page, head.firedNodeIds[0]).evaluate((n) => {
      const kids = [...n.querySelectorAll('.nodef__shape > *')].map((k) => k.getAttribute('class'))
      return { act: kids.findIndex((c) => c?.includes('nodef__activity')), stroke: kids.findIndex((c) => c?.includes('nodef__stroke')) }
    })
    expect(order.act).toBeGreaterThanOrEqual(0)
    expect(order.act).toBeLessThan(order.stroke)
  })

  test('reduced-motion: the activity tint has no transition or animation (§LGR6-cues)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await loadRun(page)
    await activityBtn(page).click()
    for (let i = 0; i < 2; i++) await commitOneStep(page)
    const head = await simHead(page)

    const nodeMotion = await node(page, head.firedNodeIds[0])
      .locator('.nodef__activity')
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return { td: s.transitionDuration, an: s.animationName }
      })
    expect(nodeMotion.td).toMatch(/^0s(,\s*0s)*$/)
    expect(nodeMotion.an).toBe('none')

    const edgeMotion = await edgePath(page, 'e_feed').evaluate((el) => {
      const s = getComputedStyle(el)
      return { td: s.transitionDuration, an: s.animationName }
    })
    expect(edgeMotion.td).toMatch(/^0s(,\s*0s)*$/)
    expect(edgeMotion.an).toBe('none')
  })

  test('VISUAL — frames-activity.png: overlapping frames (one selected), real nodes/edges inside, a tinted fired node + resource + state-event edge tint, an evaluated-only node with only the Slice-3 bracket (minimap hidden)', async ({ page }) => {
    await loadAct(page)
    await page.addStyleTag({
      content: '.react-flow__minimap,.react-flow__attribution{display:none!important}',
    })
    // a dedicated viewport so both frame labels clear the left control column
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: 220, y: 70, zoom: 0.9 },
        { duration: 0 },
      ),
    )
    await activityBtn(page).click()
    for (let i = 0; i < 3; i++) await commitOneStep(page)

    // two partly-overlapping frames via real pointer drags (the tool is one-shot):
    // one across the top row, one running top→bottom that clips its right side
    await frameToolBtn(page).click()
    await drawFrame(page, 'feed', 'tank', 26)
    await frameToolBtn(page).click()
    await drawFrame(page, 'tank', 'gate0', 20)
    const fh = await frameHead(page)
    expect(fh.frames.length).toBe(2)
    // select the FIRST-drawn (earlier paint order) so its resize handle shows
    await page.evaluate((id) =>
      (window as unknown as { __loop: { frame: { getState: () => { selectFrame: (i: string) => void } } } }).__loop.frame.getState().selectFrame(id),
      fh.frames[0].id,
    )
    await expect(page.locator('.lgr-frame.is-selected .lgr-frame__resize')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__label')).toHaveCount(2)
    // the tints are actually on screen for the baseline to capture
    await expect(node(page, 'feed').locator('.nodef__activity')).toHaveCount(1)
    await expect(edgePath(page, 'rf')).toHaveClass(/lgr-active-tint/)
    await expect(edgePath(page, 'act')).toHaveClass(/lgr-active-tint/)
    await expect(hasEval(page, 'gate0')).toHaveCount(1)
    await expect(node(page, 'gate0').locator('.nodef__activity')).toHaveCount(0)
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)

    await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'frames-activity'))
  })
})

// §LGR9 forced-colors — measured 2026-09-19 (activity-overlay contrast audit):
//   1. every rail toggle's pressed tell was an `outline`, the same property the
//      keyboard focus ring uses, so a PRESSED button's focus ring was pixel-
//      identical to its pressed state. The pressed tell is now the system
//      `Highlight` / `HighlightText` pair and `outline` belongs to
//      `:focus-visible` alone.
//   2. the edge tint's `drop-shadow` is not dropped by a UA colour override and
//      its halo filled the `1 3` dash gaps on dense graphs (mmo: canvas-coloured
//      samples along an active edge fell from 14–18 to 4–9). Under forced
//      colours the dashes are the tell, so `filter: none`.
test.describe('§LGR9 forced-colors — rail toggles keep a visible keyboard focus when pressed; the activity edge tell stays dashed', () => {
  test.use({ contextOptions: { forcedColors: 'active' } })

  const RAIL = ['rf-focus', 'rf-filter', 'rf-frame', 'rf-activity'] as const
  const railBtn = (page: Page, cls: string) => page.locator(`.react-flow__controls-button.${cls}`)
  const styleOf = (page: Page, cls: string) =>
    railBtn(page, cls).evaluate((el) => {
      const c = getComputedStyle(el)
      return {
        background: c.backgroundColor,
        color: c.color,
        outlineStyle: c.outlineStyle,
        outlineWidth: c.outlineWidth,
        pressed: el.getAttribute('aria-pressed'),
        focusVisible: el.matches(':focus-visible'),
      }
    })
  /** keyboard focus (so :focus-visible applies): focus the previous rail button by script, then Tab */
  const keyboardFocus = async (page: Page, cls: string) => {
    await page.evaluate((c) => {
      const b = document.querySelector(`.react-flow__controls-button.${c}`)!
      const prev = b.previousElementSibling as HTMLElement | null
      ;(prev ?? (b as HTMLElement)).focus()
    }, cls)
    await page.keyboard.press('Tab')
    await expect(railBtn(page, cls)).toBeFocused()
  }
  const dropFocus = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  /** the button plus 6 px around it — a focus ring drawn OUTSIDE the box must be in the picture */
  const shot = async (page: Page, cls: string) => {
    const b = (await railBtn(page, cls).boundingBox())!
    return page.screenshot({ clip: { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12 } })
  }

  for (const cls of RAIL) {
    test(`${cls}: off / focus / pressed / pressed+focus — pressed is Highlight/HighlightText with NO outline, focus keeps its outline, and all four render differently`, async ({ page }) => {
      await load(page)
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'forced colours really emulated').toBe(true)
      const styles: Record<string, Awaited<ReturnType<typeof styleOf>>> = {}
      const shots: Record<string, Buffer> = {}

      styles.off = await styleOf(page, cls)
      shots.off = await shot(page, cls)

      await keyboardFocus(page, cls)
      styles.focus = await styleOf(page, cls)
      shots.focus = await shot(page, cls)
      await dropFocus(page)

      await railBtn(page, cls).click() // a mouse press: pressed, focused but NOT :focus-visible
      await expect(railBtn(page, cls)).toHaveAttribute('aria-pressed', 'true')
      await dropFocus(page)
      // the pointer still rests on the button after the click — the pressed tell
      // must already hold there (the `:hover` variant of the normal rule outranks a
      // plain forced-colors rule; see index.css)
      styles.pressedHover = await styleOf(page, cls)
      await page.mouse.move(640, 700) // off the rail, onto empty pane
      styles.pressed = await styleOf(page, cls)
      shots.pressed = await shot(page, cls)

      await keyboardFocus(page, cls)
      styles.pressedFocus = await styleOf(page, cls)
      shots.pressedFocus = await shot(page, cls)

      // computed-style contract
      expect(styles.off.pressed).toBe('false')
      expect(styles.focus.focusVisible, 'keyboard focus is :focus-visible').toBe(true)
      expect(styles.pressedFocus.focusVisible).toBe(true)
      expect(styles.pressed.focusVisible).toBe(false)
      expect(styles.pressed.background, 'pressed = system Highlight').not.toBe(styles.off.background)
      expect(styles.pressed.color, 'pressed text/icon = HighlightText').not.toBe(styles.off.color)
      expect(styles.pressed.outlineStyle, 'pressed does NOT use the outline').toBe('none')
      expect(styles.focus.outlineStyle, 'focus ring is an outline').not.toBe('none')
      expect(styles.pressedFocus.outlineStyle, 'the outline survives on a pressed button').not.toBe('none')
      expect(styles.pressedFocus.outlineWidth).toBe(styles.focus.outlineWidth)
      expect(styles.pressedFocus.background).toBe(styles.pressed.background)
      expect(styles.pressedHover.background, 'pressed keeps its tell while hovered').toBe(styles.pressed.background)
      expect(styles.pressedHover.color).toBe(styles.pressed.color)

      // rendered pixels: the four states are four different pictures — in particular
      // pressed vs pressed+focus, which used to be byte-identical
      const names = Object.keys(shots)
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++)
          expect(shots[names[i]].equals(shots[names[j]]), `${names[i]} and ${names[j]} render differently`).toBe(false)
    })
  }

  /** screen-space sample points ON the edge path: 48 points at 1 px spacing around the point at `frac` of its length */
  const pathSamples = (page: Page, edgeId: string, frac: number) =>
    page.evaluate(({ id, frac }) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`) as SVGPathElement
      const L = p.getTotalLength()
      const svg = p.ownerSVGElement!
      const ctm = p.getScreenCTM()!
      const scale = Math.hypot(ctm.a, ctm.b) || 1 // flow px → screen px
      const pts: { x: number; y: number }[] = []
      for (let k = -24; k < 24; k++) {
        const pt = p.getPointAtLength(Math.max(0, Math.min(L, L * frac + k / scale)))
        const q = svg.createSVGPoint()
        q.x = pt.x
        q.y = pt.y
        const sp = q.matrixTransform(ctm)
        pts.push({ x: sp.x, y: sp.y })
      }
      return pts
    }, { id: edgeId, frac })
  /** mean ink coverage of the sample points in a page screenshot — 0 = every
   *  sample is the canvas colour, 1 = every sample is fully dark. Decoded
   *  in-page on a <canvas>; the canvas colour is read from the rendered pixels
   *  (under forced colours the computed background is not what is painted). */
  const inkCoverage = (page: Page, png: Buffer, pts: { x: number; y: number }[], band: 'path' | 'halo') =>
    page.evaluate(
      async ({ b64, pts, band }) => {
        const im = new Image()
        im.src = `data:image/png;base64,${b64}`
        await im.decode()
        const c = document.createElement('canvas')
        c.width = im.width
        c.height = im.height
        const ctx = c.getContext('2d')!
        ctx.drawImage(im, 0, 0)
        const lum = (d: Uint8ClampedArray) => {
          const ch = (v: number) => {
            v /= 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * ch(d[0]) + 0.7152 * ch(d[1]) + 0.0722 * ch(d[2])
        }
        const rf = (document.querySelector('.react-flow') as HTMLElement).getBoundingClientRect()
        const lbg = lum(ctx.getImageData(Math.round(rf.right - 12), Math.round(rf.top + 12), 1, 1).data)
        const inkAt = (x: number, y: number) => {
          const l = lum(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data)
          return Math.max(0, Math.min(1, (lbg - l) / (lbg + 0.05)))
        }
        let sum = 0
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)]
          const b = pts[Math.min(pts.length - 1, i + 1)]
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const nx = -(b.y - a.y) / len
          const ny = (b.x - a.x) / len
          if (band === 'path') {
            // the stroke itself: the darkest pixel within ±2 px of the path
            let best = 0
            for (let o = -2; o <= 2; o++) best = Math.max(best, inkAt(pts[i].x + nx * o, pts[i].y + ny * o))
            sum += best
          } else {
            // the halo band: 3–6 px either side of the path, where only a blurred
            // drop-shadow could put ink (mean of the eight offsets)
            let acc = 0
            for (const o of [-6, -5, -4, -3, 3, 4, 5, 6]) acc += inkAt(pts[i].x + nx * o, pts[i].y + ny * o)
            sum += acc / 8
          }
        }
        return sum / pts.length
      },
      { b64: png.toString('base64'), pts, band },
    )

  for (const [name, file, edgeIds] of [
    ['coffee-roastery', 'coffee-roastery.json', ['e_green_in', 'e_green_wholesale', 'e_green_roast']],
    ['mmo-progression', 'mmo-progression.json', ['e_water_up', 'e_water_up_ct', 'e_food_up']],
  ] as const) {
    test(`${name}: an active edge's tell is the dashes — computed filter is none, and the dash gaps are not filled in by a halo`, async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await importGraph(page, readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'))
      await expect(page.locator('.react-flow__node').first()).toBeVisible()
      await page.evaluate(() =>
        (window as unknown as { __loop: { rf: { fitView: (o: object) => void } } }).__loop.rf.fitView({ duration: 0, padding: 0.1 }),
      )
      await page.waitForTimeout(300)
      for (let i = 0; i < 10; i++) await commitOneStep(page)
      await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
      // overlay OFF: the plain strokes. An edge may run under a node or a label for
      // part of its length, so per edge pick the stretch (of seven candidates) where
      // the plain stroke is most visible — the ON comparison uses the SAME points.
      const offPng = await page.screenshot()
      const pts: Record<string, { x: number; y: number }[]> = {}
      const inkOffs: Record<string, number> = {}
      for (const id of edgeIds) {
        let best: { ink: number; pts: { x: number; y: number }[] } | null = null
        for (const frac of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) {
          const cand = await pathSamples(page, id, frac)
          const ink = await inkCoverage(page, offPng, cand, 'path')
          if (!best || ink > best.ink) best = { ink, pts: cand }
        }
        pts[id] = best!.pts
        inkOffs[id] = best!.ink
      }
      // overlay ON: the same edges now carry the tell
      await activityBtn(page).click()
      await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
      for (const id of edgeIds) await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/)
      await page.waitForTimeout(200)
      const onPng = await page.screenshot()
      for (const id of edgeIds) {
        const st = await edgePath(page, id).evaluate((el) => {
          const c = getComputedStyle(el)
          return { filter: c.filter, dash: c.strokeDasharray }
        })
        expect(st.filter, `${id}: no halo under forced colours`).toBe('none')
        // the pattern itself (dash-dot, butt) and the Highlight stroke are
        // pinned in forced-colors-edge-tell.spec.ts, with a 2-D dash count at
        // zoom 0.4 / 0.75; here only the halo contract remains
        expect(st.dash, `${id}: the resource tell`).toBe('6px, 3px, 2px, 3px')
        const inkOff = inkOffs[id]
        const inkOn = await inkCoverage(page, onPng, pts[id], 'path')
        expect(inkOff, `${id}: a visible stretch of the plain stroke was found`).toBeGreaterThan(0.3)
        // With the Highlight stroke the active edge is legitimately DARKER than
        // the grey plain edge, so the old "nothing painted back in" ratio no
        // longer applies; the halo's absence is the computed `filter: none`
        // above. The edge must still be drawn.
        expect(inkOn, `${id}: the dashed edge is still drawn`).toBeGreaterThan(0.05)
      }
    })
  }
})

// PR #142 — a dense/dark graph compounds the Activity edge glow's opaque
// drop-shadow into a wash at hub nodes (many simultaneously-active edges
// converging). Fixed by attenuating ONLY the glow's colour in dark theme via
// a dedicated --activity-edge-glow token; light theme, the 26px blur-radius
// factor, and the whole activity-frequency calculation (frameGeom.ts) are
// untouched by design. This locks the token contract with computed-style
// checks (screenshots don't cover this — the fixtures above run light-theme
// only, which is deliberately a no-op under this change).
test.describe('Activity overlay edge glow — dark-only attenuation contract (§LGR6-cues, PR #142)', () => {
  const resolvedColor = (page: Page, cssValue: string) =>
    page.evaluate((v) => {
      const el = document.createElement('div')
      el.style.color = v
      document.body.appendChild(el)
      const c = getComputedStyle(el).color
      el.remove()
      return c
    }, cssValue)

  test('light theme: --activity-edge-glow resolves to the same colour as --signal-primary (unchanged, opaque)', async ({ page }) => {
    await load(page)
    const [glow, signal] = await Promise.all([
      resolvedColor(page, 'var(--activity-edge-glow)'),
      resolvedColor(page, 'var(--signal-primary)'),
    ])
    expect(glow).toBe(signal)
  })

  test('dark theme: --activity-edge-glow is the attenuated rgba(118, 183, 174, 0.35) — distinct from the opaque --signal-primary', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await load(page)
    const [glow, signal] = await Promise.all([
      resolvedColor(page, 'var(--activity-edge-glow)'),
      resolvedColor(page, 'var(--signal-primary)'),
    ])
    expect(glow).toBe('rgba(118, 183, 174, 0.35)')
    expect(glow).not.toBe(signal)
  })

  test('the drop-shadow blur radius still scales at the 26px factor, unchanged in both themes', async ({ page }) => {
    const radiusAt = (activity: number) =>
      page.evaluate((a) => {
        const el = document.createElement('div')
        el.className = 'react-flow__edge-path lgr-active-tint'
        el.style.setProperty('--lgr-activity', String(a))
        document.body.appendChild(el)
        const filter = getComputedStyle(el).filter
        el.remove()
        const matches = filter.match(/([\d.]+)px/g) ?? []
        return matches.length ? parseFloat(matches[matches.length - 1]) : NaN
      }, activity)

    await load(page)
    expect(await radiusAt(0.1)).toBeCloseTo(2.6, 2)
    expect(await radiusAt(0.15)).toBeCloseTo(3.9, 2)

    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await radiusAt(0.1)).toBeCloseTo(2.6, 2)
    expect(await radiusAt(0.15)).toBeCloseTo(3.9, 2)
  })

  test('a real active edge in dark theme carries the attenuated glow colour end to end', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await loadAct(page)
    await activityBtn(page).click()
    await commitOneStep(page)
    const rf = edgePath(page, 'rf')
    await expect(rf).toHaveClass(/lgr-active-tint/)
    const filter = await rf.evaluate((el) => getComputedStyle(el).filter)
    expect(filter).toContain('rgba(118, 183, 174, 0.35)')
  })
})

test.describe('LGR Slice 4a — a Filter that hides a frame’s nodes leaves the frame alone', () => {
  test('hide every node in a frame → the frame + label stay, rect + count unchanged; clearing the filter brings the nodes back and never recomputed the frame', async ({ page }) => {
    await loadRT(page)
    // draw a frame around `gold` (currency) — its own creation guard needs a
    // fully-contained node; after that the frame is a pure rectangle.
    await frameToolBtn(page).click()
    await drawFrame(page, 'gold', 'gold', 46)
    const before = await frameHead(page)
    expect(before.frames.length).toBe(1)
    const rect0 = before.frames[0].rect

    // hide the `currency` resource type → `gold` (and its incident edges) go
    await filterBtn(page).click()
    await filterRow(page, 'currency').check()
    await expect(node(page, 'gold')).toHaveCount(0)

    // the frame + its label are untouched
    await expect(page.locator('.lgr-frame')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__label')).toHaveCount(1)
    const during = await frameHead(page)
    expect(during.frames.length).toBe(1)
    expect(during.frames[0].rect).toEqual(rect0) // no recompute / resize
    expect(during.frames[0].id).toBe(before.frames[0].id)

    // clear the filter → the node returns; the frame still hasn't moved
    await filterRow(page, 'currency').uncheck()
    await expect(node(page, 'gold')).toBeVisible()
    const after = await frameHead(page)
    expect(after.frames.length).toBe(1)
    expect(after.frames[0].rect).toEqual(rect0)
  })
})

test.describe('LGR Slice 4a — mobile (the More sheet)', () => {
  test('no frame / activity canvas control on mobile; a seeded frame still renders; the More sheet toggles the overlay (sticky) and offers NO row that deletes a saved frame (D6)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await loadRun(page)

    // §LGR9 — frame drawing + the activity toggle are NOT canvas controls on mobile
    await expect(frameToolBtn(page)).toHaveCount(0)
    await expect(activityBtn(page)).toHaveCount(0)
    await expect(clearFramesBtn(page)).toHaveCount(0)

    // an existing (session) frame still RENDERS on the mobile canvas
    await page.evaluate(() =>
      (window as unknown as { __loop: { frame: { getState: () => { addFrame: (r: object) => string } } } }).__loop.frame
        .getState()
        .addFrame({ x: 0, y: 0, w: 220, h: 130 }),
    )
    await expect(page.locator('.lgr-frame')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__label')).toHaveCount(1)

    const more = () => page.locator('.mob-more')
    const sheetRow = (re: RegExp) => page.locator('.sheet__row').filter({ hasText: re })

    // Activity overlay row — visible, toggles, and the preference is sticky
    await more().click()
    const actRow = sheetRow(/Activity overlay/)
    await expect(actRow).toBeVisible()
    const actToggle = actRow.locator('button')
    await expect(actToggle).toHaveAttribute('aria-pressed', 'false')
    await actToggle.click()
    await expect(actToggle).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:activity-overlay'))).toBe('1')

    // D6 (2026-09-20) — a saved frame on mobile is view + select only, so the
    // sheet has NO row that deletes one: no "Clear all frames" even though a
    // manual frame exists (only the session-only "Clear suggested frames" row
    // can appear, and only when auto frames exist)
    await expect(sheetRow(/Clear all frames/)).toHaveCount(0)
    await expect(sheetRow(/Clear suggested frames/)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.lgr-frame')).toHaveCount(1)
    // the frame is not editable either: static label, no ✕ / resize
    await expect(page.locator('.lgr-frame__label--static')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__del')).toHaveCount(0)

    // re-open: the activity toggle kept its sticky state
    await more().click()
    await expect(sheetRow(/Activity overlay/).locator('button')).toHaveAttribute('aria-pressed', 'true')
  })
})

// docs/large-graph-readability-auto-frames.md §AF — Slice 4b: AUTO (suggested)
// group frames. A derived, session-only overlay computed only on an explicit
// "Suggest frames" (P1). No GraphDoc / schema / serialize / digest / undo /
// engine change.

// two dense blobs of 6 pools, far apart on x with one thin bridge, plus 2 model
// nodes (must never be framed). 12 eligible >= WORTH_IT_FLOOR (8).
const GRAPH_AF = (() => {
  const nodes: unknown[] = []
  const edges: unknown[] = []
  for (let b = 0; b < 2; b++) {
    const baseX = b === 0 ? 0 : 980
    for (let i = 0; i < 6; i++) {
      nodes.push({
        id: `b${b}_${i}`,
        type: 'pool',
        position: { x: baseX + i * 120, y: b * 40 },
        data: { kind: 'pool', label: `B${b}-${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
      })
      for (let j = i + 1; j < 6; j++)
        edges.push({ id: `b${b}_${i}_${j}`, type: 'loop', source: `b${b}_${i}`, target: `b${b}_${j}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
    }
  }
  edges.push({ id: 'bridge', type: 'loop', source: 'b0_5', target: 'b1_0', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
  nodes.push({ id: 'p_a', type: 'parameter', position: { x: 0, y: 400 }, data: { kind: 'parameter', label: 'Pa', value: 1 } })
  nodes.push({ id: 'r_a', type: 'register', position: { x: 200, y: 400 }, data: { kind: 'register', label: 'Ra', expr: '1', format: 'int' } })
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges })
})()

type AFHead = { autoFrames: { id: string; area: number; label: string; rect: { x: number; y: number; w: number; h: number }; members: string[] }[]; lastSignature: string | null }
const afHead = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: { autoFrame: { getState: () => AFHead } } }).__loop.autoFrame.getState()
    return { autoFrames: s.autoFrames.map((f) => ({ ...f, members: [...f.members] })), lastSignature: s.lastSignature }
  })
const suggestBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-suggest')
const clearAllBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-frame-clear')
const clearSuggestedBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-suggest-clear')

async function loadAF(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    ;(window as unknown as { __loop: { ui: { setState: (p: object) => void } } }).__loop.ui.setState({ focusMode: false, filterPanelOpen: false })
  })
  await importGraph(page, GRAPH_AF)
  // x is clear of the Controls rail (left edge, ~15-43px, vertically centred so
  // its height grows with the number of buttons). At x=40 the graph's left
  // column sat under the rail, and adding one button silently broke six of
  // these tests — the frame drag started on the rail, not the pane. Flow-space
  // rect / membership assertions are unaffected by the pan.
  await page.evaluate(() =>
    (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport({ x: 96, y: 150, zoom: 0.62 }, { duration: 0 }),
  )
  await expect(node(page, 'b0_0')).toBeVisible()
}

test.describe('LGR Slice 4b — auto (suggested) group frames', () => {
  test('Suggest frames (desktop) — a derived dashed set; model nodes excluded; deterministic; GraphDoc / digest / undo untouched', async ({ page }) => {
    await loadAF(page)
    const digest0 = await gDigest(page)
    const canUndo0 = await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { canUndo: boolean } } } }).__loop.graph.getState().canUndo)

    await expect(suggestBtn(page)).toBeVisible()
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(0)
    await suggestBtn(page).click()

    const h = await afHead(page)
    expect(h.autoFrames.length).toBe(2)
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(2)
    await expect(page.locator('.lgr-frame__fill--auto')).toHaveCount(2)
    for (const f of h.autoFrames) {
      expect(f.members).not.toContain('p_a')
      expect(f.members).not.toContain('r_a')
      expect(f.members.length).toBeGreaterThanOrEqual(3)
    }
    await suggestBtn(page).click()
    const h2 = await afHead(page)
    expect(h2.autoFrames.map((f) => [f.rect, f.members])).toEqual(h.autoFrames.map((f) => [f.rect, f.members]))
    expect(await gDigest(page)).toBe(digest0)
    expect(await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { canUndo: boolean } } } }).__loop.graph.getState().canUndo)).toBe(canUndo0)
  })

  test('re-Suggest replaces only the auto set; a manual frame is preserved (AF5 R3/R7)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    await frameToolBtn(page).click()
    await drawFrame(page, 'b0_0', 'b0_5', 24)
    expect((await frameHead(page)).frames.length).toBe(1)
    await suggestBtn(page).click()
    expect((await frameHead(page)).frames.length).toBe(1)
    expect((await afHead(page)).autoFrames.length).toBe(2)
  })

  test('rename an auto frame → promotes to a manual (solid) frame; a re-infer keeps it (AF5 R5)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    const beforeManual = (await frameHead(page)).frames.length
    await page.locator('.lgr-frame--auto .lgr-frame__label').first().click()
    await page.locator('.lgr-frame__label--edit').fill('Combat')
    await page.locator('.lgr-frame__label--edit').press('Enter')
    expect((await afHead(page)).autoFrames.length).toBe(1)
    const fh = await frameHead(page)
    expect(fh.frames.length).toBe(beforeManual + 1)
    expect(fh.frames.some((f) => f.label === 'Combat')).toBe(true)
    await suggestBtn(page).click()
    expect((await frameHead(page)).frames.some((f) => f.label === 'Combat')).toBe(true)
  })

  test('Dismiss removes one from the current set; the next Suggest may re-propose it (AF5 R8)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
    await page.locator('.lgr-frame--auto .lgr-frame__edge-hit--top').first().click()
    await page.locator('.lgr-frame--auto .lgr-frame__del').first().click()
    expect((await afHead(page)).autoFrames.length).toBe(1)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
  })

  test('Clear suggested frames removes only the auto set; Clear all removes both (AF5 R4)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    await frameToolBtn(page).click()
    await drawFrame(page, 'b0_0', 'b0_5', 24)
    expect((await frameHead(page)).frames.length).toBe(1)
    expect((await afHead(page)).autoFrames.length).toBe(2)
    await clearSuggestedBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(0)
    expect((await frameHead(page)).frames.length).toBe(1)
    await suggestBtn(page).click()
    await clearAllBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(0)
    expect((await frameHead(page)).frames.length).toBe(0)
  })

  test('composition: Filter hides every framed node → the auto frame + rect + count unchanged; Step / Reset / Activity never recompute (AF-INV-1/2/4)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    const before = await afHead(page)
    expect(before.autoFrames.length).toBe(2)

    // hide the Pool kind via the filter store (Slice 2 covers the panel UI; this
    // test is about the auto frame's reaction) — every framed node is a pool.
    await page.evaluate(() =>
      (window as unknown as { __loop: { filter: { getState: () => { toggleNodeKind: (k: string) => void } } } }).__loop.filter.getState().toggleNodeKind('pool'),
    )
    await expect(node(page, 'b0_0')).toHaveCount(0)
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(2)
    expect((await afHead(page)).autoFrames.map((f) => f.rect)).toEqual(before.autoFrames.map((f) => f.rect))
    await page.evaluate(() =>
      (window as unknown as { __loop: { filter: { getState: () => { toggleNodeKind: (k: string) => void } } } }).__loop.filter.getState().toggleNodeKind('pool'),
    )

    await activityBtn(page).click()
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void; reset: () => void } } } }).__loop.sim.getState().stepOnce())
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void; reset: () => void } } } }).__loop.sim.getState().reset())
    expect((await afHead(page)).autoFrames.map((f) => f.rect)).toEqual(before.autoFrames.map((f) => f.rect))

    await resetViewBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
    await importGraph(page, GRAPH_AF)
    expect((await afHead(page)).autoFrames.length).toBe(0)
  })

  test('the "recompute available" hint appears after a structural edit and clears on re-Suggest (AF4.3)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    await expect(suggestBtn(page)).not.toHaveClass(/is-stale/)
    await page.evaluate(() => {
      const G = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] }; setState: (p: object) => void } } }).__loop.graph
      const nodes = G.getState().nodes.map((n) => (n.id === 'b0_0' ? { ...n, position: { x: n.position.x + 500, y: n.position.y } } : n))
      G.setState({ nodes })
    })
    await expect(suggestBtn(page)).toHaveClass(/is-stale/)
    await suggestBtn(page).click()
    await expect(suggestBtn(page)).not.toHaveClass(/is-stale/)
  })

  test('forced-colors: an auto frame border stays DASHED, distinct from a manual (solid) frame (AF-INV-6)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadAF(page)
    await suggestBtn(page).click()
    await frameToolBtn(page).click()
    await drawFrame(page, 'b0_0', 'b0_5', 24)
    const autoDash = await page.locator('.lgr-frame__fill--auto').first().evaluate((el) => getComputedStyle(el).strokeDasharray)
    const manualDash = await page.locator('.lgr-frame__fill:not(.lgr-frame__fill--auto)').first().evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(autoDash).not.toBe('none')
    expect(autoDash.trim().length).toBeGreaterThan(0)
    expect(manualDash === 'none' || manualDash.trim() === '' || manualDash !== autoDash).toBe(true)
  })

  test('a Filter that hides framed nodes does NOT mark the auto set stale (review boundary 2)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    await expect(suggestBtn(page)).not.toHaveClass(/is-stale/)
    await page.evaluate(() =>
      (window as unknown as { __loop: { filter: { getState: () => { toggleNodeKind: (k: string) => void } } } }).__loop.filter.getState().toggleNodeKind('pool'),
    )
    await expect(node(page, 'b0_0')).toHaveCount(0)
    await expect(suggestBtn(page)).not.toHaveClass(/is-stale/)
    const before = await afHead(page)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.map((f) => [f.rect, f.members])).toEqual(before.autoFrames.map((f) => [f.rect, f.members]))
  })

  test('eligible drops below the floor after an edit — Suggest stays while a stale set exists, then clears to 0 and keeps manual frames (review boundary 1)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
    await frameToolBtn(page).click()
    await drawFrame(page, 'b0_0', 'b0_5', 24)
    expect((await frameHead(page)).frames.length).toBe(1)

    await page.evaluate(() => {
      const G = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string }[]; edges: { source: string; target: string }[] }; setState: (p: object) => void } } }).__loop.graph
      const keep = new Set(['b0_0', 'b0_1', 'b0_2', 'b1_0', 'b1_1', 'p_a', 'r_a'])
      G.setState({
        nodes: G.getState().nodes.filter((n) => keep.has(n.id)),
        edges: G.getState().edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      })
    })
    await expect(suggestBtn(page)).toBeVisible()
    await expect(suggestBtn(page)).toHaveClass(/is-stale/)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(0)
    expect((await frameHead(page)).frames.length).toBe(1)
    await expect(suggestBtn(page)).toHaveCount(0)
    await expect(clearSuggestedBtn(page)).toHaveCount(0)
    await clearAllBtn(page).click()
    expect((await frameHead(page)).frames.length).toBe(0)
  })

  test('VISUAL — auto-frames.png: fresh Suggest — dashed Area N frames, one selected (x + resize), the structural-only note, minimap hidden', async ({ page }) => {
    await loadAF(page)
    await page.addStyleTag({ content: '.react-flow__minimap,.react-flow__attribution{display:none!important}' })
    await suggestBtn(page).click()
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(2)
    await page.locator('.lgr-frame--auto .lgr-frame__edge-hit--top').first().click()
    await expect(page.locator('.lgr-frame--auto.is-selected .lgr-frame__resize')).toHaveCount(1)
    await expect(page.locator('.lgr-frame--auto.is-selected .lgr-frame__del')).toHaveCount(1)
    await expect(page.locator('.lgr-suggest-note')).toBeVisible()
    await expect(page.locator('.lgr-frame--auto .lgr-frame__label')).toHaveText([/Area 1/, /Area 2/])
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'auto-frames'))
  })

  test('VISUAL — auto-frames-mixed.png: a promoted solid Group N frame + a manual frame overlapping an auto frame (auto behind manual) + the stale dot on Suggest', async ({ page }) => {
    // the drawn manual frame is SELECTED at capture time, which would show the
    // one-time tier-1 "frame move" note (§CIH3 #9) in the top-centre slot over
    // the suggest note this baseline pins — mark it seen before the app mounts
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('loop-studio/contextual-help/1', JSON.stringify({ 'frame-move': true })))
    await loadAF(page)
    await page.addStyleTag({ content: '.react-flow__minimap,.react-flow__attribution{display:none!important}' })
    await suggestBtn(page).click()
    await page.locator('.lgr-frame--auto .lgr-frame__label').first().click()
    await page.locator('.lgr-frame__label--edit').press('Enter')
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto)')).toHaveCount(1)
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto) .lgr-frame__label')).toHaveText([/Group 1/])
    await frameToolBtn(page).click()
    await drawFrame(page, 'b1_0', 'b1_5', 30)
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto)')).toHaveCount(2)
    await page.evaluate(() => {
      const G = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] }; setState: (p: object) => void } } }).__loop.graph
      const nodes = G.getState().nodes.map((n) => (n.id === 'b0_2' ? { ...n, position: { x: n.position.x + 400, y: n.position.y } } : n))
      G.setState({ nodes })
    })
    await expect(suggestBtn(page)).toHaveClass(/is-stale/)
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'auto-frames-mixed'))
  })
})

test.describe('LGR Slice 4b — mobile (the More sheet)', () => {
  const more = (page: Page) => page.locator('.mob-more')
  const sheetRow = (page: Page, re: RegExp) => page.locator('.sheet__row').filter({ hasText: re })

  test('Suggest from the More sheet; Area frames render DISPLAY-ONLY (no edit / resize / x); the note dismisses; Clear suggested vs Clear all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await loadAF(page)
    await expect(suggestBtn(page)).toHaveCount(0)

    await more(page).click()
    await expect(sheetRow(page, /Suggest frames/)).toBeVisible()
    await sheetRow(page, /Suggest frames/).click()
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(2)

    await expect(page.locator('.lgr-frame--auto .lgr-frame__edge-hit')).toHaveCount(0)
    await expect(page.locator('.lgr-frame--auto .lgr-frame__resize')).toHaveCount(0)
    await expect(page.locator('.lgr-frame--auto .lgr-frame__del')).toHaveCount(0)
    await expect(page.locator('.lgr-frame--auto .lgr-frame__label--static')).toHaveCount(2)

    await expect(page.locator('.lgr-suggest-note')).toBeVisible()
    await page.locator('.lgr-suggest-note__x').click()
    await expect(page.locator('.lgr-suggest-note')).toHaveCount(0)

    await page.evaluate(() =>
      (window as unknown as { __loop: { frame: { getState: () => { addFrame: (r: object) => string } } } }).__loop.frame.getState().addFrame({ x: 0, y: 0, w: 200, h: 120 }),
    )
    await more(page).click()
    await sheetRow(page, /Clear suggested frames/).click()
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(0)
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto)')).toHaveCount(1)

    await more(page).click()
    await sheetRow(page, /Suggest frames/).click()
    await more(page).click()
    // D6 — no mobile row deletes a SAVED frame; only the session-only clear exists
    await expect(sheetRow(page, /Clear all frames/)).toHaveCount(0)
    await sheetRow(page, /Clear suggested frames/).click()
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(0)
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto)'), 'the manual frame survives').toHaveCount(1)
  })

  test('below the floor: no Suggest row on a small graph; an existing auto set that drops below the floor keeps the row so it can be recomputed to 0', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await loadAF(page)
    await more(page).click()
    await expect(sheetRow(page, /Suggest frames/)).toBeVisible()
    await sheetRow(page, /Suggest frames/).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)

    await page.evaluate(() => {
      const G = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string }[]; edges: { source: string; target: string }[] }; setState: (p: object) => void } } }).__loop.graph
      const keep = new Set(['b0_0', 'b0_1', 'b0_2', 'b1_0', 'b1_1', 'p_a', 'r_a'])
      G.setState({
        nodes: G.getState().nodes.filter((n) => keep.has(n.id)),
        edges: G.getState().edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      })
    })
    await more(page).click()
    await expect(sheetRow(page, /Suggest frames/)).toBeVisible()
    await sheetRow(page, /Suggest frames/).click()
    expect((await afHead(page)).autoFrames.length).toBe(0)
    await more(page).click()
    await expect(sheetRow(page, /Suggest frames/)).toHaveCount(0)
  })
})

// docs/large-graph-readability-frame-colour.md §FC — a MANUAL frame's optional
// preset accent (and its promote-on-commit for auto frames). Render / UI-only:
// no GraphDoc / schema / serialize / digest / undo / engine change; the colour
// is session-only and dropped on a graph reload.
type FCFrame = { id: string; n: number; label: string; color?: string; rect: object }
function fcFind(fh: { frames: { id: string }[] }, id: string): FCFrame | undefined {
  return fh.frames.find((f) => f.id === id) as FCFrame | undefined
}
const fcAdd = (page: Page, rect: object, label?: string, color?: string) =>
  page.evaluate(
    ([r, l, c]) =>
      (
        window as unknown as {
          __loop: { frame: { getState: () => { adoptFrame: (r: object, l: string, c?: string) => string } } }
        }
      ).__loop.frame.getState().adoptFrame(r as object, (l as string) ?? '', (c as string) || undefined),
    [rect, label, color] as const,
  )
const fcSelect = (page: Page, id: string | null) =>
  page.evaluate(
    (i) =>
      (
        window as unknown as {
          __loop: { frame: { getState: () => { selectFrame: (i: string | null) => void } } }
        }
      ).__loop.frame.getState().selectFrame(i as string | null),
    id,
  )
const fcCanUndo = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __loop: { graph: { getState: () => { canUndo: boolean } } } }).__loop.graph.getState()
        .canUndo,
  )

test.describe('LGR frame colour (§FC)', () => {
  const swatch = (page: Page, c: string) => page.locator(`.lgr-frame__swatch[data-color="${c}"]`)
  const neutralSwatch = (page: Page) => page.locator('.lgr-frame__swatch:not([data-color])')
  const cssOf = (page: Page, sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { fill: cs.fill, stroke: cs.stroke, color: cs.color, borderColor: cs.borderTopColor, dash: cs.strokeDasharray }
    }, sel)

  test('pick an accent on a selected MANUAL frame — border + label + fill carry it; aria-pressed moves; GraphDoc / digest / undo untouched', async ({ page }) => {
    await loadAF(page)
    const digestBefore = await gDigest(page)
    const undoBefore = await fcCanUndo(page)
    const id = await fcAdd(page, { x: 0, y: -40, w: 700, h: 200 }, 'Zone')
    await fcSelect(page, id)
    await expect(page.locator('.lgr-frame.is-selected')).toHaveCount(1)
    await expect(neutralSwatch(page)).toHaveAttribute('aria-pressed', 'true')

    await swatch(page, 'violet').click()
    expect((await frameHead(page)).frames.find((f) => f.id === id)?.color).toBe('violet')
    await expect(swatch(page, 'violet')).toHaveAttribute('aria-pressed', 'true')
    await expect(neutralSwatch(page)).toHaveAttribute('aria-pressed', 'false')

    const back = await cssOf(page, '.lgr-frame-back rect.lgr-frame__fill[data-color="violet"]')
    const label = await cssOf(page, '.lgr-frame[data-color="violet"] .lgr-frame__label')
    expect(back?.stroke).toBe(back?.fill)
    expect(back?.fill).not.toBe('rgba(0, 0, 0, 0)')
    expect(label?.color).toBe(label?.borderColor)

    await neutralSwatch(page).click()
    expect('color' in (fcFind(await frameHead(page), id) ?? {})).toBe(false)
    await expect(page.locator('.lgr-frame__fill[data-color]')).toHaveCount(0)

    expect(await gDigest(page)).toBe(digestBefore)
    expect(await fcCanUndo(page)).toBe(undoBefore)
  })

  test('pick an accent on an AUTO frame -> it PROMOTES: leaves the auto set, becomes a SOLID manual Group frame with that colour (§AF5 R5)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
    const autoId = (await afHead(page)).autoFrames[0].id
    await fcSelect(page, autoId)
    await swatch(page, 'gold').click()

    expect((await afHead(page)).autoFrames.length).toBe(1)
    const manual = (await frameHead(page)).frames
    expect(manual).toHaveLength(1)
    expect(manual[0].color).toBe('gold')
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto)[data-color="gold"]')).toHaveCount(1)
    const dash = (await cssOf(page, '.lgr-frame-back rect.lgr-frame__fill[data-color="gold"]'))?.dash
    expect(dash === 'none' || dash === '' || dash == null).toBe(true)
    await expect(page.locator('.lgr-frame:not(.lgr-frame--auto) .lgr-frame__label')).toHaveText(/Group \d+/)
  })

  test('open the picker on an AUTO frame then pick NEUTRAL / Esc — stays auto, rect + label unchanged (§AF5 R6)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    const before = await afHead(page)
    await fcSelect(page, before.autoFrames[0].id)
    // the picker opens on the selected auto frame, neutral pre-selected …
    await expect(page.locator('.lgr-frame--auto .lgr-frame__swatches')).toHaveCount(1)
    await expect(neutralSwatch(page)).toHaveAttribute('aria-pressed', 'true')
    // … picking neutral is a no-op for an auto frame; Esc / deselect = cancel
    await page.evaluate(() => {
      const el = document.querySelector('.lgr-frame__swatch:not([data-color])') as HTMLButtonElement | null
      el?.click()
    })
    await page.keyboard.press('Escape')
    await fcSelect(page, null)

    const after = await afHead(page)
    expect(after.autoFrames.length).toBe(before.autoFrames.length)
    expect(after.autoFrames.map((f) => [f.rect, f.members])).toEqual(
      before.autoFrames.map((f) => [f.rect, f.members]),
    )
    expect((await frameHead(page)).frames).toHaveLength(0)
  })

  test('an accented manual frame survives Suggest + Clear suggested; Clear all removes it; a graph reload drops the colour', async ({ page }) => {
    await loadAF(page)
    await fcAdd(page, { x: 0, y: 0, w: 400, h: 200 }, 'Kept', 'rose')
    await suggestBtn(page).click()
    expect((await frameHead(page)).frames.find((f) => f.label === 'Kept')?.color).toBe('rose')
    await clearSuggestedBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(0)
    expect((await frameHead(page)).frames.find((f) => f.label === 'Kept')?.color).toBe('rose')

    await clearAllBtn(page).click()
    expect((await frameHead(page)).frames).toHaveLength(0)

    await fcAdd(page, { x: 0, y: 0, w: 400, h: 200 }, 'Gone', 'slate')
    await importGraph(page, GRAPH_AF)
    expect((await frameHead(page)).frames).toHaveLength(0)
  })

  test('a Filter that hides every node inside an accented frame leaves the frame + colour + rect unchanged; a sim Step never changes the colour', async ({ page }) => {
    await loadAF(page)
    const id = await fcAdd(page, { x: -30, y: -60, w: 760, h: 260 }, 'Zone', 'sage')
    await fcSelect(page, null)
    const before = fcFind(await frameHead(page), id)
    await page.evaluate(() =>
      (
        window as unknown as {
          __loop: { filter: { getState: () => { toggleNodeKind: (k: string) => void } } }
        }
      ).__loop.filter.getState().toggleNodeKind('pool'),
    )
    await page.evaluate(() =>
      (
        window as unknown as { __loop: { sim: { getState: () => { step?: () => void } } } }
      ).__loop.sim.getState().step?.(),
    )
    expect(fcFind(await frameHead(page), id)).toEqual(before)
  })

  test('forced-colors: the accent is dropped; manual (solid) vs auto (dashed) vs selected (outline) are still all distinguishable', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadAF(page)
    await suggestBtn(page).click()
    await fcAdd(page, { x: 0, y: 0, w: 300, h: 160 }, 'M', 'rose')
    const manual = await cssOf(page, '.lgr-frame-back rect.lgr-frame__fill[data-color]')
    const auto = (await cssOf(page, '.lgr-frame-back rect.lgr-frame__fill--auto'))?.dash
    expect(manual?.fill).toBe('none')
    expect(manual?.dash === 'none' || manual?.dash === '').toBe(true)
    expect(auto).not.toBe('none')
    const outline = await page.evaluate(() => {
      const el = document.querySelector('.lgr-frame.is-selected')
      return el ? getComputedStyle(el).outlineStyle : null
    })
    expect(outline).toBe('dashed')
    await page.emulateMedia({ forcedColors: null })
  })

  test('mobile: a selected manual frame shows NO swatch row; a desktop-set accent still renders', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await loadAF(page)
    await fcAdd(page, { x: 0, y: 0, w: 300, h: 160 }, 'M', 'violet')
    await expect(page.locator('.lgr-frame-back rect.lgr-frame__fill[data-color="violet"]')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__swatches')).toHaveCount(0)
  })

  test('VISUAL — frame-colours.png (light): a neutral frame + one per accent + a pure auto frame + one accent frame selected', async ({ page }) => {
    await loadFCVisual(page, 'light')
    await expect(page.locator('.lgr-frame__fill[data-color]')).toHaveCount(5)
    await expect(page.locator('.lgr-frame__fill--auto')).toHaveCount(2)
    await expect(page).toHaveScreenshot(...snap(page, 'frame-colours'))
  })

  test('VISUAL — frame-colours-dark.png: the same arrangement, dark theme', async ({ page }) => {
    await loadFCVisual(page, 'dark')
    await expect(page).toHaveScreenshot(...snap(page, 'frame-colours-dark'))
  })

  test('VISUAL — frame-colours-overlap.png: two accented frames overlapping still pass nodes / edges through', async ({ page }) => {
    await loadAF(page)
    await fcAdd(page, { x: -40, y: -80, w: 520, h: 320 }, 'One', 'slate')
    await fcAdd(page, { x: 300, y: -60, w: 520, h: 320 }, 'Two', 'gold')
    await fcSelect(page, null)
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    await expect(page).toHaveScreenshot(...snap(page, 'frame-colours-overlap'))
  })

  test('VISUAL — frame-colours-forced.png: forced-colors — manual / auto / selected still tell apart with the palette dropped', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadFCVisual(page, 'light')
    await expect(page).toHaveScreenshot(...snap(page, 'frame-colours-forced'))
    await page.emulateMedia({ forcedColors: null })
  })
})

async function loadFCVisual(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme })
  await loadAF(page)
  await suggestBtn(page).click()
  await fcAdd(page, { x: -40, y: -70, w: 220, h: 150 }, 'Neutral')
  await fcAdd(page, { x: 200, y: -70, w: 200, h: 150 }, 'Slate', 'slate')
  await fcAdd(page, { x: 420, y: -70, w: 200, h: 150 }, 'Sage', 'sage')
  await fcAdd(page, { x: -40, y: 110, w: 200, h: 150 }, 'Gold', 'gold')
  await fcAdd(page, { x: 200, y: 110, w: 200, h: 150 }, 'Violet', 'violet')
  const rose = await fcAdd(page, { x: 420, y: 110, w: 200, h: 150 }, 'Rose', 'rose')
  await fcSelect(page, rose)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
}

// docs/large-graph-readability-saved-frames.md (SF) / SEMANTICS-R5.md — LGR
// Slice 5: a MANUAL frame's id / label / rect / color is DOCUMENT content that
// round-trips reload / Export/Import / autosave as loop-revision/5 cosmetic
// content, and every create / rename / resize / recolour / delete / "Clear all"
// is ONE graph undo entry at the SF11.1 granularity. A pure suggested frame is
// never persisted; promoting one is a single undo entry that does NOT revive
// the suggestion when undone.
test.describe('LGR Slice 5 — saved frames (SF / loop-revision/5)', () => {
  const sfState = async (page: Page) => {
    const struct = await gDigest(page) // frames-free engine/structure digest
    return page.evaluate((structDigest) => {
      const L = (
        window as unknown as {
          __loop: Record<string, { getState: () => Record<string, unknown> }> & { revisionIO: { currentTargetDigest: () => string } }
        }
      ).__loop
      return {
        frames: (L.frame.getState().frames as { id: string; n: number; label: string; color?: string; rect: object }[]).map((f) => ({ ...f })),
        past: (L.graph.getState().past as unknown[]).length,
        simRev: L.graph.getState().simulationRev as number,
        // the FULL loop-revision/5 digest — a manual frame IS content, so it
        // moves this (SEMANTICS-R5.md §R5-6)…
        rev: (L.revisionIO.currentTargetDigest as () => string)(),
        // …but never the engine/structure digest
        struct: structDigest,
        exported: (L.graph.getState().exportJSON as () => string)(),
      }
    }, struct)
  }
  // the `frames` block as persisted in the debounced autosave record
  const sfRec = (page: Page): Promise<unknown> =>
    page.evaluate(() => {
      const raw = localStorage.getItem('loop-studio:graph:v1')
      return raw ? ((JSON.parse(raw).frames as unknown) ?? null) : null
    })
  const sfRecSettled = async (page: Page): Promise<unknown[]> => {
    await expect.poll(async () => Array.isArray(await sfRec(page))).toBe(true)
    return (await sfRec(page)) as unknown[]
  }
  const sfUndo = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { undo: () => void } } } }).__loop.graph.getState().undo())
  const sfRedo = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { redo: () => void } } } }).__loop.graph.getState().redo())
  const sfRemove = (page: Page, id: string) =>
    page.evaluate((i) => (window as unknown as { __loop: { frame: { getState: () => { removeFrame: (i: string) => void } } } }).__loop.frame.getState().removeFrame(i), id)
  const sfClearAll = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { clearFrames: () => void } } } }).__loop.frame.getState().clearFrames())
  // promote a suggested frame exactly as FrameLayer.pickColor does for an auto
  // frame (adoptFrame + removeAuto), driven through the store so no canvas
  // control can intercept the swatch (§AF5 R5).
  const sfPromote = (page: Page, autoId: string, color: string) =>
    page.evaluate(
      ([aid, c]) => {
        const L = window as unknown as {
          __loop: {
            autoFrame: { getState: () => { autoFrames: { id: string; label: string; rect: object }[]; removeAuto: (i: string) => void } }
            frame: { getState: () => { adoptFrame: (r: object, l: string, c?: string) => string } }
          }
        }
        const af = L.__loop.autoFrame.getState()
        const f = af.autoFrames.find((x) => x.id === aid)!
        const id = L.__loop.frame.getState().adoptFrame(f.rect, f.label ?? '', c || undefined)
        af.removeAuto(aid)
        return id
      },
      [autoId, color] as const,
    )

  test('a named + sized + coloured manual frame is in the autosave record and comes back on RELOAD (SF5 / SF6)', async ({ page }) => {
    await loadAF(page)
    const id = await fcAdd(page, { x: 40, y: -40, w: 420, h: 220 }, 'Economy', 'violet')
    await expect
      .poll(() => sfRec(page))
      .toEqual([{ id, label: 'Economy', rect: { x: 40, y: -40, w: 420, h: 220 }, color: 'violet' }])

    await page.reload()
    await openApp(page)
    await expect(page.locator('.lgr-frame-back rect.lgr-frame__fill[data-color="violet"]')).toHaveCount(1)
    const fr = (await sfState(page)).frames
    expect(fr).toHaveLength(1)
    expect(fr[0]).toMatchObject({ id, label: 'Economy', rect: { x: 40, y: -40, w: 420, h: 220 }, color: 'violet', n: 1 })
  })

  test('frame ORDER survives Export -> New -> Import; `n` is re-derived from array order (SF6 / boundary 1)', async ({ page }) => {
    await loadAF(page)
    await fcAdd(page, { x: 0, y: 0, w: 100, h: 60 }, 'One')
    await fcAdd(page, { x: 200, y: 0, w: 100, h: 60 }, 'Two', 'sage')
    await fcAdd(page, { x: 400, y: 0, w: 100, h: 60 }, 'Three')
    const text = (await sfState(page)).exported
    expect(JSON.parse(text).frames.map((f: { label: string }) => f.label)).toEqual(['One', 'Two', 'Three'])

    await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { newGraph: () => void } } } }).__loop.graph.getState().newGraph())
    expect((await sfState(page)).frames).toEqual([])
    await page.evaluate((t) => (window as unknown as { __loop: { graph: { getState: () => { loadJSON: (t: string) => void } } } }).__loop.graph.getState().loadJSON(t), text)
    const fr = (await sfState(page)).frames
    expect(fr.map((f) => f.label)).toEqual(['One', 'Two', 'Three'])
    expect(fr.map((f) => f.n)).toEqual([1, 2, 3])
  })

  test('a pure suggested frame is NEVER persisted; a promoted one is (SF2 / boundary 6)', async ({ page }) => {
    await loadAF(page)
    await suggestBtn(page).click()
    expect((await afHead(page)).autoFrames.length).toBe(2)
    // wait out the autosave debounce — suggestions must not reach the record
    await page.waitForTimeout(500)
    expect(await sfRec(page)).toBeNull()

    // promote one by giving it an accent (§AF5 R5)
    const autoId = (await afHead(page)).autoFrames[0].id
    await sfPromote(page, autoId, 'gold')
    expect((await afHead(page)).autoFrames.length).toBe(1)

    const rec = (await sfRecSettled(page)) as { color?: string }[]
    expect(rec).toHaveLength(1)
    expect(rec[0]).toMatchObject({ color: 'gold' })

    await page.reload()
    await openApp(page)
    expect((await afHead(page)).autoFrames.length).toBe(0) // suggestions gone
    expect((await sfState(page)).frames).toHaveLength(1) // the promoted frame is back
  })

  test('undo units — create / delete / "Clear all" / promote each move `past` by exactly one; undo/redo restore content AND the on-screen store; the engine digest never moves (SF11.1 / boundaries 4-6-8)', async ({ page }) => {
    await loadAF(page)
    const base = await sfState(page)

    // create = +1 ; undo removes it + the store ; redo re-creates it
    const a = await fcAdd(page, { x: 0, y: 0, w: 120, h: 70 }, 'Keep', 'rose')
    expect((await sfState(page)).past - base.past).toBe(1)
    // a frame MUTATION itself is not a simulation change (§SF11.3)
    expect((await sfState(page)).simRev).toBe(base.simRev)
    await sfUndo(page)
    expect((await sfState(page)).frames).toEqual([])
    await sfRedo(page)
    expect(((await sfState(page)).frames)[0]).toMatchObject({ id: a, label: 'Keep', color: 'rose' })

    // delete = +1 ; undo restores label + rect + colour intact ; redo re-deletes
    const beforeDel = await sfState(page)
    await sfRemove(page, a)
    expect((await sfState(page)).frames).toEqual([])
    expect((await sfState(page)).past - beforeDel.past).toBe(1)
    await sfUndo(page)
    expect(((await sfState(page)).frames)[0]).toMatchObject({ id: a, label: 'Keep', rect: { x: 0, y: 0, w: 120, h: 70 }, color: 'rose' })
    await sfRedo(page)
    expect((await sfState(page)).frames).toEqual([])
    await sfUndo(page) // leave the frame in place

    // "Clear all" with 3 frames = EXACTLY one entry ; one undo brings all 3 back
    await fcAdd(page, { x: 200, y: 0, w: 80, h: 40 }, 'B')
    await fcAdd(page, { x: 400, y: 0, w: 80, h: 40 }, 'C')
    const beforeClear = await sfState(page)
    expect(beforeClear.frames).toHaveLength(3)
    await sfClearAll(page)
    expect((await sfState(page)).frames).toEqual([])
    expect((await sfState(page)).past - beforeClear.past).toBe(1)
    await sfUndo(page)
    expect((await sfState(page)).frames.map((f) => f.label)).toEqual(['Keep', 'B', 'C'])

    // promote a suggestion = +1 ; undo removes ONLY the manual frame and does
    // NOT revive the suggestion (§SF11.2)
    await suggestBtn(page).click()
    const autoCount = (await afHead(page)).autoFrames.length
    expect(autoCount).toBeGreaterThan(0)
    const autoId = (await afHead(page)).autoFrames[0].id
    const beforePromote = await sfState(page)
    await sfPromote(page, autoId, 'slate')
    expect((await afHead(page)).autoFrames.length).toBe(autoCount - 1)
    expect((await sfState(page)).past - beforePromote.past).toBe(1)
    const manualCount = (await sfState(page)).frames.length
    await sfUndo(page)
    expect((await sfState(page)).frames.length).toBe(manualCount - 1) // manual frame gone
    expect((await afHead(page)).autoFrames.length).toBe(autoCount - 1) // suggestion NOT revived
    await sfRedo(page)
    expect((await sfState(page)).frames.length).toBe(manualCount) // redo re-creates the manual frame

    // through ALL of the above the ENGINE / structure digest never moved —
    // frames are `loop-revision/5` cosmetic, so no frame undo/redo changes the
    // engine result (§SF11.3). The FULL revision digest (`rev`) DID move with
    // the frames, and returns to baseline once the frames match again.
    // (`simulationRev` also ticks on any undo/redo — pre-existing, and only
    // schedules a recompute to the identical StepReport.)
    expect((await sfState(page)).struct).toBe(base.struct)
  })

  test('Import adds ONE undo entry, never one-per-frame; pure Suggest / Dismiss / Clear suggested add none and never touch the doc digest or the record (SF11.3 / boundaries 4-7)', async ({ page }) => {
    await loadAF(page)
    await fcAdd(page, { x: 0, y: 0, w: 100, h: 60 }, 'One')
    await fcAdd(page, { x: 200, y: 0, w: 100, h: 60 }, 'Two')
    await sfRecSettled(page) // let the create autosave land first
    const before = await sfState(page)

    // a whole-graph import that CARRIES two frames = still exactly one entry
    await page.evaluate((t) => (window as unknown as { __loop: { graph: { getState: () => { loadJSON: (t: string) => void } } } }).__loop.graph.getState().loadJSON(t), before.exported)
    expect((await sfState(page)).frames.map((f) => f.label)).toEqual(['One', 'Two'])
    expect((await sfState(page)).past - before.past).toBe(1)

    // pure Suggest / Dismiss / Clear suggested — no undo entry, digest + record frozen
    const recMid = await sfRecSettled(page)
    const mid = await sfState(page)
    await suggestBtn(page).click()
    await page.locator('.lgr-frame--auto .lgr-frame__edge-hit').first().click()
    await page.locator('.lgr-frame--auto .lgr-frame__del').first().click() // Dismiss one
    await clearSuggestedBtn(page).click()
    await page.waitForTimeout(450) // let any (unexpected) autosave fire
    const after = await sfState(page)
    expect(after.past).toBe(mid.past)
    expect(after.rev).toBe(mid.rev) // pure Suggest/Dismiss/Clear touches NOTHING on the doc
    expect(after.struct).toBe(mid.struct)
    expect(after.simRev).toBe(mid.simRev)
    expect(await sfRec(page)).toEqual(recMid)
  })

  test('two docs differing ONLY in frames: SAME engine/structure digest + simulationRev; the FULL revision digest differs; exported bytes gain the `frames` block (boundary 8)', async ({ page }) => {
    await loadAF(page)
    const plain = await sfState(page)
    await fcAdd(page, { x: 0, y: 0, w: 100, h: 60 }, 'Zone', 'gold')
    const withF = await sfState(page)

    const a = JSON.parse(plain.exported)
    const b = JSON.parse(withF.exported)
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes))
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges))
    expect(a.frames).toBeUndefined()
    expect(b.frames).toEqual([{ id: expect.any(String), label: 'Zone', rect: { x: 0, y: 0, w: 100, h: 60 }, color: 'gold' }])
    // adding a saved frame is NOT a simulation change and does not move the
    // engine / structure digest …
    expect(withF.simRev).toBe(plain.simRev)
    expect(withF.struct).toBe(plain.struct)
    // … but it DOES move the full loop-revision/5 content digest (§R5-6)
    expect(withF.rev).not.toBe(plain.rev)
  })

  test('a hostile autosave record — non-finite rect + unknown colour — loses the bad frames but still loads the graph + the good frames (SF9 / R5-1.1 / boundary 9)', async ({ page }) => {
    await loadAF(page)
    const doc = JSON.parse((await sfState(page)).exported)
    doc.frames = [
      { id: 'ok1', label: 'Good', rect: { x: 1, y: 2, w: 100, h: 50 }, color: 'sage' },
      { id: 'bad-nonfinite', label: 'x', rect: { x: null, y: 0, w: 10, h: 10 } },
      { id: 'bad-flat', label: 'x', rect: { x: 0, y: 0, w: 10, h: 0 } },
      { id: 'ok2', label: 'y'.repeat(200), rect: { x: 5, y: 5, w: 20, h: 20 }, color: 'not-a-colour' },
    ]
    // settle the pending autosave FIRST: the reload's pagehide flush would
    // otherwise overwrite this hand-crafted record with the live (frameless) state
    await page.evaluate((raw) => {
      ;(window as unknown as { __loop: { autosave: { flush: () => void } } }).__loop.autosave.flush()
      localStorage.setItem('loop-studio:graph:v1', raw)
    }, JSON.stringify(doc))
    await page.reload()
    await openApp(page)

    const fr = (await sfState(page)).frames
    expect(fr.map((f) => f.label.slice(0, 4))).toEqual(['Good', 'yyyy']) // both bad rects dropped
    expect(fr[0].color).toBe('sage')
    expect(fr[1].label).toHaveLength(120) // SF_LABEL_MAX
    expect('color' in fr[1]).toBe(false) // unknown colour dropped
    expect((await sfState(page)).frames.length).toBe(2)
    // the graph itself loaded fine
    await expect(node(page, 'b0_0')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// docs/large-graph-readability.md §LGR6.5 / LGR-D9 (2026-09-20) — a frame drag
// CARRIES its contents. Derived at pointer-down (full containment, like the
// creation guard), nothing stored (R5-D3 holds), ONE undo entry per gesture
// through an explicit transaction (never the 600 ms coalescing), Esc /
// pointercancel restore the origin with no entry, Alt+drag moves the frame
// alone, nothing changes under the edit-lock or on mobile.
// ---------------------------------------------------------------------------
test.describe('LGR frame membership — a frame drag carries its contents (§LGR6.5 / LGR-D9)', () => {
  type Rect = { x: number; y: number; w: number; h: number }
  const seedFrame = (page: Page, rect: Rect) =>
    page.evaluate(
      (r) => (window as unknown as { __loop: { frame: { getState: () => { addFrame: (r: Rect) => string } } } }).__loop.frame.getState().addFrame(r),
      rect,
    )
  const positions = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } } } }).__loop.graph.getState()
      return Object.fromEntries(g.nodes.map((n) => [n.id, { ...n.position }]))
    })
  const waypointsOf = (page: Page, id: string) =>
    page.evaluate(
      (eid) => {
        const g = (window as unknown as { __loop: { graph: { getState: () => { edges: { id: string; data: { waypoints?: { x: number; y: number }[] } }[] } } } }).__loop.graph.getState()
        return g.edges.find((e) => e.id === eid)!.data.waypoints ?? null
      },
      id,
    )
  const history = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { past: unknown[]; future: unknown[]; simulationRev: number } } } }).__loop.graph.getState()
      return { past: g.past.length, future: g.future.length, simRev: g.simulationRev }
    })
  const rectOf = async (page: Page, id: string): Promise<Rect> => (await frameHead(page)).frames.find((f) => f.id === id)!.rect
  const shifted = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h })
  const strip = (page: Page, frameIndex: number) => page.locator('.lgr-frame').nth(frameIndex).locator('.lgr-frame__edge-hit--top')

  /** a real pointer drag on a frame's TOP hit-strip by (dx, dy) screen px (zoom 1 ⇒ flow units). */
  async function dragStrip(page: Page, frameIndex: number, dx: number, dy: number, opts: { alt?: boolean; pauseMs?: number; midway?: () => Promise<void> } = {}) {
    const b = (await strip(page, frameIndex).boundingBox())!
    const x0 = b.x + Math.min(40, b.width / 2)
    const y0 = b.y + b.height / 2
    if (opts.alt) await page.keyboard.down('Alt')
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 4 })
    if (opts.pauseMs) await page.waitForTimeout(opts.pauseMs)
    if (opts.midway) {
      await opts.midway()
      return
    }
    await page.mouse.move(x0 + dx, y0 + dy, { steps: 4 })
    await page.mouse.up()
    if (opts.alt) await page.keyboard.up('Alt')
  }

  // the fixture: a(0,0) b(260,0) c(520,0) d(780,0) mid(260,170) ma(0,170) mc(520,170) lone(780,200)
  const OUTER: Rect = { x: -40, y: -40, w: 720, h: 300 } // a b c mid ma mc — not d / lone
  const INNER: Rect = { x: -20, y: -20, w: 200, h: 100 } // a only, fully inside OUTER

  test('dragging a frame edge moves the frame, every fully-contained node, the nested frame and its nodes by the same Δ; d / lone stay; ONE undo restores all', async ({ page }) => {
    await load(page)
    const outer = await seedFrame(page, OUTER)
    const inner = await seedFrame(page, INNER)
    const p0 = await positions(page)
    const h0 = await history(page)
    await dragStrip(page, 0, 60, 40) // index 0 = outer (creation order)
    const p1 = await positions(page)
    for (const id of ['a', 'b', 'c', 'mid', 'ma', 'mc']) expect(p1[id], `${id} carried`).toEqual({ x: p0[id].x + 60, y: p0[id].y + 40 })
    for (const id of ['d', 'lone']) expect(p1[id], `${id} left alone`).toEqual(p0[id])
    expect(await rectOf(page, outer)).toEqual(shifted(OUTER, 60, 40))
    expect(await rectOf(page, inner), 'the nested frame rides along').toEqual(shifted(INNER, 60, 40))
    // the edges between carried nodes re-rendered (route map rebuilt) — the path still exists
    await expect(edge(page, 'e_ab').locator('path.react-flow__edge-path')).toHaveCount(1)
    const h1 = await history(page)
    expect(h1.past, 'exactly one entry').toBe(h0.past + 1)
    expect(h1.simRev, 'carried nodes never touch the engine').toBe(h0.simRev)
    await page.keyboard.press('Control+z')
    expect(await positions(page)).toEqual(p0)
    expect(await rectOf(page, outer)).toEqual(OUTER)
    expect(await rectOf(page, inner)).toEqual(INNER)
    expect((await history(page)).past).toBe(h0.past)
  })

  test('a node straddling the edge is not carried; in two overlapping frames a shared node follows the one that is dragged (D1 / D3)', async ({ page }) => {
    await load(page)
    await seedFrame(page, { x: -20, y: -20, w: 300, h: 100 }) // a inside; b (260..410) straddles x=280
    const p0 = await positions(page)
    await dragStrip(page, 0, 50, 0)
    let p1 = await positions(page)
    expect(p1.a).toEqual({ x: p0.a.x + 50, y: p0.a.y })
    expect(p1.b, 'straddling b stays').toEqual(p0.b)
    await page.keyboard.press('Control+z')
    // overlap: left = {a,b}, right = {b,c}
    await page.evaluate(() => (window as unknown as { __loop: { frame: { getState: () => { clearFrames: () => void } } } }).__loop.frame.getState().clearFrames())
    const left = await seedFrame(page, { x: -20, y: -20, w: 440, h: 100 })
    await seedFrame(page, { x: 200, y: -20, w: 480, h: 100 })
    const q0 = await positions(page)
    await dragStrip(page, 1, 0, 60) // drag `right`
    p1 = await positions(page)
    expect(p1.b).toEqual({ x: q0.b.x, y: q0.b.y + 60 })
    expect(p1.c).toEqual({ x: q0.c.x, y: q0.c.y + 60 })
    expect(p1.a, 'a is only in the other frame').toEqual(q0.a)
    expect(await rectOf(page, left), 'an overlapping (not nested) frame does not move').toEqual({ x: -20, y: -20, w: 440, h: 100 })
  })

  test('a drag that pauses > 600 ms is still ONE undo entry; a click / unmoved press on the edge is NONE', async ({ page }) => {
    await load(page)
    await seedFrame(page, OUTER)
    const h0 = await history(page)
    await dragStrip(page, 0, 40, 30, { pauseMs: 800 })
    expect((await history(page)).past).toBe(h0.past + 1)
    const h1 = await history(page)
    const b = (await strip(page, 0).boundingBox())!
    await page.mouse.move(b.x + 30, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    expect((await history(page)).past, 'no movement ⇒ no entry').toBe(h1.past)
  })

  test('Esc and pointercancel mid-drag put the frame, the nodes and the waypoints back and change neither past nor future', async ({ page }) => {
    await load(page)
    await seedFrame(page, OUTER)
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { setEdgeData: (id: string, d: object) => void; edges: { id: string; data: object }[] } } } }).__loop.graph.getState()
      const e = g.edges.find((x) => x.id === 'e_ab')!
      g.setEdgeData('e_ab', { ...e.data, route: 'orthogonal', waypoints: [{ x: 200, y: 80 }] })
    })
    // make `future` non-empty so its preservation is observable
    await page.keyboard.press('Control+z')
    const p0 = await positions(page)
    const r0 = await rectOf(page, (await frameHead(page)).frames[0].id)
    const h0 = await history(page)
    expect(h0.future).toBeGreaterThan(0)
    for (const cancel of ['Escape', 'pointercancel'] as const) {
      await dragStrip(page, 0, 80, 50, {
        midway: async () => {
          await page.waitForTimeout(60) // the gesture writes once per animation frame
          // something really moved before the cancel
          expect((await positions(page)).a).not.toEqual(p0.a)
          if (cancel === 'Escape') await page.keyboard.press('Escape')
          else await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')))
          await page.mouse.up() // the release after a cancel is inert
        },
      })
      expect(await positions(page), `${cancel}: nodes restored`).toEqual(p0)
      expect(await rectOf(page, (await frameHead(page)).frames[0].id), `${cancel}: frame restored`).toEqual(r0)
      expect(await history(page), `${cancel}: no history change`).toEqual(h0)
    }
  })

  test('Alt+drag moves the frame ONLY — nodes, the nested frame and waypoints stay', async ({ page }) => {
    await load(page)
    const outer = await seedFrame(page, OUTER)
    const inner = await seedFrame(page, INNER)
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { setEdgeData: (id: string, d: object) => void; edges: { id: string; data: object }[] } } } }).__loop.graph.getState()
      const e = g.edges.find((x) => x.id === 'e_ab')!
      g.setEdgeData('e_ab', { ...e.data, route: 'orthogonal', waypoints: [{ x: 200, y: 80 }] })
    })
    const p0 = await positions(page)
    const h0 = await history(page)
    await dragStrip(page, 0, 70, 20, { alt: true })
    expect(await rectOf(page, outer)).toEqual(shifted(OUTER, 70, 20))
    expect(await rectOf(page, inner)).toEqual(INNER)
    expect(await positions(page)).toEqual(p0)
    expect(await waypointsOf(page, 'e_ab')).toEqual([{ x: 200, y: 80 }])
    expect((await history(page)).past).toBe(h0.past + 1)
  })

  test('manual waypoints translate only when BOTH ends of the edge are carried', async ({ page }) => {
    await load(page)
    await seedFrame(page, OUTER)
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { setEdgeData: (id: string, d: object) => void; edges: { id: string; data: object }[] } } } }).__loop.graph.getState()
      for (const [id, wp] of [['e_ab', { x: 200, y: 80 }], ['e_cd', { x: 700, y: 80 }]] as const) {
        const e = g.edges.find((x) => x.id === id)!
        g.setEdgeData(id, { ...e.data, route: 'orthogonal', waypoints: [wp] })
      }
    })
    await dragStrip(page, 0, 30, 10)
    expect(await waypointsOf(page, 'e_ab'), 'a and b are both carried').toEqual([{ x: 230, y: 90 }])
    expect(await waypointsOf(page, 'e_cd'), 'd is outside — left to the router').toEqual([{ x: 700, y: 80 }])
  })

  test('under the edit-lock and on mobile a saved frame is view + select only: no move, no resize, no rename, no colour, no delete, no tool', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, OUTER)
    const p0 = await positions(page)
    const setLocked = (locked: boolean) =>
      page.evaluate(
        (l) => (window as unknown as { __loop: { ui: { getState: () => { setCanvasLocked: (x: boolean) => void } } } }).__loop.ui.getState().setCanvasLocked(l),
        locked,
      )
    await setLocked(true)
    await expect(frameToolBtn(page)).toHaveCount(0)
    await expect(clearFramesBtn(page)).toHaveCount(0)
    // select via the strip still works
    await strip(page, 0).click({ position: { x: 10, y: 6 } })
    expect((await frameHead(page)).selectedId).toBe(id)
    await expect(page.locator('.lgr-frame__del')).toHaveCount(0)
    await expect(page.locator('.lgr-frame__resize')).toHaveCount(0)
    await expect(page.locator('.lgr-frame__swatches')).toHaveCount(0)
    await expect(page.locator('.lgr-frame__label--static')).toHaveCount(1)
    await expect(page.locator('input.lgr-frame__label')).toHaveCount(0)
    const h0 = await history(page)
    await dragStrip(page, 0, 60, 40)
    expect(await rectOf(page, id), 'locked: the frame does not move').toEqual(OUTER)
    expect(await positions(page), 'locked: the nodes do not move').toEqual(p0)
    expect((await history(page)).past).toBe(h0.past)
    await setLocked(false)
    await expect(frameToolBtn(page)).toHaveCount(1)
    // mobile: same contract
    await page.setViewportSize({ width: 390, height: 780 })
    await expect(page.locator('.lgr-frame')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__label--static')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__del')).toHaveCount(0)
    const m0 = await positions(page)
    const b = (await strip(page, 0).boundingBox().catch(() => null))
    if (b) {
      await page.mouse.move(b.x + 20, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 80, b.y + 60, { steps: 4 })
      await page.mouse.up()
    }
    expect(await rectOf(page, id), 'mobile: the frame does not move').toEqual(OUTER)
    expect(await positions(page), 'mobile: the nodes do not move').toEqual(m0)
  })

  test('dragging an AUTO frame promotes it AND carries its contents in ONE entry; undo removes the promoted frame, restores the nodes, never revives the suggestion', async ({ page }) => {
    await load(page)
    await page.evaluate(() =>
      (window as unknown as { __loop: { autoFrame: { setState: (p: object) => void } } }).__loop.autoFrame.setState({
        autoFrames: [{ id: 'auto_x', area: 1, label: '', rect: { x: -20, y: -20, w: 440, h: 100 }, members: ['a', 'b'] }],
        lastSignature: 'seeded',
      }),
    )
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(1)
    const p0 = await positions(page)
    const h0 = await history(page)
    await dragStrip(page, 0, 40, 30)
    const fh = await frameHead(page)
    expect(fh.frames).toHaveLength(1)
    expect(fh.frames[0].rect).toEqual({ x: 20, y: 10, w: 440, h: 100 })
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(0)
    const p1 = await positions(page)
    expect(p1.a).toEqual({ x: p0.a.x + 40, y: p0.a.y + 30 })
    expect(p1.b).toEqual({ x: p0.b.x + 40, y: p0.b.y + 30 })
    expect(p1.c).toEqual(p0.c)
    expect((await history(page)).past).toBe(h0.past + 1)
    await page.keyboard.press('Control+z')
    expect((await frameHead(page)).frames).toHaveLength(0)
    expect(await positions(page)).toEqual(p0)
    await expect(page.locator('.lgr-frame--auto'), 'the suggestion is not revived (§SF11.2)').toHaveCount(0)
  })

  test('after a carried move the autosave record and the export still hold { id, label, rect } frames — no members', async ({ page }) => {
    await load(page)
    await seedFrame(page, OUTER)
    await dragStrip(page, 0, 25, 15)
    const shapes = await page.evaluate(async () => {
      const L = (window as unknown as { __loop: { graph: { getState: () => { exportJSON: () => string } }; autosave: { flush: () => void } } }).__loop
      L.autosave.flush()
      const exp = JSON.parse(L.graph.getState().exportJSON()) as { frames: Record<string, unknown>[] }
      const rec = JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? '{}') as { frames?: Record<string, unknown>[] }
      return { exp: exp.frames.map((f) => Object.keys(f).sort()), rec: (rec.frames ?? []).map((f) => Object.keys(f).sort()) }
    })
    expect(shapes.exp).toEqual([['id', 'label', 'rect']])
    expect(shapes.rec).toEqual([['id', 'label', 'rect']])
  })

  test('the import hint outranks the frame-move hint: one note at a time, import first, frame-move only after it closes — and it is not consumed while hidden', async ({ page }) => {
    await load(page)
    await page.evaluate(() => localStorage.removeItem('loop-studio/contextual-help/1'))
    await page.reload()
    await load(page)
    // the import note first (a fresh import batch), THEN a saved frame — which
    // `addFrame` selects at once, so both triggers hold together
    await page.evaluate(() =>
      (window as unknown as { __loop: { ui: { getState: () => { setLastImportBatch: (v: object) => void } } } }).__loop.ui
        .getState()
        .setLastImportBatch({ count: 2, firstId: 'a', tables: ['Sheet1'] }),
    )
    await expect(page.locator('.hint-note')).toHaveCount(1)
    await seedFrame(page, OUTER)
    await strip(page, 0).click({ position: { x: 10, y: 6 } })
    await page.waitForTimeout(150)
    const notes = page.locator('.hint-note')
    await expect(notes).toHaveCount(1)
    await expect(notes.first()).toContainText(/Sheet1/)
    await expect(notes.first()).not.toContainText(/Alt/)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loop-studio/contextual-help/1') ?? '{}')), 'the hidden frame-move note is NOT consumed').not.toHaveProperty('frame-move')
    // close the import note; the frame is still selected → the frame-move note takes the slot
    await notes.first().locator('.hint-note__x').click()
    expect((await frameHead(page)).selectedId).not.toBeNull()
    await expect(page.locator('.hint-note', { hasText: /Alt/ })).toHaveCount(1)
    await expect(page.locator('.hint-note')).toHaveCount(1)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loop-studio/contextual-help/1') ?? '{}'))).toMatchObject({ 'frame-move': true })
  })

  test('an out-and-back gesture is a no-op: manual / auto × move / resize — origin rect at pointer-up ⇒ no entry, no promotion, nodes back', async ({ page }) => {
    await load(page)
    const manual = await seedFrame(page, OUTER)
    await page.evaluate(() =>
      (window as unknown as { __loop: { autoFrame: { setState: (p: object) => void } } }).__loop.autoFrame.setState({
        // fully contains ma (0,170) and mid (260,170); NOT nested in OUTER (its bottom passes y=260)
        autoFrames: [{ id: 'auto_x', area: 1, label: '', rect: { x: -20, y: 150, w: 440, h: 130 }, members: ['ma', 'mid'] }],
        lastSignature: 'seeded',
      }),
    )
    await expect(page.locator('.lgr-frame--auto')).toHaveCount(1)
    const p0 = await positions(page)
    const h0 = await history(page)
    const outAndBack = async (start: { x: number; y: number }) => {
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + 90, start.y + 60, { steps: 5 })
      await page.waitForTimeout(60) // the gesture writes once per animation frame
      // something really moved mid-gesture
      expect(await positions(page)).not.toEqual(p0)
      await page.mouse.move(start.x, start.y, { steps: 5 }) // back to the exact origin
      await page.mouse.up()
    }
    // frame order in the DOM: auto first (index 0), manual after (index 1)
    for (const [label, frameIndex] of [['manual', 1], ['auto', 0]] as const) {
      // move
      const sb = (await strip(page, frameIndex).boundingBox())!
      await outAndBack({ x: sb.x + 30, y: sb.y + sb.height / 2 })
      expect(await positions(page), `${label} move out-and-back: nodes back`).toEqual(p0)
      expect(await history(page), `${label} move out-and-back: no history change`).toEqual(h0)
      // resize (select first so the handle exists)
      await strip(page, frameIndex).click({ position: { x: 10, y: 6 } })
      const hb = (await page.locator('.lgr-frame').nth(frameIndex).locator('.lgr-frame__resize').boundingBox())!
      const r0 = label === 'manual' ? await rectOf(page, manual) : null
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await page.mouse.down()
      await page.mouse.move(hb.x + 80, hb.y + 50, { steps: 5 })
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 5 })
      await page.mouse.up()
      if (r0) expect(await rectOf(page, manual), 'manual resize out-and-back: rect back').toEqual(r0)
      expect(await history(page), `${label} resize out-and-back: no history change`).toEqual(h0)
    }
    await expect(page.locator('.lgr-frame--auto'), 'the auto frame was never promoted').toHaveCount(1)
    expect((await frameHead(page)).frames.map((f) => f.id)).toEqual([manual])
  })

  test('the first time a frame is selected a one-time note explains "edge drag carries contents / Alt+drag frame only"; it is listed in Contextual help', async ({ page }) => {
    await load(page)
    await page.evaluate(() => localStorage.removeItem('loop-studio/contextual-help/1'))
    await page.reload()
    await load(page)
    await seedFrame(page, OUTER)
    // (the fixture has 8 nodes, so the tier-3 Focus/Filter discovery note may
    // already hold the slot — the tier-1 frame-move note takes it over)
    await strip(page, 0).click({ position: { x: 10, y: 6 } })
    const note = page.locator('.hint-note')
    await expect(note).toHaveCount(1)
    await expect(note).toContainText(/Alt/)
    await note.locator('.hint-note__x').click()
    // closing it hands the slot back to whatever tier-3 note was waiting — the frame note itself is gone
    await expect(page.locator('.hint-note', { hasText: /Alt/ })).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loop-studio/contextual-help/1') ?? '{}'))).toMatchObject({ 'frame-move': true })
  })
})
