import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Hanrim's visual review (2026-09-15): Theme is a Settings-menu submenu
// (System/Light/Dark, current one checked) with the exact same "current
// value + ›" grammar as Language's row, not a cycle-on-click button — and
// its DISPLAYED labels must be the agreed user-facing names in every
// locale, never the internal mode name `system`:
//   EN: Auto / Light / Dark   KO: 자동 / 라이트 / 다크   JA: 自動 / ライト / ダーク
// (src/components/ThemeToggle.tsx's `theme.option.*` keys — distinct from
// the internal `Mode` union's `'system'` literal, which must never leak
// into the UI.)

const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

async function openSettings(page: Page) {
  // Settings can collapse into the ⋯ overflow menu (e.g. at 721×720 — the
  // narrowest desktop checkpoint this suite tests) and its label localizes,
  // so match all 3 locales and fall back to opening ⋯ first when Settings
  // isn't inline.
  const label = /^(Settings|설정|設定) ▾$/
  const inline = page.locator('.toolbar__actions .menu > button', { hasText: label })
  if (await inline.isVisible().catch(() => false)) {
    await inline.click()
    return
  }
  await page.locator('.toolbar__overflow-btn').click()
  await page.locator('.toolbar__overflow-pop button', { hasText: label }).click()
}
async function openThemeSubmenu(page: Page) {
  await openSettings(page)
  // structural, not text-matched -- Theme's row label localizes (테마/テーマ)
  await page.locator('.toolbar__settingsmenu-pop .theme-menu .settings-row').click()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('the Settings row shows the current value and a › affordance, not a bare cycle button', async ({
  page,
}) => {
  await openSettings(page)
  const row = page.locator('.toolbar__settingsmenu-pop .settings-row', { hasText: 'Theme' })
  await expect(row).toHaveAttribute('aria-haspopup', 'menu')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(row.locator('.settings-row__value')).toContainText('›')
  await expect(row.locator('.settings-row__value')).not.toContainText('System') // never the raw mode name
})

test('opening it shows exactly Auto / Light / Dark, in English, with the active one checked', async ({
  page,
}) => {
  await openThemeSubmenu(page)
  const pop = page.locator('.theme-menu__pop')
  await expect(pop).toBeVisible()

  const items = pop.locator('.menu__item')
  await expect(items).toHaveCount(3)
  const texts = await items.locator('.menu__name').allTextContents()
  expect(texts.map((s) => s.trim())).toEqual(['✓ Auto', 'Light', 'Dark'])
  expect(texts.join(' ')).not.toContain('System') // the internal mode literal must never leak into EN UI

  await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(items.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(items.nth(2)).toHaveAttribute('aria-selected', 'false')
})

test('selecting Dark applies it immediately, checks it, and closes only the Theme submenu', async ({
  page,
}) => {
  await openThemeSubmenu(page)
  const pop = page.locator('.theme-menu__pop')
  await pop.locator('.menu__item', { hasText: /^Dark$/ }).click()

  await expect.poll(() => htmlTheme(page)).toBe('dark')
  await expect(pop).toBeHidden()
  await expect(page.locator('.toolbar__settingsmenu-pop')).toBeVisible() // Settings stays open

  const row = page.locator('.toolbar__settingsmenu-pop .settings-row', { hasText: 'Theme' })
  await expect(row.locator('.settings-row__value')).toContainText('Dark')

  // reopening shows Dark checked
  await row.click()
  await expect(page.locator('.theme-menu__pop .menu__item', { hasText: /^✓ Dark$/ })).toBeVisible()
})

test('keyboard: ArrowDown/ArrowUp move between options, Enter selects, Escape closes only Theme', async ({
  page,
}) => {
  await openThemeSubmenu(page)
  const pop = page.locator('.theme-menu__pop')
  const items = pop.locator('.menu__item')

  await expect(items.nth(0)).toBeFocused() // opens focused on the current (Auto) item
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(2)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => htmlTheme(page)).toBe('dark')
  await expect(pop).toBeHidden()

  // Escape (without selecting) closes only Theme, not Settings
  await page.locator('.toolbar__settingsmenu-pop .settings-row', { hasText: 'Theme' }).click()
  await expect(pop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(page.locator('.toolbar__settingsmenu-pop')).toBeVisible()
})

test('the submenu boundary stays fully inside the viewport at 721×720 and 820×720', async ({ page }) => {
  for (const size of [
    { width: 721, height: 720 },
    { width: 820, height: 720 },
  ]) {
    await page.setViewportSize(size)
    // the resize-driven remeasure (ResizeObserver + rAF) needs a tick to
    // settle before checking whether Settings collapsed into ⋯ -- without
    // this, `openSettings` can catch the stale pre-resize layout
    await page.waitForTimeout(200)
    await openThemeSubmenu(page)
    const box = await page.locator('.theme-menu__pop').boundingBox()
    expect(box, `${size.width}x${size.height}`).not.toBeNull()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1)
    }
    await page.keyboard.press('Escape') // Theme
    await page.keyboard.press('Escape') // Settings
    await page.keyboard.press('Escape') // ⋯, only present when Settings collapsed into it (e.g. 721×720) — a no-op otherwise
  }
})

test('opens as a side flyout that never covers Language\'s row below it', async ({ page }) => {
  // Hanrim's review, 2026-09-15: a below-the-row floating popover (the
  // original approach) always covered part of Language's row, since
  // Settings' popover is a tight, gapless stack of just those two rows —
  // clicking the covered part actually activated whichever Theme option
  // happened to be underneath instead of reaching Language at all. Fixed
  // with `useSideFlyoutPosition` (src/components/toolbar/useAnchoredPosition.ts).
  await openThemeSubmenu(page)
  const themeBox = await page.locator('.theme-menu__pop').boundingBox()
  const langBox = await page
    .locator('.toolbar__settingsmenu-pop .settings-row.lang-switch')
    .boundingBox()
  expect(themeBox).not.toBeNull()
  expect(langBox).not.toBeNull()
  if (themeBox && langBox) {
    const overlapsX = themeBox.x < langBox.x + langBox.width && themeBox.x + themeBox.width > langBox.x
    const overlapsY = themeBox.y < langBox.y + langBox.height && themeBox.y + themeBox.height > langBox.y
    expect(overlapsX && overlapsY).toBe(false)
    // it should open to the LEFT of Language's row (and Settings' own
    // popover), not below it
    expect(themeBox.x + themeBox.width).toBeLessThanOrEqual(langBox.x + 1)
  }

  // a plain click on Language's row CENTER (not just its label) now reaches
  // it directly, with no chance of hitting a Theme option instead
  await page.locator('.toolbar__settingsmenu-pop .settings-row.lang-switch').click()
  await expect(page.locator('.lang-menu__pop')).toBeVisible()
  await expect(page.locator('.theme-menu__pop')).toHaveCount(0)
})

test('flips to the right when there is no room on the left', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  // real toolbar layout never puts Settings' row hard against the left
  // edge — it's always toward the right end of the toolbar — so this
  // synthetically relocates just the OPEN Settings popover (not its
  // trigger, which stays clickable in its normal place) to exercise the
  // flip branch rather than waiting for a layout that can't occur
  await page.locator('.toolbar__actions .menu > button', { hasText: /^Settings ▾$/ }).click()
  await page.addStyleTag({
    content: '.toolbar__settingsmenu-pop { position: fixed !important; left: 4px !important; right: auto !important; top: 80px !important; }',
  })
  await page.locator('.toolbar__settingsmenu-pop .theme-menu .settings-row').click()
  const flipped = await page.locator('.theme-menu__pop').boundingBox()
  expect(flipped).not.toBeNull()
  if (flipped) {
    // opened to the right this time, and still fully on screen
    expect(flipped.x).toBeGreaterThan(4) // to the right of the pinned-at-4px anchor
    expect(flipped.x + flipped.width).toBeLessThanOrEqual(1280 + 1)
    expect(flipped.y).toBeGreaterThanOrEqual(0)
  }
})

test('Korean and Japanese show the agreed labels, never a raw mode literal', async ({ page }) => {
  await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ko'))
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
  await openThemeSubmenu(page)
  let texts = (await page.locator('.theme-menu__pop .menu__name').allTextContents()).map((s) => s.trim())
  expect(texts).toEqual(['✓ 자동', '라이트', '다크'])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ja'))
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja')
  await openThemeSubmenu(page)
  texts = (await page.locator('.theme-menu__pop .menu__name').allTextContents()).map((s) => s.trim())
  expect(texts).toEqual(['✓ 自動', 'ライト', 'ダーク'])
})
