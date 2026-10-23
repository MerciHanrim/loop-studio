import type { Page } from '@playwright/test'
import { expect, importGraph, test } from './support/loop'

// Issue #303 — the playback bar keeps to its space.
//
// MEASURED on main 3ce52f4 before the change. Mobile: the canvas reserved a
// constant 52 px for the fixed run bar while the bar wrapped to two rows (101
// px) at 320 and 340 px in every language, at 360 px in eleven, and at 390 px
// in six (es-419, pt-BR, es-ES, pt-PT, ru, tr); one row was 53 px. 49 px of
// canvas and the whole attribution line sat under the bar, and the sheets were
// anchored 49 px too low. Desktop: the collapsed timeline kept a constant 40 px
// while its playback strip wrapped to 65 px (94 px in German and Russian at
// 721 px), so the wrapped controls lay 25 to 54 px below the window.
//
// The contract: whatever the bar's height is, the space the layout gives it
// is the same number. Nothing of the canvas is under the bar, and every control
// in the bar is inside the window. The checks here read the real boxes, in the
// shipped languages and in right-to-left.
//
// §L2.0 (2026-10): en and ko are the shipped languages; the RTL pseudo-locale
// `ar-XB` (English copy under `dir=rtl`) stands for the retired `ar`. The
// eighteen-language version is kept in archive/i18n/e2e/run-bar-fit.spec.ts.

const LOCALE_KEY = 'loop-studio/ui-locale/1'
// the shipped languages, and right-to-left
const LOCALES = ['en', 'ko', 'ar-XB']
const ALL = ['en', 'ko']
const PHONES = [
  [320, 568],
  [320, 640],
  [340, 640],
  [360, 640],
  [375, 667],
  [390, 844],
] as const
const WINDOWS = [
  [721, 800],
  [800, 600],
  [800, 800],
  [900, 800],
  [950, 800],
  [1000, 800],
] as const

async function boot(page: Page, width: number, height: number, locale: string) {
  await page.setViewportSize({ width, height })
  await page.addInitScript(
    ({ key, locale }) => {
      try {
        localStorage.setItem(key, locale)
      } catch {
        /* ignore */
      }
    },
    { key: LOCALE_KEY, locale },
  )
  await page.goto('/')
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  await page.waitForFunction((l) => document.documentElement.lang === l, locale)
}

/** the mobile bar against everything that must keep clear of it */
const mobileFit = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.pstrip--mobile') as HTMLElement
    const b = bar.getBoundingClientRect()
    const canvas = document.querySelector('.canvas-col .canvas') as HTMLElement
    const c = canvas.getBoundingClientRect()
    const reserved = parseFloat(getComputedStyle(canvas).paddingBottom)
    const attribution = document.querySelector('.react-flow__attribution')?.getBoundingClientRect() ?? null
    const controls = document.querySelector('.react-flow__controls')?.getBoundingClientRect() ?? null
    const buttons = [...bar.querySelectorAll('button')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
        height: Math.round(r.height),
        inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5,
      }
    })
    const round = (v: number) => Math.round(v * 10) / 10
    return {
      barHeight: round(b.height),
      barAtBottom: Math.abs(b.bottom - innerHeight) < 0.5,
      reserved: round(reserved),
      // the canvas's own content box ends where the bar begins
      contentBottom: round(c.bottom - reserved),
      barTop: round(b.top),
      attributionBottom: attribution ? round(attribution.bottom) : null,
      controlsBottom: controls ? round(controls.bottom) : null,
      buttons,
      sideways: document.documentElement.scrollWidth > innerWidth,
      variable: getComputedStyle(document.documentElement).getPropertyValue('--mob-runbar-real').trim(),
    }
  })

/** the desktop strip against the window and its collapsed timeline */
const desktopFit = (page: Page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.pstrip') as HTMLElement
    const s = strip.getBoundingClientRect()
    const timeline = document.querySelector('.timeline') as HTMLElement
    const t = timeline.getBoundingClientRect()
    const controls = [...strip.querySelectorAll<HTMLElement>('button, input')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || (el as HTMLInputElement).type || '').trim().slice(0, 24),
        pastBottom: Math.max(0, Math.round(r.bottom - innerHeight)),
        pastRight: Math.max(0, Math.round(r.right - innerWidth)),
      }
    })
    return {
      stripHeight: Math.round(s.height),
      stripBottomPastWindow: Math.round(s.bottom - innerHeight),
      collapsed: timeline.classList.contains('is-collapsed'),
      timelineHeight: Math.round(t.height),
      cutOff: controls.filter((c) => c.pastBottom > 0 || c.pastRight > 0),
      controls: controls.length,
    }
  })

function expectMobileFit(f: Awaited<ReturnType<typeof mobileFit>>) {
  expect(f.barAtBottom, 'the bar is at the bottom of the viewport').toBe(true)
  // one height, measured, read by the layout
  expect(f.variable, 'the bar wrote its measured height').toMatch(/^\d+px$/)
  expect(Math.abs(f.reserved - f.barHeight), `reserved ${f.reserved} vs bar ${f.barHeight}`).toBeLessThanOrEqual(1)
  expect(f.contentBottom, 'no canvas content under the bar').toBeLessThanOrEqual(f.barTop + 0.5)
  expect(f.attributionBottom, 'the attribution line is above the bar').not.toBeNull()
  expect(f.attributionBottom!).toBeLessThanOrEqual(f.barTop + 0.5)
  if (f.controlsBottom != null) expect(f.controlsBottom, 'the zoom controls are above the bar').toBeLessThanOrEqual(f.barTop + 0.5)
  expect(f.buttons.length).toBeGreaterThanOrEqual(5)
  for (const b of f.buttons) {
    expect(b.inside, `${b.name} is inside the viewport`).toBe(true)
    expect(b.height, `${b.name} keeps its touch height`).toBeGreaterThanOrEqual(40)
  }
  expect(f.sideways).toBe(false)
}

test.describe('the run bar on a phone keeps to its space', () => {
  for (const [width, height] of PHONES) {
    for (const locale of LOCALES) {
      test(`${width}x${height} ${locale}: the canvas, the attribution line and the zoom controls are above the bar`, async ({ page }) => {
        await boot(page, width, height, locale)
        const f = await mobileFit(page)
        expectMobileFit(f)
      })
    }
  }

  test('320px, every shipped language: the measured height is the reserved height', async ({ page }) => {
    for (const locale of ALL) {
      await boot(page, 320, 640, locale)
      const f = await mobileFit(page)
      expectMobileFit(f)
      // at this width the bar is two rows in every language: the case that was wrong
      expect(f.barHeight, `${locale}: two rows`).toBeGreaterThan(90)
    }
  })

  test('390px right-to-left (ar-XB): the bar is right-to-left and still inside the viewport', async ({ page }) => {
    await boot(page, 390, 844, 'ar-XB')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    expectMobileFit(await mobileFit(page))
  })

  test('the sheets and the Timeline sheet sit on the measured bar, not on the constant', async ({ page }) => {
    await boot(page, 320, 640, 'ko')
    const f = await mobileFit(page)
    expect(f.barHeight).toBeGreaterThan(90)
    // the More sheet: its scrim keeps the panel above the bar
    await page.locator('.mob-more').click()
    const sheet = page.locator('.sheet')
    await expect(sheet).toBeVisible()
    const s = await sheet.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(s, 'the More sheet ends where the bar begins').toBeLessThanOrEqual(f.barTop + 0.5)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    // the Timeline sheet is anchored on the bar
    await page.locator('.pstrip--mobile .pstrip__tl').click()
    const tl = page.locator('.timeline--sheet')
    await expect(tl).toBeVisible()
    const tb = await tl.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(Math.abs(tb - f.barTop), 'the Timeline sheet sits on the bar').toBeLessThanOrEqual(1)
  })

  test('a bar that gains a row for a run refusal is still the reserved height', async ({ page }) => {
    await boot(page, 390, 844, 'en')
    const before = await mobileFit(page)
    // a graph the engine refuses to initialise: a Pool with a negative initial
    // value, the way e2e/mobile.spec.ts makes one
    const bad = await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { exportJSON: () => string } } } }).__loop.graph.getState()
      const doc = JSON.parse(g.exportJSON()) as { nodes: { data: { kind: string; initial?: number } }[] }
      const pool = doc.nodes.find((n) => n.data.kind === 'pool')
      if (!pool) throw new Error('the sample has no pool')
      pool.data.initial = -5
      return JSON.stringify(doc)
    })
    await importGraph(page, bad)
    await expect(page.locator('.pstrip__initerr--mobile')).toBeVisible()
    const after = await mobileFit(page)
    expect(after.barHeight).toBeGreaterThan(before.barHeight)
    expectMobileFit(after)
  })
})

test.describe('the playback strip in a narrow desktop window stays inside the window', () => {
  for (const [width, height] of WINDOWS) {
    for (const locale of ['en', 'ko', 'ar-XB']) {
      // 2026-10-20 (Lumi): the analysis area opens expanded (§7), and the
      // desktop strip is ONE row at every width — short of room it folds the
      // Monte-Carlo button and then Speed / Seed into Run settings
      test(`${width}x${height} ${locale}: expanded and folded, one row, no control past the window`, async ({ page }) => {
        await boot(page, width, height, locale)
        const expanded = await desktopFit(page)
        expect(expanded.collapsed).toBe(false)
        expect(expanded.controls).toBeGreaterThanOrEqual(7)
        expect(expanded.stripHeight, 'expanded: one row').toBe(40)
        expect(expanded.cutOff, 'expanded: controls past the window').toEqual([])
        expect(expanded.timelineHeight).toBeGreaterThan(expanded.stripHeight)
        await page.locator('.pstrip__collapse').click()
        const folded = await desktopFit(page)
        expect(folded.collapsed).toBe(true)
        expect(folded.cutOff, 'folded: controls past the window').toEqual([])
        expect(folded.stripBottomPastWindow).toBeLessThanOrEqual(0)
        // the folded timeline is exactly its strip, one row
        expect(folded.timelineHeight).toBe(folded.stripHeight)
        expect(folded.stripHeight).toBe(40)
      })
    }
  }

  test('1280x800: the strip is one row of 40px, as before; a run that ended keeps it one row', async ({ page }) => {
    await boot(page, 1280, 800, 'en')
    const f = await desktopFit(page)
    expect(f.stripHeight).toBe(40)
    expect(f.cutOff).toEqual([])
    // the ended note and Replay are wider than Play and the step readout
    await page.evaluate(() => {
      const s = (window as unknown as { __loop: { sim: { getState: () => { advance: () => void }; setState: (p: object) => void } } }).__loop.sim
      for (let i = 0; i < 12; i++) s.getState().advance()
      s.setState({ status: 'ended' })
    })
    await expect(page.locator('.pstrip .pb-btn--primary')).toContainText('Replay')
    const ended = await desktopFit(page)
    expect(ended.stripHeight, 'ended: still one row').toBe(40)
    expect(ended.cutOff).toEqual([])
  })

  test('folded into Run settings, Speed and Seed are the same two controls, reached from the row and closed with Escape', async ({ page }) => {
    await boot(page, 1280, 800, 'en')
    // a strip short enough to fold them: the canvas column pinned narrow
    await page.addStyleTag({ content: '.canvas-col { max-width: 360px !important; }' })
    const strip = page.locator('.pstrip')
    // fit step 2 or 3: both fold Speed and Seed into Run settings (3 also lets
    // the steady-state text shorten). 360 px sits near the boundary between
    // them: on a CI runner it measured 3 where this machine measured 2 (PR
    // #361, 2026-10-23), so the step itself is not what this test pins
    await expect.poll(() => strip.getAttribute('data-fit')).toMatch(/^[23]$/)
    await expect(strip.locator('.pstrip__mc-btn')).toBeHidden()
    const btn = strip.getByRole('button', { name: 'Run settings' })
    await expect(btn).toBeVisible()
    // folded: neither input is shown in the row
    await expect(strip.locator('input[type="range"]')).toBeHidden()
    await expect(strip.locator('input[type="number"]')).toBeHidden()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    const pop = page.locator(`[id="${await btn.getAttribute('aria-controls')}"]`)
    await expect(pop.locator('input[type="range"]')).toBeVisible()
    await expect(pop.locator('input[type="number"]')).toBeVisible()
    // the same store: the seed set here is the run's seed, the speed the run's speed
    type Sim = { __loop: { sim: { getState: () => { seed: number; speedMs: number } } } }
    await pop.locator('input[type="number"]').fill('7')
    expect(await page.evaluate(() => (window as unknown as Sim).__loop.sim.getState().seed)).toBe(7)
    const speed0 = await page.evaluate(() => (window as unknown as Sim).__loop.sim.getState().speedMs)
    const range = pop.locator('input[type="range"]')
    await range.fill(String(Number(await range.getAttribute('max')) === Number(await range.inputValue()) ? await range.getAttribute('min') : await range.getAttribute('max')))
    await expect.poll(() => page.evaluate(() => (window as unknown as Sim).__loop.sim.getState().speedMs), { message: 'the speed set here is the run’s speed' }).not.toBe(speed0)
    await page.keyboard.press('Escape')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(btn).toBeFocused()
    // Monte Carlo has its way in: Run ▸ Monte Carlo…
    await page.locator('[data-menu="run"] > .wb-mb').click()
    await expect(page.locator('[data-menu="run"] [role="menuitem"]', { hasText: 'Monte Carlo' })).toBeEnabled()
  })
})
