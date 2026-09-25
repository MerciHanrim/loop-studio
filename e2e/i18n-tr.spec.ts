import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Turkish (`tr`). docs/localization.md §L2.18.
//
// The contracts worth a real browser are the ones that can only break in the
// PRODUCT:
//   1 every `tr-*` tag reaches `tr`, and the neighbouring Turkic languages do
//     NOT — the §L5.2 step-3 contract, live
//   2 a stored `tr` survives a reload; only the exact code restores
//   3 the picker offers Türkçe, sorted last by English name, and a reader on
//     an ASCII keyboard can find a row spelled with a dotless `ı`
//   4 the audited Turkish copy is on screen
//   5 the two plural arms render at 1 and at 5, with the noun unchanged
//   6 `İ Ş ş Ğ ğ` render in IBM Plex Sans, not a per-glyph system fallback
//   7 nothing Turkish adds overflows its box
//
// The percent affix is NOT here: it is shared across locales and lives in
// `percent-affix.spec.ts`.

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

// Built from code points: dotless `ı` and dotted `İ` are invisible next to
// `i` and `I` in a source listing.
const FRANSIZCA = String.fromCharCode(0x46, 0x72, 0x61, 0x6e, 0x73, 0x131, 0x7a, 0x63, 0x61)
const TURKCE = String.fromCharCode(0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65)

// ------------------------------------------------------------------ 1
test.describe('every Turkish tag reaches tr, and its neighbours do not', () => {
  for (const [tag, want] of [
    ['tr', 'tr'],
    ['tr-TR', 'tr'],
    ['tr-CY', 'tr'],
    ['tr-Latn', 'tr'],
    // `tr` IS its own base subtag, so §L5.2 step 3 splits on the first subtag
    // and everything after it is ignored — the limit recorded for `es-ES` and
    // `pt-PT` does not apply here.
    ['tr-Latn-TR', 'tr'],
    ['tr-TR-u-ca-gregory', 'tr'],
    ['TR-tr', 'tr'],
    // close, but different languages
    ['az', 'en'],
    ['az-Latn', 'en'],
    ['kk', 'en'],
    ['uz', 'en'],
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
test('a stored tr survives a reload, and only the exact code restores', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')
  expect(await stored(page)).toBe('tr')

  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('tr')

  // §L5.1 is stricter than §L5.2: a region tag is not a registered code
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'tr-TR'))
  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('en')
})

// ------------------------------------------------------------------ 3
test('the picker offers Türkçe, in place and findable without a Turkish keyboard', async ({
  page,
}) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')
  await openLanguageMenu(page)

  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — `Turkish` sorts last among the SHIPPED languages by English name.
  // A DEV/QA pseudo-locale is appended after the sorted set (§L5.4), so it can
  // legitimately follow `tr` in a dev build and must not be counted here.
  const shipped = codes.filter((c) => c !== 'en-XA')
  expect(shipped[shipped.length - 1]).toBe('tr')
  // The left neighbour was `es-ES` when Turkish shipped; `Thai` sorts between
  // `Spanish (Spain)` and `Turkish` and took that slot. Pinning the IMMEDIATE
  // neighbour is what catches a mis-sort, so it is updated rather than dropped.
  expect(shipped.indexOf('tr')).toBe(shipped.indexOf('th') + 1)

  const row = page.locator('.lang-menu__item[data-locale="tr"]')
  // The endonym and the name in the active UI language are both `Türkçe`, so
  // §L5.3 hides the redundant second line — the row carries ONE label. The
  // selected row also carries a check mark, so this asserts containment and
  // then that nothing else was added.
  await expect(row.locator('[lang="tr"]')).toContainText(TURKCE)
  const rowText = (await row.innerText()).replace(/\s+/g, ' ').trim()
  expect(rowText.replace(/^✓\s*/, '')).toBe(TURKCE)

  const search = page.locator('.lang-menu__pop input')
  for (const [q, want] of [
    [TURKCE, 'tr'],
    ['turkce', 'tr'],
    ['Turkish', 'tr'],
    ['tr', 'tr'],
    // the row for French is `Fransızca` — a reader on an ASCII keyboard types
    // a dotted `i` and must still find it
    ['fransizca', 'fr'],
    [FRANSIZCA, 'fr'],
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

// ------------------------------------------------------------------ 4
test('the audited Turkish copy is what the product shows', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')

  await expect(
    page.locator('.toolbar__actions .menu > button').filter({ hasText: /Dosya/ }),
  ).toBeVisible()

  const labels = await page
    .locator('.toolbar__palette .palette-item')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/^[^\p{L}]+/u, '').trim()))
  // the eight node kinds, in palette order
  expect(labels).toEqual([
    'Havuz',
    'Kaynak',
    'Gider',
    'Dağıtıcı',
    'Dönüştürücü',
    'Bitiş',
    'Parametre',
    'Hesaplanan değer',
  ])
})

// ------------------------------------------------------------------ 5
test('the two plural arms render, and the noun does not change', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')
  const cat = await catalog(page)

  const rendered = await page.evaluate(
    (counts) => counts.map((n) => ({ n, category: new Intl.PluralRules('tr').select(n) })),
    [1, 2, 5, 21],
  )
  // Turkish has exactly two categories, and only 1 is `one`
  expect(rendered.map((r) => r.category)).toEqual(['one', 'other', 'other', 'other'])

  // and the catalog's two arms carry the same noun — correct Turkish, because
  // a noun is not pluralised after a numeral
  const arms = [...cat['canvas.regionSelect.count'].matchAll(/\b(one|other)\s*\{([^{}]*)\}/g)].map(
    (m) => m[2],
  )
  expect(arms).toHaveLength(2)
  expect(arms[0]).toBe(arms[1])
  for (const a of arms) expect(a).toContain('#')
})

// ------------------------------------------------------------------ 6
test('the Turkish letters render in IBM Plex Sans, not a system fallback', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')

  const result = await page.evaluate(async () => {
    const TURKISH = 'ĞğİŞş'
    await Promise.all([
      document.fonts.load('400 64px "IBM Plex Sans"', TURKISH),
      document.fonts.load('600 64px "IBM Plex Sans"', TURKISH),
    ])
    await document.fonts.ready
    const width = (text: string, family: string, weight: number) => {
      const s = document.createElement('span')
      s.textContent = text
      s.style.cssText = `position:absolute;left:-9999px;white-space:pre;font-size:64px;font-weight:${weight};font-family:${family};`
      document.body.appendChild(s)
      const w = s.getBoundingClientRect().width
      s.remove()
      return Math.round(w * 100) / 100
    }
    const PLEX = `'IBM Plex Sans', system-ui, sans-serif`
    // a family that cannot exist forces the same fallback the bare system
    // stack would use — the three-way comparison `document.fonts.check()`
    // cannot make, and the reason the Cyrillic and Turkish defects were both
    // invisible to it
    const ABSENT = `'Nonexistent Family XYZ', system-ui, sans-serif`
    const out: Record<string, { plex400: number; sys400: number; plex600: number; sys600: number }> = {}
    for (const ch of [...TURKISH, 'ı', 'a']) {
      const s = ch.repeat(20)
      out[ch] = {
        plex400: width(s, PLEX, 400),
        sys400: width(s, ABSENT, 400),
        plex600: width(s, PLEX, 600),
        sys600: width(s, ABSENT, 600),
      }
    }
    return out
  })

  const fellBack: string[] = []
  for (const [ch, m] of Object.entries(result)) {
    if (m.plex400 === m.sys400 && m.plex600 === m.sys600) fellBack.push(ch)
  }
  expect(fellBack, 'these characters came from a system font, not Plex').toEqual([])
})

// ------------------------------------------------------------------ 7
test('nothing Turkish adds overflows its box', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'tr')

  const overflow = await page.evaluate(() => {
    const bad: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.toolbar__palette .palette-item, .toolbar button')) {
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push((el.textContent ?? '').trim().slice(0, 40) + ' ovX=' + (el.scrollWidth - el.clientWidth))
      }
    }
    return bad
  })
  expect(overflow).toEqual([])
})
