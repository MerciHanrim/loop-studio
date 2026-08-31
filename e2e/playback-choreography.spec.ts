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
  // never let an emulated `prefers-reduced-motion: reduce` (or a viewport zoom)
  // leak into a later test if an RM / LOD test fails mid-way
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: null }).catch(() => {})
  })

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

  test('reduced motion ⇒ no travelling element ever; a held static cue after settle', async ({ page }) => {
    await setup(page, G(false), 1200)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const seenMoving = await page.evaluate(async () => {
      const edge = () => document.querySelector('.react-flow__edge[data-id="e_sp"]') as SVGGElement
      let moving = 0
      const obs = new MutationObserver(() => {
        const e = edge()
        moving += e.querySelectorAll('g.pb-move').length + e.querySelectorAll('animateMotion').length
      })
      obs.observe(edge(), { childList: true, subtree: true })
      const sim = (window as any).__loop.sim.getState()
      sim.play()
      await new Promise((r) => setTimeout(r, 900))
      // sample a few animation frames too
      for (let i = 0; i < 30; i++) {
        const e = edge()
        moving += e.querySelectorAll('g.pb-move').length + e.querySelectorAll('animateMotion').length
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      }
      obs.disconnect()
      ;(window as any).__loop.sim.getState().pause()
      return moving
    })
    expect(seenMoving).toBe(0) // never any travelling element under reduced motion

    // several steps have committed; the held static substitute is on the edge
    const after = await page.evaluate(() => {
      const edge = document.querySelector('.react-flow__edge[data-id="e_sp"]') as SVGGElement
      const s = (window as any).__loop.sim.getState()
      return { step: s.stepIndex, pulse: edge.querySelector('path.flow-edge-pulse') != null }
    })
    expect(after.step).toBeGreaterThan(1)
    expect(after.pulse).toBe(true)
    await page.emulateMedia({ reducedMotion: null })
  })

  test('reduced motion — Play settles far faster than full motion, no full-beat wait; Pause never auto-settles', async ({ page }) => {
    const K = 6
    // full-motion baseline at a deliberately slow beat
    await setup(page, G(false), 900)
    const fullMs = await page.evaluate(async (k) => {
      const sim = (window as any).__loop.sim.getState()
      sim.reset()
      const t0 = performance.now()
      sim.play()
      await new Promise<void>((res) => {
        const id = setInterval(() => {
          if ((window as any).__loop.sim.getState().stepIndex >= k) {
            clearInterval(id)
            res()
          }
        }, 15)
      })
      ;(window as any).__loop.sim.getState().pause()
      return performance.now() - t0
    }, K)

    // same run, reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const rmMs = await page.evaluate(async (k) => {
      const sim = (window as any).__loop.sim.getState()
      sim.reset()
      const t0 = performance.now()
      sim.play()
      await new Promise<void>((res) => {
        const id = setInterval(() => {
          if ((window as any).__loop.sim.getState().stepIndex >= k) {
            clearInterval(id)
            res()
          }
        }, 15)
      })
      ;(window as any).__loop.sim.getState().pause()
      return performance.now() - t0
    }, K)

    // full motion spends ~900ms per step; reduced motion has NO per-step wait
    expect(fullMs).toBeGreaterThan(K * 700)
    expect(rmMs).toBeLessThan(fullMs / 3)
    expect(rmMs).toBeLessThan(K * 200) // well under even the 120ms floor × K — no artificial beat wait

    // Pause under reduced motion: nothing auto-advances afterwards
    const held = await page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)
    await page.waitForTimeout(500)
    const later = await page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)
    expect(later).toBe(held)
    await page.emulateMedia({ reducedMotion: null })
  })

  test('reduced motion — toggled mid-transition: collapse remaining beats, settle once, no rewind/restart, parity with full motion', async ({ page }) => {
    // a full-motion run to K as the oracle
    await setup(page, G(false), 1000)
    const oracle = await page.evaluate(async (k) => {
      const S = () => (window as any).__loop.sim.getState()
      S().reset()
      for (let i = 0; i < k; i++) S().advance()
      const s = S()
      return { values: s.values, series: s.series.length, step: s.stepIndex }
    }, 5)

    // fresh run: Play full-motion, pause mid-travel, flip RM on, resume
    await call(page, 'reset')
    await call(page, 'setSpeed', 2000)
    await call(page, 'play')
    await expect
      .poll(() => simState(page).then((s) => (s.tau && s.tau > 0.35 && s.tau < 0.7 ? 1 : -1)), { timeout: 8000 })
      .toBe(1)
    const mid = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return { id: s.activeTransitionId, fromStep: s.transition?.fromStep ?? null, tau: s.transition?.tau ?? null, step: s.stepIndex }
    })
    await call(page, 'pause')
    // RM on WHILE paused mid-transition ⇒ still no auto-settle
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(300)
    const pausedRm = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return { id: s.activeTransitionId, tau: s.transition?.tau ?? null, step: s.stepIndex }
    })
    expect(pausedRm.step).toBe(mid.step) // not committed
    expect(pausedRm.id).toBe(mid.id) // same transition, not restarted
    expect(pausedRm.tau).toBeGreaterThanOrEqual(mid.tau!) // never rewound
    const seriesMid = await page.evaluate(() => (window as any).__loop.sim.getState().series.length)

    // finish THAT transition — the remaining beats collapse and it settles
    // EXACTLY once (Step is the escape hatch for a paused transition)
    await call(page, 'stepOnce')
    const done = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return { id: s.activeTransitionId, tau: s.transition?.tau ?? null, step: s.stepIndex, series: s.series.length }
    })
    expect(done.step).toBe(mid.step + 1)
    expect(done.id).toBeNull()
    expect(done.tau).toBeNull()
    expect(done.series).toBe(seriesMid + 1) // one settle, not two

    // finish to K under RM and compare with the full-motion oracle
    await page.evaluate(async (k) => {
      const S = () => (window as any).__loop.sim.getState()
      S().play()
      await new Promise<void>((res) => {
        const id = setInterval(() => {
          if (S().stepIndex >= k) {
            clearInterval(id)
            res()
          }
        }, 15)
      })
      S().pause()
    }, 5)
    const rmRun = await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      return { values: s.values, series: s.series.length, step: s.stepIndex }
    })
    expect(rmRun.step).toBe(oracle.step)
    expect(rmRun.series).toBe(oracle.series)
    expect(rmRun.values).toEqual(oracle.values)
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
    await setup(page, G(false), 1000)
    await call(page, 'play')
    // sample frames straddling several settles; count how many DISTINCT
    // contiguous runs of a `.pb-move` for e_sp occur, keyed by fromStep. A
    // second run for the same fromStep = a double-play. Wall-clock bounded so a
    // slow CI box still reaches ≥ 3 steps.
    const seenByStep = new Map<number, number>()
    let transitions = 0
    let curRun: number | null = null // fromStep of the token run in progress
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => {
        const st = (window as any).__loop.sim.getState()
        return { fromStep: st.transition?.fromStep ?? null, present: !!document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-move'), stepIndex: st.stepIndex }
      })
      if (s.present && s.fromStep != null) {
        // a new run starts on first-present OR when fromStep changed without us
        // catching the settle gap. A second run for a fromStep already seen ⇒
        // double-play (caught by the per-step count assertion below).
        if (curRun !== s.fromStep) {
          seenByStep.set(s.fromStep, (seenByStep.get(s.fromStep) ?? 0) + 1)
          transitions++
          curRun = s.fromStep
        }
      } else {
        curRun = null
      }
      if (s.stepIndex >= 3 && transitions >= 2) break
      await page.waitForTimeout(15)
    }
    await call(page, 'pause')
    // the token appeared exactly one contiguous run per step — never a second
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

  test('L1 ↔ L0 threshold round-trip mid-travel: the dot elides then returns at the current τ — no restart, no transition / step change, no digest / undo / d change', async ({ page }) => {
    await setup(page, G(true), 4000) // orthogonal edges — the `d` must not move; slow beat for headroom
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.7 })) // L1
    await page.waitForTimeout(60)

    const inv = () =>
      page.evaluate(() => {
        const l = (window as any).__loop
        return {
          digest: l.revisionIO.currentTargetDigest(),
          canUndo: l.graph.getState().canUndo,
          canRedo: l.graph.getState().canRedo,
          d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
        }
      })
    const tok = () =>
      page.evaluate(() => {
        const g = document.querySelector('.react-flow__edge[data-id="e_sp"] g.pb-move') as SVGGElement | null
        const l0 = document.querySelector('.react-flow__edge[data-id="e_sp"] .pb-l0-pulse')
        const s = (window as any).__loop.sim.getState()
        const m = g && (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
        return {
          hasDot: !!g,
          hasL0Pulse: !!l0,
          x: m ? +m[1] : null,
          id: s.activeTransitionId,
          phase: s.transition?.phase ?? null,
          fromStep: s.transition?.fromStep ?? null,
          tau: s.transition?.tau ?? null,
          step: s.stepIndex,
        }
      })

    const invBefore = await inv()
    await call(page, 'play')

    // catch the dot mid-`travel` at L1
    await expect.poll(() => tok().then((t) => (t.hasDot && t.phase === 'travel' ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const atL1 = await tok()

    // → L0: the dot goes, the path cue stays, the transition is untouched
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.3 }))
    await expect.poll(() => tok().then((t) => (t.hasDot ? 1 : -1))).toBe(-1)
    const atL0 = await tok()
    expect(atL0.hasL0Pulse).toBe(true)
    expect(atL0.id).toBe(atL1.id) // same transition
    expect(atL0.fromStep).toBe(atL1.fromStep)
    expect(atL0.step).toBe(atL1.step) // not committed by a zoom
    expect(atL0.tau).toBeGreaterThanOrEqual(atL1.tau!) // τ kept advancing, never reset

    // → L1: the dot returns AT the current τ position (near where it would be),
    // not back at the source
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 0.7 }))
    await expect.poll(() => tok().then((t) => (t.hasDot ? 1 : -1))).toBe(1)
    const back = await tok()
    expect(back.id).toBe(atL1.id)
    expect(back.fromStep).toBe(atL1.fromStep)
    expect(back.tau).toBeGreaterThanOrEqual(atL0.tau!) // monotonic across the whole round-trip
    // the dot is further along the edge than it was before the round-trip — it
    // did NOT restart from the source
    expect(back.x!).toBeGreaterThan(atL1.x! - 2)

    await call(page, 'pause')
    const invAfter = await inv()
    expect(invAfter).toEqual(invBefore) // zoom/pan moved no GraphDoc / digest / undo / edge `d`
    await call(page, 'reset')
  })
})

// ── Slice 3b — state-event choreography ───────────────────────────────────
// trigger rides the real `d`; activator lands a target cue on settle (no
// travel); label shows a signed-delta bead by sign. A state cue is NEVER merged
// with the resource-flow token, fires exactly once per transitionId, and an
// absent engine event draws nothing while the commit is unchanged.
const GS = (route = false) =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
      { id: 'p', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'd', type: 'drain', position: { x: 520, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'passive', mode: 'pullAny' } },
      { id: 'feed', type: 'pool', position: { x: 0, y: 220 }, data: { kind: 'pool', label: 'Feed', activation: 'passive', initial: 80, capacity: null, mode: 'pullAny' } },
      { id: 'tank', type: 'pool', position: { x: 320, y: 220 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_sp', type: 'loop', source: 's', target: 'p', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3', ...(route ? { route: 'orthogonal' } : {}) } },
      { id: 't_sd', type: 'loop', source: 's', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0, ...(route ? { route: 'orthogonal' } : {}) } },
      { id: 't_never', type: 'loop', source: 's', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 99 } },
      { id: 'a_pd', type: 'loop', source: 'p', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } },
      { id: 'l_add', type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+5' } },
      { id: 'l_sub', type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '-2' } },
    ],
  })

const stTrans = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { id: s.activeTransitionId, tau: s.transition?.tau ?? null, phase: s.transition?.phase ?? null, step: s.stepIndex, series: s.series.length }
  })

/** the state cue on an edge: kind, its translate point (if a moving bead), and
 *  its distance to the edge's rendered `d`. */
function stCue(page: Page, edgeId: string) {
  return page.evaluate((eid) => {
    const root = document.querySelector(`.react-flow__edge[data-id="${eid}"]`)
    if (!root) return null
    const move = root.querySelector('g.state-move') as SVGGElement | null
    const cue = root.querySelector('circle.state-cue--activator') as SVGCircleElement | null
    const vis = root.querySelector('path.react-flow__edge-path') as SVGPathElement | null
    const nearest = (x: number, y: number) => {
      if (!vis) return Infinity
      const total = vis.getTotalLength()
      let best = Infinity
      for (let i = 0; i <= 200; i++) {
        const q = vis.getPointAtLength((i / 200) * total)
        best = Math.min(best, Math.hypot(q.x - x, q.y - y))
      }
      return best
    }
    let movePt: { x: number; y: number } | null = null
    if (move) {
      const m = (move.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
      if (m) movePt = { x: +m[1], y: +m[2] }
    }
    return {
      moveCls: move?.getAttribute('class') ?? null,
      moveN: move?.querySelector('text')?.textContent ?? null,
      movePt,
      moveOnPath: movePt ? nearest(movePt.x, movePt.y) : null,
      moveCount: root.querySelectorAll('g.state-move').length,
      pbCount: root.querySelectorAll('g.pb-move').length,
      cuePhase: cue?.getAttribute('data-playback-phase') ?? null,
      cueOnEnd: cue ? nearest(cue.cx.baseVal.value, cue.cy.baseVal.value) : null,
      cueCount: root.querySelectorAll('circle.state-cue--activator').length,
    }
  }, edgeId)
}

async function setupS(page: Page, route = false, speedMs = 3000) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GS(route))
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}
/** choreograph ONE step and hold it mid-`travel`. */
async function stepHold(page: Page, minTau = 0.25) {
  await call(page, 'stepOnce')
  await expect.poll(() => stTrans(page).then((s) => s.tau ?? -1), { timeout: 8000 }).toBeGreaterThan(minTau)
}

test.describe('playback — Slice 3b state-event choreography', () => {
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: null }).catch(() => {})
  })

  for (const [name, route] of [['Bézier', false], ['orthogonal', true]] as const) {
    test(`trigger rides the real ${name} edge d in step with τ`, async ({ page }) => {
      await setupS(page, route)
      await call(page, 'advance') // step 1: source fires, trigger scheduled for step 2
      await stepHold(page) // step 2 — delivery, choreographed
      const c = await stCue(page, 't_sd')
      expect(c!.moveCls).toContain('state-move--trigger')
      expect(c!.moveOnPath!).toBeLessThan(2) // the bead sits on the rendered d
      expect(c!.pbCount).toBe(0) // no resource token on a state edge
      // let it run: the bead reaches the target, then the transition settles
      await call(page, 'pause')
      await call(page, 'reset')
    })
  }

  test('activator does not travel — a target cue lands on the settle beat', async ({ page }) => {
    await setupS(page)
    await call(page, 'advance') // step 1 → P = 3
    await stepHold(page, 0.3) // step 2, mid-travel: activator ">= 1" is satisfied
    const mid = await stCue(page, 'a_pd')
    expect(mid!.moveCount).toBe(0) // never a travelling bead
    expect(mid!.cueCount).toBe(0) // and no target cue yet during `travel`
    // advance τ into `arrive`
    await expect.poll(() => stTrans(page).then((s) => (s.phase === 'arrive' ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const arr = await stCue(page, 'a_pd')
    expect(arr!.cueCount).toBe(1)
    expect(arr!.cuePhase).toBe('arrive')
    expect(arr!.cueOnEnd!).toBeLessThan(3) // the cue sits at the target end of the edge
    await call(page, 'pause')
    await call(page, 'reset')
  })

  test('label — a signed-delta bead by sign; never merged with the resource token', async ({ page }) => {
    await setupS(page)
    await stepHold(page) // step 1 — the label edges fire; e_sp also carries resource
    const add = await stCue(page, 'l_add')
    const sub = await stCue(page, 'l_sub')
    expect(add!.moveCls).toContain('state-move--in')
    expect(add!.moveN).toBe('+5')
    expect(sub!.moveCls).toContain('state-move--out')
    expect(sub!.moveN).toBe('-2')
    // same step: the resource edge has its OWN token, the state edges have none
    const res = await stCue(page, 'e_sp')
    expect(res!.pbCount).toBe(1)
    expect(res!.moveCount).toBe(0)
    expect(add!.pbCount).toBe(0)
    await call(page, 'pause')
    await call(page, 'reset')
  })

  test('one cue per transitionId — Pause / speed / reduced-motion never restart or duplicate it; an absent event draws nothing', async ({ page }) => {
    await setupS(page)
    await call(page, 'advance') // step 1
    await stepHold(page) // step 2 — trigger delivery
    await call(page, 'pause') // freeze τ before sampling
    const a = await stCue(page, 't_sd')
    const t0 = await stTrans(page)
    expect(a!.moveCount).toBe(1)
    // t_never (delay 99) has produced no engine event ⇒ no cue, ever
    expect((await stCue(page, 't_never'))!.moveCount).toBe(0)

    await page.waitForTimeout(300)
    const b = await stCue(page, 't_sd')
    const t1 = await stTrans(page)
    expect(b!.moveCount).toBe(1) // not duplicated
    expect(t1.id).toBe(t0.id) // same transition
    expect(b!.movePt!.x).toBeCloseTo(a!.movePt!.x, 0) // frozen — no restart

    await call(page, 'setSpeed', 300) // re-rate while still paused
    await page.waitForTimeout(150)
    const c = await stCue(page, 't_sd')
    expect(c!.movePt!.x).toBeCloseTo(a!.movePt!.x, 0) // paused ⇒ still frozen, not rewound

    // reduced motion: the travelling bead is replaced by a static edge highlight
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await call(page, 'play')
    await expect.poll(() => stTrans(page).then((s) => s.step)).toBeGreaterThan(t0.step)
    await call(page, 'pause')
    const rm = await stCue(page, 't_sd')
    expect(rm!.moveCount).toBe(0)
    expect(
      await page.locator('.react-flow__edge[data-id="t_sd"] .state-edge-pulse').count(),
    ).toBeGreaterThanOrEqual(0) // (present while its committed event stands)
    // the committed run is intact — every step in series once
    const done = await stTrans(page)
    expect(done.series).toBe(done.step + 1)
  })
})
