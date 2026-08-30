import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { simSnapshot } from './support/mc'

// SLICE-2 §7 (http): any simulation-relevant graph change bumps simulationRev,
// which resets the live sim AND marks an existing Monte-Carlo result `stale`
// (still viewable, export disabled). Config edits do NOT stale a result.
// Covers undo, redo, and template swap — including how `tracked` reconciles.

const RF_POOL = 'ore_stock'

const mc = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__loop.mc.getState()
    return { stale: m.stale, status: m.status, hasResult: Boolean(m.result), tracked: [...m.config.tracked], runs: m.config.runs, view: m.view }
  })

const run = (page: Page) =>
  page.evaluate(async () => {
    const m = (window as any).__loop.mc.getState()
    await m.run()
  })

const poolIds = (page: Page) =>
  page.evaluate(() =>
    (window as any).__loop.graph.getState().nodes.filter((n: any) => n.data.kind === 'pool').map((n: any) => n.id),
  )

async function importRF(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node')).toHaveCount(18)
}

test.describe('MC / sim invalidation', () => {
  test('undo and redo both stale the result and reset the live sim; re-run clears it', async ({ page }) => {
    await importRF(page)
    await page.evaluate((id) => (window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 120, steps: 20, tracked: [id] }), RF_POOL)
    await run(page)
    expect((await mc(page)).stale).toBe(false)
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    const exportBtn = page.locator('.dist__stats .menu button', { hasText: 'Export' })
    await expect(exportBtn).toBeEnabled()

    // advance the live sim, then make an undoable structural edit
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance(); s.advance(); s.advance()
    })
    expect((await simSnapshot(page)).stepIndex).toBe(3)
    await page.evaluate((id) => (window as any).__loop.graph.getState().updateNodeData(id, { capacity: 999 }), RF_POOL)
    expect((await simSnapshot(page)).canUndo).toBe(true)

    // undo
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    let m = await mc(page)
    expect(m.stale).toBe(true)
    expect(m.hasResult).toBe(true) // still viewable
    await expect(exportBtn).toBeDisabled()
    let s = await simSnapshot(page)
    expect(s.stepIndex).toBe(0)
    expect(s.status).toBe('idle')

    // redo — also bumps the rev, so still stale
    await page.evaluate(() => (window as any).__loop.graph.getState().redo())
    m = await mc(page)
    expect(m.stale).toBe(true)
    expect(m.hasResult).toBe(true)

    // re-run clears stale
    await run(page)
    m = await mc(page)
    expect(m.stale).toBe(false)
    await expect(exportBtn).toBeEnabled()
  })

  test('a config edit (runs/steps/seed/tracked) does NOT stale a result', async ({ page }) => {
    await importRF(page)
    await page.evaluate((id) => (window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 120, steps: 20, tracked: [id] }), RF_POOL)
    await run(page)
    expect((await mc(page)).stale).toBe(false)

    await page.evaluate(() => (window as any).__loop.mc.getState().setConfig({ runs: 300 }))
    const m = await mc(page)
    expect(m.stale).toBe(false)
    expect(m.runs).toBe(300)
    expect(m.hasResult).toBe(true)
  })

  test('template swap — explicit tracked subset reconciles to the first template Pool', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await importRF(page)
    await page.evaluate(() => (window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 120, steps: 20, tracked: ['ore_stock', 'components'] }))
    await run(page)
    expect((await mc(page)).stale).toBe(false)

    await page.getByRole('button', { name: /Templates/ }).click()
    await page.getByRole('menuitem', { name: 'Flowing equilibrium' }).click()

    // graph replaced
    await expect(page.locator('.react-flow__node')).toHaveCount(7)
    const pools = await poolIds(page)
    expect(pools).toEqual(['tpl-vault', 'tpl-prod'])

    const m = await mc(page)
    expect(m.stale).toBe(true)
    expect(m.hasResult).toBe(true) // still viewable
    // empty intersection with ['ore_stock','components'] + pools remain ⇒ first pool
    expect(m.tracked).toEqual(['tpl-vault'])

    const s = await simSnapshot(page)
    expect(s.status).toBe('idle')
    expect(s.stepIndex).toBe(0)
  })

  test('template swap — tracked:[] ("all") stays [] after the swap', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await importRF(page)
    // force "all pools" (import applied risky-factory's recommended 6-Pool subset)
    await page.evaluate(() => (window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 120, steps: 20, tracked: [] }))
    await run(page)
    expect((await mc(page)).tracked).toEqual([])

    await page.getByRole('button', { name: /Templates/ }).click()
    await page.getByRole('menuitem', { name: 'Bottleneck deadlock' }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(6)

    const m = await mc(page)
    expect(m.stale).toBe(true)
    expect(m.tracked).toEqual([]) // still "all" — now the template's pools
  })

  test('template swap while the live sim is running pauses it first', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await importRF(page)
    await page.evaluate(() => (window as any).__loop.sim.getState().play())
    await expect.poll(() => simSnapshot(page).then((s) => s.status)).toBe('running')

    await page.getByRole('button', { name: /Templates/ }).click()
    await page.getByRole('menuitem', { name: 'Flowing equilibrium' }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(7)

    const s = await simSnapshot(page)
    expect(s.status).not.toBe('running')
    expect(s.stepIndex).toBe(0)
  })
})
