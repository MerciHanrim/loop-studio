import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// A whole-graph swap (Templates load / file Import / New) must re-fit the React
// Flow camera to the NEW graph — otherwise a template opens panned to the
// previous graph's viewport (a blank / clipped first impression). Fix lives at
// the common `graphStore.loadRev` boundary in Canvas.tsx; this spec drives the
// real desktop Templates menu and the mobile More → Templates sheet.
//
// Render-only: `fitView` changes pan / zoom, never the GraphDoc, node
// positions, undo stack, or digest.

const COFFEE = JSON.parse(
  readFileSync(new URL('../examples/coffee-roastery.json', import.meta.url), 'utf8'),
) as { nodes: { id: string; position: { x: number; y: number } }[] }
const MMO = JSON.parse(
  readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8'),
) as { nodes: { id: string; position: { x: number; y: number } }[] }
const GACHA = JSON.parse(
  readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8'),
) as { nodes: { id: string; position: { x: number; y: number } }[] }

const COFFEE_EN = 'Coffee roastery operations flow'
const MMO_EN = 'Early MMO progression (levels 1–15)'
const GACHA_EN = '3-zone gacha banner comparison'
// the extreme left / right nodes of each graph — both must land on screen
const COFFEE_L = 'cafe_retail_demand_kg'
const COFFEE_R = 'projected_operating_margin'
const MMO_L = 'char_creation'
const MMO_R = 'end15'
// gacha: a comparison-row node (always framed) and a Pickup-zone-only node
// (deliberately left off screen — docs/gacha-banner-zones.md's layout round
// 2 puts Pickup at the far right of the 3-zone row)
const GACHA_L = 'cmp1_hit_rate_free'
const GACHA_R = 'pickup_hit_pickup'

type Loop = Record<string, { getState: () => any }>
const L = (page: Page) => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop && true)

const templatesBtn = (page: Page) =>
  page.locator('.toolbar__actions .menu').first().locator('> button')

/** click the "replace the current graph?" confirm if it appears (it only shows
 *  when a graph is already loaded). */
async function confirmReplaceIfShown(page: Page) {
  const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
  await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
  if (await confirm.count()) await confirm.click()
}

async function pickDesktopTemplate(page: Page, name: string, waitForNodeId: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions .menu')
    .first()
    .locator('.menu__pop [role="menuitem"]', { hasText: name })
    .click()
  await confirmReplaceIfShown(page)
  await expect(page.locator(`.react-flow__node[data-id="${waitForNodeId}"]`)).toBeVisible()
}

async function pickMobileTemplate(page: Page, name: string, waitForNodeId: string) {
  await page.getByRole('button', { name: 'More' }).click()
  await page.locator('.sheet[aria-label="More"] .sheet__row', { hasText: 'Templates' }).click()
  const sheet = page.locator('.sheet[aria-label="Templates"]')
  await expect(sheet).toBeVisible()
  await sheet.locator('.sheet__row', { hasText: name }).click()
  await confirmReplaceIfShown(page)
  await expect(page.locator(`.react-flow__node[data-id="${waitForNodeId}"]`)).toBeVisible()
}

const getVp = (page: Page) =>
  page.evaluate(() => {
    const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf
    return rf.getViewport()
  })

const setVp = (page: Page, v: { x: number; y: number; zoom: number }) =>
  page.evaluate(
    (vp) =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(vp, {
        duration: 0,
      }),
    v,
  )

/** node positions + edge ids + canUndo — the parts a viewport change must NOT touch */
const graphSig = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
    return {
      positions: Object.fromEntries(g.nodes.map((n: any) => [n.id, { x: n.position.x, y: n.position.y }])),
      edgeIds: g.edges.map((e: any) => e.id).sort(),
      canUndo: g.canUndo,
      loadRev: g.loadRev,
    }
  })

/** is a node's on-screen box inside the visible `.react-flow` pane? */
async function nodeOnScreen(page: Page, id: string): Promise<boolean> {
  return page.evaluate((nid) => {
    const pane = document.querySelector('.react-flow')
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
    if (!pane || !el) return false
    const p = pane.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // the node's box overlaps the pane's box (with a small margin of grace)
    return r.right > p.left + 2 && r.left < p.right - 2 && r.bottom > p.top + 2 && r.top < p.bottom - 2
  }, id)
}

const filePositions = (doc: { nodes: { id: string; position: { x: number; y: number } }[] }) =>
  Object.fromEntries(doc.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]))

/** wait for the post-swap fitView to land — it runs once React Flow has
 *  MEASURED the new nodes, a beat after they mount (no fixed delay in the app,
 *  so poll a real signal here rather than sleeping). */
async function waitForFit(page: Page, leftId: string, rightId: string) {
  await expect
    .poll(async () => (await nodeOnScreen(page, leftId)) && (await nodeOnScreen(page, rightId)))
    .toBe(true)
}

test.describe('template load re-fits the viewport (whole-graph swap boundary)', () => {
  test('desktop: MMO panned far away → open Coffee → the camera re-fits the Coffee graph, GraphDoc / positions / undo untouched', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    expect(await L(page)).toBe(true)

    await pickDesktopTemplate(page, MMO_EN, MMO_L)
    // shove the camera to the previous graph's bottom-right, well off any node
    await setVp(page, { x: -5200, y: -3800, zoom: 0.32 })
    const panned = await getVp(page)

    await pickDesktopTemplate(page, COFFEE_EN, COFFEE_R)
    await waitForFit(page, COFFEE_L, COFFEE_R)
    const after = await getVp(page)

    // the viewport actually changed off the stale pan, and both extremes of the
    // Coffee graph are on screen (waitForFit already asserted the latter)
    expect(after, 'viewport re-fit, not inherited').not.toEqual(panned)

    // the swap moved the camera only — node positions are exactly the file's
    expect((await graphSig(page)).positions).toEqual(filePositions(COFFEE))

    // re-fitting is NOT an undo entry: one undo goes straight back past Coffee
    // to the previous (MMO) graph, not to "Coffee at the old viewport"
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().undo())
    const afterUndo = await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.map((n: any) => n.id).sort(),
    )
    expect(afterUndo, 'undo skips past Coffee (no viewport-only history entry)').not.toEqual(
      COFFEE.nodes.map((n) => n.id).sort(),
    )
  })

  // docs/mmo-multilingual-layout.md §MML3 — the MMO demo is ~3500 px wide, so
  // fit-all opens it as an unreadable map. Opened FROM THE MENU it instead
  // frames the early-progression band (Character creation → Starter zone → the
  // Level / XP pools) at ≥ the L1 detail zoom. Fixed graph coords, no locale
  // branch; positions / undo still untouched.
  test('desktop: open MMO from the menu → the camera frames the early band (§MML3), not fit-all', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, COFFEE_EN, COFFEE_R)
    await setVp(page, { x: 300, y: 200, zoom: 1.6 }) // zoomed in on the small graph
    const before = await getVp(page)

    // wait on a band node, not `end15` (which §MML3 deliberately leaves off screen)
    await pickDesktopTemplate(page, MMO_EN, MMO_L)
    await expect.poll(() => nodeOnScreen(page, MMO_L)).toBe(true)
    const after = await getVp(page)

    // the camera moved, opened at ≥ L1 detail, and framed the early band:
    // Character creation is on screen, the far-right End marker is not
    expect(after).not.toEqual(before)
    expect(after.zoom, 'opens at or above the L1 detail zoom').toBeGreaterThanOrEqual(0.45)
    expect(await nodeOnScreen(page, 'char_creation')).toBe(true)
    expect(await nodeOnScreen(page, 'z1_enc')).toBe(true)
    expect(await nodeOnScreen(page, MMO_R), 'rest of the graph is off screen (pan / minimap / Focus)').toBe(false)

    // camera-only: positions are exactly the file's, and the framing is not an
    // undo entry (one undo lands past MMO on the previous Coffee graph)
    expect((await graphSig(page)).positions).toEqual(filePositions(MMO))
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().undo())
    const afterUndo = await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.map((n: any) => n.id).sort(),
    )
    expect(afterUndo, 'undo skips past the MMO framing').not.toEqual(MMO.nodes.map((n) => n.id).sort())
  })

  // docs/gacha-banner-zones.md's layout round 2 — the 3 zones sit side by side
  // across ~3980 graph units; at a 1280-wide pane, fitting all three at once
  // caps out around 0.2-0.3 zoom, under the ~0.45 L1 readability floor (found
  // in live-preview review, Hanrim, 2026-09-13). Opened FROM THE MENU it
  // instead frames the comparison row + the Free zone at ≥ that floor —
  // Standard/Pickup one pan to the right away, same §MML3 pattern as MMO.
  test('desktop: open the gacha banner Template from the menu → frames the comparison row + Free zone (§MML3), not fit-all', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, COFFEE_EN, COFFEE_R)
    await setVp(page, { x: 300, y: 200, zoom: 1.6 }) // zoomed in on the small graph
    const before = await getVp(page)

    await pickDesktopTemplate(page, GACHA_EN, GACHA_L)
    await expect.poll(() => nodeOnScreen(page, GACHA_L)).toBe(true)
    const after = await getVp(page)

    expect(after).not.toEqual(before)
    expect(after.zoom, 'opens at or above the L1 detail zoom').toBeGreaterThanOrEqual(0.45)
    expect(await nodeOnScreen(page, 'cmp1_hit_rate_free')).toBe(true)
    expect(await nodeOnScreen(page, 'roll_gate_free')).toBe(true)
    expect(await nodeOnScreen(page, GACHA_R), 'Pickup zone is off screen (pan / minimap / Focus)').toBe(false)

    // camera-only: positions are exactly the file's, and the framing is not an
    // undo entry (one undo lands past gacha on the previous Coffee graph)
    expect((await graphSig(page)).positions).toEqual(filePositions(GACHA))
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().undo())
    const afterUndo = await page.evaluate(() =>
      (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.map((n: any) => n.id).sort(),
    )
    expect(afterUndo, 'undo skips past the gacha framing').not.toEqual(GACHA.nodes.map((n) => n.id).sort())
  })

  // Review (Hanrim/Lumi, after PR #198): the comparison frame is 1720 graph
  // units wide (5-card row); at 1280px the algebra (`applyInitialView` in
  // Canvas.tsx) cannot land at zoom 1.2 while showing the whole row — an
  // earlier interactive-browser reading of 1.2 was almost certainly a stale
  // viewport left over in that tab, not a fresh measurement. This is the
  // real regression test: a FRESH page at each exact viewport size, the
  // Template opened for the FIRST time (no fitView, no manual setViewport),
  // full DOM-bounds containment of all 5 comparison cards + a Free-zone node
  // inside the CANVAS PANE itself (not just "overlaps" like `nodeOnScreen`),
  // in EN/KO/JA, with the actual applied zoom logged via the same
  // `__loop.canvas.lastInitialView()` debug hook Canvas.tsx exposes — no
  // re-deriving it from a possibly-stale `getViewport()` read.
  test.describe('gacha initial-load viewport containment (post-#198 review)', () => {
    const CARD_IDS = [
      'pulls_per_zone',
      'cmp1_hit_rate_free',
      'cmp2_hit_rate_standard',
      'cmp3_hit_rate_pickup',
      'cmp4_pickup_rate_pickup',
    ]
    const FREE_ZONE_NODE = 'roll_gate_free'

    type LastInitialView = { insetR: number; insetB: number; zoom: number } | null
    const lastInitialView = (page: Page) =>
      page.evaluate(
        () => (window as unknown as { __loop: { canvas: { lastInitialView: () => LastInitialView } } }).__loop.canvas.lastInitialView(),
      )

    /** fully inside the `.react-flow` PANE's own box, not just overlapping it —
     *  stricter than `nodeOnScreen` above, matching "완전히 포함" (fully
     *  contained), not merely "visible at all". */
    const fullyContained = (page: Page, id: string) =>
      page.evaluate((nid) => {
        const pane = document.querySelector('.react-flow')
        const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
        if (!pane || !el) return { found: false }
        const p = pane.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        const TOL = 0.5
        return {
          found: true,
          left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          paneLeft: p.left, paneTop: p.top, paneRight: p.right, paneBottom: p.bottom,
          contained: r.left >= p.left - TOL && r.right <= p.right + TOL && r.top >= p.top - TOL && r.bottom <= p.bottom + TOL,
        }
      }, id)

    for (const size of [
      { width: 1280, height: 720 },
      { width: 1600, height: 900 },
    ]) {
      test(`fresh open at ${size.width}×${size.height}: all 5 comparison cards + a Free-zone node fully on canvas, in EN/KO/JA, no fitView/manual camera`, async ({
        browser,
      }) => {
        const page = await browser.newPage({ viewport: size })
        try {
          await openApp(page)
          await resetAll(page)
          await pickDesktopTemplate(page, GACHA_EN, GACHA_L)

          const iv = await lastInitialView(page)
          // eslint-disable-next-line no-console
          console.log(`[initial-load ${size.width}x${size.height}] lastInitialView =`, JSON.stringify(iv))
          expect(iv, `no initialView was applied at ${size.width}x${size.height}`).not.toBeNull()
          expect(iv!.zoom, `zoom too small to read labels at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(0.45)

          for (const locale of ['en', 'ko', 'ja']) {
            if (locale !== 'en') {
              await page.evaluate(
                (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
                locale,
              )
              await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale)
            }
            for (const id of [...CARD_IDS, FREE_ZONE_NODE]) {
              const r = await fullyContained(page, id)
              expect(r.found, `[${locale}] node "${id}" not found in the DOM`).toBe(true)
              expect(
                r.contained,
                `[${locale}] node "${id}" escapes the canvas pane at ${size.width}x${size.height} ` +
                  `(node ${JSON.stringify({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })}, ` +
                  `pane ${JSON.stringify({ left: r.paneLeft, top: r.paneTop, right: r.paneRight, bottom: r.paneBottom })}, ` +
                  `zoom ${iv!.zoom})`,
              ).toBe(true)
            }
          }
        } finally {
          await page.close()
        }
      })
    }
  })

  test('desktop: a language change after a menu open never moves the camera (§MML3)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, MMO_EN, MMO_L)
    await expect.poll(() => nodeOnScreen(page, MMO_L)).toBe(true)
    const opened = await getVp(page)
    for (const code of ['ko', 'ja', 'en']) {
      await page.evaluate(
        (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
        code,
      )
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
      expect(await getVp(page), `viewport unchanged under ${code}`).toEqual(opened)
    }
  })

  test('mobile: More → Templates re-fits the same way', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
      } catch {
        /* private mode */
      }
    })
    try {
      await openApp(page)
      await resetAll(page)
      await pickMobileTemplate(page, MMO_EN, MMO_L)
      await setVp(page, { x: -5200, y: -3800, zoom: 0.32 })
      const panned = await getVp(page)

      await pickMobileTemplate(page, COFFEE_EN, COFFEE_R)
      await waitForFit(page, COFFEE_L, COFFEE_R)
      const after = await getVp(page)
      expect(after).not.toEqual(panned)
      expect((await graphSig(page)).positions).toEqual(filePositions(COFFEE))
    } finally {
      await page.close()
    }
  })
})
