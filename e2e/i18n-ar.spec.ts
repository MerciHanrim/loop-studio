import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L8 / §L9 — Arabic, the eighteenth locale and the FIRST
// shipped one with `direction: 'rtl'`.
//
// PR B built the direction machinery and proved it with `ar-XB`, a pseudo whose
// catalog is `en` verbatim. The RTL layout contracts therefore already have
// their own specs (`e2e/rtl-*.spec.ts`) and are not repeated here.
//
// What this file adds is the thing only a REAL BROWSER can settle: which digits
// Arabic renders. `src/i18n/arNumbers.test.ts` pins the same decision in Node,
// and that is deliberately not enough — Node and the browser ship their own ICU
// data, the resolved numbering system for a bare `ar` is a property of that
// data, and only the browser's answer is what a reader sees. A green Node test
// beside a browser that had resolved `arab` would be a contract asserted on the
// wrong machine.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const htmlDir = (page: Page) => page.evaluate(() => document.documentElement.dir)

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

test.describe('ar — the Latin-digit decision, settled in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    // `resetAll` reads `window.__loop`, which only exists once the app has
    // booted — so it runs AFTER `openApp`, not before
    await openApp(page)
    await resetAll(page)
  })

  test('the browser resolves `ar` to the `latn` numbering system', async ({ page }) => {
    await setLocale(page, 'ar')
    // the locale really is the RTL one, so this is not passing on a fallback
    await expect.poll(() => htmlDir(page)).toBe('rtl')

    // The tag itself is pinned against the registry in
    // `src/i18n/arNumbers.test.ts` (`numberLocale === 'ar'`). What only this
    // browser can answer is what ITS ICU data resolves that tag to — so the tag
    // is used as a literal here rather than read back out of the store, which
    // would make the assertion depend on the same lookup it is checking.
    const resolved = await page.evaluate(() => ({
      decimal: new Intl.NumberFormat('ar').resolvedOptions().numberingSystem,
      percent: new Intl.NumberFormat('ar', { style: 'percent' }).resolvedOptions().numberingSystem,
      sample: new Intl.NumberFormat('ar').format(1234567.89),
    }))

    expect(resolved.decimal, 'the product decision is Latin digits').toBe('latn')
    expect(resolved.percent, 'percent must take the same numbering system').toBe('latn')
    // every digit in a formatted number is ASCII, checked as code points rather
    // than by comparing the whole string, which would break on a separator change
    const digits = [...resolved.sample].filter((c) => /\p{Nd}/u.test(c))
    expect(digits.length).toBeGreaterThan(0)
    for (const d of digits) expect(d.codePointAt(0)!).toBeLessThanOrEqual(0x39)
  })

  test('the alternative tags still differ, so the choice keeps meaning something', async ({ page }) => {
    // if a future browser stopped distinguishing these, "we chose `ar` over
    // `ar-EG`" would silently stop being a choice at all
    const alt = await page.evaluate(() => ({
      eg: new Intl.NumberFormat('ar-EG').resolvedOptions().numberingSystem,
      explicitArab: new Intl.NumberFormat('ar-u-nu-arab').resolvedOptions().numberingSystem,
      explicitLatn: new Intl.NumberFormat('ar-u-nu-latn').resolvedOptions().numberingSystem,
    }))
    expect(alt.eg).toBe('arab')
    expect(alt.explicitArab).toBe('arab')
    expect(alt.explicitLatn).toBe('latn')
  })

  test('a number rendered in the running UI carries ASCII digits', async ({ page }) => {
    await setLocale(page, 'ar')
    // the step readout is the smallest always-present number in the chrome
    const text = await page.locator('.pstrip__step').first().innerText()
    const digits = [...text].filter((c) => /\p{Nd}/u.test(c))
    expect(digits.length, `no digit found in ${JSON.stringify(text)}`).toBeGreaterThan(0)
    for (const d of digits) {
      expect(
        d.codePointAt(0)!,
        `the UI rendered U+${d.codePointAt(0)!.toString(16).toUpperCase()}, not an ASCII digit`,
      ).toBeLessThanOrEqual(0x39)
    }
  })
})
