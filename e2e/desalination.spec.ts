import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, openApp, resetAll, runMc, test } from './support/loop'
import { openFileSubmenu, pickLocale, pickTemplate } from './support/workbenchMenus'

// #471 — the seawater desalination process example (examples/desalination.json),
// opened from File ▸ Templates as a user opens it: in Korean, with its kinds
// table, units, step length and five numbered frames, a 24-step run whose water
// balance holds, and the Properties panel showing an amount in its authored
// unit (SEMANTICS-M4.md §M4-5). The numbers themselves, the failure shapes and
// the a-priori bound are pinned by test/desalination-example.test.ts.

type Bridge = { __loop: Record<string, any> }

const NODES = 37
const WATER_TANKS = ['basin', 'filtered', 'permeate', 'product', 'brine', 'backwash']

const model = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return {
      modelVersion: g.modelVersion as number,
      time: g.time,
      kinds: g.kinds as { name: string; conserved: boolean }[],
      labels: Object.fromEntries((g.nodes as { id: string; data: { label: string } }[]).map((n) => [n.id, n.data.label])),
      frames: (l.frame.getState().frames as { label: string }[]).map((f) => f.label),
    }
  })

async function open(page: Page) {
  await pickTemplate(page, 'desalination')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(NODES)
}

/** a downloaded file's text, without the BOM a CSV carries */
const textOf = async (dl: Download): Promise<string> => readFileSync((await dl.path())!, 'utf8').replace(String.fromCodePoint(0xfeff), '')
/** these files hold no quoted field: the labels are plain */
const rowsOf = (csv: string): string[][] => csv.trim().split('\r\n').map((l) => l.split(','))

test.describe('the desalination process example', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('opens from File ▸ Templates in Korean with its kinds, units, step length and frames, and runs a day with the water balance held', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    await expect(sub.locator('[data-template="desalination"] .menu__name')).toHaveText('해수 담수화 공정')
    await open(page)

    const m = await model(page)
    expect(m.modelVersion).toBe(4)
    expect(m.time).toEqual({ step: { value: 1, unit: 'h' }, display: 'd' })
    expect(m.kinds.find((k) => k.name === 'water')?.conserved).toBe(true)
    expect(m.kinds.filter((k) => k.name !== 'water').every((k) => !k.conserved)).toBe(true)
    expect(m.labels).toMatchObject({ ro: '역삼투', product: '정수 탱크', brine: '방류 탱크' })
    expect(m.frames).toEqual(['1 취수', '2 전처리', '3 역삼투', '4 후처리·송수', '5 방류·슬러지'])

    // a day: 24 steps through the store's own advance, as Step does
    const run = await page.evaluate((tanks) => {
      const l = (window as unknown as Bridge).__loop
      l.sim.getState().reset()
      const W = (v: Record<string, number>) => tanks.reduce((s, id) => s + (v[id] ?? 0), 0)
      const w0 = W(l.sim.getState().values)
      for (let i = 0; i < 24; i++) l.sim.getState().advance()
      const s = l.sim.getState()
      return { step: s.stepIndex as number, refusals: s.kindRefusals.length as number, w0, w: W(s.values), product: s.values.product as number }
    }, WATER_TANKS)
    expect(run).toMatchObject({ step: 24, refusals: 0, w0: 10700 })
    // steady: 21000 m³ a day in, and the same out across three exits
    expect(run.w).toBeCloseTo(10700, 6)
    expect(run.product).toBeCloseTo(1500, 6)

    // the Properties panel: the product water in its authored unit
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.setState({ selectedNodeId: 'product', selectedEdgeId: null }))
    const current = page.locator('.inspector .field').filter({ has: page.locator('.field__label', { hasText: '현재 수량' }) }).locator('input')
    await expect(current).toHaveValue(/^(≈ )?1500000 L$/)
  })

  test('opens on the five frames, an overview at a 1280 window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom))
      .toBeGreaterThan(0.33)
    const shown = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      const v = l.rf.getViewport()
      const p = document.querySelector('.react-flow')!.getBoundingClientRect()
      return (l.frame.getState().frames as { rect: { x: number; y: number; w: number; h: number } }[]).every((f) => {
        const left = f.rect.x * v.zoom + v.x
        const top = f.rect.y * v.zoom + v.y
        return left >= -1 && top >= -1 && left + f.rect.w * v.zoom <= p.width + 1 && top + f.rect.h * v.zoom <= p.height + 1
      })
    })
    expect(shown, 'every frame is on the first screen').toBe(true)
  })

  // SEMANTICS-M4.md §M4-6 — what a person actually downloads: numbers in the
  // base unit, the unit named beside them, the node id still the last bracket
  test('its downloads keep numbers in the base unit and name the unit', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.sim.getState().reset()
      for (let i = 0; i < 24; i++) l.sim.getState().advance()
    })

    const csvBtn = page.locator('.timeline__csv').filter({ hasNotText: /▾/ }).first()
    await expect(csvBtn).toBeEnabled()
    const [run] = await Promise.all([page.waitForEvent('download'), csvBtn.click()])
    const runRows = rowsOf(await textOf(run))
    expect(runRows[0]).toEqual(expect.arrayContaining(['정수 탱크 [m³] [product]', '방류 탱크 [m³] [brine]']))
    const product = runRows[0].indexOf('정수 탱크 [m³] [product]')
    expect(Number(runRows[1][product]), 'the Pool is authored as 1500000 L').toBe(1500)
    expect(Number(runRows.at(-1)![product])).toBeCloseTo(1500, 6)

    await runMc(page, { baseSeed: 1, runs: 3, steps: 24, tracked: [] })
    const fromMenu = async (item: number) => {
      await page.locator('.dist__stats .menu button').first().click()
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem').nth(item).click()])
      return textOf(dl)
    }
    expect(rowsOf(await fromMenu(0))[0].slice(0, 3)).toEqual(['step', 'pool', 'unit'])
    expect(rowsOf(await fromMenu(1))[0]).toContain('정수 탱크 [m³]')

    const summary = rowsOf(await fromMenu(2))
    expect(summary[0]).toEqual(['pool', 'unit', 'p10', 'p50', 'p90', 'mean', 'min', 'max'])
    const row = summary.find((r) => r[0] === '정수 탱크')!
    expect(row[1]).toBe('m³')
    expect(Number(row[summary[0].indexOf('p50')])).toBeCloseTo(1500, 6)

    const json = JSON.parse(await fromMenu(3))
    expect(json.spec).toBe('loop-mc/1')
    expect(json.units).toMatchObject({ basin: 'm³', product: 'm³', brine: 'm³', panelB: 'kWh', coag: 'kg' })
    expect(json.config.time.step, 'the one home of the step length').toEqual({ value: 1, unit: 'h' })
    expect(json).not.toHaveProperty('time')
    expect(typeof json.final.product.summary.p50).toBe('number')
  })
})
