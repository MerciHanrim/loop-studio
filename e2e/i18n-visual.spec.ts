import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/localization.md §L13 — Slice 3, the REPRESENTATIVE Korean reference
// screenshots. Lumi's call (over a full ~30-image KO pixel matrix, which is
// brittle and high-maintenance): keep functional / DOM assertions as the real
// gate (i18n.spec.ts + i18n-acceptance.spec.ts) and pin only the few
// high-risk KO scenes as images:
//
//   desktop full screen · mobile · Inspector · Monte Carlo · Review overlay ·
//   a long Korean label + a tooltip · a menu/dialog overflow risk (Export).
//
// The existing EN visual-regression baselines are untouched, so whole-design
// regression cover is not lost. The minimap + attribution are masked (the
// toolbar build stamp no longer renders on the bar since the two-tier toolbar,
// #207); fonts are awaited; nothing is animated (config `animations:disabled`).

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 40, y: 60 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 320, y: 60 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } }],
})

// a long Korean label — model data (verbatim), used only to see how a wide CJK
// string sits in the node box and the Inspector field.
const LONG_KO = '창고에서 조립 라인을 거쳐 출하까지 이어지는 아주 긴 한국어 노드 이름'
const G_LONG = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 40, y: 60 }, data: { kind: 'source', label: '입고', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 340, y: 60 }, data: { kind: 'pool', label: LONG_KO, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } }],
})

const PROPOSAL_CLEAN = readFileSync(
  resolve(import.meta.dirname, '..', 'examples', 'revision', 'proposal.clean.json'),
  'utf8',
)

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

// docs/toolbar-responsive.md — Language is now a `Settings ▾` row on
// desktop (Hanrim's visual review, 2026-09-15); its trigger only exists
// once Settings is open.
async function pickLocale(page: Page, code: string, scope = '') {
  const trigger = page.locator(`${scope} .lang-switch`.trim()).first()
  let openedSettings = false
  if (!scope && !(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定) ▾$/ }).click()
    openedSettings = true
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.locator(`${scope} .lang-menu__item[data-locale="${code}"]`.trim()).click()
  await expect.poll(() => htmlLang(page)).toBe(code)
  if (openedSettings) await page.keyboard.press('Escape')
}

const fontsReady = (page: Page) =>
  page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)

/** pin the canvas transform so a full-screen shot is not at the mercy of a
 *  fitView frame (same technique as canvas-refresh-visual.spec.ts). */
async function pinViewport(page: Page, zoom = 1) {
  await page.evaluate(
    (z) => (window as any).__loop.rf.setViewport({ x: 60, y: 90, zoom: z }, { duration: 0 }),
    zoom,
  )
  await page.waitForTimeout(120)
}

const shot = (page: Page) => ({
  mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')],
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — representative KO reference screenshots', () => {
  test('desktop — full screen, KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await expect(page.locator('.react-flow__node[data-id="pool"]')).toBeVisible()
    await pinViewport(page)
    await fontsReady(page)
    await expect(page).toHaveScreenshot(...snap(page, 'ko-desktop-app', shot(page)))
  })

  test('desktop — Inspector, KO, node selected', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('pool', null))
    await fontsReady(page)
    await expect(page.locator('aside.inspector')).toHaveScreenshot(...snap(page, 'ko-inspector'))
  })

  test('desktop — Monte Carlo dialog, KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await page.locator('.pstrip__mc button').click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    // let the local benchmark resolve so the KO metric labels (로컬 기준 성능 /
    // 실행 방식 / 메모리) are on screen; the machine-specific values are masked.
    await expect(page.locator('.mcdlg__costlabel').first()).toBeVisible()
    await fontsReady(page)
    await expect(page.locator('.mcdlg')).toHaveScreenshot(
      ...snap(page, 'ko-monte-carlo', { mask: [page.locator('.mcdlg__costline > :not(.mcdlg__costlabel)')] }),
    )
  })

  test('desktop — Review overlay, KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'p.json',
      mimeType: 'application/json',
      buffer: Buffer.from(PROPOSAL_CLEAN),
    })
    await expect(page.locator('.review')).toBeVisible()
    await fontsReady(page)
    await expect(page.locator('.review')).toHaveScreenshot(...snap(page, 'ko-review'))
  })

  test('desktop — a long Korean node label + a palette tooltip, KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G_LONG)
    await pickLocale(page, 'ko')
    await expect(page.locator('.react-flow__node[data-id="pool"]')).toBeVisible()
    await pinViewport(page)
    // surface the two-layer palette tip (name / description / how-to) in KO
    await page.locator('.palette-item .chip--register').hover()
    await expect(page.locator('#palette-tip-register')).toBeVisible()
    await fontsReady(page)
    // docs/mmo-multilingual-layout.md — the long label is shown IN FULL, wrapped
    // inside a grown vessel, never a one-line ellipsis. Asserted in the DOM
    // because a return to the ellipsis would still pass the pixel gate's 2 %
    // tolerance (the committed baseline was exactly that until 2026-09-19).
    const lbl = await page.evaluate(() => {
      const wrap = document.querySelector('.react-flow__node[data-id="pool"]')!
      const nf = wrap.querySelector('.nodef') as HTMLElement
      const title = wrap.querySelector('.nodef__title') as HTMLElement
      const lineH = parseFloat(getComputedStyle(title).lineHeight) || 16
      const n = nf.getBoundingClientRect()
      const t = title.getBoundingClientRect()
      return {
        lines: Math.round(title.offsetHeight / lineH),
        clippedX: title.scrollWidth > title.clientWidth + 1,
        clippedY: title.scrollHeight > title.clientHeight + 1,
        inside: t.left >= n.left - 1 && t.right <= n.right + 1 && t.top >= n.top - 1 && t.bottom <= n.bottom + 1,
      }
    })
    expect(lbl.lines, 'the label wraps (not a single ellipsised line)').toBeGreaterThan(1)
    expect(lbl.clippedX, 'no sideways clipping').toBe(false)
    expect(lbl.clippedY, 'no vertical clipping').toBe(false)
    expect(lbl.inside, 'the title sits inside the node box').toBe(true)
    await expect(page).toHaveScreenshot(...snap(page, 'ko-long-label-and-tip', shot(page)))
  })

  test('desktop — Export menu open (overflow risk), KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await expect(page.locator('.react-flow__node[data-id="pool"]')).toBeVisible()
    await pinViewport(page)
    await page.locator('.toolbar__actions .menu > button', { hasText: /파일/ }).click()
    await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()
    await fontsReady(page)
    await expect(page).toHaveScreenshot(...snap(page, 'ko-export-menu', shot(page)))
  })
})

test.describe('i18n Slice 3 — representative KO reference screenshots (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('mobile — full screen, KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    // the language menu lives in the mobile More sheet
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await pickLocale(page, 'ko', '.sheet')
    await page.locator('.sheet__x').click()
    await expect(page.locator('.sheet')).toBeHidden()
    await expect(page.locator('.react-flow__node[data-id="pool"]')).toBeVisible()
    await pinViewport(page)
    // this is the PINNED frame (zoom 1), not the phone's first-paint auto-fit —
    // pinned so the baseline cannot drift back to a zoomed-out canvas inside
    // the pixel tolerance
    expect(
      await page.evaluate(
        () => (window as unknown as { __loop: { rf: { getViewport: () => { zoom: number } } } }).__loop.rf.getViewport().zoom,
      ),
    ).toBe(1)
    await fontsReady(page)
    await expect(page).toHaveScreenshot(
      ...snap(page, 'ko-mobile-app', { mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')] }),
    )
  })
})
