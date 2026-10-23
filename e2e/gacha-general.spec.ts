import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openFileMenu, openInputsTab, pickLocale, pickTemplate } from './support/workbenchMenus'

// docs/gacha-general.md — the General gacha Template, opened from File ▸
// Templates as a user opens it: unlocked and fitted whole, its description in
// the menu, and a run that does what the description says — a changed target
// moves the end, the result counts add up to the pulls made, the run stops at
// the target, and the hit rate is counted against the target.

type Bridge = { __loop: Record<string, { getState: () => any }> & { rf: { getViewport: () => { zoom: number } } } }

const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return { step: s.stepIndex as number, status: s.status as string, values: s.values as Record<string, number> }
  })

/** advance one step at a time until the run ends (or `max` steps) */
const runToEnd = (page: Page, max: number) =>
  page.evaluate((max) => {
    const l = (window as unknown as Bridge).__loop
    l.sim.getState().reset()
    const rows: { step: number; v: Record<string, number> }[] = []
    for (let i = 0; i < max && l.sim.getState().status !== 'ended'; i++) {
      l.sim.getState().advance()
      const s = l.sim.getState()
      rows.push({ step: s.stepIndex, v: { ...s.values } })
    }
    return { rows, status: l.sim.getState().status as string }
  }, max)

async function openGeneral(page: Page) {
  await pickTemplate(page, 'gacha-general')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(17)
}

test.describe('the General gacha Template', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('the menu describes it — the hit rate’s denominator and the stop, in two lines — and it opens unlocked with every node inside the canvas bounds', async ({ page }) => {
    await openFileMenu(page)
    const row = page.locator('.toolbar__filemenu-pop [data-template="gacha-general"]')
    await expect(row.locator('.menu__name')).toHaveText('일반 가챠')
    // the menu's description is held to two lines (help-menu-readability); the
    // whole explanation is docs/gacha-general.md
    await expect(row.locator('.menu__blurb')).toHaveText('천장 없는 배너 하나. 적중률은 목표 뽑기 횟수가 분모이고, 목표에 이르면 끝납니다.')
    await page.keyboard.press('Escape')
    await openGeneral(page)
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
    // the whole model fitted: every symbol inside the canvas BOUNDS. This is
    // not "every symbol visible": with the minimap open, Reset view keeps no
    // room for it, and at 1440 × 900 it covers the Completion signal — an open
    // item (the fit / minimap overlap), not checked or claimed here
    await expect
      .poll(() =>
        page.evaluate(() => {
          const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
          return [...document.querySelectorAll('.react-flow__node .nodef__shape')].filter((s) => {
            const r = s.getBoundingClientRect()
            return r.left < pane.left || r.right > pane.right || r.top < pane.top || r.bottom > pane.bottom
          }).length
        }),
      )
      .toBe(0)
    await expect(page.locator('.react-flow__node[data-id="roll"] .nodef__name')).toHaveText('뽑기 판정')
  })

  test('a run: the counts add up to the pulls made, the end comes at the target + 2, the hit rate is SSR ÷ the target', async ({ page }) => {
    await openGeneral(page)
    const { rows, status } = await runToEnd(page, 220)
    expect(status).toBe('ended')
    expect(rows[rows.length - 1].step).toBe(202)
    for (const r of rows) expect(r.v.ssr_count + r.v.sr_count + r.v.r_count).toBe(r.v.pulls_made)
    const last = rows[rows.length - 1].v
    expect(last.pulls_made).toBe(200)
    // the Summary's hit rate, as shown, is SSR count ÷ 200
    await openInputsTab(page)
    const expected = await page.evaluate(async (ssr) => {
      const m = await import('/src/model/model/observe.ts')
      return m.formatRegisterValue(ssr / 200, 'percent')
    }, last.ssr_count)
    const reg = page.locator('.wb-left .mp-row--reg', { hasText: 'SSR 적중률' })
    await expect(reg.locator('.mp-row__val')).toHaveText(expected)
  })

  test('the target changed in the Inputs tab: the end moves to the new target + 2, and the hit rate divides by it', async ({ page }) => {
    await openGeneral(page)
    await openInputsTab(page)
    const field = page.getByRole('spinbutton', { name: '목표 뽑기 횟수(정수) 값' })
    await field.fill('50')
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === 'target_pulls').data.value)).toBe(50)
    const { rows, status } = await runToEnd(page, 80)
    expect(status).toBe('ended')
    expect(rows[rows.length - 1].step).toBe(52)
    const last = rows[rows.length - 1].v
    expect(last.pulls_made).toBe(50)
    expect(last.ssr_count + last.sr_count + last.r_count).toBe(50)
    // the step before the end: the target reached, the end not fired yet
    expect(rows[rows.length - 2].v.pulls_made).toBe(50)
    const expected = await page.evaluate(async (ssr) => {
      const m = await import('/src/model/model/observe.ts')
      return m.formatRegisterValue(ssr / 50, 'percent')
    }, last.ssr_count)
    await expect(page.locator('.wb-left .mp-row--reg', { hasText: 'SSR 적중률' }).locator('.mp-row__val')).toHaveText(expected)
    const now = await sim(page)
    expect(now.status).toBe('ended')
  })

  test('the Roll’s panel: SSR 0.6 %, SR 5.1 %, R 94.3 % of the sum 1,000', async ({ page }) => {
    await openGeneral(page)
    await page.locator('.wb-left').getByText('뽑기 판정', { exact: true }).first().click()
    const chances = await page
      .locator('.app__body > :last-child .wb-rel__row--chance')
      .evaluateAll((els) => els.map((e) => [e.querySelector('.wb-rel__name')!.textContent, e.querySelector('.wb-rel__chance')!.textContent]))
    expect(Object.fromEntries(chances)).toEqual({ 'SSR 결과': '0.6%', 'SR 결과': '5.1%', 'R 결과': '94.3%' })
    await expect(page.locator('.app__body > :last-child .wb-rel__sum')).toHaveText('확률 = 가중치 ÷ 합계 1,000')
  })
})
