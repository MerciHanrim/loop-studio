import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/gacha-banner-zones.md (GZ) — the 3-zone gacha banner comparison
// Template, exercised through the app. The engine-level acceptance (GZ8) is
// already exhaustively proven by src/engine/gacha-banner-zones.test.ts
// against the SAME graph builder this Template's canonical JSON is generated
// from (scripts/gen-gacha-banner-zones-example.ts) — this spec is a smoke
// test that the bundled Template actually opens, runs, and localizes
// correctly through the real UI, not a re-proof of GZ8's properties.
//
// Unlike every other bundled example, this Template has NO `End` node
// (GZ3.5) — it never reaches `status === 'ended'`. Any "run to completion"
// helper must therefore step exactly `pulls_per_zone + 1` times, not loop
// until ended.

const DOC = JSON.parse(
  readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8'),
) as {
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

const EN_NAME = '3-zone gacha banner comparison'
const KO_NAME = '3존 가챠 배너 비교'
const JA_NAME = '3ゾーン ガチャバナー比較'
const HORIZON = DOC.recommendedRunConfig.steps // pulls_per_zone + 1, GZ3.5

type Loop = Record<string, { getState: () => any }>

const graphCounts = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
    return { nodes: g.nodes.length, edges: g.edges.length, nodeIds: g.nodes.map((n: any) => n.id).sort() }
  })

const mcConfig = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __loop: Loop }).__loop.mc.getState().config }))

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

const templatesBtn = (page: Page) => page.locator('.toolbar__actions .menu').first().locator('> button')

async function pickDesktopTemplate(page: Page, name: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions .menu').first()
    .locator('.menu__pop [role="menuitem"]', { hasText: name })
    .click()
}

/** Step the live sim exactly `n` times (never "until ended" — GZ3.5, this
 *  Template has no End node) and return the terminal values. Caller must
 *  emulate reduced motion first so each `stepOnce()` settles synchronously
 *  (§PB9) — otherwise most of a tight-loop `n` calls are dropped mid-transition. */
const runExactSteps = (page: Page, seed: number, n: number) =>
  page.evaluate(
    ({ seed, n }) => {
      const sget = () => (window as unknown as { __loop: Loop }).__loop.sim.getState()
      sget().setSeed(seed)
      sget().reset()
      for (let i = 0; i < n; i++) sget().stepOnce()
      const st = sget()
      return { values: st.values as Record<string, number>, status: st.status, stepIndex: st.stepIndex }
    },
    { seed, n },
  )

test.describe('3-zone gacha banner comparison Template', () => {
  test('desktop: Templates ▾ loads the canonical graph + its recommended MC config, locked', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    const g = await graphCounts(page)
    expect(g.nodes).toBe(DOC.nodes.length)
    expect(g.edges).toBe(DOC.edges.length)
    expect(g.nodeIds).toEqual([...DOC.nodes.map((n) => n.id)].sort())

    const cfg = await mcConfig(page)
    expect({ baseSeed: cfg.baseSeed, runs: cfg.runs, steps: cfg.steps }).toEqual({
      baseSeed: DOC.recommendedRunConfig.baseSeed,
      runs: DOC.recommendedRunConfig.runs,
      steps: DOC.recommendedRunConfig.steps,
    })
    expect([...cfg.tracked].sort()).toEqual([...DOC.recommendedRunConfig.tracked].sort())

    const isLocked = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)
    expect(isLocked).toBe(true)
    expect(DOC.recommendedRunConfig.canvasLocked).toBe(true)
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
  })

  test('menu order: Coffee, then MMO, then Gacha (Hanrim, 2026-09-13 reorder)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await templatesBtn(page).click()
    const names = await page
      .locator('.toolbar__actions .menu').first()
      .locator('.menu__pop [role="menuitem"] .menu__name')
      .allInnerTexts()
    const coffeeIdx = names.findIndex((n) => n.includes('Coffee roastery'))
    const mmoIdx = names.findIndex((n) => n.includes('Early MMO progression'))
    const gachaIdx = names.findIndex((n) => n === EN_NAME)
    expect(coffeeIdx).toBeGreaterThanOrEqual(0)
    expect(mmoIdx).toBeGreaterThan(coffeeIdx)
    expect(gachaIdx).toBeGreaterThan(mmoIdx)
  })

  test('runs exactly pulls_per_zone + 1 steps with no End: never reaches "ended", conserves per zone', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    await page.emulateMedia({ reducedMotion: 'reduce' }) // each Step settles synchronously

    const r = await runExactSteps(page, 1, HORIZON)
    expect(r.status).not.toBe('ended') // GZ3.5 — no End node anywhere in this Template
    expect(r.stepIndex).toBe(HORIZON)

    for (const zone of ['free', 'standard', 'pickup']) {
      const ssr = r.values[`ssr_count_${zone}`] ?? 0
      const sr = r.values[`sr_count_${zone}`] ?? 0
      const rr = r.values[`r_count_${zone}`] ?? 0
      expect(ssr + sr + rr).toBe(r.values[`pulls_made_${zone}`])
      expect(r.values[`ticket_${zone}`]).toBe(0)
    }
    expect((r.values.pickup_count_pickup ?? 0) + (r.values.standard_count_pickup ?? 0)).toBe(
      r.values.ssr_count_pickup,
    )

    // stepping further changes nothing (GZ3.5 / GZ8 item 3)
    const after = await page.evaluate(() => {
      const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
      s.stepOnce()
      s.stepOnce()
      return { values: s.values as Record<string, number>, status: s.status }
    })
    expect(after.status).not.toBe('ended')
    expect(after.values).toEqual(r.values)
  })

  test('Monte Carlo completes and reports every tracked Pool, ended never true across any run', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    await page.evaluate(() => {
      const m = (window as unknown as { __loop: Loop }).__loop.mc.getState()
      return m.run() as Promise<void>
    })
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.mc.getState().status),
        { timeout: 20_000 },
      )
      .toBe('done')

    const result = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.mc.getState().result)
    expect(result.droppedTracked).toEqual([])
    expect([...result.pools.map((p: { id: string }) => p.id)].sort()).toEqual(
      [...DOC.recommendedRunConfig.tracked].sort(),
    )
    expect(result.completedRuns).toBe(DOC.recommendedRunConfig.runs)
    // GZ3.5 — no run of any seed ever reaches an End
    expect(result.endedRuns.atOrBeforeStep.every((n: number) => n === 0)).toBe(true)
  })

  test('KO: the menu item and node labels localize', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await pickDesktopTemplate(page, KO_NAME)

    const label = await page.evaluate(
      () =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .nodes.find((n: any) => n.id === 'zone3_pickup_hard_pity').data.label,
    )
    expect(label).toBe('하드 천장') // no zone suffix — the frame title gives that context
  })

  test('JA: the menu item and node labels localize', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')
    await pickDesktopTemplate(page, JA_NAME)

    const label = await page.evaluate(
      () =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .nodes.find((n: any) => n.id === 'pickup_hit_pickup').data.label,
    )
    expect(label).toBe('ピックアップ的中') // no zone suffix — the frame title gives that context
  })
})
