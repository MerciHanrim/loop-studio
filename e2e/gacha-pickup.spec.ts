import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { openFileSubmenu, openInputsTab, pickLocale, pickTemplate } from './support/workbenchMenus'

// docs/gacha-pickup.md — the Pickup gacha Template, opened from File ▸
// Templates as a user opens it: unlocked and fitted whole, its two blocks
// framed, no route-point warning on any line (Korean and English names), its
// description in the menu, and a run that does what the description says —
// every SSR goes through the SSR result; while owed, the next SSR is the
// pickup; SR / R keep the guarantee; the run stops at the target + 2.

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

async function openPickup(page: Page) {
  await pickTemplate(page, 'gacha-pickup')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(31)
}

/** the lines carrying §ER4's flag (a route point inside a node's or a name's clearance) */
const flagged = async (page: Page) => {
  await routesSettled(page)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.react-flow__edge path.react-flow__edge-path').length)).toBe(32)
  return page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].filter((e) => e.querySelector('.route-invalid-flag')).map((e) => (e as HTMLElement).dataset.id))
}

test.describe('the Pickup gacha Template', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('the menu describes it; it opens unlocked, every node inside the canvas bounds, both blocks framed, the role names, no route-point warning in Korean or English', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    const row = sub.locator('[data-template="gacha-pickup"]')
    await expect(row.locator('.menu__name')).toHaveText('픽업 가챠')
    // its description: the row's own, and in the submenu's description area
    // when pointed at, whole (docs/workbench.md §WB2.2)
    const blurb = '천장과 픽업 보장이 있는 배너 하나. 픽업 외 SSR 다음에 나오는 SSR은 픽업으로 확정됩니다.'
    await expect(row).toHaveAccessibleDescription(blurb)
    await row.hover()
    await expect(sub.locator('.dmenu__desc.is-shown')).toHaveText(blurb)
    // the submenu, then File
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await openPickup(page)
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
    // every symbol inside the canvas BOUNDS (the fit / minimap overlap is an
    // open item, as in the General and Standard gacha's specs)
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
    const titles = await page.locator('.lgr-frame__label').allInnerTexts()
    expect(titles.map((t) => t.trim()).sort()).toEqual(['천장', '픽업 보장'])
    const name = (id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__name`)
    await expect(name('pickup_owed')).toHaveText('픽업 보장 상태')
    await expect(name('owed_route')).toHaveText('픽업 확정')
    await expect(name('pickup_split')).toHaveText('픽업 판정')
    await expect(name('off_ssr')).toHaveText('픽업 외 SSR')
    expect(await flagged(page), 'no line carries the route-point warning (ko)').toEqual([])
    await pickLocale(page, 'en')
    await expect(name('owed_route')).toHaveText('Owed pickup')
    expect(await flagged(page), 'no line carries the route-point warning (en)').toEqual([])
  })

  test('a run: the counts add up, pickup + off-pickup = SSR, the end comes at the target + 2', async ({ page }) => {
    await openPickup(page)
    const { rows, status } = await runToEnd(page, 220)
    expect(status).toBe('ended')
    expect(rows[rows.length - 1].step).toBe(202)
    for (const r of rows) {
      expect(r.v.ssr_count + r.v.sr_count + r.v.r_count).toBe(r.v.pulls_made)
      expect(r.v.pickup_count + r.v.off_count).toBe(r.v.ssr_count)
      expect(r.v.pity).toBeLessThan(80)
    }
    expect(rows[rows.length - 1].v.pulls_made).toBe(200)
  })

  // a TEST setting, not the guarantee's general result: pickup weight 0
  // (every not-owed SSR is off-pickup), SSR 200 / SR 400 / R 400, ceiling 80,
  // target 200 as shipped — only then do the SSRs alternate off-pickup,
  // pickup, off-pickup, … so the two counts never differ by more than one
  test('set in the Inputs tab — pickup weight 0, SSR 200, SR 400, R 400: SSRs alternate off-pickup / pickup; SR / R between keep the guarantee', async ({ page }) => {
    await openPickup(page)
    await openInputsTab(page)
    for (const [label, value] of [['픽업 가중치 값', '0'], ['SSR 가중치 값', '200'], ['SR 가중치 값', '400'], ['R 가중치 값', '400']] as const) {
      await page.getByRole('spinbutton', { name: label, exact: true }).fill(value)
    }
    await expect
      .poll(() => page.evaluate(() => ((window as unknown as Bridge).__loop.graph.getState().nodes as { id: string; data: { value?: number } }[]).filter((n) => ['w_pickup', 'w_ssr', 'w_sr', 'w_r'].includes(n.id)).map((n) => n.data.value).sort()))
      .toEqual([0, 200, 400, 400])
    const { rows, status } = await runToEnd(page, 220)
    expect(status).toBe('ended')
    let keptOverSrR = 0
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].v
      const b = rows[i].v
      expect(b.off_count - b.pickup_count, `step ${rows[i].step}: alternating`).toBeGreaterThanOrEqual(0)
      expect(b.off_count - b.pickup_count, `step ${rows[i].step}: alternating`).toBeLessThanOrEqual(1)
      expect(b.pickup_owed, `step ${rows[i].step}: owed = off-pickup ahead of pickup`).toBe(b.off_count - b.pickup_count)
      if (a.pickup_owed === 1 && b.sr_count + b.r_count > a.sr_count + a.r_count) {
        expect(b.pickup_owed, `step ${rows[i].step}: an SR / R keeps the guarantee`).toBe(1)
        keptOverSrR++
      }
    }
    expect(keptOverSrR, 'SR / R pulls while owed occurred').toBeGreaterThan(0)
    expect(rows[rows.length - 1].v.pickup_count).toBeGreaterThan(0)
  })

  // 2026-10-21 (Lumi): a running value chip shows its applied change only when
  // it says more than the set value. TEST setting so the guarantee turns on
  // early: pickup weight 0, SSR 200 / SR 400 / R 400; stepped to the first
  // off-pickup SSR
  test('a run’s value chips: the guarantee turning on reads "=1" over "Δ +1"; the SSR result’s "+1" pulls made reads "+1" alone', async ({ page }) => {
    await openPickup(page)
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const [id, value] of [['w_pickup', 0], ['w_ssr', 200], ['w_sr', 400], ['w_r', 400]] as const) g.updateNodeData(id, { value })
    })
    const step = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.sim.getState().reset()
      for (let i = 0; i < 200; i++) {
        l.sim.getState().advance()
        if (l.sim.getState().values.off_count === 1) return l.sim.getState().stepIndex as number
      }
      return -1
    })
    expect(step, 'an off-pickup SSR came').toBeGreaterThan(0)
    const on = page.locator('.edge-label[data-edge-id="v_off_owed"]')
    await expect(on).toHaveClass(/edge-label--two/)
    const rows = on.locator('.edge-label__row')
    await expect(rows.nth(0)).toHaveText('=1')
    await expect(rows.nth(1)).toHaveText('Δ+1')
    await expect(on.locator('.sr-only')).toHaveText('설정 =1, 실제 변화 +1')
    const pull = page.locator('.edge-label[data-edge-id="v_ssr_pull"]')
    await expect(pull).toContainText('+1')
    await expect(pull).not.toHaveClass(/edge-label--two/)
    await expect(pull.locator('.edge-label__delta, .edge-label__row, .sr-only')).toHaveCount(0)
  })

  test('the Roll’s panel: SSR 1 %, SR 9 %, R 90 %; the Pickup split: 50 % / 50 %', async ({ page }) => {
    await openPickup(page)
    const chancesOf = async (id: string) => {
      await page.locator(`.wb-left .wb-row[data-node="${id}"]`).click()
      return Object.fromEntries(
        await page
          .locator('.app__body > :last-child .wb-rel__row--chance')
          .evaluateAll((els) => els.map((e) => [e.querySelector('.wb-rel__name')!.textContent, e.querySelector('.wb-rel__chance')!.textContent])),
      )
    }
    expect(await chancesOf('roll')).toEqual({ 'SSR 결과': '1%', 'SR 결과': '9%', 'R 결과': '90%' })
    expect(await chancesOf('pickup_split')).toEqual({ '픽업 SSR': '50%', '픽업 외 SSR': '50%' })
  })
})
