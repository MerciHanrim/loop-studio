import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, snap, test } from './support/loop'

// Issue #335 — the Canvas edit-lock control tells locked from unlocked at a
// glance, without colour (docs/canvas-edit-lock.md):
//  - unlocked: an open padlock whose shackle is swung to the side, its free end
//    clear of the body by a measurable gap at the real 1× size; locked: the
//    closed padlock (no gap) WITH the rail's pressed tell (tint + inset ring +
//    the signal colour; `Highlight` in forced colours);
//  - the accessible name is fixed ("Edit lock"), `aria-pressed` carries the
//    state, and the tooltip names the next action;
//  - a keyboard focus ring stays visible on the pressed button.

type Bridge = { __loop: Record<string, { getState: () => any }> }
const lockBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-lock')
const setLocked = (page: Page, v: boolean) =>
  page.evaluate((x) => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(x), v)

/** the lock icon rendered at 1×: in the leg column nearest `legUnits` (16-unit
 *  grid), the run of background pixels between the leg's lowest ink above the
 *  body and the body's top edge */
async function gapAt1x(page: Page, legUnits: number): Promise<number | null> {
  const svg = lockBtn(page).locator('svg')
  const shot = (await svg.screenshot({ animations: 'disabled' })).toString('base64')
  return page.evaluate(
    async ([b64, leg]) => {
      const img = new Image()
      await new Promise((r) => {
        img.onload = r
        img.src = 'data:image/png;base64,' + b64
      })
      const w = img.width, h = img.height
      const c = new OffscreenCanvas(w, h)
      const x = c.getContext('2d')!
      x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, w, h).data
      const lum = (cx: number, cy: number) => {
        const i = (cy * w + cx) * 4
        return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      }
      const bg = lum(0, h - 1) // a corner is the button's background
      const ink = (cx: number, cy: number) => Math.abs(lum(cx, cy) - bg) > 60
      const legPx = (leg * w) / 16
      let col = -1, most = -1
      for (let cx = Math.max(0, Math.floor(legPx) - 1); cx <= Math.min(w - 1, Math.floor(legPx) + 1); cx++) {
        let n = 0
        for (let cy = 0; cy < Math.round(h / 2); cy++) if (ink(cx, cy)) n++
        if (n > most) { most = n; col = cx }
      }
      const bodyTop = Math.round((7.5 * h) / 16) - 1
      let lowest = -1
      for (let cy = 0; cy < bodyTop; cy++) if (ink(col, cy)) lowest = cy
      if (lowest < 0) return null
      let gap = 0
      for (let cy = lowest + 1; cy < h && !ink(col, cy); cy++) gap++
      return gap
    },
    [shot, legUnits] as const,
  )
}

/** WCAG contrast of two `rgb(...)` strings */
const contrast = (a: string, b: string) => {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = (rgb: string) => {
    const [r, g, bl] = rgb.match(/\d+(\.\d+)?/g)!.map(Number)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl)
  }
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const styleOf = (page: Page) =>
  lockBtn(page).evaluate((b) => {
    const cs = getComputedStyle(b)
    return { color: cs.color, background: cs.backgroundColor, ring: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth}` }
  })

test.describe('#335 — the edit-lock control', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.mouse.move(700, 450) // no hover on the rail
  })

  test('a fixed accessible name, aria-pressed for the state, and the tooltip names the next action', async ({ page }) => {
    const b = lockBtn(page)
    await expect(b).toHaveAttribute('aria-pressed', 'false')
    await expect(b).toHaveAccessibleName('Edit lock')
    await expect(b).toHaveAttribute('title', /^Lock editing/)
    await expect(b.locator('svg[data-icon="unlock"]')).toHaveCount(1)
    await b.click()
    await expect(b).toHaveAttribute('aria-pressed', 'true')
    await expect(b).toHaveAccessibleName('Edit lock')
    await expect(b).toHaveAttribute('title', /^Unlock editing/)
    await expect(b.locator('svg[data-icon="lock"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Edit lock', pressed: true })).toHaveCount(1)
  })

  test('at the real 1× size the open shackle stands clear of the body and the closed one meets it', async ({ page }) => {
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1)
    await setLocked(page, false)
    const open = await gapAt1x(page, 10.35) // the free (right) end of the open shackle
    expect(open, 'the open padlock has a visible gap').not.toBeNull()
    expect(open!).toBeGreaterThanOrEqual(2)
    await setLocked(page, true)
    await page.mouse.move(700, 450)
    for (const leg of [5.5, 10.5]) {
      expect(await gapAt1x(page, leg), `closed padlock leg at ${leg}`).toBe(0)
    }
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: locked carries the Focus toggle's pressed tell, at least 3:1 against the unlocked button`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await setLocked(page, false)
      const off = await styleOf(page)
      await setLocked(page, true)
      await page.mouse.move(700, 450)
      const on = await styleOf(page)
      // the same tell as the Focus toggle when it is on
      const focus = page.locator('.react-flow__controls-button.rf-focus')
      await focus.click()
      await page.mouse.move(700, 450)
      const focusOn = await focus.evaluate((b) => {
        const cs = getComputedStyle(b)
        return { color: cs.color, background: cs.backgroundColor, ring: cs.boxShadow }
      })
      expect({ color: on.color, background: on.background, ring: on.ring }).toEqual(focusOn)
      expect(on.ring).toMatch(/inset/)
      const ringColour = on.ring.match(/rgb\([^)]+\)/)![0]
      expect(contrast(ringColour, off.background)).toBeGreaterThanOrEqual(3)
      expect(on.background).not.toBe(off.background)
    })
  }

  test('forced colours: locked is the system Highlight pair', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await setLocked(page, true)
    await page.mouse.move(700, 450)
    const on = await styleOf(page)
    const system = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.cssText = 'background: Highlight; color: HighlightText; position: absolute'
      document.body.append(probe)
      const cs = getComputedStyle(probe)
      const r = { background: cs.backgroundColor, color: cs.color }
      probe.remove()
      return r
    })
    expect(on.background).toBe(system.background)
    expect(on.color).toBe(system.color)
    await setLocked(page, false)
    await page.mouse.move(700, 450)
    expect((await styleOf(page)).background).not.toBe(system.background)
  })

  // the real 26 px button with its 14 px icon, straight from the product UI, at
  // 1×, in both states and every theme. No hover (the pointer rests on the
  // canvas) and no focus (the keyboard ring is checked through the DOM below).
  for (const theme of ['light', 'dark', 'forced'] as const) {
    test(`${theme}: the button's baseline in both states`, async ({ page }) => {
      await page.emulateMedia(theme === 'forced' ? { forcedColors: 'active' } : { colorScheme: theme, forcedColors: 'none' })
      for (const state of ['unlocked', 'locked'] as const) {
        await setLocked(page, state === 'locked')
        await lockBtn(page).evaluate((b) => (b as HTMLElement).blur())
        await page.mouse.move(700, 450)
        await expect(lockBtn(page)).toHaveAttribute('aria-pressed', state === 'locked' ? 'true' : 'false')
        await expect(lockBtn(page)).toHaveScreenshot(...snap(page, `lock-${theme}-${state}`))
      }
    })
  }

  test('a keyboard focus ring stays visible on the pressed (locked) button', async ({ page }) => {
    await setLocked(page, true)
    const b = lockBtn(page)
    // reach it from the previous rail control by keyboard, so it is :focus-visible
    await page.locator('.react-flow__controls-button.rf-activity').focus()
    await page.keyboard.press('Tab')
    await expect(b).toBeFocused()
    expect(await b.evaluate((x) => x.matches(':focus-visible'))).toBe(true)
    const s = await styleOf(page)
    expect(s.outline.startsWith('none')).toBe(false)
    expect(parseFloat(s.outline.split(' ')[1])).toBeGreaterThan(0)
  })
})
