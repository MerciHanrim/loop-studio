import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// SEMANTICS-M2.md / docs/parameter-inputs.md — the loop-model/2 boundaries the
// review asked to pin in a real browser:
//   1. an existing v1 `@…` flow string is NOT promoted by open / save / autosave
//   2. a NEW leading-`@` commit — even a typo — promotes to v2, so the edge runs
//      `0` + a diagnostic, never the v1 fallback `1`

const modelVersion = (page: Page) =>
  page.evaluate(() => (window as any).__loop.graph.getState().modelVersion)

/** build a fresh source -> pool graph via the store bridge; return the edge id. */
async function sourcePoolGraph(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as any).__loop.graph.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 240, y: 0 })
    const [s, p] = (window as any).__loop.graph.getState().nodes
    ;(window as any).__loop.graph
      .getState()
      .onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    return (window as any).__loop.graph.getState().edges[0].id
  })
}

/** reset + run one deterministic step; return the (single) pool's value. */
async function step1PoolValue(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sim = (window as any).__loop.sim.getState()
    sim.reset()
    sim.stepOnce()
    const g = (window as any).__loop.graph.getState()
    const poolId = g.nodes.find((n: any) => n.data.kind === 'pool').id
    return (window as any).__loop.sim.getState().values[poolId] ?? 0
  })
}

// issue #393 A — the Parameter's number fields keep what is typed as a draft
// and commit only a finite parse: before, every keystroke stored
// `Number(text)`, so a leading minus stored 0 (the sign was lost) and `1e400`
// stored `Infinity`, which `readParameterData` rejects — the node flipped into
// the Inspector's unreadable fallback until Undo.
test.describe('Parameter value field — draft until a finite number (#393 A)', () => {
  test('typing -5 stores −5; typing 1e400 leaves the stored value and the node readable', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const id = await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.newGraph()
      g.addNodeAt('parameter', { x: 0, y: 0 })
      const n = (window as any).__loop.graph.getState().nodes[0]
      ;(window as any).__loop.graph.getState().setSelection(n.id, null)
      return n.id as string
    })
    const stored = () => page.evaluate((nid) => (window as any).__loop.graph.getState().nodes.find((n: any) => n.id === nid).data.value, id)
    const field = page.locator('.rightcol').getByLabel('Value', { exact: true })
    await expect(field).toBeVisible()

    await field.click()
    await field.fill('')
    await field.pressSequentially('-5')
    await expect.poll(stored, 'the sign is kept: −5, not 0').toBe(-5)
    expect(await field.inputValue()).toBe('-5')

    await field.fill('')
    await field.pressSequentially('1e400')
    // each finite prefix commits live (1, 1e4, 1e40), as any live field; the
    // overflow itself does not: a number input sanitises it to '' (the typed
    // text stays visible), which the old code stored as Number('') = 0
    expect(await field.inputValue()).toBe('')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(await stored(), 'the stored value is the last finite prefix, never the overflow').toBe(1e40)
    // the node is still readable: the Parameter fields are still shown
    await expect(page.locator('.rightcol').getByLabel('Min (advisory)', { exact: true })).toBeVisible()
    await field.blur()
    expect(await field.inputValue(), 'blur drops the draft and shows the stored value').toBe('1e+40')
    expect(await stored()).toBe(1e40)

    // a pasted overflow (one change) stores nothing at all
    await field.fill('')
    await field.pressSequentially('7')
    await expect.poll(stored).toBe(7)
    await field.fill('1e400')
    expect(await stored(), 'a pasted overflow is never stored').toBe(7)
    await field.blur()
    expect(await field.inputValue()).toBe('7')
  })
})

test.describe('loop-model/2 — parameter-driven flow', () => {
  test('an existing v1 "@foo" flow is NOT promoted by open / save; it still runs as the v1 literal (1)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)

    const v1 = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
        { id: 'b', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '@foo' } },
      ],
    })

    await page.evaluate((t) => (window as any).__loop.graph.getState().loadJSON(t), v1)
    expect(await modelVersion(page)).toBe(1)

    // a plain re-export stays on the v1 schema, flow string verbatim
    const out = await page.evaluate(() => JSON.parse((window as any).__loop.graph.getState().exportJSON()))
    expect(out.schema).toBe('loop-studio/graph')
    expect(out.edges[0].data.flow).toBe('@foo')

    // and the connection runs as the v1 unparseable fallback — 1, not 0
    expect(await step1PoolValue(page)).toBe(1)
  })

  test('committing a leading-@ flow in the Inspector — even a typo — promotes to v2 and the edge runs 0, not 1', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)
    await sourcePoolGraph(page)
    expect(await modelVersion(page)).toBe(1)

    // select the edge and edit its flow field in the real Inspector
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.setSelection(null, g.edges[0].id)
    })
    const flowInput = page.locator('.inspector input').first()
    await expect(flowInput).toBeVisible()
    await flowInput.fill('@{visitor') // an unclosed-brace typo
    await flowInput.blur()

    // the leading-`@` commit latched the document to v2
    await expect.poll(() => modelVersion(page)).toBe(2)

    // v2 rules apply to the typo: the connection contributes 0, NOT the v1 fallback 1
    expect(await step1PoolValue(page)).toBe(0)

    // a fresh Graph JSON export now carries the v2 schema
    const out = await page.evaluate(() => JSON.parse((window as any).__loop.graph.getState().exportJSON()))
    expect(out.schema).toBe('loop-studio/graph/2')
  })

  test('a well-formed @param drives the run and round-trips (Export -> Import) preserving v2', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)

    // source -> pool, plus a parameter, wired by @id via the store
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      g.newGraph()
      g.addNodeAt('source', { x: 0, y: 0 })
      g.addNodeAt('pool', { x: 240, y: 0 })
      g.addNodeAt('parameter', { x: 0, y: 160 })
      const st = (window as any).__loop.graph.getState()
      const s = st.nodes.find((n: any) => n.data.kind === 'source')
      const p = st.nodes.find((n: any) => n.data.kind === 'pool')
      const par = st.nodes.find((n: any) => n.data.kind === 'parameter')
      st.updateNodeData(par.id, { value: 5 })
      st.onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      const eid = (window as any).__loop.graph.getState().edges[0].id
      ;(window as any).__loop.graph.getState().setEdgeData(eid, { kind: 'resource', flow: `@${par.id}` })
    })
    expect(await modelVersion(page)).toBe(2)
    expect(await step1PoolValue(page)).toBe(5)

    const text = await page.evaluate(() => (window as any).__loop.graph.getState().exportJSON())
    expect(JSON.parse(text).schema).toBe('loop-studio/graph/2')

    await page.evaluate((t) => (window as any).__loop.graph.getState().loadJSON(t), text)
    expect(await modelVersion(page)).toBe(2)
    expect(await step1PoolValue(page)).toBe(5) // identical run after the round-trip

    // changing the parameter moves the result
    await page.evaluate(() => {
      const st = (window as any).__loop.graph.getState()
      const par = st.nodes.find((n: any) => n.data.kind === 'parameter')
      st.updateNodeData(par.id, { value: 12 })
    })
    expect(await step1PoolValue(page)).toBe(12)
  })

  test('promoting a graph to v2 marks a completed Monte-Carlo result stale (§M2-8.3)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)
    const edgeId = await sourcePoolGraph(page)

    // a tiny deterministic Monte-Carlo run over the still-v1 graph
    await page.evaluate(() => {
      const mc = (window as any).__loop.mc.getState()
      mc.setConfig({ baseSeed: 1, runs: 3, steps: 2, tracked: [] })
    })
    await page.evaluate(() => (window as any).__loop.mc.getState().run())
    await expect
      .poll(() => page.evaluate(() => (window as any).__loop.mc.getState().status))
      .toBe('done')
    expect(await page.evaluate(() => (window as any).__loop.mc.getState().stale)).toBe(false)

    // an explicit leading-@ commit promotes to v2 AND invalidates the result
    await page.evaluate(
      (id) =>
        (window as any).__loop.graph
          .getState()
          .setEdgeData(id, { kind: 'resource', flow: '@p' }),
      edgeId,
    )
    expect(await modelVersion(page)).toBe(2)
    expect(await page.evaluate(() => (window as any).__loop.mc.getState().stale)).toBe(true)
  })

  test('an unknown / newer schema is rejected (fail-closed) — never a silent load', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)
    const rejected = await page.evaluate(() => {
      const future = JSON.stringify({ schema: 'loop-studio/graph/99', version: 1, nodes: [], edges: [] })
      try {
        ;(window as any).__loop.graph.getState().loadJSON(future)
        return 'loaded'
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    })
    expect(rejected).toMatch(/does not look like a Loop Studio graph file/)
  })
})
