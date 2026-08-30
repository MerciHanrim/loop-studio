import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md Slice 1 — the state machine, through the real app.
//   • the store advances ONLY at `settle`: `stepIndex` / `commitEpoch` stay put
//     for the whole depart/travel/arrive span, then jump together;
//   • exactly one `preparedTransition` at a time; `fromStep` climbs by 1, never
//     skips; every committed step lands in `series` once;
//   • Pause keeps the transition (τ frozen, nothing committed); Resume finishes
//     the same one;
//   • Reset mid-transition discards it and leaves no trace, no late commit;
//   • a Step click settles at most one step;
//   • speed 0 / negative is rejected.

const FLOW = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Tap', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Vault', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'drn', type: 'drain', position: { x: 480, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
    { id: 'e_pd', type: 'loop', source: 'pool', target: 'drn', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

type PB = {
  stepIndex: number
  commitEpoch: number
  status: string
  activeTransitionId: number | null
  lastSettledTransitionId: number | null
  transition: { fromStep: number; tau: number } | null
  seriesSteps: number[]
  speedMs: number
}
const pb = (page: Page): Promise<PB> =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return {
      stepIndex: s.stepIndex,
      commitEpoch: s.commitEpoch,
      status: s.status,
      activeTransitionId: s.activeTransitionId,
      lastSettledTransitionId: s.lastSettledTransitionId,
      transition: s.transition,
      seriesSteps: s.series.map((p: { step: number }) => p.step),
      speedMs: s.speedMs,
    }
  })
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__loop.sim.getState()[f as string](...(a as unknown[])), [fn, args] as const)

/** install a controllable `document.hidden` (the scheduler polls it each rAF). */
async function installHidden(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => (window as any).__hidden === true })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => ((window as any).__hidden ? 'hidden' : 'visible'),
    })
  })
}
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    ;(window as any).__hidden = h
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)

async function setup(page: Page, speedMs = 1400) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FLOW)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

test.describe('playback — Slice 1 state machine', () => {
  test('the store advances only at settle; commitEpoch moves with stepIndex', async ({ page }) => {
    await setup(page)
    const start = await pb(page)
    expect(start.stepIndex).toBe(0)

    await call(page, 'play')
    // sample the depart/travel/arrive span: stepIndex + commitEpoch must not move
    // while a transition is in flight below the settle boundary
    let sawInFlight = false
    for (let i = 0; i < 30; i++) {
      const s = await pb(page)
      if (s.transition && s.transition.tau > 0.05 && s.transition.tau < 0.9) {
        sawInFlight = true
        expect(s.stepIndex).toBe(0)
        expect(s.commitEpoch).toBe(start.commitEpoch)
        expect(s.activeTransitionId).not.toBeNull()
      }
      if (s.stepIndex === 1) break
      await page.waitForTimeout(60)
    }
    expect(sawInFlight, 'observed a transition mid-flight').toBe(true)

    await expect.poll(() => pb(page).then((s) => s.stepIndex)).toBe(1)
    const after = await pb(page)
    expect(after.commitEpoch).toBe(start.commitEpoch + 1)
    await call(page, 'pause')
  })

  test('one transition at a time; fromStep climbs by 1 and every step lands in series once', async ({ page }) => {
    await setup(page, 250) // fast
    await call(page, 'play')
    const seen: number[] = []
    for (let i = 0; i < 60; i++) {
      const s = await pb(page)
      if (s.transition) seen.push(s.transition.fromStep)
      if (s.stepIndex >= 6) break
      await page.waitForTimeout(40)
    }
    await call(page, 'pause')
    const s = await pb(page)
    // fromStep never skipped: the sorted unique set is a contiguous 0..N run
    const uniq = [...new Set(seen)].sort((a, b) => a - b)
    for (let i = 1; i < uniq.length; i++) expect(uniq[i] - uniq[i - 1]).toBe(1)
    // series is 0..stepIndex, each exactly once
    expect(s.seriesSteps).toEqual(Array.from({ length: s.stepIndex + 1 }, (_, i) => i))
  })

  test('Pause keeps the transition (nothing committed); Resume finishes the same one', async ({ page }) => {
    await setup(page, 1600)
    await call(page, 'play')
    // wait for a comfortably mid-flight transition
    await expect
      .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.2 && s.transition.tau < 0.6 ? s.transition.tau : -1)), { timeout: 8000 })
      .toBeGreaterThan(0)
    await call(page, 'pause')
    const paused = await pb(page)
    expect(paused.transition).not.toBeNull()
    expect(paused.activeTransitionId).not.toBeNull()
    const frozenFrom = paused.transition!.fromStep

    // nothing commits while paused
    await page.waitForTimeout(600)
    const still = await pb(page)
    expect(still.stepIndex).toBe(paused.stepIndex)
    expect(still.commitEpoch).toBe(paused.commitEpoch)
    expect(still.transition).not.toBeNull()

    // resume → the SAME transition completes
    await call(page, 'play')
    await expect.poll(() => pb(page).then((s) => s.stepIndex)).toBe(frozenFrom + 1)
    expect((await pb(page)).commitEpoch).toBe(paused.commitEpoch + 1)
    await call(page, 'pause')
  })

  test('Reset mid-transition discards it — no trace, no late commit', async ({ page }) => {
    await setup(page, 1600)
    await call(page, 'play')
    await expect
      .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.15 ? s.transition.tau : -1)), { timeout: 8000 })
      .toBeGreaterThan(0)
    const midEpoch = (await pb(page)).commitEpoch
    await call(page, 'reset')
    const r = await pb(page)
    expect(r.transition).toBeNull()
    expect(r.activeTransitionId).toBeNull()
    expect(r.stepIndex).toBe(0)
    expect(r.commitEpoch).toBe(midEpoch + 1) // reset bumps once
    expect(r.seriesSteps).toEqual([0])
    // no delayed commit fires afterwards
    await page.waitForTimeout(1000)
    const later = await pb(page)
    expect(later.stepIndex).toBe(0)
    expect(later.commitEpoch).toBe(r.commitEpoch)
  })

  test('a Step click = exactly one choreographed step (never stacks, never skips)', async ({ page }) => {
    await setup(page, 700)
    const from = (await pb(page)).stepIndex
    const stepBtn = page.locator('.pstrip button[title="Advance one step"]')

    for (let n = 1; n <= 3; n++) {
      await stepBtn.click()
      // the click starts the SAME choreography Play uses — a transition appears…
      await expect.poll(() => pb(page).then((s) => (s.transition ? 1 : 0)), { timeout: 4000 }).toBe(1)
      // …then it settles, and the loop does NOT continue to the next step
      await expect.poll(() => pb(page).then((s) => s.transition), { timeout: 4000 }).toBeNull()
      const s = await pb(page)
      expect(s.stepIndex).toBe(from + n)
      expect(s.status).not.toBe('running')
      expect(s.seriesSteps).toEqual(Array.from({ length: s.stepIndex + 1 }, (_, i) => i)) // no gaps
    }

    // a rapid burst never stacks: clicking again while a transition is in flight
    // only fast-forwards it, so N fast clicks advance by at most N
    const base = (await pb(page)).stepIndex
    for (let i = 0; i < 4; i++) await stepBtn.click()
    await expect.poll(() => pb(page).then((s) => s.transition), { timeout: 6000 }).toBeNull()
    const after = await pb(page)
    expect(after.stepIndex - base).toBeGreaterThanOrEqual(1)
    expect(after.stepIndex - base).toBeLessThanOrEqual(4)
    expect(after.seriesSteps).toEqual(Array.from({ length: after.stepIndex + 1 }, (_, i) => i))
  })

  test('speed 0 / negative / NaN is rejected', async ({ page }) => {
    await setup(page, 500)
    for (const bad of [0, -100]) {
      await call(page, 'setSpeed', bad)
      expect((await pb(page)).speedMs).toBe(500)
    }
    await page.evaluate(() => (window as any).__loop.sim.getState().setSpeed(Number.NaN))
    expect((await pb(page)).speedMs).toBe(500)
    await call(page, 'setSpeed', 300)
    expect((await pb(page)).speedMs).toBe(300)
  })

  test('a GraphDoc edit mid-transition cancels playback IMMEDIATELY — no wait for settle, no late commit (Round 2 §2)', async ({ page }) => {
    await setup(page, 1600)
    await call(page, 'play')
    await expect
      .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.15 && s.transition.tau < 0.7 ? 1 : -1)), { timeout: 8000 })
      .toBe(1)
    const mid = await pb(page)
    expect(mid.stepIndex).toBe(0)

    // a real graph edit → simulationRev bumps → the sim resets on the spot
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      const pool = g.nodes.find((n: any) => n.data.kind === 'pool')
      g.updateNodeData(pool.id, { capacity: 5 })
    })
    // within a frame: transition gone, no commit, back at step 0
    await page.waitForTimeout(50)
    const after = await pb(page)
    expect(after.transition).toBeNull()
    expect(after.activeTransitionId).toBeNull()
    expect(after.stepIndex).toBe(0)
    expect(after.status).not.toBe('running')
    // and nothing commits afterwards
    await page.waitForTimeout(800)
    const later = await pb(page)
    expect(later.stepIndex).toBe(0)
    expect(later.commitEpoch).toBe(after.commitEpoch)
  })

  test('background / visibility (Round 2 §4)', async ({ page }) => {
    await setup(page, 900)
    await installHidden(page)

    await test.step('hidden during a transition ⇒ no commit; hidden ⇒ no next transition prepared', async () => {
      await call(page, 'play')
      await expect
        .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.1 && s.transition.tau < 0.6 ? 1 : -1)), { timeout: 8000 })
        .toBe(1)
      const before = await pb(page)
      await setHidden(page, true)
      await page.waitForTimeout(2500) // >> one full beat
      const hidden = await pb(page)
      expect(hidden.stepIndex).toBe(before.stepIndex) // nothing settled while hidden
      expect(hidden.commitEpoch).toBe(before.commitEpoch)
      expect(hidden.activeTransitionId).toBe(before.activeTransitionId) // same transition, not a new one
      expect(hidden.transition!.fromStep).toBe(before.transition!.fromStep)
    })

    await test.step('back to visible + a big time jump ⇒ the current transition settles exactly once, then the next begins on a later frame', async () => {
      const beforeVisible = await pb(page)
      await setHidden(page, false)
      await expect.poll(() => pb(page).then((s) => s.stepIndex)).toBe(beforeVisible.transition!.fromStep + 1)
      const one = await pb(page)
      expect(one.commitEpoch).toBe(beforeVisible.commitEpoch + 1) // exactly one settle
      expect(one.seriesSteps).toEqual(Array.from({ length: one.stepIndex + 1 }, (_, i) => i)) // each step once
      // the run continues normally
      await expect.poll(() => pb(page).then((s) => s.stepIndex)).toBeGreaterThan(one.stepIndex)
      await call(page, 'pause')
      const s = await pb(page)
      expect(s.seriesSteps).toEqual(Array.from({ length: s.stepIndex + 1 }, (_, i) => i))
    })

    await test.step('Paused, then hidden/visible ⇒ no auto-settle', async () => {
      await call(page, 'reset')
      await call(page, 'play')
      await expect
        .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.15 && s.transition.tau < 0.6 ? 1 : -1)), { timeout: 8000 })
        .toBe(1)
      await call(page, 'pause')
      const paused = await pb(page)
      await setHidden(page, true)
      await page.waitForTimeout(600)
      await setHidden(page, false)
      await page.waitForTimeout(600)
      const s = await pb(page)
      expect(s.stepIndex).toBe(paused.stepIndex) // no settle happened
      expect(s.commitEpoch).toBe(paused.commitEpoch)
      expect(s.status).toBe('paused')
    })

    await test.step('Reset then a visibility callback ⇒ no late commit', async () => {
      await call(page, 'play')
      await expect
        .poll(() => pb(page).then((s) => (s.transition && s.transition.tau > 0.15 ? 1 : -1)), { timeout: 8000 })
        .toBe(1)
      await call(page, 'reset')
      const r = await pb(page)
      await setHidden(page, true)
      await setHidden(page, false)
      await page.waitForTimeout(600)
      const s = await pb(page)
      expect(s.stepIndex).toBe(0)
      expect(s.commitEpoch).toBe(r.commitEpoch)
      expect(s.transition).toBeNull()
    })
  })
})
