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

/** ONE step that produces all three travelling-cue kinds at once:
 *  40 resource transfers + 20 `trigger` deliveries + 20 non-zero `label` deltas
 *  (default). Edge ids `c000..c079` interleave the kinds (`i % 4 < 2` resource,
 *  `== 2` trigger, `== 3` label), so ascending-id order mixes all three and the
 *  over-budget tail (`c060..c079`) also spans all three. `reverse` emits the
 *  node / edge arrays back-to-front to prove the budget ignores input order.
 *  Trigger deliveries land one step after the source fires, so drive it as
 *  `advance()` (step 1) then a choreographed step 2. */
const mixedGraph = (reverse = false) => {
  const nodes: any[] = [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'feed', type: 'pool', position: { x: 0, y: -220 }, data: { kind: 'pool', label: 'F', activation: 'passive', initial: 100000, capacity: null, mode: 'pullAny' } },
    { id: 'tank', type: 'pool', position: { x: 420, y: -220 }, data: { kind: 'pool', label: 'T', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ]
  const edges: any[] = []
  for (let i = 0; i < 80; i++) {
    const eid = `c${String(i).padStart(3, '0')}`
    const m = i % 4
    if (m < 2) {
      nodes.push({ id: `p${eid}`, type: 'pool', position: { x: 320, y: i * 24 }, data: { kind: 'pool', label: eid, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
      edges.push({ id: eid, type: 'loop', source: 'src', target: `p${eid}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
    } else if (m === 2) {
      nodes.push({ id: `d${eid}`, type: 'drain', position: { x: 320, y: i * 24 }, data: { kind: 'drain', label: eid, activation: 'passive', mode: 'pullAny' } })
      edges.push({ id: eid, type: 'loop', source: 'src', target: `d${eid}`, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } })
    } else {
      edges.push({ id: eid, type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+1' } })
    }
  }
  if (reverse) {
    nodes.reverse()
    edges.reverse()
  }
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges })
}
const C = (i: number) => `c${String(i).padStart(3, '0')}`
/** the sorted set of edge-ids carrying ANY travelling cue right now */
const travellingSet = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.react-flow__edge')]
      .filter((e) => e.querySelector('g.pb-move, g.state-move'))
      .map((e) => e.getAttribute('data-id'))
      .sort(),
  )

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

/** prime step 1 (no choreography) so `trigger`s are scheduled, then Play and
 *  freeze step 2 mid-`travel` — resource + trigger + label all in flight. */
async function holdMixedTravel(page: Page) {
  await call(page, 'advance')
  await call(page, 'play')
  await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.25 && s.tau < 0.7 ? 1 : -1)), { timeout: 12000 }).toBe(1)
  await call(page, 'pause')
}

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null }).catch(() => {})
})

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

    // §PB4.5 — `shown + N` must account for EVERY transfer on the edge (nothing
    // silently dropped). The breakdown only renders when there is more than one
    // transfer; Engine A emits exactly one transfer per edge per step, so here
    // the single transfer shows as the token label with no breakdown span.
    const nMore =
      more === 0
        ? 0
        : Number(
            (
              (await page.locator('.edge-label[data-edge-id="e_a"] .edge-label__bd--more').textContent()) ?? '+0'
            ).replace('+', ''),
          )
    const evCount = await page.evaluate(
      () => (window as any).__loop.sim.getState().transition.events.filter((e: any) => e.edgeId === 'e_a').length,
    )
    if (evCount > 1) {
      expect(chips).toBeGreaterThan(0)
      expect(chips).toBeLessThanOrEqual(12)
      expect(chips + nMore).toBe(evCount) // shown + N == the edge's transfer count
    } else {
      expect(chips).toBe(0) // one transfer ⇒ no breakdown; the token label carries it
    }

    // the moving dot's own label is the exact summed flow for the edge
    const label = await page.locator('.react-flow__edge[data-id="e_a"] g.pb-move text').textContent().catch(() => null)
    const flow = await page.evaluate(() => (window as any).__loop.sim.getState().transition.flowByEdge['e_a'])
    if (label) expect(Number(label)).toBe(flow)
    expect(flow).toBe(7)
    await call(page, 'pause')
  })
})

test.describe('playback — Slice 3c-c: ONE global travel budget (resource + trigger + label)', () => {
  test('mixed 40 resource + 20 trigger + 20 label ⇒ ≤ 60 travelling elements total', async ({ page }) => {
    await setup(page, mixedGraph())
    await holdMixedTravel(page)

    const pb = await page.locator('g.pb-move').count()
    const stTrig = await page.locator('g.state-move.state-move--trigger').count()
    const stLabel = await page.locator('g.state-move.state-move--label').count()
    // the cap spans ALL three kinds together — never resource-60 + state-60
    expect(pb + stTrig + stLabel).toBeLessThanOrEqual(60)
    expect(pb + stTrig + stLabel).toBe(60) // essentially the whole budget is used
    // and it is a genuine mix, not one kind starving the others
    expect(pb).toBeGreaterThan(0)
    expect(stTrig).toBeGreaterThan(0)
    expect(stLabel).toBeGreaterThan(0)

    // the bearing set is the deterministic first-60 by (edgeId, cueKind, ord)
    expect(await travellingSet(page)).toEqual(Array.from({ length: 60 }, (_, i) => C(i)))
    await call(page, 'reset')
  })

  test('the chosen 60 are independent of node / edge input order', async ({ page }) => {
    await setup(page, mixedGraph(false))
    await holdMixedTravel(page)
    const forward = await travellingSet(page)
    await call(page, 'reset')

    await resetAll(page)
    await importGraph(page, mixedGraph(true)) // arrays emitted back-to-front
    await call(page, 'reset')
    await call(page, 'setSpeed', 3000)
    await holdMixedTravel(page)
    const reversed = await travellingSet(page)

    expect(reversed).toEqual(forward)
    expect(reversed).toEqual(Array.from({ length: 60 }, (_, i) => C(i)))
    await call(page, 'reset')
  })

  test('the budget set is stable across deselect / reselect, speed change, and Pause / Resume', async ({ page }) => {
    await setup(page, mixedGraph())
    await holdMixedTravel(page)
    const a = await travellingSet(page)

    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'c000'))
    await page.waitForTimeout(60)
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, null))
    await call(page, 'setSpeed', 700)
    await page.waitForTimeout(60)
    await call(page, 'setSpeed', 3000)
    await call(page, 'play')
    await page.waitForTimeout(80)
    await call(page, 'pause')

    expect(await travellingSet(page)).toEqual(a)
    await call(page, 'reset')
  })

  test('over-budget resource AND state events still commit their result on settle', async ({ page }) => {
    await setup(page, mixedGraph())
    await holdMixedTravel(page)
    await call(page, 'stepOnce') // settle step 2
    await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition)).toBe(null)

    const s = await page.evaluate(() => {
      const st = (window as any).__loop.sim.getState()
      return {
        pIn: st.values['pc000'], // in-budget resource target
        pOut: st.values['pc060'], // over-budget resource target (c060 has NO token)
        tank: st.values['tank'], // every label edge feeds this
        trigDelivered: st.stateEvents.filter((e: any) => e.effect.kind === 'trigger' && e.effect.delivered).length,
      }
    })
    expect(s.pIn).toBe(2) // +1 on step 1, +1 on step 2
    expect(s.pOut).toBe(2) // the over-cap edge's target still received both units
    expect(s.tank).toBe(40) // 20 label edges × +1 × 2 steps — ALL of them, incl. the 5 over-budget
    expect(s.trigDelivered).toBe(20) // every trigger delivered, incl. the 5 over-budget
    await call(page, 'reset')
  })

  test('an over-budget trigger / label draws NO travelling substitute anywhere', async ({ page }) => {
    await setup(page, mixedGraph())
    await holdMixedTravel(page)

    // c062 (trigger) and c063 (label) are in the over-budget tail
    for (const eid of ['c060', 'c062', 'c063']) {
      const n = await page
        .locator(`.react-flow__edge[data-id="${eid}"]`)
        .evaluate((el) => el.querySelectorAll('g.pb-move, g.state-move, .pb-cue, .pb-l0-pulse, .state-edge-pulse, animateMotion, .flow-move').length)
      expect(n, `${eid} shows no travelling / legacy cue`).toBe(0)
    }
    // …while their in-budget siblings each show exactly one
    expect(await page.locator('.react-flow__edge[data-id="c000"] g.pb-move').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="c002"] g.state-move--trigger').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="c003"] g.state-move--label').count()).toBe(1)
    await call(page, 'reset')
  })

  test('reduced motion and L0 both hold every travelling cue to zero (settle cues remain)', async ({ page }) => {
    // reduced motion
    await setup(page, mixedGraph())
    await call(page, 'advance')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await call(page, 'play')
    await page.waitForTimeout(400)
    expect(await page.locator('g.pb-move, g.state-move').count()).toBe(0)
    await call(page, 'pause')
    await page.emulateMedia({ reducedMotion: null })

    // L0 (world zoom < 0.45), full motion
    await call(page, 'reset')
    await call(page, 'advance')
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.3 }))
    await page.waitForTimeout(60)
    await call(page, 'setSpeed', 3000)
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.2 && s.tau < 0.7 ? 1 : -1)), { timeout: 12000 }).toBe(1)
    expect(await page.locator('g.pb-move, g.state-move').count()).toBe(0)
    await call(page, 'pause')
    await call(page, 'reset')
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

  test('an idle STATE edge is held to the same rule — no per-τ-frame re-render', async ({ page }) => {
    // an active resource edge + an active label edge (fires every step) drive the
    // transition; the idle state edges (delay-99 triggers — scheduled, never
    // delivered this step) must not re-render on τ ticks.
    await setup(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
          { id: 'live', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'live', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
          { id: 'feed', type: 'pool', position: { x: 0, y: -160 }, data: { kind: 'pool', label: 'F', activation: 'passive', initial: 100000, capacity: null, mode: 'pullAny' } },
          { id: 'tk', type: 'pool', position: { x: 240, y: -160 }, data: { kind: 'pool', label: 'T', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
          ...Array.from({ length: 8 }, (_, i) => ({ id: `sd${i}`, type: 'drain', position: { x: 240, y: 120 + i * 50 }, data: { kind: 'drain', label: `sd${i}`, activation: 'passive', mode: 'pullAny' } })),
        ],
        edges: [
          { id: 'e_live', type: 'loop', source: 'src', target: 'live', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
          { id: 'lbl_live', type: 'loop', source: 'feed', target: 'tk', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+1' } },
          // idle state edges: a pulse is scheduled 99 steps out, so no StateEvent
          // this step ⇒ the selector returns null both frames
          ...Array.from({ length: 8 }, (_, i) => ({ id: `s_idle${i}`, type: 'loop', source: 'src', target: `sd${i}`, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 99 } })),
        ],
      }),
      2500,
    )

    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => (s.tau != null && s.tau > 0.2 && s.tau < 0.55 ? 1 : -1)), { timeout: 12000 }).toBe(1)
    await page.evaluate(() => ((window as any).__edgeRenders = {}))
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => (window as any).__edgeRenders as Record<string, number>)
    await call(page, 'pause')

    const live = r['e_live'] ?? 0
    const lblLive = r['lbl_live'] ?? 0
    const idleStateMax = Math.max(0, ...Array.from({ length: 8 }, (_, i) => r[`s_idle${i}`] ?? 0))
    expect(live, 'the flowing resource edge re-renders per τ frame').toBeGreaterThan(15)
    expect(lblLive, 'an ACTIVE state edge re-renders per τ frame').toBeGreaterThan(15)
    expect(idleStateMax, 'an idle state edge does NOT re-render per frame').toBeLessThanOrEqual(1)
  })
})
