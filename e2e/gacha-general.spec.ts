import type { Page } from '@playwright/test'
import { ARROW_ROOM } from '../src/components/edges/orthogonalRoute'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'
import { openFileSubmenu, openInputsTab, pickLocale, pickTemplate } from './support/workbenchMenus'

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

  test('the menu describes it — the hit rate’s denominator and the stop — and it opens unlocked with every node inside the canvas bounds', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    const row = sub.locator('[data-template="gacha-general"]')
    await expect(row.locator('.menu__name')).toHaveText('일반 가챠')
    // its description: the row's own, and in the submenu's description area
    // when pointed at, whole (docs/workbench.md §WB2.2); the whole explanation
    // is docs/gacha-general.md
    const blurb = '천장 없는 배너 하나. 적중률은 목표 뽑기 횟수가 분모이고, 목표에 이르면 끝납니다.'
    await expect(row).toHaveAccessibleDescription(blurb)
    await row.hover()
    await expect(sub.locator('.dmenu__desc.is-shown')).toHaveText(blurb)
    // the submenu, then File
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await openGeneral(page)
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
    // the whole model fitted: every symbol inside the canvas BOUNDS
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

  // docs/edge-routing.md §ER14.3 — SR result → Pulls made (`e_sr_pull`): its
  // last bend point is 4 px above the top port, and the outside name above
  // shortens the stub, so the drawn line ends in a short run. Read on the
  // DRAWN path (the edge's SVG `d`, corners rounded), in both languages (the
  // names, and so the stub, differ): the stored bend points are on it, it ends
  // going down into the port, and its straight end leaves the arrowhead its room
  for (const locale of ['en', 'ko'] as const) {
    test(`${locale}: the SR result → Pulls made line ends on a straight run of the arrowhead’s room, going down, through its stored bend points`, async ({ page }) => {
      if (locale === 'en') await pickLocale(page, 'en')
      await openGeneral(page)
      await page.evaluate(() => document.fonts.ready)
      await routesSettled(page)
      const got = await page.evaluate(() => {
        const p = document.querySelector('.react-flow__edge[data-id="e_sr_pull"] path.react-flow__edge-path')
        const e = (window as unknown as Bridge).__loop.graph.getState().edges.find((x: { id: string }) => x.id === 'e_sr_pull')
        return { d: p?.getAttribute('d') ?? '', waypoints: (e?.data?.waypoints ?? []) as { x: number; y: number }[] }
      })
      const t = got.d.trim().split(/\s+/)
      const corners: { x: number; y: number }[] = []
      const runs: [{ x: number; y: number }, { x: number; y: number }][] = []
      let cur = { x: 0, y: 0 }
      for (let i = 0; i < t.length; ) {
        const c = t[i++]
        if (c === 'M') cur = { x: +t[i++], y: +t[i++] }
        else if (c === 'L') {
          const p = { x: +t[i++], y: +t[i++] }
          runs.push([cur, p])
          cur = p
        } else if (c === 'Q') {
          corners.push({ x: +t[i++], y: +t[i++] })
          cur = { x: +t[i++], y: +t[i++] }
        }
      }
      const [a, b] = runs[runs.length - 1]
      expect(b.x - a.x, got.d).toBe(0)
      expect(b.y - a.y, `straight end: ${got.d}`).toBeGreaterThanOrEqual(ARROW_ROOM)
      const near = (u: number, v: number) => Math.abs(u - v) < 0.01
      const onPath = (w: { x: number; y: number }) =>
        corners.some((q) => near(q.x, w.x) && near(q.y, w.y)) ||
        runs.some(([s, e]) => (near(s.x, e.x) && near(w.x, s.x) && w.y >= Math.min(s.y, e.y) - 0.01 && w.y <= Math.max(s.y, e.y) + 0.01) || (near(s.y, e.y) && near(w.y, s.y) && w.x >= Math.min(s.x, e.x) - 0.01 && w.x <= Math.max(s.x, e.x) + 0.01))
      expect(got.waypoints.length).toBe(3)
      for (const w of got.waypoints) expect(onPath(w), `bend point ${w.x},${w.y} on ${got.d}`).toBe(true)
    })
  }

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
