import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { forcePath, installProbe, mcResultJson, pathProbe } from './support/mc'

// SLICE-2 §1–§4 (http): the store's Monte-Carlo run goes through the real Worker
// pool when cores allow, and through the cooperative main-thread driver when
// they don't — and the two produce byte-identical results. Progress is observed
// mid-run; cancelling stops the async machinery and keeps any prior result.
//
// The path is pinned by faking navigator.hardwareConcurrency (forcePath); the
// probe (installProbe) counts Worker construct / init / job / inbound-message
// and runs a macrotask ticker. No product-code change.

type Cfg = { baseSeed?: number; runs: number; steps: number; tracked?: string[] }

async function ready(page: Page, path: 'worker' | 'coop'): Promise<void> {
  await installProbe(page)
  await forcePath(page, path)
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node')).toHaveCount(18)
}

const setConfig = (page: Page, cfg: Cfg) =>
  page.evaluate((c) => (window as any).__loop.mc.getState().setConfig(c), cfg)

/** kick a run without awaiting it (for cancel / progress observation) */
const startRun = (page: Page) => page.evaluate(() => void (window as any).__loop.mc.getState().run())

const mcState = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__loop.mc.getState()
    return { status: m.status, progress: m.progress, completedRuns: m.completedRuns, message: m.message, stale: m.stale, hasResult: Boolean(m.result), resultRuns: m.result?.completedRuns ?? null }
  })

const waitStatus = (page: Page, s: string, timeout = 20_000) =>
  expect.poll(() => mcState(page).then((x) => x.status), { timeout }).toBe(s)

test.describe('MC execution paths (http)', () => {
  test('worker path: real workers send jobs and return results', async ({ page }) => {
    await ready(page, 'worker')
    await setConfig(page, { baseSeed: 1, runs: 500, steps: 40, tracked: [] })
    await startRun(page)
    await waitStatus(page, 'done')

    const p = await pathProbe(page)
    expect(p.wk.ctor, 'workers constructed').toBeGreaterThanOrEqual(2)
    expect(p.wk.init, 'init messages sent').toBeGreaterThanOrEqual(1)
    expect(p.wk.job, 'job messages sent').toBeGreaterThanOrEqual(1)
    expect(p.wk.msgIn, 'result messages received >= jobs sent').toBeGreaterThanOrEqual(p.wk.job)

    const r = JSON.parse((await mcResultJson(page))!)
    expect(r.completedRuns).toBe(500)
    expect(r.endedRuns.atOrBeforeStep.at(-1)).toBe(424)
  })

  test('cooperative path: no worker, event loop interleaves', async ({ page }) => {
    await ready(page, 'coop')
    const t0 = await page.evaluate(() => (window as any).__ticks as number)
    await setConfig(page, { baseSeed: 1, runs: 500, steps: 40, tracked: [] })
    await startRun(page)
    await waitStatus(page, 'done')

    const p = await pathProbe(page)
    expect(p.wk.ctor, 'no Worker constructed').toBe(0)
    expect(p.ticks - t0, 'macrotasks ran during the sweep').toBeGreaterThan(10)

    const r = JSON.parse((await mcResultJson(page))!)
    expect(r.completedRuns).toBe(500)
    expect(r.endedRuns.atOrBeforeStep.at(-1)).toBe(424)
  })

  test('byte-equal: worker result === cooperative result (whole MonteCarloResult)', async ({ browser }) => {
    const run = async (path: 'worker' | 'coop') => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      const page = await ctx.newPage()
      await ready(page, path)
      await setConfig(page, { baseSeed: 1, runs: 500, steps: 40, tracked: [] })
      await startRun(page)
      await waitStatus(page, 'done')
      const json = await mcResultJson(page)
      const ctor = (await pathProbe(page)).wk.ctor
      await ctx.close()
      return { json, ctor }
    }
    const w = await run('worker')
    const c = await run('coop')
    expect(w.ctor).toBeGreaterThanOrEqual(2) // really was the worker path
    expect(c.ctor).toBe(0) // really was cooperative
    expect(w.json).not.toBeNull()
    expect(w.json).toBe(c.json) // exact, no field excluded
  })
})

// A big single-pool run so wall-time comfortably exceeds the poll interval.
const BIG: Cfg = { baseSeed: 1, runs: 12_000, steps: 40, tracked: ['ore_stock'] }

for (const path of ['worker', 'coop'] as const) {
  test.describe(`MC progress + cancel — ${path} path (http)`, () => {
    test('progress is observed mid-run, then reaches 1', async ({ page }) => {
      await ready(page, path)
      await setConfig(page, BIG)
      await startRun(page)

      let sawMid = false
      await expect
        .poll(async () => {
          const s = await mcState(page)
          if (s.status === 'running' && s.progress > 0 && s.progress < 1) sawMid = true
          return s.status
        }, { timeout: 20_000 })
        .toBe('done')
      expect(sawMid, 'a 0 < progress < 1 sample while running').toBe(true)

      const end = await mcState(page)
      expect(end.progress).toBe(1)
      expect(end.hasResult).toBe(true)
    })

    test('cancel stops the callbacks; product state resets', async ({ page }) => {
      await ready(page, path)
      await setConfig(page, BIG)
      await startRun(page)

      // catch it mid-flight
      await expect
        .poll(async () => {
          const s = await mcState(page)
          return s.status === 'running' && s.completedRuns > 0 ? 'mid' : s.status
        }, { timeout: 20_000 })
        .toBe('mid')

      // independent test-side observer of the async machinery
      const beforeProbe = await pathProbe(page)
      const beforeState = await mcState(page)

      await page.evaluate(() => (window as any).__loop.mc.getState().cancel())
      await expect.poll(() => mcState(page).then((s) => s.status)).not.toBe('running')

      const atCancelProbe = await pathProbe(page)
      const atCancelState = await mcState(page)

      await page.waitForTimeout(750)
      const afterProbe = await pathProbe(page)
      const afterState = await mcState(page)

      if (path === 'worker') {
        // no further result messages arrive after terminate()
        expect(afterProbe.wk.msgIn).toBe(atCancelProbe.wk.msgIn)
        expect(afterProbe.wk.job).toBe(atCancelProbe.wk.job)
        expect(atCancelProbe.wk.msgIn).toBeGreaterThan(0)
      } else {
        // the loop threw out; completedRuns never advances again
        expect(afterState.completedRuns).toBe(atCancelState.completedRuns)
        expect(atCancelState.completedRuns).toBeGreaterThan(0)
        expect(atCancelState.completedRuns).toBeLessThan(BIG.runs)
      }

      // product-rule reset (a different observation from "machinery stopped")
      expect(afterState.progress).toBe(0)
      expect(afterState.message).toBe('Cancelled')
      expect(afterState.status).toBe('idle') // no prior result
      expect(afterState.hasResult).toBe(false)
      // sanity: cancel didn't finish the run
      expect(beforeProbe.wk.ctor === 0 || beforeState.status === 'running').toBeTruthy()
    })

    test('cancel keeps a prior successful result; never a partial', async ({ page }) => {
      await ready(page, path)

      // 1 — a good small result
      await setConfig(page, { baseSeed: 1, runs: 120, steps: 20, tracked: ['ore_stock'] })
      await startRun(page)
      await waitStatus(page, 'done')
      const r0 = await mcResultJson(page)
      expect(JSON.parse(r0!).completedRuns).toBe(120)
      await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')

      // 2 — start a big run, cancel it mid-flight
      await setConfig(page, BIG)
      await startRun(page)
      await expect
        .poll(async () => {
          const s = await mcState(page)
          return s.status === 'running' && s.completedRuns > 0 ? 'mid' : s.status
        }, { timeout: 20_000 })
        .toBe('mid')
      await page.evaluate(() => (window as any).__loop.mc.getState().cancel())
      await expect.poll(() => mcState(page).then((s) => s.status)).not.toBe('running')

      // 3 — the previous result is intact, unchanged, not advanced
      const s = await mcState(page)
      expect(s.status).toBe('done') // prior result exists
      expect(s.message).toBe('Cancelled')
      expect(s.stale).toBe(false)
      expect(s.resultRuns).toBe(120) // never an in-between number
      expect(await mcResultJson(page)).toBe(r0) // byte-identical to R0
      await expect(page.locator('.dist__stat', { hasText: 'runs' })).toContainText('120')
    })
  })
}
