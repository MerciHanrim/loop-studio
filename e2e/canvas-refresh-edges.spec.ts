import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL6 / §VL9 — Canvas Visual Refresh PR 2: edge class,
// the direction marker, the flow bead, and reduced-motion. NO zoom LOD, NO
// forced-colors matrix (PR 3).

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'a', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'b', type: 'pool', position: { x: 520, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'sink', type: 'drain', position: { x: 780, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'r1', type: 'loop', source: 'src', target: 'a', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
    { id: 'r2', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'r3', type: 'loop', source: 'b', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 's1', type: 'loop', source: 'b', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name: 'g.json',
    mimeType: 'application/json',
    buffer: Buffer.from(GRAPH, 'utf8'),
  })
  await expect(page.locator('.react-flow__node[data-id="src"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="r1"] path.react-flow__edge-path')).toHaveCount(1)
  await page.evaluate(() => document.fonts.ready)
}

const edgePath = (page: Page, id: string) =>
  page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)
const step = (page: Page) => page.locator('.pstrip button[title="Advance one step"]').click()
const reset = (page: Page) => page.locator('.pstrip button[title="Reset to step 0"]').click()

test.describe('Canvas Refresh PR 2 — edge class & direction', () => {
  test('resource vs state edge is distinguishable WITHOUT colour (solid vs dashed)', async ({ page }) => {
    await load(page)
    const res = await edgePath(page, 'r1').evaluate((el) => getComputedStyle(el).strokeDasharray)
    const st = await edgePath(page, 's1').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(res).toMatch(/none|^$/) // resource — solid
    expect(st).toMatch(/\d/) // state — dashed
  })

  test('the direction marker is renderer-owned, tokenised, and present in light AND dark', async ({ page }) => {
    await load(page)
    // the renderer's own <defs> — three tokenised arrows, always mounted, never
    // React Flow's fixed-grey built-in marker
    await expect(page.locator('svg.loop-edge-defs .loop-arrow')).toHaveCount(3)
    await expect(page.locator('.react-flow__arrowhead')).toHaveCount(0)

    // each edge class terminates in its own arrow
    expect(await edgePath(page, 'r1').getAttribute('marker-end')).toBe('url(#loop-arrow-resource)')
    expect(await edgePath(page, 's1').getAttribute('marker-end')).toBe('url(#loop-arrow-state)')

    // the arrow fill resolves THROUGH the edge token, so it holds contrast in
    // both themes — distinct light / dark values, not one fixed colour
    const fill = () =>
      page.locator('#loop-arrow-resource path').evaluate((el) => getComputedStyle(el).fill)
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await fill()
    await page.emulateMedia({ colorScheme: 'dark' })
    const dark = await fill()
    await page.emulateMedia({ colorScheme: null })
    expect(light).toMatch(/^rgb/)
    expect(dark).toMatch(/^rgb/)
    expect(light).not.toBe(dark)
  })
})

test.describe('Canvas Refresh PR 2 — flow bead reacts ONLY to real engine events', () => {
  test('no bead at rest; a bead only where a FlowEvent actually moved resource; cleared on Reset', async ({ page }) => {
    await load(page)
    await expect(page.locator('.flow-move, .flow-bead, .state-pulse')).toHaveCount(0) // rest

    await step(page) // src pushes 2 → A; A has nothing yet so r2/r3 carry 0
    await expect(page.locator('.react-flow__edge[data-id="r1"] .flow-move')).toHaveCount(1)
    // r2 / r3 carried no resource this step ⇒ NO bead (not visually inferred)
    await expect(page.locator('.react-flow__edge[data-id="r2"] .flow-move')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge[data-id="r3"] .flow-move')).toHaveCount(0)

    await reset(page)
    await expect(page.locator('.flow-move, .flow-bead, .flow-trail, .state-pulse, .state-flash')).toHaveCount(0)
  })

  test('Pause freezes the bead — one element, a single-shot animateMotion (never looping)', async ({ page }) => {
    await load(page)
    await step(page)
    const bead = page.locator('.react-flow__edge[data-id="r1"] .flow-move')
    await expect(bead).toHaveCount(1)
    const repeat = await bead.locator('animateMotion').first().getAttribute('repeatCount')
    expect(repeat).toBe('1') // not "indefinite"
  })
})

test.describe('Canvas Refresh PR 2 — reduced motion', () => {
  test('no travelling bead; a PERSISTENT static edge highlight carries the same info', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page)
    await step(page)

    await expect(page.locator('.react-flow__edge[data-id="r1"] .flow-move')).toHaveCount(0) // no travel
    const rm = page.locator('.react-flow__edge[data-id="r1"] .flow-edge-pulse')
    await expect(rm).toHaveCount(1)
    // it STAYS (no fade-out) — still one painted element after a beat, even paused
    await page.waitForTimeout(600)
    await expect(rm).toHaveCount(1)
    const held = await rm.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { opacity: Number(cs.opacity), stroke: cs.stroke, w: (el as SVGGraphicsElement).getBBox().width }
    })
    expect(held.opacity).toBeGreaterThan(0.1) // no fade
    expect(held.stroke).toMatch(/^rgb/) // resolves to --flow-strength — carries "flow moved here"
    expect(held.w).toBeGreaterThan(0) // a real path over the edge

    await reset(page)
    await expect(page.locator('.flow-edge-pulse, .state-edge-pulse')).toHaveCount(0)
    await page.emulateMedia({ reducedMotion: null })
  })
})

test.describe('Canvas Refresh PR 2 — animation is a pure view change (VL-INV)', () => {
  test('a running sim (beads / pulses animating) does not move the doc, geometry, or edge routes', async ({ page }) => {
    await load(page)
    const capture = () =>
      page.evaluate(() => {
        const l = (window as unknown as { __loop: { graph: { getState: () => any }; revisionIO: { currentTargetDigest: () => string } } }).__loop
        const g = l.graph.getState()
        const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null
        return {
          digest: l.revisionIO.currentTargetDigest(),
          canUndo: g.canUndo,
          canRedo: g.canRedo,
          positions: JSON.stringify(g.nodes.map((n: any) => [n.id, n.position.x, n.position.y])),
          edgePaths: JSON.stringify([...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => (p as SVGPathElement).getAttribute('d'))),
          hitPaths: JSON.stringify([...document.querySelectorAll('.react-flow__edge path.react-flow__edge-interaction')].map((p) => (p as SVGPathElement).getAttribute('d'))),
          viewport: vp ? vp.style.transform : '',
        }
      })

    const before = await capture()
    await step(page)
    await step(page)
    await step(page)
    await expect(page.locator('.flow-move').first()).toBeVisible() // beads are live
    const during = await capture()

    expect(during.digest).toBe(before.digest)
    expect(during.positions).toBe(before.positions)
    expect(during.edgePaths).toBe(before.edgePaths)
    expect(during.hitPaths).toBe(before.hitPaths) // pointer hit-area unchanged
    expect(during.canUndo).toBe(before.canUndo)
    expect(during.canRedo).toBe(before.canRedo)
    expect(during.viewport).toBe(before.viewport)
  })
})
