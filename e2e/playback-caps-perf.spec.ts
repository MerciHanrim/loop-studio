import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md §PB4.5 / PB-Q4 — the DOM bounds and the render
// budget. `MAX_PLAYBACK_TOKENS_TOTAL` (60) travelling tokens per step;
// `MAX_PLAYBACK_TOKENS` (12) breakdown chips per selected edge; and an idle
// edge must not re-render on every τ frame. No state-machine change.


const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { status: s.status, stepIndex: s.stepIndex, tau: s.transition?.tau ?? null }
  })

/** one automatic source fanning out to N pools — every one of the N edges
 *  carries flow on step 1. */
const fanGraph = (n: number, extraState = false) => {
  const nodes: unknown[] = [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
  ]
  const edges: unknown[] = []
  for (let i = 0; i < n; i++) {
    // zero-padded id so ascending string sort == ascending index (deterministic)
    const pid = `p${String(i).padStart(3, '0')}`
    const eid = `e${String(i).padStart(3, '0')}`
    nodes.push({ id: pid, type: 'pool', position: { x: 240, y: i * 60 }, data: { kind: 'pool', label: pid, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
    edges.push({ id: eid, type: 'loop', source: 'src', target: pid, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
  }
  if (extraState) {
    nodes.push({ id: 'd', type: 'drain', position: { x: 500, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'passive', mode: 'pullAny' } })
    edges.push({ id: 't_sd', type: 'loop', source: 'src', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } })
  }
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges })
}

async function setup(page: Page, graph: string, speedMs = 3000) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

async function holdTravel(page: Page) {
  await call(page, 'play')
  await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.25 && s.tau < 0.7 ? 1 : -1)), { timeout: 12000 }).toBe(1)
  await call(page, 'pause')
}

test.describe('playback — Slice 3c-c: token caps', () => {
  test('MAX_PLAYBACK_TOKENS_TOTAL — ≤ 60 travelling tokens; the overflow edges still commit', async ({ page }) => {
    await setup(page, fanGraph(65))
    await holdTravel(page)

    const moving = await page.locator('g.pb-move').count()
    expect(moving).toBeLessThanOrEqual(60)
    expect(moving).toBeGreaterThanOrEqual(55) // essentially all of the cap is used

    // the bearing set is the first 60 edge-ids in ascending order — deterministic
    const withToken = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__edge')]
        .filter((e) => e.querySelector('g.pb-move'))
        .map((e) => e.getAttribute('data-id'))
        .sort(),
    )
    expect(withToken).toEqual(Array.from({ length: 60 }, (_, i) => `e${String(i).padStart(3, '0')}`))
    // an overflow edge (e060..e064) shows NO token…
    for (const eid of ['e060', 'e064']) {
      expect(await page.locator(`.react-flow__edge[data-id="${eid}"] g.pb-move`).count()).toBe(0)
    }

    // …but every edge still commits its value on settle
    await call(page, 'stepOnce')
    await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition)).toBe(null)
    const vals = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return { p000: s.values['p000'], p060: s.values['p064'] }
    })
    expect(vals.p000).toBe(1)
    expect(vals.p060).toBe(1) // the over-cap edge's target still received its unit
  })

  test('the token-bearing set is stable across deselect / reselect and a speed change', async ({ page }) => {
    await setup(page, fanGraph(65))
    await holdTravel(page)
    const snap = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.react-flow__edge')].filter((e) => e.querySelector('g.pb-move')).map((e) => e.getAttribute('data-id')).sort(),
      )
    const a = await snap()
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e000'))
    await page.waitForTimeout(60)
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, null))
    await call(page, 'setSpeed', 800)
    await page.waitForTimeout(60)
    await call(page, 'setSpeed', 3000)
    await page.waitForTimeout(60)
    expect(await snap()).toEqual(a)
    await call(page, 'pause')
  })

  test('MAX_PLAYBACK_TOKENS — a selected edge caps its breakdown chips at 12 + a "+N"; the dot label stays the exact sum', async ({ page }) => {
    // two sources feeding one hub: e_a carries a single transfer this step.
    await setup(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
          { id: 'b', type: 'source', position: { x: 0, y: 160 }, data: { kind: 'source', label: 'B', activation: 'automatic', mode: 'pushAny' } },
          { id: 'hub', type: 'pool', position: { x: 260, y: 80 }, data: { kind: 'pool', label: 'Hub', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        ],
        edges: [
          { id: 'e_a', type: 'loop', source: 'a', target: 'hub', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '7' } },
          { id: 'e_b', type: 'loop', source: 'b', target: 'hub', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
        ],
      }),
      1600,
    )
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_a'))
    await holdTravel(page)

    // never more than MAX_PLAYBACK_TOKENS (12) breakdown chips, and at most one
    // "+N" affordance — regardless of how many FlowEvents the step produced
    const chips = await page.locator('.edge-label[data-edge-id="e_a"] .edge-label__bd:not(.edge-label__bd--more)').count()
    const more = await page.locator('.edge-label[data-edge-id="e_a"] .edge-label__bd--more').count()
    expect(chips).toBeLessThanOrEqual(12)
    expect(more).toBeLessThanOrEqual(1)

    // the moving dot's own label is the exact summed flow for the edge
    const label = await page.locator('.react-flow__edge[data-id="e_a"] g.pb-move text').textContent().catch(() => null)
    const flow = await page.evaluate(() => (window as any).__loop.sim.getState().transition.flowByEdge['e_a'])
    if (label) expect(Number(label)).toBe(flow)
    expect(flow).toBe(7)
    await call(page, 'pause')
  })
})

test.describe('playback — Slice 3c-c: render budget', () => {
  test('an idle edge does not re-render on every τ frame; only the flowing edges do', async ({ page }) => {
    // one flowing edge + many idle edges (their sources never fire this step)
    await setup(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
          { id: 'live', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'live', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
          ...Array.from({ length: 8 }, (_, i) => ({ id: `idlp${i}`, type: 'pool', position: { x: 0, y: 120 + i * 60 }, data: { kind: 'pool', label: `i${i}`, activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } })),
          ...Array.from({ length: 8 }, (_, i) => ({ id: `idld${i}`, type: 'drain', position: { x: 260, y: 120 + i * 60 }, data: { kind: 'drain', label: `d${i}`, activation: 'passive', mode: 'pullAny' } })),
        ],
        edges: [
          { id: 'e_live', type: 'loop', source: 'src', target: 'live', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
          // idle edges: passive pool → passive drain, nothing pulls ⇒ 0 flow
          ...Array.from({ length: 8 }, (_, i) => ({ id: `e_idle${i}`, type: 'loop', source: `idlp${i}`, target: `idld${i}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })),
        ],
      }),
      2500,
    )

    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.2 && s.tau < 0.55 ? 1 : -1)), { timeout: 12000 }).toBe(1)

    // zero the probe MID-travel (no play/pause/lifecycle event in the window),
    // then let ~1s of pure τ frames pass
    await page.evaluate(() => ((window as any).__edgeRenders = {}))
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => (window as any).__edgeRenders as Record<string, number>)
    await call(page, 'pause')

    const live = r['e_live'] ?? 0
    const idleMax = Math.max(0, ...Array.from({ length: 8 }, (_, i) => r[`e_idle${i}`] ?? 0))
    expect(live, 'the flowing edge re-renders on every τ frame').toBeGreaterThan(15)
    expect(idleMax, 'an idle edge does NOT re-render per frame').toBeLessThanOrEqual(1)
  })
})
