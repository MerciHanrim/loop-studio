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
