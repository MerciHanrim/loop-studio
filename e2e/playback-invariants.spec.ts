import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md §PB11 / VL-INV — playing, pausing, or discarding a
// run must move NOTHING that belongs to the document: GraphDoc bytes, the
// loop-revision/3 digest, the undo stack, the viewport, and every edge `d`
// (visible + hit area). The whole point of the choreography layer is that it is
// read-only over the engine. No state-machine change here.

type Bridge = {
  __loop: Record<string, { getState: () => any }> & {
    revisionIO: { currentTargetDigest: () => string }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o?: unknown) => void }
  }
}

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 280, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'drn', type: 'drain', position: { x: 560, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'automatic', mode: 'pullAny' } },
    { id: 'sink2', type: 'drain', position: { x: 560, y: 200 }, data: { kind: 'drain', label: 'D2', activation: 'passive', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_pd', type: 'loop', source: 'pool', target: 'drn', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal' } },
    { id: 't_sd', type: 'loop', source: 'src', target: 'sink2', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) => page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)

/** every document-owned surface, normalised for comparison */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      viewport: l.rf.getViewport(),
      // GraphDoc content — id / position / data only (React Flow's measured /
      // selected / dragging are runtime, not document)
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.type, n.position, n.data]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]),
      }),
      // rendered geometry
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
      hit: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-interaction')].map((p) => p.getAttribute('d')),
    }
  })

async function setup(page: Page, speedMs = 1400) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
  await expect(page.locator('.react-flow__edge[data-id="e_pd"] path.route-orthogonal')).toHaveCount(1)
}

test.describe('playback — Slice 3c-c: VL-INV carry-over', () => {
  test('Play → Pause → Resume → Reset moves no GraphDoc / digest / undo / viewport / edge d', async ({ page }) => {
    await setup(page)
    const before = await snapshot(page)

    await call(page, 'play')
    await expect.poll(() => sim(page)).toBeGreaterThan(2)

    // mid-flight (a transition in progress): the document is already untouched
    await call(page, 'pause')
    const mid = await snapshot(page)
    expect(mid.digest).toBe(before.digest)
    expect(mid.graph).toBe(before.graph)
    expect([mid.canUndo, mid.canRedo]).toEqual([before.canUndo, before.canRedo])
    expect(mid.viewport).toEqual(before.viewport)
    expect(mid.d).toEqual(before.d)
    expect(mid.hit).toEqual(before.hit)

    await call(page, 'play')
    await expect.poll(() => sim(page)).toBeGreaterThan(5)
    await call(page, 'pause')
    await call(page, 'reset')

    const after = await snapshot(page)
    expect(after).toEqual(before) // byte-for-byte back to the start
  })

  test('discarding a run mid-transition (a graph edit) leaves the committed state at the pre-transition step', async ({ page }) => {
    await setup(page, 3000)
    await call(page, 'advance') // commit step 1
    const at1 = await sim(page)
    expect(at1).toBe(1)

    // start a choreographed step, freeze it mid-travel
    await call(page, 'setSpeed', 4000)
    await call(page, 'stepOnce')
    await expect
      .poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition?.tau ?? -1), { timeout: 9000 })
      .toBeGreaterThan(0.25)

    const digestMid = await page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

    // an engine edit discards the transition immediately (Slice 1 Round 2) and
    // rewinds the sim — the committed step must NOT be step 2
    await page.evaluate(() => (window as any).__loop.graph.getState().setEdgeData('e_sp', { kind: 'resource', flow: '9' }))
    await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition)).toBe(null)
    const s = await page.evaluate(() => (window as any).__loop.sim.getState())
    expect(s.stepIndex).toBe(0) // rewound, not left at a half-applied step 2
    expect(s.status).not.toBe('running')
    // the digest changed because the EDIT changed the graph, not the playback
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())).not.toBe(digestMid)
    // no orphan cue from the discarded transition
    await expect(page.locator('.pb-move, g.state-move, .pb-cue, .state-cue--activator')).toHaveCount(0)

    // undo the edit ⇒ back to the exact pre-edit digest
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())).toBe(digestMid)
  })

  test('a zoom / pan during playback is honoured and never reset by a τ tick or settle', async ({ page }) => {
    await setup(page, 2500)
    await call(page, 'play')
    await expect.poll(() => sim(page)).toBeGreaterThan(1)

    // pan+zoom mid-run
    await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 111, y: -47, zoom: 0.7 }, { duration: 0 }))
    await page.waitForTimeout(60)
    const vp1 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())

    // let several settles pass
    await expect.poll(() => sim(page)).toBeGreaterThan(4)
    await page.waitForTimeout(400)
    await call(page, 'pause')
    const vp2 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    expect(vp2.x).toBeCloseTo(vp1.x, 1)
    expect(vp2.y).toBeCloseTo(vp1.y, 1)
    expect(vp2.zoom).toBeCloseTo(vp1.zoom, 2)
  })
})
