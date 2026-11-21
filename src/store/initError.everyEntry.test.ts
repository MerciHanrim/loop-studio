import { beforeEach, describe, expect, it, vi } from 'vitest'
import desal from '../../examples/desalination.json'
import { STORAGE_KEY } from '../model/serialize'

// Review item `initError` (reproduced 2026-11-21 on main 65c03409): a document the
// engine cannot initialise (a Pool's `initial` above its `capacity`, #406, or a
// negative `initial`). In the session the run bar named the reason and Play and
// Step did nothing, but:
// - Monte Carlo's Run was not refused: it started, failed, and said only "Run failed";
// - right after a reload `initError` was empty: no reason shown, Play enabled;
// - a Workspace saved from it reopened with `initError` cleared and its saved run
//   position taken as a valid head, so Step and Play RAN the refused document
//   (12001 → 11271.83 at step 1; −5 → 870). Only Reset showed the reason again.
// The rule (Lumi, 2026-11-21): whether the document can start a run is known
// from the moment it is open (opened, reloaded, or reopened from a Workspace),
// and Step, Play and Monte Carlo are refused while it cannot. A Workspace's saved
// run position is a valid head only for a document that initialises; the
// document itself opens as written.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

type Stores = {
  g: typeof import('./graphStore')
  s: typeof import('./simStore')
  mc: typeof import('./mcStore')
  ws: typeof import('./workspaceIO')
}
async function freshStores(): Promise<Stores> {
  vi.resetModules()
  const port = await import('../storage/storagePort')
  port.storageSession.use('personal')
  const g = await import('./graphStore')
  await import('./projectStore')
  const s = await import('./simStore')
  const mc = await import('./mcStore')
  const ws = await import('./workspaceIO')
  return { g, s, mc, ws }
}

type Doc = { nodes: { id: string; data: Record<string, unknown> }[] }
const BASIN = 'basin'
const template = (): Doc => JSON.parse(JSON.stringify(desal))
const withInitial = (initial: number) => {
  const d = template()
  d.nodes.find((n) => n.id === BASIN)!.data.initial = initial
  return JSON.stringify(d)
}
const CASES = [
  { name: 'initial 12001 over capacity 12000', initial: 12001, reason: /Pool "Intake basin" initial must be ≤ its capacity \(initial 12001, capacity 12000\)/ },
  { name: 'initial −5', initial: -5, reason: /Pool "Intake basin" initial must be a finite number ≥ 0 \(got -5\)/ },
]
const NOT_RESTORED = /cannot start a run/

let mem: MemStorage
beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/** Step, Play and Monte Carlo are each refused: nothing moves, nothing is written */
async function expectEveryRunRefused(x: Stores, reason: RegExp) {
  const S = () => x.s.useSimStore.getState()
  const M = () => x.mc.useMcStore.getState()
  expect(S().initError).toMatch(reason)
  // `values` is null until first use after a boot, and the empty head after one:
  // neither holds a Pool value
  const now = () => ({ stepIndex: S().stepIndex, values: S().values ?? {} })
  const head = now()
  expect(head).toEqual({ stepIndex: 0, values: {} })
  S().stepOnce()
  expect(now()).toEqual(head)
  S().play()
  for (let i = 0; i < 3 && S().status === 'running'; i++) S().advance()
  const status = S().status
  S().pause()
  expect(status).not.toBe('running')
  expect(now()).toEqual(head)
  const before = M().result
  M().setConfig({ runs: 3, steps: 5 })
  await M().run()
  // refused, not started and failed: no "Run failed", no engine text, the result untouched
  expect(M()).toMatchObject({ status: before ? 'done' : 'idle', message: '', errorDetail: '' })
  expect(M().result).toBe(before)
  expect(S().initError).toMatch(reason)
}

/** a Workspace of the Template as shipped, paused at step 3 */
async function runningWorkspace(): Promise<string> {
  const x = await freshStores()
  x.g.useGraphStore.getState().loadJSON(JSON.stringify(desal))
  for (let i = 0; i < 3; i++) x.s.useSimStore.getState().stepOnce()
  expect(x.s.useSimStore.getState().stepIndex).toBe(3)
  return x.ws.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
}
const withBasinInitial = (workspaceText: string, initial: number) => {
  const d = JSON.parse(workspaceText) as Doc
  d.nodes.find((n) => n.id === BASIN)!.data.initial = initial
  return JSON.stringify(d)
}

describe.each(CASES)('a document that cannot be initialised: $name', ({ initial, reason }) => {
  it('opened in the session: every run is refused', async () => {
    const x = await freshStores()
    x.g.useGraphStore.getState().loadJSON(withInitial(initial))
    await expectEveryRunRefused(x, reason)
  })

  it('opened in the session after a current result: Monte Carlo is refused and the stale result stays', async () => {
    const x = await freshStores()
    x.g.useGraphStore.getState().loadJSON(JSON.stringify(desal))
    x.mc.useMcStore.getState().setConfig({ runs: 3, steps: 5 })
    await x.mc.useMcStore.getState().run()
    expect(x.mc.useMcStore.getState().status).toBe('done')
    x.g.useGraphStore.getState().updateNodeData(BASIN, { initial })
    expect(x.mc.useMcStore.getState().stale).toBe(true)
    await expectEveryRunRefused(x, reason)
    expect(x.mc.useMcStore.getState().stale).toBe(true)
  })

  it('right after a reload: the reason is known before any Step or Play, and every run is refused', async () => {
    const one = await freshStores()
    one.g.useGraphStore.getState().loadJSON(withInitial(initial))
    one.g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).not.toBeNull()
    const x = await freshStores()
    expect(x.s.useSimStore.getState().initError).toMatch(reason) // the run bar reads this
    await expectEveryRunRefused(x, reason)
  })

  it('a Workspace the app saved from it, reopened: the saved run position is not taken, every run is refused', async () => {
    const one = await freshStores()
    one.g.useGraphStore.getState().loadJSON(withInitial(initial))
    const text = one.ws.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
    const x = await freshStores()
    const out = await x.ws.importFile(text)
    expect(out.warnings.join(' ')).toMatch(NOT_RESTORED)
    expect(x.s.useSimStore.getState()).toMatchObject({ status: 'idle', stepIndex: 0, values: {} })
    await expectEveryRunRefused(x, reason)
  })

  it('a Workspace saved at step 3, edited outside the app, reopened: the document opens as written, its run position is not taken', async () => {
    const text = withBasinInitial(await runningWorkspace(), initial)
    const x = await freshStores()
    const out = await x.ws.importFile(text)
    // the document is kept as authored
    expect(x.g.useGraphStore.getState().nodes.find((n) => n.id === BASIN)!.data).toMatchObject({ initial, capacity: 12000 })
    expect(out.warnings.join(' ')).toMatch(NOT_RESTORED)
    expect(x.s.useSimStore.getState()).toMatchObject({ status: 'idle', stepIndex: 0, values: {} })
    await expectEveryRunRefused(x, reason)
  })
})

describe('controls', () => {
  it('a Workspace of a document that initialises restores its run position, and Step goes on from it', async () => {
    const text = await runningWorkspace()
    const saved = (JSON.parse(text) as { workspace: { simulation: { values: Record<string, number> } } }).workspace.simulation.values
    const x = await freshStores()
    const out = await x.ws.importFile(text)
    const S = () => x.s.useSimStore.getState()
    expect(out.warnings).toEqual([])
    expect(S()).toMatchObject({ status: 'paused', stepIndex: 3, initError: null, values: saved })
    S().stepOnce()
    expect(S().stepIndex).toBe(4)
  })

  it('a Workspace whose document a fix makes initialisable: fixing the value lets the run start', async () => {
    const one = await freshStores()
    one.g.useGraphStore.getState().loadJSON(withInitial(12001))
    const text = one.ws.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
    const x = await freshStores()
    await x.ws.importFile(text)
    x.g.useGraphStore.getState().updateNodeData(BASIN, { initial: 12000 })
    const S = () => x.s.useSimStore.getState()
    expect(S().initError).toBeNull()
    S().stepOnce()
    expect(S().stepIndex).toBe(1)
    x.mc.useMcStore.getState().setConfig({ runs: 3, steps: 5 })
    await x.mc.useMcStore.getState().run()
    expect(x.mc.useMcStore.getState()).toMatchObject({ status: 'done' })
  })

  it('a document that initialises, after a reload: no reason, and Step and Monte Carlo run', async () => {
    const one = await freshStores()
    one.g.useGraphStore.getState().loadJSON(JSON.stringify(desal))
    one.g.flushAutosave()
    const x = await freshStores()
    expect(x.s.useSimStore.getState().initError).toBeNull()
    x.s.useSimStore.getState().stepOnce()
    expect(x.s.useSimStore.getState().stepIndex).toBe(1)
    x.mc.useMcStore.getState().setConfig({ runs: 3, steps: 5 })
    await x.mc.useMcStore.getState().run()
    expect(x.mc.useMcStore.getState()).toMatchObject({ status: 'done' })
  })
})
