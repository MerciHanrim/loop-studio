import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L4.5 — per-locale catalogs + template-label dicts are
// lazy chunks. This spec is BEHAVIOUR only: dev-server module URLs / chunk
// names differ from the Production output, so the "which chunk was fetched"
// assertions live in e2e/i18n-chunks.dist.spec.ts and e2e/i18n.pwa.spec.ts.

type L = Record<string, { getState: () => any; setState?: (p: any) => void }>
const loop = (page: Page) => page.evaluate(() => (window as unknown as { __loop: L }).__loop && true)

const setLocale = (page: Page, code: string) =>
  page.evaluate((c) => (window as unknown as { __loop: L }).__loop.i18n.getState().setLocale(c), code)

const i18nState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: L }).__loop.i18n.getState()
    return { activeLocale: s.activeLocale, loading: s.loading, loadError: s.loadError }
  })

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

// a Template the menu offers (Early MMO, the previous subject, left the menu in 0.28.1)
const COFFEE = 'Coffee roastery operations flow'
async function openCoffee(page: Page) {
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  await page
    .locator('.toolbar__actions .menu')
    .first()
    .locator('.menu__pop [role="menuitem"]', { hasText: COFFEE })
    .click()
  const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
  await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
  if (await confirm.count()) await confirm.click()
  await expect(page.locator('.react-flow__node[data-id="green_stock"]')).toBeVisible()
}
const nodeLabel = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"] .nodef__name`).innerText()

test.describe('locale lazy-loading — behaviour', () => {
  test('a switch commits the UI catalog and the official node labels together — no EN flash', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    expect(await loop(page)).toBe(true)
    await openCoffee(page)
    expect(await nodeLabel(page, 'green_stock')).toBe('Green bean stock')

    // drive the switch and sample lang + a node label the moment it settles
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    // by the time <html lang> is 'ko', the node label is already Korean —
    // never an intermediate English frame
    expect(await nodeLabel(page, 'green_stock')).toBe('생두 재고')
    expect((await i18nState(page)).loadError).toBeNull()
  })

  test('re-selecting the active locale is a no-op', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    const before = await i18nState(page)
    await setLocale(page, 'ko')
    await page.waitForTimeout(100)
    expect(await i18nState(page)).toEqual(before)
  })

  // §L2.0 (2026-10) — this was a ja → ko burst (two lazy chunks). With en and
  // ko left, the race worth pinning is a SLOW lazy request overtaken by a fast
  // one: ko (its own chunk) then en (bundled, resolves at once). The en request
  // commits first; the ko completion that arrives afterwards is stale and must
  // be dropped whole.
  test('a fast ko → en burst settles on en, never commits ko', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const seen: string[] = []
    await page.exposeFunction('__seenLocale', (c: string) => seen.push(c))
    await page.evaluate(() => {
      const s = (window as unknown as { __loop: L }).__loop.i18n
      s.getState() // subscribe to every activeLocale commit
      ;(s as unknown as { subscribe: (f: (st: any) => void) => void }).subscribe((st) =>
        (window as unknown as { __seenLocale: (c: string) => void }).__seenLocale(st.activeLocale),
      )
    })
    await page.evaluate(() => {
      const api = (window as unknown as { __loop: L }).__loop.i18n.getState()
      api.setLocale('ko')
      api.setLocale('en')
    })
    // en was already on screen, so <html lang> alone proves nothing: wait until
    // the ko request has really finished — both halves fetched (dev module
    // URLs, as in the failed-load test below) and nothing loading — so a ko
    // commit, if the stale completion were not dropped, would have happened
    await expect
      .poll(() =>
        page.evaluate(() => {
          const urls = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((e) => e.name)
          return (
            urls.some((u) => u.includes('/i18n/locales/ko/')) && urls.some((u) => u.includes('/i18n/templateLabels/ko'))
          )
        }),
      )
      .toBe(true)
    await expect.poll(async () => (await i18nState(page)).loading).toBe(false)
    await page.waitForTimeout(200)
    expect(seen).not.toContain('ko')
    expect(await htmlLang(page)).toBe('en')
    expect((await i18nState(page)).activeLocale).toBe('en')
    expect(await stored(page)).toBe('en')
  })

  test('a failed load keeps the current language and shows a dismissible notice', async ({
    page,
    errors,
  }) => {
    await openApp(page)
    await resetAll(page)
    await openCoffee(page)
    // block BOTH halves of the ko load (dev module URLs). §L2.0 (2026-10) —
    // this was the ja load; ko is now the one lazy language.
    await page.route('**/i18n/locales/ko/**', (r) => r.abort())
    await page.route('**/i18n/templateLabels/ko*', (r) => r.abort())

    await setLocale(page, 'ko')
    await expect(page.locator('.boot-notice[role="status"]')).toBeVisible()
    const st = await i18nState(page)
    expect(st.activeLocale).toBe('en')
    expect(st.loadError?.code).toBe('ko')
    expect(await htmlLang(page)).toBe('en')
    expect(await nodeLabel(page, 'green_stock')).toBe('Green bean stock')

    // a successful switch clears the notice. It has to be a DIFFERENT locale
    // from the active one (re-selecting en is a no-op) and must not depend on
    // the browser retrying a module import that already failed, so it is the
    // dev pseudo-locale en-XA (en's catalog, a registered code of its own).
    await page.unroute('**/i18n/locales/ko/**')
    await page.unroute('**/i18n/templateLabels/ko*')
    await setLocale(page, 'en-XA')
    await expect.poll(() => htmlLang(page)).toBe('en-XA')
    await expect(page.locator('.boot-notice[role="status"]')).toHaveCount(0)

    // the aborted-import network errors are expected here; nothing else is
    const unexpected = errors.filter((e) => !/ERR_FAILED|Failed to load resource/i.test(e))
    expect(unexpected).toEqual([])
    errors.length = 0
  })

  test('§TLO11 — official nodes follow the switch, a user rename does not; undo stays coherent', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await openCoffee(page)
    // the rename below is a user edit (the Template opens editable; unlock in case)
    await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(false))
    // rename one node via the store bridge
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: L }).__loop.graph.getState()
      const n = g.nodes.find((x: any) => x.id === 'green_stock')
      g.updateNodeData(n.id, { label: 'My start' })
    })
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await nodeLabel(page, 'green_stock')).toBe('My start') // user rename kept
    expect(await nodeLabel(page, 'green_delivery')).toBe('생두 입고') // official switched

    // one undo removes the rename, not "Korean → English half-state"
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().undo())
    expect(await nodeLabel(page, 'green_stock')).toBe('생두 재고')
  })
})
