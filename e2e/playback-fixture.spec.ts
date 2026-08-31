import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// Imports the committed `examples/playback-choreography.json` through the real
// Import path and checks the Simulation Playback / Event Choreography cycle
// end to end on ONE graph: every travelling cue kind renders, the global
// 60-token budget bites, orthogonal and Bézier share the real `d`, and playing
// / pausing / resetting the run moves NOTHING that belongs to the document or
// the committed engine result.
//
// There is deliberately NO `*.expected.json` oracle here — Playback is a display
// layer over the existing engine, so its "verification" is (a) this structural
// fixture spec, (b) the behavioural specs it links to in examples/README.md, and
// (c) the invariance assertions below. The engine oracle stays the ones under
// engine-b / state / model verification.

const FIXTURE = readFileSync(new URL('../examples/playback-choreography.json', import.meta.url), 'utf8')

type Bridge = {
  __loop: Record<string, { getState: () => any }> & {
    revisionIO: { currentTargetDigest: () => string }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o?: unknown) => void }
  }
}

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { status: s.status, stepIndex: s.stepIndex, tau: s.transition?.tau ?? null }
  })

/** every document-owned + committed-engine surface, normalised for comparison */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      viewport: l.rf.getViewport(),
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.type, n.position, n.data]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]),
      }),
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
      hit: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-interaction')].map((p) => p.getAttribute('d')),
      values: s.values,
      stepIndex: s.stepIndex,
    }
  })

/** hold a choreographed step mid-`travel` so every cue is on screen */
async function holdTravel(page: Page) {
  await call(page, 'setSpeed', 4000)
  await call(page, 'play')
  await expect
    .poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.25 && s.tau < 0.7 ? 1 : -1)), { timeout: 15000 })
    .toBe(1)
  await call(page, 'pause')
}

test.describe('playback-choreography.json — the Simulation Playback cycle on one graph', () => {
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: null }).catch(() => {})
  })

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, FIXTURE)
    await expect(page.locator('.react-flow__node')).toHaveCount(74)
    await call(page, 'reset')
  })

  test('imports intact — 74 nodes, 72 edges, four state edges, six orthogonal', async ({ page }) => {
    const g = await page.evaluate(() => {
      const s = (window as any).__loop.graph.getState()
      return {
        nodes: s.nodes.length,
        edges: s.edges.length,
        state: s.edges.filter((e: any) => e.data?.kind === 'state').map((e: any) => [e.id, e.data.mode]).sort(),
        orthogonal: s.edges.filter((e: any) => e.data?.route === 'orthogonal').map((e: any) => e.id).sort(),
      }
    })
    expect(g.nodes).toBe(74)
    expect(g.edges).toBe(72)
    expect(g.state).toEqual([['a_gd', 'activator'], ['l_add', 'label'], ['l_sub', 'label'], ['t_sd', 'trigger']])
    expect(g.orthogonal).toEqual(['m_a', 'm_b', 'zf00', 'zf01', 'zf02', 'zf03'])
    await expect(page.locator('.react-flow__edge[data-id="zf00"] path.route-orthogonal')).toHaveCount(1)
  })

  test('every travelling cue kind renders, and the global 60-token budget bites', async ({ page }) => {
    await call(page, 'advance') // step 1 → Gate Pool = 1, trigger scheduled for step 2
    await holdTravel(page) // step 2, mid-travel

    // resource token, state trigger bead, both signed label beads — all present
    expect(await page.locator('.react-flow__edge[data-id="m_a"] g.pb-move').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="t_sd"] g.state-move--trigger').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="l_add"] g.state-move--label.state-move--in').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="l_sub"] g.state-move--label.state-move--out').count()).toBe(1)
    // resource ↔ state never cross onto each other's edge
    expect(await page.locator('.react-flow__edge[data-id="t_sd"] g.pb-move').count()).toBe(0)
    expect(await page.locator('.react-flow__edge[data-id="m_a"] g.state-move').count()).toBe(0)

    // 68 flowing resource + 1 trigger + 2 label = 71 candidates ⇒ exactly 60 animate
    const travelling = await page.locator('g.pb-move, g.state-move').count()
    expect(travelling).toBeLessThanOrEqual(60)
    expect(travelling).toBe(60)
    // no edge renders more than one travelling element
    const maxPerEdge = await page.evaluate(() =>
      Math.max(0, ...[...document.querySelectorAll('.react-flow__edge')].map((e) => e.querySelectorAll('g.pb-move, g.state-move').length)),
    )
    expect(maxPerEdge).toBe(1)
    await call(page, 'pause')
  })

  test('the activator edge never renders a travelling bead; its event still commits', async ({ page }) => {
    // (the `arrive`-beat target-cue timing itself is locked by
    // playback-choreography.spec.ts "activator does not travel")
    await call(page, 'advance') // step 1 → Gate Pool = 1
    await holdTravel(page) // step 2, mid-travel
    expect(await page.locator('.react-flow__edge[data-id="a_gd"] g.state-move').count()).toBe(0)
    await call(page, 'stepOnce') // settle
    await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition)).toBe(null)
    const activatorEvent = await page.evaluate(() =>
      (window as any).__loop.sim
        .getState()
        .stateEvents.find((e: any) => e.edgeId === 'a_gd'),
    )
    expect(activatorEvent?.effect).toEqual({ kind: 'activator', satisfied: true })
  })

  test('the token walks the real d on both an orthogonal and a Bézier edge', async ({ page }) => {
    await holdTravel(page)
    for (const eid of ['m_a' /* orthogonal */, 'zf40' /* Bézier */]) {
      const onPath = await page.evaluate((id) => {
        const g = document.querySelector(`.react-flow__edge[data-id="${id}"] g.pb-move`) as SVGGElement | null
        const vis = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`) as SVGPathElement | null
        if (!g || !vis) return null
        const m = (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
        if (!m) return null
        const pt = { x: +m[1], y: +m[2] }
        const total = vis.getTotalLength()
        let best = Infinity
        for (let i = 0; i <= 240; i++) {
          const q = vis.getPointAtLength((i / 240) * total)
          best = Math.min(best, Math.hypot(q.x - pt.x, q.y - pt.y))
        }
        return best
      }, eid)
      expect(onPath, `token on the rendered d of ${eid}`).not.toBeNull()
      expect(onPath!).toBeLessThan(2)
    }
    await call(page, 'pause')
  })

  test('reduced motion and L0 both drop every travelling element (static / settle cues remain)', async ({ page }) => {
    await call(page, 'advance')

    // reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await call(page, 'play')
    await page.waitForTimeout(400)
    expect(await page.locator('g.pb-move, g.state-move').count()).toBe(0)
    await call(page, 'pause')

    // L0 — world zoom < 0.45, full motion
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await call(page, 'reset')
    await call(page, 'advance')
    await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.3 }, { duration: 0 }))
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)).toBeLessThan(0.45)
    await call(page, 'setSpeed', 4000)
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.2 && s.tau < 0.7 ? 1 : -1)), { timeout: 15000 }).toBe(1)
    expect(await page.locator('g.pb-move, g.state-move').count()).toBe(0)
    await call(page, 'pause')
  })

  test('playing / pausing / resetting moves no GraphDoc / digest / undo / viewport / edge d — and no committed value', async ({ page }) => {
    const before = await snapshot(page)

    await call(page, 'setSpeed', 250)
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex), { timeout: 15000 }).toBeGreaterThan(2)
    const mid = await snapshot(page)
    expect(mid.digest).toBe(before.digest)
    expect(mid.graph).toBe(before.graph)
    expect([mid.canUndo, mid.canRedo]).toEqual([before.canUndo, before.canRedo])
    expect(mid.viewport).toEqual(before.viewport)
    expect(mid.d).toEqual(before.d)
    expect(mid.hit).toEqual(before.hit)

    await expect.poll(() => sim(page).then((s) => s.stepIndex), { timeout: 15000 }).toBeGreaterThan(5)
    await call(page, 'pause')
    // choreographed Play must commit EXACTLY a pure advance()-only run of the
    // same length — the engine oracle stays untouched by the display layer.
    const played = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      const reached = s.stepIndex
      const playedValues = { ...s.values }
      s.reset()
      for (let i = 0; i < reached; i++) s.advance()
      const oracleValues = { ...s.values }
      s.reset()
      return { reached, playedValues, oracleValues }
    })
    expect(played.reached).toBeGreaterThan(5)
    expect(played.playedValues).toEqual(played.oracleValues)

    await call(page, 'reset')
    const after = await snapshot(page)
    expect(after).toEqual(before) // byte-for-byte back to the imported state
  })
})
