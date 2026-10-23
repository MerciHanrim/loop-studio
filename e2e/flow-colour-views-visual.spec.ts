import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expandMinimap, expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-6 (issue #325, PR 2) — the flow
// colour beyond the canvas, in pixels: the minimap and the timeline of a
// coloured graph, light and dark; the same two views under forced colours,
// back on their kind and series colours; and each coloured Template's whole
// fit, the minimap folded as it starts (since 2026-10-23; the minimap's own
// colours are the minimap shots). (Each colour offered once, and the stored Recent order, are
// held by the DOM tests in flow-colour-views.spec.ts and flow-colour.spec.ts;
// the phone's one-line summary by flow-colour-mobile.spec.ts.)

// two Pools and two Registers, one of each coloured, and a coloured edge
const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny', accent: '#638EA5' } },
    { id: 'gold', type: 'pool', position: { x: 260, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny', accent: '#B47599' } },
    { id: 'gems', type: 'pool', position: { x: 260, y: 200 }, data: { kind: 'pool', label: 'Gems', activation: 'passive', initial: 0, capacity: 100, mode: 'pullAny' } },
    { id: 'sink', type: 'drain', position: { x: 520, y: 40 }, data: { kind: 'drain', label: 'Spend', activation: 'automatic', mode: 'pullAny', accent: '#A78243' } },
    { id: 'r_col', type: 'register', position: { x: 520, y: 200 }, data: { kind: 'register', label: 'Double gold', expr: '@gold * 2', accent: '#9182A8' } },
    { id: 'r_plain', type: 'register', position: { x: 520, y: 330 }, data: { kind: 'register', label: 'Gems plus one', expr: '@gems + 1' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e2', type: 'loop', source: 'gold', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', accent: '#74906B' } },
    { id: 'e3', type: 'loop', source: 'src', target: 'gems', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const settle = async (page: Page) => {
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
}

/** the coloured graph after five steps, the timeline open */
async function run(page: Page): Promise<void> {
  await openApp(page)
  // the minimap starts folded (docs/workbench.md §WB2.1); these shots are of it
  await expandMinimap(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
  await expect(page.locator('.react-flow__node[data-id="r_plain"]')).toBeVisible()
  for (let i = 1; i <= 5; i++) {
    await page.evaluate(() => (window as any).__loop.sim.getState().stepOnce())
    await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)).toBeGreaterThanOrEqual(i)
  }
  await ensureTimelineOpen(page)
  await page.evaluate(() => (window as any).__loop.rf.fitView({ duration: 0 }))
  await expect(page.locator('.timeline__line[data-series="gold"]')).toBeVisible()
  await settle(page)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`flow colours in the minimap and the timeline — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await run(page)
    await expect(page.locator('.react-flow__minimap')).toHaveScreenshot(...snap(page, `flow-views-minimap-${scheme}`))
    await expect(page.locator('.timeline__panel')).toHaveScreenshot(...snap(page, `flow-views-timeline-${scheme}`))
  })
}

test('forced colours: the minimap and the timeline keep their kind and series colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await run(page)
  await expect(page.locator('.react-flow__minimap')).toHaveScreenshot(...snap(page, 'flow-views-forced-minimap'))
  await expect(page.locator('.timeline__panel')).toHaveScreenshot(...snap(page, 'flow-views-forced-timeline'))
})

// the Templates the menu offers; Early MMO left the menu in 0.28.1 (Lumi: its two baselines removed)
const TEMPLATES = [
  { id: 'coffee', name: 'Coffee roastery operations flow', waitFor: 'cafe_retail_demand_kg' },
  { id: 'gacha', name: '3-zone gacha banner comparison', waitFor: 'cmp1_hit_rate_free' },
]
// the stored colours are drawn unchanged in both themes (D-1), so the dark
// shots hold them against the dark structure lines, labels and frames
for (const t of TEMPLATES) for (const scheme of ['light', 'dark'] as const) {
  test(`${t.name} — its flow colours, the whole diagram fitted — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page)
    // the minimap in its default state, folded (§WB2.1): this shot is the
    // whole fit; the minimap's own flow colours are the three shots above
    // (2026-10-23, Hanrim / Lumi: on a whole fit the open minimap only covered
    // the lower right)
    await expect(page.locator('.minimap-toggle.is-collapsed')).toBeVisible()
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    // File ▸ Templates (docs/workbench.md §WB2.2)
    await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
    await page.locator('.toolbar__actions .menu').first().locator('.menu__pop [role="menuitem"]', { hasText: t.name }).click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
    await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
    if (await confirm.count()) await confirm.click()
    await expect(page.locator(`.react-flow__node[data-id="${t.waitFor}"]`)).toBeVisible()
    // the product's own whole fit, as a user asks for it: the status bar's
    // Fit (useFitAll — the outside names counted; React Flow's raw fitView,
    // used here before 2026-10-23, knew only the node boxes)
    await page.locator('.wb-status').getByRole('button', { name: 'Fit the whole diagram', exact: true }).click()
    await settle(page)
    // what the shot checks is on screen: every node body and outside name
    // inside the canvas
    const outside = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      const out = (b: DOMRect) => b.left < pane.left || b.right > pane.right || b.top < pane.top || b.bottom > pane.bottom
      const els = [...document.querySelectorAll<HTMLElement>('.react-flow__node .nodef, .react-flow__node .nodef__name')].filter((e) => getComputedStyle(e).visibility !== 'hidden')
      return els.filter((e) => out(e.getBoundingClientRect())).map((e) => `${e.closest('.react-flow__node')!.getAttribute('data-id')}${e.classList.contains('nodef__name') ? ' (name)' : ''}`)
    })
    expect(outside, 'node bodies or names outside the canvas').toEqual([])
    // the React Flow attribution is masked in the canvas's own background, so
    // the mask reads as empty canvas instead of the strongest colour in the shot
    const canvas = await page.locator('.react-flow').evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect(page.locator('.react-flow')).toHaveScreenshot(
      ...snap(page, `flow-views-template-${t.id}-${scheme}`, { mask: [page.locator('.react-flow__attribution')], maskColor: canvas }),
    )
  })
}
