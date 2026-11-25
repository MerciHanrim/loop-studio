import {
  expect,
  FIXTURE_POOLS_4,
  graphSnapshot,
  importGraph,
  mcSnapshot,
  openApp,
  readFixture,
  readRiskyFactory,
  resetAll,
  runMc,
  test,
} from './support/loop'
import { openMonteCarloDialog } from './support/workbenchMenus'

// Item 6 — import the verification fixture, then drive a real Monte-Carlo run
// through the Worker path (http dev server ⇒ real Workers), plus a cancel.

test.describe('Monte Carlo run', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())
    const g = await graphSnapshot(page)
    expect(g.nodeCount).toBe(10)
    expect(g.edgeCount).toBe(7)
    expect(g.poolLabels).toEqual(['Det Pool', 'Dice Pool', 'Gate In', 'Gate A', 'Gate B'])
  })

  test('dialog Run → result, distribution view, 0% ended', async ({ page }) => {
    await page.evaluate((tracked) => {
      ;(window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 40, steps: 10, tracked })
    }, FIXTURE_POOLS_4)

    await openMonteCarloDialog(page)
    const runBtn = page.locator('.mcdlg__foot .btn--primary')
    await expect(runBtn).toBeEnabled() // cost probe resolved
    await runBtn.click()

    await expect
      .poll(() => mcSnapshot(page).then((s) => s.status), { timeout: 20_000 })
      .toBe('done')

    const s = await mcSnapshot(page)
    expect(s.hasResult).toBe(true)
    expect(s.view).toBe('distribution')
    expect(s.resultConfig).toEqual({ runs: 40, steps: 10, baseSeed: 1 })
    expect(s.resultPools).toEqual(['Det Pool', 'Dice Pool', 'Gate A', 'Gate B'])

    // the distribution panel + its header are on screen
    await expect(page.locator('.dist')).toBeVisible()
    await expect(page.locator('.dist__stat', { hasText: 'Ended' })).toContainText('0%')
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
  })

  test('over the memory limit: the dialog shows the memory warning only — no time band, Run disabled (#419 item 3)', async ({ page }) => {
    await page.evaluate((tracked) => {
      ;(window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 3_000_000, steps: 1_000_000, tracked })
    }, FIXTURE_POOLS_4)
    await openMonteCarloDialog(page)
    const cost = page.locator('.mcdlg__cost')
    await expect(cost).toHaveClass(/is-over/)
    await expect(cost.locator('.mcdlg__over')).toContainText('over the limit')
    // the time band is not shown: no "Local benchmark" / "Measured" line, only Execution and Memory
    await expect(cost.locator('.mcdlg__costline')).toHaveCount(2)
    await expect(cost).not.toContainText('Local benchmark')
    await expect(cost).not.toContainText('Measured')
    await expect(page.locator('.mcdlg__foot .btn--primary')).toBeDisabled()
  })

  test('the LIVE-view legend is hidden in DISTRIBUTION and returns in LIVE', async ({ page }) => {
    await runMc(page, { baseSeed: 1, runs: 20, steps: 6, tracked: FIXTURE_POOLS_4 })

    const legend = page.locator('.timeline__legend')
    const tab = (name: string) => page.locator('.timeline__viewtab', { hasText: name })

    // run() lands on DISTRIBUTION — the LIVE legend must not compete with the
    // distribution stats row
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
    await expect(legend).toBeHidden()

    await tab('Live').click()
    await expect(legend).toBeVisible()

    await tab('Distribution').click()
    await expect(legend).toBeHidden()
  })

  test('termination sparkline: the fixture has no End node → "No runs ended"', async ({ page }) => {
    await runMc(page, { baseSeed: 1, runs: 30, steps: 8, tracked: FIXTURE_POOLS_4 })

    const term = page.locator('.term')
    await expect(term).toBeVisible()
    await expect(term.locator('.term__cap')).toContainText('0% ended')
    await expect(term.locator('.term__empty')).toHaveText('No runs ended')
    // at 0% neither the line nor the Bead is drawn — only the note
    await expect(term.locator('.term__line')).toHaveCount(0)
    await expect(term.locator('.term__bead')).toHaveCount(0)
  })

  test('a long run can be cancelled from the strip; no partial result', async ({ page }) => {
    // sized to comfortably outlast the Cancel click (steps dominate; workers
    // cannot parallelise within a run). 40 × 20001 × 4 = 3.2M cells < limit.
    await page.evaluate((tracked) => {
      const m = (window as any).__loop.mc.getState()
      m.setConfig({ baseSeed: 1, runs: 40, steps: 20_000, tracked })
      void m.run()
    }, FIXTURE_POOLS_4)

    await expect.poll(() => mcSnapshot(page).then((s) => s.status)).toBe('running')
    await expect(page.locator('.pstrip__mcprog')).toBeVisible()

    await page.locator('.pstrip__mc button', { hasText: 'Cancel' }).click()

    await expect.poll(() => mcSnapshot(page).then((s) => s.status)).toBe('idle')
    const s = await mcSnapshot(page)
    expect(s.hasResult).toBe(false)
    expect(s.message).toBe('cancelled')
  })

  // #620 item 2 — the first run of a session imports the Worker chunk before it
  // listens for Cancel. A Cancel in that window reached no listener, and the run
  // went on to finish: status `done` and its result shown, as if Cancel had not
  // been clicked. The worker module request is held here so the run waits in
  // that import while Cancel is clicked; the run must end as a cancel.
  test('a Cancel while the Worker chunk is still loading cancels the run (#620 item 2)', async ({ page }) => {
    let released = false
    await page.route(/mc\.worker\.ts\?worker/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      released = true
      await route.continue()
    })
    await page.evaluate((tracked) => {
      ;(window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 64, steps: 10, tracked })
    }, FIXTURE_POOLS_4)
    await openMonteCarloDialog(page)
    const runBtn = page.locator('.mcdlg__foot .btn--primary')
    await expect(runBtn).toBeEnabled()
    await runBtn.click()
    await expect.poll(() => mcSnapshot(page).then((s) => s.status)).toBe('running')
    await page.locator('.mcdlg__foot .btn', { hasText: 'Cancel' }).click()
    expect(released, 'Cancel was clicked while the worker chunk was still held').toBe(false)

    // the run ends as a cancel once the chunk arrives, and never finishes
    await expect.poll(() => mcSnapshot(page).then((s) => s.status), { timeout: 10_000 }).toBe('idle')
    const s = await mcSnapshot(page)
    expect(s.hasResult).toBe(false)
    expect(s.message).toBe('cancelled')
    expect(released).toBe(true)
    await page.waitForTimeout(1500) // room for a run that was not stopped to finish
    expect((await mcSnapshot(page)).status).toBe('idle')
    expect((await mcSnapshot(page)).hasResult).toBe(false)
  })

  // #620 item 1 — below 32 runs the dialog's Execution line said "Local" (and
  // its time band was the local one) while the run started Workers. The line
  // now names the path the run takes: as many workers as the run starts, or
  // Local when it starts none. Workers are counted by wrapping the constructor.
  // The count reads "Workers: N", which also holds for the one Worker of a
  // single run (Lumi: "Parallel, 1 workers" called one Worker parallel).
  for (const runs of [1, 16, 64]) {
    test(`the Execution line names the Workers the run starts — ${runs} runs (#620 item 1)`, async ({ page }) => {
      await page.evaluate(() => {
        const w = window as unknown as { __workers: number }
        w.__workers = 0
        const Real = window.Worker
        const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Worker>) {
          w.__workers++
          return new Real(...args)
        } as unknown as typeof Worker
        Counting.prototype = Real.prototype
        window.Worker = Counting
      })
      await page.evaluate(([r, tracked]) => {
        ;(window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: r, steps: 10, tracked })
      }, [runs, FIXTURE_POOLS_4] as const)
      await openMonteCarloDialog(page)
      const runBtn = page.locator('.mcdlg__foot .btn--primary')
      await expect(runBtn).toBeEnabled()
      const line = await page.locator('.mcdlg__path').innerText()
      await runBtn.click()
      await expect.poll(() => mcSnapshot(page).then((s) => s.status), { timeout: 20_000 }).toBe('done')
      const started = await page.evaluate(() => (window as unknown as { __workers: number }).__workers)
      expect(line).toBe(started > 0 ? `Workers: ${started}` : 'Local')
      expect(line).not.toMatch(/Parallel/)
    })
  }

  test('control for #620 item 2: with the chunk held and no Cancel, the run finishes with its result', async ({ page }) => {
    await page.route(/mc\.worker\.ts\?worker/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.evaluate((tracked) => {
      ;(window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 64, steps: 10, tracked })
    }, FIXTURE_POOLS_4)
    await openMonteCarloDialog(page)
    const runBtn = page.locator('.mcdlg__foot .btn--primary')
    await expect(runBtn).toBeEnabled()
    await runBtn.click()
    await expect.poll(() => mcSnapshot(page).then((s) => s.status), { timeout: 20_000 }).toBe('done')
    expect((await mcSnapshot(page)).hasResult).toBe(true)
  })
})

test.describe('Risky Factory demo graph', () => {
  test('imports, runs, and renders a populated termination sparkline', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())

    const g = await graphSnapshot(page)
    expect(g.nodeCount).toBe(18)
    expect(g.edgeCount).toBe(17)

    await runMc(page, { baseSeed: 1, runs: 200, steps: 40 }) // all pools tracked

    const term = page.locator('.term')
    await expect(term).toBeVisible()
    // this graph DOES terminate some runs → a real line + Bead, no note
    await expect(term.locator('.term__line')).toHaveCount(1)
    await expect(term.locator('.term__bead')).toHaveCount(1)
    await expect(term.locator('.term__empty')).toHaveCount(0)
    const pct = Number((await term.locator('.term__pct b').innerText()).replace('%', ''))
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThan(100)
  })
})

test.describe('Monte Carlo determinism', () => {
  test('same config ⇒ identical band values', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())

    await runMc(page, { baseSeed: 1, runs: 120, steps: 20, tracked: FIXTURE_POOLS_4 })
    const a = await page.evaluate(
      () => (window as any).__loop.mc.getState().result.series,
    )
    await runMc(page, { baseSeed: 1, runs: 120, steps: 20, tracked: FIXTURE_POOLS_4 })
    const b = await page.evaluate(
      () => (window as any).__loop.mc.getState().result.series,
    )
    expect(b).toEqual(a)
  })
})
