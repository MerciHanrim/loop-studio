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
  test.use({ reducedMotion: 'reduce' })

  test('every fired node shows `effective`, every activated-not-fired shows `evaluated`, the rest show no cue (§LGR5.1 / §LGR10.6)', async ({ page }) => {
    await loadRun(page)
    await commitOneStep(page)
    const { firedNodeIds, activatedNodeIds } = await simHead(page)

    // the fixture must actually exercise all three weights, or it proves nothing
    const evaluatedOnly = activatedNodeIds.filter((id) => !firedNodeIds.includes(id))
    expect(firedNodeIds.length, 'some node fired').toBeGreaterThan(0)
    expect(evaluatedOnly.length, 'some node was evaluated but did not fire').toBeGreaterThan(0)

    for (const id of firedNodeIds) {
      await expect(hasWave(page, id), `${id} ∈ fired → effective`).toHaveCount(1)
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
    // The frame reads, left→right: Feed/Busy = effective · Idle(selected)+Waste
    // = evaluated · Store = value changed, no cue · Iso = idle · P1/R1/Rbad =
    // model nodes, no cue (Rbad also carries the `!` flag).
    await expect(page.locator('.react-flow')).toHaveScreenshot('run-distinction-states.png', {
      maxDiffPixelRatio: 0.02,
    })
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

// docs/large-graph-readability.md §LGR6 — Slice 4a: TRANSIENT group frames +
// the opt-in Activity overlay. Session-only readability UI: no GraphDoc / wire /
// digest / undo / node-position change (§LGR8 / LGR-INV-1); frame create /
// label / resize / delete are not undo entries; a whole-graph swap drops them.

type FrameHead = { frames: { id: string; n: number; label: string; rect: { x: number; y: number; w: number; h: number } }[]; toolArmed: boolean; selectedId: string | null }
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

const gDigest = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __loop: { revisionIO: { currentTargetDigest: () => string } } }).__loop.revisionIO.currentTargetDigest(),
  )

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
    // a node that fired ⇒ carries the tint class + a positive --lgr-activity
    const firedId = head.firedNodeIds[0]
    const tint = await node(page, firedId).evaluate((el) => ({
      cls: el.classList.contains('lgr-active-tint'),
      op: getComputedStyle(el).getPropertyValue('--lgr-activity').trim(),
    }))
    expect(tint.cls).toBe(true)
    expect(Number(tint.op)).toBeGreaterThan(0)

    // an evaluated-but-not-fired node ⇒ NO tint (activity is `effective`-only)
    const evalOnly = head.activatedNodeIds.find((id) => !head.firedNodeIds.includes(id))!
    await expect(node(page, evalOnly)).not.toHaveClass(/lgr-active-tint/)
    // a fully idle node ⇒ no tint
    await expect(node(page, 'iso')).not.toHaveClass(/lgr-active-tint/)

    // sim Reset empties the accumulated tint, toggle stays on
    await page.evaluate(() =>
      (window as unknown as { __loop: { sim: { getState: () => { reset: () => void } } } }).__loop.sim.getState().reset(),
    )
    await expect(page.locator('.lgr-active-tint')).toHaveCount(0)
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')

    // a graph reload also clears it
    await commitOneStep(page)
    await expect(page.locator('.lgr-active-tint').first()).toBeVisible()
    await importGraph(page, GRAPH_RUN)
    await expect(page.locator('.lgr-active-tint')).toHaveCount(0)
  })
})
