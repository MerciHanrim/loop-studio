import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// The Canvas EDIT lock (uiStore.canvasLocked, seeded from
// `recommendedRunConfig.canvasLocked`). Locked ⇒ nodes don't move / connect,
// nothing deletes, the Inspector is read-only — but selection, the read-only
// Inspector, pan / zoom, the minimap, the Timeline and the sim all still work.
// UI-only: never the GraphDoc / loop-revision digest / undo / simulationRev.

type Bridge = { __loop: Record<string, { getState: () => any } & Record<string, unknown>> }

/** Source ─1→ P1 ─1→ Drain. */
async function seed(page: Page, canvasLocked?: boolean) {
  await page.evaluate((locked) => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    g.loadDoc({
      nodes: [
        { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
        { id: 'p1', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        { id: 'snk', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'Snk', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
        { id: 'e2', source: 'p1', target: 'snk', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      ],
    })
    l.mc.getState().applyRecommended(locked === undefined ? {} : { canvasLocked: locked })
  }, canvasLocked)
}

const locked = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().canvasLocked)

const graphDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })
const canUndo = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)
const nodePos = (page: Page, id: string) =>
  page.evaluate(
    (nid) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.id === nid).position,
    id,
  )

const lockBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-lock')

test.describe('Canvas edit-lock', () => {
  test('the Controls lock toggle flips uiStore.canvasLocked and replaces the "interactive" button', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    expect(await locked(page)).toBe(false)
    // React Flow's own "interactive" toggle is gone
    await expect(page.locator('.react-flow__controls-interactive')).toHaveCount(0)

    const btn = lockBtn(page)
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(btn).toHaveText('🔓')
    await btn.click()
    expect(await locked(page)).toBe(true)
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(btn).toHaveText('🔒')
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
    await btn.click()
    expect(await locked(page)).toBe(false)
  })

  test('a file with recommendedRunConfig.canvasLocked opens locked; absent ⇒ unlocked', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)
    expect(await locked(page)).toBe(true)
    await seed(page) // no field
    expect(await locked(page)).toBe(false)
  })

  test('locked: a node can still be selected and the Inspector opens READ-ONLY', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)

    await page.locator('.react-flow__node[data-id="p1"]').click()
    // selection reached the store → the read-only Inspector shows the node
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId))
      .toBe('p1')
    const aside = page.locator('aside.inspector')
    await expect(aside).toBeVisible()
    const labelInput = aside.locator('input').first()
    await expect(labelInput).toBeVisible()
    await expect(labelInput).toBeDisabled() // <fieldset disabled> — :disabled matches
    await expect(labelInput).toHaveValue('P1') // the value is still shown
    // the Delete button is inert too
    for (const b of await aside.getByRole('button').all()) await expect(b).toBeDisabled()
  })

  test('locked: nodes do not move, connect, or delete; the graph is untouched', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    const digest0 = await graphDigest(page)
    const undo0 = await canUndo(page)
    const pos0 = await nodePos(page, 'p1')

    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)

    // no `.draggable` class ⇒ React Flow won't start a drag
    await expect(page.locator('.react-flow__node[data-id="p1"]')).not.toHaveClass(/draggable/)
    // try to drag it anyway
    const box = await page.locator('.react-flow__node[data-id="p1"]').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + 120, box!.y + 80, { steps: 8 })
    await page.mouse.up()
    // select + Delete
    await page.locator('.react-flow__node[data-id="p1"]').click()
    await page.keyboard.press('Delete')
    await page.keyboard.press('Backspace')

    expect(await nodePos(page, 'p1')).toEqual(pos0)
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length),
    ).toBe(3)
    expect(await graphDigest(page)).toBe(digest0) // locking + the failed edits changed nothing
    expect(await canUndo(page)).toBe(undo0)
  })

  test('locked: pan / zoom / the Timeline still work', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)

    // zoom via the Controls (+) button
    const vp0 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    await page.locator('.react-flow__controls-button.react-flow__controls-zoomin').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom))
      .toBeGreaterThan(vp0.zoom)

    // step the sim (the pure commit path — no animation clock in a bare evaluate)
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.reset()
      s.advance()
    })
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex),
    ).toBeGreaterThan(0)
  })

  test('canvasLocked round-trips: Graph export → import, and Share encode → decode', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await lockBtn(page).click()

    const rt = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const { recommendedRunConfigForExport } = await import('/src/store/mcStore.ts')
      const shareM = await import('/src/model/share.ts')
      const serM = await import('/src/model/serialize.ts')
      const g = () => l.graph.getState()

      const text = g().exportJSON(recommendedRunConfigForExport())
      const graphDoc = JSON.parse(text)

      // Graph import
      g().newGraph()
      l.ui.getState().setCanvasLocked(false)
      l.mc.getState().applyRecommended(g().loadJSON(text))
      const afterImport = l.ui.getState().canvasLocked

      // Share encode → decode → apply
      const { payload } = await shareM.encodeShareText(text)
      const round = serM.deserialize(await shareM.decodeShareText(payload))
      g().newGraph()
      l.ui.getState().setCanvasLocked(false)
      g().loadDoc({ nodes: round.nodes, edges: round.edges })
      l.mc.getState().applyRecommended(round.recommendedRunConfig)
      const afterShare = l.ui.getState().canvasLocked

      return { graphDocLocked: graphDoc.recommendedRunConfig.canvasLocked, afterImport, afterShare }
    })

    expect(rt.graphDocLocked).toBe(true)
    expect(rt.afterImport).toBe(true)
    expect(rt.afterShare).toBe(true)
  })
})
