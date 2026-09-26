import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// The Tier-1 toolbar row, measured in EVERY shipped locale.
//
// WHY THIS FILE EXISTS. `src/components/toolbar/toolbarOverflow.test.ts` pins
// the collapse ARITHMETIC against metrics lifted by hand from the running app,
// and it has carried exactly three locales — EN, KO and JA — since it was
// written. That is a real gap: `ru`, `fr` and `pt-PT` all produce a wider row
// than any of the three, and nothing measured them. Adding invented numbers to
// that file would have made it look covered without measuring anything, so the
// per-locale coverage lives HERE, where the width is read off the real DOM.
//
// ONE TEST PER LOCALE, never one test looping the list. The locale sweep in
// `descriptive-copy-wrapping.spec.ts` was a single test whose cost grew with
// the shipped set; at fifteen locales it timed out on CI without reaching an
// assertion. Each case here costs about a second, whatever the locale count.
//
// The assertion is a DIFFERENTIAL against English, measured in the same test
// and the same viewport. The absolute row count depends on the window — at the
// e2e viewport English itself already wraps — so what must hold is that a
// TRANSLATION does not make it worse than its source, plus the two absolutes
// that are locale-independent: nothing clipped, and no horizontal scroll.
//
// Measured baseline for the Tier-1 button row at 1280px, taken while adding
// Italian: `ko` 536 · `vi` 579 · `tr` 588 · `en` 603 · `de` 648 · `fr` 690 ·
// `pt-PT` 690 · `ru` 707. Russian is the high-water mark and the row holds it,
// so a new locale only becomes a new case above that. No pixel number is
// asserted here — a width that is fine on one viewport is not on another, and
// what a reader actually sees is whether anything is cut off.

const SHIPPED = [
  'en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'it',
  'es-419', 'pt-BR', 'es-ES', 'pt-PT', 'ru', 'tr', 'th', 'vi',
] as const

type Loop = Record<string, { getState: () => any }>

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

const measureRow = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector('.toolbar__actions') as HTMLElement | null
    if (!row) return null
    const buttons = [...row.querySelectorAll('button')].filter((b) => (b as HTMLElement).offsetParent)
    const tops = [...new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))]
    return {
      rows: tops.length,
      sumButtonWidth: Math.round(buttons.reduce((a, b) => a + b.getBoundingClientRect().width, 0)),
      overflowsRow: row.scrollWidth > row.clientWidth + 1,
      clipped: buttons
        .filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1)
        .map((b) => (b.textContent ?? '').trim().slice(0, 28)),
      labels: buttons.map((b) => (b.textContent ?? '').trim()).filter((t) => t.length > 2),
    }
  })

for (const code of SHIPPED) {
  test(`${code}: the Tier-1 toolbar row is no worse than English, and clips nothing`, async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)

    const enM = await measureRow(page)
    expect(enM, '.toolbar__actions must exist').not.toBeNull()
    expect(
      enM!.labels.length,
      'no labelled buttons found — the sweep would be measuring nothing',
    ).toBeGreaterThan(3)

    if (code === 'en') {
      expect(enM!.clipped, 'English itself must not clip').toEqual([])
      expect(enM!.overflowsRow, 'English itself must not scroll').toBe(false)
      return
    }

    await setLocale(page, code)
    const m = (await measureRow(page))!

    expect(m.clipped, `${code}: a toolbar label is clipped`).toEqual([])
    expect(m.overflowsRow, `${code}: the actions row scrolls horizontally`).toBe(false)
    expect(m.rows, `${code}: wraps to more rows than English does`).toBeLessThanOrEqual(enM!.rows)
    expect(m.labels.length, `${code}: lost a labelled button`).toBeGreaterThanOrEqual(
      enM!.labels.length - 1,
    )
  })
}
