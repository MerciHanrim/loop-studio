import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Spain Spanish (`es-ES`). docs/localization.md §L2.15.
//
// This is the first locale that is a REGION AUDIT over another one rather than
// a new translation: 12 of 841 catalog strings differ from `es-419`, plus 4
// template labels and 2 module labels. So the contracts worth a browser are
// the ones that could only break in the PRODUCT — the resolver split, the
// formatter agreement, and that the two Spanish locales really are distinct
// selectable things.
//
//   1 `es-ES` reaches Spain Spanish while every other Spanish tag still
//     reaches `es-419` — the §L5.2 step-1-beats-step-4 contract, live
//   2 a stored `es-ES` survives a reload
//   3 the picker offers both Spanish locales, adjacent and distinguishable
//   4 the audited words are on screen (`ordenador`, `pulse`, `escriba`)
//   5 the percent gap is a NO-BREAK SPACE in the real DOM, and does not wrap
//   6 the accessible name carries the same gap
//   7 the template + module labels that differ do differ, in the product
//   8 nothing Spain adds overflows its box (differential against `es-419`)

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

async function openLanguageMenu(page: Page) {
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__settingsmenu > button').click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape')
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

const NO_BREAK_SPACE = 160

// ------------------------------------------------------------------ 1
test.describe('the two Spanish locales split by tag', () => {
  for (const [tag, want] of [
    ['es-ES', 'es-ES'],
    ['es', 'es-419'],
    ['es-MX', 'es-419'],
    ['es-AR', 'es-419'],
    ['es-US', 'es-419'],
    // a stated trade-off, not an oversight: nothing here is written for
    // Equatorial Guinea either way (§L2.15)
    ['es-GQ', 'es-419'],
    // Catalan, Basque and Galician are not Spanish and must not be captured
    ['ca-ES', 'en'],
    ['eu-ES', 'en'],
  ] as const) {
    test(`${tag} reaches ${want}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe(want)
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 2
test('a stored es-ES survives a reload, and es-419 stays its own value', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-ES')
  expect(await stored(page)).toBe('es-ES')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('es-ES')

  await setLocale(page, 'es-419')
  expect(await stored(page)).toBe('es-419')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('es-419')
})

// ------------------------------------------------------------------ 3
test('the picker offers both Spanish locales, adjacent and distinguishable', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — `Spanish (Latin America)` sorts immediately before `Spanish (Spain)`
  expect(codes.slice(codes.indexOf('es-419'), codes.indexOf('es-419') + 2)).toEqual([
    'es-419',
    'es-ES',
  ])
  const row = page.locator('.lang-menu__item[data-locale="es-ES"]')
  await expect(row.locator('[lang="es-ES"]')).toHaveText('Español (España)')
  await expect(row.locator('.menu__blurb')).toHaveText('Spanish (Spain)')
  // the endonyms differ, so the two rows are not the same line twice
  await expect(page.locator('.lang-menu__item[data-locale="es-419"] [lang="es-419"]')).toHaveText(
    'Español (Latinoamérica)',
  )
})

// ------------------------------------------------------------------ 4
test('the audited Spain words are what the product actually shows', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-ES')
  const cat = await page.evaluate(
    () =>
      (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog as Record<
        string,
        string
      >,
  )
  expect(cat['mobile.topbar.caption']).toContain('ordenador')
  expect(cat['mobile.topbar.caption']).not.toContain('computadora')
  expect(cat['import.issueSummaryStale']).toContain('pulse')
  expect(cat['stateExpr.activator.hint.empty']).toContain('escriba')
  // and the user-typed example is untouched
  expect(cat['inspector.edge.flowPlaceholder']).toContain('25%')
})

// ------------------------------------------------------------------ 5 + 6
test('the percent gap is a NO-BREAK SPACE in the DOM, and does not wrap', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-ES')

  const probe = await page.evaluate((nbsp) => {
    const st = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
    const cat = st.activeCatalog as Record<string, string>
    const text = cat['playbar.mc.progress'].replace('{pct}', '43')
    // render it into a real, narrow box and ask the engine where the lines are
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:62px;font:inherit'
    el.textContent = text
    document.body.appendChild(el)
    const r = new Range()
    const node = el.firstChild as Text
    const rects: number[] = []
    for (let i = 0; i < text.length; i++) {
      r.setStart(node, i)
      r.setEnd(node, i + 1)
      rects.push(Math.round(r.getBoundingClientRect().top))
    }
    const pctIndex = text.indexOf('%')
    const out = {
      text,
      gapCodePoint: text.codePointAt(pctIndex - 1),
      lines: new Set(rects).size,
      // the digit before the gap and the `%` must share a line
      digitTop: rects[pctIndex - 2],
      pctTop: rects[pctIndex],
    }
    el.remove()
    return { ...out, nbsp }
  }, NO_BREAK_SPACE)

  expect(probe.gapCodePoint, 'the gap before % is U+00A0').toBe(NO_BREAK_SPACE)
  expect(probe.lines, 'the box is narrow enough to force a wrap somewhere').toBeGreaterThan(1)
  expect(probe.pctTop, 'the number and the % stay on the same line').toBe(probe.digitTop)

  // the accessible name of the progress control keeps the same gap
  const aria = await page.evaluate((nbsp) => {
    const st = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
    const cat = st.activeCatalog as Record<string, string>
    const s = cat['runbar.mc.cancel'].replace('{pct}', '43')
    return { s, gap: s.codePointAt(s.indexOf('%') - 1), nbsp }
  }, NO_BREAK_SPACE)
  expect(aria.gap, 'the run-bar string keeps the NO-BREAK SPACE too').toBe(NO_BREAK_SPACE)
})

// ------------------------------------------------------------------ 7
test('the labels that differ from es-419 differ in the product', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-ES')
  await page
    .locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: 'Plantillas ▾' }) })
    .getByRole('button', { name: 'Plantillas ▾' })
    .click()
  await page.locator('.menu__name', { hasText: 'Progresión temprana de MMO' }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim()),
      ),
    )
    .toContain('Puntuación de equipo')
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim()),
  )
  expect(titles, 'the Latin American score word must not appear here').not.toContain(
    'Puntaje de equipo',
  )
})

// ------------------------------------------------------------------ 8
test('Spain adds no overflow of its own, measured against es-419', async ({ page }) => {
  const sweep = () =>
    page.evaluate(() => {
      const rows: { sel: string; ovX: number; ovY: number }[] = []
      for (const sel of ['.menu__blurb', '.palette-tip__desc', '.toolbar__actions button']) {
        for (const el of document.querySelectorAll(sel)) {
          const e = el as HTMLElement
          if (e.offsetParent === null && e.clientWidth === 0) continue
          rows.push({ sel, ovX: e.scrollWidth - e.clientWidth, ovY: e.scrollHeight - e.clientHeight })
        }
      }
      return rows
    })

  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-419')
  await page.locator('.toolbar__settingsmenu > button').click()
  const base = await sweep()
  await page.keyboard.press('Escape')

  await setLocale(page, 'es-ES')
  await page.locator('.toolbar__settingsmenu > button').click()
  const mine = await sweep()
  await page.keyboard.press('Escape')

  const over = new Set(base.filter((r) => r.ovX > 0 || r.ovY > 0).map((r) => r.sel))
  const added = mine.filter((r) => (r.ovX > 0 || r.ovY > 0) && !over.has(r.sel))
  expect(added, `Spain-only overflow: ${JSON.stringify(added)}`).toEqual([])
})
