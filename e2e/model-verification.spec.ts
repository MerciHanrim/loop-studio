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
    for (let i = 0; i < k; i++) sim.advance()
  }, n)

const select = (page: Page, nodeId: string) =>
  page.evaluate((id) => (window as unknown as Bridge).__loop.graph.getState().setSelection(id, null), nodeId)

const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

// the desktop `<aside class="inspector">` stays in the DOM on mobile (hidden);
// scope reads to the mobile sheet there so the locator is unambiguous
const inspector = (page: Page) =>
  isMobile(page) ? page.locator('.sheet[aria-label="Inspector — read only"]') : page.locator('aside.inspector')

const stepLabel = (page: Page) => page.locator('.pstrip__step').first()

// the desktop play bar shows "step N"; the compact mobile run bar shows the
// number only, with "step N" as its aria-label. Assert whichever this layout uses.
async function expectStepReached(page: Page, n: number): Promise<void> {
  const el = stepLabel(page)
  await expect
    .poll(async () => {
      const text = ((await el.textContent()) ?? '').trim()
      const aria = (await el.getAttribute('aria-label')) ?? ''
      return text.includes(`step ${n}`) || aria.includes(`step ${n}`) || text === String(n)
    })
    .toBe(true)
}

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
    await expectStepReached(page, 6)
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

  test('the Inspector read-back recomputes R(t) at the current step; an invalid Register shows a localised verdict, no raw code past the ÷0 (docs/register-expression-authoring.md §RXA3.5)', async ({ page }) => {
    const rowAt = (t: number, id: string) => ORACLE.registers[t][id]
    // scope to the visible Inspector surface (desktop aside / mobile sheet)
    const readback = (p: Page) => inspector(p).locator('.regrb__line--result').first()
    const badLine = (p: Page) => inspector(p).locator('.regrb__line--bad')

    // r_reserve is valid throughout — line 2 ends `= R(step)` and tracks the step
    await select(page, 'r_reserve')
    await stepN(page, 1)
    await expect(readback(page)).toContainText(`= ${rowAt(1, 'r_reserve')}`)

    // r_ratio: valid at step 1 (Mana = 1), evaluates invalid from step 2 (÷ Mana = 0)
    await select(page, 'r_ratio')
    await expect(readback(page)).toContainText(String(rowAt(1, 'r_ratio')))
    await stepN(page, 2) // → step 3
    await expect(readback(page)).toContainText('→') // a `→ <verdict>` line
    await expect(readback(page)).not.toContainText('M_REG_EVAL') // raw code never shown
    await expect(readback(page)).not.toContainText('EVAL_DIV_ZERO')

    // r_gap depends on r_ratio ⇒ cascades to an invalid row (localised)
    await select(page, 'r_gap')
    await expect(badLine(page)).toBeVisible()
    await expect(inspector(page)).not.toContainText('M_REG_DEPENDS_ON_INVALID')

    // r_loop self-cycles ⇒ an invalid "cycle" row at every step; the run kept going
    await select(page, 'r_loop')
    await expect(badLine(page)).toContainText(/cycle|순환|循環/i)
    await expect(inspector(page)).not.toContainText('M_REG_CYCLE')
    await expectStepReached(page, 3)
  })

  test('loop-workspace/1 round-trip: a stepped Workspace saves no Register state; re-Import restores S(t) and R(t) recomputes to the same values', async ({ page }) => {
    await stepN(page, 3)
    await select(page, 'r_reserve')
    await expect(inspector(page).locator('.regrb__line--result').first()).toContainText(
      `= ${ORACLE.registers[3].r_reserve}`,
    )
    const beforeText = await inspector(page).innerText()

    // Export a Workspace via the real format path (bridge, works desktop + mobile)
    const ws = await page.evaluate(() => {
      const L = (window as unknown as { __loop: any }).__loop
      return L.io.serializeWorkspaceFile(L.io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 })) as string
    })
    const parsed = JSON.parse(ws)
    expect(parsed.workspace.schema).toBe('loop-workspace/1')
    expect(parsed.workspace.version).toBe(1)
    // the saved SimState mentions no Register — not a value, not an error, not a series
    const regIds = ['r_reserve', 'r_head', 'r_ratio', 'r_gap', 'r_loop']
    const sim = parsed.workspace.simulation
    expect(regIds.some((id) => id in sim.values)).toBe(false)
    expect((sim.series as { values: Record<string, number> }[]).some((f) => regIds.some((id) => id in f.values))).toBe(false)
    expect('registers' in sim || 'R' in sim).toBe(false)

    // wipe, then re-Import the workspace file
    await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().newGraph())
    await page.evaluate((t) => (window as unknown as { __loop: any }).__loop.io.importFile(t), ws)

    // step index + pool state restored
    await expectStepReached(page, 3)
    const goldNow = await page.evaluate(() => {
      const L = (window as unknown as { __loop: any }).__loop
      const g = L.graph.getState()
      return L.sim.getState().values?.[g.nodes.find((n: any) => n.id === 'gold').id]
    })
    expect(goldNow).toBe(13) // S(3): Gold

    // R(t) recomputed from the restored S(t) — identical to before the Export
    await select(page, 'r_reserve')
    await expect(page.locator('aside.inspector .regrb__line--result').first()).toContainText(
      `= ${ORACLE.registers[3].r_reserve}`,
    )
    expect(await inspector(page).innerText()).toBe(beforeText)
    await select(page, 'r_ratio')
    // r_ratio ÷0 at step 3 → the read-back keeps a value line with a `→` verdict
    await expect(inspector(page).locator('.regrb__total--bad')).toBeVisible()
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
