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
    // src is an automatic source — it fires every step, so this trigger reliably
    // delivers a state effect on the following step
    { id: 's1', type: 'loop', source: 'src', target: 'b', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
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

// The travelling flow bead is now the docs/simulation-playback.md Slice 2
// choreography token (`.pb-move`): Step and Play take the same path, the token
// walks the real `d` in step with the store's τ, and it is REMOVED on settle
// (the value commit and the token clearing are the same beat).
test.describe('Playback choreography — the token reacts ONLY to real engine events', () => {
  test('a token only where a FlowEvent actually moves resource; gone at rest / on Reset', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(1400))
    await expect(page.locator('.pb-move, .flow-bead, .state-pulse')).toHaveCount(0) // rest

    await step(page) // src pushes 2 → A; A has nothing yet so r2/r3 carry 0
    // mid-travel: exactly one token on r1, none on r2 / r3
    await expect(page.locator('.react-flow__edge[data-id="r1"] .pb-move')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="r2"] .pb-move')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge[data-id="r3"] .pb-move')).toHaveCount(0)

    // it clears itself on settle (same beat as the value commit)
    await expect(page.locator('.pb-move')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => (window as any).__loop.sim.getState().stepIndex))
      .toBe(1)

    await step(page)
    await reset(page)
    await expect(page.locator('.pb-move, .flow-bead, .flow-trail, .state-pulse, .state-flash')).toHaveCount(0)
  })

  test('exactly one token per edge; it never restarts on Pause / re-render / selection', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(2400))
    await step(page)
    const token = page.locator('.react-flow__edge[data-id="r1"] .pb-move')
    await expect(token).toHaveCount(1)

    // once paused mid-travel, its position is a pure function of the frozen τ —
    // a re-render / selection change must not move it
    await page.evaluate(() => (window as any).__loop.sim.getState().pause())
    const t0 = await token.getAttribute('transform')
    await page.locator('.react-flow__node[data-id="a"]').click()
    await page.locator('.react-flow__node[data-id="b"]').click()
    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await expect(token).toHaveCount(1)
    expect(await token.getAttribute('transform')).toBe(t0)
    await page.waitForTimeout(250)
    expect(await token.getAttribute('transform')).toBe(t0) // still frozen a beat later
  })
})

// every animated group in the edges layer is CONDITIONALLY RENDERED behind `!rm`
// in LoopEdge (not merely CSS-suppressed) — so under `prefers-reduced-motion:
// reduce` there is literally no `animateMotion` / travelling element in the DOM
// to play, freeze, or restart.
const MOTION =
  '.react-flow__edges animateMotion, .flow-move, .pb-move, .pb-cue, .flow-bead, .flow-trail, .flow-token__n, .state-pulse, .state-flash'

test.describe('Canvas Refresh PR 2 — reduced motion: the flow bead contract', () => {
  test('a real FlowEvent renders NO moving element — a held static highlight + arrival cue instead', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page)
    await expect(page.locator(MOTION)).toHaveCount(0) // at rest

    await step(page) // src pushes 2 → A  (one real FlowEvent on r1)
    await expect(page.locator(MOTION)).toHaveCount(0) // NOTHING moves — no bead, no animateMotion

    // the substitute: a persistent highlight on the edge that carried flow…
    await expect(page.locator('.react-flow__edge[data-id="r1"] .flow-edge-pulse')).toHaveCount(1)
    // …and the arrival cue on the pool it landed in, HELD (no fade-to-0 keyframe)
    const arrival = page.locator('.react-flow__node[data-id="a"] .nodef__arrival')
    await expect(arrival).toHaveCount(1)
    const held = await arrival.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { anim: cs.animationName, op: Number(cs.opacity) }
    })
    expect(held.anim === 'none' || held.anim === '').toBe(true) // not animating
    expect(held.op).toBeGreaterThan(0.1) // and actually visible, not faded away

    // an edge that carried NOTHING this step gets no highlight (nothing inferred)
    await expect(page.locator('.react-flow__edge[data-id="r2"] .flow-edge-pulse')).toHaveCount(0)
  })

  test('the cues are HELD through Pause and only clear on Reset', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page)
    await step(page) // status → paused
    const pulse = page.locator('.react-flow__edge[data-id="r1"] .flow-edge-pulse')
    const arrival = page.locator('.react-flow__node[data-id="a"] .nodef__arrival')
    await expect(pulse).toHaveCount(1)
    await expect(arrival).toHaveCount(1)

    await page.waitForTimeout(800) // a beat later, still paused — no fade-out
    await expect(pulse).toHaveCount(1)
    await expect(arrival).toHaveCount(1)
    expect(Number(await pulse.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.1)
    await expect(page.locator(MOTION)).toHaveCount(0) // still nothing moving

    await reset(page)
    await expect(page.locator('.flow-edge-pulse, .state-edge-pulse, .nodef__wave, .nodef__arrival')).toHaveCount(0)
  })

  test('a state-edge effect under reduce is also static — no pulse travels', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page)
    for (let i = 0; i < 5; i++) {
      await step(page)
      await expect(page.locator(MOTION)).toHaveCount(0) // never, at any step
    }
    // s1 (src→b trigger, delay 0) has delivered by now ⇒ its static highlight is
    // shown and is the ONLY representation (no travelling `.state-pulse`)
    await expect(page.locator('.react-flow__edge[data-id="s1"] .state-edge-pulse')).toHaveCount(1)
    await expect(page.locator('.state-pulse, .state-flash')).toHaveCount(0)
  })
})

test.describe('Playback choreography — one token per event, merged sum', () => {
  test('one token per edge per step; label = the summed amount; never > 1', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(1400))
    await step(page)
    const token = page.locator('.react-flow__edge[data-id="r1"] .pb-move')
    await expect(token).toHaveCount(1)
    await expect(token.locator('.flow-token__n')).toHaveText('2') // src → A carries flow "2"

    // a multi-step run never shows more than one token on any edge at once
    for (let i = 0; i < 5; i++) {
      await step(page)
      for (const id of ['r1', 'r2', 'r3']) {
        expect(await page.locator(`.react-flow__edge[data-id="${id}"] .pb-move`).count()).toBeLessThanOrEqual(1)
      }
    }
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

    await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(1600))
    const before = await capture()
    await step(page)
    await expect(page.locator('.pb-move').first()).toBeVisible() // the token is live
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
