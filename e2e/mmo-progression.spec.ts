import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, openApp, resetAll, routesSettled, seedPersonalBrowser, test } from './support/loop'
import { pickTemplate, pressViewRow, toolButton } from './support/workbenchMenus'

// docs/example-mmo-progression.md §EM10 — the "Early MMO progression (levels
// 1–15)" document, exercised through the app. Out of the Templates menu in
// 0.28.1–0.29.0, back in it since 0.30.0 (Hanrim / Lumi, 2026-10-24): File ▸
// Templates (desktop) and the phone's More → Templates sheet offer it again,
// with its name and description, and opened from there it frames its first
// steps, opens editable (issue #428; edit-locked until v0.31.0), runs, and
// View ▸ Reset view shows it whole. Most tests open its FILE, as a user's own
// file is, which behaves the same: the recommended config applies, it opens
// editable, its node names follow a locale switch, it runs to completion
// deterministically, it round-trips, and the §EM10.1 accounting identities
// hold in the app's own engine state.
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
    canvasLocked?: boolean
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

  test('opens editable (#428) — a node selects into an editable Inspector; the lock button still locks, and unlocks again', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openMmoFile(page)

    const isLocked = () =>
      page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)
    // issue #428 — no recommendedRunConfig.canvasLocked: the Template opens
    // editable like every other one (it shipped `true` until v0.31.0)
    expect(DOC.recommendedRunConfig.canvasLocked).toBeUndefined()
    expect(await isLocked()).toBe(false)
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
    // the workbench: the edit lock is the tool row's (docs/workbench.md §WB3),
    // the canvas rail's button it replaced — the same toggle of `canvasLocked`;
    // it shows the open padlock while editable
    await expect(toolButton(page, 'lock').locator('svg[data-icon="unlock"]')).toHaveCount(1)
    await expect(toolButton(page, 'lock')).toHaveAttribute('aria-pressed', 'false')

    // selection + an editable Inspector
    await page.locator('.react-flow__node[data-id="level"]').click()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId),
      )
      .toBe('level')
    const aside = page.locator('aside.inspector')
    await expect(aside).toBeVisible()
    await expect(aside.locator('input').first()).toBeEnabled()
    await expect(page.locator('.react-flow__node[data-id="level"]')).toHaveClass(/draggable/)

    // the user's lock still works both ways: a read-only Inspector while locked
    await toolButton(page, 'lock').click()
    expect(await isLocked()).toBe(true)
    await expect(toolButton(page, 'lock')).toHaveAttribute('aria-pressed', 'true')
    await expect(toolButton(page, 'lock').locator('svg[data-icon="lock"]')).toHaveCount(1)
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
    await expect(aside.locator('input').first()).toBeDisabled()
    await expect(page.locator('.react-flow__node[data-id="level"]')).not.toHaveClass(/draggable/)
    await toolButton(page, 'lock').click()
    expect(await isLocked()).toBe(false)
    await expect(aside.locator('input').first()).toBeEnabled()
  })

  test('File ▸ Templates offers it in EN and KO with its description (0.30.0); its node names follow a locale switch (docs/template-label-overlay.md)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    const menuPop = page.locator('.toolbar__actions .menu').first().locator('.menu__pop')
    const row = menuPop.locator('[data-template="mmo-progression"]')

    // File ▸ Templates lists it right after Coffee, its description the row's
    // own and, pointed at, in the submenu's description area (docs/workbench.md §WB2.2)
    await templatesBtn(page).click()
    await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
    const ids = await menuPop.locator('[data-template]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.template))
    expect(ids.indexOf('mmo-progression')).toBe(ids.indexOf('coffee-roastery') + 1)
    await expect(row.locator('.menu__name')).toHaveText(EN_NAME)
    const enBlurb = 'Three zones of quests, hunts and rewards — how long reaching level 15 takes.'
    await expect(row).toHaveAccessibleDescription(enBlurb)
    await row.hover()
    await expect(menuPop.locator('.dmenu__desc.is-shown')).toHaveText(enBlurb)
    // the submenu, then File
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await setLocale(page, 'ko')
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
    await templatesBtn(page).click()
    await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
    await expect(row.locator('.menu__name')).toHaveText(KO_NAME)
    const koBlurb = '세 지역의 퀘스트, 사냥, 보상으로 15레벨까지 걸리는 시간을 봅니다.'
    await expect(row).toHaveAccessibleDescription(koBlurb)
    await row.hover()
    await expect(menuPop.locator('.dmenu__desc.is-shown')).toHaveText(koBlurb)
    await page.keyboard.press('Escape')
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

  test('opened from File ▸ Templates (0.30.0): the whole graph and its config, framed on its first steps, editable, a Step runs, Reset view shows it whole', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }) // a Step settles synchronously
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'mmo-progression')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(DOC.nodes.length)
    expect((await graphCounts(page)).edgeIds).toEqual([...DOC.edges.map((e) => e.id)].sort())
    const cfg = await mcConfig(page)
    expect({ baseSeed: cfg.baseSeed, runs: cfg.runs, steps: cfg.steps }).toEqual({ baseSeed: 1, runs: 200, steps: 150 })

    // its start framing (templates.ts `initialView`, §MML3): at or above the
    // 0.6 floor, the core start nodes (its `keep` box) whole inside the pane
    await page.waitForFunction(() => !(window as any).__loop.canvas.swapFitPending())
    await routesSettled(page)
    const iv = await page.evaluate(() => (window as any).__loop.canvas.lastInitialView() as { zoom: number } | null)
    expect(iv, 'the menu open applied its initialView').not.toBeNull()
    expect(iv!.zoom).toBeGreaterThanOrEqual(0.6 - 1e-6)
    const whole = (ids: string[]) =>
      page.evaluate((ids) => {
        const p = document.querySelector('.react-flow')!.getBoundingClientRect()
        return ids.filter((id) => {
          const r = document.querySelector(`.react-flow__node[data-id="${id}"] .nodef`)!.getBoundingClientRect()
          return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5
        })
      }, ids)
    const start = ['char_creation', 'active_char', 'z1_enc_src', 'z1_enc']
    expect(await whole(start)).toEqual(start)

    // it opens editable (issue #428; no recommendedRunConfig.canvasLocked)
    expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)).toBe(false)
    await expect(toolButton(page, 'lock')).toHaveAttribute('aria-pressed', 'false')

    // the run bar's Step runs it
    await page.locator('.pstrip__step-btn').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().stepIndex)).toBe(1)
    expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().values['elapsed'])).toBeGreaterThan(0)

    // View ▸ Reset view: every node and every name on the canvas
    await pressViewRow(page, 'reset')
    const onCanvas = () =>
      page.evaluate(() => {
        const p = document.querySelector('.react-flow')!.getBoundingClientRect()
        const inside = (el: Element) => { const r = el.getBoundingClientRect(); return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5 }
        const nodes = [...document.querySelectorAll('.react-flow__node .nodef')]
        const names = [...document.querySelectorAll('.react-flow__node .nodef__name')]
        return { nodes: [nodes.filter(inside).length, nodes.length], names: [names.filter(inside).length, names.length] }
      })
    await expect.poll(async () => (await onCanvas()).nodes).toEqual([DOC.nodes.length, DOC.nodes.length])
    expect((await onCanvas()).names).toEqual([DOC.nodes.length, DOC.nodes.length])
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

  test('mobile: the More → Templates sheet lists it with its description (0.30.0) and opens it; its file opens on a phone too', async ({ browser }) => {
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
      // the sheet lists it, with its description, and a press opens it
      const mmoRow = templates.locator('.sheet__row', { hasText: EN_NAME })
      await expect(mmoRow).toBeVisible()
      await expect(mmoRow.locator('.sheet__row-sub')).toHaveText('Three zones of quests, hunts and rewards — how long reaching level 15 takes.')
      await mmoRow.click()
      const confirm = page.locator('.mcdlg--confirm .btn--primary')
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
      await expect.poll(async () => (await graphCounts(page)).nodes).toBe(DOC.nodes.length)
      // editable on the phone too (issue #428); the phone has no lock control
      expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)).toBe(false)

      // the phone's own file input (the top bar's Open) still opens the document
      await openMmoFile(page)
      expect((await graphCounts(page)).nodeIds).toEqual([...DOC.nodes.map((n) => n.id)].sort())
    } finally {
      await page.close()
    }
  })
})
