import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// The toolbar locale-independent responsive contract
// (src/components/toolbar/*). At any given viewport the toolbar's row count and
// the Canvas top must be identical for EN / KO / JA — a longer katakana palette
// must not push the action buttons onto a second row the way it did before.
// The ⋯ overflow menu, decided by MEASURED width, absorbs the trailing
// controls; the build stamp is the last thing shed and always stays reachable.

const htmlLang = (p: Page) => p.evaluate(() => document.documentElement.lang)

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as any).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
  // let the measurement pass settle
  await page.waitForTimeout(120)
}

type Metrics = {
  toolbarH: number
  canvasTop: number
  mode: string
  toolbarRows: number
  stampGhosted: boolean
  anyButtonWraps: boolean
  docHScroll: boolean
  overlapsInspector: boolean
}

const readMetrics = (page: Page): Promise<Metrics> =>
  page.evaluate(() => {
    const tb = document.querySelector('.toolbar') as HTMLElement
    const canvas = (document.querySelector('.react-flow') ||
      document.querySelector('.canvas')) as HTMLElement
    const insp = document.querySelector('aside.inspector') as HTMLElement | null
    const r = (e: Element) => e.getBoundingClientRect()

    const kidTops = [...tb.children]
      .filter((c) => getComputedStyle(c).position !== 'absolute' && (c as HTMLElement).offsetParent !== null)
      .map((c) => Math.round(r(c).top))
      .sort((a, b) => a - b)
    let toolbarRows = kidTops.length ? 1 : 0
    for (let i = 1; i < kidTops.length; i++) if (kidTops[i] - kidTops[i - 1] > 6) toolbarRows++

    const buttons = [...tb.querySelectorAll('.btn, .chip')].filter(
      (b) => getComputedStyle(b).position !== 'absolute' && (b as HTMLElement).offsetParent !== null,
    ) as HTMLElement[]
    const anyButtonWraps = buttons.some((b) => b.scrollHeight > b.clientHeight + 1)

    let overlapsInspector = false
    if (insp) {
      const ir = r(insp)
      overlapsInspector = buttons.some((b) => {
        const br = r(b)
        return br.right > ir.left && br.left < ir.right && br.bottom > ir.top && br.top < ir.bottom
      })
    }

    const stamp = tb.querySelector('.toolbar__build') as HTMLElement

    return {
      toolbarH: Math.round(r(tb).height),
      canvasTop: Math.round(r(canvas).top),
      mode: tb.getAttribute('data-toolbar-mode') || '',
      toolbarRows,
      stampGhosted: stamp.hasAttribute('data-collapsed'),
      anyButtonWraps,
      docHScroll:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlapsInspector,
    }
  })

test.describe('toolbar — locale-independent responsive', () => {
  for (const width of [1920, 1600, 1280, 820]) {
    test(`EN / JA / KO agree on row count and canvas top at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)
      await resetAll(page)

      const byLocale: Record<string, Metrics> = {}
      for (const code of ['en', 'ja', 'ko']) {
        await setLocale(page, code)
        byLocale[code] = await readMetrics(page)
      }

      const en = byLocale.en
      for (const code of ['ja', 'ko']) {
        const m = byLocale[code]
        expect(m.toolbarH, `${code} toolbar height @ ${width}`).toBe(en.toolbarH)
        expect(m.canvasTop, `${code} canvas top @ ${width}`).toBe(en.canvasTop)
        expect(m.mode, `${code} mode @ ${width}`).toBe(en.mode)
        expect(m.toolbarRows, `${code} rows @ ${width}`).toBe(en.toolbarRows)
      }

      for (const [code, m] of Object.entries(byLocale)) {
        expect(m.anyButtonWraps, `${code} button label wraps @ ${width}`).toBe(false)
        expect(m.docHScroll, `${code} document h-scroll @ ${width}`).toBe(false)
        expect(m.overlapsInspector, `${code} toolbar overlaps inspector @ ${width}`).toBe(false)
      }

      if (width >= 1600) {
        for (const m of Object.values(byLocale)) expect(m.toolbarRows).toBe(1)
      }
      if (width === 820) {
        // controlled two rows — never a surprise third
        for (const m of Object.values(byLocale)) expect(m.toolbarRows).toBe(2)
      }
    })
  }

  test('resizing wide → narrow → wide recovers the layout (no locale change)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')

    const wide1 = await readMetrics(page)
    expect(wide1.toolbarRows).toBe(1)

    await page.setViewportSize({ width: 820, height: 900 })
    await page.waitForTimeout(200)
    const narrow = await readMetrics(page)
    expect(narrow.toolbarRows).toBe(2)
    expect(narrow.anyButtonWraps).toBe(false)
    expect(narrow.docHScroll).toBe(false)

    await page.setViewportSize({ width: 1920, height: 900 })
    await page.waitForTimeout(200)
    const wide2 = await readMetrics(page)
    expect(wide2.toolbarRows).toBe(1)
    expect(wide2.toolbarH).toBe(wide1.toolbarH)
    expect(wide2.stampGhosted).toBe(false)
  })

  test('the build stamp is only hidden when nothing else fits, and stays reachable', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    await page.setViewportSize({ width: 1920, height: 900 })
    await setLocale(page, 'ja')
    expect((await readMetrics(page)).stampGhosted).toBe(false)

    // the brand always carries the full version + sha (title + aria-label),
    // and the About dialog shows it verbatim — so hiding the inline stamp
    // never loses the information
    const brandTitle = await page.locator('.toolbar__brand').getAttribute('title')
    expect(brandTitle).toMatch(/v\d/)
    const brandAria = await page.locator('.toolbar__brand').getAttribute('aria-label')
    expect(brandAria).toBe(brandTitle)
  })

  test('an overflowed control is reachable with the mouse and the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')

    const moreBtn = page.locator('.toolbar__overflow-btn')
    await expect(moreBtn).toBeVisible()
    await expect(moreBtn).toHaveAttribute('aria-haspopup', 'menu')

    // mouse: open, the Import control is inside
    await moreBtn.click()
    const pop = page.locator('.toolbar__overflow-pop')
    await expect(pop).toBeVisible()
    await expect(pop.getByRole('button', { name: /インポート/ })).toBeVisible()

    // keyboard: Escape closes and returns focus to the trigger
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
    await expect(moreBtn).toBeFocused()

    // keyboard: re-open with the trigger focused
    await moreBtn.press('Enter')
    await expect(page.locator('.toolbar__overflow-pop')).toBeVisible()
  })
})

// A `row`-mode layout (≥ the breakpoint) is where the toolbar dropdowns were
// regressed: an `overflow: hidden` guard on the toolbar clipped every menu
// (Templates / Insert module / Export / Help / Language / ⋯) to the ~45px
// strip. These open a real dropdown at a wide viewport and assert it is fully
// on screen.
const fullyInViewport = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].filter(
      (e) => (e as HTMLElement).getBoundingClientRect().height > 0,
    ).pop() as HTMLElement | undefined
    if (!el) return { found: false, ok: false }
    const r = el.getBoundingClientRect()
    return {
      found: true,
      ok:
        r.top >= -2 &&
        r.left >= -2 &&
        r.right <= window.innerWidth + 2 &&
        r.bottom <= window.innerHeight + 2,
      h: Math.round(r.height),
    }
  }, selector)

test.describe('toolbar — dropdowns are never clipped by the responsive layout', () => {
  for (const width of [1920, 1280]) {
    test(`Templates + Language open fully on screen at ${width}px, every locale`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)
      await resetAll(page)

      for (const code of ['en', 'ja', 'ko']) {
        await setLocale(page, code)

        await page
          .locator('.toolbar__actions .menu > button')
          .first()
          .click() // Templates ▾
        const tpl = await fullyInViewport(page, '.toolbar__actions .menu__pop:not(.toolbar__overflow-pop)')
        expect(tpl.found, `${code} @ ${width} — Templates pop`).toBe(true)
        expect(tpl.ok, `${code} @ ${width} — Templates pop on screen`).toBe(true)
        await page.keyboard.press('Escape')

        // Language — inline at these widths
        const langBtn = page.locator('.toolbar__slot .lang-switch')
        await langBtn.click()
        const lang = await fullyInViewport(page, '.lang-menu__pop')
        expect(lang.found, `${code} @ ${width} — Language pop`).toBe(true)
        expect(lang.ok, `${code} @ ${width} — Language pop on screen`).toBe(true)
        await page.keyboard.press('Escape')
      }
    })
  }

  test('⋯ → Language: opens on screen, selecting a locale closes both menus', async ({ page }) => {
    // 726px (6px above the 720px mobile breakpoint — src/ui/media.ts — the
    // narrowest legal desktop width) used to be enough on its own to push
    // JA's own long labels (esp. "モジュールを挿入 ▾") past the toolbar's
    // available width, forcing Language into the ⋯ overflow. That margin was
    // font-metric-dependent: fixing the JA CJK font fallback (src/index.css
    // :lang(ja)) legitimately renders JA more compactly on some platforms,
    // and 726px alone stopped forcing the overflow there — with no narrower
    // *desktop* width available to retry (below 720px flips to the entirely
    // different mobile toolbar). Keeping the viewport AT 726px (still
    // desktop) and additionally pinning `.toolbar`'s own measured width via
    // injected CSS — the actual value `useToolbarOverflow`'s ResizeObserver
    // watches — to a width no locale's labels could ever fit makes the
    // overflow condition reproducible regardless of which CJK font any given
    // platform substitutes, without touching any product CSS.
    await page.setViewportSize({ width: 726, height: 640 })
    await openApp(page)
    await resetAll(page)
    await page.addStyleTag({ content: '.toolbar { max-width: 480px !important; }' })
    await setLocale(page, 'ja')

    // still the desktop layout at this viewport, and the inline Language
    // button (rendered when it fits) is genuinely gone, not just occluded
    expect(await page.locator('.toolbar--mobile').count()).toBe(0)
    expect(await page.locator('.toolbar__slot .lang-switch').count()).toBe(0)

    const moreBtn = page.locator('.toolbar__overflow-btn')
    await moreBtn.click()
    const overflowPop = page.locator('.toolbar__overflow-pop')
    await expect(overflowPop).toBeVisible()

    const langBtn = overflowPop.locator('.lang-switch')
    await expect(langBtn).toBeVisible()
    await langBtn.click()
    const lang = await fullyInViewport(page, '.lang-menu__pop')
    expect(lang.found).toBe(true)
    expect(lang.ok, 'nested Language pop on screen').toBe(true)

    // Escape: first the Language menu (focus back to its trigger)…
    await page.keyboard.press('Escape')
    await expect(page.locator('.lang-menu__pop')).toBeHidden()
    await expect(langBtn).toBeFocused()
    // …then the ⋯ menu (focus back to its trigger)
    await page.keyboard.press('Escape')
    await expect(overflowPop).toBeHidden()
    await expect(moreBtn).toBeFocused()

    // re-open and actually pick English → both menus gone, locale changed
    await moreBtn.click()
    await overflowPop.locator('.lang-switch').click()
    await page.locator('.lang-menu__pop [role="option"][data-locale="en"]').click()
    await expect.poll(() => htmlLang(page)).toBe('en')
    await expect(page.locator('.lang-menu__pop')).toBeHidden()
    await expect(page.locator('.toolbar__overflow-pop')).toBeHidden()
  })

  test('a nested Export dropdown from ⋯ stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')

    await page.locator('.toolbar__overflow-btn').click()
    const exportBtn = page
      .locator('.toolbar__overflow-pop .menu > button')
      .filter({ hasText: /エクスポート/ })
    await exportBtn.click()
    const exp = await fullyInViewport(page, '.toolbar__overflow-pop .menu__pop:not(.toolbar__overflow-pop)')
    expect(exp.found).toBe(true)
    expect(exp.ok, 'nested Export pop on screen').toBe(true)
  })
})
