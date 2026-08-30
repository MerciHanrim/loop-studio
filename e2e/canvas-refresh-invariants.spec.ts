import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL10 (VL-INV-1…6) — the Canvas Visual Refresh is a
// PURE VIEW CHANGE. Rendering / hovering / selecting / keyboard-focusing a node
// (including the new Parameter / Register kinds), and an `invalid` cue toggling
// on/off, must not touch the GraphDoc, its `loop-revision/*` digest, the
// undo/redo stacks, node positions / sizes / DOM boxes, the CONNECTED EDGE
// PATHS, or the viewport.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'Gold' } },
    { id: 'p_rate', type: 'parameter', position: { x: 0, y: 200 }, data: { kind: 'parameter', label: 'Rate', value: 2.5, min: 0, max: 10, unit: 'x' } },
    // r_flip is invalid ONLY while gold === 0 (i.e. at step 0); a sim step
    // makes it valid — the `invalid` cue toggles with NO GraphDoc change.
    { id: 'r_flip', type: 'register', position: { x: 240, y: 200 }, data: { kind: 'register', label: 'Flip', expr: '100 / @gold' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

type Snap = {
  digest: string
  canUndo: boolean
  canRedo: boolean
  positions: string
  boxes: string
  edgePaths: string
  viewport: string
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const l = (window as unknown as {
      __loop: { graph: { getState: () => any }; revisionIO: { currentTargetDigest: () => string } }
    }).__loop
    const g = l.graph.getState()
    const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null
    const box = (id: string) => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null
      if (!el) return null
      const r = el.getBoundingClientRect()
      return [id, Math.round(r.width), Math.round(r.height)]
    }
    const nodeIds = g.nodes.map((n: any) => n.id)
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      positions: JSON.stringify(
        g.nodes.map((n: any) => [n.id, n.position.x, n.position.y, n.width ?? null, n.height ?? null, n.measured?.width ?? null, n.measured?.height ?? null]),
      ),
      boxes: JSON.stringify(nodeIds.map(box)),
      edgePaths: JSON.stringify(
        [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => (p as SVGPathElement).getAttribute('d')),
      ),
      viewport: vp ? vp.style.transform : '',
    }
  })
}

async function expectUnchanged(before: Snap, after: Snap, why: string): Promise<void> {
  expect(after.digest, `${why}: canonical revision digest`).toBe(before.digest)
  expect(after.positions, `${why}: node positions / measured size`).toBe(before.positions)
  expect(after.boxes, `${why}: node DOM bounding boxes`).toBe(before.boxes)
  expect(after.edgePaths, `${why}: connected edge SVG path[d]`).toBe(before.edgePaths)
  expect(after.canUndo, `${why}: canUndo`).toBe(before.canUndo)
  expect(after.canRedo, `${why}: canRedo`).toBe(before.canRedo)
  expect(after.viewport, `${why}: viewport transform`).toBe(before.viewport)
}

test.describe('Canvas Refresh — VL-INV (view change only)', () => {
  test('hover / select / keyboard-focus / invalid-toggle change nothing observable in the doc or layout', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    page.on('dialog', (d) => void d.accept())
    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'g.json',
      mimeType: 'application/json',
      buffer: Buffer.from(GRAPH, 'utf8'),
    })
    await expect(page.locator('.react-flow__node[data-id="r_flip"]')).toBeVisible()
    // step 0: gold === 0 ⇒ r_flip is invalid
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toBeVisible()

    const base = await snap(page)

    await test.step('hover every node', async () => {
      for (const id of ['src', 'gold', 'p_rate', 'r_flip']) {
        await page.locator(`.react-flow__node[data-id="${id}"]`).hover()
      }
      await expectUnchanged(base, await snap(page), 'hover')
    })

    await test.step('select the Parameter then the Register', async () => {
      await page.locator('.react-flow__node[data-id="p_rate"]').click()
      await page.locator('.react-flow__node[data-id="r_flip"]').click()
      await expectUnchanged(base, await snap(page), 'select')
    })

    await test.step('keyboard-focus the Register', async () => {
      await page.locator('.react-flow__node[data-id="r_flip"]').focus()
      await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__focus')).toBeVisible()
      await expectUnchanged(base, await snap(page), 'focus')
    })

    await test.step('invalid cue toggles OFF on a sim step — no reflow, edges unmoved', async () => {
      await page.locator('.pstrip button[title="Advance one step"]').click() // gold → 1, r_flip valid
      await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toHaveCount(0)
      await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__flag')).toHaveCount(0)
      // a sim step legitimately changes the digest inputs? NO — canonicalContent
      // ignores sim state; the GraphDoc is identical. Positions / boxes / edges
      // must be byte-identical (the `!` flag is an absolute overlay).
      await expectUnchanged(base, await snap(page), 'invalid toggled off')
    })

    await test.step('invalid cue toggles back ON on Reset', async () => {
      await page.locator('.pstrip button[title="Reset to step 0"]').click()
      await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toBeVisible()
      await expectUnchanged(base, await snap(page), 'invalid toggled back on')
    })
  })
})
