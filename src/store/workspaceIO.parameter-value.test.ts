import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'
import { collectWorkspacePayload, importFile, serializeWorkspaceFile } from './workspaceIO'

// issue #409 — the Workspace round trip the digest exists for (§W3.2, §W4): a
// loop-model/2 document whose flow is `@p`, a Monte Carlo result, Export
// Workspace; the Parameter's value is changed in the FILE; Import. Since the
// §W3.1 erratum (Lumi, 2026-10-30) the digest sees the value under v2, so the
// saved result is attached stale, with the notice, exactly as a Pool initial
// changed in the file is; a re-run at the new value clears it.

/** Source ─@p→ Pool, p = 1; the leading-`@` flow commit latches loop-model/2 */
function buildV2(value = 1) {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  g.addNodeAt('parameter', { x: 0, y: 200 })
  const [src, pool, param] = useGraphStore.getState().nodes.map((n) => n.id)
  useGraphStore.getState().updateNodeData(param, { value })
  useGraphStore.getState().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  const e = useGraphStore.getState().edges[0]
  useGraphStore.getState().setEdgeData(e.id, { kind: 'resource', flow: `@${param}` })
  expect(useGraphStore.getState().modelVersion).toBe(2)
  return { src, pool, param }
}
const paramValue = (id: string) => (useGraphStore.getState().nodes.find((n) => n.id === id)!.data as { value: number }).value
const poolInitial = (id: string) => (useGraphStore.getState().nodes.find((n) => n.id === id)!.data as { initial: number }).initial
const STALE_NOTICE = /earlier version|stale|digest/i

/** the exported file with one node's data field rewritten, as an outside edit would */
function fileWith(text: string, id: string, patch: Record<string, unknown>): string {
  const doc = JSON.parse(text) as { nodes: { id: string; data: Record<string, unknown> }[] }
  const n = doc.nodes.find((x) => x.id === id)!
  n.data = { ...n.data, ...patch }
  return JSON.stringify(doc)
}

async function exportedWithResult(pool: string): Promise<{ text: string; digest: string }> {
  useMcStore.getState().setConfig({ baseSeed: 1, runs: 4, steps: 3, tracked: [pool] })
  await useMcStore.getState().run()
  expect(useMcStore.getState().status).toBe('done')
  return { text: serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 })), digest: useMcStore.getState().resultGraphDigest! }
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

describe('a Workspace result and a Parameter value changed in the file (#409)', () => {
  it('p.value 1 → 7 in the file: the result imports STALE with the notice, its digest kept, and the graph loads with 7; a re-run clears it', async () => {
    const { pool, param } = buildV2(1)
    const { text, digest } = await exportedWithResult(pool)
    expect(useMcStore.getState().result!.series[pool].mean[3]).toBe(3) // 1 per step under p = 1

    useMcStore.getState().clear()
    const out = await importFile(fileWith(text, param, { value: 7 }))
    expect(out.workspace).toBe(true)
    expect(out.warnings.some((w) => STALE_NOTICE.test(w))).toBe(true)
    expect(paramValue(param)).toBe(7)
    expect(useGraphStore.getState().modelVersion).toBe(2)

    const mc = useMcStore.getState()
    expect(mc.status).toBe('done') // still viewable
    expect(mc.result!.series[pool].mean[3]).toBe(3) // the result computed under p = 1
    expect(mc.resultGraphDigest).toBe(digest) // the file's digest, never relabelled (§W3.2)
    expect(mc.stale).toBe(true)

    // the engine input really differs: one step now moves 7
    useSimStore.getState().stepOnce()
    expect(useSimStore.getState().values?.[pool]).toBe(7)

    // a re-run at the new value is current again
    await useMcStore.getState().run()
    expect(useMcStore.getState().stale).toBe(false)
    expect(useMcStore.getState().result!.series[pool].mean[3]).toBe(21)
  })

  it('an unchanged file imports its result as current; a Pool initial changed in the file imports it stale, as before', async () => {
    const { pool } = buildV2(1)
    const { text } = await exportedWithResult(pool)

    useMcStore.getState().clear()
    const same = await importFile(text)
    expect(same.warnings).toEqual([])
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: false })

    useMcStore.getState().clear()
    const out = await importFile(fileWith(text, pool, { initial: 5 }))
    expect(poolInitial(pool)).toBe(5)
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: true })
    expect(out.warnings.some((w) => STALE_NOTICE.test(w))).toBe(true)
  })

  it('a Parameter field that is not an engine input (min / max / unit) changed in the file leaves the result current', async () => {
    const { pool, param } = buildV2(1)
    const { text } = await exportedWithResult(pool)
    useMcStore.getState().clear()
    const out = await importFile(fileWith(text, param, { min: 0, max: 50, unit: 'kg' }))
    expect(out.warnings).toEqual([])
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: false })
  })
})
