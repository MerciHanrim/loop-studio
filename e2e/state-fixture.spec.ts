import { readFileSync } from 'node:fs'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import type { Page } from '@playwright/test'

// Imports the committed `examples/state-verification.json` through the real
// Import path and checks that the app's Inspector and in-canvas feedback line up
// with `state-verification.expected.json` at the key steps.

const FIXTURE = readFileSync(new URL('../examples/state-verification.json', import.meta.url), 'utf8')
const EXPECTED = JSON.parse(
  readFileSync(new URL('../examples/state-verification.expected.json', import.meta.url), 'utf8'),
) as { frames: { step: number; values: Record<string, number>; fired: string[] }[] }

type Bridge = { __loop: Record<string, { getState: () => any }> }

const stepN = (page: Page, n: number) =>
  page.evaluate((k) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) sim.advance()
  }, n)

// docs/simulation-playback.md Slice 3b — the state cue is τ-synced; run one step
// through the real choreography and hold it mid-`travel` so it is on screen.
async function stepStateCue(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    s.setSpeed(4000)
    s.stepOnce()
  })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().transition?.tau ?? -1))
    .toBeGreaterThan(0.25)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
}
async function finishStateCue(page: Page) {
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().transition))
    .toBe(null)
}

const selectEdge = (page: Page, id: string) =>
  page.evaluate((eid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, eid), id)

const poolValues = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    const out: Record<string, number> = {}
    for (const n of g.nodes) if (n.data.kind === 'pool') out[n.data.label] = sim.values?.[n.id] ?? 0
    return out
  })

test.describe('state-verification.json — app import + feedback', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, FIXTURE)
    await expect(page.locator('.react-flow__node')).toHaveCount(11)
  })

  test('Inspector reads each state edge back with its mode and expression / delay', async ({ page }) => {
    await selectEdge(page, 't_id_delayed')
    await expect(page.locator('.inspector .field select').nth(1)).toHaveValue('trigger')
    await expect(page.locator('.inspector input[type="number"]')).toHaveValue('2')

    await selectEdge(page, 'a_ga_pd')
    await expect(page.locator('.inspector .field select').nth(1)).toHaveValue('activator')
    await expect(page.locator('.inspector .field input:not([type="number"])')).toHaveValue('>= 3')
    await expect(page.locator('.inspector .field__hint--ok')).toBeVisible()

    await selectEdge(page, 'm_tank_addS')
    await expect(page.locator('.inspector .field select').nth(1)).toHaveValue('label')
    await expect(page.locator('.inspector .field input:not([type="number"])')).toHaveValue('+S')
  })

  test('Pool values track expected.json for steps 1..6', async ({ page }) => {
    for (let s = 1; s <= 6; s++) {
      await stepN(page, 1)
      expect(await poolValues(page)).toEqual(EXPECTED.frames[s].values)
    }
  })

  test('feedback at the gated steps: pulse blocked (2–3) then delivered + tint on (4)', async ({ page }) => {
    await stepN(page, 2)
    await expect(page.locator('.edge-label[data-edge-id="t_pd_a"] .edge-label__blocked')).toBeVisible()
    await expect(page.locator('.edge-label[data-edge-id="t_pd_b"] .edge-label__blocked')).toBeVisible()
    await expect(page.locator('.edge-label[data-edge-id="a_ga_pd"].edge-label--on')).toHaveCount(0)

    await stepN(page, 1) // step 3
    await stepStateCue(page) // step 4 — delivery, choreographed
    await expect(page.locator('.react-flow__edge[data-id="t_id_delayed"] .state-move--trigger')).toHaveCount(1)
    await finishStateCue(page)
    await expect(page.locator('.edge-label[data-edge-id="t_pd_a"] .edge-label__blocked')).toHaveCount(0)
    await expect(page.locator('.edge-label[data-edge-id="a_ga_pd"].edge-label--on')).toHaveCount(1)
    await expect(page.locator('.edge-label[data-edge-id="a_gb_pd"].edge-label--on')).toHaveCount(1)
  })

  test('label feedback: +S rides toward Tank, -1 shows its own delta and a separate clamp note', async ({ page }) => {
    await stepN(page, 1)
    await stepStateCue(page) // step 2 — the label step, choreographed
    await expect(page.locator('.react-flow__edge[data-id="m_tank_addS"] .state-move--label.state-move--in')).toHaveCount(1)
    await finishStateCue(page)
    await expect(page.locator('.edge-label[data-edge-id="m_tank_addS"] .edge-label__delta')).toHaveText('+10')
    await expect(page.locator('.edge-label[data-edge-id="m_tank_sub"] .edge-label__delta')).toHaveText('-1')
    await expect(page.locator('.edge-label[data-edge-id="m_tank_sub"] .edge-label__clamp')).toHaveText('clamp -9')
  })

  test('Reset clears every state effect', async ({ page }) => {
    await stepN(page, 4)
    await expect(page.locator('.state-pulse, .state-flash, .edge-label__delta').first()).toBeVisible()
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await expect(page.locator('.state-pulse, .state-flash, .edge-label__delta')).toHaveCount(0)
  })
})
