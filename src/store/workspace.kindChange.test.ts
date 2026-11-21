import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { MC_DEFAULT_CONFIG, useMcStore } from './mcStore'
import { useSimStore } from './simStore'
import { importFile, planWorkspaceExport } from './workspaceIO'

// Review finding M2 — a Workspace file that holds a current Monte Carlo result,
// changed outside the app in a Pool's or a connection's kind only, then opened.
// The engine reads both from loop-model/3 (here the change makes the same 500 L
// another amount), so the saved result no longer belongs to the graph: §W3 says
// it is attached stale, with its notice. The semantic digest it is bound by
// left `resourceType` out, so it opened as current (2026-11-21, main d928365a).
// An edit made in the app was never affected: it moves `simulationRev`.

const G = () => useGraphStore.getState()
const M = () => useMcStore.getState()

const FILE = JSON.stringify({
  schema: 'loop-studio/graph/4',
  version: 1,
  layoutVersion: 1,
  kinds: [
    { name: 'water', conserved: false, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }] },
    { name: 'juice', conserved: false, baseUnit: 'L' },
  ],
  nodes: [
    { id: 'T', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 500, capacity: null, mode: 'pullAny', resourceType: 'water', unit: 'L' } },
    { id: 'D', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'Tap', activation: 'automatic', mode: 'pullAny' } },
    { id: 'S', type: 'source', position: { x: -200, y: 0 }, data: { kind: 'source', label: 'Spring', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e', source: 'T', target: 'D', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 'f', source: 'S', target: 'D', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '0', resourceType: 'water' } },
  ],
})

type Doc = { nodes: { id: string; data: Record<string, unknown> }[]; edges: { id: string; data: Record<string, unknown> }[] }

/** the document with a finished result, written as a Workspace file */
async function workspaceWithResult(): Promise<string> {
  G().loadJSON(FILE)
  useSimStore.getState().reset()
  M().setConfig({ runs: 3, steps: 5 })
  await M().run()
  expect(M()).toMatchObject({ status: 'done', stale: false })
  return planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
}
/** the same file, changed outside the app */
const edited = (text: string, change: (d: Doc) => void) => {
  const d = JSON.parse(text) as Doc
  change(d)
  return JSON.stringify(d)
}

beforeEach(() => {
  M().clear()
  M().setConfig(MC_DEFAULT_CONFIG)
})

describe('a Workspace file changed outside the app, then opened', () => {
  it('a Pool\'s kind changed: the saved result opens stale', async () => {
    const ws = await workspaceWithResult()
    const out = await importFile(edited(ws, (d) => { d.nodes.find((n) => n.id === 'T')!.data.resourceType = 'juice' }))
    expect(M().result).not.toBeNull()
    expect(M().stale).toBe(true)
    expect(out.warnings.join(' ')).toMatch(/earlier version of this graph/)
  })

  it('a connection\'s kind changed: the saved result opens stale', async () => {
    const ws = await workspaceWithResult()
    await importFile(edited(ws, (d) => { d.edges.find((e) => e.id === 'f')!.data.resourceType = 'juice' }))
    expect(M().stale).toBe(true)
  })

  it('control: a Pool\'s unit changed opens stale, as before', async () => {
    const ws = await workspaceWithResult()
    await importFile(edited(ws, (d) => { delete d.nodes.find((n) => n.id === 'T')!.data.unit }))
    expect(M().stale).toBe(true)
  })

  it('control: the file opened as written keeps its result current', async () => {
    const ws = await workspaceWithResult()
    const out = await importFile(ws)
    expect(M()).toMatchObject({ stale: false })
    expect(M().result).not.toBeNull()
    expect(out.warnings).toEqual([])
  })

  it('control: a Source\'s kind changed (read by no layer) keeps the result current', async () => {
    const ws = await workspaceWithResult()
    await importFile(edited(ws, (d) => { d.nodes.find((n) => n.id === 'S')!.data.resourceType = 'juice' }))
    expect(M().stale).toBe(false)
  })
})
