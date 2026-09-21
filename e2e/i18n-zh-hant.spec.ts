import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// Traditional Chinese (`zh-Hant`). Written RED-FIRST against the unmodified
// product — 6 of these 13 failed before the locale existed, the other 7 were
// invariance guards that had to keep passing. docs/localization.md §L2.4
// (browser-tag mapping) and §L2.5 (the per-locale font contract).
//
//   1 zh-TW / zh-HK / zh-MO reach Traditional Chinese, not English
//   2 zh-CN / zh-SG / zh-MY / bare zh still reach Simplified (invariance)
//   3 a stored zh-Hant survives a reload; a bad stored value falls back
//   4 the picker offers 繁體中文, tagged with its own language
//   5 <html lang> is exactly `zh-Hant`
//   6 the template-label dictionary loads — no English labels in a Chinese UI
//   7 Traditional glyphs are NOT drawn with Korean, Japanese or Simplified faces
//
// Nothing here uses a baseline image: fonts, wrapping and overflow are pinned
// by measurement (ruling D-6).

const HANT = 'zh-Hant'
const HANS = 'zh-Hans'
// Han that differs between the scripts, so a Simplified fallback is visible
const HANT_SAMPLE = '資源池轉換器觸發'

const KR_FAMILIES = [/Noto Sans KR/i, /Malgun/i, /Gulim/i, /Batang/i, /Dotum/i, /AppleGothic/i]
const JP_FAMILIES = [/Noto Sans JP/i, /Yu Gothic/i, /Hiragino/i, /Meiryo/i, /MS( P)? Gothic/i]
const SC_FAMILIES = [/YaHei/i, /SimSun/i, /SimHei/i, /Noto Sans SC/i, /PingFang SC/i, /Hiragino Sans GB/i]
const TC_FAMILIES = [/JhengHei/i, /PingFang TC/i, /Noto Sans TC/i, /MingLiU/i, /正黑/, /明體/]

async function platformFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) return []
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    return [...fonts]
  } finally {
    await cdp.detach()
  }
}

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

/** The language trigger lives inside `Settings ▾` (docs/localization.md
 *  §L5.3), so open Settings first when the trigger is not already on screen.
 *  Taiwan Traditional uses 設定 for Settings — the same word Japanese already
 *  contributes to this alternation (ruling D-5), so no new branch is needed. */
async function openLanguageMenu(page: Page) {
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page
      .locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定|设置) ▾$/ })
      .click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

// ------------------------------------------------------------------ 1
test.describe('a Traditional-region browser', () => {
  for (const tag of ['zh-TW', 'zh-HK', 'zh-MO']) {
    test(`${tag} reaches Traditional Chinese, not English`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe(HANT)
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 2
test.describe('a Simplified-region browser is unaffected', () => {
  for (const [tag, want] of [
    ['zh-CN', HANS],
    ['zh-SG', HANS],
    ['zh', HANS],
    ['en-US', 'en'],
    ['ko-KR', 'ko'],
    ['ja-JP', 'ja'],
  ] as const) {
    test(`${tag} still reaches ${want}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe(want)
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 3
test.describe('a stored locale', () => {
  test('zh-Hant survives a reload; an unregistered value falls back', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'zh-Hant'))
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe(HANT)

    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'zh-Hant-XX'))
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe('en') // not registered — never selected
    await ctx.close()
  })
})

// ------------------------------------------------------------------ 4
test('the language picker offers 繁體中文, tagged as its own language', async ({ page }) => {
  await openApp(page)
  await openLanguageMenu(page)
  const pop = page.locator('.lang-menu__pop')
  const row = pop.locator('.lang-menu__item').filter({ hasText: '繁體中文' })
  await expect(row, 'the picker must offer Traditional Chinese').toHaveCount(1)
  const tagged = row.locator('[lang="zh-Hant"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('繁體中文')

  await row.click()
  await expect.poll(() => htmlLang(page)).toBe(HANT)
})

// ------------------------------------------------------------------ 5 + 6
test('selecting it localizes the chrome AND the bundled template labels', async ({ page }) => {
  await openApp(page)
  await openLanguageMenu(page)
  await page.locator(`.lang-menu__item[data-locale="${HANT}"]`).click()
  await expect.poll(() => htmlLang(page)).toBe(HANT)

  const chrome = await page.locator('.toolbar').innerText()
  expect(/[一-鿿]/.test(chrome), 'the toolbar must be in Chinese after the switch').toBe(true)

  // load a bundled Template — structural, the menu is Chinese by now
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  await page.locator('.menu__pop [role="menuitem"]').first().click()
  const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load|加載|載入/i })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()

  const labels = await page.locator('.nodef__title').allInnerTexts()
  expect(labels.length).toBeGreaterThan(0)
  const english = labels.filter((l) => /^[\x20-\x7e]+$/.test(l.trim()) && /[A-Za-z]{3}/.test(l))
  expect(english, 'no bundled node label may stay English in a Chinese UI').toEqual([])
})

// ------------------------------------------------------------------ 7
test.describe('Traditional glyphs', () => {
  test('are not drawn from the Korean, Japanese or Simplified fallback', async ({ page }) => {
    await openApp(page)
    await page.evaluate((text) => {
      document.documentElement.lang = 'zh-Hant'
      const d = document.createElement('div')
      d.id = 'hant-probe'
      d.style.cssText = 'position:fixed;left:2px;top:2px;font-size:22px'
      d.textContent = text
      document.body.append(d)
    }, HANT_SAMPLE)
    await page.evaluate(() => document.fonts.ready)

    const fonts = await platformFonts(page, '#hant-probe')
    const names = fonts.map((f) => f.familyName)
    expect(fonts.reduce((n, f) => n + f.glyphCount, 0), 'every glyph resolves — no tofu').toBe(
      HANT_SAMPLE.length,
    )
    for (const re of [...KR_FAMILIES, ...JP_FAMILIES, ...SC_FAMILIES]) {
      expect(names.filter((n) => re.test(n)), `${re} must not draw Traditional text`).toEqual([])
    }
    expect(names.some((n) => TC_FAMILIES.some((re) => re.test(n))), `a TC family must draw it, got ${names.join()}`).toBe(true)
  })
})
