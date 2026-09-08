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

const MMO = 'Early MMO progression (levels 1–15)'
async function openMmo(page: Page) {
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  await page
    .locator('.toolbar__actions .menu')
    .first()
    .locator('.menu__pop [role="menuitem"]', { hasText: MMO })
    .click()
  const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
  await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
  if (await confirm.count()) await confirm.click()
  await expect(page.locator('.react-flow__node[data-id="char_creation"]')).toBeVisible()
}
const nodeLabel = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"] .nodef__title`).innerText()

test.describe('locale lazy-loading — behaviour', () => {
  test('a switch commits the UI catalog and the official node labels together — no EN flash', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    expect(await loop(page)).toBe(true)
    await openMmo(page)
    expect(await nodeLabel(page, 'char_creation')).toBe('Character creation')

    // drive the switch and sample lang + a node label the moment it settles
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    // by the time <html lang> is 'ko', the node label is already Korean —
    // never an intermediate English frame
    expect(await nodeLabel(page, 'char_creation')).toBe('캐릭터 생성')
    expect((await i18nState(page)).loadError).toBeNull()
  })

  test('re-selecting the active locale is a no-op', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')
    await expect.poll(() => htmlLang(page)).toBe('ja')
    const before = await i18nState(page)
    await setLocale(page, 'ja')
    await page.waitForTimeout(100)
    expect(await i18nState(page)).toEqual(before)
  })

  test('a fast ja → ko burst settles on ko, never commits ja', async ({ page }) => {
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
      api.setLocale('ja')
      api.setLocale('ko')
    })
    await expect.poll(() => htmlLang(page)).toBe('ko')
    await page.waitForTimeout(200)
    expect(seen).not.toContain('ja')
    expect(await stored(page)).toBe('ko')
  })

  test('a failed load keeps the current language and shows a dismissible notice', async ({
    page,
    errors,
  }) => {
    await openApp(page)
    await resetAll(page)
    await openMmo(page)
    // block BOTH halves of the ja load (dev module URLs)
    await page.route('**/i18n/locales/ja/**', (r) => r.abort())
    await page.route('**/i18n/templateLabels/ja*', (r) => r.abort())

    await setLocale(page, 'ja')
    await expect(page.locator('.boot-notice[role="status"]')).toBeVisible()
    const st = await i18nState(page)
    expect(st.activeLocale).toBe('en')
    expect(st.loadError?.code).toBe('ja')
    expect(await htmlLang(page)).toBe('en')
    expect(await nodeLabel(page, 'char_creation')).toBe('Character creation')

    // a successful switch clears the notice
    await page.unroute('**/i18n/locales/ja/**')
    await page.unroute('**/i18n/templateLabels/ja*')
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
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
    await openMmo(page)
    // rename one node via the store bridge
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: L }).__loop.graph.getState()
      const n = g.nodes.find((x: any) => x.id === 'char_creation')
      g.updateNodeData(n.id, { label: 'My start' })
    })
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await nodeLabel(page, 'char_creation')).toBe('My start') // user rename kept
    expect(await nodeLabel(page, 'active_char')).toBe('활성 캐릭터') // official switched

    // one undo removes the rename, not "Korean → English half-state"
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().undo())
    expect(await nodeLabel(page, 'char_creation')).toBe('캐릭터 생성')
  })
})
