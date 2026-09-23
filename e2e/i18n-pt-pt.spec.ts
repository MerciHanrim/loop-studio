import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// European Portuguese (`pt-PT`). docs/localization.md §L2.16.
//
// The second locale built as a REGION AUDIT over another one: 162 of 843
// catalog strings differ from `pt-BR`, plus 24 template labels and 5 module
// labels. Far more than the Spanish pair moved, because European and Brazilian
// Portuguese diverge in grammar as well as vocabulary.
//
// The contracts worth a real browser are the ones that can only break in the
// PRODUCT:
//   1 `pt-PT` reaches Portugal while every other Portuguese tag still reaches
//     `pt-BR` — the §L5.2 step-1-beats-step-4 contract, live
//   2 a stored `pt-PT` survives a reload, and `pt-BR` stays its own value
//   3 the picker offers both Portuguese locales, adjacent and distinguishable
//   4 the audited European words are on screen
//   5 the GROUP SEPARATOR is U+00A0 in the real DOM — this locale's NBSP comes
//     from `Intl`, not from the catalog, so only a browser can prove it
//   6 the plural selects `other` at zero, where `pt-BR` selects `one`
//   7 nothing Portugal adds overflows its box (differential against `pt-BR`)
//
// The module-label overlay is NOT retested here: `module-label-localization.spec.ts`
// already drives every shipped locale through both modules and `pt-PT` is now
// in its `SHIPPED` list, so a copy of that here would only duplicate it.

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

/** The catalog the product is actually holding for the active locale. Raw ICU
 *  source, which is what the copy contracts are about. */
async function catalog(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog as Record<
        string,
        string
      >,
  )
}

const NO_BREAK_SPACE = 160

// ------------------------------------------------------------------ 1
test.describe('the two Portuguese locales split by tag', () => {
  for (const [tag, want] of [
    ['pt-PT', 'pt-PT'],
    // `pt-BR` keeps the base subtag, so everything unregistered still lands there
    ['pt', 'pt-BR'],
    ['pt-BR', 'pt-BR'],
    ['pt-AO', 'pt-BR'],
    ['pt-MZ', 'pt-BR'],
    ['pt-CV', 'pt-BR'],
    ['pt-TL', 'pt-BR'],
    // a KNOWN RESOLVER LIMIT, pinned rather than fixed here: BCP 47 permits a
    // script subtag and `navigator.languages` returns BCP 47 tags, so this is
    // a tag a browser MAY send. Step 1 matches the whole tag only, so it falls
    // to the base owner. Normalising it is a resolver change and is
    // deliberately not mixed into a locale PR (§L2.16).
    ['pt-Latn-PT', 'pt-BR'],
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
test('a stored pt-PT survives a reload, and pt-BR stays its own value', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'pt-PT')
  expect(await stored(page)).toBe('pt-PT')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('pt-PT')

  await setLocale(page, 'pt-BR')
  expect(await stored(page)).toBe('pt-BR')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('pt-BR')
})

// ------------------------------------------------------------------ 3
test('the picker offers both Portuguese locales, adjacent and distinguishable', async ({
  page,
}) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — `Portuguese (Brazil)` sorts immediately before `Portuguese (Portugal)`
  expect(codes.slice(codes.indexOf('pt-BR'), codes.indexOf('pt-BR') + 2)).toEqual([
    'pt-BR',
    'pt-PT',
  ])
  const row = page.locator('.lang-menu__item[data-locale="pt-PT"]')
  await expect(row.locator('[lang="pt-PT"]')).toHaveText('Português (Portugal)')
  await expect(row.locator('.menu__blurb')).toHaveText('Portuguese (Portugal)')
  // the endonyms differ, so the two rows are not the same line twice
  await expect(page.locator('.lang-menu__item[data-locale="pt-BR"] [lang="pt-BR"]')).toHaveText(
    'Português (Brasil)',
  )
})

// ------------------------------------------------------------------ 4
test('the audited European words are what the product actually shows', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'pt-PT')

  await expect(
    page.locator('.toolbar__actions .menu > button').filter({ hasText: /Ficheiro/ }),
  ).toBeVisible()

  const cat = await catalog(page)
  // `prima` not `pressione`, `ligação` not `conexão`
  expect(cat['rf.edge.a11y']).toMatch(/Prima/)
  expect(cat['rf.edge.a11y']).toMatch(/ligação/)
  expect(cat['rf.edge.a11y']).not.toMatch(/conexão/)
  // `ficheiro`, `guardar`, `partilhar`, `eliminar`
  expect(cat['toolbar.file.button']).toBe('Ficheiro ▾')
  expect(cat['share.button']).toBe('Partilhar')
  expect(cat['inspector.delete']).toBe('Eliminar')
  expect(cat['author.save']).toBe('Guardar')
  // the browser tab is a `separador`, the one marker that had to differ from
  // `pt-BR`'s (`aba`)
  expect(cat['tour.help.feedbackAria']).toMatch(/separador/)
  expect(cat['tour.help.feedbackAria']).toMatch(/inglês/)
  // word-split rather than a pattern: `aba` must be absent as a WORD, and
  // writing that as a boundary escape is what put a real U+0008 into this
  // file the first time round
  expect(cat['tour.help.feedbackAria']!.toLowerCase().split(/[^a-zà-ÿ]+/)).not.toContain(
    'aba',
  )
  // `tela` is DELIBERATELY unchanged — these keys render English `canvas`, and
  // `ecrã` (a physical display) would be a mistranslation
  expect(cat['tour.desktop.canvas.title']).toBe('Tela')
})

// ------------------------------------------------------------------ 5
test('the group separator is a NO-BREAK SPACE in the real DOM', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'pt-PT')

  // MEASURED: `Intl.NumberFormat('pt-PT')` groups with U+00A0 where `pt-BR`
  // uses a period. Nothing calls `Intl.NumberFormat` directly (§L8) — a number
  // reaches the screen through ICU `#`, which delegates to exactly this
  // formatter with the locale CODE.
  //
  // HONEST LIMIT, stated rather than papered over: no product surface can show
  // a four-digit count today — every `#` key counts nodes, rows or tables, and
  // reaching 1000 of any of them is not a state a spec can set up cheaply. So
  // this renders the SAME formatter the ICU path uses, in the SAME page, for
  // the live `<html lang>`, and puts the result in the DOM to prove the
  // character survives there. It does not claim to exercise a product call site.
  const probe = await page.evaluate(() => {
    const lang = document.documentElement.lang
    const el = document.createElement('span')
    el.id = 'nbsp-probe'
    el.textContent = new Intl.NumberFormat(lang).format(1234567)
    document.body.appendChild(el)
    const read = document.getElementById('nbsp-probe')!.textContent ?? ''
    el.remove()
    return { lang, read, codes: [...read].map((c) => c.codePointAt(0)!) }
  })
  expect(probe.lang).toBe('pt-PT')
  expect(probe.read).not.toContain('1.234.567')
  expect(probe.codes[1], 'group separator code point').toBe(NO_BREAK_SPACE)
  expect(probe.codes[5], 'second group separator code point').toBe(NO_BREAK_SPACE)

  // CLDR gives pt-PT `minimumGroupingDigits: 2`, so a bare thousand carries no
  // separator at all where pt-BR writes `1.000`
  expect(
    await page.evaluate(() => new Intl.NumberFormat(document.documentElement.lang).format(1000)),
  ).toBe('1000')

  await setLocale(page, 'pt-BR')
  const br = await page.evaluate(() => ({
    big: new Intl.NumberFormat(document.documentElement.lang).format(1234567),
    thousand: new Intl.NumberFormat(document.documentElement.lang).format(1000),
  }))
  expect(br.big).toBe('1.234.567')
  expect(br.thousand).toBe('1.000')
  expect([...br.big].some((c) => c.codePointAt(0) === NO_BREAK_SPACE)).toBe(false)

  // and the catalog itself never writes the character — it only ever arrives
  // from the formatter
  await setLocale(page, 'pt-PT')
  const cat = await catalog(page)
  const typed = Object.keys(cat).filter((k) =>
    [...cat[k]!].some((c) => c.codePointAt(0) === NO_BREAK_SPACE),
  )
  expect(typed).toEqual([])
})

// ------------------------------------------------------------------ 6
test('the plural selects `other` at zero, where pt-BR selects `one`', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  await setLocale(page, 'pt-PT')
  const ptRules = await page.evaluate(() => {
    const lang = document.documentElement.lang
    const pr = new Intl.PluralRules(lang)
    return { lang, zero: pr.select(0), one: pr.select(1), million: pr.select(1e6) }
  })
  await setLocale(page, 'pt-BR')
  const brRules = await page.evaluate(() => {
    const lang = document.documentElement.lang
    const pr = new Intl.PluralRules(lang)
    return { lang, zero: pr.select(0), one: pr.select(1), million: pr.select(1e6) }
  })

  // the real Chromium ICU, for the live locale, not a table copied into a test
  expect(ptRules).toEqual({ lang: 'pt-PT', zero: 'other', one: 'one', million: 'many' })
  expect(brRules).toEqual({ lang: 'pt-BR', zero: 'one', one: 'one', million: 'many' })

  // and the arms the selection lands on really are different sentences, so the
  // split is visible to a reader and not just to CLDR
  await setLocale(page, 'pt-PT')
  const cat = await catalog(page)
  const rowCount = cat['import.refresh.rowCount']!
  // substring, not a pattern: the arms are exact ICU source, and a regex here
  // would only add escapes for no extra strength
  expect(rowCount).toContain('one {# linha}')
  expect(rowCount).toContain('other {# linhas}')
  // and pt-BR writes the SAME two arms, so it really is the selection that
  // differs and not the wording
  await setLocale(page, 'pt-BR')
  const brRowCount = (await catalog(page))['import.refresh.rowCount']!
  expect(brRowCount).toContain('one {# linha}')
  expect(brRowCount).toContain('other {# linhas}')
})

// ------------------------------------------------------------------ 7
test('nothing European Portuguese adds overflows its box', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  const measure = async () =>
    page.locator('.menu__blurb, .palette__desc, .hint__body').evaluateAll((els) =>
      els
        .map((e) => {
          const el = e as HTMLElement
          return { text: (el.textContent ?? '').slice(0, 40), over: el.scrollHeight - el.clientHeight }
        })
        .filter((r) => r.over > 1),
    )

  await setLocale(page, 'pt-BR')
  const br = await measure()
  await setLocale(page, 'pt-PT')
  const pt = await measure()

  // differential, not absolute: `pt-BR` is the baseline this locale was
  // audited from, so the contract is that Portugal adds no NEW overflow
  expect(pt.length, JSON.stringify(pt)).toBeLessThanOrEqual(br.length)
})
