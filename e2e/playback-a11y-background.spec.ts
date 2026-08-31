import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md Slice 3c — the accessibility live region and the
// visual state cleanup when a backgrounded tab returns. Both are READ-ONLY over
// the Slice 1 state machine: no commit / CAS / phase / routing change. Runs
// under BOTH the `chromium` and the 390px `mobile` project.

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

const G = () =>
  JSON.stringify({
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
const G2 = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
    { id: 'b', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'ab', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }],
})

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const gcall = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.graph.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { status: s.status, stepIndex: s.stepIndex, tau: s.transition?.tau ?? null, series: s.series.length }
  })
const announced = (page: Page) => page.locator('[data-playback-announce]').textContent()
const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

/** start an in-page recorder of every DISTINCT live-region message (index 0 is
 *  whatever it held when recording began). */
async function record(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-playback-announce]') as HTMLElement
    ;(window as any).__ann = [el.textContent ?? '']
    new MutationObserver(() => {
      const t = el.textContent ?? ''
      const a = (window as any).__ann as string[]
      if (a[a.length - 1] !== t) a.push(t)
    }).observe(el, { childList: true, subtree: true, characterData: true })
  })
}
const log = (page: Page) => page.evaluate(() => (window as any).__ann as string[])
/** messages recorded AFTER the baseline */
const delta = async (page: Page) => (await log(page)).slice(1)

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
  await importGraph(page, G())
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

test.describe('playback — Slice 3c: live region DOM contract', () => {
  test('exactly one always-mounted, visually-hidden polite status region', async ({ page }) => {
    await setup(page)
    const region = page.locator('[data-playback-announce]')
    await expect(region).toHaveCount(1)
    await expect(region).toHaveAttribute('role', 'status')
    await expect(region).toHaveAttribute('aria-live', 'polite')
    await expect(region).toHaveAttribute('aria-atomic', 'true')
    const box = await region.evaluate((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { position: cs.position, w: r.width, h: r.height }
    })
    expect(box.position).toBe('absolute')
    expect(box.w).toBeLessThanOrEqual(2)
    expect(box.h).toBeLessThanOrEqual(2)

    await call(page, 'stepOnce')
    await call(page, 'play')
    await page.waitForTimeout(400)
    await call(page, 'pause')
    await expect(page.locator('[data-playback-announce]')).toHaveCount(1) // still one
  })

  test('theme, selection and speed changes never announce anything', async ({ page }) => {
    await setup(page)
    await call(page, 'stepOnce')
    await expect.poll(() => announced(page)).toBe('Step 1')
    await record(page)

    await page.emulateMedia({ colorScheme: 'dark' })
    await gcall(page, 'setSelection', 'src', null)
    await gcall(page, 'setSelection', null, 'e_sp')
    await call(page, 'setSpeed', 400)
    await call(page, 'setSpeed', 900)
    await page.waitForTimeout(500)
    expect(await delta(page)).toEqual([]) // nothing announced
    await page.emulateMedia({ colorScheme: null })
  })
})

test.describe('playback — Slice 3c: message content + timing', () => {
  test('every state message carries the committed step; Step vs Pause are distinct', async ({ page }) => {
    await setup(page, 1000)

    await call(page, 'stepOnce') // Step from idle — internal idle→paused
    await expect.poll(() => announced(page)).toBe('Step 1') // NOT "Paused"
    await call(page, 'stepOnce')
    await expect.poll(() => announced(page)).toBe('Step 2')

    await call(page, 'play')
    await expect.poll(() => announced(page)).toBe('Playback started')
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBeGreaterThan(2)
    await call(page, 'pause') // the user's Pause button
    await expect.poll(() => announced(page)).toMatch(/^Paused at step \d+$/)
    expect(Number((await announced(page))!.match(/(\d+)/)![1])).toBe((await sim(page)).stepIndex)

    await call(page, 'reset')
    await expect.poll(() => announced(page)).toBe('Reset to step 0')
  })

  test('a fast Play is throttled and LATEST-WINS — never replays old steps in order', async ({ page }) => {
    await setup(page, 150)
    await call(page, 'play')
    await expect.poll(() => announced(page)).toBe('Playback started')
    await record(page)

    await expect.poll(() => sim(page).then((s) => s.stepIndex), { timeout: 9000 }).toBeGreaterThan(14)
    const step = (await sim(page)).stepIndex
    await call(page, 'pause')

    const stepMsgs = (await delta(page)).filter((m) => /^Step \d+$/.test(m)).map((m) => Number(m.match(/(\d+)/)![1]))
    expect(stepMsgs.length).toBeGreaterThan(0)
    expect(stepMsgs.length * 3).toBeLessThan(step) // heavily throttled
    for (let i = 1; i < stepMsgs.length; i++) expect(stepMsgs[i]).toBeGreaterThan(stepMsgs[i - 1]) // strictly increasing — no stale replay
    for (const n of stepMsgs) expect(n).toBeLessThanOrEqual(step)
  })

  test('a queued Step message is cancelled by Reset / Import / Undo before it can speak', async ({ page }) => {
    // Reset
    await setup(page, 150)
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBeGreaterThan(3)
    await record(page)
    await call(page, 'pause')
    await call(page, 'reset')
    await page.waitForTimeout(1400)
    let d = await delta(page)
    expect(d.at(-1)).toBe('Reset to step 0')
    // whatever the last "Step N" seen was, none appears AFTER the reset message
    const resetIdx = d.lastIndexOf('Reset to step 0')
    expect(d.slice(resetIdx + 1).some((m) => /^Step \d+$/.test(m))).toBe(false)

    // Import a different document ⇒ no prior document's step is announced after
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBeGreaterThan(3)
    await call(page, 'pause')
    const stepBeforeImport = (await sim(page)).stepIndex
    await record(page)
    await importGraph(page, G2)
    await page.waitForTimeout(1400)
    expect((await delta(page)).some((m) => m === `Step ${stepBeforeImport}`)).toBe(false)
    expect((await sim(page)).stepIndex).toBe(0)

    // Undo after a graph edit ⇒ pending step cancelled
    await importGraph(page, G())
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBeGreaterThan(3)
    await call(page, 'pause')
    await record(page)
    await gcall(page, 'setEdgeData', 'e_sp', { kind: 'resource', flow: '9' })
    await gcall(page, 'undo')
    await page.waitForTimeout(1200)
    expect((await delta(page)).some((m) => /^Step [1-9]\d*$/.test(m))).toBe(false)
  })
})

test.describe('playback — Slice 3c: background-tab visual recovery + announce once', () => {
  // `document.hidden` behaviour is viewport-independent; the rAF-driven Play +
  // fake-visibility flow is only stable on the desktop project
  test.skip(({ page }) => (page.viewportSize()?.width ?? 1280) < 500, 'chromium only')

  test('hidden ⇒ frozen; visible ⇒ one settle, one "Step N", no orphan cue', async ({ page }) => {
    await setup(page, 5000)
    await installHidden(page)
    await call(page, 'advance') // step 1; the trigger schedules for step 2
    await call(page, 'play')
    await expect
      .poll(() => sim(page).then((s) => (s.tau && s.tau > 0.15 && s.tau < 0.55 ? 1 : -1)), { timeout: 8000 })
      .toBe(1)
    const mid = await sim(page)
    expect(await page.locator('.react-flow__edge[data-id="e_sp"] .pb-move').count()).toBe(1)
    const textAtHide = await announced(page)
    await record(page)

    // hidden: not the step, not the live text
    await setHidden(page, true)
    await page.waitForTimeout(2500)
    expect((await sim(page)).stepIndex).toBe(mid.stepIndex)
    expect(await announced(page)).toBe(textAtHide)
    expect(await delta(page)).toEqual([])
    expect(await page.locator('.pb-move, g.state-move').count()).toBeGreaterThan(0) // frozen in place

    // visible: the frozen transition settles exactly once, announced once as
    // "Step N", every committed step in `series` once (no catch-up backlog)
    await setHidden(page, false)
    await expect.poll(() => sim(page).then((s) => s.stepIndex)).toBe(mid.stepIndex + 1)
    await call(page, 'pause')
    await page.waitForTimeout(300)
    expect((await delta(page)).filter((m) => m === `Step ${mid.stepIndex + 1}`).length).toBe(1)
    const seriesSteps = await page.evaluate(() => (window as any).__loop.sim.getState().series.map((p: { step: number }) => p.step))
    expect(seriesSteps).toEqual(Array.from({ length: mid.stepIndex + 2 }, (_, i) => i))

    // no ORPHAN cue: any travelling element still on screen is backed by the
    // CURRENT transition (a later step), never the stale pre-hidden one
    const orphan = await page.evaluate((staleFrom) => {
      const t = (window as any).__loop.sim.getState().transition
      const moves = document.querySelectorAll('.pb-move, g.state-move')
      const perEdge = [...document.querySelectorAll('.react-flow__edge')].map((e) => e.querySelectorAll('.pb-move, g.state-move').length)
      return { count: moves.length, fromStep: t?.fromStep ?? null, maxPerEdge: Math.max(0, ...perEdge), stale: staleFrom }
    }, mid.stepIndex)
    expect(orphan.maxPerEdge).toBeLessThanOrEqual(1)
    if (orphan.count > 0) expect(orphan.fromStep).toBeGreaterThan(mid.stepIndex)

    // Reset ⇒ the canvas is fully clean
    await call(page, 'reset')
    await expect(page.locator('.pb-move, g.state-move, .pb-cue, .state-cue--activator, .pb-l0-pulse, .flow-edge-pulse, .state-edge-pulse')).toHaveCount(0)
  })

  test('Reset, then a late visibilitychange ⇒ no cue and no announcement', async ({ page }) => {
    await setup(page, 5000)
    await installHidden(page)
    await call(page, 'play')
    await expect
      .poll(() => sim(page).then((s) => (s.tau && s.tau > 0.15 && s.tau < 0.55 ? 1 : -1)), { timeout: 8000 })
      .toBe(1)

    await setHidden(page, true)
    await page.waitForTimeout(300)
    await call(page, 'reset')
    await expect.poll(() => announced(page)).toBe('Reset to step 0')
    await record(page)

    // stray visibility callbacks after Reset must do nothing
    await setHidden(page, false)
    await setHidden(page, true)
    await setHidden(page, false)
    await page.waitForTimeout(1200)
    expect(await delta(page)).toEqual([])
    await expect(page.locator('.pb-move, g.state-move, .pb-cue, .state-cue--activator, .flow-edge-pulse, .state-edge-pulse')).toHaveCount(0)
    expect((await sim(page)).stepIndex).toBe(0)
  })
})

test.describe('playback — Slice 3c: run leaves the document untouched', () => {
  test('playing then pausing then resetting a run leaves the GraphDoc digest and undo state untouched', async ({ page }) => {
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
