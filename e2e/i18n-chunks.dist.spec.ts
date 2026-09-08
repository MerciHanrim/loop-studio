import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'

// Runs under playwright.dist.config.ts — the real `dist/` build via `vite
// preview`, the shape Cloudflare Pages serves. docs/localization.md §L4.5:
// per-locale catalogs + template-label dicts are their own chunks. This spec
// asserts the CHUNK SHAPE (which files a first EN load fetches; that a switch
// fetches exactly its chunk once) — impossible to check on the dev server,
// whose module URLs differ from the built output.

const ORIGIN = 'http://localhost:4173'

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
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
}

async function pickLocale(page: Page, code: string) {
  const trigger = page.locator('.lang-switch').first()
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

  test('ja then ko fetches at most one chunk per language and ends on ko', async ({ page }) => {
    await openProd(page)
    await pickLocale(page, 'ja')
    await pickLocale(page, 'ko')
    const chunks = localeChunks(await fetched(page))
    // one locale + one tmpl-labels per language, no duplicates
    expect(chunks).toEqual([...new Set(chunks)])
    expect(chunks.filter((u) => /locale-ja-/.test(u))).toHaveLength(1)
    expect(chunks.filter((u) => /locale-ko-/.test(u))).toHaveLength(1)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko')
  })
})
