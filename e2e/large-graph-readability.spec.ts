import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

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

  test('forced-colors: the Focus ON toggle keeps a tell that is not just colour', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    const outline = () =>
      focusBtn(page).evaluate((el) => {
        const s = getComputedStyle(el)
        return `${s.outlineStyle} ${s.outlineWidth}`
      })
    expect(await outline()).toMatch(/none|0px/) // OFF: no outline
    await focusBtn(page).click()
    await expect(focusBtn(page)).toHaveAttribute('aria-pressed', 'true')
    const on = await outline()
    expect(on).not.toMatch(/none/)
    expect(on).not.toMatch(/\b0px\b/) // ON: a solid outline survives the colour override
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

  test('the edge-class axis offers all three: Resource / State / Dependency hint (§LGR3.2 / LGR-D4)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    const group = filterPanel(page).locator('.lgr-filter__group', { hasText: 'Edge type' })
    await expect(group.locator('.lgr-filter__row span')).toHaveText(['Resource', 'State', 'Dependency hint'])
    // a plain canvas has no dependency-hint edge, so ticking it hides nothing
    await filterRow(page, 'Dependency hint').check()
    for (const id of ['re1', 're2', 're3', 'rp', 'st1']) await expect(edgePath(page, id)).toHaveCount(1)
    await expect(filterPanel(page).locator('.lgr-filter__count')).toHaveText('Nothing hidden')
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

  test('hide a node kind → the node and its incident edges go; the 8 kinds all show (§LGR3.2 / §LGR10.5)', async ({ page }) => {
    await loadRT(page)
    await filterBtn(page).click()
    // `Drain` is offered even though this graph has none (the fixed 8-kind list)
    await expect(filterRow(page, 'Drain')).toHaveCount(1)
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

  test('forced-colors: the Filters ON toggle keeps a non-colour tell (§LGR9)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await loadRT(page)
    const outline = () =>
      filterBtn(page).evaluate((el) => {
        const s = getComputedStyle(el)
        return `${s.outlineStyle} ${s.outlineWidth}`
      })
    expect(await outline()).toMatch(/none|0px/)
    await filterBtn(page).click()
    await expect(filterBtn(page)).toHaveAttribute('aria-pressed', 'true')
    const on = await outline()
    expect(on).not.toMatch(/none/)
    expect(on).not.toMatch(/\b0px\b/)
  })
})
