import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'
import { collectWorkspacePayload, importFile, serializeWorkspaceFile } from './workspaceIO'

// issue #409 — reproduction on current main, through the Workspace round trip
// the digest exists for (§W3.2, §W4): a loop-model/2 document whose flow is
// `@p`, a Monte Carlo result, Export Workspace; the Parameter's value is
// changed in the FILE; Import. Is the saved result attached as current to a
// graph whose engine input differs?

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

/** the exported file with one node's data field rewritten, as an outside edit would */
function fileWith(text: string, id: string, patch: Record<string, unknown>): string {
  const doc = JSON.parse(text) as { nodes: { id: string; data: Record<string, unknown> }[] }
  const n = doc.nodes.find((x) => x.id === id)!
  n.data = { ...n.data, ...patch }
  return JSON.stringify(doc)
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

describe('a Workspace result and a Parameter value changed in the file (#409)', () => {
  it('p.value 1 → 7 in the file: the result imports as CURRENT (stale: false) although every step now moves 7, not 1', async () => {
    const { pool, param } = buildV2(1)
    useMcStore.getState().setConfig({ baseSeed: 1, runs: 4, steps: 3, tracked: [pool] })
    await useMcStore.getState().run()
    expect(useMcStore.getState().status).toBe('done')
    expect(useMcStore.getState().result!.series[pool].mean[3]).toBe(3) // 1 per step under p = 1
    const text = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    const savedDigest = useMcStore.getState().resultGraphDigest!

    useMcStore.getState().clear()
    const out = await importFile(fileWith(text, param, { value: 7 }))
    expect(out.workspace).toBe(true)
    expect(out.warnings).toEqual([])
    expect(paramValue(param)).toBe(7) // the file's value is what loaded
    expect(useGraphStore.getState().modelVersion).toBe(2)

    const mc = useMcStore.getState()
    expect(mc.status).toBe('done')
    expect(mc.result!.series[pool].mean[3]).toBe(3) // the result computed under p = 1
    expect(mc.resultGraphDigest).toBe(savedDigest) // "equal" — the digest did not see the value
    expect(mc.stale).toBe(false) // ← current main: attached as current

    // and the engine input really differs: one step now moves 7
    useSimStore.getState().stepOnce()
    expect(useSimStore.getState().values[pool]).toBe(7)
  })

  it('control: the Pool initial changed in the file is seen by the digest, and the result imports stale', async () => {
    const { pool } = buildV2(1)
    useMcStore.getState().setConfig({ baseSeed: 1, runs: 4, steps: 3, tracked: [pool] })
    await useMcStore.getState().run()
    const text = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    useMcStore.getState().clear()
    const out = await importFile(fileWith(text, pool, { initial: 5 }))
    expect(out.workspace).toBe(true)
    expect(poolInitial(pool)).toBe(5)
    expect(useMcStore.getState().status).toBe('done')
    expect(useMcStore.getState().stale).toBe(true)
    expect(out.warnings.some((w) => /earlier version|stale|digest/i.test(w))).toBe(true)
  })
})
