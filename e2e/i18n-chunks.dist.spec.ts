import type { Page } from '@playwright/test'
import { expect, test, waitForAppReady } from './support/loop'

// Runs under playwright.dist.config.ts — the real `dist/` build via `vite
// preview`, the shape Cloudflare Pages serves. docs/localization.md §L4.5:
// per-locale catalogs + template-label dicts are their own chunks. This spec
// asserts the CHUNK SHAPE (which files a first EN load fetches; that a switch
// fetches exactly its chunk once) — impossible to check on the dev server,
// whose module URLs differ from the built output.

/** resource URLs the page has fetched so far, path-only */
const fetched = (page: Page) =>
  page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((e) =>
      e.name.replace(location.origin, ''),
    ),
  )
const localeChunks = (urls: string[]) =>
  urls.filter((u) => /\/assets\/(locale|tmpl-labels)-[A-Za-z0-9-]+-[A-Za-z0-9_-]+\.js$/.test(u)).sort()

async function openProd(page: Page) {
  await page.goto('/')
  await waitForAppReady(page)
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
}

async function pickLocale(page: Page, code: string) {
  // Language now lives inside Settings' popover (docs/toolbar-responsive.md)
  // -- `.lang-switch` doesn't exist in the DOM at all until Settings opens
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.locator(`.lang-menu__item[data-locale="${code}"]`).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

test.describe('locale chunks — production bundle shape', () => {
  test('a first EN load fetches no locale chunk', async ({ page }) => {
    await openProd(page)
    // idle a beat — any stray lazy fetch would have fired by now
    await page.waitForTimeout(300)
    expect(localeChunks(await fetched(page))).toEqual([])
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
  })

  test('switching to Korean fetches exactly the ko chunks, once', async ({ page }) => {
    await openProd(page)
    await pickLocale(page, 'ko')
    await expect(page.locator('.toolbar')).toBeVisible()

    const afterKo = localeChunks(await fetched(page))
    expect(afterKo).toHaveLength(2)
    expect(afterKo.some((u) => /\/assets\/locale-ko-/.test(u))).toBe(true)
    expect(afterKo.some((u) => /\/assets\/tmpl-labels-ko-/.test(u))).toBe(true)

    // re-selecting Korean fetches nothing new
    await pickLocale(page, 'ko').catch(() => {}) // menu may treat it as a no-op
    await page.waitForTimeout(200)
    expect(localeChunks(await fetched(page))).toEqual(afterKo)
  })

  // §L2.0 (2026-10) — this was "ja then ko" (two lazy languages). With en and
  // ko the only shipped languages, the remaining case the test above does not
  // cover is LEAVING Korean and coming back: en is bundled, and the second ko
  // activation must reuse the chunks the first one fetched.
  test('ko → en → ko fetches each language chunk at most once and ends on ko', async ({ page }) => {
    await openProd(page)
    await pickLocale(page, 'ko')
    await pickLocale(page, 'en')
    await pickLocale(page, 'ko')
    const chunks = localeChunks(await fetched(page))
    // one locale + one tmpl-labels chunk for ko, no duplicates; en has none
    expect(chunks).toEqual([...new Set(chunks)])
    expect(chunks.filter((u) => /locale-ko-/.test(u))).toHaveLength(1)
    expect(chunks.filter((u) => /tmpl-labels-ko-/.test(u))).toHaveLength(1)
    expect(chunks.filter((u) => /\/(locale|tmpl-labels)-en-/.test(u))).toEqual([])
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko')
  })
})
