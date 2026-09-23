import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// German (`de`), the SEVENTH shipped language. Written RED-FIRST against the
// unmodified product. docs/localization.md §L2.12 (region policy), §L2.11
// (`Zeichen` vs `Spalte`), §L5.4–§L5.5 (the picker's search box, already
// shipped with `fr` — German only adds its own search contract).
//
//   1 de, de-DE, de-AT, de-CH, de-LI, de-LU and any de-* reach German
//   2 the six existing locales are untouched (invariance)
//   3 a stored `de` survives a reload; an unregistered value falls back
//   4 the picker offers Deutsch, tagged with its own language
//   5 `de` / `German` / `Deutsch` all find it; 7 options in dev
//   6 the template-label dictionary loads — German labels, not English
//   7 a parser position is `Zeichen`, a real table column is `Spalte`
//   8 German compounds do not overflow any chrome English already fits
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

/** The language trigger lives inside Settings; taken structurally so this
 *  spec works whatever language the UI is in (§L5.3). */
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

/** two nodes and one edge — enough to select a connection and show Route */
const TWO_NODE_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const pop = (page: Page) => page.locator('.lang-menu__pop')
const search = (page: Page) => page.locator('.lang-menu__pop .lang-menu__search')
const options = (page: Page) => page.locator('.lang-menu__pop [role="option"]')
const option = (page: Page, code: string) =>
  page.locator(`.lang-menu__pop .lang-menu__item[data-locale="${code}"]`)

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
test.describe('a German browser', () => {
  // Austria, Switzerland, Liechtenstein and Luxembourg all land on the ONE
  // German catalog through the ordinary base-subtag rule. It is Germany
  // Standard German and does not pretend otherwise (§L2.12).
  for (const tag of ['de-DE', 'de-AT', 'de-CH', 'de-LI', 'de-LU', 'de']) {
    test(`${tag} reaches German, not English`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe('de')
      await ctx.close()
    })
  }
})

// ------------------------------------------------------------------ 2
test.describe('the six existing locales are unaffected', () => {
  for (const [tag, want] of [
    ['en-US', 'en'],
    ['ko-KR', 'ko'],
    ['ja-JP', 'ja'],
    ['zh-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['fr-FR', 'fr'],
    ['nl-NL', 'en'], // still unregistered — German must not have widened this
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
test('a stored de survives a reload; a region-tagged value is not a code', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' })
  const page = await ctx.newPage()
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'de'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('de')

  // `de-AT` is a browser tag, never a stored CODE
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'de-AT'))
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
  await ctx.close()
})

// ------------------------------------------------------------------ 4 + 5
test('the picker offers Deutsch, tagged as its own language', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openLanguageMenu(page)
  const row = pop(page).locator('.lang-menu__item').filter({ hasText: 'Deutsch' })
  await expect(row, 'the picker must offer German').toHaveCount(1)
  const tagged = row.locator('[lang="de"]')
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toHaveText('Deutsch')
  await expect(row.locator('.menu__blurb')).toHaveText('German') // English UI

  await row.click()
  await expect.poll(() => htmlLang(page)).toBe('de')
  expect(await stored(page)).toBe('de')
  await expect(page.locator('.toolbar__settingsmenu > button')).toHaveText('Einstellungen ▾')
})

test('German is findable by code, English name and endonym', async ({ page }) => {
  await openApp(page)
  await openLanguageMenu(page)
  // seven shipped languages + the dev pseudo-locale
  await expect(options(page)).toHaveCount(11)
  for (const q of ['de', 'German', 'Deutsch', 'deutsch', 'DEUTSCH']) {
    await search(page).fill(q)
    await expect(option(page, 'de'), `query ${JSON.stringify(q)} must find German`).toHaveCount(1)
  }
})

// ------------------------------------------------------------------ 6
test('a bundled Template opens with German node labels', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'de')

  const templates = page.locator('.toolbar__actions .menu').first()
  await templates.locator('> button').click()
  await expect(templates.locator('.menu__pop')).toBeVisible()
  // by NAME, not position — the German name also proves the Templates menu
  // itself is translated
  await templates.locator('.menu__pop [role="menuitem"]', { hasText: 'MMO' }).click()
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()

  const labels = await page.evaluate(() =>
    (window as unknown as { __loop: Loop }).__loop.graph
      .getState()
      .nodes.map((n: any) => n.data.label as string),
  )
  expect(labels.length).toBeGreaterThan(50)
  // `Gold` and `XP` are deliberately absent from this list: they are the
  // same word in German, so finding them proves nothing either way
  for (const no of ['Level', 'Elapsed steps', 'Reward', 'Rare loot', 'Clock'])
    expect(labels, `"${no}" must not survive into a German document`).not.toContain(no)
  // and the overlay actually supplied German
  expect(labels.some((l: string) => /[äöüÄÖÜß]/.test(l) || /ung\b|keit\b|punkte/i.test(l))).toBe(true)
})

// ------------------------------------------------------------------ 7
// §L2.11 — `{column}` is a CHARACTER offset in a parser error and a real
// TABLE column in `import.loc.*`. German must not use one word for both.
test('a parser position is Zeichen; a real table column is Spalte', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'de')

  const catalog = (key: string) =>
    page.evaluate(
      (k) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog[k] as string,
      key,
    )

  for (const key of [
    'error.EXPR_SYNTAX.message',
    'error.EXPR_UNCLOSED_PAREN.message',
    'error.EXPR_UNCLOSED_REF.message',
    'error.EXPR_BAD_ESCAPE.message',
    'error.EXPR_NUMBER_RANGE.message',
    'error.EXPR_BAD_TOKEN.message',
    'import.parseError',
  ]) {
    const v = await catalog(key)
    expect(v, `${key} must name a character position`).toMatch(/Zeichen/)
    expect(v, `${key} must not borrow the table-column word`).not.toMatch(/Spalte/)
  }
  for (const key of [
    'import.loc.tableColumnHeader',
    'import.loc.tableRowColumn',
    'import.loc.tableRowColumnHeader',
  ]) {
    const v = await catalog(key)
    expect(v, `${key} is a real table column`).toMatch(/Spalte/)
    expect(v, `${key} must not borrow the character word`).not.toMatch(/Zeichen/)
  }
})

// ------------------------------------------------------------------ 8
// German compounds are the length risk. Measured DIFFERENTIALLY: the same
// sweep runs in English and in German and only what German ADDS counts, so
// locale-independent artefacts drop out by construction.
test.describe('German length', () => {
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

    const de = await pageAt(page, 'de-DE')
    await openApp(de.page)
    expect(await htmlLang(de.page)).toBe('de')
    const deRows = await sweepChrome(de.page)
    await de.ctx.close()

    const added = deRows.filter((r) => !enRows.includes(r))
    expect(added, `German-only overflow (English baseline: ${enRows.length} rows)`).toEqual([])
  })
})

// ------------------------------------------------------------------ 9
// The two longest terms the German glossary introduces, measured where they
// actually render rather than assumed to fit. `Berechneter Wert` was chosen
// over the shorter `Rechenwert` for clarity, so its width is a decision that
// has to be checked, not a side effect (§L2.12).
test('the longest German terms fit where they are rendered', async ({ page }) => {
  const { ctx, page: p } = await pageAt(page, 'de-DE')
  await openApp(p)
  expect(await htmlLang(p)).toBe('de')

  // `Berechneter Wert` — palette chip, and the Inspector once one is placed
  await p.locator('.toolbar__palette .chip--register').click()
  await expect(p.locator('.inspector')).toBeVisible()
  const withRegister = await p.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.includes('Berechneter Wert')))
      .map((e) => {
        const el = e as HTMLElement
        return { term: 'Berechneter Wert', w: Math.round(el.clientWidth), ovX: el.scrollWidth - el.clientWidth, ovY: el.scrollHeight - el.clientHeight, where: el.className || el.tagName.toLowerCase() }
      }),
  )

  // `Linienführung` is the Route field, which only exists for a selected EDGE
  await importGraph(p, TWO_NODE_GRAPH)
  // select it through the documented keyboard contract rather than by
  // geometry — the imported graph is not fitted to the viewport
  await p.locator('.react-flow__edge').first().evaluate((el) => (el as SVGElement).focus())
  await p.keyboard.press('Enter')
  await expect(p.locator('.inspector')).toContainText('Linienführung')

  const TERMS = ['Berechneter Wert', 'Linienführung', 'Gruppenrahmen', 'Produktionsschritt']
  const found = await p.evaluate((wanted) => {
    const hits: { term: string; w: number; ovX: number; ovY: number; where: string }[] = []
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
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

  // the two that must be on screen in this state
  found.push(...withRegister)
  const seen = new Set(found.map((h) => h.term))
  expect([...seen].sort(), `measured: ${JSON.stringify(found)}`).toContain('Berechneter Wert')
  expect([...seen]).toContain('Linienführung')

  const clipped = found.filter((h) => h.ovX > 1 || h.ovY > 1)
  expect(clipped, `clipped German terms: ${JSON.stringify(clipped)}`).toEqual([])
  await ctx.close()
})
