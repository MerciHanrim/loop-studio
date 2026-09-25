import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L8 — where a percentage puts its sign, measured in the
// REAL DOM rather than in the catalog.
//
// `percentContract.test.ts` pins the catalog strings; it cannot see what the
// browser does with them. Two things only a browser can answer:
//
//   1 `fr` / `de` / `es-ES` / `ru` set a NO-BREAK space before the sign. The
//     point of that character is that the number and the `%` never land on
//     different lines. This measures exactly that, in a box narrow enough to
//     force a wrap — the check the four-character `fr` / `de` fix was made for.
//   2 `tr` puts the sign FIRST with nothing between. This measures the order
//     and the absence of any space character, by code point.

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

const NBSP = 0x00a0
const SPACE = 0x0020
const NNBSP = 0x202f

test('a no-break space keeps the number and the sign on one line', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  for (const code of ['fr', 'de', 'es-ES', 'ru'] as const) {
    await setLocale(page, code)
    for (const key of ['playbar.mc.progress', 'runbar.mc.cancel'] as const) {
      const m = await measure(page, key, 84)
      // the box is narrow on purpose — the string really does wrap
      expect(m.lineCount, `${code} ${key} should wrap in a 58px box: ${m.text}`).toBeGreaterThan(1)
      // …and yet the number and the sign stay together
      expect(
        m.signOnSameLineAsNumber,
        `${code} ${key} split the number from the sign: ${JSON.stringify(m.text)}`,
      ).toBe(true)
      // the character between them is U+00A0, not a plain or narrow space
      expect(m.codePointBeforeSign, `${code} ${key} gap code point`).toBe(NBSP)
      expect(m.codePointBeforeSign).not.toBe(SPACE)
      expect(m.codePointBeforeSign).not.toBe(NNBSP)
    }
  }
})

test('Turkish puts the sign immediately before the number, with no space', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')

  for (const key of ['playbar.mc.progress', 'runbar.mc.cancel'] as const) {
    const m = await measure(page, key, 84)
    // order: the sign comes first
    expect(m.signIndex, `${key}: ${m.text}`).toBeLessThan(m.digitIndex)
    // and it touches the number — no space of any kind between them
    expect(m.signIndex + 1, `${key}: the sign must touch the number`).toBe(m.digitIndex)
    for (const bad of [SPACE, NBSP, NNBSP]) {
      expect(m.codePointAfterSign, `${key} char after the sign`).not.toBe(bad)
    }
    // whatever the box does, the two never separate because nothing separates them
    expect(m.signOnSameLineAsNumber, `${key}: ${JSON.stringify(m.text)}`).toBe(true)
  }
})

test('the locales with no gap keep the sign touching the number', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  for (const code of ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'es-419', 'pt-BR', 'pt-PT', 'th'] as const) {
    await setLocale(page, code)
    const m = await measure(page, 'playbar.mc.progress', 84)
    expect(m.signIndex, `${code}: ${m.text}`).toBeGreaterThan(m.digitIndex)
    expect(m.codePointBeforeSign, `${code}: a digit must sit immediately before the sign`)
      .toBeGreaterThanOrEqual(0x30)
    expect(m.signOnSameLineAsNumber, `${code}: ${JSON.stringify(m.text)}`).toBe(true)
  }
})
