import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/example-coffee-roastery.md §CR17 + docs/template-label-overlay.md §TLO12 —
// the Coffee roastery Template ships three group frames (`zone_supply`,
// `zone_roasting`, `zone_forecast`). This spec pins, in EN / KO / JA, that:
//   • the three frames render and carry the active locale's title;
//   • every non-Parameter node sits in exactly one frame with ≥ 24 px margin;
//   • the five y = 0 Parameter nodes touch no frame box and no title chip;
//   • the frames never overlap each other;
//   • no title chip is clipped by a node or by the top of the screen — in
//     particular `zone_forecast`'s title (flow y ≈ -42) is fully on screen under
//     the frame-less fit-all;
//   • a language switch retitles the OFFICIAL frames (exact match) and a
//     user-renamed frame title survives.

type Loop = Record<string, { getState: () => any }> & {
  rf: { getViewport: () => { x: number; y: number; zoom: number } }
}
const loop = (page: Page) => page.evaluate(() => Boolean((window as unknown as { __loop: Loop }).__loop))

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
  await page.waitForTimeout(250) // let nodes re-measure after the §TLO11 relabel
}

const templatesBtn = (page: Page) =>
  page.locator('.toolbar__actions .menu').first().locator('> button')
async function pickCoffee(page: Page) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions .menu').first()
    .locator('.menu__pop [role="menuitem"]', { hasText: /Coffee roastery|커피 로스터리|コーヒー/ })
    .click()
  const confirm = page.locator('.dialog button, .mcdlg button', { hasText: /replace|바꾸기|교체|불러오기|読み込む|Load template/i })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.lgr-frame')).toHaveCount(3)
  await page.waitForTimeout(300)
}

const EXPECTED_TITLES: Record<string, [string, string, string]> = {
  // [zone_supply, zone_roasting, zone_forecast]
  en: ['Supply & inventory', 'Roasting & sales', 'Forecast metrics'],
  ko: ['공급·재고', '로스팅·판매', '예측 지표'],
  ja: ['供給・在庫', '焙煎・販売', '予測指標'],
}

const ZONE_OF: Record<string, string> = {
  green_delivery: 'zone_supply', dessert_prep_src: 'zone_supply', green_stock: 'zone_supply',
  green_wholesale: 'zone_supply', dessert_stock: 'zone_supply',
  roasting: 'zone_roasting', roast_loss: 'zone_roasting', dessert_sales: 'zone_roasting',
  dessert_wrapup: 'zone_roasting', roasted_stock: 'zone_roasting', cafe_retail: 'zone_roasting',
  online_sales: 'zone_roasting', roasted_bleed: 'zone_roasting',
  projected_revenue: 'zone_forecast', planned_cost: 'zone_forecast',
  projected_operating_margin: 'zone_forecast', roasted_supply_margin: 'zone_forecast',
  dessert_prep_margin: 'zone_forecast',
}
const PARAM_IDS = [
  'cafe_retail_demand_kg', 'daily_roast_kg', 'online_orders', 'green_wholesale_kg', 'dessert_prep',
]

/** Read the three frame boxes, every node box, and every title-chip box — all in
 *  FLOW coords — plus each title's client-space top (for the on-screen check). */
async function readLayout(page: Page) {
  return page.evaluate(() => {
    const l = (window as unknown as { __loop: Loop }).__loop
    const vp = l.rf.getViewport()
    const paneEl = document.querySelector('.react-flow') as HTMLElement
    const pane = paneEl.getBoundingClientRect()
    const toFlow = (r: DOMRect) => ({
      l: (r.left - pane.left - vp.x) / vp.zoom,
      t: (r.top - pane.top - vp.y) / vp.zoom,
      r: (r.right - pane.left - vp.x) / vp.zoom,
      b: (r.bottom - pane.top - vp.y) / vp.zoom,
    })
    const frames = (l.frame.getState().frames as { id: string; rect: any }[]).map((f) => ({
      id: f.id,
      box: { l: f.rect.x, t: f.rect.y, r: f.rect.x + f.rect.w, b: f.rect.y + f.rect.h },
    }))
    const nodes: Record<string, ReturnType<typeof toFlow>> = {}
    for (const el of Array.from(document.querySelectorAll('.react-flow__node'))) {
      nodes[el.getAttribute('data-id')!] = toFlow(el.getBoundingClientRect())
    }
    const titles = Array.from(document.querySelectorAll('.lgr-frame__label')).map((el) => {
      const cr = el.getBoundingClientRect()
      return { text: (el.textContent || '').trim(), flow: toFlow(cr), clientTop: cr.top, clientLeft: cr.left }
    })
    return { frames, nodes, titles }
  })
}

const overlaps = (a: { l: number; t: number; r: number; b: number }, b: typeof a) =>
  !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t)

test.describe('Coffee roastery — zone frames (§CR17 / §TLO12)', () => {
  for (const locale of ['en', 'ko', 'ja'] as const) {
    test(`${locale}: 3 frames, titled, non-overlapping, nodes ≥24px margin, params + titles clear`, async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      expect(await loop(page)).toBe(true)
      if (locale !== 'en') await setLocale(page, locale)
      await pickCoffee(page)
      if (locale !== 'en') await setLocale(page, locale) // relabel the just-opened graph too

      const { frames, nodes, titles } = await readLayout(page)
      expect(frames.map((f) => f.id).sort()).toEqual(['zone_forecast', 'zone_roasting', 'zone_supply'])

      // titles = the active locale's official strings
      expect(titles.map((t) => t.text).sort()).toEqual([...EXPECTED_TITLES[locale]].sort())

      // frames never overlap
      expect(overlaps(frames[0].box, frames[1].box)).toBe(false)
      expect(overlaps(frames[1].box, frames[2].box)).toBe(false)
      expect(overlaps(frames[0].box, frames[2].box)).toBe(false)

      const frameById = Object.fromEntries(frames.map((f) => [f.id, f.box]))
      const MARGIN = 24

      // every non-Parameter node: inside exactly its zone, ≥24px margin
      for (const [id, want] of Object.entries(ZONE_OF)) {
        const nb = nodes[id]
        expect(nb, `node ${id} not rendered`).toBeTruthy()
        const fb = frameById[want]
        expect(nb.l, `${id} left margin`).toBeGreaterThanOrEqual(fb.l + MARGIN - 0.6)
        expect(nb.r, `${id} right margin`).toBeLessThanOrEqual(fb.r - MARGIN + 0.6)
        expect(nb.t, `${id} top margin`).toBeGreaterThanOrEqual(fb.t + MARGIN - 0.6)
        expect(nb.b, `${id} bottom margin`).toBeLessThanOrEqual(fb.b - MARGIN + 0.6)
        // and NOT inside either of the other two
        for (const other of frames.filter((f) => f.id !== want)) {
          expect(overlaps(nb, other.box), `${id} must not enter ${other.id}`).toBe(false)
        }
      }

      // the five Parameter nodes: touch no frame box and no title chip
      for (const pid of PARAM_IDS) {
        const pb = nodes[pid]
        expect(pb, `param ${pid} not rendered`).toBeTruthy()
        for (const f of frames) {
          expect(overlaps(pb, f.box), `${pid} must not touch ${f.id}`).toBe(false)
        }
        for (const ttl of titles) {
          expect(overlaps(pb, ttl.flow), `${pid} must not touch a title chip`).toBe(false)
        }
      }

      // no title chip is clipped by a node…
      for (const ttl of titles) {
        for (const [id, nb] of Object.entries(nodes)) {
          expect(overlaps(ttl.flow, nb), `title "${ttl.text}" overlaps node ${id}`).toBe(false)
        }
        // …or by the top of the screen (client-space) — covers zone_forecast's
        // flow y ≈ -42 under the frame-less fit-all
        expect(ttl.clientTop, `title "${ttl.text}" clipped at top of screen`).toBeGreaterThanOrEqual(0)
        expect(ttl.clientLeft, `title "${ttl.text}" clipped at left of screen`).toBeGreaterThanOrEqual(0)
      }
    })
  }

  test('a language switch retitles the OFFICIAL frames; a user-renamed title survives', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickCoffee(page)

    const titleTexts = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.lgr-frame__label'))
          .map((e) => (e.textContent || '').trim())
          .sort(),
      )

    expect(await titleTexts()).toEqual([...EXPECTED_TITLES.en].sort())
    await setLocale(page, 'ko')
    expect(await titleTexts()).toEqual([...EXPECTED_TITLES.ko].sort())
    await setLocale(page, 'ja')
    expect(await titleTexts()).toEqual([...EXPECTED_TITLES.ja].sort())
    await setLocale(page, 'en')
    expect(await titleTexts()).toEqual([...EXPECTED_TITLES.en].sort())

    // rename zone_supply, then switch — the user title stays, the other two move
    await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.frame.getState().renameFrame('zone_supply', 'My inbound zone'),
    )
    await setLocale(page, 'ja')
    const afterJa = await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.frame.getState().frames.map((f: any) => [f.id, f.label]),
    )
    expect(new Map(afterJa).get('zone_supply')).toBe('My inbound zone')
    expect(new Map(afterJa).get('zone_roasting')).toBe('焙煎・販売')
    expect(new Map(afterJa).get('zone_forecast')).toBe('予測指標')
  })
})
