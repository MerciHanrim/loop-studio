import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, openApp, resetAll, runMc, test } from './support/loop'
import { openFileSubmenu, pickLocale, pickTemplate } from './support/workbenchMenus'

// #471 — the desalination Template (examples/desalination.json), opened from
// File ▸ Templates as a user opens it: in Korean, with its kinds table, units
// and step length (loop-model/4), a 24-step run whose water balance holds, and
// the Properties panel showing the product water at 15 significant digits with
// `≈` where that is not the engine value (SEMANTICS-M4.md §M4-5). The numbers
// themselves are pinned by test/desalination-example.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any; setState: (s: object) => void }> }

const model = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return {
      modelVersion: g.modelVersion as number,
      time: g.time,
      kinds: g.kinds as { name: string; conserved: boolean; units?: unknown[]; rateUnits?: unknown[] }[],
      labels: Object.fromEntries((g.nodes as { id: string; data: { label: string } }[]).map((n) => [n.id, n.data.label])),
    }
  })

/** a downloaded file's text, without the BOM a CSV carries */
const textOf = async (dl: Download): Promise<string> => readFileSync((await dl.path())!, 'utf8').replace(String.fromCodePoint(0xfeff), '')
/** these files hold no quoted field: the labels are plain */
const rowsOf = (csv: string): string[][] => csv.trim().split('\r\n').map((l) => l.split(','))

test.describe('the desalination Template', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('opens from File ▸ Templates in Korean with its kinds, units and step length, and runs a day with the water balance held', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    await expect(sub.locator('[data-template="desalination"] .menu__name')).toHaveText('담수화 단위·수지 임시 샘플')
    await pickTemplate(page, 'desalination')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(9)

    const m = await model(page)
    expect(m.modelVersion).toBe(4)
    expect(m.time).toEqual({ step: { value: 1, unit: 'h' }, display: 'd' })
    expect(m.kinds.map((k) => [k.name, k.conserved])).toEqual([['water', true], ['power', false]])
    expect(m.labels).toMatchObject({ ro: '역삼투', permeate: '생산수', brine: '농축수' })

    // a day: 24 steps through the store's own advance, as Step does
    const run = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.sim.getState().reset()
      const W = (v: Record<string, number>) => (v.feed ?? 0) + (v.permeate ?? 0) + (v.brine ?? 0)
      const w0 = W(l.sim.getState().values)
      for (let i = 0; i < 24; i++) l.sim.getState().advance()
      const s = l.sim.getState()
      return { step: s.stepIndex as number, refusals: s.kindRefusals.length as number, w0, w: W(s.values), permeate: s.values.permeate as number }
    })
    expect(run).toMatchObject({ step: 24, refusals: 0, w0: 700 })
    // 24 h of 1000 m³/day in, 400 m³/day to the city, the brine one step behind
    expect(run.w).toBeCloseTo(700 + 1000 - 400 - (23 * 1000 * 0.55) / 24, 9)
    expect(run.permeate).toBeCloseTo(250, 9)

    // the Properties panel: the product water in its authored unit
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.setState({ selectedNodeId: 'permeate', selectedEdgeId: null }))
    const current = page.locator('.inspector .field').filter({ has: page.locator('.field__label', { hasText: '현재 수량' }) }).locator('input')
    await expect(current).toHaveValue('≈ 250000 L')
  })

  // SEMANTICS-M4.md §M4-6 — what a person actually downloads: numbers in the
  // base unit, the unit named beside them, the node id still the last bracket
  test('its downloads keep numbers in the base unit and name the unit', async ({ page }) => {
    await pickTemplate(page, 'desalination')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(9)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.sim.getState().reset()
      for (let i = 0; i < 24; i++) l.sim.getState().advance()
    })

    const csvBtn = page.locator('.timeline__csv').filter({ hasNotText: /▾/ }).first()
    await expect(csvBtn).toBeEnabled()
    const [run] = await Promise.all([page.waitForEvent('download'), csvBtn.click()])
    const runRows = rowsOf(await textOf(run))
    expect(runRows[0]).toEqual(expect.arrayContaining(['생산수 [m³] [permeate]', '농축수 [m³] [brine]']))
    const permeate = runRows[0].indexOf('생산수 [m³] [permeate]')
    expect(Number(runRows[1][permeate]), 'the Pool is authored as 200000 L').toBe(200)
    expect(Number(runRows.at(-1)![permeate])).toBeCloseTo(250, 9)

    await runMc(page, { baseSeed: 1, runs: 3, steps: 24, tracked: [] })
    const fromMenu = async (item: number) => {
      await page.locator('.dist__stats .menu button').first().click()
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem').nth(item).click()])
      return textOf(dl)
    }
    expect(rowsOf(await fromMenu(0))[0].slice(0, 3)).toEqual(['step', 'pool', 'unit'])
    expect(rowsOf(await fromMenu(1))[0]).toContain('생산수 [m³]')

    const summary = rowsOf(await fromMenu(2))
    expect(summary[0]).toEqual(['pool', 'unit', 'p10', 'p50', 'p90', 'mean', 'min', 'max'])
    const row = summary.find((r) => r[0] === '생산수')!
    expect(row[1]).toBe('m³')
    expect(Number(row[summary[0].indexOf('p50')])).toBeCloseTo(250, 9)

    const json = JSON.parse(await fromMenu(3))
    expect(json.spec).toBe('loop-mc/1')
    expect(json.units).toEqual({ feed: 'm³', power: 'kWh', permeate: 'm³', brine: 'm³' })
    expect(json.config.time.step, 'the one home of the step length').toEqual({ value: 1, unit: 'h' })
    expect(json).not.toHaveProperty('time')
    expect(typeof json.final.permeate.summary.p50).toBe('number')
  })
})
