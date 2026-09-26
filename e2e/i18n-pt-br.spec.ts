import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Brazilian Portuguese (`pt-BR`). docs/localization.md §L2.14 (the locale's own
// decisions), §L5.2 step 4 (`baseFallbackFor`), §L2.11 (`caractere` vs
// `coluna`).
//
// `pt-BR` is the NINTH shipped language and the third — after Chinese and
// Spanish — whose code is not its own base subtag. A browser sends `pt`,
// `pt-BR`, `pt-PT`, `pt-AO`. Measured with the real resolver before this
// locale existed, every one of those resolved to English — and two multi-tag
// lists resolved to an unrelated language outright (`["pt-AO","de-DE"]` gave
// German, `["pt","es-MX"]` gave Spanish). Section 1 pins the half a browser
// can express.
//
//   1 every Portuguese tag a browser sends reaches pt-BR, in tag order
//   2 the other shipped locales are untouched (invariance)
//   3 a stored `pt-BR` survives a reload; a region tag is not a code
//   4 the picker offers Português (Brasil), tagged with its own language
//   5 the search box finds it by endonym, English name and code
//   6 the template-label dictionary loads — Portuguese labels, not English
//   7 Portuguese typography (ã õ ç á é í ó ú ê ô) reaches the DOM as exact
//     codepoints, on the bundled Latin subset, with the plural `de` rule held
//   8 nothing Portuguese adds overflows its box (differential against English)
//
// No baseline image: fonts, wrapping and overflow are pinned by measurement.

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

async function openLanguageMenu(page: Page, scope = '') {
  const trigger = page.locator(`${scope} .lang-switch`.trim()).first()
  if (!scope && !(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__settingsmenu > button').click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  return trigger
}

const pop = (page: Page, scope = '') => page.locator(`${scope} .lang-menu__pop`.trim())
const search = (page: Page, scope = '') =>
  page.locator(`${scope} .lang-menu__pop .lang-menu__search`.trim())
const options = (page: Page, scope = '') =>
  page.locator(`${scope} .lang-menu__pop [role="option"]`.trim())
const option = (page: Page, code: string, scope = '') =>
  page.locator(`${scope} .lang-menu__pop .lang-menu__item[data-locale="${code}"]`.trim())

// ------------------------------------------------------------------ 1
test.describe('a Portuguese browser', () => {
  // Brazil and the African Portuguese-speaking regions reach this catalog.
  //
  // `pt-PT` USED TO BE on this list and has now flipped, exactly as the comment
  // here predicted it would: registering European Portuguese gave it its own
  // tag through §L5.2 step 1, which beats step 4. That was intentional
  // staleness, not a defect — the same arc `es-ES` had in
  // `i18n-es-419.spec.ts`. The rows below NEVER flip, which is why a new
  // locale spec must probe with a tag that will never be registered.
  for (const [tag, note] of [
    ['pt', 'the bare language subtag — pt-BR still owns the base'],
    ['pt-BR', 'the registered code itself'],
    ['pt-AO', 'stays here permanently'],
    ['pt-MZ', 'stays here permanently'],
    ['pt-CV', 'stays here permanently'],
    ['pt-TL', 'stays here permanently'],
  ] as const) {
    test(`${tag} reaches Portuguese, not English — ${note}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe('pt-BR')
      await ctx.close()
    })
  }

  // §L5.2's per-TAG ordering is NOT asserted here on purpose: a Playwright
  // context carries ONE `locale`, so a browser test cannot express a
  // multi-entry `navigator.languages`. That contract is pinned where it can be
  // expressed honestly — against the production pure function, in
  // `src/i18n/registry.test.ts`.
})

// ------------------------------------------------------------------ 2
test.describe('the other shipped locales are unaffected', () => {
  for (const [tag, want] of [
    ['en-US', 'en'],
    ['ko-KR', 'ko'],
    ['ja-JP', 'ja'],
    ['zh-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['fr-FR', 'fr'],
    ['de-DE', 'de'],
    ['es-MX', 'es-419'],
    // the unregistered probe: Dutch is on no roadmap entry, so it will not
    // quietly become registered the way `de-DE` did for `fr`
    // `qaa` — ISO 639-2 reserves `qaa`-`qtz` for LOCAL USE, so this tag can
    // never become a real language and can never become registered here. It
    // replaces `nl-NL`, which was the probe until Dutch went on the roadmap:
    // a probe tag has to be one the product will never support. MEASURED —
    // `Intl.getCanonicalLocales('qaa')` is `['qaa']`, `Intl.NumberFormat`
    // accepts it, and it resolves to `en` both today and with `it` + `nl`
    // registered. (`en-x-probe` would ALSO resolve to `en`, but through the
    // step-3 base match on `en` rather than the fallback — it would pass
    // while proving nothing, so it is not used.)
    ['qaa', 'en'],
  ] as const) {
    test(`${tag} still reaches ${want}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe(want)
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 3
test('a stored pt-BR survives a reload; a region tag is not a code', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'pt-BR')
  expect(await stored(page)).toBe('pt-BR')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('pt-BR')

  // `pt-PT` is now a REGISTERED code, so it no longer serves as the unregistered
  // stored value this test needs. `pt-AO` does, and it never will be
  // registered — which is the point of probing with a tag off the roadmap.
  // An unregistered stored value is ignored outright, never repaired into a
  // fallback (§L5.2 step 1), even though `pt-AO` as a NAVIGATOR tag reaches
  // `pt-BR` perfectly well.
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'pt-AO'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
})

// ------------------------------------------------------------------ 4
test('the picker offers Português (Brasil), tagged as its own language', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const row = pop(page).locator('.lang-menu__item').filter({ hasText: 'Português (Brasil)' })
  await expect(row, 'the picker must offer Portuguese').toHaveCount(1)
  const tagged = row.locator('[lang="pt-BR"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('Português (Brasil)')
  await expect(row.locator('.menu__blurb')).toHaveText('Portuguese (Brazil)')

  await row.click()
  await expect.poll(() => htmlLang(page)).toBe('pt-BR')
  expect(await stored(page)).toBe('pt-BR')
  await expect(page.locator('.toolbar__settingsmenu > button')).toHaveText('Configurações ▾')
})

// ------------------------------------------------------------------ 5
test.describe('the language search box finds Portuguese', () => {
  test('by endonym, English name and code — accents optional', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await expect(options(page)).toHaveCount(17) // 16 shipped + the dev pseudo-locale

    for (const q of [
      'Português',
      'portugues',
      'PORTUGUES',
      'Brasil',
      'brasil',
      'Brazil',
      'pt-BR',
      'pt',
    ]) {
      await search(page).fill(q)
      await expect(
        option(page, 'pt-BR'),
        `query ${JSON.stringify(q)} must find Portuguese`,
      ).toHaveCount(1)
    }

    await search(page).fill('zzzz')
    await expect(options(page)).toHaveCount(0)
  })

  test('is findable from every shipped UI language, by its name there', async ({ page }) => {
    await openApp(page)
    // The word a user would actually type, in each UI language. Written by
    // hand on purpose: deriving it from the catalog would only prove that the
    // catalog equals itself.
    const NAMES = [
      ['en', 'Portuguese'],
      ['ko', '포르투갈어'],
      ['ja', 'ポルトガル語'],
      ['zh-Hans', '葡萄牙语'],
      ['zh-Hant', '葡萄牙文'],
      ['fr', 'Portugais'],
      ['de', 'Portugiesisch'],
      ['it', 'Portoghese (Brasile)'],
      ['es-419', 'Portugués'],
      ['pt-BR', 'Português'],
      ['es-ES', 'Portugués'],
      ['pt-PT', 'Português'],
      ['ru', 'Португальский'],
      ['tr', 'Portekizce'],
      ['th', 'โปรตุเกส'],
      ['vi', 'Bồ Đào Nha'],
    ] as const

    // EXHAUSTIVE, and checked against the product rather than against a
    // comment. This table froze at the nine languages that shipped with
    // `pt-BR` while its NAME claimed every shipped UI language. The picker is
    // the source of truth, so the next locale makes this red until its row
    // exists.
    await openLanguageMenu(page)
    const shipped = (
      await options(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
    ).filter((c) => c !== 'en-XA')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(NAMES.map(([ui]) => ui).slice().sort()).toEqual(shipped.slice().sort())

    for (const [ui, query] of NAMES) {
      await setLocale(page, ui)
      await openLanguageMenu(page)
      await search(page).fill(query)
      await expect(
        option(page, 'pt-BR'),
        `${ui}: "${query}" must find Portuguese`,
      ).toHaveCount(1)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
  })
})

// ------------------------------------------------------------------ 6
test('a bundled Template opens with Portuguese node labels', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'pt-BR')
  await page
    .locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: 'Templates ▾' }) })
    .getByRole('button', { name: 'Templates ▾' })
    .click()
  await page.locator('.menu__name', { hasText: 'Linha de produção equilibrada' }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim()),
      ),
    )
    .toContain('Fornecimento de material')
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim()),
  )
  expect(titles, 'the dictionary loaded, so no English canonical is left').not.toContain(
    'Material supply',
  )
  expect(titles).toContain('Processamento')
  expect(titles).toContain('Refugo')
})

// ------------------------------------------------------------------ 7
test('Portuguese typography reaches the DOM as exact codepoints, on the bundled font', async ({
  page,
}) => {
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await openApp(page)
  await resetAll(page)
  const before = fonts.length
  await setLocale(page, 'pt-BR')

  const text = await page.evaluate(() => document.body.innerText)
  const present = [...'ãõçáéíóúêôÃÕÇ'].filter((ch) => text.includes(ch))
  expect(present.length, 'the Portuguese chrome renders its diacritics').toBeGreaterThan(0)
  // no word was silently de-accented
  expect(text, 'accents are not stripped').not.toContain('Configuracoes')
  expect(text, 'the settings button carries its diacritics').toContain('Configurações')

  // The plural contract, read from the CATALOG the product is running on
  // rather than restated as a constant: `Intl.PluralRules('pt-BR')` has a
  // `many` category reachable at 1e6, and Portuguese puts `de` before the noun
  // there (`1.000.000 de linhas`). Every plural must carry that arm.
  const plurals = await page.evaluate(() => {
    const st = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
    const cat = st.activeCatalog as Record<string, string>
    const all = Object.entries(cat).filter(([, v]) => typeof v === 'string')
    const withPlural = all.filter(([, v]) => /,\s*plural\s*,/.test(v))
    return {
      locale: st.activeLocale,
      total: withPlural.length,
      withMany: withPlural.filter(([, v]) => /\bmany\s*\{/.test(v)).length,
      missing: withPlural.filter(([, v]) => !/\bmany\s*\{/.test(v)).map(([k]) => k),
      zeroIsOne: new Intl.PluralRules('pt-BR').select(0),
      millionIsMany: new Intl.PluralRules('pt-BR').select(1e6),
    }
  })
  expect(plurals.locale).toBe('pt-BR')
  expect(plurals.total, 'the Portuguese catalog has plurals').toBeGreaterThan(0)
  expect(plurals.withMany, `every plural needs a many arm — ${JSON.stringify(plurals.missing)}`).toBe(
    plurals.total,
  )
  // the two CLDR facts the arms exist for, measured in the real runtime
  expect(plurals.zeroIsOne, 'pt-BR puts 0 in `one`, unlike es-419').toBe('one')
  expect(plurals.millionIsMany, '`many` is reachable').toBe('many')

  // every diacritic must come from the bundled Latin subset — no extra font
  // request is made when the locale switches
  expect(fonts.length, 'switching to Portuguese requests no new font file').toBe(before)
})

// ------------------------------------------------------------------ 8
test('Portuguese adds no overflow of its own', async ({ page }) => {
  // Differential, not absolute: the sweep runs in English first, then in
  // Portuguese, and only what PORTUGUESE adds is a failure. Rows that already
  // overflow in English are pre-existing and out of this locale's scope.
  const sweep = () =>
    page.evaluate(() => {
      const rows: { sel: string; text: string; ovX: number; ovY: number }[] = []
      const sels = ['.menu__blurb', '.palette-tip__desc', '.nodef__title', '.toolbar__actions button', '.lang-menu__item']
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const e = el as HTMLElement
          if (e.offsetParent === null && e.clientWidth === 0) continue
          rows.push({
            sel,
            text: (e.textContent ?? '').trim().slice(0, 30),
            ovX: e.scrollWidth - e.clientWidth,
            ovY: e.scrollHeight - e.clientHeight,
          })
        }
      }
      return rows
    })

  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'en')
  await page.locator('.toolbar__settingsmenu > button').click()
  const en = await sweep()
  await page.keyboard.press('Escape')

  await setLocale(page, 'pt-BR')
  await page.locator('.toolbar__settingsmenu > button').click()
  const pt = await sweep()
  await page.keyboard.press('Escape')

  const key = (r: { sel: string; ovX: number; ovY: number }) => `${r.sel}`
  const enOver = new Set(en.filter((r) => r.ovX > 0 || r.ovY > 0).map(key))
  const added = pt.filter((r) => (r.ovX > 0 || r.ovY > 0) && !enOver.has(key(r)))
  expect(added, `Portuguese-only overflow: ${JSON.stringify(added)}`).toEqual([])
})
