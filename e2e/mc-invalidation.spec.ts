import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { forcePath, installProbe, pathProbe, simSnapshot } from './support/mc'
import { openFileSubmenu } from './support/workbenchMenus'

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
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
    const exportBtn = page.locator('.dist__stats .menu button', { hasText: 'Export' })
    await expect(exportBtn).toBeEnabled()

    // advance the live sim, then make an undoable structural edit. The Risky
    // Factory reaches its End at step 2, and a step after `ended` is a fixed
    // point (#419 item 1) — so three advances land on step 2, ended, not 3.
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance(); s.advance(); s.advance()
    })
    const advanced = await simSnapshot(page)
    expect(advanced.stepIndex).toBe(2)
    expect(advanced.status).toBe('ended')
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

    // the workbench: Templates are rows of File ▸ Templates (docs/workbench.md §WB2.2)
    await openFileSubmenu(page, 'templates')
    await page.getByRole('menuitem', { name: 'Balanced production line' }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i }).click()

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

    await openFileSubmenu(page, 'templates')
    await page.getByRole('menuitem', { name: 'Capacity deadlock' }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(6)

    const m = await mc(page)
    expect(m.stale).toBe(true)
    expect(m.tracked).toEqual([]) // still "all" — now the template's pools
  })

  // issue #407 — an edit while a run is in flight. The run is not cancelled and
  // the result is the start graph's; on completion the start rev is compared
  // with the document's and the result lands already stale: the same tag and
  // the same disabled Export an edit after completion produces. The Worker
  // path here (the cooperative path is the unit test in
  // src/store/mcStore.mid-run-edit.test.ts). The edit is issued in the same
  // task as the start, before the Workers have their job, so it is in flight
  // by construction; the graph was copied when run() began.
  test('an edit while a Monte Carlo run is in flight lands the result stale, like an edit after it; a re-run at the current graph clears it (#407)', async ({ page }) => {
    await installProbe(page)
    await forcePath(page, 'worker')
    await importRF(page)
    await page.evaluate((id) => (window as any).__loop.mc.getState().setConfig({ baseSeed: 1, runs: 800, steps: 40, tracked: [id] }), RF_POOL)

    const started = await page.evaluate((id) => {
      const l = (window as any).__loop
      const g = l.graph.getState()
      const revAtStart = g.simulationRev
      const initialAtStart = g.nodes.find((n: any) => n.id === id).data.initial as number
      void l.mc.getState().run()
      const statusAtEdit = l.mc.getState().status
      g.updateNodeData(id, { initial: initialAtStart + 7 })
      return { revAtStart, initialAtStart, statusAtEdit, revAfterEdit: l.graph.getState().simulationRev, staleDuring: l.mc.getState().stale }
    }, RF_POOL)
    expect(started.statusAtEdit).toBe('running')
    expect(started.revAfterEdit).toBe(started.revAtStart + 1)
    expect(started.staleDuring).toBe(false) // a first run: no result for the subscription to mark

    await expect.poll(() => mc(page).then((m) => m.status), { timeout: 40_000 }).toBe('done')
    expect((await pathProbe(page)).wk.job, 'the Worker path ran it').toBeGreaterThanOrEqual(1)

    const read = (pool: string) =>
      page.evaluate((id) => {
        const l = (window as any).__loop
        const m = l.mc.getState()
        return {
          stale: m.stale as boolean,
          runRev: m.runRev as number,
          completed: m.result.completedRuns as number,
          step0: m.result.series[id].mean[0] as number,
          runGraphInitial: m.runGraph.nodes.find((n: any) => n.id === id).data.initial as number,
          docInitial: l.graph.getState().nodes.find((n: any) => n.id === id).data.initial as number,
        }
      }, pool)
    // the result ran to the end, on the START graph, and arrived marked
    expect(await read(RF_POOL)).toEqual({
      stale: true,
      runRev: started.revAtStart,
      completed: 800,
      step0: started.initialAtStart,
      runGraphInitial: started.initialAtStart,
      docInitial: started.initialAtStart + 7,
    })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
    const staleTag = page.locator('.dist__stale')
    const exportBtn = page.locator('.dist__stats .menu button', { hasText: 'Export' })
    await expect(staleTag).toBeVisible()
    await expect(exportBtn).toBeDisabled()
    const tagMidRun = await staleTag.textContent()

    // a re-run at the current graph clears it
    await run(page)
    expect(await read(RF_POOL)).toMatchObject({ stale: false, step0: started.initialAtStart + 7, docInitial: started.initialAtStart + 7 })
    await expect(staleTag).toBeHidden()
    await expect(exportBtn).toBeEnabled()

    // the control: the same edit AFTER completion shows exactly the same way
    await page.evaluate((id) => (window as any).__loop.graph.getState().updateNodeData(id, { initial: 1 }), RF_POOL)
    expect(await read(RF_POOL)).toMatchObject({ stale: true, step0: started.initialAtStart + 7, docInitial: 1 })
    await expect(staleTag).toBeVisible()
    await expect(staleTag).toHaveText(tagMidRun!)
    await expect(exportBtn).toBeDisabled()
  })

  test('template swap while the live sim is running pauses it first', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await importRF(page)
    await page.evaluate(() => (window as any).__loop.sim.getState().play())
    await expect.poll(() => simSnapshot(page).then((s) => s.status)).toBe('running')

    await openFileSubmenu(page, 'templates')
    await page.getByRole('menuitem', { name: 'Balanced production line' }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(7)

    const s = await simSnapshot(page)
    expect(s.status).not.toBe('running')
    expect(s.stepIndex).toBe(0)
  })
})
