import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Russian (`ru`). docs/localization.md §L2.17.
//
// The first Cyrillic catalog and the first four-arm plural. The contracts
// worth a real browser are the ones that can only break in the PRODUCT:
//   1 every `ru-*` tag reaches `ru`, and the neighbouring Cyrillic languages
//     do NOT — the §L5.2 step-3 contract, live
//   2 a stored `ru` survives a reload; only the exact code restores
//   3 the picker offers Русский, sorted and searchable in Cyrillic
//   4 the audited Cyrillic copy is on screen, and no Latin sentence is
//   5 the four plural arms render correctly at 1 / 2 / 5 / 21 / 22
//   6 the group separator and the percent gap are U+00A0 in the real DOM
//   7 Cyrillic renders in IBM Plex Sans, not a system fallback
//   8 nothing Russian adds overflows its box

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

async function catalog(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog as Record<
        string,
        string
      >,
  )
}

async function openLanguageMenu(page: Page) {
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__settingsmenu > button').click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

const NO_BREAK_SPACE = 160

// ------------------------------------------------------------------ 1
test.describe('every Russian tag reaches ru, and its neighbours do not', () => {
  for (const [tag, want] of [
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['ru-BY', 'ru'],
    ['ru-KZ', 'ru'],
    ['ru-UA', 'ru'],
    // `ru` IS its own base subtag, so step 3 splits on the first subtag and a
    // script or extension subtag reaches it too. That is exactly the case
    // `es-ES` and `pt-PT` CANNOT handle, because their codes are not base
    // subtags and only the whole-tag match could have caught them (§L2.17).
    ['ru-Cyrl', 'ru'],
    ['ru-Cyrl-RU', 'ru'],
    // neighbouring Cyrillic languages are not Russian and must not be captured
    ['uk-UA', 'en'],
    ['be-BY', 'en'],
    ['bg-BG', 'en'],
    ['kk-KZ', 'en'],
    ['sr-RS', 'en'],
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
test('a stored ru survives a reload; a regional code does not restore', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')
  expect(await stored(page)).toBe('ru')
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('ru')

  // §L5.1 is stricter than §L5.2: `ru-RU` as a NAVIGATOR tag reaches `ru`, but
  // as a STORED value it is not a registered code and is ignored outright.
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'ru-RU'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
})

// ------------------------------------------------------------------ 3
test('the picker offers Русский, in place and searchable in Cyrillic', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)

  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — `Russian` sorts between `Portuguese (Portugal)` and
  // `Spanish (Latin America)`
  expect(codes.slice(codes.indexOf('pt-PT'), codes.indexOf('pt-PT') + 3)).toEqual([
    'pt-PT',
    'ru',
    'es-419',
  ])

  const row = page.locator('.lang-menu__item[data-locale="ru"]')
  await expect(row.locator('[lang="ru"]')).toHaveText('Русский')
  await expect(row.locator('.menu__blurb')).toHaveText('Russian')

  // the search box has to match what a Russian speaker actually types
  const search = page.locator('.lang-menu__pop input')
  for (const [q, want] of [
    ['Русский', 'ru'],
    ['русск', 'ru'],
    ['Russian', 'ru'],
    ['ru', 'ru'],
  ] as const) {
    await search.fill(q)
    await expect
      .poll(async () =>
        page
          .locator('.lang-menu__pop [role="option"]')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale)),
      )
      .toContain(want)
  }
  await search.fill('')
})

// ------------------------------------------------------------------ 3b
// The `ё` fold (§L5.5), end to end. MEASURED before it existed: `foldForSearch`
// kept `ё` and `е` as different strings, so with the UI in Russian the
// Simplified Chinese row — `Китайский (упрощённый)` — could not be found by
// typing `упрощенный`, which is how the word is normally typed. Every Russian
// string here is built from code points: Cyrillic `е` / `у` / `о` are
// homoglyphs of Latin letters and a literal could not be reviewed by eye.
const SIMPLIFIED_YO = String.fromCharCode(
  0x443, 0x43f, 0x440, 0x43e, 0x449, 0x451, 0x43d, 0x43d, 0x44b, 0x439,
)
const SIMPLIFIED_E = String.fromCharCode(
  0x443, 0x43f, 0x440, 0x43e, 0x449, 0x435, 0x43d, 0x43d, 0x44b, 0x439,
)

test('in the Russian UI, the entry spelled with `ё` is found typing `е`', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')
  await openLanguageMenu(page)

  // Not vacuous: the row really is spelled with `ё`. If the copy ever drops it,
  // this fails here rather than letting the search assertion pass for the wrong
  // reason.
  const hans = page.locator('.lang-menu__item[data-locale="zh-Hans"]')
  expect(await hans.innerText()).toContain(SIMPLIFIED_YO)

  const search = page.locator('.lang-menu__pop input')
  for (const q of [SIMPLIFIED_YO, SIMPLIFIED_E]) {
    await search.fill(q)
    await expect
      .poll(async () =>
        page
          .locator('.lang-menu__pop [role="option"]')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale)),
      )
      .toContain('zh-Hans')
  }
  await search.fill('')
})

// ------------------------------------------------------------------ 4
test('the audited Cyrillic copy is what the product shows', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')

  await expect(
    page.locator('.toolbar__actions .menu > button').filter({ hasText: /Файл/ }),
  ).toBeVisible()

  const cat = await catalog(page)
  // the node-kind glossary
  expect(cat['palette.pool.name']).toBe('Накопитель')
  expect(cat['palette.register.name']).toBe('Вычисляемое значение')
  // `Регистр` would read as a CPU register — never used
  expect(Object.values(cat).some((v) => /Регистр/i.test(v))).toBe(false)
  // keycaps stay Latin, the prose around them is Russian
  expect(cat['rf.edge.a11y']).toContain('Enter')
  expect(cat['rf.edge.a11y']).toMatch(/Нажмите/)
  // the feedback markers
  expect(cat['tour.help.feedbackAria']).toMatch(/английск/i)
  expect(cat['tour.help.feedbackAria']).toMatch(/вкладк/i)
  // parser position vs table column
  expect(cat['error.EXPR_SYNTAX.message']).toMatch(/символе \{column\}/)
  expect(cat['import.loc.tableRowColumn']).toMatch(/столбец \{column\}/)
})

// ------------------------------------------------------------------ 5
test('the four plural arms render correctly', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')

  const rules = await page.evaluate(() => {
    const pr = new Intl.PluralRules(document.documentElement.lang)
    return {
      lang: document.documentElement.lang,
      categories: pr.resolvedOptions().pluralCategories.slice().sort(),
      at: [0, 1, 2, 5, 21, 22, 25, 101].map((n) => pr.select(n)),
    }
  })
  // the real Chromium ICU, for the live locale
  expect(rules.lang).toBe('ru')
  expect(rules.categories).toEqual(['few', 'many', 'one', 'other'])
  expect(rules.at).toEqual(['many', 'one', 'few', 'many', 'one', 'few', 'many', 'one'])

  // and the arms really are four different sentences, so the split is visible
  const cat = await catalog(page)
  const rowCount = cat['import.refresh.rowCount']!
  expect(rowCount).toContain('one {# строка}')
  expect(rowCount).toContain('few {# строки}')
  expect(rowCount).toContain('many {# строк}')
  expect(rowCount).toContain('other {# строки}')
})

// ------------------------------------------------------------------ 6
test('the group separator and the percent gap are U+00A0 in the real DOM', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')

  const probe = await page.evaluate(() => {
    const lang = document.documentElement.lang
    const nf = new Intl.NumberFormat(lang)
    const pct = new Intl.NumberFormat(lang, { style: 'percent' })
    const el = document.createElement('span')
    el.id = 'ru-num-probe'
    el.textContent = nf.format(1234567) + ' / ' + pct.format(0.84)
    document.body.appendChild(el)
    const read = document.getElementById('ru-num-probe')!.textContent ?? ''
    el.remove()
    return { lang, read, codes: [...read].map((c) => c.codePointAt(0)!) }
  })
  expect(probe.lang).toBe('ru')
  // `1 234 567` with U+00A0 in both group positions
  expect(probe.codes[1]).toBe(NO_BREAK_SPACE)
  expect(probe.codes[5]).toBe(NO_BREAK_SPACE)
  expect(probe.read).not.toContain('1,234,567')
  // and U+00A0 before the percent sign
  const pctIdx = probe.read.indexOf('%')
  expect(probe.read.codePointAt(pctIdx - 1)).toBe(NO_BREAK_SPACE)

  // the catalog carries U+00A0 in exactly the two `{pct}` strings
  const cat = await catalog(page)
  const typed = Object.keys(cat).filter((k) =>
    [...cat[k]!].some((c) => c.codePointAt(0) === NO_BREAK_SPACE),
  )
  expect(typed.sort()).toEqual(['playbar.mc.progress', 'runbar.mc.cancel'])
})

// ------------------------------------------------------------------ 7
test('Cyrillic renders in IBM Plex Sans, not a system fallback', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'ru')

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('400 16px "IBM Plex Sans"', 'Привет')
    await document.fonts.load('600 16px "IBM Plex Sans"', 'Привет')
    await document.fonts.ready

    const width = (family: string, text: string, weight = 400) => {
      const el = document.createElement('span')
      el.style.cssText = `position:fixed;left:-9999px;font-size:48px;font-weight:${weight};white-space:pre;font-family:${family}`
      el.textContent = text
      document.body.appendChild(el)
      const w = el.getBoundingClientRect().width
      el.remove()
      return Math.round(w * 100) / 100
    }
    const SYS = 'ui-sans-serif, system-ui, sans-serif'
    const RU = 'Привет мир Накопитель ёж №5'
    return {
      ranges: [...document.fonts]
        .filter((f) => /Plex Sans/.test(f.family) && f.unicodeRange !== 'U+0-10FFFF')
        .map((f) => f.unicodeRange),
      latin: { app: width('var(--font-sans)', 'Hello world'), sys: width(SYS, 'Hello world') },
      cyr400: { app: width('var(--font-sans)', RU), sys: width(SYS, RU) },
      cyr600: { app: width('var(--font-sans)', RU, 600), sys: width(SYS, RU, 600) },
    }
  })

  // The two ranged Cyrillic faces are declared and loaded. Filtered rather
  // than asserted over every ranged face: a later locale may add ranged faces
  // of its own for its own script (`tr` adds two over
  // `U+011E-011F, U+0130, U+015E-015F`, and `th` two more over
  // `U+0E01-0E5B, U+200C-200D, U+25CC`), and those are not Cyrillic and must
  // not make this test red.
  const cyrillic = fonts.ranges.filter((r) => r.includes('U+400-45F'))
  expect(cyrillic.length).toBeGreaterThanOrEqual(2)
  // Latin still comes from Plex — the trap this change had to avoid
  expect(Math.abs(fonts.latin.app - fonts.latin.sys)).toBeGreaterThan(0.5)
  // and Cyrillic no longer matches the bare system stack, at both weights
  expect(Math.abs(fonts.cyr400.app - fonts.cyr400.sys)).toBeGreaterThan(0.5)
  expect(Math.abs(fonts.cyr600.app - fonts.cyr600.sys)).toBeGreaterThan(0.5)
})

// ------------------------------------------------------------------ 8
test('nothing Russian adds overflows its box', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  const measure = async () =>
    page.locator('.menu__blurb, .palette__desc, .hint__body').evaluateAll((els) =>
      els
        .map((e) => {
          const el = e as HTMLElement
          return {
            text: (el.textContent ?? '').slice(0, 40),
            over: el.scrollHeight - el.clientHeight,
          }
        })
        .filter((r) => r.over > 1),
    )

  await setLocale(page, 'en')
  const en = await measure()
  await setLocale(page, 'ru')
  const ru = await measure()

  // differential against the base locale: Russian is long, so the contract is
  // that it adds no NEW overflow rather than that the app has none
  expect(ru.length, JSON.stringify(ru)).toBeLessThanOrEqual(en.length)
})
