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
    { id: 'r_ok', type: 'register', position: { x: 320, y: 200 }, data: { kind: 'register', label: 'Revenue', expr: '@gold * @p_rate', format: 'float', unit: 'kKRW/day' } },
    { id: 'r_bad', type: 'register', position: { x: 560, y: 200 }, data: { kind: 'register', label: 'Ratio', expr: '1 / (@gold - @gold)', unit: 'gold' } },
    // a Register with NO unit — must render exactly as before (no trailing span)
    { id: 'r_plain', type: 'register', position: { x: 820, y: 200 }, data: { kind: 'register', label: 'Holdings', expr: '@gold', format: 'int' } },
  ],
  edges: [],
})

/** Deterministic viewport for the pixel baseline: the Parameter + three
 *  Registers row, all four boxes in frame. The minimap + attribution are hidden
 *  (not masked) so nothing overlaps the row. */
async function centreRegisterRow(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.react-flow__minimap,.react-flow__attribution{display:none!important}',
  })
  await page.evaluate(() => {
    const w = window as unknown as {
      __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } }
    }
    // world x 40..1000, y ~215 → centred at zoom 0.9 in the ~1080px canvas
    w.__loop.rf.setViewport({ x: 70, y: 200, zoom: 0.9 }, { duration: 0 })
  })
  await page.waitForTimeout(150)
}

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

  test('Register `unit` trails the value; the expression stays on the sub-line', async ({ page }) => {
    await load(page)
    // `unit` renders inside the value span, right after the number (§M2) …
    const okValue = node(page, 'r_ok').locator('.nodef__value')
    await expect(okValue.locator('.nodef__unit')).toHaveText('kKRW/day')
    await expect(okValue).toContainText(/13\.5\s*kKRW\/day/) // 3 * 4.5, value + space + unit
    await expect(okValue.locator('.nodef__unit')).toBeVisible() // not clipped away
    // … and does NOT replace the `= expr` sub-line
    await expect(node(page, 'r_ok').locator('.nodef__sub')).toHaveText('= @gold * @p_rate')

    // an INVALID Register shows the `—` placeholder and NO unit (§M6.2)
    await expect(node(page, 'r_bad')).toContainText('—')
    await expect(node(page, 'r_bad').locator('.nodef__unit')).toHaveCount(0)

    // a Register with no `unit` renders exactly as before — value span is just
    // the number, no trailing unit span (on the Register itself and on a
    // Parameter, whose `unit` still lives on the sub-line)
    await expect(node(page, 'r_plain').locator('.nodef__value')).toHaveText('3')
    await expect(node(page, 'r_plain').locator('.nodef__value .nodef__unit')).toHaveCount(0)
    await expect(node(page, 'p_rate').locator('.nodef__value .nodef__unit')).toHaveCount(0)
  })

  test('VISUAL — a short-value Register shows `value + unit`; no-unit + invalid unchanged', async ({ page }) => {
    await load(page)
    await centreRegisterRow(page)
    await page.evaluate(() => document.fonts.ready)
    // sanity before the pixel lock: the unit really is on screen, not truncated
    await expect(node(page, 'r_ok').locator('.nodef__value')).toContainText(/13\.5\s*kKRW\/day/)
    await expect(node(page, 'r_ok').locator('.nodef__unit')).toBeVisible()
    await expect(node(page, 'r_plain').locator('.nodef__value .nodef__unit')).toHaveCount(0)
    await expect(node(page, 'r_bad').locator('.nodef__unit')).toHaveCount(0)
    await expect(page.locator('.react-flow')).toHaveScreenshot('register-unit-row.png', {
      maxDiffPixelRatio: 0.02,
    })
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

  test('STACKING — a Register that is selected + focused + invalid shows all four cues (§VL3)', async ({ page }) => {
    await load(page)
    const bad = node(page, 'r_bad')
    // focus + keyboard-select — a raw click on r_bad can be intercepted by the
    // fixed minimap panel it sits under after fitView (flaky). React Flow's own
    // a11y handling selects the focused node on Space, so this gets both the
    // selection ring AND the keyboard-focus ring in one go.
    await bad.focus()
    await page.keyboard.press(' ')
    await expect(bad.locator('.nodef__sel')).toBeVisible()

    // all four state layers are present at once — none overwrites another
    const sel = bad.locator('.nodef__sel')
    const focus = bad.locator('.nodef__focus')
    const inv = bad.locator('.nodef__invalid')
    const flag = bad.locator('.nodef__flag')
    for (const l of [sel, focus, inv, flag]) await expect(l).toBeVisible()

    // the non-colour tells stay distinct: selection SOLID, focus + invalid DASHED
    // with different patterns; the focus ring is inset (scaled), the invalid ring
    // is the outermost (scaled out).
    await expect(sel).toHaveCSS('stroke-dasharray', /none|^$/)
    const focusDash = await focus.evaluate((el) => getComputedStyle(el).strokeDasharray)
    const invDash = await inv.evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(focusDash).toMatch(/\d/)
    expect(invDash).toMatch(/\d/)
    expect(focusDash).not.toBe(invDash)
    expect(await focus.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none') // inset
    expect(await inv.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none') // outset
    await expect(flag).toHaveText('!')

    // accessible name carries the invalid state (not shape / colour alone)
    await expect(bad.locator('.nodef')).toHaveAttribute('aria-label', /invalid/)
    await expect(bad.locator('.nodef')).toHaveAttribute('aria-label', /selected/)
  })

  test('renders in light and dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await load(page)
    await expect(node(page, 'p_rate')).toBeVisible()
    await expect(node(page, 'r_bad').locator('.nodef__flag')).toBeVisible()
  })
})
