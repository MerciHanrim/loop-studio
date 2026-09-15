import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Hanrim's UX report (2026-09-15): a palette hover tooltip could show at the
// same time as an open Tier-1 menu (Templates / Insert module / File / Data
// / Settings / Help / the ⋯ overflow menu) or Share's result panel — two
// competing overlay layers. Fixed via a shared `menuOpenStore`
// (src/components/toolbar/menuOpenStore.ts) each of those components
// reports its own open/closed state into; `Toolbar.tsx` aggregates it (+
// Share's panel state) into `anyMenuOpen`, which suppresses ALL palette
// tooltips via CSS `!important` on `.toolbar__palette[data-menu-open]`.
//
// Two follow-up review points (Hanrim, same day) specifically call out the
// NESTED case: closing an inner submenu (Theme inside Settings; File inside
// ⋯) must not prematurely flip the aggregate to "nothing open" while an
// outer menu is still up — only closing the OUTERMOST one should re-arm the
// palette's hover tooltip (and even then, not instantly if the pointer
// never left the chip — the existing per-chip suppression flag handles
// that).

const tip = (page: Page, kind: string) => page.locator(`#palette-tip-${kind}`)
const visibleTipCount = (page: Page) =>
  page.locator('.palette-tip').evaluateAll(
    (els) => els.filter((el) => getComputedStyle(el).display !== 'none').length,
  )

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('Module menu open suppresses the palette tooltip; closing it (pointer still over the chip) keeps it suppressed until leave+re-enter', async ({
  page,
}) => {
  await page.locator('.toolbar__actions .menu > button', { hasText: /^Insert module ▾$/ }).click()
  const modulePop = page.locator('.toolbar__actions .menu__pop').first()
  await expect(modulePop).toBeVisible()

  await page.locator('.chip--register').hover()
  expect(await visibleTipCount(page)).toBe(0)
  await expect(modulePop).toBeVisible() // the menu itself is unaffected

  // close the menu WITHOUT moving the pointer off the chip
  await page.keyboard.press('Escape')
  await expect(modulePop).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0) // must not pop back just because the menu closed

  // only leaving and re-entering re-arms it
  await page.locator('.toolbar__brand').hover()
  await page.locator('.chip--register').hover()
  await expect(tip(page, 'register')).toBeVisible()
})

for (const label of [/^Templates ▾$/, /^File ▾$/, /^Data ▾$/]) {
  test(`${label} suppresses the palette tooltip while open`, async ({ page }) => {
    await page.locator('.toolbar__actions .menu > button', { hasText: label }).click()
    await page.locator('.chip--pool').hover()
    expect(await visibleTipCount(page)).toBe(0)
    await page.keyboard.press('Escape')
  })
}

test('⋯ → File (two nested menus): closing File alone keeps the palette suppressed; closing ⋯ too, then leaving+re-entering, re-arms it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  // a narrower pin (e.g. 420px) collapses all 6 groups, making ⋯'s own
  // popover tall/wide enough -- combined with `.toolbar__palette`'s now-
  // unconditional `overflow-x: auto` (docs/toolbar-responsive.md; it used to
  // be scoped to 721-819px, but the project's mobile-breakpoint check
  // forbids a second width-scoped @media block) clipping the palette's own
  // visible window -- that NO chip is both on-screen and outside the union
  // of ⋯'s and File's popover spans. 680px keeps File collapsed (4 groups)
  // with a shorter ⋯ popover and a wider palette window, leaving `pool`
  // genuinely reachable.
  await page.addStyleTag({ content: '.toolbar { max-width: 680px !important; }' })
  await page.waitForTimeout(150)

  const moreBtn = page.locator('.toolbar__overflow-btn')
  await moreBtn.click()
  const overflowPop = page.locator('.toolbar__overflow-pop')
  await expect(overflowPop).toBeVisible()

  await overflowPop.locator('button', { hasText: /^File ▾$/ }).click()
  const filePop = page.locator('.toolbar__filemenu-pop')
  await expect(filePop).toBeVisible()

  await page.locator('.chip--pool').hover()
  expect(await visibleTipCount(page)).toBe(0)

  // Escape closes File only (established nested-menu contract); ⋯ is still
  // open, so the palette must STAY suppressed
  await page.keyboard.press('Escape')
  await expect(filePop).toBeHidden()
  await expect(overflowPop).toBeVisible()
  expect(await visibleTipCount(page)).toBe(0)

  // Escape again closes ⋯ too — still suppressed while the pointer hasn't moved
  await page.keyboard.press('Escape')
  await expect(overflowPop).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0)

  // only now does leaving + re-entering show it
  await page.locator('.toolbar__brand').hover()
  await page.locator('.chip--pool').hover()
  await expect(tip(page, 'pool')).toBeVisible()
})

test('Settings → Theme submenu: closing Theme alone (Escape) keeps Settings open and the palette suppressed', async ({
  page,
}) => {
  const settingsBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^Settings ▾$/ })
  await settingsBtn.click()
  const settingsPop = page.locator('.toolbar__settingsmenu-pop')
  await expect(settingsPop).toBeVisible()

  await settingsPop.locator('.settings-row', { hasText: 'Theme' }).click()
  const themePop = page.locator('.theme-menu__pop')
  await expect(themePop).toBeVisible()

  await page.locator('.chip--source').hover()
  expect(await visibleTipCount(page)).toBe(0)

  // Escape closes Theme's OWN submenu only — Settings (the outer menu)
  // must stay open, and the palette must stay suppressed throughout
  await page.keyboard.press('Escape')
  await expect(themePop).toBeHidden()
  await expect(settingsPop).toBeVisible()
  expect(await visibleTipCount(page)).toBe(0)

  // closing Settings too, pointer still on the chip — still suppressed
  await page.keyboard.press('Escape')
  await expect(settingsPop).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0)

  // leave + re-enter re-arms it
  await page.locator('.toolbar__brand').hover()
  await page.locator('.chip--source').hover()
  await expect(tip(page, 'source')).toBeVisible()
})

test('Theme and Language submenus are mutually exclusive inside Settings', async ({ page }) => {
  const settingsBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^Settings ▾$/ })
  await settingsBtn.click()
  const settingsPop = page.locator('.toolbar__settingsmenu-pop')

  await settingsPop.locator('.settings-row', { hasText: 'Theme' }).click()
  await expect(page.locator('.theme-menu__pop')).toBeVisible()

  // Theme's submenu is a side flyout (useSideFlyoutPosition) that never
  // covers Language's row below it, so a plain click on the row's own
  // center — not just its uncovered label — reaches it directly
  await settingsPop.locator('.settings-row.lang-switch').click()
  await expect(page.locator('.lang-menu__pop')).toBeVisible()
  await expect(page.locator('.theme-menu__pop')).toHaveCount(0) // Theme's own closed

  await expect(settingsPop).toBeVisible() // Settings itself never touched
})

test('switching directly between two Tier-1 triggers leaves no stray suppression state', async ({
  page,
}) => {
  await page.locator('.toolbar__actions .menu > button', { hasText: /^File ▾$/ }).click()
  await expect(page.locator('.toolbar__filemenu-pop')).toBeVisible()

  // click straight across to Data — File closes (outside-click) and Data
  // opens; the pointer is over toolbar TRIGGERS the whole time, nowhere
  // near the palette, so there is nothing for a transient all-closed frame
  // to visibly affect
  await page.locator('.toolbar__actions .menu > button', { hasText: /^Data ▾$/ }).click()
  await expect(page.locator('.toolbar__filemenu-pop')).toHaveCount(0)
  await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()

  // the palette's own hover/tooltip behavior is fully back to normal
  // afterward — no stuck suppression left over from the switch
  await page.keyboard.press('Escape')
  await page.locator('.chip--end').hover()
  await expect(tip(page, 'end')).toBeVisible()
})

test('Share’s result panel suppresses the palette tooltip while open', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__clipWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void (window as any).__clipWrites.push(t) },
    })
  })
  await openApp(page)
  await resetAll(page)

  const shareBtn = page.locator('.toolbar__actions button', { hasText: /^Share$/ })
  await shareBtn.click()
  await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
  await expect(page.locator('.share-pop')).toBeVisible()

  await page.locator('.chip--converter').hover()
  expect(await visibleTipCount(page)).toBe(0)

  await page.locator('.share-pop button', { hasText: /close/i }).click()
  await expect(page.locator('.share-pop')).toHaveCount(0)
  expect(await visibleTipCount(page)).toBe(0) // pointer never left — still suppressed

  await page.locator('.toolbar__brand').hover()
  await page.locator('.chip--converter').hover()
  await expect(tip(page, 'converter')).toBeVisible()
})
