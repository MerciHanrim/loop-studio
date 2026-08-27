import {
  expect,
  FIXTURE_POOLS_4,
  graphSnapshot,
  importGraph,
  mcSnapshot,
  openApp,
  readFixture,
  resetAll,
  runMc,
  test,
} from './support/loop'

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

    await page.locator('.pstrip__mc button').click()
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
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
  })

  test('the LIVE-view legend is hidden in DISTRIBUTION and returns in LIVE', async ({ page }) => {
    await runMc(page, { baseSeed: 1, runs: 20, steps: 6, tracked: FIXTURE_POOLS_4 })

    const legend = page.locator('.timeline__legend')
    const tab = (name: string) => page.locator('.timeline__viewtab', { hasText: name })

    // run() lands on DISTRIBUTION — the LIVE legend must not compete with the
    // distribution stats row
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    await expect(legend).toBeHidden()

    await tab('LIVE').click()
    await expect(legend).toBeVisible()

    await tab('DISTRIBUTION').click()
    await expect(legend).toBeHidden()
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
    expect(s.message).toBe('Cancelled')
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
