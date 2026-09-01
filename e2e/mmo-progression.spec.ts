import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/example-mmo-progression.md §EM10 — the "Early MMO progression (levels
// 1–15)" Templates demo, exercised through the app: pick it from Templates ▾
// (desktop) and the mobile More → Templates sheet, in EN and KO; run it to
// completion deterministically; check it round-trips; and check the §EM10.1
// accounting identities from the app's own engine state.
//
// The canonical graph is examples/mmo-progression.json — the fixture regen guard
// (src/engine/mmo-progression.test.ts) owns the value-level acceptance.

const DOC = JSON.parse(
  readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8'),
) as {
  nodes: { id: string }[]
  edges: { id: string }[]
  recommendedRunConfig: {
    baseSeed: number
    runs: number
    steps: number
    tracked: string[]
    timelineSeries: string[]
  }
}

const EN_NAME = 'Early MMO progression (levels 1–15)'
const KO_NAME = '초반 MMO 성장 (1–15레벨)'

type Loop = Record<string, { getState: () => any }>
const loop = (page: Page) => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop && true)

const graphCounts = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
    return {
      nodes: g.nodes.length,
      edges: g.edges.length,
      nodeIds: g.nodes.map((n: any) => n.id).sort(),
      edgeIds: g.edges.map((e: any) => e.id).sort(),
    }
  })

const mcConfig = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __loop: Loop }).__loop.mc.getState().config }))

const setLocale = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)

/** Run the live sim through the store until it ends or `cap` steps pass;
 *  return the terminal values + the step it ended on. Reduced-motion is
 *  emulated by the caller so each `stepOnce()` settles synchronously (§PB9). */
const runToEnd = (page: Page, seed: number, cap = 200) =>
  page.evaluate(
    ({ seed, cap }) => {
      const sget = () => (window as unknown as { __loop: Loop }).__loop.sim.getState()
      sget().setSeed(seed)
      sget().reset()
      for (let i = 1; i <= cap && sget().status !== 'ended'; i++) sget().stepOnce()
      const st = sget()
      return {
        values: st.values as Record<string, number>,
        endedAt: st.status === 'ended' ? st.stepIndex : -1,
        stepIndex: st.stepIndex,
      }
    },
    { seed, cap },
  )

// Templates is the first `.menu` in the toolbar actions (locale-agnostic).
const templatesBtn = (page: Page) => page.locator('.toolbar__actions > .menu').first().locator('> button')

async function pickDesktopTemplate(page: Page, name: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions > .menu').first()
    .locator('.menu__pop [role="menuitem"]', { hasText: name })
    .click()
}

test.describe('Early MMO progression example', () => {
  test('desktop: Templates ▾ loads the canonical graph + its recommended MC config', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    expect(await loop(page)).toBe(true)

    await pickDesktopTemplate(page, EN_NAME)

    const g = await graphCounts(page)
    expect(g.nodes).toBe(DOC.nodes.length)
    expect(g.edges).toBe(DOC.edges.length)
    expect(g.nodeIds).toEqual([...DOC.nodes.map((n) => n.id)].sort())

    // recommendedRunConfig applied (§EM12 Q2 / Q3) — the store reconciles the
    // `tracked` list into graph-pool order, so compare it as a set
    const cfg = await mcConfig(page)
    expect({ baseSeed: cfg.baseSeed, runs: cfg.runs, steps: cfg.steps }).toEqual({
      baseSeed: 1,
      runs: 200,
      steps: 150,
    })
    expect([...cfg.tracked].sort()).toEqual([...DOC.recommendedRunConfig.tracked].sort())
    expect(DOC.recommendedRunConfig.tracked.length).toBeGreaterThan(10)

    // the curated Timeline default (recommendedRunConfig.timelineSeries) is applied
    const ts = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().timelineSeries)
    expect(ts).toEqual([...DOC.recommendedRunConfig.timelineSeries])
    expect(ts).toContain('r_netgold') // a Register in the default set
    expect(ts.length).toBeLessThan(DOC.recommendedRunConfig.tracked.length) // fewer than MC tracks
  })

  test('the Templates menu name + blurb render in EN and KO (§L3.4 — node labels stay verbatim)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    const menuPop = page.locator('.toolbar__actions > .menu').first().locator('.menu__pop')

    await templatesBtn(page).click()
    const enItem = menuPop.locator('[role="menuitem"]', { hasText: EN_NAME })
    await expect(enItem).toBeVisible()
    await expect(enItem.locator('.menu__blurb')).toContainText('play economy')
    await page.keyboard.press('Escape')

    await setLocale(page, 'ko')
    await templatesBtn(page).click()
    const koItem = menuPop.locator('[role="menuitem"]', { hasText: KO_NAME })
    await expect(koItem).toBeVisible()
    await expect(koItem.locator('.menu__blurb')).toContainText('플레이 경제')
    await page.keyboard.press('Escape')

    // load it in KO and confirm the seeded node labels are the authored English
    await setLocale(page, 'ko')
    await pickDesktopTemplate(page, KO_NAME)
    const labels = await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.graph
        .getState()
        .nodes.map((n: any) => n.data.label),
    )
    expect(labels).toContain('Level')
    expect(labels).toContain('Gold')
    expect(labels).toContain('Reached level 15')
  })

  test('runs to Level 15 through the End, deterministically, and the §EM10.1 identities hold', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }) // each Step settles synchronously
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    const a = await runToEnd(page, 1)
    expect(a.endedAt).toBeGreaterThan(15)
    expect(a.endedAt).toBeLessThanOrEqual(150)
    expect(a.values['level']).toBeGreaterThanOrEqual(15)
    expect(a.values['combat_wins']).toBeGreaterThan(a.values['deaths'])

    // same seed ⇒ identical run
    const b = await runToEnd(page, 1)
    expect(b.endedAt).toBe(a.endedAt)
    expect(b.values['xp_earned']).toBeCloseTo(a.values['xp_earned'], 6)

    // a different seed ends on a different step
    const c = await runToEnd(page, 20)
    expect(c.endedAt).not.toBe(a.endedAt)

    // §EM10.1 accounting identities, from the app's own engine state
    const v = (id: string) => a.values[id] ?? 0
    const held =
      v('loot_feed') +
      v('bucket_equip') +
      v('bucket_vendor') +
      v('bucket_consumable') +
      v('bucket_rare')
    expect(
      10 + v('gold_earned') -
        (v('gold') + v('repair_spend') + v('resupply_spend') + v('training_spend')),
    ).toBeCloseTo(0, 4)
    expect(12 + v('water_bought') - (v('water') + v('water_consumed'))).toBeCloseTo(0, 4)
    expect(12 + v('food_bought') - (v('food') + v('food_consumed'))).toBeCloseTo(0, 4)
    expect(
      v('items_looted') -
        (v('items_equipped') + v('items_sold') + v('items_consumed') + held),
    ).toBeCloseTo(0, 4)
  })

  test('Export → re-import round-trips the graph and the recommended config', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    const before = await graphCounts(page)

    const roundTripped = await page.evaluate(() => {
      const l = (window as unknown as { __loop: Loop }).__loop
      const text = l.graph.getState().exportJSON(l.mc.getState().config)
      l.graph.getState().newGraph()
      l.mc.getState().setConfig({ baseSeed: 9, runs: 3, steps: 3, tracked: [] })
      l.mc.getState().applyRecommended(l.graph.getState().loadJSON(text))
      const g = l.graph.getState()
      return {
        nodes: g.nodes.length,
        edges: g.edges.length,
        nodeIds: g.nodes.map((n: any) => n.id).sort(),
        edgeIds: g.edges.map((e: any) => e.id).sort(),
        config: { ...l.mc.getState().config },
      }
    })
    expect(roundTripped.nodes).toBe(before.nodes)
    expect(roundTripped.edges).toBe(before.edges)
    expect(roundTripped.nodeIds).toEqual(before.nodeIds)
    expect(roundTripped.edgeIds).toEqual(before.edgeIds)
    expect({
      baseSeed: roundTripped.config.baseSeed,
      runs: roundTripped.config.runs,
      steps: roundTripped.config.steps,
    }).toEqual({ baseSeed: 1, runs: 200, steps: 150 })
    expect([...roundTripped.config.tracked].sort()).toEqual(
      [...DOC.recommendedRunConfig.tracked].sort(),
    )
  })

  test('mobile: the More → Templates sheet lists and loads it', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
      } catch {
        /* private mode */
      }
    })
    try {
      await openApp(page)
      await resetAll(page)

      await page.getByRole('button', { name: 'More' }).click()
      await page
        .locator('.sheet[aria-label="More"] .sheet__row', { hasText: 'Templates' })
        .click()
      const templates = page.locator('.sheet[aria-label="Templates"]')
      await expect(templates).toBeVisible()
      const row = templates.locator('.sheet__row', { hasText: EN_NAME })
      await expect(row).toBeVisible()
      await expect(row.locator('.sheet__row-sub')).toContainText('play economy')

      await row.click()
      // a modified session confirms first; a pristine one loads straight away
      const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.length,
          ),
        )
        .toBe(DOC.nodes.length)
    } finally {
      await page.close()
    }
  })
})
