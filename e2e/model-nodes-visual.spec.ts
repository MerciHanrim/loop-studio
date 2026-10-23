import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, openApp, resetAll, test, snap } from './support/loop'

// docs/visual-language.md §VL2.1 / §VL3 / §VL12 — Parameter / Register are
// first-class in the acceptance suite (no dev flag, no provisional fixture).
// The chrome pass (Canvas Refresh PR 1) locks: a distinct silhouette, the
// "lighter" annotation chrome, and — hue-independent — the selection (solid
// ring), keyboard-focus (dashed ring), and `invalid` (dashed --warn outline
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

/** Deterministic viewport for the pixel baseline: the three Registers (with a
 *  unit, invalid, without a unit — world x 320 … 938, y 195 … 291), whole at
 *  zoom 0.9, centred in the canvas PANE (664 x 548 since the workbench; the
 *  Parameter beside them no longer fits at L2). The attribution is hidden
 *  (not masked) so nothing overlaps the row. */
async function centreRegisterRow(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.react-flow__attribution{display:none!important}',
  })
  await page.evaluate(() => {
    const w = window as unknown as {
      __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } }
    }
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    w.__loop.rf.setViewport({ x: Math.round(pane.width / 2 - 629 * 0.9), y: Math.round(pane.height / 2 - 243 * 0.9), zoom: 0.9 }, { duration: 0 })
  })
  await page.waitForTimeout(150)
}

async function load(page: Page): Promise<void> {
  await openApp(page, { structure: 'inside' })
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
    // parameter: flatter tag body + left tab (`M14 12 … H1 …`); register:
    // flattened lozenge (`M14 12 H110 …`, no tab) — docs/node-shell-content-in-vessel.md
    // "curved corner" re-cut (§VL2.1)
    await expect(node(page, 'p_rate').locator('.nodef--parameter .nodef__stroke')).toHaveAttribute('d', /^M14 12 .* H1 /)
    await expect(node(page, 'r_ok').locator('.nodef--register .nodef__stroke')).toHaveAttribute('d', /^M14 12 H110 /)
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
    // the baseline's canvas height: the Timeline panel open (it now starts
    // collapsed — timeline-series-contract §7)
    await ensureTimelineOpen(page)
    await centreRegisterRow(page)
    await page.evaluate(() => document.fonts.ready)
    // sanity before the pixel lock: the unit really is on screen, not truncated
    await expect(node(page, 'r_ok').locator('.nodef__value')).toContainText(/13\.5\s*kKRW\/day/)
    await expect(node(page, 'r_ok').locator('.nodef__unit')).toBeVisible()
    await expect(node(page, 'r_plain').locator('.nodef__value .nodef__unit')).toHaveCount(0)
    await expect(node(page, 'r_bad').locator('.nodef__unit')).toHaveCount(0)
    await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'register-unit-row'))
  })

  test('invalid Register — dashed --warn outline + corner flag, value is —', async ({ page }) => {
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
    // focus + keyboard-select — a raw click on r_bad could be intercepted by a
    // fixed panel it sat under after fitView (flaky). React Flow's own
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
    // with different patterns; the focus ring is inset and the invalid ring is
    // the outermost. Since issue #325 (docs/flow-colour-and-compact-nodes.md
    // FC-4.1) each ring is cut from the silhouette by its own mask at a fixed
    // px distance instead of being scaled: focus inside, selection and invalid
    // outside, invalid the widest.
    await expect(sel).toHaveCSS('stroke-dasharray', /none|^$/)
    const focusDash = await focus.evaluate((el) => getComputedStyle(el).strokeDasharray)
    const invDash = await inv.evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(focusDash).toMatch(/\d/)
    expect(invDash).toMatch(/\d/)
    expect(focusDash).not.toBe(invDash)
    const ring = (l: typeof sel) =>
      l.evaluate((el) => {
        const id = /url\(#([^)]+)\)/.exec(el.getAttribute('mask') ?? '')?.[1]
        const m = id ? document.getElementById(id) : null
        const cut = m?.querySelector('path')
        return {
          width: Number(el.getAttribute('stroke-width')),
          // an inside mask is a white silhouette; an outside one a white box
          inside: cut?.getAttribute('fill') === 'white',
        }
      })
    const [s, f, i] = [await ring(sel), await ring(focus), await ring(inv)]
    expect(f.inside, 'focus ring is inset').toBe(true)
    expect(s.inside || i.inside, 'selection and invalid are outside').toBe(false)
    expect(i.width, 'invalid is the outermost ring').toBeGreaterThan(s.width)
    await expect(flag).toHaveText('!')

    // accessible name carries the invalid state (not shape / colour alone)
    await expect(bad.locator('.nodef')).toHaveAttribute('aria-label', /invalid/)
    await expect(bad.locator('.nodef')).toHaveAttribute('aria-label', /selected/)
  })

  // Under forced colours the three state rings name system colours by role
  // (index.css): invalid CanvasText, selection and keyboard focus Highlight.
  // Without the rule they kept their token colours (observed in Chromium
  // emulation). Width, dash and distance stay the non-colour tells. Focus is
  // made by the real keyboard: Tab from the canvas, Space selects.
  const systemColour = (page: Page, c: string) =>
    page.evaluate((c) => {
      const p = document.createElement('div')
      p.style.color = c
      document.body.appendChild(p)
      const v = getComputedStyle(p).color
      p.remove()
      return v
    }, c)
  const strokeOf = (l: ReturnType<typeof node>) => l.evaluate((el) => getComputedStyle(el).stroke)
  async function tabTo(page: Page, id: string) {
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
    const at = () => page.evaluate(() => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)
    for (let i = 0; i < 40 && (await at()) !== id; i++) await page.keyboard.press('Tab')
    expect(await at(), `Tab reaches ${id}`).toBe(id)
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`forced colours (${colorScheme}): invalid CanvasText, selection and focus Highlight, tells unchanged`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, forcedColors: 'active' })
      await load(page)
      const canvasText = await systemColour(page, 'CanvasText')
      const highlight = await systemColour(page, 'Highlight')
      expect(canvasText).not.toBe(highlight)
      const bad = node(page, 'r_bad')
      await tabTo(page, 'r_bad')
      await page.keyboard.press('Space')
      const [sel, focus, inv] = [bad.locator('.nodef__sel'), bad.locator('.nodef__focus'), bad.locator('.nodef__invalid')]
      for (const l of [sel, focus, inv]) await expect(l).toBeVisible()
      expect(await strokeOf(inv), 'invalid').toBe(canvasText)
      expect(await strokeOf(sel), 'selection').toBe(highlight)
      expect(await strokeOf(focus), 'keyboard focus').toBe(highlight)
      // the non-colour tells: selection solid, focus and invalid dashed apart
      await expect(sel).toHaveCSS('stroke-dasharray', /none|^$/)
      await expect(focus).toHaveCSS('stroke-dasharray', '3px, 2.5px')
      await expect(inv).toHaveCSS('stroke-dasharray', '4px, 3px')
      await expect(bad.locator('.nodef__flag')).toHaveText('!')
      // Tab on: focus leaves, the selection stays Highlight, the error CanvasText
      await page.keyboard.press('Tab')
      await expect(focus).toHaveCount(0)
      expect(await strokeOf(sel)).toBe(highlight)
      expect(await strokeOf(inv)).toBe(canvasText)
    })

    test(`forced colours off (${colorScheme}): the rings keep their tokens`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, forcedColors: 'none' })
      await load(page)
      const token = (name: string) =>
        page.evaluate((name) => {
          const h = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace('#', '')
          return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
        }, name)
      const bad = node(page, 'r_bad')
      await tabTo(page, 'r_bad')
      await page.keyboard.press('Space')
      expect(await strokeOf(bad.locator('.nodef__invalid'))).toBe(await token('--no'))
      expect(await strokeOf(bad.locator('.nodef__sel'))).toBe(await token('--sel'))
      expect(await strokeOf(bad.locator('.nodef__focus'))).toBe(await token('--focus'))
    })
  }

  test('renders in light and dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await load(page)
    await expect(node(page, 'p_rate')).toBeVisible()
    await expect(node(page, 'r_bad').locator('.nodef__flag')).toBeVisible()
  })
})
