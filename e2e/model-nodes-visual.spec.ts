import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL2.1 / §VL3 / §VL12 — Parameter / Register are
// first-class in the acceptance suite (no dev flag, no provisional fixture).
// The chrome pass (Canvas Refresh PR 1) locks: a distinct silhouette, the
// "lighter" annotation chrome, and — hue-independent — the selection (solid
// ring), keyboard-focus (dashed ring), and `invalid` (dashed --warning outline
// + a corner `!` flag) states.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'gold', type: 'pool', position: { x: 40, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'p_rate', type: 'parameter', position: { x: 40, y: 200 }, data: { kind: 'parameter', label: 'Sale price', value: 4.5, min: 0, max: 10, step: 0.5, unit: 'gold' } },
    { id: 'r_ok', type: 'register', position: { x: 320, y: 200 }, data: { kind: 'register', label: 'Revenue', expr: '@gold * @p_rate', format: 'float' } },
    { id: 'r_bad', type: 'register', position: { x: 560, y: 200 }, data: { kind: 'register', label: 'Ratio', expr: '1 / (@gold - @gold)' } },
  ],
  edges: [],
})

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name: 'g.json',
    mimeType: 'application/json',
    buffer: Buffer.from(GRAPH, 'utf8'),
  })
  await expect(page.locator('.react-flow__node[data-id="r_bad"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

test.describe('Parameter / Register — chrome & states (hue-independent)', () => {
  test('distinct silhouettes + lighter annotation chrome', async ({ page }) => {
    await load(page)
    // parameter: notch-and-stub tag path; register: plain lozenge path (§VL2.1)
    await expect(node(page, 'p_rate').locator('.nodef--parameter .nodef__stroke')).toHaveAttribute('d', /M40 12/)
    await expect(node(page, 'r_ok').locator('.nodef--register .nodef__stroke')).toHaveAttribute('d', /M30 12/)
    // no resource / state port handles rendered as connectable dots on a model node
    await expect(node(page, 'p_rate').locator('.h--in, .h--out')).toHaveCount(0)
    // the value + unit / expression rows are present
    await expect(node(page, 'p_rate')).toContainText('4.5')
    await expect(node(page, 'p_rate')).toContainText('gold')
    await expect(node(page, 'r_ok')).toContainText('= @gold * @p_rate')
  })

  test('invalid Register — dashed --warning outline + corner flag, value is —', async ({ page }) => {
    await load(page)
    const bad = node(page, 'r_bad')
    await expect(bad.locator('.nodef__invalid')).toBeVisible()
    await expect(bad.locator('.nodef__invalid')).toHaveCSS('stroke-dasharray', /\d/) // dashed = the non-colour tell
    await expect(bad.locator('.nodef__flag')).toHaveText('!')
    await expect(bad).toContainText('—')
    await expect(bad).not.toContainText(/(^|\s)0($|\s)/)
    // a Parameter is never invalid
    await expect(node(page, 'p_rate').locator('.nodef__invalid')).toHaveCount(0)
  })

  test('selection ring is SOLID, keyboard-focus ring is DASHED (distinct without colour)', async ({ page }) => {
    await load(page)
    await node(page, 'p_rate').click()
    await expect(node(page, 'p_rate').locator('.nodef__sel')).toBeVisible()
    await expect(node(page, 'p_rate').locator('.nodef__sel')).toHaveCSS('stroke-dasharray', /none|^$/)

    await node(page, 'r_ok').focus()
    const focus = node(page, 'r_ok').locator('.nodef__focus')
    await expect(focus).toBeVisible()
    await expect(focus).toHaveCSS('stroke-dasharray', /\d/)
  })

  test('renders in light and dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await load(page)
    await expect(node(page, 'p_rate')).toBeVisible()
    await expect(node(page, 'r_bad').locator('.nodef__flag')).toBeVisible()
  })
})
