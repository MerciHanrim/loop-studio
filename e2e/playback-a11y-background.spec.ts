import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md Slice 3c — the accessibility live region and the
// visual state cleanup when a backgrounded tab returns. Both are READ-ONLY over
// the Slice 1 state machine: no commit / CAS / phase / routing change.

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Tap', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'Vault', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'drn', type: 'drain', position: { x: 520, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'passive', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
    { id: 't_sd', type: 'loop', source: 'src', target: 'drn', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return {
      status: s.status,
      stepIndex: s.stepIndex,
      tau: s.transition?.tau ?? null,
      phase: s.transition?.phase ?? null,
      fromStep: s.transition?.fromStep ?? null,
      series: s.series.length,
    }
  })
const announced = (page: Page) => page.locator('[data-playback-announce]').textContent()
const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

async function installHidden(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => (window as any).__hidden === true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ((window as any).__hidden ? 'hidden' : 'visible') })
  })
}
const setHidden = (page: Page, h: boolean) =>
  page.evaluate((v) => {
    ;(window as any).__hidden = v
    document.dispatchEvent(new Event('visibilitychange'))
  }, h)

async function setup(page: Page, speedMs = 1400) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

test.describe('playback — Slice 3c: accessibility live region', () => {
  test('the region is a polite status live region', async ({ page }) => {
    await setup(page)
    const region = page.locator('[data-playback-announce]')
    await expect(region).toHaveAttribute('role', 'status')
    await expect(region).toHaveAttribute('aria-live', 'polite')
    // visually hidden but in the DOM
    expect(await region.evaluate((el) => getComputedStyle(el).position)).toBe('absolute')
    expect(await region.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(2)
  })

  test('state changes announce immediately; step progress throttles under a fast Play', async ({ page }) => {
    await setup(page, 1000)

    await call(page, 'stepOnce') // Step from idle
    await expect.poll(() => sim(page).then((s) => (s.tau == null ? s.stepIndex : -1))).toBe(1)
    await expect.poll(() => announced(page)).toBe('Step 1') // a Step press, not "paused"

    await call(page, 'setSpeed', 160) // fast Play
    await call(page, 'play')
    await expect.poll(() => announced(page)).toBe('Playback started')

    // sample the announcement over a window of Play; count DISTINCT "Step N"
    // messages vs steps actually taken — the throttle keeps it far lower
    const seen = new Set<string>()
    const firstStep = (await sim(page)).stepIndex
    const t0 = Date.now()
    while (Date.now() - t0 < 5000) {
      seen.add((await announced(page)) ?? '')
      await page.waitForTimeout(50)
    }
    const stepsTaken = (await sim(page)).stepIndex - firstStep
    await call(page, 'pause')
    const stepMsgs = [...seen].filter((m) => m.startsWith('Step ')).length
    expect(stepsTaken).toBeGreaterThan(8) // many steps in 5s at 160ms
    expect(stepMsgs).toBeGreaterThan(0)
    expect(stepMsgs * 2).toBeLessThan(stepsTaken) // throttled — well under one per step

    await expect.poll(() => announced(page)).toMatch(/^Playback paused at step \d+$/)

    await call(page, 'reset')
    await expect.poll(() => announced(page)).toBe('Run reset to step 0')
  })
})

test.describe('playback — Slice 3c: background-tab visual recovery', () => {
  test('returning to a visible tab clears every travelling / cue element on the settle frame; the run stays intact', async ({ page }) => {
    await setup(page, 900)
    await installHidden(page)
    await call(page, 'advance') // step 1: src fires, trigger scheduled for step 2

    await call(page, 'play')
    // mid-travel on step 2: a resource token AND a state cue are on screen
    await expect
      .poll(() => sim(page).then((s) => (s.tau && s.tau > 0.15 && s.tau < 0.6 ? 1 : -1)), { timeout: 8000 })
      .toBe(1)
    const mid = await sim(page)
    expect(await page.locator('.react-flow__edge[data-id="e_sp"] .pb-move').count()).toBe(1)
    expect(await page.locator('.react-flow__edge[data-id="t_sd"] g.state-move').count()).toBe(1)

    // hide for well over a beat — frozen, nothing commits, nothing new prepared
    await setHidden(page, true)
    await page.waitForTimeout(2500)
    const hidden = await sim(page)
    expect(hidden.stepIndex).toBe(mid.stepIndex)
    // the frozen cue is still there (§PB8.3 "freeze in place")
    expect(await page.locator('.pb-move, g.state-move').count()).toBeGreaterThan(0)

    // back to visible: the FROZEN transition settles exactly once. Any cue still
    // on screen belongs to a LATER step (Play continues) — never the stale one.
    await setHidden(page, false)
    await expect
      .poll(() => sim(page).then((s) => (s.stepIndex === mid.stepIndex + 1 && (s.fromStep === null || s.fromStep >= mid.stepIndex + 1) ? 1 : -1)))
      .toBe(1)
    const seriesSteps1 = await page.evaluate(() => (window as any).__loop.sim.getState().series.map((p: { step: number }) => p.step))
    expect(seriesSteps1).toEqual(Array.from({ length: mid.stepIndex + 2 }, (_, i) => i)) // 0..mid+1, once each, no backlog

    // Pause + Reset ⇒ the canvas is fully clean, no orphaned element
    await call(page, 'pause')
    await call(page, 'reset')
    await expect(page.locator('.pb-move, g.state-move, .pb-cue, .state-cue--activator, .pb-l0-pulse, .flow-edge-pulse, .state-edge-pulse')).toHaveCount(0)
  })

  test('playing then pausing a run leaves the GraphDoc digest and undo state untouched', async ({ page }) => {
    await setup(page, 700)
    const d0 = await digest(page)
    const undo0 = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return [g.canUndo, g.canRedo]
    })
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBeGreaterThan(2)
    await call(page, 'pause')
    await call(page, 'reset')
    expect(await digest(page)).toBe(d0)
    expect(
      await page.evaluate(() => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        return [g.canUndo, g.canRedo]
      }),
    ).toEqual(undo0)
  })
})
