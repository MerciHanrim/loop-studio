import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// `recommendedRunConfig.timelineSeries` — the advisory Timeline default visible
// set (Pool AND Register ids). A pure display preference:
//   • applied on document / template / Workspace / Share load,
//   • written back by every graph Export,
//   • NEVER in the GraphDoc proper, the loop-revision/* digest, undo, or
//     simulationRev, and distinct from the Monte-Carlo `tracked` list,
//   • unknown / deleted ids ignored,
//   • absent ⇒ every series shown (older-file behaviour).
//
// Merge conditions (review): no data loss through Graph export→import→export,
// Workspace export→import→export, and Share create→restore; digest / undo
// unchanged by a display-only toggle.

type Bridge = { __loop: Record<string, { getState: () => any } & Record<string, unknown>> }

/** Source ─1→ P1 ─1→ Drain ; plus two Registers. */
async function seed(page: Page, timelineSeries?: string[]) {
  await page.evaluate((ts) => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    const nodes = [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
      { id: 'p1', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'p2', type: 'pool', position: { x: 200, y: 120 }, data: { kind: 'pool', label: 'P2', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'snk', type: 'drain', position: { x: 400, y: 0 }, data: { kind: 'drain', label: 'Snk', activation: 'automatic', mode: 'pullAny' } },
      { id: 'reg_a', type: 'register', position: { x: 600, y: 0 }, data: { kind: 'register', label: 'Reg A', expr: '@p1 + @p2' } },
      { id: 'reg_b', type: 'register', position: { x: 600, y: 120 }, data: { kind: 'register', label: 'Reg B', expr: '@p1 * 2' } },
    ]
    const edges = [
      { id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'e2', source: 'src', target: 'p2', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'e3', source: 'p1', target: 'snk', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    ]
    g.loadDoc({ nodes, edges })
    l.mc.getState().applyRecommended(ts ? { timelineSeries: ts } : {})
  }, timelineSeries)
}

const seriesState = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().timelineSeries)

const graphDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })

const canUndo = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)

async function showTimeline(page: Page) {
  const toggle = page.locator('.pstrip__tl button, .playbar button', { hasText: /timeline/i }).first()
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
  await expect(page.locator('.timeline__legend')).toBeVisible()
}

test.describe('recommendedRunConfig.timelineSeries', () => {
  test('a subset list ⇒ only those series in the legend, the rest behind "+N more"', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'reg_a'])
    expect(await seriesState(page)).toEqual(['p1', 'reg_a'])
    await showTimeline(page)

    const legend = page.locator('.timeline__legend')
    await expect(legend.locator('.timeline__key', { hasText: 'P1' })).toBeVisible()
    await expect(legend.locator('.timeline__key', { hasText: 'Reg A' })).toBeVisible()
    // P2 + Reg B are hidden behind the expander
    await expect(legend.locator('.timeline__key', { hasText: 'P2' })).toHaveCount(0)
    const more = legend.locator('.timeline__key--more')
    await expect(more).toHaveText(/\+2 more/)

    await more.click()
    await expect(more).toHaveText(/show fewer/i)
    await expect(legend.locator('.timeline__key.is-off', { hasText: 'P2' })).toBeVisible()
    await expect(legend.locator('.timeline__key.is-off', { hasText: 'Reg B' })).toBeVisible()

    // show P2 → it moves into the active set; Reg B is still the one hidden series
    await legend.locator('.timeline__key.is-off', { hasText: 'P2' }).click()
    expect(await seriesState(page)).toEqual(['p1', 'p2', 'reg_a'])
    await expect(legend.locator('.timeline__key.is-off', { hasText: 'Reg B' })).toBeVisible()
    await expect(legend.locator('.timeline__key.is-off', { hasText: 'P2' })).toHaveCount(0)

    // collapse, then re-expand: the remaining hidden count is 1
    await legend.locator('.timeline__key--more').click() // "Show fewer" → collapsed
    await expect(legend.locator('.timeline__key--more')).toHaveText(/\+1 more/)
  })

  test('no timelineSeries ⇒ every series shown, no "+N more" (older-file behaviour)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page) // no field
    expect(await seriesState(page)).toBe('all')
    await showTimeline(page)
    const legend = page.locator('.timeline__legend')
    for (const label of ['P1', 'P2', 'Reg A', 'Reg B']) {
      await expect(legend.locator('.timeline__key', { hasText: label })).toBeVisible()
    }
    await expect(legend.locator('.timeline__key--more')).toHaveCount(0)
  })

  test('deleted / unknown ids in the list are ignored — the known series still show', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'ghost-1', 'ghost-2'])
    await showTimeline(page)
    const legend = page.locator('.timeline__legend')
    await expect(legend.locator('.timeline__key', { hasText: 'P1' })).toBeVisible()
    await expect(legend.locator('.timeline__key--more')).toHaveText(/\+3 more/) // P2, Reg A, Reg B
  })

  test('a legend toggle changes NO graph digest / undo state / sim result', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    const digest0 = await graphDigest(page)
    const undo0 = await canUndo(page)
    // advance the sim a few steps so there is a result to disturb
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.reset()
      for (let i = 0; i < 4; i++) (window as unknown as Bridge).__loop.sim.getState().stepOnce()
    })
    const step0 = await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)

    await showTimeline(page)
    await page.locator('.timeline__legend .timeline__key--more').click()
    await page.locator('.timeline__legend .timeline__key.is-off', { hasText: 'P2' }).click()

    expect(await graphDigest(page)).toBe(digest0)
    expect(await canUndo(page)).toBe(undo0)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(step0)
    expect(await seriesState(page)).toEqual(['p1', 'p2'])
  })

  test('Graph JSON: export → import → export round-trips timelineSeries and the graph', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'reg_b'])

    const rt = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      const g = () => l.graph.getState()
      const rrc1 = { ...l.mc.getState().config }
      // the app's real export path
      const text1 = g().exportJSON({ ...rrc1, timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort() })
      const d1 = JSON.parse(text1)
      // wipe + re-import
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 9, runs: 2, steps: 2, tracked: [] })
      l.mc.getState().applyRecommended(g().loadJSON(text1))
      const seriesAfter = l.sim.getState().timelineSeries
      const text2 = g().exportJSON({ ...l.mc.getState().config, timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort() })
      const d2 = JSON.parse(text2)
      return { d1, d2, seriesAfter, nodeIds: g().nodes.map((n: any) => n.id) }
    })

    expect(rt.seriesAfter).toEqual(['p1', 'reg_b'])
    expect(rt.d1.recommendedRunConfig.timelineSeries).toEqual(['p1', 'reg_b'])
    expect(rt.d2.recommendedRunConfig.timelineSeries).toEqual(['p1', 'reg_b'])
    expect(rt.d2.nodes).toEqual(rt.d1.nodes)
    expect(rt.d2.edges).toEqual(rt.d1.edges)
    expect(rt.nodeIds.sort()).toEqual(['p1', 'p2', 'reg_a', 'reg_b', 'snk', 'src'])
  })

  test('Workspace JSON: export → import → export preserves timelineSeries and the graph', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'p2', 'reg_a'])

    const rt = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const io = l.io as any
      const g = () => l.graph.getState()
      const text1 = io.serializeWorkspaceFile(io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
      const d1 = JSON.parse(text1)
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 3, runs: 1, steps: 1, tracked: [] })
      await io.importFile(text1)
      const seriesAfter = l.sim.getState().timelineSeries
      const text2 = io.serializeWorkspaceFile(io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
      const d2 = JSON.parse(text2)
      return { d1, d2, seriesAfter }
    })

    expect(rt.seriesAfter).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d1.recommendedRunConfig.timelineSeries).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d2.recommendedRunConfig.timelineSeries).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d2.nodes).toEqual(rt.d1.nodes)
    expect(rt.d2.edges).toEqual(rt.d1.edges)
  })

  test('Share: create → restore preserves timelineSeries (encode → #g1= → decode)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p2', 'reg_a'])

    const applied = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const shareM = await import('/src/model/share.ts')
      const serM = await import('/src/model/serialize.ts')
      const g = () => l.graph.getState()
      // the real Share pipeline: exportJSON → encodeShareText (the #g1= payload)
      const text = g().exportJSON({
        ...l.mc.getState().config,
        timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort(),
      })
      const { payload } = await shareM.encodeShareText(text)
      // …and the boot-time restore: decode → deserialize → loadDoc + applyRecommended
      const roundText = await shareM.decodeShareText(payload)
      const parsed = serM.deserialize(roundText)
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 7, runs: 1, steps: 1, tracked: [] })
      g().loadDoc({ nodes: parsed.nodes, edges: parsed.edges })
      l.mc.getState().applyRecommended(parsed.recommendedRunConfig)
      return {
        series: l.sim.getState().timelineSeries,
        rrcTs: (parsed.recommendedRunConfig as any)?.timelineSeries,
        nodeIds: g().nodes.map((n: any) => n.id).sort(),
      }
    })

    expect(applied.rrcTs).toEqual(['p2', 'reg_a'])
    expect(applied.series).toEqual(['p2', 'reg_a'])
    expect(applied.nodeIds).toEqual(['p1', 'p2', 'reg_a', 'reg_b', 'snk', 'src'])
  })
})
