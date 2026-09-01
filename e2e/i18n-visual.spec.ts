import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

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
// regression cover is not lost. Non-deterministic chrome (the build stamp) is
// masked; fonts are awaited; nothing is animated (config `animations:disabled`).

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

async function pickLocale(page: Page, code: string, scope = '') {
  const trigger = page.locator(`${scope} .lang-switch`.trim()).first()
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.locator(`${scope} .lang-menu__item[data-locale="${code}"]`.trim()).click()
  await expect.poll(() => htmlLang(page)).toBe(code)
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
  mask: [page.locator('.toolbar__build'), page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')],
  maxDiffPixelRatio: 0.02,
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
    await expect(page).toHaveScreenshot('ko-desktop-app.png', shot(page))
  })

  test('desktop — Inspector, KO, node selected', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('pool', null))
    await fontsReady(page)
    await expect(page.locator('aside.inspector')).toHaveScreenshot('ko-inspector.png', { maxDiffPixelRatio: 0.02 })
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
    await expect(page.locator('.mcdlg')).toHaveScreenshot('ko-monte-carlo.png', {
      mask: [page.locator('.mcdlg__costline > :not(.mcdlg__costlabel)')],
      maxDiffPixelRatio: 0.02,
    })
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
    await expect(page.locator('.review')).toHaveScreenshot('ko-review.png', { maxDiffPixelRatio: 0.02 })
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
    await expect(page).toHaveScreenshot('ko-long-label-and-tip.png', shot(page))
  })

  test('desktop — Export menu open (overflow risk), KO', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await expect(page.locator('.react-flow__node[data-id="pool"]')).toBeVisible()
    await pinViewport(page)
    await page.locator('.toolbar__actions .menu > button', { hasText: /내보내기/ }).click()
    await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()
    await fontsReady(page)
    await expect(page).toHaveScreenshot('ko-export-menu.png', shot(page))
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
    await fontsReady(page)
    await expect(page).toHaveScreenshot('ko-mobile-app.png', {
      mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')],
      maxDiffPixelRatio: 0.02,
    })
  })
})
