import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-6 (issue #325, PR 2) — the flow
// colour beyond the canvas, in pixels: the minimap and the timeline of a
// coloured graph, light and dark; the same two views under forced colours,
// back on their kind and series colours; and each coloured Template's fit view
// with its minimap. (Each colour offered once, and the stored Recent order, are
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

const TEMPLATES = [
  { id: 'coffee', name: 'Coffee roastery operations flow', waitFor: 'cafe_retail_demand_kg' },
  { id: 'gacha', name: '3-zone gacha banner comparison', waitFor: 'cmp1_hit_rate_free' },
  { id: 'mmo', name: 'Early MMO progression (levels 1–15)', waitFor: 'char_creation' },
]
// the stored colours are drawn unchanged in both themes (D-1), so the dark
// shots hold them against the dark structure lines, labels and frames
for (const t of TEMPLATES) for (const scheme of ['light', 'dark'] as const) {
  test(`${t.name} — its flow colours, fit to the pane, with the minimap — ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page)
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page.locator('.toolbar__actions .menu').first().locator('.menu__pop [role="menuitem"]', { hasText: t.name }).click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
    await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
    if (await confirm.count()) await confirm.click()
    await expect(page.locator(`.react-flow__node[data-id="${t.waitFor}"]`)).toBeVisible()
    await page.evaluate(() => (window as any).__loop.rf.fitView({ duration: 0 }))
    await settle(page)
    // the React Flow attribution is masked in the canvas's own background, so
    // the mask reads as empty canvas instead of the strongest colour in the shot
    const canvas = await page.locator('.react-flow').evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect(page.locator('.react-flow')).toHaveScreenshot(
      ...snap(page, `flow-views-template-${t.id}-${scheme}`, { mask: [page.locator('.react-flow__attribution')], maskColor: canvas }),
    )
  })
}
