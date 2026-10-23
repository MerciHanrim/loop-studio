import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L8 — where a percentage puts its sign, measured in the
// REAL DOM rather than in the catalog.
//
// `percentContract.test.ts` pins the catalog strings; it cannot see what the
// browser does with them. What only a browser can answer: in the shipped
// languages the sign touches the number, and it still does inside a
// right-to-left paragraph.
//
// §L2.0 (2026-10): the two tests that measured a retired language's own affix —
// the no-break space of `fr` / `de` / `es-ES` / `ru`, and Turkish's sign-first
// order — were retired with those languages. The eighteen-locale version is
// kept in archive/i18n/e2e/percent-affix.spec.ts.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** Render one catalog string with a real `{pct}`, inside a box narrow enough
 *  that the browser must wrap it, and report what the layout did. */
async function measure(page: Page, key: string, pct: number) {
  return await page.evaluate(
    ({ key, pct }) => {
      // The store exposes the active CATALOG, not a formatter. These two keys
      // carry a single `{pct}` slot, so substituting it is exactly what the
      // product's formatter does — and it keeps the measurement about the
      // catalog string's own affix rather than about ICU.
      const state = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
      const raw: string = (state.activeCatalog as Record<string, string>)[key]
      const text = raw.split('{pct}').join(String(pct))
      const host = document.createElement('div')
      // a width that fits roughly one word: any breakable space WILL break here
      host.style.cssText =
        'position:fixed;left:0;top:0;width:58px;font:14px/1.2 sans-serif;visibility:hidden;'
      const span = document.createElement('span')
      span.textContent = text
      host.appendChild(span)
      document.body.appendChild(host)
      // client rects: one per rendered line
      const lines = [...span.getClientRects()].map((r) => Math.round(r.top))
      const lineCount = new Set(lines).size
      // which line does the digit sit on, and which the sign?
      const range = document.createRange()
      const node = span.firstChild as Text
      const i = text.indexOf('%')
      const digitIndex = text.search(/\d/)
      const lineOf = (idx: number) => {
        range.setStart(node, idx)
        range.setEnd(node, idx + 1)
        return Math.round(range.getBoundingClientRect().top)
      }
      const signLine = i >= 0 ? lineOf(i) : -1
      const digitLine = digitIndex >= 0 ? lineOf(digitIndex) : -1
      const gapChar = i > 0 ? text.charCodeAt(i - 1) : -1
      const afterSign = i >= 0 && i + 1 < text.length ? text.charCodeAt(i + 1) : -1
      host.remove()
      return {
        text,
        lineCount,
        signOnSameLineAsNumber: signLine === digitLine,
        signIndex: i,
        digitIndex,
        codePointBeforeSign: gapChar,
        codePointAfterSign: afterSign,
      }
    },
    { key, pct },
  )
}

test('the locales with no gap keep the sign touching the number', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  // Both shipped languages (en, ko) put the sign after the number with no gap.
  // `ar-XB`, the RTL pseudo-locale, stands for the retired `ar` (§L2.0,
  // 2026-10): its catalogue is `en` verbatim, so the string substituted into is
  // a plain `{pct}%`, and what is measured is that the sign still touches the
  // number inside an RTL paragraph (the measuring box inherits `<html dir>`).
  for (const code of ['en', 'ko', 'ar-XB'] as const) {
    await setLocale(page, code)
    const m = await measure(page, 'playbar.mc.progress', 84)
    expect(m.signIndex, `${code}: ${m.text}`).toBeGreaterThan(m.digitIndex)
    expect(m.codePointBeforeSign, `${code}: a digit must sit immediately before the sign`)
      .toBeGreaterThanOrEqual(0x30)
    expect(m.signOnSameLineAsNumber, `${code}: ${JSON.stringify(m.text)}`).toBe(true)
  }
})
