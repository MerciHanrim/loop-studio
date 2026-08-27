import { dragHandle, expect, graphSnapshot, openApp, resetAll, test } from './support/loop'

test.describe('handle drags create the right edges', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('resource port drag → an out/in resource edge', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.addNodeAt('source', { x: 120, y: 180 })
      g.addNodeAt('pool', { x: 460, y: 180 })
    })
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    const [src, pool] = await page.evaluate(() =>
      (window as any).__loop.graph.getState().nodes.map((n: any) => n.id),
    )

    await dragHandle(page, { nodeId: src, handle: 'out' }, { nodeId: pool, handle: 'in' })

    await expect.poll(() => graphSnapshot(page).then((s) => s.edgeCount)).toBe(1)
    const { edges } = await graphSnapshot(page)
    expect(edges[0]).toMatchObject({
      source: src,
      target: pool,
      sourceHandle: 'out',
      targetHandle: 'in',
      kind: 'resource',
    })
  })

  test('state port drag → a state-source/state-target state edge', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.addNodeAt('pool', { x: 120, y: 160 })
      g.addNodeAt('gate', { x: 460, y: 160 })
    })
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    const [a, b] = await page.evaluate(() =>
      (window as any).__loop.graph.getState().nodes.map((n: any) => n.id),
    )

    // the diamonds sit at opacity 0 at rest but still take pointer events
    await dragHandle(page, { nodeId: a, handle: 'state-source' }, { nodeId: b, handle: 'state-target' })

    await expect.poll(() => graphSnapshot(page).then((s) => s.edgeCount)).toBe(1)
    const { edges } = await graphSnapshot(page)
    expect(edges[0]).toMatchObject({
      source: a,
      target: b,
      sourceHandle: 'state-source',
      targetHandle: 'state-target',
      kind: 'state',
    })
  })
})
