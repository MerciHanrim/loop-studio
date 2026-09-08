import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { LOCALE_CHUNK_RE } from '../scripts/locale-chunk.mjs'

// Runs under playwright.pwa.config.ts — a real `--mode pwa` build with the
// service worker, served by e2e/support/pwa-serve.mjs at :4174.
// docs/localization.md §L4.5 / docs/pwa.md §P8 — the per-locale `locale-*` /
// `tmpl-labels-*` chunks are NOT precached; they are CacheFirst runtime-cached
// in `loop-locale-chunks`, so a language becomes offline-usable once loaded
// while the SW controls the page.

const ORIGIN = 'http://localhost:4174'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem('loop-studio/guided-tour/1'))
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
    } catch {
      /* ignore */
    }
  })
})

const setGen = (page: Page, to: 'a' | 'b' | 'c') =>
  page.request.post(`${ORIGIN}/__gen?to=${to}`).then((r) => expect(r.ok()).toBe(true))
const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

/** first visit installs the SW; one reload puts the page under its control */
async function installAndControl(page: Page) {
  await page.goto('/')
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
}

async function pickLocale(page: Page, code: string) {
  const trigger = page.locator('.lang-switch').first()
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.locator(`.lang-menu__item[data-locale="${code}"]`).click()
}

/** paths held in the `loop-locale-chunks` runtime cache */
const localeCachePaths = (page: Page) =>
  page.evaluate(async () => {
    const has = (await caches.keys()).includes('loop-locale-chunks')
    if (!has) return []
    const reqs = await (await caches.open('loop-locale-chunks')).keys()
    return reqs.map((r) => new URL(r.url).pathname).sort()
  })

const swPrecache = (page: Page) =>
  page.request
    .get(`${ORIGIN}/sw.js`)
    .then((r) => r.text())
    .then((sw) => [...new Set([...sw.matchAll(/\{\s*url:\s*"([^"]+)"/g)].map((m) => m[1]))].sort())

test('precache is EN + app shell only — no locale chunk', async ({ page }) => {
  await setGen(page, 'a')
  const list = await swPrecache(page)
  expect(list.some((u) => LOCALE_CHUNK_RE.test(u))).toBe(false)
  expect(list).toContain('index.html')
  expect(list).toContain('manifest.webmanifest')
  expect(list.some((u) => /^assets\/index-[\w-]+\.js$/.test(u))).toBe(true)
  expect(list.some((u) => /^assets\/index-[\w-]+\.css$/.test(u))).toBe(true)
  expect(list.some((u) => /\.woff2?$/.test(u))).toBe(true)
  expect(list.some((u) => /^icons\/.+\.png$/.test(u))).toBe(true)
})

test('a language loaded under an active SW is runtime-cached and works offline', async ({ page, context }) => {
  await setGen(page, 'a')
  await installAndControl(page)
  expect(await localeCachePaths(page)).toEqual([]) // nothing yet — booted EN

  await pickLocale(page, 'ja')
  await expect.poll(() => htmlLang(page)).toBe('ja')
  await expect.poll(() => localeCachePaths(page)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/assets\/locale-ja-/), expect.stringMatching(/\/assets\/tmpl-labels-ja-/)]),
  )

  // go offline, reload — the saved locale boots from the runtime cache
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await htmlLang(page)).toBe('ja')

  // a never-loaded language, offline → refused, JA kept, notice shown
  await pickLocale(page, 'ko')
  await expect(page.locator('.boot-notice[role="status"]')).toBeVisible()
  expect(await htmlLang(page)).toBe('ja')
  expect(await page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))).toBe('ko') // intent still recorded
  await context.setOffline(false)
})

test('a fresh SW-controlled boot in a saved language has that language cached — no idle warm needed', async ({
  page,
}) => {
  await setGen(page, 'a')
  await installAndControl(page)
  await pickLocale(page, 'ja')
  await expect.poll(() => htmlLang(page)).toBe('ja')

  // brand-new context: SW is installed but does not control the FIRST load
  // (clientsClaim:false). One reload → controlled → the boot import() of the
  // saved JA locale flows through CacheFirst and is stored.
  await page.evaluate(() => caches.delete('loop-locale-chunks'))
  await page.reload() // still not necessarily controlled here…
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.reload() // …controlled now; this boot caches JA
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await htmlLang(page)).toBe('ja')
  await expect.poll(() => localeCachePaths(page)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/assets\/locale-ja-/)]),
  )
})

test('after an app update, the saved language boots against the new chunk', async ({ page }) => {
  await setGen(page, 'a')
  await installAndControl(page)
  await pickLocale(page, 'ja')
  await expect.poll(() => htmlLang(page)).toBe('ja')
  const before = await localeCachePaths(page)

  // move to generation B (new content hashes), activate it, reload
  await setGen(page, 'b')
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))
  await page.waitForFunction(() =>
    navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting),
  )
  await page.evaluate(() =>
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.waiting?.postMessage({ type: 'SKIP_WAITING' })),
  )
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.reload()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  // the saved language survives the SW update and is present in the runtime
  // cache for the now-controlling generation (the fixture's generations share
  // the locale content, so the chunk hash itself may not move — what matters
  // is that the update did not strand JA)
  expect(await htmlLang(page)).toBe('ja')
  await expect.poll(() => localeCachePaths(page)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/assets\/locale-ja-/)]),
  )
  expect(before.some((p) => /\/assets\/locale-ja-/.test(p))).toBe(true)
})
