import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.2 / §L2.0a — the direction path, verified end to end
// as a ROUND TRIP: ltr → rtl → ltr.
//
// The contract since 2026-10-29: the LAYOUT never mirrors — it is LTR for every
// locale — and only the TEXT of a right-to-left language reads right to left.
// So the four values below are two layers, and they deliberately disagree under
// an RTL locale:
//   * `activeLocale`      — what the i18n store committed
//   * `directionOf(…)`    — the TEXT direction: what the registry says that
//                           locale reads as, and what every element-level `dir`
//                           attribute in the app reads
//   * `<html data-text-dir>` — that text direction as `applyHtml` wrote it, which
//                           the chrome-text rule in index.css reads
//   * `<html dir>`        — the LAYOUT direction (`LAYOUT_DIRECTION`), what the
//                           browser lays the app out by: `ltr` for every locale
//
// Locales: `ar-XB` is the RTL PSEUDO-locale (an English catalog with
// `direction: 'rtl'`). It is used here only for what it can still show — the
// language switch and the direction handling. Its English sentences read LTR
// under `unicode-bidi: plaintext`, so it no longer shows RTL chrome text; every
// check of RTL TEXT lives under the real `ar` locale (rtl-bidi-isolation,
// rtl-mixed-direction, rtl-form-direction, rtl-canvas-content-direction,
// rtl-layout-fixed). The layout witness below runs under `ar`, the shipped
// locale a reader would see.
//
// Why a round trip rather than a one-way switch. A one-way `en → ar-XB` test
// passes in two broken worlds: one where the initial render was already RTL (so
// nothing actually changed), and one where direction is set once and then sticks
// (so nothing can ever change back). Returning to `en` and re-checking every
// value is what separates "the switch works" from "the attribute happens to be
// right".
//
// What this test must NOT do:
//   * write `document.dir` / `<html dir>` / `data-text-dir`. The attributes are
//     the OUTPUT under test; setting them would be the test asserting its own
//     input. They change here only as a consequence of a locale switch.
//   * re-derive the expected text direction from the locale code. `directionOf`
//     comes from the app (the dev bridge), so a second implementation cannot
//     drift in and quietly agree with itself.
//
// Why `setLocale()` rather than clicking the picker: `ar-XB` is `enabled: false`
// (§L9.2) precisely so it is NOT offered as a language, so there is no row to
// click. `setLocale` is the same production action the picker calls —
// `LanguageSwitch` does nothing else — so the transition under test is the real
// one, and its async catalog load is exercised too.

type Bridge = {
  __loop: {
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
    directionOf: (code: string) => 'ltr' | 'rtl'
  }
}

/** every value, read together, so they cannot be sampled at different moments
 *  of the same transition */
const readDirection = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Bridge
    const active = w.__loop.i18n.getState().activeLocale
    const html = document.documentElement
    return {
      activeLocale: active,
      // the registry's answer, through the app's own resolver: the TEXT direction
      registryDirection: w.__loop.directionOf(active),
      // the attributes the app WROTE. Read, never written, and read as
      // attributes rather than via `document.dir` so an absent attribute shows
      // up as null instead of silently defaulting to 'ltr'.
      htmlTextDir: html.getAttribute('data-text-dir'),
      htmlDirAttribute: html.getAttribute('dir'),
      // and what the browser actually lays the root out by
      htmlComputedDirection: getComputedStyle(html).direction,
    }
  })

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  // `setLocale` loads the catalog before it commits, and `<html dir>` /
  // `data-text-dir` are written in that same commit — so polling the store's own
  // `activeLocale` is polling the exact predicate, never a sleep.
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(code)
}

const LTR_EVERYWHERE = {
  registryDirection: 'ltr',
  htmlTextDir: 'ltr',
  htmlDirAttribute: 'ltr',
  htmlComputedDirection: 'ltr',
} as const

/** an RTL locale: the text reads rtl, the layout stays ltr */
const RTL_TEXT_LTR_LAYOUT = {
  registryDirection: 'rtl',
  htmlTextDir: 'rtl',
  htmlDirAttribute: 'ltr',
  htmlComputedDirection: 'ltr',
} as const

test.describe('locale direction, round trip', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('en is ltr; ar-XB text is rtl while the layout stays ltr; en is ltr again', async ({ page }) => {
    // 1 — the starting point, asserted rather than assumed. If the app booted
    //     RTL for any reason, the rest of this test would prove nothing.
    expect(await readDirection(page)).toEqual({ activeLocale: 'en', ...LTR_EVERYWHERE })

    // 2 / 3 — the product's own locale switch into the RTL pseudo-locale: the
    //     text direction follows it, the layout direction does not
    await switchLocale(page, 'ar-XB')
    expect(await readDirection(page)).toEqual({ activeLocale: 'ar-XB', ...RTL_TEXT_LTR_LAYOUT })

    // 4 / 5 — and back. This is the half a one-way test cannot see.
    await switchLocale(page, 'en')
    expect(await readDirection(page)).toEqual({ activeLocale: 'en', ...LTR_EVERYWHERE })
  })

  test('the real ar locale takes the same path: rtl text, ltr layout, and back', async ({ page }) => {
    await switchLocale(page, 'ar')
    expect(await readDirection(page)).toEqual({ activeLocale: 'ar', ...RTL_TEXT_LTR_LAYOUT })
    await switchLocale(page, 'en')
    expect(await readDirection(page)).toEqual({ activeLocale: 'en', ...LTR_EVERYWHERE })
  })

  test('the chrome does not mirror under ar, and stays put coming back', async ({ page }) => {
    // The attributes being right is necessary but not sufficient: a stray
    // element-level `dir="rtl"` on a layout box would still mirror it. One
    // geometric witness, measured through the round trip — `.rightcol` is the
    // inspector column, which must stay on the RIGHT for every reader (the
    // fuller box comparison against en and ko is rtl-layout-fixed.spec.ts).
    const side = () =>
      page.evaluate(() => {
        const el = document.querySelector('.rightcol')
        if (!el) return null
        const r = el.getBoundingClientRect()
        // which half of the viewport its centre sits in — a coarse, stable
        // question that no font metric can flip
        return r.x + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right'
      })

    const before = await side()
    expect(before, 'the inspector column should be present at desktop width').toBe('right')

    await switchLocale(page, 'ar')
    expect(await side(), 'the inspector column should NOT change sides under ar').toBe('right')

    await switchLocale(page, 'en')
    expect(await side(), 'and still be there coming back').toBe('right')
  })

  test('ar-XB is registered but never offered in the picker', async ({ page }) => {
    // the reason `setLocale` is the transition path above: there is no row to
    // click. This is also what keeps every language-count assertion in the
    // other specs exact.
    await expect(page.locator('.lang-menu__pop [data-locale="ar-XB"]')).toHaveCount(0)
    const registered = await page.evaluate(
      () => (window as unknown as Bridge).__loop.directionOf('ar-XB'),
    )
    expect(registered).toBe('rtl')
  })
})
