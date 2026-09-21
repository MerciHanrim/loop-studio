import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md — Simplified Chinese (`zh-Hans`).
//
// Eight contracts, written red-first against a product that does not yet
// register the locale. They are deliberately expressed as behaviour a user can
// observe, not as assertions about the registry's internals:
//
//   1 a Chinese browser reaches Chinese, by region tag
//   2 a Traditional-Chinese browser is not quietly given Simplified
//   3 Han glyphs are not drawn from the Korean fallback
//   4 the picker offers 简体中文, tagged with its own language
//   5 a Chinese node title wraps on phrase boundaries and never overflows
//   6 the registry-driven specs reach the new locale without special-casing
//   7 the template-label dictionary loads — bundled templates are not left in English
//   8 the visible label is the endonym (findable three ways: languageOptions.test.ts)
//
// Nothing here uses a baseline image: fonts, wrapping and overflow are pinned
// by measurement (docs/localization.md, ruling D-6).

const HANS = 'zh-Hans'

/** A sample carrying characters whose shapes differ between Simplified,
 *  Traditional, Japanese and Korean, so a wrong regional font is detectable:
 *  资/資 转/轉 触/觸 发/發. */
const HAN_SAMPLE = '资源池转换器触发'

/** Families that must never be the FIRST choice for Chinese text. */
const KR_FAMILIES = [/Noto Sans KR/i, /Malgun/i, /Gulim/i, /Batang/i, /Dotum/i, /AppleGothic/i]
const JP_FAMILIES = [/Noto Sans JP/i, /Yu Gothic/i, /Hiragino/i, /Meiryo/i, /MS( P)? Gothic/i]

/** The family the ENGINE actually used, not the declared stack.
 *  `getComputedStyle().fontFamily` returns what the author wrote and
 *  `document.fonts.check()` only answers "could this be used", so neither can
 *  see a wrong pick. CDP's `CSS.getPlatformFontsForNode` reports the real
 *  per-glyph usage. */
async function platformFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  if (!nodeId) {
    await cdp.detach()
    throw new Error(`platformFonts: no node for ${selector}`)
  }
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  await cdp.detach()
  // most-used first
  return [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)
}

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

/** Desktop: the language trigger lives inside `Settings ▾` (docs/localization.md
 *  §L5.3), so open Settings first when the trigger is not already on screen —
 *  the same path `i18n.spec.ts` uses. */
async function openLanguageMenu(page: Page) {
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page
      .locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定|设置) ▾$/ })
      .click()
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.lang-menu__pop')).toBeVisible()
}

// ------------------------------------------------------------------ 1
test.describe('a Simplified-Chinese browser', () => {
  test.use({ locale: 'zh-CN' })
  test('reaches Simplified Chinese, not English', async ({ page }) => {
    await openApp(page)
    expect(await htmlLang(page), 'zh-CN must resolve to zh-Hans').toBe(HANS)
  })
})

test.describe('a bare zh browser', () => {
  test.use({ locale: 'zh' })
  test('reaches Simplified Chinese', async ({ page }) => {
    await openApp(page)
    expect(await htmlLang(page)).toBe(HANS)
  })
})

// ------------------------------------------------------------------ 2
test.describe('a Traditional-Chinese browser', () => {
  test.use({ locale: 'zh-TW' })
  test('is never quietly given Simplified Chinese', async ({ page }) => {
    await openApp(page)
    const lang = await htmlLang(page)
    // Until `zh-Hant` ships, English is the correct answer; Simplified is not.
    expect(lang, 'zh-TW must not silently land on Simplified').not.toBe(HANS)
    expect(['en', 'zh-Hant'], `unexpected locale for zh-TW: ${lang}`).toContain(lang)
  })
})

// ------------------------------------------------------------------ 3
test.describe('Chinese glyphs', () => {
  test.use({ locale: 'zh-CN' })
  test('are not drawn from the Korean or Japanese fallback', async ({ page }) => {
    await openApp(page)
    expect(await htmlLang(page)).toBe(HANS)
    // a probe carrying only Han characters, inheriting the page font
    await page.evaluate((sample) => {
      const el = document.createElement('div')
      el.id = 'zh-probe'
      el.textContent = sample
      el.style.cssText = 'position:fixed;left:8px;top:8px;font-size:24px;z-index:99999'
      document.body.append(el)
    }, HAN_SAMPLE)
    await page.evaluate(() => document.fonts.ready)
    const fonts = await platformFonts(page, '#zh-probe')
    const primary = fonts[0]?.familyName ?? '(none)'
    console.log(`[zh-font] body probe → ${fonts.map((f) => `${f.familyName}×${f.glyphCount}`).join(', ')}`)
    expect(fonts.length, 'the probe rendered no glyphs').toBeGreaterThan(0)
    for (const bad of [...KR_FAMILIES, ...JP_FAMILIES]) {
      expect(primary, `Chinese text must not be drawn in ${bad} (got ${primary})`).not.toMatch(bad)
    }
  })
})

// ------------------------------------------------------------------ 4 + 8
test('the language picker offers 简体中文, tagged as its own language', async ({ page }) => {
  await openApp(page)
  await openLanguageMenu(page)
  const pop = page.locator('.lang-menu__pop')
  const row = pop.locator('.lang-menu__item').filter({ hasText: '简体中文' })
  await expect(row, 'the picker must offer Simplified Chinese').toHaveCount(1)
  // the endonym is the visible label and carries its own lang, so it renders
  // in the Chinese font even inside an English / Korean / Japanese UI
  const tagged = row.locator('[lang="zh-Hans"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('简体中文')

  // The three-way search contract lives in `languageOptions.test.ts`: the
  // picker only renders a search box from LANGUAGE_SEARCH_THRESHOLD (6)
  // enabled locales, which this release does not reach — the `fr` PR owns
  // that control and its layout (ruling D-7).
})

// ------------------------------------------------------------------ 5
test.describe('a Chinese node title', () => {
  test.use({ locale: 'zh-CN' })
  test('wraps on phrase boundaries and never overflows its node', async ({ page }) => {
    await openApp(page)
    expect(await htmlLang(page)).toBe(HANS)
    // structural: the UI under test is Chinese, so a localized name would not match
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page.locator('.menu__pop[role="menu"] [role="menuitem"]').first().click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load|加载|載入/i })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    const title = page.locator('.nodef__title').first()
    await expect(title).toBeVisible()
    const box = await title.evaluate((el) => ({
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      wbr: el.querySelectorAll('wbr').length,
      text: el.textContent ?? '',
    }))
    console.log(`[zh-wrap] ${JSON.stringify(box)}`)
    expect(/[一-鿿]/.test(box.text), 'the template label must be Chinese, not English').toBe(true)
    expect(box.scrollW, 'a node title must not overflow its node').toBeLessThanOrEqual(box.clientW + 1)
    expect(box.wbr, 'phrase segmentation must inject break opportunities').toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------ 6
test('the registry-driven contracts reach the new locale without special-casing', async ({ page }) => {
  await openApp(page)
  const codes = await page.evaluate(() =>
    [...document.querySelectorAll('.lang-menu__pop [lang]')].map((e) => e.getAttribute('lang')),
  )
  // the picker is closed here; read the registry through the switch instead
  await openLanguageMenu(page)
  const offered = await page
    .locator('.lang-menu__pop .lang-menu__item')
    .evaluateAll((els) => els.map((e) => e.querySelector('[lang]')?.getAttribute('lang') ?? ''))
  console.log(`[zh-registry] offered: ${JSON.stringify(offered)} (pre-open: ${JSON.stringify(codes)})`)
  expect(offered, 'zh-Hans must appear in the enabled registry').toContain(HANS)
  // switching to it must complete atomically: lang, and a Chinese UI string
  await page
    .locator('.lang-menu__pop .lang-menu__item')
    .filter({ hasText: '简体中文' })
    .first()
    .click()
  await expect.poll(() => htmlLang(page)).toBe(HANS)
  const chrome = await page.locator('.toolbar').innerText()
  expect(/[一-鿿]/.test(chrome), 'the toolbar must be in Chinese after the switch').toBe(true)
})

// ------------------------------------------------------------------ 7
test.describe('the zh-Hans template-label dictionary', () => {
  test.use({ locale: 'zh-CN' })
  test('loads, so a bundled template does not open with English labels', async ({ page }) => {
    await openApp(page)
    expect(await htmlLang(page)).toBe(HANS)
    // structural: the UI under test is Chinese, so a localized name would not match
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page.locator('.menu__pop[role="menu"] [role="menuitem"]').first().click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load|加载|載入/i })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    const labels = await page.locator('.nodef__title').allInnerTexts()
    console.log(`[zh-tmpl] ${JSON.stringify(labels)}`)
    expect(labels.length, 'the template produced no labelled nodes').toBeGreaterThan(3)
    const english = labels.filter((l) => /^[\x20-\x7e]+$/.test(l.trim()) && /[A-Za-z]{3}/.test(l))
    expect(english, 'no bundled template label may be left in English').toEqual([])
  })
})
