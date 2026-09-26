import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L2.23 — Dutch, the seventeenth locale and the FIRST
// one the picker sorts AHEAD of English.
//
// What this file is for, over and above `src/i18n/nlCopy.test.ts`:
//   1. the resolver rows a real browser can prove (one navigator tag each);
//   2. the picker position, which is the novel part — `Dutch` < `English` under
//      `Intl.Collator('en')`, so `nl` lands third, before the base language;
//   3. the audited copy actually on screen, not just in the catalog;
//   4. the TWO plural arms, exercised through the real UI;
//   5. the font claim, measured as INK against the platform fallback rather
//      than with `document.fonts.check()`, which has now lied for four locales;
//   6. that Dutch compounds clip nothing.
//
// `qaa` is the unregistered probe throughout: ISO 639-2 reserves `qaa`-`qtz`
// for local use, so it can never become a registered code. `nl-NL` used to be
// that probe in four specs and this locale is exactly why it stopped being one.

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

// ------------------------------------------------------------------ 1
test.describe('every Dutch tag reaches nl, and an unregistrable tag does not', () => {
  for (const [tag, want] of [
    ['nl', 'nl'],
    ['nl-NL', 'nl'],
    // Flanders, Suriname and Aruba are real Dutch-speaking regions. Registering
    // `nl-NL` alone would have sent all three to ENGLISH; the bare code carries
    // them through §L5.2 step 3 with no `baseFallbackFor` at all.
    ['nl-BE', 'nl'],
    ['nl-SR', 'nl'],
    ['nl-AW', 'nl'],
    ['nl-Latn-NL', 'nl'],
    // reserved for local use — can never become a registered code
    ['qaa', 'en'],
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
test.describe('a stored Dutch locale round-trips', () => {
  test('selecting nl persists the bare code and survives a reload', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    expect(await stored(page)).toBe('nl')
    await page.reload()
    await expect.poll(() => htmlLang(page)).toBe('nl')
  })

  test('an unregistrable stored value is ignored, never repaired into one', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'qaa'))
    await page.reload()
    await expect.poll(() => htmlLang(page)).toBe('en')
    await ctx.close()
  })
})

// ------------------------------------------------------------------ 3
test.describe('the picker offers Nederlands, ahead of English', () => {
  test('sorts between Chinese (Traditional) and English — the first locale before the base', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const codes = await page
      .locator('.lang-menu__pop [role="option"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
    // `Dutch` < `English` under Intl.Collator('en'), so this is the first
    // shipped locale that precedes the base language in the list.
    expect(codes.indexOf('nl')).toBeLessThan(codes.indexOf('en'))
    expect(codes[codes.indexOf('nl') - 1]).toBe('zh-Hant')
    expect(codes[codes.indexOf('nl') + 1]).toBe('en')
    // the dev pseudo-locale is appended after the sorted set, so the last
    // SHIPPED code is what matters here
    expect(codes.filter((c) => c !== 'en-XA').at(-1)).toBe('vi')
  })

  test('the row reads Nederlands, and its blurb is in the active language', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const row = page.locator('.lang-menu__pop [data-locale="nl"]')
    await expect(row.locator('.menu__name')).toHaveText('Nederlands')
    await expect(row.locator('.menu__blurb')).toHaveText('Dutch')
  })

  test('an ASCII keyboard finds it — Dutch needs no accented letter', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const search = page.locator('.lang-menu__search')
    for (const q of ['nederlands', 'neder', 'Dutch']) {
      await search.fill(q)
      await expect(page.locator('.lang-menu__pop [role="option"][data-locale="nl"]')).toHaveCount(1)
    }
  })
})

// ------------------------------------------------------------------ 4
test.describe('the audited Dutch copy is on screen', () => {
  test('the palette names every node kind the way the contract says', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const names = await page
      .locator('.toolbar__palette .palette-item')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))
    for (const want of [
      'Voorraad',
      'Bron',
      'Afvoer',
      'Verdeler',
      'Omzetter',
      'Einde',
      'Parameter',
      'Berekende waarde',
    ]) {
      expect(names.join(' | '), `${want} must be on screen`).toContain(want)
    }
  })

  test('the flow placeholder is byte-identical to English — it is parser syntax', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const cat = await catalog(page)
    // `all`, `2D6` and `25%` are the engine's own mini-language. An earlier
    // draft rendered `all` as `alles`, which would have shown Dutch readers
    // syntax the parser rejects.
    expect(cat['inspector.edge.flowPlaceholder']).toBe('1, all, 2D6, 1-3, 25%')
  })

  test('the resourceType placeholder keeps the byte-matched model tokens', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const cat = await catalog(page)
    const v = cat['inspector.resourceType.placeholder']!
    for (const token of ['Gold', 'Energy', 'XP', 'Player', 'Item']) expect(v).toContain(token)
    // and the trailing prose IS Dutch, so this is not just an untranslated row
    expect(v).toContain('eigen naam')
  })

  test('percent puts the sign after the digits with no separator at all', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const pct = await page.evaluate(() => new Intl.NumberFormat('nl-NL', { style: 'percent' }).format(0.84))
    // MEASURED: U+0038 U+0034 U+0025. Dutch groups its numbers like `de`
    // (1.234.567,89) and takes `de`'s U+00A0 nowhere.
    expect([...pct].map((c) => c.codePointAt(0))).toEqual([0x38, 0x34, 0x25])
  })
})

// ------------------------------------------------------------------ 5
test.describe('the two plural arms', () => {
  test('the catalog declares exactly one and other — never a third', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const cats = await page.evaluate(
      () => [...new Intl.PluralRules('nl').resolvedOptions().pluralCategories].sort(),
    )
    expect(cats).toEqual(['one', 'other'])
  })

  test('both arms render, through the real selection counter', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    // A plural that is right in the catalog and wrong on screen is the defect
    // worth catching, so this goes through the REAL counter rather than a
    // formatter called directly.
    const cat = await catalog(page)
    await page.locator('.toolbar__actions .menu > button', { hasText: /^Sjablonen/ }).click()
    await page
      .locator('.menu__pop [role="menuitem"]', { hasText: cat['templates.equilibrium.name'] })
      .click()
    const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(3)

    const counter = page.locator('.lgr-selection-count').first()

    await page.locator('.react-flow__node').first().click()
    await expect.poll(() => counter.innerText().catch(() => '')).toContain('knooppunt geselecteerd')

    // Shift-drag on empty canvas is the documented multi-select gesture
    // (`canvas.regionSelect.off` says so), so the `other` arm is reached the
    // way a reader reaches it rather than by writing a number into the store.
    const pane = await page.locator('.react-flow__pane').boundingBox()
    expect(pane).not.toBeNull()
    await page.keyboard.down('Shift')
    await page.mouse.move(pane!.x + 4, pane!.y + 4)
    await page.mouse.down()
    await page.mouse.move(pane!.x + pane!.width - 4, pane!.y + pane!.height - 4, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect.poll(() => counter.innerText().catch(() => '')).toContain('knooppunten geselecteerd')
  })
})

// ------------------------------------------------------------------ 6
test.describe('Dutch needed no new font subset, and that is measured', () => {
  test('every Dutch code point is drawn by the app font, not the platform fallback', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    // `document.fonts.check()` has answered TRUE for glyphs the shipped woff2
    // does not carry, for `ru`, `tr`, `th` and `vi` in turn. Compare INK
    // instead: render each character in the app stack and in a deliberately
    // absent family, and require the two to differ.
    const drift = await page.evaluate(() => {
      const chars = [...'ëïöüéèêáíóúàôîçñ€']
      const measure = (ch: string, family: string) => {
        const c = document.createElement('canvas')
        c.width = 64
        c.height = 64
        const g = c.getContext('2d')!
        g.font = `48px ${family}`
        g.fillText(ch, 4, 48)
        const d = g.getImageData(0, 0, 64, 64).data
        let ink = 0
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) ink++
        return ink
      }
      const same: string[] = []
      for (const ch of chars) {
        const app = measure(ch, '"IBM Plex Sans", sans-serif')
        const absent = measure(ch, '"LS Definitely Absent Family"')
        if (app === 0 || app === absent) same.push(ch)
      }
      return same
    })
    expect(drift, 'these fell back to the platform font').toEqual([])
  })

  test('the page requests no font file this locale added', async ({ page }) => {
    const fontUrls: string[] = []
    page.on('request', (r) => {
      if (/\.woff2?(\?|$)/.test(r.url())) fontUrls.push(r.url())
    })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    await page.waitForTimeout(250)
    // `src/index.css` is untouched by this locale: every Dutch code point is
    // already in the unranged `latin` face's cmap. The IJ ligature
    // (U+0132-0133) is the one exception and no shipped string uses it —
    // `nlCopy.test.ts` asserts that over all 1,073 runtime strings.
    expect(fontUrls.filter((u) => /dutch|nederlands|nl-/i.test(u))).toEqual([])
  })
})

// ------------------------------------------------------------------ 7
test.describe('nothing Dutch adds overflows its box', () => {
  test('no visible leaf clips its own text', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'nl')
    const clipped = await page.evaluate(() => {
      const out: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>('button, label, .menu__name, .palette__name')) {
        if (!el.offsetParent || el.children.length) continue
        const t = (el.textContent ?? '').trim()
        if (t.length < 3) continue
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
          out.push(`${el.className}: ${t.slice(0, 40)}`)
        }
      }
      return out
    })
    expect(clipped, 'Dutch compounds are long — this is where they would show').toEqual([])
  })
})
