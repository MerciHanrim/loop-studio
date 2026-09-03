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

const COFFEE_EN = 'Coffee roastery operations flow'
const MMO_EN = 'Early MMO progression (levels 1–15)'
// the extreme left / right nodes of each graph — both must land on screen
const COFFEE_L = 'cafe_retail_demand_kg'
const COFFEE_R = 'projected_operating_margin'
const MMO_L = 'char_creation'
const MMO_R = 'end15'

type Loop = Record<string, { getState: () => any }>
const L = (page: Page) => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop && true)

const templatesBtn = (page: Page) =>
  page.locator('.toolbar__actions > .menu').first().locator('> button')

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
    .locator('.toolbar__actions > .menu')
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

  test('desktop: the reverse — small Coffee graph → open MMO → the large graph fits too', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, COFFEE_EN, COFFEE_R)
    await setVp(page, { x: 300, y: 200, zoom: 1.6 }) // zoomed in on the small graph
    const before = await getVp(page)

    await pickDesktopTemplate(page, MMO_EN, MMO_R)
    await waitForFit(page, MMO_L, MMO_R)
    const after = await getVp(page)
    expect(after).not.toEqual(before)
    expect((await graphSig(page)).positions).toEqual(filePositions(MMO))
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
