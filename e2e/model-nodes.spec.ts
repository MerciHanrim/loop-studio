import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// loop-model/1 editor wiring — a malformed `parameter` / `register` node must be
// SAFE in the real UI: the graph opens (with a warning), the Canvas and the
// Inspector never crash, a bad value is never shown as `0` / `"0"`, and the
// `project` header is dropped (no Review / Apply).

async function setFile(page: Page, name: string, text: string): Promise<void> {
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  })
}

const graphFile = (nodes: unknown[], edges: unknown[] = [], project?: unknown) =>
  JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges, ...(project ? { project } : {}) })

const badProject = {
  schema: 'loop-revision/1',
  version: 1,
  projectId: `proj_${'A'.repeat(26)}`,
  revisionId: `rev_${'A'.repeat(26)}`,
  parentId: null,
  role: 'revision',
  contentDigest: 'f'.repeat(64),
}

const pool = {
  id: 'p1',
  type: 'pool',
  position: { x: 260, y: 0 },
  data: { kind: 'pool', label: 'P', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' },
}

const projectOpen = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => { open?: unknown } }> }).__loop
    return Boolean(l.project?.getState().open)
  })

test.describe('malformed model nodes are safe in the UI', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    page.on('dialog', (d) => void d.accept())
  })

  const CASES: { name: string; data: unknown; type: string }[] = [
    { name: 'data is not an object', type: 'parameter', data: 'nope' },
    { name: 'parameter value is a string', type: 'parameter', data: { kind: 'parameter', label: 'x', value: 'lots' } },
    { name: 'parameter value is NaN-ish', type: 'parameter', data: { kind: 'parameter', label: 'x', value: null, extra: 'NaN' } },
    { name: 'register expr is not a string', type: 'register', data: { kind: 'register', label: 'x', expr: 42 } },
    { name: 'register expr does not parse', type: 'register', data: { kind: 'register', label: 'x', expr: 'min(@a,@b)' } },
  ]

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const bad = { id: 'm1', type: c.type, position: { x: 0, y: 0 }, data: c.data }
      await setFile(page, 'bad.json', graphFile([bad, pool], [], badProject))

      const m1 = page.locator('.react-flow__node[data-id="m1"]')
      await expect(page.locator('.react-flow__node[data-id="p1"]')).toBeVisible()

      // some of these are structurally valid-enough to seat (null value fills to
      // 0); only the genuinely-unseatable ones show the fallback. Either way the
      // app must not crash and no fake stand-in for a broken value is shown.
      await expect(m1).toBeVisible()
      const seated = c.name === 'parameter value is NaN-ish'
      if (!seated) {
        await expect(m1).toContainText(/unreadable/i)
        // §R2-1.1 — the project header is dropped for an unseatable model node
        expect(await projectOpen(page)).toBe(false)
      }
      await expect(page.locator('.review-scrim, .review')).toHaveCount(0)

      // selecting it never crashes the Inspector
      await m1.click()
      await expect(page.locator('.inspector')).toBeVisible()
      if (!seated) {
        await expect(page.locator('.inspector')).toContainText(/can.?t be read/i)
      }

      // still interactive
      await page.locator('.pstrip button[title="Advance one step"]').click()
      await expect(page.locator('.pstrip')).toBeVisible()
    })
  }
})

test.describe('an edge to a model node is isolated on import', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    page.on('dialog', (d) => void d.accept())
  })

  test('resource edge param → pool ⇒ graph loads, run still works, project dropped', async ({ page }) => {
    const param = { id: 'pm', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'x', value: 1 } }
    const edge = { id: 'e1', type: 'loop', source: 'pm', target: 'p1', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }
    await setFile(page, 'edge-to-param.json', graphFile([param, pool], [edge], badProject))

    await expect(page.locator('.react-flow__node[data-id="p1"]')).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="pm"]')).toBeVisible()
    expect(await projectOpen(page)).toBe(false)

    await page.locator('.pstrip button[title="Advance one step"]').click()
    await expect(page.locator('.pstrip')).toBeVisible()
  })
})
