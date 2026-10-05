import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'
import { aboutDialog, expectShownNoticesAre, manifestNoticesSha, openAbout, openLicences, sha256 } from './support/licenses'

// Issue #301 — the About dialog's licence view, on the dev server. The dev
// server answers THIRD_PARTY_NOTICES.txt with the web build's text rebuilt
// from the committed manifest (scripts/third-party-notices/vite-plugin.mjs
// `thirdPartyNoticesDev`), so the screen must show exactly the bytes the
// manifest pins for the web build. The production bundle, the PWA (offline)
// and the portable file are covered in dist.spec.ts, pwa.spec.ts and
// portable-file.spec.ts.

const NOTICES = '**/THIRD_PARTY_NOTICES.txt'

test.describe('the licence view in About', () => {
  test('shows the web build’s notices as text, says first that they cover third-party components, and Back returns to About', async ({ page }) => {
    await openApp(page)
    const dlg = await openAbout(page)
    const button = dlg.locator('[data-about-licenses]')
    await expect(button).toHaveText('Third-party open-source licenses')
    await openLicences(page)
    // the same dialog, now titled with the view's name; focus on Back
    await expect(page.locator('.mcdlg--about')).toHaveCount(1)
    await expect(dlg.locator('.mcdlg__head')).toContainText('Third-party open-source licenses')
    await expect(dlg.locator('[data-licenses-back]')).toBeFocused()
    await expect(dlg.locator('.licenses__lead')).toContainText('They cover those components only, not Loop Studio itself.')
    await expectShownNoticesAre(page, 'web')
    // the text: left to right, English, scrollable, focusable, selectable
    const pre = dlg.locator('[data-licenses-text]')
    expect(await pre.evaluate((el) => ({ dir: el.getAttribute('dir'), lang: el.getAttribute('lang'), tab: el.tabIndex, label: el.getAttribute('aria-label'), scrolls: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY, select: getComputedStyle(el).userSelect }))).toEqual({ dir: 'ltr', lang: 'en', tab: 0, label: 'License texts', scrolls: true, overflow: 'auto', select: 'text' })
    // selecting it gives the text back (what a copy would take). MEASURED:
    // Chrome's selection drops the text's one final newline and nothing else
    const selected = await pre.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      const s = getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      return s.toString()
    })
    expect(sha256(`${selected}\n`)).toBe(manifestNoticesSha('web'))
    // the file link: same origin, a new tab, no opener
    const link = dlg.locator('[data-licenses-file]')
    await expect(link).toHaveAttribute('href', new URL('THIRD_PARTY_NOTICES.txt', page.url()).href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/)
    // Back: About again, focus on the button that left it
    await dlg.locator('[data-licenses-back]').click()
    await expect(dlg).toHaveAttribute('data-about-view', 'about')
    await expect(dlg.locator('[data-about-licenses]')).toBeFocused()
    await expect(dlg).toContainText('Copyright © 2026 Hanrim. All rights reserved.')
  })

  test('the file link opens the same text in a new tab, with no opener', async ({ page, context }) => {
    await openApp(page)
    await openAbout(page)
    const dlg = await openLicences(page)
    await expectShownNoticesAre(page, 'web')
    const [tab] = await Promise.all([context.waitForEvent('page'), dlg.locator('[data-licenses-file]').click()])
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe('/THIRD_PARTY_NOTICES.txt')
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    const body = await (await tab.request.get(tab.url())).text()
    expect(sha256(body)).toBe(manifestNoticesSha('web'))
    await tab.close()
  })

  test('Escape closes the whole dialog from the licence view, and it opens on About next time', async ({ page }) => {
    await openApp(page)
    await openAbout(page)
    await openLicences(page)
    await page.keyboard.press('Escape')
    await expect(aboutDialog(page)).toHaveCount(0)
    await expect(page.locator('[data-tour="help-trigger"]')).toBeFocused()
    await openAbout(page)
    await expect(aboutDialog(page)).toHaveAttribute('data-about-view', 'about')
  })

  test('a read that fails has its own state; About stays usable, and Try again reads again', async ({ page, errors }) => {
    await openApp(page)
    let fail = true
    await page.route(NOTICES, (route) => (fail ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }) : route.continue()))
    await openAbout(page)
    const dlg = await openLicences(page)
    await expect(dlg.locator('.licenses')).toHaveAttribute('data-licenses-state', 'error')
    await expect(dlg.locator('[role="alert"]')).toContainText('The license texts could not be loaded.')
    await expect(dlg.locator('[data-licenses-text]')).toHaveCount(0)
    // Back still works, and the licences button opens the view again
    await dlg.locator('[data-licenses-back]').click()
    await expect(dlg).toHaveAttribute('data-about-view', 'about')
    await openLicences(page)
    await expect(dlg.locator('.licenses')).toHaveAttribute('data-licenses-state', 'error')
    fail = false
    await dlg.locator('[data-licenses-retry]').click()
    await expectShownNoticesAre(page, 'web')
    // the two refused reads log their 503; nothing else is expected
    expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 503/.test(e))).toEqual([])
    expect(errors).toHaveLength(2)
    errors.length = 0
  })

  test('a host that answers with the app page instead is a failure, not shown as notices', async ({ page }) => {
    await openApp(page)
    await page.route(NOTICES, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Loop Studio</title>' }))
    await openAbout(page)
    const dlg = await openLicences(page)
    await expect(dlg.locator('.licenses')).toHaveAttribute('data-licenses-state', 'error')
  })

  test('the dev server’s text is the manifest’s web text, byte for byte', async ({ page }) => {
    await openApp(page)
    const res = await page.request.get('/THIRD_PARTY_NOTICES.txt')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toMatch(/^text\/plain/)
    expect(sha256(await res.text())).toBe(manifestNoticesSha('web'))
  })

  test('in all 18 languages the button and the title read the catalog’s name, and the text stays English, left to right', async ({ page }) => {
    await openApp(page)
    const codes = await page.evaluate(async () => (await import('/src/i18n/registry.ts')).enabledLocales().map((l) => l.code).filter((c) => !/-X[A-Z]$/.test(c)))
    expect(codes).toHaveLength(18)
    const setLocale = async (code: string) => {
      await page.evaluate((c) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n.getState().setLocale(c), code)
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
    }
    const name = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { i18n: { getState: () => { activeCatalog: Record<string, string> } } } }).__loop.i18n.getState().activeCatalog['about.licenses'])
    for (const code of codes) {
      await setLocale(code)
      const expected = await name(page)
      expect(expected, `${code} has a name for the licence view`).toBeTruthy()
      if (code === 'ko') expect(expected).toBe('제3자 오픈소스 라이선스')
      await page.locator('[data-tour="help-trigger"]').click()
      await page.locator('[role="menu"] [role="menuitem"]').last().click()
      const dlg = aboutDialog(page)
      await expect(dlg.locator('[data-about-licenses]')).toHaveText(expected!)
      await openLicences(page)
      await expect(dlg.locator('.mcdlg__head > span')).toHaveText(expected!)
      const pre = dlg.locator('[data-licenses-text]')
      await expect(pre).toBeVisible()
      expect(await pre.evaluate((el) => [el.getAttribute('dir'), el.getAttribute('lang'), el.scrollWidth <= el.clientWidth])).toEqual(['ltr', 'en', true])
      await page.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
    }
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })

  test('the More sheet’s About opens the same licence view; nothing is cut off and the page does not scroll sideways', async ({ page }) => {
    await openApp(page)
    await page.locator('.mob-more').click()
    const help = page.locator('.sheet__row', { hasText: /^Help/ })
    await help.focus()
    await page.keyboard.press('Enter')
    const about = page.locator('.sheet .sheet__row', { hasText: /^About Loop Studio$/ })
    await about.focus()
    await page.keyboard.press('Enter')
    const dlg = aboutDialog(page)
    await expect(dlg).toBeVisible()
    await openLicences(page)
    await expectShownNoticesAre(page, 'web')
    const fit = await page.evaluate(() => {
      const d = document.querySelector('.mcdlg--about')!.getBoundingClientRect()
      const pre = document.querySelector('[data-licenses-text]') as HTMLElement
      return { dialogInside: d.left >= 0 && d.right <= window.innerWidth, preNoSideways: pre.scrollWidth <= pre.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    expect(fit).toEqual({ dialogInside: true, preNoSideways: true, page: 0 })
  })
})
