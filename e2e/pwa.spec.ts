import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

// Runs under playwright.pwa.config.ts — three pre-built `--mode pwa` generations
// (stamps pwagenA/B/C) served by e2e/support/pwa-serve.mjs, which switches which
// one it serves on `POST /__gen?to=`. No in-test builds. Each test gets a fresh
// BrowserContext ⇒ a clean service worker + Cache Storage, and pins the
// generation it starts from, so order / retries do not matter.
// No `window.__loop` bridge (prod build) — DOM / navigator driven throughout.

const ORIGIN = 'http://localhost:4174'
const ALT_ORIGIN = 'http://127.0.0.1:4174' // reaches the same content, NOT an allowed origin

// docs/guided-tour.md — keep the first-run Welcome card out of these DOM-driven
// tests (this spec doesn't use the shared `./support/loop` fixture). Context-
// scoped so the second page some tests open (`context.newPage()`) is covered.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    ;(window as unknown as { __noFirstRunTour: boolean }).__noFirstRunTour = true
  })
})

const setGen = (page: Page, to: 'a' | 'b' | 'c') =>
  page.request.post(`${ORIGIN}/__gen?to=${to}`).then((r) => expect(r.ok()).toBe(true))

const ready = (page: Page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
const controller = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)
const stamp = (page: Page) => page.locator('.toolbar__build')
const nodeCount = (page: Page) => page.locator('.react-flow__node').count()

/** first visit → SW active; one reload → the page is controlled */
async function installAndControl(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  await ready(page)
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}

/** the Workbox precache list currently advertised by /sw.js (unique, sorted) */
async function swPrecache(page: Page): Promise<string[]> {
  const sw = await page.request.get(`${ORIGIN}/sw.js`).then((r) => r.text())
  return [...new Set([...sw.matchAll(/\{\s*url:\s*"([^"]+)"/g)].map((m) => m[1]))].sort()
}
/** what the single Workbox cache actually holds, normalised to bare paths */
function cachedPaths(page: Page): Promise<{ cacheName: string; paths: string[]; allKeys: string[] }> {
  return page.evaluate(async () => {
    const keys = await caches.keys()
    const wb = keys.find((k) => k.includes('workbox-precache')) ?? keys[0]
    const reqs = await (await caches.open(wb)).keys()
    const paths = reqs.map((r) => new URL(r.url).pathname.replace(/^\//, '')).sort()
    return { cacheName: wb, paths, allKeys: keys }
  })
}

async function stageUpdate(page: Page, to: 'a' | 'b' | 'c'): Promise<void> {
  await setGen(page, to)
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))
  await page.waitForFunction(() =>
    navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting),
  )
}

// ── install + first-visit lifecycle ──────────────────────────────────────

test('installable conditions, first-visit lifecycle, no bar on first install', async ({ page }) => {
  await setGen(page, 'a')
  await page.goto('/')
  await expect(page.locator('.canvas .react-flow')).toBeVisible()

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const mani = await page.evaluate((h) => fetch(h as string).then((r) => r.json()), href)
  expect(mani).toMatchObject({ name: 'Loop Studio', display: 'standalone', id: '/', start_url: '/', scope: '/' })
  const icons = mani.icons as { sizes: string; purpose?: string }[]
  expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(icons.some((i) => i.purpose === 'maskable')).toBe(true)

  await ready(page)
  const s1 = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    return { has: !!r, active: r?.active?.state ?? null }
  })
  expect(s1).toEqual({ has: true, active: 'activated' })
  expect(await controller(page)).toBeNull() // first install ⇒ not controlled
  await expect(page.locator('.pwa-update')).toHaveCount(0)

  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  expect(await controller(page)).toMatch(/\/sw\.js$/)
  await expect(page.locator('.pwa-update')).toHaveCount(0)
})

test('after install the cache holds exactly the advertised precache set', async ({ page }) => {
  await setGen(page, 'a')
  await installAndControl(page)
  const advertised = await swPrecache(page)
  const { cacheName, paths } = await cachedPaths(page)
  expect(cacheName).toMatch(/workbox-precache/)
  expect(paths).toEqual(advertised) // one generation, nothing extra, nothing missing
  expect(paths).toContain('index.html')
  expect(paths).toContain('manifest.webmanifest')
  expect(paths.some((p) => /^assets\/mc\.worker-.*\.js$/.test(p))).toBe(true)
})

// ── offline ──────────────────────────────────────────────────────────────

test('offline cold boot: app + deterministic Step work with the network down', async ({
  page,
  context,
}) => {
  await setGen(page, 'a')
  await installAndControl(page)
  await context.setOffline(true)

  const p2 = await context.newPage()
  await p2.goto('/')
  await expect(p2.locator('.canvas .react-flow')).toBeVisible()
  const before = await nodeCount(p2)
  await p2.locator('.toolbar__palette .chip--pool').click()
  await expect(p2.locator('.react-flow__node')).toHaveCount(before + 1)
  await p2.locator('.pb-btn[title="Advance one step"]').click()
  await expect(p2.locator('.pstrip__step')).toContainText('step 1')

  await context.setOffline(false)
})

test('offline Monte-Carlo: the precached worker chunk runs a real distribution', async ({
  page,
  context,
}) => {
  await setGen(page, 'a')
  await installAndControl(page) // the sample graph is Source ─2→ Pool ─1→ Drain
  await context.setOffline(true)

  const p2 = await context.newPage()
  await p2.goto('/')
  await expect(p2.locator('.canvas .react-flow')).toBeVisible()

  await p2.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
  const dlg = p2.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
  await expect(dlg).toBeVisible()
  const nums = dlg.locator('.mcdlg__field input[type="number"]')
  await nums.nth(0).fill('40')
  await nums.nth(1).fill('12')
  await dlg.locator('.mcdlg__foot .btn--primary').click()
  await p2.keyboard.press('Escape')

  await expect(p2.locator('.dist')).toBeVisible({ timeout: 20_000 })
  await expect(p2.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')

  await context.setOffline(false)
})

test('offline: a #g1= share link opens from cache and strips the fragment', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __clip: string[] }).__clip = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) =>
          void (window as unknown as { __clip: string[] }).__clip.push(t),
      },
    })
  })
  await setGen(page, 'a')
  await installAndControl(page)

  await page.locator('.toolbar__palette .chip--drain').click()
  const distinct = await nodeCount(page)
  // the §U4 disclosure is an in-app ConfirmDialog now
  await page.locator('.toolbar__actions button', { hasText: /^Share$/ }).click()
  await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
  const url = await page.locator('.share-pop__url').inputValue()
  const payload = url.split('#g1=')[1]
  expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)

  await context.setOffline(true)
  const p2 = await context.newPage()
  await p2.goto(`/#g1=${payload}`)
  await expect(p2.locator('.react-flow__node')).toHaveCount(distinct)
  expect(await p2.evaluate(() => location.hash)).toBe('')
  await context.setOffline(false)
})

// ── registration gate (real browser, not just the unit test) ────────────

test('a PWA build opened from a NON-allowed origin does not register a SW', async ({ page }) => {
  await setGen(page, 'a')
  await page.goto(`${ALT_ORIGIN}/`) // 127.0.0.1 ≠ the baked http://localhost:4174
  await expect(page.locator('.canvas .react-flow')).toBeVisible()

  // the artifact IS a PWA build — the manifest link is present…
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  // …but registration is refused on this origin (§P7)
  await page.waitForTimeout(1000)
  const regs = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((r) => r.length),
  )
  expect(regs).toBe(0)
  expect(await controller(page)).toBeNull()
})

// ── update lifecycle (pre-built generations, no in-test builds) ─────────

test('waiting worker ⇒ bar; no auto reload; Dismiss keeps it hidden for that worker; a new generation re-shows it', async ({
  page,
}) => {
  await setGen(page, 'a')
  await installAndControl(page)
  const base = (await stamp(page).textContent())!.trim()
  await page.evaluate(() => ((window as unknown as { __sentinel: boolean }).__sentinel = true))

  await stageUpdate(page, 'b')
  await expect(page.locator('.pwa-update')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __sentinel?: boolean }).__sentinel)).toBe(true)
  await expect(stamp(page)).toHaveText(base) // not reloaded

  await page.locator('.pwa-update button', { hasText: 'Dismiss' }).click()
  await expect(page.locator('.pwa-update')).toHaveCount(0)
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update())) // same worker
  await page.waitForTimeout(400)
  await expect(page.locator('.pwa-update')).toHaveCount(0)

  await stageUpdate(page, 'c') // a genuinely different worker
  await expect(page.locator('.pwa-update')).toBeVisible()
})

test('Update ⇒ one reload, new generation only, no stale hashed URLs, stamp matches', async ({
  page,
}) => {
  await setGen(page, 'a')
  await installAndControl(page)
  const oldPrecache = await swPrecache(page)
  const oldHashed = oldPrecache.filter((u) => /assets\/.*-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(u))
  expect(oldHashed.length).toBeGreaterThan(0)
  await page.evaluate(() => ((window as unknown as { __sentinel: boolean }).__sentinel = true))

  await stageUpdate(page, 'c')
  await expect(page.locator('.pwa-update')).toBeVisible()

  await Promise.all([
    page.waitForEvent('load'),
    page.locator('.pwa-update button', { hasText: 'Update' }).click(),
  ])
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)

  // reloaded exactly once
  expect(await page.evaluate(() => (window as unknown as { __sentinel?: boolean }).__sentinel)).toBeUndefined()

  const newPrecache = await swPrecache(page) // /sw.js is now generation C's
  const { allKeys, paths } = await cachedPaths(page)

  expect(allKeys.filter((k) => k.includes('workbox-precache'))).toHaveLength(1)
  expect(paths).toEqual(newPrecache) // the cache holds exactly generation C's set

  // the chunks that actually differ between A and C (the stamped index bundle)
  // must be gone; a chunk whose content did not change keeps its URL — fine.
  const rotated = oldHashed.filter((u) => !newPrecache.includes(u))
  expect(rotated.length).toBeGreaterThan(0)
  for (const stale of rotated) expect(paths).not.toContain(stale)

  await expect(stamp(page)).toHaveText(/pwagenC/) // the served shell is generation C
})

test('Update with a run in progress asks once more; cancel keeps the run and does not reload', async ({
  page,
}) => {
  await setGen(page, 'a')
  await installAndControl(page)
  const base = (await stamp(page).textContent())!.trim()
  await page.evaluate(() => ((window as unknown as { __sentinel: boolean }).__sentinel = true))

  await stageUpdate(page, 'b')
  await expect(page.locator('.pwa-update')).toBeVisible()

  await page.locator('.pb-btn--primary', { hasText: 'Play' }).click()
  await expect(page.locator('.pb-btn--primary', { hasText: 'Pause' })).toBeVisible()

  // the "run in progress" prompt is an in-app ConfirmDialog now
  await page.locator('.pwa-update button', { hasText: 'Update' }).click()
  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText(/run is in progress/i)
  await dlg.getByRole('button', { name: /^cancel$/i }).click()
  await expect(dlg).toHaveCount(0)
  await page.waitForTimeout(600)

  expect(await page.evaluate(() => (window as unknown as { __sentinel?: boolean }).__sentinel)).toBe(true)
  await expect(page.locator('.pb-btn--primary', { hasText: 'Pause' })).toBeVisible()
  await expect(stamp(page)).toHaveText(base)
})

test('Update with a run in progress — confirm applies and reloads', async ({ page }) => {
  await setGen(page, 'a')
  await installAndControl(page)
  await page.evaluate(() => ((window as unknown as { __sentinel: boolean }).__sentinel = true))
  await stageUpdate(page, 'b')
  await expect(page.locator('.pwa-update')).toBeVisible()
  await page.locator('.pb-btn--primary', { hasText: 'Play' }).click()
  await expect(page.locator('.pb-btn--primary', { hasText: 'Pause' })).toBeVisible()

  await page.locator('.pwa-update button', { hasText: 'Update' }).click()
  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  await Promise.all([
    page.waitForEvent('load'),
    dlg.getByRole('button', { name: /apply and reload|적용하고 다시 로드/i }).click(),
  ])
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  // reloaded exactly once (the sentinel is gone)
  expect(await page.evaluate(() => (window as unknown as { __sentinel?: boolean }).__sentinel)).toBeUndefined()
})
