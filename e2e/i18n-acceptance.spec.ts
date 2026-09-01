import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L13 — Slice 3, acceptance validation.
//
// The per-feature localization is proved surface-by-surface in i18n.spec.ts.
// THIS file is the cross-surface acceptance sweep Lumi asked for:
//
//   1. every §L6 surface, rendered in KO, must not scroll the document
//      sideways, must keep its own container inside the viewport, and a very
//      long Korean string must ellipsize rather than reflow the layout;
//   2. an app-wide en→ko→en round-trip, with each panel / dialog open, leaves
//      the GraphDoc, digest, undo / redo, viewport, simulationRev and the
//      committed SimState byte-identical (§L12 #5);
//   3. KO holds up under `forced-colors` and `prefers-reduced-motion`.
//
// The representative KO reference screenshots live in i18n-visual.spec.ts.

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } }],
})

const PROPOSAL_CLEAN = readFileSync(
  resolve(import.meta.dirname, '..', 'examples', 'revision', 'proposal.clean.json'),
  'utf8',
)

// a 60-character Korean run — worst case for any single-line control / label
const LONG_KO = '아주아주긴한국어라벨입니다이것은절대로한줄에들어가지않을만큼충분히길어야합니다정말로'

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

/** open the language menu (desktop, or inside a `scope`) and pick `code`. */
async function pickLocale(page: Page, code: string, scope = '') {
  const trigger = page.locator(`${scope} .lang-switch`.trim()).first()
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const item = page.locator(`${scope} .lang-menu__item[data-locale="${code}"]`.trim())
  await expect(item).toBeVisible()
  await item.click()
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** the whole document-owned + committed-engine state, normalised (§L12 #5) */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as any).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.type, n.position, n.data]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]),
      }),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      simulationRev: g.simulationRev,
      viewport: l.rf.getViewport(),
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
      values: s.values,
      stepIndex: s.stepIndex,
      status: s.status,
    }
  })

const docXScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** `selector` must sit inside the viewport horizontally and not itself be a
 *  scroll container (long KO text wraps / ellipsizes; it never widens the box). */
async function assertContained(page: Page, selector: string) {
  const r = await page.locator(selector).first().evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { left: b.left, right: b.right, sw: el.scrollWidth, cw: el.clientWidth, vw: window.innerWidth }
  })
  expect(r.left, `${selector} left edge`).toBeGreaterThanOrEqual(-1)
  expect(r.right, `${selector} right edge`).toBeLessThanOrEqual(r.vw + 1)
  expect(r.sw - r.cw, `${selector} internal x-overflow`).toBeLessThanOrEqual(1)
  expect(await docXScroll(page), 'document x-scroll').toBeLessThanOrEqual(1)
}

async function openMc(page: Page) {
  await page.locator('.pstrip__mc button').click()
  await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
}
async function openExport(page: Page) {
  await page.locator('.toolbar__actions .menu > button', { hasText: /내보내기|Export/ }).click()
  await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()
}
async function openShare(page: Page) {
  await page.locator('.toolbar__actions button', { hasText: /공유|^Share$/ }).click()
  await expect(page.locator('.mcdlg--confirm')).toBeVisible()
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — KO acceptance: no overflow, no horizontal scroll', () => {
  test('idle app in KO — Toolbar / Canvas / Timeline / palette all contained', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')

    for (const s of ['.toolbar', '.canvas', '.timeline', '.toolbar__palette']) await assertContained(page, s)
  })

  test('Inspector in KO — a 60-char Korean label ellipsizes, does not widen the panel', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('pool', null))
    await expect(page.locator('aside.inspector')).toBeVisible()

    const w0 = await page.locator('aside.inspector').evaluate((el) => el.getBoundingClientRect().width)
    // type a very long Korean value into the Label field
    const label = page.locator('aside.inspector .field input').first()
    await label.fill(LONG_KO)
    await expect(label).toHaveValue(LONG_KO)

    const w1 = await page.locator('aside.inspector').evaluate((el) => el.getBoundingClientRect().width)
    expect(w1, 'Inspector width is unchanged by a long KO value').toBe(w0)
    await assertContained(page, 'aside.inspector')
    // the stored label IS the long KO string the user typed — model data, verbatim
    expect(await page.evaluate(() => (window as any).__loop.graph.getState().nodes.find((n: any) => n.id === 'pool').data.label)).toBe(LONG_KO)
  })

  test('every dialog / menu / overlay in KO stays inside the viewport', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')

    await openMc(page)
    await assertContained(page, '.mcdlg')
    await page.locator('.mcdlg .mcdlg__x, .mcdlg button', { hasText: /닫기|취소/ }).first().click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeHidden()

    await openExport(page)
    await assertContained(page, '.toolbar__actions .menu__pop')
    await page.keyboard.press('Escape')

    await openShare(page)
    await assertContained(page, '.mcdlg--confirm')
    await page.locator('.mcdlg--confirm button', { hasText: /취소/ }).click()
    await expect(page.locator('.mcdlg--confirm')).toBeHidden()

    await page.locator('.lang-switch').click()
    await assertContained(page, '.lang-menu__pop')
    await page.keyboard.press('Escape')

    await page.locator('.palette-item .chip--register').hover()
    await expect(page.locator('#palette-tip-register')).toBeVisible()
    await assertContained(page, '#palette-tip-register')
  })

  test('the Review overlay in KO is contained and its chrome is Korean', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')

    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'p.json',
      mimeType: 'application/json',
      buffer: Buffer.from(PROPOSAL_CLEAN),
    })
    await expect(page.locator('.review')).toBeVisible()
    await expect(page.locator('.review')).toContainText('검토') // "Review" — localized chrome
    await assertContained(page, '.review')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — KO acceptance: mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('mobile app + More sheet + Monte Carlo in KO — no horizontal scroll', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await pickLocale(page, 'ko', '.sheet')
    await assertContained(page, '.sheet')
    await page.locator('.sheet__x').click()
    await expect(page.locator('.sheet')).toBeHidden()

    await assertContained(page, '.toolbar--mobile')
    await assertContained(page, '.canvas')

    await page.locator('.pstrip--mobile').getByRole('button', { name: /몬테카를로|Monte Carlo/ }).click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    await assertContained(page, '.mcdlg')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — app-wide en→ko→en invariance', () => {
  test('round-trip with a model graph + sim advanced + Inspector open moves nothing', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(1)
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
      ;(window as any).__loop.graph.getState().setSelection('pool', null)
    })
    const before = await snapshot(page)
    for (const code of ['ko', 'en', 'ko', 'en']) await pickLocale(page, code)
    expect(await snapshot(page)).toEqual(before)
  })

  test('a locale switch while each dialog is open changes no document / engine state', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    // capture the baseline only once React Flow has drawn the edge path, so the
    // `d` array is the settled geometry and not an empty pre-render frame
    await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(1)
    const before = await snapshot(page)

    // a modal's scrim covers the toolbar language menu, so switch through the
    // same store action the menu calls (`i18n.setLocale`) — §L4.5 atomic activation.
    const setLocale = (code: string) =>
      page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
    const roundTrip = async () => {
      for (const c of ['ko', 'en']) {
        await setLocale(c)
        await expect.poll(() => htmlLang(page)).toBe(c)
      }
    }

    // Monte Carlo open
    await openMc(page)
    await roundTrip()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    await page.locator('.mcdlg button', { hasText: /Close|Cancel/ }).first().click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeHidden()

    // Export menu open
    await page.locator('.toolbar__actions .menu > button', { hasText: /Export/ }).click()
    await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()
    await roundTrip()
    await page.keyboard.press('Escape')

    // Share confirm open
    await page.locator('.toolbar__actions button', { hasText: /^Share$/ }).click()
    await expect(page.locator('.mcdlg--confirm')).toBeVisible()
    await roundTrip()
    await page.locator('.mcdlg--confirm button', { hasText: /Cancel/ }).click()
    await expect(page.locator('.mcdlg--confirm')).toBeHidden()

    expect(await snapshot(page)).toEqual(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — KO typography of the small-caps semantic labels', () => {
  test('KO dialog / overlay labels are un-transformed, unspaced, and non-mono', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')
    await openMc(page)

    for (const sel of ['.mcdlg__head', '.mcdlg__field > span', '.mcdlg__poolshead', '.mcdlg__costlabel']) {
      const s = await page.locator(sel).first().evaluate((el) => {
        const c = getComputedStyle(el)
        return { ls: c.letterSpacing, tt: c.textTransform, ff: c.fontFamily, fs: parseFloat(c.fontSize) }
      })
      expect(s.tt, `${sel} text-transform`).toBe('none')
      expect(s.ls === 'normal' || parseFloat(s.ls) === 0, `${sel} letter-spacing ${s.ls}`).toBe(true)
      expect(s.ff.toLowerCase(), `${sel} not monospace`).not.toContain('mono')
      expect(s.fs, `${sel} font-size`).toBeGreaterThanOrEqual(11)
    }
  })

  test('EN keeps the uppercase / wide-spaced treatment', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await openMc(page)
    const s = await page.locator('.mcdlg__field > span').first().evaluate((el) => {
      const c = getComputedStyle(el)
      return { ls: parseFloat(c.letterSpacing), tt: c.textTransform, ff: c.fontFamily }
    })
    expect(s.tt).toBe('uppercase')
    expect(s.ls).toBeGreaterThan(0)
    expect(s.ff.toLowerCase()).toContain('mono')
  })

  test('the Monte Carlo dialog fits a 390px viewport in KO', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ko'))
    await expect.poll(() => htmlLang(page)).toBe('ko')
    await page.locator('.pstrip--mobile').getByRole('button', { name: /몬테카를로|Monte Carlo/ }).click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    const r = await page.locator('.mcdlg').evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { top: b.top, bottom: b.bottom, vh: window.innerHeight }
    })
    expect(r.top).toBeGreaterThanOrEqual(-1)
    expect(r.bottom).toBeLessThanOrEqual(r.vh + 1)
    await assertContained(page, '.mcdlg')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — KO under forced-colors', () => {
  test.use({ forcedColors: 'active' })

  test('the KO app renders with forced colors — controls reachable, nothing overflows', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')

    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ 재생')
    await openMc(page)
    await expect(page.locator('.mcdlg #mcdlg-title')).toHaveText('몬테카를로')
    await assertContained(page, '.mcdlg')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n Slice 3 — KO under reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('a Step press announces Korean run state and settles', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')

    await page.evaluate(() => (window as any).__loop.sim.getState().advance())
    await expect(page.locator('[data-playback-announce]')).toHaveText(/단계/)
    await assertContained(page, '.timeline')
  })
})
