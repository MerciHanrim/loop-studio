import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { openFileSubmenu, openInputsTab, pickLocale, pickTemplate } from './support/workbenchMenus'

// docs/gacha-standard.md — the Standard gacha Template, opened from File ▸
// Templates as a user opens it: unlocked and fitted whole, the pity block
// framed, no route-point warning on any line (Korean and English names), its
// description in the menu, and a run that does what the description says —
// the counter resets on every SSR, at the ceiling the forced SSR takes the
// pull, the ceiling hits count those, the run stops at the target + 2.

type Bridge = { __loop: Record<string, { getState: () => any }> }

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

async function openStandard(page: Page) {
  await pickTemplate(page, 'gacha-standard')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(21)
}

/** the lines carrying §ER4's flag (a route point inside a node's or a name's clearance) */
const flagged = async (page: Page) => {
  await routesSettled(page)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.react-flow__edge path.react-flow__edge-path').length)).toBe(21)
  return page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].filter((e) => e.querySelector('.route-invalid-flag')).map((e) => (e as HTMLElement).dataset.id))
}

test.describe('the Standard gacha Template', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('the menu describes it; it opens unlocked, every node inside the canvas bounds, the pity block framed, no route-point warning in Korean or English', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    const row = sub.locator('[data-template="gacha-standard"]')
    await expect(row.locator('.menu__name')).toHaveText('상시 가챠')
    // its description: the row's own, and in the submenu's description area
    // when pointed at, whole (docs/workbench.md §WB2.2)
    const blurb = '하드 천장이 있는 배너 하나. 천장에 이르면 다음 뽑기가 확정 SSR이 됩니다.'
    await expect(row).toHaveAccessibleDescription(blurb)
    await row.hover()
    await expect(sub.locator('.dmenu__desc.is-shown')).toHaveText(blurb)
    // the submenu, then File
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await openStandard(page)
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
    // the whole model fitted: every symbol inside the canvas BOUNDS (not "every
    // symbol visible" — the fit / minimap overlap is an open item, as in the
    // General gacha's spec)
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
    await expect(page.locator('.lgr-frame__label, .lgr-frame__title').filter({ hasText: '천장' })).toHaveCount(1)
    // the Roll's three branches leave its bottom as one fan, so its name is on its free right side
    await expect(page.locator('.react-flow__node[data-id="roll"] .nodef__name')).toHaveText('뽑기 판정')
    await expect(page.locator('.react-flow__node[data-id="roll"] .nodef__name')).toHaveClass(/nodef__name--right/)
    expect(await flagged(page), 'no line carries the route-point warning (ko)').toEqual([])

    // the same file in English: the names change width, the warning stays absent
    await pickLocale(page, 'en')
    await expect(page.locator('.react-flow__node[data-id="roll"] .nodef__name')).toHaveText('Roll')
    expect(await flagged(page), 'no line carries the route-point warning (en)').toEqual([])
  })

  test('a run: the counts add up to the pulls made, the counter never reaches the ceiling, the end comes at the target + 2', async ({ page }) => {
    await openStandard(page)
    const { rows, status } = await runToEnd(page, 220)
    expect(status).toBe('ended')
    expect(rows[rows.length - 1].step).toBe(202)
    for (const r of rows) {
      expect(r.v.ssr_count + r.v.sr_count + r.v.r_count).toBe(r.v.pulls_made)
      expect(r.v.pity).toBeLessThan(80)
    }
    const last = rows[rows.length - 1].v
    expect(last.pulls_made).toBe(200)
    expect(last.ceiling_hits).toBeLessThanOrEqual(last.ssr_count)
  })

  // a TEST setting, not the ceiling's general result: SSR weight 0 (no natural
  // SSR; SR 90, R 900 as shipped), ceiling 4, target 200 as shipped — only
  // then is every 4th pull forced and the forced SSRs exactly 200 ÷ 4 = 50
  test('set in the Inputs tab — SSR weight 0, SR 90, R 900, ceiling 4, target 200: every 4th pull is the forced SSR (50), through the SSR result', async ({ page }) => {
    await openStandard(page)
    await openInputsTab(page)
    await page.getByRole('spinbutton', { name: 'SSR 가중치 값' }).fill('0')
    await page.getByRole('spinbutton', { name: '천장 횟수 값' }).fill('4')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ns = (window as unknown as Bridge).__loop.graph.getState().nodes as { id: string; data: { value?: number } }[]
          return [ns.find((n) => n.id === 'w_ssr')!.data.value, ns.find((n) => n.id === 'hard_pity')!.data.value]
        }),
      )
      .toEqual([0, 4])
    const { rows, status } = await runToEnd(page, 220)
    expect(status).toBe('ended')
    const last = rows[rows.length - 1].v
    // 200 pulls, every 4th forced: 50 forced SSRs, each one counted by the SSR
    // result's count and by the ceiling hits; the counter runs 1, 2, 3, 0
    expect(last.pulls_made).toBe(200)
    expect(last.ceiling_hits).toBe(50)
    expect(last.ssr_count).toBe(50)
    const pulls = rows.filter((r, i) => i > 0 && r.v.pulls_made > rows[i - 1].v.pulls_made)
    expect(pulls.slice(0, 8).map((r) => r.v.pity)).toEqual([1, 2, 3, 0, 1, 2, 3, 0])
  })

  test('the Roll’s panel: SSR 1 %, SR 9 %, R 90 % of the sum 1,000', async ({ page }) => {
    await openStandard(page)
    await page.locator('.wb-left .wb-row[data-node="roll"]').click()
    const chances = await page
      .locator('.app__body > :last-child .wb-rel__row--chance')
      .evaluateAll((els) => els.map((e) => [e.querySelector('.wb-rel__name')!.textContent, e.querySelector('.wb-rel__chance')!.textContent]))
    expect(Object.fromEntries(chances)).toEqual({ 'SSR 결과': '1%', 'SR 결과': '9%', 'R 결과': '90%' })
    await expect(page.locator('.app__body > :last-child .wb-rel__sum')).toHaveText('확률 = 가중치 ÷ 합계 1,000')
  })
})
