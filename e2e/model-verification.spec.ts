import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// examples/model-verification.json — the hands-on model-language demo. Import →
// Run → Timeline, on desktop AND on the mobile View/Run layout (this spec runs
// under both the `chromium` and `mobile` Playwright projects). The oracle it
// replays is examples/model-verification.expected.json (re-derived by
// test/model-verification.test.ts).

const FIXTURE = readFileSync(new URL('../examples/model-verification.json', import.meta.url), 'utf8')
const ORACLE = JSON.parse(readFileSync(new URL('../examples/model-verification.expected.json', import.meta.url), 'utf8')) as {
  registers: ({ step: number } & Record<string, number | { invalid: string }>)[]
}

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 500

const stepN = (page: Page, n: number) =>
  page.evaluate((k) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) sim.stepOnce()
  }, n)

const select = (page: Page, nodeId: string) =>
  page.evaluate((id) => (window as unknown as Bridge).__loop.graph.getState().setSelection(id, null), nodeId)

const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

// the desktop `<aside class="inspector">` stays in the DOM on mobile (hidden);
// scope reads to the mobile sheet there so the locator is unambiguous
const inspector = (page: Page) =>
  isMobile(page) ? page.locator('.sheet[aria-label="Inspector — read only"]') : page.locator('aside.inspector')

const stepLabel = (page: Page) => page.locator('.pstrip__step').first()

async function openTimeline(page: Page): Promise<void> {
  if (isMobile(page)) {
    const tl = page.locator('.pstrip--mobile .pstrip__tl, .pstrip--mobile button[aria-label*="imeline" i]').first()
    if (await tl.count()) await tl.click()
  }
  await expect(page.locator('.timeline__legend').first()).toBeVisible()
}

test.describe('model-verification.json — Import → Run → Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, FIXTURE)
    await expect(page.locator('.react-flow__node')).toHaveCount(10)
  })

  test('the graph imports with 5 Registers + a Parameter; the run advances', async ({ page }) => {
    for (const id of ['p_rate', 'r_reserve', 'r_head', 'r_ratio', 'r_gap', 'r_loop']) {
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible()
    }
    const before = await digest(page)
    await stepN(page, 6)
    await expect(stepLabel(page)).toContainText('step 6')
    // Registers store nothing — the GraphDoc / revision digest is unchanged by a run
    expect(await digest(page)).toBe(before)
  })

  test('the Timeline shows one dashed line per Register with a valid run; r_loop (always invalid) has none', async ({ page }) => {
    await stepN(page, 6)
    await openTimeline(page)

    // one legend key per Register
    await expect(page.locator('.timeline__key--register')).toHaveCount(5)
    // r_reserve / r_head / r_ratio / r_gap each have ≥1 valid point ⇒ a path;
    // r_loop is M_REG_CYCLE at every step ⇒ no path (§M6.2, never bridged)
    await expect(page.locator('.timeline__line--register')).toHaveCount(4)
    for (const d of await page.locator('.timeline__line--register').evaluateAll((els) => els.map((e) => e.getAttribute('d')))) {
      expect(d, 'a register line is a real polyline').toMatch(/^M[\d.\s]/)
    }
  })

  test('Inspector recomputes R(t) from the graph at the current step, and shows the invalid code past the ÷0', async ({ page }) => {
    const rowAt = (t: number, id: string) => ORACLE.registers[t][id]

    // r_reserve is valid throughout — the Inspector value tracks the step
    await select(page, 'r_reserve')
    await stepN(page, 1)
    await expect(inspector(page)).toContainText('Value at step 1')
    await expect(inspector(page)).toContainText(String(rowAt(1, 'r_reserve')))
    await expect(inspector(page)).toContainText('recomputed from the graph — never stored')

    // r_ratio: valid at step 1 (Mana = 1), M_REG_EVAL from step 2 (Mana = 0)
    await select(page, 'r_ratio')
    await expect(inspector(page)).toContainText(String(rowAt(1, 'r_ratio')))
    await stepN(page, 2) // → step 3
    await expect(inspector(page)).toContainText('M_REG_EVAL')
    await expect(inspector(page)).toContainText('no value at step 3')

    // r_gap depends on r_ratio ⇒ cascades
    await select(page, 'r_gap')
    await expect(inspector(page)).toContainText('M_REG_DEPENDS_ON_INVALID')

    // r_loop self-cycles ⇒ M_REG_CYCLE at every step, and the run kept going
    await select(page, 'r_loop')
    await expect(inspector(page)).toContainText('M_REG_CYCLE')
    await expect(stepLabel(page)).toContainText('step 3')
  })

  test('the advisory resourceType mismatch is surfaced on the edge Inspector and does not change the run', async ({ page }) => {
    const poolAfter = () =>
      page.evaluate(() => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        const sim = (window as unknown as Bridge).__loop.sim.getState()
        const gold = g.nodes.find((n: any) => n.id === 'gold')
        return sim.values?.[gold.id] ?? 0
      })
    await stepN(page, 6)
    expect(await poolAfter()).toBe(16) // Gold: 10, +3 in −2 out per step ⇒ 16 at step 6 (oracle)

    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, 'e_gold_sink'))
    await expect(inspector(page)).toContainText(/Type mismatch/i)
    await expect(inspector(page)).toContainText(/Advisory/i)
  })
})
