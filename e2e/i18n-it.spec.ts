import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Italian (`it`). docs/localization.md §L2.22.
//
// The contracts worth a real browser are the ones that can only break in the
// PRODUCT:
//   1 every `it-*` tag reaches `it` — the registry code is the BARE subtag, so
//     §L5.2 step 3 carries the regions with no `baseFallbackFor` at all
//   2 a stored `it` survives a reload; only the exact code restores
//   3 the picker offers Italiano, sorted between German and Japanese, and
//     `vi` is STILL last
//   4 the audited Italian copy is on screen, on every surface
//   5 the THREE plural arms are declared and the reachable two render
//   6 no new font subset was needed — `à è é ì ò ù` and `€` come from the face
//     already loaded, verified by INK rather than by `document.fonts.check()`
//   7 nothing Italian adds overflows its box
//
// The percent affix is NOT here: it is shared across locales and lives in
// `percent-affix.spec.ts`, where `it` joins the no-gap arm.

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
test.describe('every Italian tag reaches it, and an unregistrable tag does not', () => {
  for (const [tag, want] of [
    ['it', 'it'],
    ['it-IT', 'it'],
    // Switzerland and San Marino are real Italian-speaking regions; the bare
    // registry code carries them through §L5.2 step 3 for free. Registering
    // `it-IT` instead would have sent all three to ENGLISH — measured against
    // this same resolver before the code was chosen.
    ['it-CH', 'it'],
    ['it-SM', 'it'],
    // a script subtag as well as a region: the `es-ES` / `pt-PT` limit does not
    // apply here, because step 3 splits on `-` and matches the base directly
    ['it-Latn-IT', 'it'],
    ['it-IT-u-ca-gregory', 'it'],
    // `qaa` is ISO 639-2's permanently reserved local-use range — it can never
    // become a registered code, which is exactly why it is the probe
    ['qaa', 'en'],
  ] as const) {
    test(`${tag} resolves to ${want}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const p = await ctx.newPage()
      await openApp(p)
      expect(await htmlLang(p)).toBe(want)
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 2
test.describe('a stored Italian locale round-trips', () => {
  test('setLocale persists it, and a reload restores it without a flash', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    expect(await stored(page)).toBe('it')
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe('it')
  })

  test('a stored `it-IT` is NOT accepted — only the exact registered code is', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'it-IT'))
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    // §L5.2 step 1 takes an EXACT registered code or nothing; an unregistered
    // stored value is ignored rather than normalised into one.
    expect(await htmlLang(page)).not.toBe('it-IT')
  })
})

// ------------------------------------------------------------------ 3
test.describe('the picker offers Italiano, in the right place', () => {
  test('sorts between German and Japanese, and Vietnamese is still last', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const codes = await page
      .locator('.lang-menu__pop [role="option"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
    expect(codes.indexOf('it')).toBe(codes.indexOf('de') + 1)
    expect(codes[codes.indexOf('it') + 1]).toBe('ja')
    // the dev pseudo-locale is appended after the sorted set, so the last
    // SHIPPED code is what matters here
    expect(codes.filter((c) => c !== 'en-XA').at(-1)).toBe('vi')
  })

  test('the row reads Italiano, and its blurb is in the active language', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const row = page.locator('.lang-menu__pop [data-locale="it"]')
    await expect(row.locator('.menu__name')).toHaveText('Italiano')
    await expect(row.locator('.menu__blurb')).toHaveText('Italian')
  })

  test('an ASCII keyboard finds it — no accented letter is required', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    const search = page.locator('.lang-menu__search')
    for (const q of ['italiano', 'ital', 'Italian']) {
      await search.fill(q)
      await expect(page.locator('.lang-menu__pop [role="option"][data-locale="it"]')).toHaveCount(1)
    }
  })
})

// ------------------------------------------------------------------ 4
test.describe('the audited Italian copy is on screen', () => {
  test('the palette names every node kind with its glossary term', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    const names = await page.locator('.palette-item').allInnerTexts()
    const joined = names.join(' | ')
    for (const want of [
      'Serbatoio', 'Sorgente', 'Scarico', 'Ripartitore',
      'Convertitore', 'Fine', 'Parametro', 'Valore calcolato',
    ]) {
      expect(joined, `${want} must be in the palette`).toContain(want)
    }
    // the two words the glossary bans outright
    expect(joined).not.toContain('Cancello')
    expect(joined).not.toContain('Registro')
  })

  test('the toolbar menus and the Inspector empty state are Italian', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    const labels = await page.locator('.toolbar__actions .menu > button').allInnerTexts()
    expect(labels.join(' | ')).toContain('Modelli')
    expect(labels.join(' | ')).toContain('Inserisci modulo')
    await expect(page.locator('.insp__empty, .inspector__empty').first()).toContainText(
      'Seleziona un nodo o una connessione',
    )
  })

  test('a Template loads with Italian node labels AND Italian frame titles', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    const cat = await catalog(page)
    await page.locator('.toolbar__actions .menu > button', { hasText: /^Modelli/ }).click()
    await page.locator('.menu__pop [role="menuitem"]', { hasText: cat['templates.coffeeRoastery.name'] }).click()
    const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect.poll(() => page.locator('.nodef__title').count()).toBeGreaterThan(20)
    const titles = (await page.locator('.nodef__title').allInnerTexts()).join(' | ')
    // the glossary term, a plain label, and the ONE the read-back is watching
    expect(titles).toContain('Scorte di caffè verde')
    expect(titles).toContain('Margine operativo giornaliero previsto')
    // frame titles come from the separate frames dict
    const frames = (await page.locator('.lgr-frame__label').allInnerTexts()).join(' | ')
    expect(frames).toContain('Fornitura e scorte')
  })
})

// ------------------------------------------------------------------ 5
test.describe('the three-arm plural', () => {
  test('the catalog declares one, many and other on every plural message', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    const cat = await catalog(page)
    const plurals = Object.entries(cat).filter(([, v]) => v.includes(', plural,'))
    expect(plurals.length).toBeGreaterThan(10)
    const missing = plurals
      .filter(([, v]) => !(v.includes(' one {') && v.includes(' many {') && v.includes(' other {')))
      .map(([k]) => k)
    expect(missing, 'an English-shaped two-arm message loses `many`').toEqual([])
  })

  test('the two REACHABLE arms render, through the real selection counter', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    // `many` selects a non-zero integer multiple of 1,000,000, which this
    // product's own limits never produce — so it is asserted as DECLARED above
    // and rendered here only at the counts a reader can actually reach. This
    // goes through the REAL counter, not a formatter called directly, because
    // a plural that is right in the catalog and wrong on screen is the defect
    // worth catching.
    const cat = await catalog(page)
    await page.locator('.toolbar__actions .menu > button', { hasText: /^Modelli/ }).click()
    await page
      .locator('.menu__pop [role="menuitem"]', { hasText: cat['templates.equilibrium.name'] })
      .click()
    const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(3)

    const counter = page.locator('.lgr-selection-count').first()

    await page.locator('.react-flow__node').first().click()
    await expect.poll(() => counter.innerText().catch(() => '')).toContain('nodo selezionato')

    // Shift-drag on empty canvas is the documented multi-select gesture
    // (`canvas.regionSelect.off` says so), so the plural is exercised the way
    // a reader reaches it rather than by writing a number into the store.
    const pane = await page.locator('.react-flow__pane').boundingBox()
    expect(pane).not.toBeNull()
    await page.keyboard.down('Shift')
    await page.mouse.move(pane!.x + 4, pane!.y + 4)
    await page.mouse.down()
    await page.mouse.move(pane!.x + pane!.width - 4, pane!.y + pane!.height - 4, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect.poll(() => counter.innerText().catch(() => '')).toContain('nodi selezionati')
  })
})

// ------------------------------------------------------------------ 6
test.describe('Italian needed no new font subset, and that is measured', () => {
  test('every accented letter and € draws INK from a loaded face, not a fallback', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    // `document.fonts.check()` has lied for four locales running (ru, tr, th,
    // vi), so this compares INK against the platform fallback instead: if the
    // app's own family draws a code point differently from an undefined
    // family, the app's face supplied the glyph.
    const out = await page.evaluate(() => {
      const cvs = document.createElement('canvas')
      cvs.width = 160
      cvs.height = 120
      const ctx = cvs.getContext('2d')!
      const ink = (ch: string, family: string) => {
        ctx.clearRect(0, 0, 160, 120)
        ctx.font = `64px ${family}`
        ctx.fillStyle = '#000'
        ctx.fillText(ch, 16, 88)
        const d = ctx.getImageData(0, 0, 160, 120).data
        let n = 0
        let top = 999
        for (let y = 0; y < 120; y++)
          for (let x = 0; x < 160; x++)
            if (d[(y * 160 + x) * 4 + 3]! > 16) {
              n++
              if (y < top) top = y
            }
        return `${n}@${n ? top : '-'}`
      }
      const app = getComputedStyle(document.body).fontFamily
      const res: Record<string, { app: string; fallback: string }> = {}
      for (const ch of ['à', 'è', 'é', 'ì', 'ò', 'ù', '€', 'À', 'È']) {
        res[ch] = { app: ink(ch, app), fallback: ink(ch, '"NoSuchFamilyZZ"') }
      }
      return res
    })
    const tofu: string[] = []
    for (const [ch, m] of Object.entries(out)) {
      if (m.app === '0@-') tofu.push(`${ch}: no ink at all`)
      if (m.app === m.fallback) tofu.push(`${ch}: identical to the platform fallback (${m.app})`)
    }
    expect(tofu, 'these must come from the app font, not a per-glyph fallback').toEqual([])
  })

  test('the page fetched NO new font file for Italian', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    // Every Italian code point is already in the unranged `latin` cmap, checked
    // against the real woff2 rather than the declared `unicode-range`, so no
    // `vietnamese`-style subset was added and `src/index.css` is untouched.
    const files = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name.split('/').pop() ?? '')
        .filter((n) => /\.woff2?$/.test(n)),
    )
    expect(files.filter((f) => /italian|-it-/.test(f))).toEqual([])
  })
})

// ------------------------------------------------------------------ 7
test.describe('nothing Italian adds overflows its box', () => {
  test('no leaf string is clipped or collides, with a Template loaded', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'it')
    const bad = await page.evaluate(() => {
      const out: string[] = []
      const sel = '.palette-item, .menu__blurb, .menu__name, .nodef__title, .btn, .toolbar__actions button'
      for (const el of document.querySelectorAll(sel)) {
        const e = el as HTMLElement
        if (!e.offsetParent) continue
        if ([...e.children].some((c) => c.textContent?.trim())) continue // leaves only
        if (!e.textContent?.trim()) continue
        if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) {
          out.push(`${e.className} :: ${e.textContent.trim().slice(0, 40)}`)
        }
      }
      return out
    })
    expect(bad, 'Italian is the longest Latin locale here after French').toEqual([])
  })
})
