import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, openApp, resetAll, seedPersonalBrowser, test } from './support/loop'

// docs/example-mmo-progression.md §EM10 — the "Early MMO progression (levels
// 1–15)" document, exercised through the app. Since 0.28.1 it is a developer
// stress fixture: no longer offered by Templates ▾ (desktop) or the mobile
// More → Templates sheet, so it is opened from its FILE, as a user's own file
// is, and both menus are checked not to list it. Its own behaviour is unchanged:
// the recommended config applies, it opens edit-locked, its node names follow a
// locale switch, it runs to completion deterministically, it round-trips, and
// the §EM10.1 accounting identities hold in the app's own engine state.
//
// The canonical graph is examples/mmo-progression.json — the fixture regen guard
// (src/engine/mmo-progression.test.ts) owns the value-level acceptance.

const DOC_TEXT = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')
const DOC = JSON.parse(DOC_TEXT) as {
  nodes: { id: string }[]
  edges: { id: string }[]
  recommendedRunConfig: {
    baseSeed: number
    runs: number
    steps: number
    tracked: string[]
    timelineSeries: string[]
    canvasLocked: boolean
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
const templatesBtn = (page: Page) => page.locator('.toolbar__actions .menu').first().locator('> button')

/** Open examples/mmo-progression.json through the app's real file input (the
 *  toolbar's Open), confirming a replace if the session asks; wait for the
 *  whole graph. */
async function openMmoFile(page: Page) {
  await page
    .locator('input[type=file][accept*="json"]')
    .first()
    .setInputFiles({ name: 'mmo-progression.json', mimeType: 'application/json', buffer: Buffer.from(DOC_TEXT, 'utf8') })
  // a modified session asks to replace (the dialog may arrive a moment after
  // the file is read); a pristine one loads straight away. Locale-independent:
  // the confirm dialog's primary action, by class.
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  const count = () => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.length)
  await expect
    .poll(async () => {
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
      return count()
    })
    .toBe(DOC.nodes.length)
}

test.describe('Early MMO progression example', () => {
  test('desktop: opening its file loads the canonical graph + its recommended MC config', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    expect(await loop(page)).toBe(true)

    await openMmoFile(page)

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
    expect(ts).toEqual(['deaths', 'gear_score', 'gold', 'level', 'xp_earned']) // the 5 story series
    expect(ts.length).toBeLessThan(DOC.recommendedRunConfig.tracked.length) // fewer than MC tracks
  })

  test('desktop: the first-run Timeline legend shows the 5 story series; the selector reads 5/55 and reveals the rest', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await openMmoFile(page)
    await ensureTimelineOpen(page) // docs/timeline-series-contract.md §7 — collapsed until the first run

    const legend = page.locator('.timeline__legend')
    await expect(legend).toBeVisible()

    // exactly the 5 curated keys are on the legend, in the structural order the
    // component renders (all Pools, graph-node order) — array order is not used
    const keyText = await legend.locator('.timeline__key').allInnerTexts()
    const names = keyText.map((t) => t.replace(/\s+\S+$/, '').trim())
    expect(names).toEqual(['Level', 'XP earned', 'Deaths (count)', 'Gold', 'Gear score'])

    // the other 50 series (48 Pools + 7 Registers − 5 shown) are reached through
    // the series selector; the old `+N more` chip no longer exists (§6.3)
    const trigger = page.locator('.timeline__series')
    await expect(trigger).toHaveText('Series 5/55')
    await expect(legend.locator('.timeline__key--more')).toHaveCount(0)

    // run a few steps so the chart draws lines, then reveal a hidden series
    await page.evaluate(() => {
      const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
      s.reset()
      for (let i = 0; i < 6; i++) (window as unknown as { __loop: Loop }).__loop.sim.getState().stepOnce()
    })
    const poolLines = page.locator('.timeline__line:not(.timeline__line--register)')
    await expect(poolLines).toHaveCount(5) // the 5 story Pools

    await trigger.click()
    const popover = page.locator('.tl-series')
    await expect(popover).toBeVisible()
    await expect(popover.getByRole('checkbox')).toHaveCount(55)
    await popover.getByRole('checkbox', { name: 'Elapsed steps' }).check()
    await page.keyboard.press('Escape')

    // the revealed Pool now draws its own line, and it is in the selection
    await expect(poolLines).toHaveCount(6)
    await expect(trigger).toHaveText('Series 6/55')
    const ts2 = await page.evaluate(
      () => (window as unknown as { __loop: Loop }).__loop.sim.getState().timelineSeries,
    )
    expect(ts2).toContain('elapsed')
    expect(ts2.length).toBe(6)
    // (a fresh template open resetting the legend to the recommended 5 is covered
    //  by the "opening its file loads the canonical graph + its recommended MC config"
    //  test above, and the reload path by timeline-series.spec.ts.)
  })

  test('opens edit-locked — a node still selects into a read-only Inspector; unlock → editable', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openMmoFile(page)

    const isLocked = () =>
      page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)
    expect(await isLocked()).toBe(true) // recommendedRunConfig.canvasLocked
    expect(DOC.recommendedRunConfig.canvasLocked).toBe(true)
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
    await expect(page.locator('.react-flow__controls-button.rf-lock svg[data-icon="lock"]')).toHaveCount(1)

    // selection + a read-only Inspector still work while locked
    await page.locator('.react-flow__node[data-id="level"]').click()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId),
      )
      .toBe('level')
    const aside = page.locator('aside.inspector')
    await expect(aside).toBeVisible()
    await expect(aside.locator('input').first()).toBeDisabled()
    await expect(page.locator('.react-flow__node[data-id="level"]')).not.toHaveClass(/draggable/)

    // unlocking restores editing
    await page.locator('.react-flow__controls-button.rf-lock').click()
    expect(await isLocked()).toBe(false)
    await expect(page.locator('.react-flow__node[data-id="level"]')).toHaveClass(/draggable/)
    await expect(aside.locator('input').first()).toBeEnabled()
  })

  test('the Templates menu does not offer it in EN or KO (0.28.1); opened from its file, its node names follow a locale switch (docs/template-label-overlay.md)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    const menuPop = page.locator('.toolbar__actions .menu').first().locator('.menu__pop')

    // the menu is open and lists the Templates it offers (Coffee), but not this one
    await templatesBtn(page).click()
    await expect(menuPop.locator('[role="menuitem"]', { hasText: 'Coffee roastery' })).toBeVisible()
    await expect(menuPop.locator('[role="menuitem"]', { hasText: EN_NAME })).toHaveCount(0)
    await expect(menuPop.locator('.menu__blurb', { hasText: 'quests, hunts and rewards' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await setLocale(page, 'ko')
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
    await templatesBtn(page).click()
    await expect(menuPop.locator('[role="menuitem"]', { hasText: '커피' }).first()).toBeVisible()
    await expect(menuPop.locator('[role="menuitem"]', { hasText: KO_NAME })).toHaveCount(0)
    await expect(menuPop.locator('.menu__blurb', { hasText: '퀘스트, 사냥, 보상' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    const labels = () =>
      page.evaluate(() =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .nodes.map((n: any) => n.data.label),
      )
    const useLocale = async (code: string) => {
      await setLocale(page, code)
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
    }

    // opened from its (English) file in EN ⇒ the canonical English labels
    await useLocale('en')
    await openMmoFile(page)
    let l = await labels()
    expect(l).toContain('Level')
    expect(l).toContain('Gold')
    expect(l).toContain('Reached level 15')
    expect(l).not.toContain('레벨')

    // switched to KO ⇒ Korean node labels (it is still a Template entry's
    // document, so the ko dictionary re-seeds its official names)
    await useLocale('ko')
    await expect.poll(labels).toContain('레벨')
    l = await labels()
    expect(l).toContain('골드')
    expect(l).toContain('15레벨 도달')
    expect(l).not.toContain('Level')

    // and back to EN ⇒ the English labels again
    await useLocale('en')
    await expect.poll(labels).toContain('Level')
    l = await labels()
    expect(l).toContain('Gold')
    expect(l).toContain('Reached level 15')
    expect(l).not.toContain('레벨')
  })

  test('runs to Level 15 through the End, deterministically, and the §EM10.1 identities hold', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }) // each Step settles synchronously
    await openApp(page)
    await resetAll(page)
    await openMmoFile(page)

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
    await openMmoFile(page)
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

  test('mobile: the More → Templates sheet does not list it (0.28.1); its file opens on a phone', async ({ browser }) => {
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
    // issue #296 / #297 - a returning profile that has seen the newest release
// note and remembers a personal browser (this page is not the fixture's)
    await seedPersonalBrowser(page)
    try {
      await openApp(page)
      await resetAll(page)

      await page.getByRole('button', { name: 'More' }).click()
      await page
        .locator('.sheet[aria-label="More"] .sheet__row', { hasText: 'Templates' })
        .click()
      const templates = page.locator('.sheet[aria-label="Templates"]')
      await expect(templates).toBeVisible()
      // the sheet lists the Templates it offers (Coffee), but not this one
      await expect(templates.locator('.sheet__row', { hasText: 'Coffee roastery' })).toBeVisible()
      await expect(templates.locator('.sheet__row', { hasText: EN_NAME })).toHaveCount(0)
      await expect(templates.locator('.sheet__row-sub', { hasText: 'quests, hunts and rewards' })).toHaveCount(0)
      await page.keyboard.press('Escape')

      // the phone's own file input (the top bar's Open) still opens the document
      await openMmoFile(page)
      expect((await graphCounts(page)).nodeIds).toEqual([...DOC.nodes.map((n) => n.id)].sort())
    } finally {
      await page.close()
    }
  })
})
