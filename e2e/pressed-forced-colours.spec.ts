import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Under forced colours a pressed workbench button is Highlight / HighlightText,
// and the UA draws a Canvas backplate behind its text: HighlightText on that
// backplate was Canvas on Canvas, so the word vanished, and the focus ring was
// Highlight on the Highlight button (Chromium emulation, 2026-10-22, measured on
// each of the three below). The fix lifts the backplate from the word alone and
// moves the ring inside, in HighlightText. Checked as computed styles and as the
// rendered word at 1×. The pixel bounds (button colour > 50 %, glyphs 1–50 %)
// are this test's regression thresholds (a backplate gives 0 % and ~100 %),
// not an accessibility criterion.

const sysColour = (page: Page, c: string) =>
  page.evaluate((c) => {
    const p = document.createElement('div')
    p.style.color = c
    document.body.appendChild(p)
    const v = getComputedStyle(p).color
    p.remove()
    return v
  }, c)

/** at 1×, the shares of the element's rendered pixels that are the button's
 *  colour (within 24, channel sum) and that stand clearly apart from it (> 120):
 *  the glyphs. With the backplate the whole box stands apart, so a readable word
 *  has both a large first share and a small second one. */
async function shares(page: Page, el: Locator, buttonColour: string): Promise<{ onButton: number; apart: number }> {
  const png = (await el.screenshot({ animations: 'disabled' })).toString('base64')
  return page.evaluate(
    async ([b64, bc]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = new OffscreenCanvas(img.width, img.height)
      const x = c.getContext('2d')!
      x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, img.width, img.height).data
      const [r, g, b] = (bc.match(/\d+/g) ?? []).slice(0, 3).map(Number)
      let on = 0
      let apart = 0
      for (let i = 0; i < d.length; i += 4) {
        const dd = Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b)
        if (dd <= 24) on++
        else if (dd > 120) apart++
      }
      const n = d.length / 4
      return { onButton: on / n, apart: apart / n }
    },
    [png, buttonColour] as const,
  )
}

/** keyboard focus, as the real keyboard gives it */
async function keyboardFocus(page: Page, b: Locator) {
  await b.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(b).toBeFocused()
}

/** pressed: the word on Highlight, readable; with keyboard focus, a HighlightText ring inside */
async function expectPressedReadable(page: Page, b: Locator, word: Locator, hl: string, hlText: string) {
  await expect(b).toHaveCSS('background-color', hl)
  await expect(word).toHaveCSS('color', hlText)
  await expect(word).toHaveCSS('forced-color-adjust', 'none')
  const s = await shares(page, word, hl)
  expect(s.onButton, 'the button colour behind the word (no backplate)').toBeGreaterThan(0.5)
  expect(s.apart, "the word's glyphs: present, and not a whole backplate").toBeGreaterThan(0.01)
  expect(s.apart).toBeLessThan(0.5)
  await keyboardFocus(page, b)
  await expect(b).toHaveCSS('outline-color', hlText)
  await expect(b).toHaveCSS('outline-offset', '-4px')
  // solid: Focus's dashed edge belongs to the colour themes only
  await expect(b).toHaveCSS('outline-style', 'solid')
}
/** not pressed: the UA's forced colours, the ring Highlight as before */
async function expectReleasedAsBefore(page: Page, b: Locator, word: Locator, hl: string) {
  await expect(word).toHaveCSS('forced-color-adjust', 'auto')
  await keyboardFocus(page, b)
  await expect(b).toHaveCSS('outline-color', hl)
  await expect(b).toHaveCSS('outline-offset', '-2px')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await page.mouse.move(640, 420)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`forced colours (${colorScheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    })

    test('the chosen connection kind: its word readable, its focus ring visible; the arrow keys move choice and focus as before', async ({ page }) => {
      const [hl, hlText] = [await sysColour(page, 'Highlight'), await sysColour(page, 'HighlightText')]
      const checked = page.locator('.wb-connect__kind[aria-checked="true"]')
      const first = await checked.getAttribute('data-connect-kind')
      await expectPressedReadable(page, checked, checked.locator('.wb-connect__name'), hl, hlText)
      // the roving radio as it is: ArrowRight checks and focuses the next kind
      await page.keyboard.press('ArrowRight')
      const next = page.locator('.wb-connect__kind[aria-checked="true"]')
      await expect(next).not.toHaveAttribute('data-connect-kind', first!)
      await expect(next).toBeFocused()
      await expect(next).toHaveCSS('outline-color', hlText)
      await expect(next.locator('.wb-connect__name')).toHaveCSS('forced-color-adjust', 'none')
      // the one left is unchecked, takes no Tab stop, and keeps the UA's colours
      const prev = page.locator(`.wb-connect__kind[data-connect-kind="${first}"]`)
      await expect(prev).toHaveAttribute('aria-checked', 'false')
      await expect(prev).toHaveAttribute('tabindex', '-1')
      await expect(prev.locator('.wb-connect__name')).toHaveCSS('forced-color-adjust', 'auto')
      await page.keyboard.press('ArrowLeft')
      await expect(prev).toHaveAttribute('aria-checked', 'true')
      await expect(prev).toBeFocused()
    })

    test("the status bar's Focus: on, its word readable and its focus ring visible; off as before; it still toggles", async ({ page }) => {
      const [hl, hlText] = [await sysColour(page, 'Highlight'), await sysColour(page, 'HighlightText')]
      const t = page.locator('.wb-status .wb-zb[aria-pressed]')
      const word = t.locator('.wb-zb__word')
      await expect(t).toHaveAttribute('aria-pressed', 'false')
      await expectReleasedAsBefore(page, t, word, hl)
      await page.keyboard.press('Enter')
      await expect(t).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { focusMode: boolean } } } }).__loop.ui.getState().focusMode)).toBe(true)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await expectPressedReadable(page, t, word, hl, hlText)
      await page.keyboard.press('Enter')
      await expect(t).toHaveAttribute('aria-pressed', 'false')
    })

    for (const side of ['left', 'right'] as const) {
      test(`the ${side === 'left' ? 'List' : 'Properties'} toggle: open, its word readable and its focus ring visible; closed as before; aria-expanded and the panel follow`, async ({ page }) => {
        const [hl, hlText] = [await sysColour(page, 'Highlight'), await sysColour(page, 'HighlightText')]
        const t = page.locator(`#wb-toggle-${side}`)
        const word = t.locator('.wb-zb__word')
        const panel = page.locator(`#wb-panel-${side}`)
        await expect(t).toHaveAttribute('aria-expanded', 'true')
        await expect(panel).toBeVisible()
        await expectPressedReadable(page, t, word, hl, hlText)
        await page.keyboard.press('Enter')
        await expect(t).toHaveAttribute('aria-expanded', 'false')
        await expect(panel).toBeHidden()
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await expectReleasedAsBefore(page, t, word, hl)
        await page.keyboard.press('Enter')
        await expect(t).toHaveAttribute('aria-expanded', 'true')
        await expect(panel).toBeVisible()
      })
    }
  })
}

// Off forced colours the focus ring on the chosen connection kind and on Focus
// when on sat on the pressed ring, the same colour in the same place, so focus
// never showed (2026-10-26): the kind's ring moves 5 px inside, in ink, and
// Focus (22 px, no room inside or out) takes an ink dashed edge on the ring;
// so do the open List and Properties toggles (2026-10-27), closed as before
test('forced colours off: the words keep their tokens and the rings their place', async ({ page }) => {
  const focusToggle = '.wb-status .wb-zb[aria-pressed]'
  await keyboardFocus(page, page.locator(focusToggle))
  await page.keyboard.press('Enter')
  await expect(page.locator(focusToggle)).toHaveAttribute('aria-pressed', 'true')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, forcedColors: 'none' })
    const ink = await sysColour(page, 'var(--ink-1)')
    const focus = await sysColour(page, 'var(--focus)')
    for (const [b, word, offset, style, colour] of [
      ['.wb-connect__kind[aria-checked="true"]', '.wb-connect__name', '-5px', 'solid', ink],
      [focusToggle, '.wb-zb__word', '-2px', 'dashed', ink],
      ['#wb-toggle-left', '.wb-zb__word', '-2px', 'dashed', ink],
      ['#wb-toggle-right', '.wb-zb__word', '-2px', 'dashed', ink],
    ] as const) {
      await expect(page.locator(`${b} ${word}`)).toHaveCSS('forced-color-adjust', 'auto')
      await keyboardFocus(page, page.locator(b))
      await expect(page.locator(b)).toHaveCSS('outline-offset', offset)
      await expect(page.locator(b)).toHaveCSS('outline-style', style)
      await expect(page.locator(b)).toHaveCSS('outline-color', colour)
    }
    // a closed toggle, focused: the focus ring as before
    for (const side of ['left', 'right'] as const) {
      const t = page.locator(`#wb-toggle-${side}`)
      await keyboardFocus(page, t)
      await page.keyboard.press('Enter')
      await expect(t).toHaveAttribute('aria-expanded', 'false')
      await expect(t).toHaveCSS('outline-style', 'solid')
      await expect(t).toHaveCSS('outline-color', focus)
      await expect(t).toHaveCSS('outline-offset', '-2px')
      await page.keyboard.press('Enter')
      await expect(t).toHaveAttribute('aria-expanded', 'true')
    }
  }
})

// A canvas tool focused but not chosen had the pressed ring's twin for its
// focus ring (2026-10-27): it is dashed now, the chosen tool's ring solid, and
// the chosen tool with focus keeps its ink ring 5 px inside (#372). Under
// forced colours the focused one keeps a solid ring (the chosen one is filled)
test('canvas tools: focused but not chosen, a dashed ring; chosen, solid', async ({ page }) => {
  const tools = page.locator('.wb-toolgroup .wb-tb')
  await expect(tools).toHaveCount(4)
  for (const forcedColors of ['none', 'active'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, forcedColors })
      const focus = await sysColour(page, forcedColors === 'active' ? 'Highlight' : 'var(--focus)')
      for (let i = 0; i < 4; i++) {
        const t = tools.nth(i)
        // another tool chosen, this one keyboard-focused
        await tools.nth(i === 0 ? 1 : 0).click()
        await expect(t).toHaveAttribute('aria-pressed', 'false')
        await keyboardFocus(page, t)
        await expect(t).toHaveCSS('outline-style', forcedColors === 'active' ? 'solid' : 'dashed')
        await expect(t).toHaveCSS('outline-color', focus)
        await expect(t).toHaveCSS('outline-offset', '-2px')
        // chosen and keyboard-focused: as before
        await page.keyboard.press('Enter')
        await expect(t).toHaveAttribute('aria-pressed', 'true')
        await expect(t).toHaveCSS('outline-style', 'solid')
        await expect(t).toHaveCSS('outline-offset', '-5px')
      }
    }
  }
  await tools.nth(0).click()
})
