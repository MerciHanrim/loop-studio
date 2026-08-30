import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL10 (VL-INV-1…6) — the Canvas Visual Refresh is a
// PURE VIEW CHANGE. Rendering / hovering / selecting / keyboard-focusing a node
// (including the new Parameter / Register kinds) must not touch the GraphDoc,
// its `loop-revision/*` digest, the undo/redo stacks, node positions/sizes, or
// the viewport.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'Gold' } },
    { id: 'p_rate', type: 'parameter', position: { x: 0, y: 200 }, data: { kind: 'parameter', label: 'Rate', value: 2.5, min: 0, max: 10, unit: 'x' } },
    { id: 'r_val', type: 'register', position: { x: 240, y: 200 }, data: { kind: 'register', label: 'Value', expr: '@gold * @p_rate' } },
    { id: 'r_bad', type: 'register', position: { x: 460, y: 200 }, data: { kind: 'register', label: 'Bad', expr: '1 / (@gold - @gold)' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

type Snap = { digest: string; canUndo: boolean; canRedo: boolean; positions: string; viewport: string }

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const l = (window as unknown as { __loop: { graph: { getState: () => any }; revisionIO: { currentTargetDigest: () => string } } }).__loop
    const g = l.graph.getState()
    const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null
    return {
      // the canonical revision content digest (§R4.4 / VL-INV-4) — the projection
      // already ignores transient UI flags like `selected`, so this is the
      // GraphDoc identity the Refresh must not move.
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      positions: JSON.stringify(g.nodes.map((n: any) => [n.id, n.position.x, n.position.y, n.width ?? null, n.height ?? null])),
      viewport: vp ? vp.style.transform : '',
    }
  })
}

test.describe('Canvas Refresh — VL-INV (view change only)', () => {
  test('hover / select / keyboard-focus a Parameter and a Register change nothing', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'g.json',
      mimeType: 'application/json',
      buffer: Buffer.from(GRAPH, 'utf8'),
    })
    await expect(page.locator('.react-flow__node[data-id="r_val"]')).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__invalid')).toBeVisible() // invalid outline drawn
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')

    const before = await snap(page)

    // hover every node
    for (const id of ['src', 'gold', 'p_rate', 'r_val', 'r_bad']) {
      await page.locator(`.react-flow__node[data-id="${id}"]`).hover()
    }
    // click-select the Parameter, then the invalid Register
    await page.locator('.react-flow__node[data-id="p_rate"]').click()
    await expect(page.locator('.react-flow__node[data-id="p_rate"].is-selected, .react-flow__node.selected[data-id="p_rate"]')).toBeVisible()
    await page.locator('.react-flow__node[data-id="r_bad"]').click()
    // keyboard focus: Tab into the canvas and move focus with arrows/tab
    await page.locator('.react-flow__node[data-id="r_bad"]').focus()
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__focus')).toBeVisible()

    const after = await snap(page)

    expect(after.digest).toBe(before.digest) // canonical revision content — unchanged (VL-INV-4)
    expect(after.positions).toBe(before.positions) // no auto position / size change
    expect(after.canUndo).toBe(before.canUndo) // undo stack untouched
    expect(after.canRedo).toBe(before.canRedo)
    expect(after.viewport).toBe(before.viewport) // no auto fitView / pan
  })
})
