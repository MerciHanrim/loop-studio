import { readFileSync } from 'node:fs'
import type { Download } from '@playwright/test'
import {
  expect,
  FIXTURE_POOLS_4,
  importGraph,
  openApp,
  readFixture,
  resetAll,
  runMc,
  test,
} from './support/loop'

// Item 7 — the Distribution "Export ▾" menu really produces the files, and the
// bytes are what we expect (header shape, row count, a known ratio).

const textOf = async (dl: Download): Promise<string> => {
  const p = await dl.path()
  if (!p) throw new Error('no download path')
  return readFileSync(p, 'utf8')
}

test.describe('Distribution export menu', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())
    await runMc(page, { baseSeed: 1, runs: 200, steps: 30, tracked: FIXTURE_POOLS_4 })
  })

  test('Runs CSV — run,seed,<pools> header, one row per run, Gate B ≈ 3× Gate A', async ({ page }) => {
    await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Runs CSV/ }).click(),
    ])
    expect(dl.suggestedFilename()).toBe('loop-studio-montecarlo-runs.csv')

    const lines = (await textOf(dl)).trim().split('\n')
    expect(lines[0]).toBe('run,seed,Det Pool,Dice Pool,Gate A,Gate B')
    expect(lines).toHaveLength(1 + 200)

    const col = (i: number) =>
      lines.slice(1).map((l) => Number(l.split(',')[i]))
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const gateA = mean(col(4))
    const gateB = mean(col(5))
    expect(gateA).toBeGreaterThan(0)
    expect(gateB / gateA).toBeGreaterThan(2.4)
    expect(gateB / gateA).toBeLessThan(3.5)
    // Det Pool is deterministic: every terminal value is exactly 31
    expect(new Set(col(2))).toEqual(new Set([31]))
  })

  test('JSON — a full MonteCarloResult with the frozen spec ids', async ({ page }) => {
    await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'JSON' }).click(),
    ])
    expect(dl.suggestedFilename()).toBe('loop-studio-montecarlo-result.json')

    const r = JSON.parse(await textOf(dl))
    expect(r.spec).toBe('loop-mc/1')
    expect(r.seedSpec).toBe('loop-mc-seed/1')
    expect(r.rngSpec).toBe('loop-rng/1')
    expect(r.config).toMatchObject({ baseSeed: 1, runs: 200, steps: 30 })
    expect(r.completedRuns).toBe(200)
    expect(r.pools.map((p: { label: string }) => p.label)).toEqual([
      'Det Pool',
      'Dice Pool',
      'Gate A',
      'Gate B',
    ])
  })

  test('the menu is disabled once the result goes stale', async ({ page }) => {
    await page.evaluate(() =>
      (window as any).__loop.graph.getState().addNodeAt('pool', { x: 40, y: 40 }),
    )
    await expect(page.locator('.dist__stale')).toBeVisible()
    await expect(page.locator('.dist__stats .menu button', { hasText: 'Export' })).toBeDisabled()
  })
})
