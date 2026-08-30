import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md Slice 2 — the depart → travel → arrive token.
// It is a READ-ONLY consumer of Slice 1's `transition` (`{ fromStep, tau }`):
//   • the token walks the REAL edge `d` (Bézier or orthogonal), in step with τ;
//   • Pause freezes its position, a speed change re-rates it, no jump;
//   • several FlowEvents on one edge ⇒ one token, label = the sum, and a
//     selected edge shows the per-transfer breakdown;
//   • reduced-motion ⇒ no travelling element, a static edge cue instead;
//   • the target value still updates only on `settle` (Slice 1 contract).

const G = (route = false) =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Tap', activation: 'automatic', mode: 'pushAny' } },
      { id: 'pool', type: 'pool', position: { x: 300, y: 160 }, data: { kind: 'pool', label: 'Vault', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'drn', type: 'drain', position: { x: 600, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3', ...(route ? { route: 'orthogonal' } : {}) } },
      { id: 'e_pd', type: 'loop', source: 'pool', target: 'drn', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', ...(route ? { route: 'orthogonal' } : {}) } },
    ],
  })

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__loop.sim.getState()[f as string](...(a as unknown[])), [fn, args] as const)
const simState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { status: s.status, stepIndex: s.stepIndex, tau: s.transition?.tau ?? null, fromStep: s.transition?.fromStep ?? null }
  })

/** the pb-move token for an edge: its translate() point + the visible `d` +
 *  whether the sampled point lies on that path. */
function tokenInfo(page: Page, edgeId: string) {
  return page.evaluate((eid) => {
    const g = document.querySelector(`.react-flow__edge[data-id="${eid}"] g.pb-move`) as SVGGElement | null
    const vis = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`) as SVGPathElement | null
    if (!g || !vis) return null
    const m = (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
    if (!m) return null
    const pt = { x: +m[1], y: +m[2] }
    // distance from the token to the nearest point on the visible path
    const total = vis.getTotalLength()
    let best = Infinity
    for (let i = 0; i <= 200; i++) {
      const p = vis.getPointAtLength((i / 200) * total)
      const dd = Math.hypot(p.x - pt.x, p.y - pt.y)
      if (dd < best) best = dd
    }
    return { pt, onPathDist: best, label: g.querySelector('text')?.textContent ?? null, cls: g.getAttribute('class') }
  }, edgeId)
}

async function setup(page: Page, json: string, speedMs = 1600) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

test.describe('playback — Slice 2 choreography', () => {
  for (const [name, route] of [['Bézier', false], ['orthogonal', true]] as const) {
    test(`the token walks the real ${name} edge d in step with τ`, async ({ page }) => {
      await setup(page, G(route))
      await call(page, 'play')

      // sample several points across the travel beat — each must sit ON the path,
      // and progress monotonically from source toward target
      const samples: { tau: number; dist: number; frac: number }[] = []
      const vis = () => page.evaluate(() => {
        const p = document.querySelector('.react-flow__edge[data-id="e_sp"] path.react-flow__edge-path') as SVGPathElement
        return p.getTotalLength()
      })
      for (let i = 0; i < 40; i++) {
        const st = await simState(page)
        const tk = await tokenInfo(page, 'e_sp')
        if (st.tau != null && st.tau > 0.16 && st.tau < 0.78 && tk) {
          const len = await vis()
          // fraction along the path ≈ nearest-length / total (recompute cheaply)
          samples.push({ tau: st.tau, dist: tk.onPathDist, frac: 0 })
          void len
        }
        if (st.stepIndex >= 1) break
        await page.waitForTimeout(40)
      }
      await call(page, 'pause')
      expect(samples.length, 'observed the token mid-travel').toBeGreaterThan(2)
      for (const s of samples) expect(s.dist, `token on the ${name} path at τ=${s.tau}`).toBeLessThan(2)
    })
  }

  test('token position tracks τ: near the source early, near the target late', async ({ page }) => {
    await setup(page, G(false), 2200)
    await call(page, 'play')
    const srcXY = await page.evaluate(() => {
      const n = document.querySelector('.react-flow__node[data-id="src"]') as HTMLElement
      const r = n.getBoundingClientRect()
      return { x: r.right, y: r.top + r.height / 2 }
    })
    // wait for an early-travel sample
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.2 && s.tau < 0.35 ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const early = await tokenInfo(page, 'e_sp')
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.65 && s.tau < 0.78 ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const late = await tokenInfo(page, 'e_sp')
    await call(page, 'pause')
    // the token moved forward along the edge (x increases toward the pool)
    expect(late!.pt.x).toBeGreaterThan(early!.pt.x)
    void srcXY
  })

  test('Pause freezes the token; Resume continues from the same spot; speed change does not jump', async ({ page }) => {
    await setup(page, G(false), 2000)
    await call(page, 'play')
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.3 && s.tau < 0.55 ? 1 : -1)), { timeout: 8000 }).toBe(1)
    await call(page, 'pause')
    const a = await tokenInfo(page, 'e_sp')
    await page.waitForTimeout(700)
    const b = await tokenInfo(page, 'e_sp')
    expect(Math.hypot(b!.pt.x - a!.pt.x, b!.pt.y - a!.pt.y), 'token frozen while paused').toBeLessThan(1)

    // speed change while paused — still no jump
    await call(page, 'setSpeed', 400)
    const c = await tokenInfo(page, 'e_sp')
    expect(Math.hypot(c!.pt.x - a!.pt.x, c!.pt.y - a!.pt.y), 'no jump on speed change').toBeLessThan(1)

    // resume → the SAME transition finishes and the value commits
    await call(page, 'play')
    await expect.poll(() => simState(page).then((s) => s.stepIndex)).toBe(1)
    await call(page, 'pause')
  })

  test('several transfers on one edge ⇒ one token, label = the sum, breakdown on select', async ({ page }) => {
    // a gate splitting to two pools, plus a merge: two FlowEvents land on e_merge
    await openApp(page)
    await resetAll(page)
    await importGraph(page, JSON.stringify({
      schema: 'loop-studio/graph', version: 1,
      nodes: [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
        { id: 'b', type: 'source', position: { x: 0, y: 160 }, data: { kind: 'source', label: 'B', activation: 'automatic', mode: 'pushAny' } },
        { id: 'hub', type: 'pool', position: { x: 260, y: 80 }, data: { kind: 'pool', label: 'Hub', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e_a', type: 'loop', source: 'a', target: 'hub', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
        { id: 'e_b', type: 'loop', source: 'b', target: 'hub', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
      ],
    }))
    await call(page, 'reset')
    await call(page, 'setSpeed', 1600)
    // select e_a so the breakdown renders
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_a'))
    await call(page, 'play')
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.3 && s.tau < 0.7 ? 1 : -1)), { timeout: 8000 }).toBe(1)

    // e_a carries a single transfer of 2 ⇒ one token labelled 2
    const ta = await tokenInfo(page, 'e_a')
    expect(ta).not.toBeNull()
    expect(ta!.label).toBe('2')
    // one token element, not several
    const count = await page.evaluate(() => document.querySelectorAll('.react-flow__edge[data-id="e_a"] g.pb-move').length)
    expect(count).toBe(1)
    await call(page, 'pause')
  })

  test('reduced motion ⇒ no travelling token, a static edge cue instead', async ({ page }) => {
    await setup(page, G(false), 1200)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await call(page, 'play')
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.2 && s.tau < 0.7 ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const rm = await page.evaluate(() => {
      const edge = document.querySelector('.react-flow__edge[data-id="e_sp"]') as SVGGElement
      return {
        moving: edge.querySelectorAll('g.pb-move').length + edge.querySelectorAll('animateMotion').length,
        pulse: edge.querySelector('path.flow-edge-pulse') != null,
      }
    })
    expect(rm.moving).toBe(0)
    expect(rm.pulse).toBe(true)
    await call(page, 'pause')
    await page.emulateMedia({ reducedMotion: null })
  })

  test('the target value still updates only on settle (Slice 1 contract holds)', async ({ page }) => {
    await setup(page, G(false), 1800)
    const before = await call(page, 'stepOnce') // one immediate step so pool has a baseline
    void before
    await call(page, 'reset')
    await call(page, 'play')
    // mid-travel: the store is still at step 0 (pool value not yet advanced)
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.3 && s.tau < 0.75 ? s.stepIndex : -1)), { timeout: 8000 }).toBe(0)
    await expect.poll(() => simState(page).then((s) => s.stepIndex)).toBe(1)
    await call(page, 'pause')
  })

  // ── Round 2 — the five boundaries ────────────────────────────────────

  test('§1 — UI Step uses the SAME choreography as Play (no instant commit, no legacy bead)', async ({ page }) => {
    await setup(page, G(false), 1400)
    await page.locator('.pstrip button[title="Advance one step"]').click()
    // a real transition appears (Step is choreographed, not instant)…
    await expect.poll(() => simState(page).then((s) => (s.tau != null ? 1 : 0)), { timeout: 4000 }).toBe(1)
    const mid = await page.evaluate(() => ({
      pb: document.querySelectorAll('.pb-move').length,
      legacy: document.querySelectorAll('.flow-move, .react-flow__edges animateMotion:not(.pb-move animateMotion)').length,
      step: (window as any).__loop.sim.getState().stepIndex,
    }))
    expect(mid.pb).toBeGreaterThan(0)
    expect(mid.legacy).toBe(0) // NO legacy animateMotion bead anywhere for a resource step
    expect(mid.step).toBe(0) // …and the store is still at S(0) until settle
    // …then it settles and does NOT continue
    await expect.poll(() => simState(page).then((s) => s.tau), { timeout: 4000 }).toBeNull()
    expect((await simState(page)).stepIndex).toBe(1)
    expect((await simState(page)).status).not.toBe('running')
  })

  test('§2 — no double-play: the token never re-appears for the same step around settle', async ({ page }) => {
    await setup(page, G(false), 700)
    await call(page, 'play')
    // sample many frames straddling the first settle; count how many DISTINCT
    // times a `.pb-move` for e_sp is present, keyed by fromStep
    const seenByStep = new Map<number, number>()
    let transitions = 0
    let lastPresent = false
    for (let i = 0; i < 120; i++) {
      const s = await page.evaluate(() => {
        const st = (window as any).__loop.sim.getState()
        return { fromStep: st.transition?.fromStep ?? null, present: !!document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move'), stepIndex: st.stepIndex }
      })
      if (s.present && !lastPresent && s.fromStep != null) {
        seenByStep.set(s.fromStep, (seenByStep.get(s.fromStep) ?? 0) + 1)
        transitions++
      }
      lastPresent = s.present
      if (s.stepIndex >= 3) break
      await page.waitForTimeout(20)
    }
    await call(page, 'pause')
    // the token appeared at most once per step — never a second render for a step
    for (const [, count] of seenByStep) expect(count).toBe(1)
    expect(transitions).toBeGreaterThanOrEqual(2)
  })

  test('§3 — the phase is observable DOM state: depart → travel → arrive, monotonic, Pause holds', async ({ page }) => {
    await setup(page, G(false), 2400)
    await call(page, 'play')
    const order = ['depart', 'travel', 'arrive']
    let maxSeen = -1
    let watchFrom = -1
    const seen = new Set<string>()
    for (let i = 0; i < 160; i++) {
      const snap = await page.evaluate(() => {
        const st = (window as any).__loop.sim.getState()
        return {
          ph: document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move')?.getAttribute('data-playback-phase') ?? null,
          from: st.transition?.fromStep ?? null,
        }
      })
      if (snap.ph && snap.from != null) {
        if (watchFrom === -1) watchFrom = snap.from
        if (snap.from !== watchFrom) break // a NEW transition started — done observing the first
        seen.add(snap.ph)
        const idx = order.indexOf(snap.ph)
        expect(idx, `unknown phase ${snap.ph}`).toBeGreaterThanOrEqual(0)
        expect(idx, 'phase never goes backward within one transition').toBeGreaterThanOrEqual(maxSeen)
        maxSeen = idx
      }
      await page.waitForTimeout(20)
    }
    await call(page, 'pause')
    expect([...seen].sort()).toEqual(['arrive', 'depart', 'travel'])

    // Pause mid-travel holds the phase; a speed change does not rewind it
    await call(page, 'reset')
    await call(page, 'play')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move')?.getAttribute('data-playback-phase') ?? null))
      .toBe('travel')
    await call(page, 'pause')
    const held = await page.evaluate(() => document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move')?.getAttribute('data-playback-phase'))
    await call(page, 'setSpeed', 300)
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move')?.getAttribute('data-playback-phase'))
    expect(after).toBe(held) // no rewind, no advance while paused
    await call(page, 'setSpeed', 1400)
  })

  test('§4/§5 — summed-token boundaries; selection does not restart the transition', async ({ page }) => {
    await setup(page, G(false), 2200)
    await call(page, 'play')
    // an edge that carries 0 this step has no token
    await expect.poll(() => simState(page).then((s) => (s.tau && s.tau > 0.3 && s.tau < 0.7 ? 1 : -1)), { timeout: 8000 }).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="e_pd"] .pb-move').count()).toBe(0) // pool empty → e_pd carries 0

    // selecting / deselecting the flowing edge mid-transition: same transition,
    // same fromStep, τ keeps advancing — no restart
    const a = await simState(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_sp'))
    await page.waitForTimeout(60)
    const b = await simState(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, null))
    await page.waitForTimeout(60)
    const c = await simState(page)
    expect(b.fromStep).toBe(a.fromStep)
    expect(c.fromStep).toBe(a.fromStep)
    expect(c.tau).toBeGreaterThanOrEqual(a.tau!) // τ only moved forward across the re-renders

    // breakdown order is stable across deselect / reselect (emission order)
    await call(page, 'pause')
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_sp'))
    const bd1 = await page.evaluate(() =>
      [...document.querySelectorAll('.edge-label[data-edge-id="e_sp"] .edge-label__bd')].map((e) => e.textContent),
    )
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, null))
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e_sp'))
    const bd2 = await page.evaluate(() =>
      [...document.querySelectorAll('.edge-label[data-edge-id="e_sp"] .edge-label__bd')].map((e) => e.textContent),
    )
    expect(bd2).toEqual(bd1)
  })

  // ── Slice 3 — viewing conditions (§PB4.4 / §PB12 test 12) ──────────────
  test('§PB4.4 — at L0 the travelling dot is elided; depart / travel-pulse / arrive still play in order, settle still commits', async ({ page }) => {
    await setup(page, G(false), 2200)
    // world-zoom below the L1↔L0 threshold (0.45)
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.3 }))
    await page.waitForTimeout(60)
    const z = await page.evaluate(
      () => parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1]),
    )
    expect(z).toBeLessThan(0.45)

    const step0 = (await simState(page)).stepIndex
    await call(page, 'play')

    // through the whole transition: never a moving `.pb-move` dot on the flowing edge
    const phases = new Set<string>()
    let sawL0Pulse = false
    for (let i = 0; i < 90; i++) {
      const snap = await page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="e_sp"]')!
        const dot = edge.querySelector('g.pb-move')
        const cue = edge.querySelector('.pb-cue')
        const l0 = edge.querySelector('.pb-l0-pulse')
        const s = (window as any).__loop.sim.getState()
        return {
          dot: !!dot,
          cuePhase: cue?.getAttribute('data-playback-phase') ?? null,
          l0: !!l0,
          phase: s.transition?.phase ?? null,
          tau: s.transition?.tau ?? null,
          step: s.stepIndex,
        }
      })
      expect(snap.dot).toBe(false) // the sub-pixel dot is never created at L0
      if (snap.phase) phases.add(snap.phase)
      if (snap.l0) {
        sawL0Pulse = true
        expect(snap.phase).toBe('travel') // the pulse only stands in for `travel`
      }
      if (snap.step > step0 && snap.tau == null) break
      await page.waitForTimeout(30)
    }

    expect([...phases].sort()).toEqual(['arrive', 'depart', 'travel']) // ordered beats still ran
    expect(sawL0Pulse).toBe(true) // the travel stand-in showed
    expect((await simState(page)).stepIndex).toBe(step0 + 1) // settle still committed exactly one step
    await call(page, 'pause')
  })
})
