import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.2 — the ONE direction path, verified end to end as a
// ROUND TRIP: ltr → rtl → ltr.
//
// Three values must agree at every stop, and they are deliberately three
// different layers of the same fact:
//   * `activeLocale`   — what the i18n store committed
//   * `directionOf(…)` — what the registry says that locale reads as, and what
//                        every element-level `dir` attribute in the app reads
//   * `<html dir>`     — what `applyHtml` wrote, i.e. what the browser lays out by
//
// Why a round trip rather than a one-way switch. A one-way `en → ar-XB` test
// passes in two broken worlds: one where the initial render was already RTL (so
// nothing actually changed), and one where direction is set once and then sticks
// (so nothing can ever change back). Returning to `en` and re-checking all three
// is what separates "the switch works" from "the attribute happens to be right".
//
// What this test must NOT do:
//   * write `document.dir` / `document.documentElement.dir`. The attribute is the
//     OUTPUT under test; setting it would be the test asserting its own input.
//     The direction changes here only as a consequence of a locale switch.
//   * re-derive the expected direction from the locale code. `directionOf` comes
//     from the app (the dev bridge), so a second implementation cannot drift in
//     and quietly agree with itself.
//
// Why `setLocale()` rather than clicking the picker: `ar-XB` is `enabled: false`
// (§L9.2) precisely so it is NOT offered as an eighteenth language, so there is
// no row to click. `setLocale` is the same production action the picker calls —
// `LanguageSwitch` does nothing else — so the transition under test is the real
// one, and its async catalog load is exercised too.

type Bridge = {
  __loop: {
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
    directionOf: (code: string) => 'ltr' | 'rtl'
  }
}

/** all three values, read together, so they cannot be sampled at different
 *  moments of the same transition */
const readDirection = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Bridge
    const active = w.__loop.i18n.getState().activeLocale
    return {
      activeLocale: active,
      // the registry's answer, through the app's own resolver
      registryDirection: w.__loop.directionOf(active),
      // the attribute the app WROTE. Read, never written, and read as an
      // attribute rather than via `document.dir` so an absent attribute shows up
      // as null instead of silently defaulting to 'ltr'.
      htmlDirAttribute: document.documentElement.getAttribute('dir'),
    }
  })

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  // `setLocale` loads the catalog before it commits, and `<html dir>` is written
  // in that same commit — so polling the store's own `activeLocale` is polling
  // the exact predicate, never a sleep.
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(code)
}

test.describe('locale direction, round trip', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('en is ltr, ar-XB is rtl, and en is ltr again', async ({ page }) => {
    // 1 — the starting point, asserted rather than assumed. If the app booted
    //     RTL for any reason, the rest of this test would prove nothing.
    expect(await readDirection(page)).toEqual({
      activeLocale: 'en',
      registryDirection: 'ltr',
      htmlDirAttribute: 'ltr',
    })

    // 2 / 3 — the product's own locale switch into the RTL pseudo-locale
    await switchLocale(page, 'ar-XB')
    expect(await readDirection(page)).toEqual({
      activeLocale: 'ar-XB',
      registryDirection: 'rtl',
      htmlDirAttribute: 'rtl',
    })

    // 4 / 5 — and back. This is the half a one-way test cannot see.
    await switchLocale(page, 'en')
    expect(await readDirection(page)).toEqual({
      activeLocale: 'en',
      registryDirection: 'ltr',
      htmlDirAttribute: 'ltr',
    })
  })

  test('the chrome really mirrors under ar-XB, and unmirrors coming back', async ({ page }) => {
    // The attribute agreeing with the registry is necessary but not sufficient:
    // it would also hold if nothing in the layout consumed it. One geometric
    // witness, measured through the round trip — `.rightcol` is the inspector
    // column, which swaps sides when the chrome mirrors (the PR A contract).
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
    expect(before, 'the inspector column should be present at desktop width').not.toBeNull()

    await switchLocale(page, 'ar-XB')
    const mirrored = await side()
    expect(mirrored, 'the inspector column should change sides under rtl').not.toBe(before)

    await switchLocale(page, 'en')
    expect(await side(), 'and change back').toBe(before)
  })

  test('ar-XB is registered but never offered in the picker', async ({ page }) => {
    // the reason `setLocale` is the transition path above: there is no row to
    // click. This is also what keeps every "seventeen languages plus en-XA"
    // assertion in the other specs exact.
    await expect(page.locator('.lang-menu__pop [data-locale="ar-XB"]')).toHaveCount(0)
    const registered = await page.evaluate(
      () => (window as unknown as Bridge).__loop.directionOf('ar-XB'),
    )
    expect(registered).toBe('rtl')
  })
})
