import { beforeEach, describe, expect, it, vi } from 'vitest'
import desal from '../../examples/desalination.json'
import { STORAGE_KEY } from '../model/serialize'

// Review finding S2 (2026-11-15; reproduced 2026-11-21 on main dd4bfe10, in the
// stores and in the browser): right after a reload the four refusal lists were
// all empty. `reset()` and `restoreSnapshot()` filled them; `head()` filled three
// of them, and not the run rule's, on the first Step or Play only. So the run
// bar showed no refusal, Play started, and Monte Carlo — which reads the lists
// without `head()` — wrote a `done` result for a document that cannot run (every
// step refused by the engine, so every Pool flat at its start value). With a run
// rule refusing, Play spun in `running` at step 0.
//
// The rule (Lumi, 2026-11-21): the refusal state is worked out in one place, and
// boot, Reset, a snapshot restore and the first run use the same judgement. Each
// case here boots the stores over a saved record, as a reload does: session 1
// opens the document (a load resets) and flushes the autosave record; session 2
// is a fresh module graph started over it.

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

type ListName = 'refusals' | 'kindRefusals' | 'timetableRefusals' | 'runRefusals'
const LISTS: ListName[] = ['refusals', 'kindRefusals', 'timetableRefusals', 'runRefusals']
const listsOf = (st: Record<ListName, unknown[]>) => Object.fromEntries(LISTS.map((k) => [k, st[k]]))

const template = () => JSON.parse(JSON.stringify(desal))
/** the desalination Template, changed so that one thing refuses the run */
const REFUSED: Record<string, { list: ListName; open: (x: Stores) => void }> = {
  'a run rule (RO reads a tank that is gone)': {
    list: 'runRefusals',
    open: (x) => {
      const d = template()
      const ro = d.nodes.find((n: { id: string }) => n.id === 'ro')
      ro.data.run = { ...ro.data.run, tank: 'gone' }
      x.g.useGraphStore.getState().loadJSON(JSON.stringify(d))
    },
  },
  'a timetable (a line reads ~gone)': {
    list: 'timetableRefusals',
    open: (x) => {
      const d = template()
      d.edges.find((e: { data?: { flow?: string } }) => e.data?.flow === '~naoclDeliveries').data.flow = '~gone'
      x.g.useGraphStore.getState().loadJSON(JSON.stringify(d))
    },
  },
  'a kind (RO puts out more water than it takes in)': {
    list: 'kindRefusals',
    open: (x) => {
      const d = template()
      d.edges.find((e: { source: string; target: string }) => e.source === 'ro' && e.target === 'permeate').data.flow = '9500'
      x.g.useGraphStore.getState().loadJSON(JSON.stringify(d))
    },
  },
  'a group whose paths split and meet again': {
    list: 'refusals',
    open: (x) => {
      const G = () => x.g.useGraphStore.getState()
      G().newGraph()
      const add = (kind: 'pool' | 'gate' | 'converter', i: number) => G().addNodeAt(kind, { x: i * 200, y: 0 })
      for (const [k, i] of [['pool', 0], ['pool', 1], ['pool', 2], ['gate', 3], ['gate', 4], ['gate', 5], ['converter', 6]] as const) add(k, i)
      const by = (kind: string) => G().nodes.filter((n) => n.data.kind === kind).map((n) => n.id)
      const [a, px, py] = by('pool')
      const [g0, g1, g2] = by('gate')
      const [c] = by('converter')
      for (const [s, t] of [[a, g0], [g0, g1], [g0, g2], [g1, c], [g1, py], [g2, c], [c, px]]) G().onConnect({ source: s, target: t, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    },
  },
}

/** session 1 opens the document; its lists after the load are what a reload must give */
async function writeRecord(open: (x: Stores) => void) {
  const one = await freshStores()
  open(one)
  one.s.useSimStore.getState().reset()
  const opened = listsOf(one.s.useSimStore.getState() as never)
  one.g.flushAutosave()
  expect(mem.getItem(STORAGE_KEY)).not.toBeNull()
  return opened
}

let mem: MemStorage
beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

for (const [name, { list, open }] of Object.entries(REFUSED)) {
  describe(`right after a reload, a document refused by ${name}`, () => {
    it('the four refusal lists are what opening it gives', async () => {
      const opened = await writeRecord(open)
      expect((opened[list] as unknown[]).length, 'the fixture refuses (precondition)').toBeGreaterThan(0)
      const { s } = await freshStores()
      expect(listsOf(s.useSimStore.getState() as never)).toEqual(opened)
    })

    it('Step does not start, and the refusal is known before it', async () => {
      await writeRecord(open)
      const { s } = await freshStores()
      const S = () => s.useSimStore.getState()
      S().stepOnce()
      expect(S()[list].length).toBeGreaterThan(0)
      expect(S()).toMatchObject({ stepIndex: 0, status: 'idle' })
    })

    it('Play does not start: it is not left running at step 0', async () => {
      await writeRecord(open)
      const { s } = await freshStores()
      const S = () => s.useSimStore.getState()
      S().play()
      for (let i = 0; i < 5 && S().status === 'running'; i++) S().advance()
      const status = S().status
      S().pause()
      expect(status).toBe('idle')
      expect(S().stepIndex).toBe(0)
    })

    it('Monte Carlo, before any Step or Play, writes no result', async () => {
      await writeRecord(open)
      const { mc } = await freshStores()
      const M = () => mc.useMcStore.getState()
      M().setConfig({ runs: 4, steps: 5 })
      await M().run()
      expect(M()).toMatchObject({ status: 'idle', result: null })
    })
  })
}

describe('controls', () => {
  it('a document with nothing refused boots with empty lists, and Step, Play and Monte Carlo run', async () => {
    await writeRecord((x) => x.g.useGraphStore.getState().loadJSON(JSON.stringify(desal)))
    const { s, mc } = await freshStores()
    const S = () => s.useSimStore.getState()
    expect(listsOf(S() as never)).toEqual({ refusals: [], kindRefusals: [], timetableRefusals: [], runRefusals: [] })
    S().stepOnce()
    expect(S().stepIndex).toBe(1)
    S().play()
    expect(S().status).toBe('running')
    S().pause()
    mc.useMcStore.getState().setConfig({ runs: 4, steps: 5 })
    await mc.useMcStore.getState().run()
    expect(mc.useMcStore.getState()).toMatchObject({ status: 'done' })
    expect(mc.useMcStore.getState().result?.completedRuns).toBe(4)
  })

  it('after a reload, an edit that takes the refusal away clears it, and the run starts', async () => {
    await writeRecord(REFUSED['a run rule (RO reads a tank that is gone)'].open)
    const { g, s } = await freshStores()
    const ro = g.useGraphStore.getState().nodes.find((n) => n.id === 'ro')!
    const run = (template().nodes.find((n: { id: string }) => n.id === 'ro').data as { run: unknown }).run
    g.useGraphStore.getState().updateNodeData('ro', { ...(ro.data as object), run } as never)
    const S = () => s.useSimStore.getState()
    expect(S().runRefusals).toEqual([])
    S().stepOnce()
    expect(S().stepIndex).toBe(1)
  })

  it('after a reload, a Workspace snapshot restores as before: a running document at its step, a refused one refused', async () => {
    // a Workspace of the Template paused at step 3
    const one = await freshStores()
    one.g.useGraphStore.getState().loadJSON(JSON.stringify(desal))
    one.s.useSimStore.getState().reset()
    for (let i = 0; i < 3; i++) one.s.useSimStore.getState().stepOnce()
    expect(one.s.useSimStore.getState().stepIndex).toBe(3)
    const fine = one.ws.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
    // and one of the run-refused Template
    REFUSED['a run rule (RO reads a tank that is gone)'].open(one)
    one.s.useSimStore.getState().reset()
    const refused = one.ws.planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text
    one.g.flushAutosave()

    const { s, ws } = await freshStores()
    const S = () => s.useSimStore.getState()
    await ws.importFile(fine)
    expect(S()).toMatchObject({ stepIndex: 3, status: 'paused', runRefusals: [], refusals: [], kindRefusals: [], timetableRefusals: [] })
    S().stepOnce()
    expect(S().stepIndex).toBe(4)
    await ws.importFile(refused)
    expect(S().runRefusals.length).toBeGreaterThan(0)
    S().play()
    expect(S().status).not.toBe('running')
  })
})
