import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// French (`fr`). Written RED-FIRST against the unmodified product.
// docs/localization.md §L2.9 (region policy), §L2.8 (French typography),
// §L5.4–§L5.5 (the search box and its folding).
//
// `fr` is the SIXTH shipped language, which is what first pushes
// `shouldShowLanguageSearch` over its threshold in production — so this spec
// owns the search box's contracts as well as the locale's.
//
//   1 fr, fr-FR, fr-BE, fr-CH, fr-CA, fr-LU all reach French
//   2 the five existing locales are untouched (invariance)
//   3 a stored `fr` survives a reload; an unregistered value falls back
//   4 the picker offers Français, tagged with its own language
//   5 the search box: semantics, focus, typing, folding, empty state,
//     two-stage Escape, arrows, Enter, Tab, geometry, and every shipped UI
//   6 the same box in the mobile More sheet, inside a 390px viewport
//   7 the template-label dictionary loads — French labels, not English
//   8 French typography survives into the DOM as the exact codepoints
//   9 nothing in the French chrome overflows its box
//
// No baseline image: fonts, wrapping and overflow are pinned by measurement.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

/** Switch the UI language through the store, for the tests whose subject is
 *  not the picker itself. */
async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** The language trigger lives inside `Settings ▾` (docs/localization.md
 *  §L5.3). This spec runs with the UI in all six languages, so the trigger is
 *  taken STRUCTURALLY (`.toolbar__settingsmenu`) rather than by the button's
 *  own text — the existing helpers' `^(Settings|설정|設定|设置) ▾$` alternation
 *  is left exactly as it is (ruling F-7). */
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

/** A fresh context at `tag`, guided tour pre-dismissed — the shared
 *  `_tourSeed` fixture only reaches the fixture-provided page. */
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
test.describe('a French browser', () => {
  // every French region lands on the ONE French localisation through the
  // ordinary base-subtag rule — `fr-CA` included, deliberately (§L2.9)
  for (const tag of ['fr-FR', 'fr-BE', 'fr-CH', 'fr-CA', 'fr-LU', 'fr']) {
    test(`${tag} reaches French, not English`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe('fr')
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 2
test.describe('the other shipped locales are unaffected', () => {
  for (const [tag, want] of [
    ['en-US', 'en'],
    ['ko-KR', 'ko'],
    ['ja-JP', 'ja'],
    ['zh-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    // `de-DE` was this list's UNREGISTERED probe when French shipped. German
    // shipped afterwards, so it now reaches `de` through the ordinary
    // base-subtag step, and the row proves that step instead. `qaa` takes
    // over as the probe: Dutch is not on the twelve-language roadmap, so it
    // will not quietly become registered the way `de-DE` did.
    ['de-DE', 'de'],
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
test('a stored fr survives a reload; a region-tagged value is not a code', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' })
  const page = await ctx.newPage()
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'fr'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('fr')

  // `fr-CA` is a browser tag, never a stored CODE — the registry has no such
  // entry, so the stored value is ignored and the browser list decides
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'fr-CA'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
  await ctx.close()
})

// ------------------------------------------------------------------ 4
test('the picker offers Français, tagged as its own language', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const row = pop(page).locator('.lang-menu__item').filter({ hasText: 'Français' })
  await expect(row, 'the picker must offer French').toHaveCount(1)
  const tagged = row.locator('[lang="fr"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('Français')
  // in an English UI the endonym carries its English name alongside it
  await expect(row.locator('.menu__blurb')).toHaveText('French')

  await row.click()
  await expect.poll(() => htmlLang(page)).toBe('fr')
  expect(await stored(page)).toBe('fr')
  await expect(page.locator('.toolbar__settingsmenu > button')).toHaveText('Paramètres ▾')
})

// ------------------------------------------------------------------ 5
test.describe('the language search box, shipped to production here', () => {
  test('is present, focused, and carries its combobox semantics', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await expect(search(page)).toHaveCount(1)
    await expect(search(page)).toBeFocused()
    await expect(search(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(search(page)).toHaveAttribute('aria-autocomplete', 'list')
    const listId = await pop(page).locator('[role="listbox"]').getAttribute('id')
    await expect(search(page)).toHaveAttribute('aria-controls', listId!)
    // the active option is announced through the input, and starts on the
    // language currently in use
    await expect(search(page)).toHaveAttribute('aria-activedescendant', /-opt-en$/)
    // the list itself is out of the tab ring while the box owns focus
    await expect(pop(page).locator('[role="listbox"]')).toHaveAttribute('tabindex', '-1')
  })

  test('finds French by code, English name, endonym — and without the cedilla', async ({
    page,
  }) => {
    await openApp(page)
    await openLanguageMenu(page)
    for (const q of ['fr', 'FR', 'French', 'français', 'Français', 'francais', 'franc', 'FRANCAIS']) {
      await search(page).fill(q)
      await expect(option(page, 'fr'), `query ${JSON.stringify(q)} must find French`).toHaveCount(1)
    }
    // and it is a FILTER, not a highlight: a query that French alone matches
    // leaves French alone on screen
    await search(page).fill('francais')
    await expect(options(page)).toHaveCount(1)
  })

  test('folding never collapses a Japanese voiced kana', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await search(page).fill('日本')
    await expect(option(page, 'ja')).toHaveCount(1)
    // ポ decomposes to ホ + a combining mark; a blanket NFD strip would make
    // this match 日本語 too (§L5.5)
    await search(page).fill('ポ')
    await expect(options(page)).toHaveCount(0)
  })

  test('shows its empty state and keeps focus when nothing matches', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await search(page).fill('zzzzz')
    await expect(options(page)).toHaveCount(0)
    await expect(pop(page).locator('.lang-menu__empty')).toHaveText('No matching language')
    await expect(search(page)).toBeFocused()
  })

  test('Escape clears the query first, then closes and returns focus', async ({ page }) => {
    await openApp(page)
    const trigger = await openLanguageMenu(page)
    await search(page).fill('fr')
    await expect(options(page)).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(search(page)).toHaveValue('') // stage 1: only the query goes
    await expect(pop(page)).toBeVisible()
    await expect(options(page)).toHaveCount(17) // 16 shipped + the dev pseudo-locale

    await page.keyboard.press('Escape')
    await expect(pop(page)).toHaveCount(0) // stage 2: the popover closes
    await expect(trigger).toBeFocused()
    // and Settings, one level up, is still open — Escape unwinds one level
    await expect(page.locator('.toolbar__settingsmenu > button')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('arrows move the active option and Enter picks it', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openLanguageMenu(page)
    await search(page).fill('fran')
    await expect(options(page)).toHaveCount(1)
    await expect(option(page, 'fr')).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Enter')
    await expect.poll(() => htmlLang(page)).toBe('fr')
  })

  test('typing resets the active option to the first match', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await search(page).fill('f')
    await expect(options(page).first()).toHaveAttribute('data-active', 'true')
  })

  test('Tab leaves without trapping focus', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    await page.keyboard.press('Tab')
    await expect(pop(page)).toHaveCount(0)
  })

  test('the search box does not decide how wide the popover is', async ({ page }) => {
    await openApp(page)
    await openLanguageMenu(page)
    const geo = await pop(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const box = el.querySelector('.lang-menu__search')!.getBoundingClientRect()
      const rows = [...el.querySelectorAll('.lang-menu__item')].map(
        (o) => o.getBoundingClientRect().width,
      )
      return {
        popW: r.width,
        boxW: box.width,
        widestRow: Math.max(...rows),
        overflowX: el.scrollWidth - el.clientWidth,
        right: r.right,
        bottom: r.bottom,
        vw: window.innerWidth,
        vh: window.innerHeight,
      }
    })
    // an `<input>` carries an intrinsic `size=20` width (measured: 206px); the
    // popover must still be sized by the language names and its own 150px
    // minimum, with the box fitting inside whatever that comes to (§L5.4)
    expect(geo.popW, `popover ${geo.popW} vs widest row ${geo.widestRow}`).toBeLessThanOrEqual(
      Math.max(150, geo.widestRow) + 12,
    )
    expect(geo.boxW).toBeLessThanOrEqual(geo.popW)
    expect(geo.overflowX, 'nothing scrolls sideways inside the popover').toBeLessThanOrEqual(1)
    expect(geo.right).toBeLessThanOrEqual(geo.vw)
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh)
  })

  test('French is findable from every shipped UI language, by its name there', async ({ page }) => {
    await openApp(page)
    // The word a user would actually type, in each UI language. Written by
    // hand on purpose: deriving it from the catalog would only prove that the
    // catalog equals itself.
    const NAMES = [
      ['en', 'French'],
      ['ko', '프랑스어'],
      ['ja', 'フランス語'],
      ['zh-Hans', '法语'],
      ['zh-Hant', '法語'],
      ['fr', 'Français'],
      ['de', 'Französisch'],
      ['it', 'Francese'],
      ['es-419', 'Francés'],
      ['pt-BR', 'Francês'],
      ['es-ES', 'Francés'],
      ['pt-PT', 'Francês'],
      ['ru', 'Французский'],
      ['tr', 'Fransızca'],
      ['th', 'ฝรั่งเศส'],
      ['vi', 'Tiếng Pháp'],
    ] as const

    // EXHAUSTIVE, and checked against the product rather than against a
    // comment. This table froze at the six languages that shipped with `fr`
    // and went on calling itself "every shipped UI language" through five more
    // locales — the assertion was false long before anyone would have noticed.
    // The picker is the source of truth, so the NEXT locale makes this red
    // until its row exists.
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
      await expect(search(page), `the box must be shown in a ${ui} UI`).toHaveCount(1)
      await search(page).fill(query)
      await expect(option(page, 'fr'), `${ui}: "${query}" must find French`).toHaveCount(1)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
  })
})

// ------------------------------------------------------------------ 6
test.describe('the same box in the mobile More sheet', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('appears, filters, and stays inside a 390px viewport', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await openLanguageMenu(page, '.sheet')

    await expect(search(page, '.sheet')).toHaveCount(1)
    await search(page, '.sheet').fill('francais')
    await expect(options(page, '.sheet')).toHaveCount(1)

    const box = await page.evaluate(() => {
      const el = document.querySelector('.sheet .lang-menu__pop')!
      const r = el.getBoundingClientRect()
      return {
        left: r.left,
        right: r.right,
        overflowX: el.scrollWidth - el.clientWidth,
        vw: document.documentElement.clientWidth,
        docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(box.left).toBeGreaterThanOrEqual(-1)
    expect(box.right).toBeLessThanOrEqual(box.vw + 1)
    expect(box.overflowX).toBeLessThanOrEqual(1)
    expect(box.docScroll).toBeLessThanOrEqual(1)

    await option(page, 'fr', '.sheet').click()
    await expect.poll(() => htmlLang(page)).toBe('fr')
  })
})

// ------------------------------------------------------------------ 7
test('a bundled Template opens with French node labels', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'fr')

  const templates = page.locator('.toolbar__actions .menu').first()
  await templates.locator('> button').click()
  await expect(templates.locator('.menu__pop')).toBeVisible()
  await templates
    .locator('.menu__pop [role="menuitem"]', { hasText: 'Progression MMO' })
    .click()
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()

  const labels = await page.evaluate(() =>
    (window as unknown as { __loop: Loop }).__loop.graph
      .getState()
      .nodes.map((n: any) => n.data.label as string),
  )
  expect(labels.length).toBeGreaterThan(50)
  for (const want of ['Niveau', 'Or', 'Pas écoulés', 'Récompense', 'Butin rare']) {
    expect(labels, `the French overlay must supply "${want}"`).toContain(want)
  }
  for (const no of ['Level', 'Gold', 'Elapsed steps', 'Reward']) {
    expect(labels, `"${no}" must not survive into a French document`).not.toContain(no)
  }
})

// ------------------------------------------------------------------ 8
test('French typography reaches the DOM as the exact codepoints', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'fr')

  // load one Template, then ask for a second — the replace dialog is the one
  // place that renders both French spacing rules at once
  const templates = page.locator('.toolbar__actions .menu').first()
  const pick = async (hasText: string) => {
    await templates.locator('> button').click()
    await templates.locator('.menu__pop [role="menuitem"]', { hasText }).click()
  }
  await pick('Ligne de production équilibrée')
  const firstConfirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await firstConfirm.isVisible().catch(() => false)) await firstConfirm.click()
  await pick('Blocage de capacité')

  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  const title = (await dlg.locator('.mcdlg__head').innerText()).trim()
  const body = (await dlg.locator('.mcdlg__note').innerText()).trim()

  // U+202F (narrow no-break space) before `?`, U+00A0 before `:` — neither
  // may arrive as an ASCII space, and neither may have been dropped
  expect(title, `title codepoints: ${[...title].map((c) => c.codePointAt(0)!.toString(16)).join()}`)
    .toBe('Charger ce modèle ?')
  expect(body).toContain('remplacé par : ')
  expect(body).not.toContain(' : ')
  expect(title).not.toContain(' ?')
  await dlg.getByRole('button').first().click()
})

// ------------------------------------------------------------------ 9
// French is the longest of the six languages, so overflow is measured
// DIFFERENTIALLY: the same sweep runs in English and in French and only what
// French adds counts. That removes every locale-independent artefact by
// construction (a glyph span whose ascender exceeds its line box reports
// `ovY: 2` in all six languages and is not a French defect).
test.describe('French length', () => {
  /** Every element that owns text — one with a direct, non-empty text node,
   *  so a chip (`<span glyph/>Réservoir`) is measured and a pure container is
   *  not. `text-overflow: ellipsis` is an opt-in truncation, not a defect. */
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

  /** Sweep the resting chrome, then each toolbar menu in turn. Keyed by the
   *  element's class, never by its text — the text is what differs. */
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
    // and every palette tooltip — `palette.<kind>.description` is the longest
    // French copy in the product and only exists while the chip is hovered
    const chips = p.locator('.palette-item')
    for (let i = 0; i < (await chips.count()); i++) {
      await chips.nth(i).hover()
      // all eight tips are in the DOM; the inactive ones are `display: none`,
      // so poll for one that is actually laid out before measuring
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

    const fr = await pageAt(page, 'fr-FR')
    await openApp(fr.page)
    expect(await htmlLang(fr.page)).toBe('fr')
    const frRows = await sweepChrome(fr.page)
    await fr.ctx.close()

    const added = frRows.filter((r) => !enRows.includes(r))
    expect(added, `French-only overflow (English baseline: ${enRows.length} rows)`).toEqual([])
  })

  test('the six longest glossary terms each fit where they are rendered', async ({ page }) => {
    const { ctx, page: p } = await pageAt(page, 'fr-FR')
    await openApp(p)

    const TERMS = [
      'réservoir',
      'aiguillage',
      'convertisseur',
      'valeur calculée',
      'espace de travail',
      'chronologie',
    ]

    /** Every element that owns text containing one of the terms, measured
     *  where it is laid out. A `title` attribute is not a box and cannot
     *  clip, so only rendered text counts. */
    const collect = () =>
      p.evaluate((wanted) => {
        const hits: { term: string; w: number; ovX: number; ovY: number; where: string }[] = []
        for (const el of document.querySelectorAll<HTMLElement>('body *')) {
          const own = [...el.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim()
            .toLowerCase()
          if (!own) continue
          if (el.offsetParent === null && el.clientWidth === 0) continue
          for (const term of wanted)
            if (own.includes(term))
              hits.push({
                term,
                w: Math.round(el.clientWidth),
                ovX: el.scrollWidth - el.clientWidth,
                ovY: el.scrollHeight - el.clientHeight,
                where: el.className || el.tagName.toLowerCase(),
              })
        }
        return hits
      }, TERMS)

    const hits: Awaited<ReturnType<typeof collect>> = []

    // A — the resting chrome: the four node kinds are palette chips
    hits.push(...(await collect()))

    // B — a selected node, so the Inspector names its kind
    await p.locator('.toolbar__palette .chip--register').click()
    await expect(p.locator('.inspector')).toBeVisible()
    hits.push(...(await collect()))

    // C — the workspace-save dialog, the one place `espace de travail` and
    // the timeline item are laid out rather than sitting in a `title`
    const file = p.locator('.toolbar__actions .menu').filter({ hasText: /Fichier/ })
    await file.locator('> button').click()
    await expect(file.locator('.menu__pop')).toBeVisible()
    hits.push(...(await collect()))
    await file.locator('.menu__pop [role="menuitem"]', { hasText: 'Workspace JSON' }).click()
    await expect(p.locator('.mcdlg')).toBeVisible()
    hits.push(...(await collect()))

    // the measurement is only worth something if every term was on screen —
    // a term that rendered nowhere must fail, not silently pass
    const found = [...new Set(hits.map((h) => h.term))].sort()
    expect(found, `rendered occurrences: ${hits.length}`).toEqual([...TERMS].sort())
    const clipped = hits.filter((h) => h.ovX > 1 || h.ovY > 1)
    expect(clipped, `clipped French terms: ${JSON.stringify(clipped)}`).toEqual([])

    await p.keyboard.press('Escape')
    await ctx.close()
  })
})
