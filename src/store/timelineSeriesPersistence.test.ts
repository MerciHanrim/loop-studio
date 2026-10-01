import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeShareText } from '../model/share'
import {
  STORAGE_KEY,
  deserialize,
  loadFromStorage,
  readTimelineSeries,
  saveToStorage,
  serialize,
} from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { useGraphStore } from './graphStore'
import { recommendedRunConfigForExport, useMcStore } from './mcStore'
import { useProjectStore } from './projectStore'
import { routeImport } from './revisionIO'
import { consumeShareLink } from './shareLink'
import { useSimStore } from './simStore'
import { collectWorkspacePayload, importFile, serializeWorkspaceFile } from './workspaceIO'

// docs/timeline-series-contract.md §3.1 — `'all'` must become storable across
// EVERY persistence path at once, and `'auto'` (the automatic default) must
// never reach disk. Each `describe` below is one path; a path that silently
// dropped `'all'` on read would make `모두 표시` appear to work in-session and
// then reset to the default on the next open — the failure this file exists to
// catch.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const NODES = [
  { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
  { id: 'p1', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'p2', type: 'pool', position: { x: 200, y: 120 }, data: { kind: 'pool', label: 'P2', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'reg_a', type: 'register', position: { x: 600, y: 0 }, data: { kind: 'register', label: 'Reg A', expr: '@p1 + @p2' } },
] as unknown as LoopNode[]
const EDGES = [
  { id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
] as unknown as LoopEdge[]

const sim = () => useSimStore.getState()
const record = () => {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}
/** the three stored states, and what each must look like on disk */
const STATES = [
  { label: 'auto', set: 'auto' as const, expectSim: 'auto', onDisk: undefined },
  { label: 'all', set: 'all' as const, expectSim: 'all', onDisk: 'all' },
  { label: 'explicit', set: ['p2', 'p1'] as string[], expectSim: ['p1', 'p2'], onDisk: ['p1', 'p2'] },
]

beforeEach(() => {
  vi.useFakeTimers() // neutralise the graphStore `persist()` debounce
  vi.stubGlobal('localStorage', new MemStorage())
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
  useGraphStore.getState().loadDoc({ nodes: NODES, edges: EDGES })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  sim().setTimelineSeries(undefined)
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ── the one shape rule ─────────────────────────────────────────────────────
describe('readTimelineSeries — the single reader every path goes through', () => {
  it.each([
    [undefined, 'auto'],
    [null, 'auto'],
    ['auto', 'auto'],
    ['all', 'all'],
    [[], 'auto'],
    [['b', 'a', 'b'], ['a', 'b']],
    [['a', 3, null, 'c'], ['a', 'c']],
    [[3, null], 'auto'],
    ['ALL', 'auto'],
    ['oops', 'auto'],
    [42, 'auto'],
    [{}, 'auto'],
    [true, 'auto'],
  ] as const)('%j ⇒ %j', (input, expected) => {
    expect(readTimelineSeries(input)).toEqual(expected)
  })

  it('never throws, whatever the shape', () => {
    for (const v of [Symbol('x'), () => 1, new Date(), Object.create(null)]) {
      expect(() => readTimelineSeries(v)).not.toThrow()
      expect(readTimelineSeries(v)).toBe('auto')
    }
  })
})

// ── path 1: the file format itself ─────────────────────────────────────────
describe("file serialization — 'all' survives serialize → deserialize verbatim", () => {
  it("writes and reads back 'all'", () => {
    const back = deserialize(serialize(NODES, EDGES, { runs: 3, steps: 3, timelineSeries: 'all' }))
    expect(back.recommendedRunConfig?.timelineSeries).toBe('all')
  })
  it('a file without the field still deserializes without it — absent stays absent', () => {
    const back = deserialize(serialize(NODES, EDGES, { runs: 3, steps: 3 }))
    expect(back.recommendedRunConfig).not.toHaveProperty('timelineSeries')
  })
})

// ── path 2: the autosave record ────────────────────────────────────────────
describe('autosave record — saveToStorage / loadFromStorage / the boot read', () => {
  it.each(STATES)('$label: on disk as $onDisk, and the boot computation reads it back', ({ set, expectSim, onDisk }) => {
    sim().setTimelineSeries(set)
    expect(sim().timelineSeries).toEqual(expectSim)
    const rec = record()
    if (onDisk === undefined) expect(rec).not.toHaveProperty('recommendedRunConfig')
    else expect(rec.recommendedRunConfig).toEqual({ timelineSeries: onDisk })
    // what `graphStore` computes at boot from this record
    expect(readTimelineSeries(loadFromStorage()?.recommendedRunConfig?.timelineSeries)).toEqual(expectSim)
  })

  it("saveToStorage('all') directly writes the field; 'auto' writes none", () => {
    saveToStorage(NODES, EDGES, null, 'all')
    expect(record().recommendedRunConfig).toEqual({ timelineSeries: 'all' })
    saveToStorage(NODES, EDGES, null, 'auto')
    expect(record()).not.toHaveProperty('recommendedRunConfig')
  })
})

// ── path 3: the in-app load (every document / template / link goes here) ───
describe('applyRecommended — the load-time validator', () => {
  it.each(STATES)('$label ⇒ sim $expectSim', ({ set, expectSim }) => {
    sim().setTimelineSeries(['zzz']) // a distinct prior state, so "unchanged" cannot pass
    useMcStore.getState().applyRecommended(set === 'auto' ? {} : { timelineSeries: set })
    expect(sim().timelineSeries).toEqual(expectSim)
  })
})

// ── path 4: Export ─────────────────────────────────────────────────────────
describe('Graph JSON Export → loadJSON → applyRecommended', () => {
  it.each(STATES)('$label round-trips', ({ set, expectSim, onDisk }) => {
    sim().setTimelineSeries(set)
    const text = useGraphStore.getState().exportJSON(recommendedRunConfigForExport())
    const file = JSON.parse(text)
    if (onDisk === undefined) expect(file.recommendedRunConfig ?? {}).not.toHaveProperty('timelineSeries')
    else expect(file.recommendedRunConfig.timelineSeries).toEqual(onDisk)

    useGraphStore.getState().newGraph()
    sim().setTimelineSeries(['zzz'])
    useMcStore.getState().applyRecommended(useGraphStore.getState().loadJSON(text))
    expect(sim().timelineSeries).toEqual(expectSim)
  })
})

// ── path 5: Share ──────────────────────────────────────────────────────────
describe('Share link — encodeShareText(exportJSON) → consumeShareLink', () => {
  const NEVER = (): never => {
    throw new Error('must not be called')
  }
  it.each(STATES)('$label survives the link', async ({ set, expectSim }) => {
    sim().setTimelineSeries(set)
    const text = useGraphStore.getState().exportJSON(recommendedRunConfigForExport())
    const { payload } = await encodeShareText(text)

    useGraphStore.getState().newGraph()
    sim().setTimelineSeries(['zzz'])
    useGraphStore.setState({ pristineSample: true }, false) // no replace prompt
    const out = await consumeShareLink({ hash: `#g1=${payload}`, confirm: NEVER })
    expect(out).toEqual({ kind: 'loaded' })
    expect(sim().timelineSeries).toEqual(expectSim)
  })
})

// ── path 6: Workspace ──────────────────────────────────────────────────────
describe('Workspace file — serializeWorkspaceFile → importFile', () => {
  it.each(STATES)('$label survives the workspace round-trip', async ({ set, expectSim, onDisk }) => {
    sim().setTimelineSeries(set)
    const text = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    const file = JSON.parse(text)
    if (onDisk === undefined) expect(file.recommendedRunConfig ?? {}).not.toHaveProperty('timelineSeries')
    else expect(file.recommendedRunConfig.timelineSeries).toEqual(onDisk)

    useGraphStore.getState().newGraph()
    sim().setTimelineSeries(['zzz'])
    const outcome = await importFile(text)
    expect(outcome.workspace).toBe(true)
    expect(sim().timelineSeries).toEqual(expectSim)
  })
})

// ── path 7: a Project revision file ────────────────────────────────────────
describe('Project revision file — routeImport(kind: revision)', () => {
  let seq = 0
  const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`

  /** promote the current graph into a committed revision file, then give the
   *  file a `recommendedRunConfig.timelineSeries`. The digest is computed over
   *  the canonical projection, which excludes `timelineSeries` by design, so
   *  the header still verifies. */
  function revisionFileWith(ts: 'all' | string[] | undefined): string {
    const plan = useProjectStore.getState().planRevision({ now: '2026-10-01T00:00:00Z', mint })
    if (!plan.ok) throw new Error('plan')
    useProjectStore.getState().commitRevisionExport(plan.plan)
    const file = JSON.parse(plan.text)
    if (ts !== undefined) file.recommendedRunConfig = { ...(file.recommendedRunConfig ?? {}), timelineSeries: ts }
    return JSON.stringify(file)
  }

  it.each(STATES)('$label loads through the revision branch', async ({ set, expectSim }) => {
    const text = revisionFileWith(set === 'auto' ? undefined : set)
    useGraphStore.getState().newGraph()
    useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
    sim().setTimelineSeries(['zzz'])
    const r = await routeImport(text)
    expect(r.kind).toBe('revision') // the header verified — `timelineSeries` did not disturb the digest
    expect(sim().timelineSeries).toEqual(expectSim)
  })
})

// ── §3.2: loading must not cause an ADDITIONAL immediate autosave ──────────
// `loadDoc` already schedules the debounced graph save by design; that one
// write is allowed and is what carries the field. What the contract forbids is
// the hydration path flushing a write of its own — and "absent stays absent"
// must hold once the debounced save has run.
describe('§3.2 — hydration adds no immediate autosave; the scheduled save carries the field', () => {
  const graphWrites = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([k]) => k === STORAGE_KEY).length

  it.each(STATES)(
    '$label: applyRecommended writes the graph record 0 times; the ONE debounced save then holds $onDisk',
    ({ set, onDisk }) => {
      useGraphStore.getState().loadDoc({ nodes: NODES, edges: EDGES }) // schedules the debounced save
      const spy = vi.spyOn(localStorage, 'setItem')
      useMcStore.getState().applyRecommended(set === 'auto' ? {} : { timelineSeries: set })
      expect(graphWrites(spy), 'immediate graph-record writes caused by hydration').toBe(0)

      vi.advanceTimersByTime(400)
      expect(graphWrites(spy), 'the existing debounced save, and only that').toBe(1)
      const rec = record()
      if (onDisk === undefined) expect(rec).not.toHaveProperty('recommendedRunConfig')
      else expect(rec.recommendedRunConfig).toEqual({ timelineSeries: onDisk })
      spy.mockRestore()
    },
  )

  it('a file WITH the field costs exactly as many graph-record writes to load as a file WITHOUT it', async () => {
    const withField = useGraphStore.getState().exportJSON({ runs: 3, steps: 3, timelineSeries: 'all' })
    const without = useGraphStore.getState().exportJSON({ runs: 3, steps: 3 })
    const writesToLoad = async (text: string) => {
      const spy = vi.spyOn(localStorage, 'setItem')
      await importFile(text)
      const n = graphWrites(spy)
      spy.mockRestore()
      return n
    }
    const a = await writesToLoad(withField)
    const b = await writesToLoad(without)
    expect(a, `with field: ${a}, without: ${b}`).toBe(b)
  })

  it('the USER setter still flushes immediately — the split moves the write off the load path, it does not remove it', () => {
    const spy = vi.spyOn(localStorage, 'setItem')
    sim().setTimelineSeries('all')
    expect(graphWrites(spy)).toBe(1)
    expect(record().recommendedRunConfig).toEqual({ timelineSeries: 'all' })
    spy.mockRestore()
  })
})

// ── the property the whole change protects ─────────────────────────────────
describe("'all' and 'auto' are different states, everywhere", () => {
  it('a user who chooses every series does not get the automatic default on the next load', async () => {
    sim().setTimelineSeries('all')
    const text = useGraphStore.getState().exportJSON(recommendedRunConfigForExport())
    useGraphStore.getState().newGraph()
    useMcStore.getState().applyRecommended(useGraphStore.getState().loadJSON(text))
    expect(sim().timelineSeries).toBe('all')
    expect(sim().timelineSeries).not.toBe('auto')
  })
  it('the automatic default never reaches a file, a link, a workspace, or the autosave record', async () => {
    sim().setTimelineSeries('auto')
    const graphText = useGraphStore.getState().exportJSON(recommendedRunConfigForExport())
    const wsText = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    const { payload } = await encodeShareText(graphText)
    for (const text of [graphText, wsText, JSON.stringify(record()), payload]) {
      expect(text).not.toMatch(/"timelineSeries"/)
      expect(text).not.toMatch(/"auto"/)
    }
  })
})
