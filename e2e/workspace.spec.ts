import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, runMc, test } from './support/loop'

// SEMANTICS-W.md loop-workspace/1 — the `Export ▾` → Graph / Workspace flow,
// the §W4 size prompts, and the atomic restore, exercised through the real UI.

type Bridge = { __loop: Record<string, { getState?: () => any } & Record<string, unknown>> }

const textOf = async (dl: Download) => readFileSync((await dl.path())!, 'utf8')

const exportBtn = (page: Page) =>
  page.locator('.toolbar__actions .menu > button', { hasText: 'Export ▾' })
const exportItem = (page: Page, name: RegExp | string) =>
  page.locator('.toolbar__actions .menu__pop').getByRole('menuitem', { name })

/** default dialog policy for a test: accept everything (confirm summaries, alerts) */
function autoAcceptDialogs(page: Page) {
  page.on('dialog', (d) => {
    d.accept().catch(() => {})
  })
}

/** open Export ▾ and click one of its items; returns the resulting download (or
 *  null if none fired). The caller sets the dialog policy. */
async function exportVia(page: Page, item: RegExp | string) {
  await exportBtn(page).click()
  const wait = page.waitForEvent('download', { timeout: 3000 }).catch(() => null)
  await exportItem(page, item).click()
  return wait
}

/** a tiny graph: Source ─2→ Pool ─1→ Drain */
async function smallGraph(page: Page) {
  await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState!()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    g.addNodeAt('drain', { x: 400, y: 0 })
    const [s, p, d] = (window as unknown as Bridge).__loop.graph.getState!().nodes
    const gs = (window as unknown as Bridge).__loop.graph.getState!()
    gs.onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
    gs.onConnect({ source: p.id, target: d.id, sourceHandle: 'out', targetHandle: 'in' })
    const e = (window as unknown as Bridge).__loop.graph.getState!().edges.find((x: any) => x.source === s.id)
    ;(window as unknown as Bridge).__loop.graph.getState!().setEdgeData(e.id, { kind: 'resource', flow: '2' })
  })
}

const state = (page: Page) =>
  page.evaluate(() => {
    const L = (window as unknown as Bridge).__loop
    const sim = L.sim.getState!()
    const mc = L.mc.getState!()
    return {
      simStatus: sim.status,
      step: sim.stepIndex,
      seed: sim.seed,
      mcStatus: mc.status,
      mcView: mc.view,
      mcStale: mc.stale,
      hasResult: mc.result != null,
      distPool: mc.distributionPoolId,
      digest: mc.resultGraphDigest,
      rev: L.graph.getState!().simulationRev,
    }
  })

const importText = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as Bridge).__loop.io.importFile(t) as Promise<unknown>, text)

test.describe('Export ▾ — Graph JSON vs Workspace JSON', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await smallGraph(page)
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      L.sim.getState!().stepOnce()
      L.sim.getState!().stepOnce()
    })
  })

  test('the two files differ; Graph JSON has no `workspace` key', async ({ page }) => {
    autoAcceptDialogs(page)
    const gdl = await exportVia(page, 'Graph JSON') // no dialog
    const gText = await textOf(gdl!)
    const wdl = await exportVia(page, 'Workspace JSON') // summary confirm → accepted
    const wText = await textOf(wdl!)

    expect(gdl!.suggestedFilename()).toBe('loop-studio-graph.json')
    expect(wdl!.suggestedFilename()).toBe('loop-studio-workspace.json')
    const graph = JSON.parse(gText)
    const ws = JSON.parse(wText)
    expect(graph.workspace).toBeUndefined()
    expect(ws.workspace.schema).toBe('loop-workspace/1')
    expect(ws.workspace.simulation.step).toBe(2)
    expect(gText).not.toBe(wText)
  })

  test('the summary confirm can be cancelled — 0 downloads, 0 state change', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss().catch(() => {}))
    const before = await state(page)
    const dl = await exportVia(page, 'Workspace JSON')
    expect(dl).toBeNull() // dialog dismissed ⇒ no download
    expect(await state(page)).toEqual(before)
  })

  test('byte size is real UTF-8 (Hangul + emoji label counts as multi-byte)', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState!()
      g.updateNodeData(g.nodes[1].id, { label: '저장고 \u{1F9E9}\u{1F3ED}' }) // "저장고 🧩🏭"
    })
    const { bytes, len } = await page.evaluate(() => {
      const plan = (window as unknown as Bridge).__loop.io.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }) as {
        full: { text: string; bytes: number }
      }
      return { bytes: plan.full.bytes, len: plan.full.text.length }
    })
    const expected = await page.evaluate(() => {
      const plan = (window as unknown as Bridge).__loop.io.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }) as {
        full: { text: string }
      }
      return new TextEncoder().encode(plan.full.text).length
    })
    expect(bytes).toBe(expected)
    expect(bytes).toBeGreaterThan(len) // multi-byte label ⇒ bytes exceed code units
  })
})

test.describe('§W4 size prompts (dev cap)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await smallGraph(page)
  })

  test('over the cap with a result ⇒ confirm to omit ⇒ file carries resultOmitted, no result', async ({ page }) => {
    autoAcceptDialogs(page)
    await runMc(page, { baseSeed: 1, runs: 40, steps: 4, tracked: [] })
    // cap below the with-result size but above the graph+snapshot size
    await page.evaluate(() => {
      const plan = (window as unknown as Bridge).__loop.io.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }) as any
      ;(window as any).__workspaceMaxBytes = Math.floor((plan.full.bytes + plan.lean.bytes) / 2)
    })
    const dl = await exportVia(page, 'Workspace JSON') // dialog accepted ⇒ save without result
    expect(dl).toBeTruthy()
    const ws = JSON.parse(await textOf(dl!)).workspace
    expect(ws.mc.resultOmitted).toBe('size-limit')
    expect(ws.mc.result).toBeUndefined()
  })

  test('over the cap even without the result ⇒ 0 downloads + an error', async ({ page }) => {
    await runMc(page, { baseSeed: 1, runs: 40, steps: 4, tracked: [] })
    await page.evaluate(() => ((window as any).__workspaceMaxBytes = 10))
    let alerted = ''
    page.once('dialog', (d) => {
      alerted = d.message()
      d.accept()
    })
    await exportBtn(page).click()
    const noDl = page.waitForEvent('download', { timeout: 1500 }).catch(() => null)
    await exportItem(page, 'Workspace JSON').click()
    expect(await noDl).toBeNull()
    expect(alerted).toMatch(/over the .* limit even without the distribution/)
  })
})

test.describe('Workspace Import — restore is atomic and always paused', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await smallGraph(page)
  })

  test('a workspace saved mid-run imports paused, one rev bump, nothing auto-runs', async ({ page }) => {
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      for (let i = 0; i < 3; i++) L.sim.getState!().stepOnce()
    })
    await runMc(page, { baseSeed: 1, runs: 20, steps: 3, tracked: [] })
    const file = await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      return L.io.serializeWorkspaceFile(L.io.collectWorkspacePayload({ x: 40, y: -5, zoom: 1.3 })) as string
    })

    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      L.mc.getState!().clear()
      L.sim.getState!().reset()
    })
    const revBefore = (await state(page)).rev
    await importText(page, file)
    const after = await state(page)

    expect(after.rev).toBe(revBefore + 1) // exactly one
    expect(after.simStatus).toBe('paused')
    expect(after.step).toBe(3)
    expect(after.mcStatus).not.toBe('running')
    expect(after.hasResult).toBe(true)
    expect(after.mcStale).toBe(false) // atomic: the load bump did not re-stale it
  })

  test('viewport restores valid values only; zoom is clamped to the React Flow range', async ({ page }) => {
    const doc = await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      const g = L.graph.getState!()
      return JSON.stringify({
        schema: 'loop-studio/graph', version: 1, nodes: g.nodes, edges: g.edges,
        workspace: {
          schema: 'loop-workspace/1', version: 1,
          mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [] }, stale: false },
          view: { timeline: 'live', distributionPoolId: null, showMean: false },
          canvas: { x: 25, y: 60, zoom: 999 }, // absurd zoom
          simulation: { seed: 1, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] },
        },
      })
    })
    await page.evaluate((t) => (window as unknown as Bridge).__loop.io.importFile(t), doc)
    // the Toolbar's onFile applies out.canvas; here we drive importFile directly,
    // so assert the reader clamped it before it reaches setViewport
    const clamped = await page.evaluate(async (t) => {
      const out = (await (window as unknown as Bridge).__loop.io.importFile(t)) as { canvas?: { zoom: number } }
      return out.canvas?.zoom
    }, doc)
    expect(clamped).toBeLessThanOrEqual(16)
    expect(clamped).toBeGreaterThan(0)
  })

  test('a DISTRIBUTION view with no usable result restores as LIVE', async ({ page }) => {
    const doc = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState!()
      return JSON.stringify({
        schema: 'loop-studio/graph', version: 1, nodes: g.nodes, edges: g.edges,
        workspace: {
          schema: 'loop-workspace/1', version: 1,
          mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [] }, stale: false },
          view: { timeline: 'distribution', distributionPoolId: g.nodes[1].id, showMean: true },
          canvas: { x: 0, y: 0, zoom: 1 },
          simulation: { seed: 1, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] },
        },
      })
    })
    await importText(page, doc)
    expect((await state(page)).mcView).toBe('live')
  })

  test('move / rename does not stale a result; an engine edit does', async ({ page }) => {
    await runMc(page, { baseSeed: 1, runs: 20, steps: 3, tracked: [] })
    const file = await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      return L.io.serializeWorkspaceFile(L.io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 })) as string
    })

    // (a) cosmetic edit in the file ⇒ not stale
    const moved = JSON.parse(file)
    moved.nodes[0].position = { x: 999, y: 999 }
    moved.nodes[1].data.label = 'Renamed'
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      L.mc.getState!().clear()
      L.sim.getState!().reset()
    })
    await importText(page, JSON.stringify(moved))
    expect((await state(page)).mcStale).toBe(false)

    // (b) engine edit in the file ⇒ stale
    const edited = JSON.parse(file)
    edited.nodes[1].data.capacity = (edited.nodes[1].data.capacity ?? 0) + 7
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      L.mc.getState!().clear()
      L.sim.getState!().reset()
    })
    await importText(page, JSON.stringify(edited))
    const s = await state(page)
    expect(s.hasResult).toBe(true)
    expect(s.mcStale).toBe(true)
  })

  test('a plain Graph import after a Workspace leaves no restored snapshot', async ({ page }) => {
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      for (let i = 0; i < 4; i++) L.sim.getState!().stepOnce()
    })
    const ws = await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      return L.io.serializeWorkspaceFile(L.io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 })) as string
    })
    await importText(page, ws)
    expect((await state(page)).step).toBe(4) // workspace restored the run

    // now a plain graph file (no workspace key)
    const plain = await page.evaluate((wsText) => {
      const doc = JSON.parse(wsText)
      delete doc.workspace
      return JSON.stringify(doc)
    }, ws)
    const out = (await importText(page, plain)) as { workspace: boolean }
    expect(out.workspace).toBe(false)
    expect((await state(page)).step).toBe(0) // no snapshot leaked from the earlier workspace
  })
})
