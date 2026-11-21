import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'
import { keepPanelDetailsOpen } from './support/panel'

// Review M2 (Lumi, #598): from loop-model/3 the engine reads a Pool's and a
// resource connection's kind (SEMANTICS-M3.md §M3-2), and the review tags a
// change of it `engine`; the Inspector must not call the same field
// "advisory" there. Before 3 the kind is a tag, and the Inspector keeps its
// "(advisory)" label and its "Advisory only" mismatch note.
//
// One small document with a mismatch — a water Pool whose connection is marked
// juice — opened at loop-model/2 (no kinds read) and at loop-model/3 (kinds
// read). The Pool and then the connection are selected, and the kind field's
// label and the mismatch note are read where the person sees them.

type Bridge = { __loop: { graph: { getState: () => { setSelection: (n: string | null, e: string | null) => void } } } }

const doc = (version: 2 | 3) =>
  JSON.stringify({
    schema: `loop-studio/graph/${version}`,
    version: 1,
    layoutVersion: 1,
    ...(version >= 3 ? { kinds: [{ name: 'water', conserved: false }, { name: 'juice', conserved: false }] } : {}),
    nodes: [
      { id: 'T', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny', resourceType: 'water' } },
      { id: 'D', type: 'drain', position: { x: 300, y: 0 }, data: { kind: 'drain', label: 'Tap', activation: 'automatic', mode: 'pullAny' } },
    ],
    edges: [{ id: 'e', source: 'T', target: 'D', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', resourceType: 'juice' } }],
  })

const inspector = (page: Page) => page.locator('aside.inspector')
const select = (page: Page, node: string | null, edge: string | null) =>
  page.evaluate(([n, e]) => (window as unknown as Bridge).__loop.graph.getState().setSelection(n, e), [node, edge] as const)

async function open(page: Page, version: 2 | 3) {
  await openApp(page)
  await importGraph(page, doc(version))
  await keepPanelDetailsOpen(page)
}

test.describe('the Inspector names a kind the way the engine reads it', () => {
  test('loop-model/2: the kind is a tag — "(advisory)" on the Pool and the connection, and the "Advisory only" mismatch note', async ({ page }) => {
    await open(page, 2)
    for (const [what, node, edge] of [['Pool', 'T', null], ['connection', null, 'e']] as const) {
      await select(page, node, edge)
      await expect(inspector(page).getByLabel('Resource type (advisory)', { exact: true }), what).toBeVisible()
      await expect(inspector(page).getByText(/Type mismatch: .*Advisory only/), what).toBeVisible()
    }
  })

  test('loop-model/3: the engine reads it — no "advisory" on the field or the note, on the Pool or the connection', async ({ page }) => {
    await open(page, 3)
    // the Pool: the field says "Resource type"; the conflict is the kind finding's, not the advisory note
    await select(page, 'T', null)
    await expect(inspector(page).getByLabel('Resource type', { exact: true })).toBeVisible()
    await expect(inspector(page).getByLabel('Resource type (advisory)', { exact: true })).toHaveCount(0)
    await expect(inspector(page).locator('[data-kind-finding="conflict"]')).toBeVisible()
    await expect(inspector(page).getByText(/Type mismatch/)).toHaveCount(0)
    await expect(inspector(page).getByText(/advisory/i)).toHaveCount(0)
    // the connection: the field says "Resource type"; the note states the mismatch and nothing more
    await select(page, null, 'e')
    await expect(inspector(page).getByLabel('Resource type', { exact: true })).toBeVisible()
    await expect(inspector(page).getByLabel('Resource type (advisory)', { exact: true })).toHaveCount(0)
    await expect(inspector(page).getByText(/^Type mismatch: .*\.$/)).toBeVisible()
    await expect(inspector(page).getByText(/advisory/i)).toHaveCount(0)
  })
})
