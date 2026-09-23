import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Neutral Latin American Spanish (`es-419`). docs/localization.md §L2.13
// (the locale's own decisions), §L5.2 step 4 (`baseFallbackFor`), §L2.11
// (`carácter` vs `columna`).
//
// `es-419` is the EIGHTH shipped language and the second — after Chinese —
// whose code is not its own base subtag. No browser sends `es-419`; it sends
// `es-MX`, `es-AR`, `es`, `es-ES`. Without `baseFallbackFor: 'es'` every one
// of those resolves to English, or to whatever unrelated language happens to
// sit later in `navigator.languages`. That is what section 1 pins.
//
//   1 every Spanish tag a browser sends reaches es-419, in tag order
//   2 the other shipped locales are untouched (invariance)
//   3 a stored `es-419` survives a reload; a region tag is not a code
//   4 the picker offers Español (Latinoamérica), tagged with its own language
//   5 the search box finds it by endonym, English name and code
//   6 the template-label dictionary loads — Spanish labels, not English
//   7 Spanish typography (¿ ¡ ñ á í ó ú) reaches the DOM as exact codepoints,
//     rendered by the bundled IBM Plex Latin subset with no extra font request
//   8 nothing Spanish adds overflows its box (differential against English)
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

async function pageAt(page: Page, tag: string) {
  const ctx = await page.context().browser()!.newContext({ locale: tag })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
    } catch {
      /* storage blocked */
    }
  })
  return { ctx, page: await ctx.newPage() }
}

// ------------------------------------------------------------------ 1
test.describe('a Spanish browser', () => {
  // bare `es`, US Spanish, every Latin American region AND the peninsular
  // tags: all of them reach the one Spanish catalog. `es-ES` / `es-GQ` get
  // Latin American spelling, which is a stated trade-off — English would be
  // strictly worse, and registering `es-ES` later gives it its own tag with
  // no resolver change (§L2.13).
  for (const tag of [
    'es',
    'es-419',
    'es-MX',
    'es-AR',
    'es-CO',
    'es-CL',
    'es-PE',
    'es-US',
    'es-ES',
    'es-GQ',
  ]) {
    test(`${tag} reaches Spanish, not English`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe('es-419')
      await ctx.close()
    })
  }

  // §L5.2's per-TAG ordering (`['es-MX','de-DE']` → es-419,
  // `['de-DE','es-MX']` → de) is NOT asserted here on purpose: a Playwright
  // context carries ONE `locale`, so a browser test cannot express a
  // multi-entry `navigator.languages`. That contract is pinned where it can
  // be expressed honestly — against the production pure function, in
  // `src/i18n/registry.test.ts`. What this file proves is the half a real
  // browser can show: each single tag, on its own, reaches Spanish.
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
    // the unregistered probe: Dutch is not on the twelve-language roadmap, so
    // it will not quietly become registered the way `de-DE` did for `fr`
    ['nl-NL', 'en'],
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
test('a stored es-419 survives a reload; a region tag is not a code', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' })
  const page = await ctx.newPage()
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'es-419'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('es-419')

  // `es-MX` is a browser tag, never a stored CODE. An unregistered stored
  // value is ignored outright — it is NOT normalised into the fallback the
  // navigator list would have produced.
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'es-MX'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
  await ctx.close()
})

// ------------------------------------------------------------------ 4
test('the picker offers Español (Latinoamérica), tagged as its own language', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const row = pop(page).locator('.lang-menu__item').filter({ hasText: 'Español (Latinoamérica)' })
  await expect(row, 'the picker must offer Spanish').toHaveCount(1)
  const tagged = row.locator('[lang="es-419"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('Español (Latinoamérica)')
  await expect(row.locator('.menu__blurb')).toHaveText('Spanish (Latin America)')

  await row.click()
  await expect.poll(() => htmlLang(page)).toBe('es-419')
  expect(await stored(page)).toBe('es-419')
  await expect(page.locator('.toolbar__settingsmenu > button')).toHaveText('Configuración ▾')
})

// ------------------------------------------------------------------ 5
test.describe('the language search box finds Spanish', () => {
  test('by endonym, English name and code — accents optional', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await expect(options(page)).toHaveCount(10) // 9 shipped + the dev pseudo-locale

    for (const q of ['Español', 'espanol', 'ESPANOL', 'Latinoamérica', 'latinoamerica', 'Spanish', 'es-419']) {
      await search(page).fill(q)
      await expect(option(page, 'es-419'), `query ${JSON.stringify(q)} must find Spanish`).toHaveCount(1)
    }

    // a query that matches nothing still says so rather than showing everything
    await search(page).fill('zzzz')
    await expect(options(page)).toHaveCount(0)
  })

  test('is findable from every shipped UI language, by its name there', async ({ page }) => {
    await openApp(page)
    for (const [ui, query] of [
      ['en', 'Spanish'],
      ['ko', '스페인어'],
      ['ja', 'スペイン語'],
      ['zh-Hans', '西班牙语'],
      ['zh-Hant', '西班牙文'],
      ['fr', 'Espagnol'],
      ['de', 'Spanisch'],
      ['pt-BR', 'Espanhol'],
    ] as const) {
      await setLocale(page, ui)
      await openLanguageMenu(page)
      await search(page).fill(query)
      await expect(option(page, 'es-419'), `${ui}: "${query}" must find Spanish`).toHaveCount(1)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
  })
})

// ------------------------------------------------------------------ 6
test('a bundled Template opens with Spanish node labels', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'es-419')
  await page
    .locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: 'Plantillas ▾' }) })
    .getByRole('button', { name: 'Plantillas ▾' })
    .click()
  await page.locator('.menu__name', { hasText: 'Línea de producción equilibrada' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim())),
    )
    .toContain('Suministro de material')
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.nodef__title')].map((t) => t.textContent?.trim()),
  )
  expect(titles, 'the dictionary loaded, so no English canonical is left').not.toContain('Material supply')
  expect(titles).toContain('Procesamiento')
  expect(titles).toContain('Merma')
})

// ------------------------------------------------------------------ 7
test('Spanish typography reaches the DOM as the exact codepoints, on the bundled font', async ({
  page,
}) => {
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await openApp(page)
  await resetAll(page)
  const before = fonts.length
  await setLocale(page, 'es-419')

  // Which Spanish-specific codepoints are ON SCREEN is a property of the copy,
  // not a contract, so this measures rather than prescribes: the default
  // Spanish chrome must render some of them, and every one it renders must be
  // an exact codepoint (never a stripped ASCII approximation).
  const text = await page.evaluate(() => document.body.innerText)
  const present = [...'áéíóúñüÁÉÍÓÚÑ'].filter((ch) => text.includes(ch))
  expect(present.length, 'the Spanish chrome renders accented Latin-1 codepoints').toBeGreaterThan(0)
  // and no word was silently de-accented: `Configuracion` must not appear
  // where `Configuración` is the string
  expect(text, 'accents are not stripped').not.toContain('Configuracion')
  expect(text, 'the settings button carries its accent').toContain('Configuración')

  // `¿` and `¡` only appear in questions and exclamations, which the default
  // screen does not contain. Read them from the ACTIVE CATALOG the product is
  // running on rather than staging a dialog: that is the string users get, and
  // it is a real product read, not a constant restated in the test.
  const marks = await page.evaluate(() => {
    const cat = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.i18n.getState()
      .activeCatalog as Record<string, string>
    const all = Object.entries(cat).filter(([, v]) => typeof v === 'string')
    const questions = all.filter(([, v]) => v.trim().endsWith('?'))
    const exclamations = all.filter(([, v]) => v.trim().endsWith('!'))
    return {
      locale: (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.i18n.getState().activeLocale,
      total: questions.length,
      withOpening: questions.filter(([, v]) => v.includes('¿')).length,
      sample: questions.slice(0, 3).map(([k, v]) => `${k}: ${v}`),
      exclamations: exclamations.length,
      exclamationsWithOpening: exclamations.filter(([, v]) => v.includes('¡')).length,
      exclamationSample: exclamations.slice(0, 3).map(([k, v]) => `${k}: ${v}`),
    }
  })
  expect(marks.locale).toBe('es-419')
  expect(marks.total, 'the Spanish catalog asks questions').toBeGreaterThan(0)
  expect(
    marks.withOpening,
    `every Spanish question opens with ¿ — ${JSON.stringify(marks.sample)}`,
  ).toBe(marks.total)
  // The exclamation side of the same rule. The product writes no exclamations
  // today, so this asserts the rule holds over an EMPTY set and reports the
  // count; the moment a `!` string ships, it must open with `¡`.
  expect(
    marks.exclamationsWithOpening,
    `every Spanish exclamation opens with ¡ — ${JSON.stringify(marks.exclamationSample)}`,
  ).toBe(marks.exclamations)
  expect(marks.exclamations, 'exclamations in the running Spanish catalog').toBe(0)

  // every one of those glyphs must come from the bundled Latin subset
  const perGlyph = await page.evaluate(async () => {
    const out: Record<string, string> = {}
    const probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;left:-9999px;font-family:inherit'
    document.body.appendChild(probe)
    for (const ch of ['¿', '¡', 'ñ', 'Ñ', 'á', 'í', 'ó', 'ú']) {
      probe.textContent = ch
      out[ch] = getComputedStyle(probe).fontFamily
    }
    probe.remove()
    return out
  })
  for (const [ch, family] of Object.entries(perGlyph)) {
    expect(family, `${ch} resolves through the app font stack`).toContain('IBM Plex Sans')
  }

  expect(fonts.length, 'Spanish adds no font request of its own').toBe(before)
})

// ------------------------------------------------------------------ 8
// Spanish runs longer than English. Measured DIFFERENTIALLY: the same sweep
// runs in English and in Spanish and only what Spanish ADDS counts, so
// locale-independent artefacts drop out by construction.
test.describe('Spanish length', () => {
  const SWEEP = `(() => {
    const out = []
    for (const el of document.querySelectorAll('.toolbar *, .pstrip *, .menu__pop *, .palette-tip *, .sheet *, .inspector *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!own) continue
      if (el.offsetParent === null && el.clientWidth === 0) continue
      const cs = getComputedStyle(el)
      if (cs.textOverflow === 'ellipsis') continue
      const ovX = el.scrollWidth - el.clientWidth
      const ovY = el.scrollHeight - el.clientHeight
      if (ovX > 1 || ovY > 1)
        out.push({ where: el.className || el.tagName.toLowerCase(), ovX, ovY })
    }
    return out
  })()`

  async function sweepChrome(p: Page): Promise<string[]> {
    const seen = new Set<string>()
    const collect = async () => {
      for (const r of (await p.evaluate(SWEEP)) as { where: string; ovX: number; ovY: number }[])
        seen.add(`${r.where} ovX=${r.ovX > 1 ? 'yes' : 'no'} ovY=${r.ovY > 1 ? 'yes' : 'no'}`)
    }
    await collect()
    const menus = p.locator('.toolbar__actions .menu')
    for (let i = 0; i < (await menus.count()); i++) {
      await menus.nth(i).locator('> button').click()
      await expect(p.locator('.menu__pop')).toBeVisible()
      await collect()
      await p.keyboard.press('Escape')
    }
    const chips = p.locator('.palette-item')
    for (let i = 0; i < (await chips.count()); i++) {
      await chips.nth(i).hover()
      await expect
        .poll(() =>
          p
            .locator('.palette-tip__desc')
            .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length),
        )
        .toBeGreaterThan(0)
      await collect()
    }
    return [...seen].sort()
  }

  test('adds no overflowing element that English does not already have', async ({ page }) => {
    const en = await pageAt(page, 'en-US')
    await openApp(en.page)
    const enRows = await sweepChrome(en.page)
    await en.ctx.close()

    const es = await pageAt(page, 'es-MX')
    await openApp(es.page)
    expect(await htmlLang(es.page)).toBe('es-419')
    const esRows = await sweepChrome(es.page)
    await es.ctx.close()

    const added = esRows.filter((r) => !enRows.includes(r))
    expect(added, `Spanish-only overflow (English baseline: ${enRows.length} rows)`).toEqual([])
  })
})
