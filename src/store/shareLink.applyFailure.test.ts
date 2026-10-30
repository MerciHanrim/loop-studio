import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deserialize, LAYOUT_VERSION, serialize, STORAGE_KEY } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { encodeShareText } from '../model/share'
import { sealShareText } from '../model/shareProtected'
import { useFrameStore } from './frameStore'
import { persistNow, setDocumentBoundarySink, useGraphStore } from './graphStore'
import { migrateDocument } from './layoutConvert'
import { useMcStore } from './mcStore'
import { useProjectStore } from './projectStore'
import { __resetProtectedLinkForTests, dismissProtectedNotice, submitProtectedPassword, useProtectedLinkStore } from './protectedLink'
import { consumeShareLink } from './shareLink'
import { useSimStore } from './simStore'

// #420 — a share link whose document `deserialize` accepts but the load cannot
// open. Two different failures, two different outcomes:
//
//  - BEFORE the apply (`bad-graph`): the older-layout re-placement (issue
//    #344, `layoutVersion: 0`) meets a node entry with no `data` — `deserialize`
//    checks only id and position, the re-placement reads `data.label`. Until
//    this fix the re-placement ran inside `loadDoc`, after the confirm and after
//    the run-stop; the promise rejected, the fragment stayed, and the first-run
//    Welcome card (which waits on the promise) never appeared. It now runs with
//    the other validation (§U5.2 stage 5): nothing has changed when it fails.
//  - DURING the apply (`apply-failed`): a throw from `applySharedGraph` comes
//    after `pause()` and possibly after `loadDoc`'s `set`. That state is NOT
//    the one from before the link, and the outcome says so (§U5.5).

const NEVER = (): never => {
  throw new Error('must not be called')
}
const PASSWORD = 'correct horse battery staple'

const POOL = { id: 'p', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P', initial: 3 } }
const SOURCE = { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S' } }
const EDGE = { id: 'e', source: 's', target: 'p', type: 'loop', data: { kind: 'resource', flow: '2' } }
const NO_DATA = { id: 'n', position: { x: 0, y: 80 } }
/** a saved frame around both nodes, as an older document saved it */
const FRAME = { id: 'fr_old', label: 'Old zone', rect: { x: -40, y: -40, w: 420, h: 200 } }

/** a loop-studio/graph document with the given raw node entries, at the given layout version */
function docText(nodes: unknown[], layoutVersion: number, extra: Record<string, unknown> = {}): string {
  const base = JSON.parse(serialize([] as LoopNode[], [] as LoopEdge[])) as Record<string, unknown>
  return JSON.stringify({ ...base, nodes, edges: [], layoutVersion, ...extra })
}
const plainHash = async (text: string) => `#g1=${(await encodeShareText(text)).payload}`
const protectedHash = async (text: string) => `#p1=${(await sealShareText(text, PASSWORD)).payload}`
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** everything a failed load must leave alone, by reference where the stores keep one */
function snapshot() {
  return {
    rev: useGraphStore.getState().simulationRev,
    nodes: useGraphStore.getState().nodes,
    edges: useGraphStore.getState().edges,
    pristine: useGraphStore.getState().pristineSample,
    sim: useSimStore.getState(),
    mc: useMcStore.getState(),
    frames: useFrameStore.getState().snapshot(),
  }
}

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
const storedNodeIds = () => ((JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{"nodes":[]}') as { nodes: { id: string }[] }).nodes.map((n) => n.id))

/** the sink `projectStore` installs (issue #392 A); re-installed after a test replaced it */
const PROJECT_SINK = () => {
  if (useProjectStore.getState().open) useProjectStore.getState().clear()
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetProtectedLinkForTests()
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph() // not the pristine sample: a replace would ask
  useGraphStore.getState().addNodeAt('gate', { x: 10, y: 10 })
  useFrameStore.getState().addFrame({ x: 0, y: 0, w: 120, h: 90 })
  // a run in progress and a Monte Carlo setting, both of which a failed load must not touch
  useSimStore.setState({ status: 'running', stepIndex: 4 }, false)
  useMcStore.setState({ config: { ...useMcStore.getState().config, runs: 137 } }, false)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('before the apply — a plain link whose older layout cannot be re-placed', () => {
  it('fails as bad-graph before the confirm: document, run, MC and frames untouched; fragment stripped; one warning', async () => {
    const before = snapshot()
    let strips = 0
    const out = await consumeShareLink({
      hash: await plainHash(docText([POOL, NO_DATA], 0)),
      confirm: NEVER, // the failure is a validation failure: no replace question
      stripFragment: () => {
        strips++
      },
    })
    expect(out).toEqual({ kind: 'failed', reason: 'bad-graph' })
    const after = snapshot()
    expect(after.rev).toBe(before.rev)
    expect(after.nodes).toBe(before.nodes)
    expect(after.edges).toBe(before.edges)
    expect(after.pristine).toBe(before.pristine)
    expect(after.sim).toBe(before.sim) // the same state object: no `pause()`, no reset
    expect(after.sim.status).toBe('running')
    expect(after.sim.stepIndex).toBe(4)
    expect(after.mc).toBe(before.mc)
    expect(after.mc.config.runs).toBe(137)
    expect(after.frames).toEqual(before.frames)
    expect(strips).toBe(1)
    expect(warn.mock.calls).toEqual([['Loop Studio: ignored a share link whose graph could not be opened.']])
  })

  it('a valid older-layout link still loads, nodes / connections / FRAMES re-placed exactly as `loadDoc` re-placed them', async () => {
    const text = docText([SOURCE, POOL], 0, { edges: [EDGE], frames: [FRAME] })
    const parsed = deserialize(text)
    expect(parsed.frames).toHaveLength(1) // the fixture's frame survives §R5-1.1
    // what `loadDoc` computed under `isLegacyLayout(opts.layoutVersion)` before this change
    const expected = migrateDocument({ nodes: parsed.nodes, edges: parsed.edges, frames: [...parsed.frames] })
    expect(expected.frames![0].rect).not.toEqual(FRAME.rect) // the re-placement moves the frame too, so the check is not vacuous
    const out = await consumeShareLink({ hash: await plainHash(text), confirm: () => true, stripFragment: () => {} })
    expect(out).toEqual({ kind: 'loaded' })
    const g = useGraphStore.getState()
    expect(g.nodes.map((n) => ({ id: n.id, position: n.position }))).toEqual(expected.nodes.map((n) => ({ id: n.id, position: n.position })))
    expect(g.edges.map((e) => [e.id, (e.data as { route?: unknown } | undefined)?.route, (e.data as { waypoints?: unknown } | undefined)?.waypoints])).toEqual(
      expected.edges.map((e) => [e.id, (e.data as { route?: unknown } | undefined)?.route, (e.data as { waypoints?: unknown } | undefined)?.waypoints]),
    )
    expect(useFrameStore.getState().snapshot()).toEqual(expected.frames) // the frame, rebuilt around the re-placed nodes
    expect(LAYOUT_VERSION).toBeGreaterThan(0) // the re-placement is a real step, not a no-op
    expect(useSimStore.getState().status).not.toBe('running') // the normal load still stops the run first
  })
})

describe('during the apply — the load itself throws', () => {
  it('a `loadDoc` that throws at once: apply-failed (not bad-graph), the run already stopped, the document kept, fragment stripped, no rejection', async () => {
    const real = useGraphStore.getState().loadDoc
    useGraphStore.setState(
      {
        loadDoc: () => {
          throw new Error('boom')
        },
      },
      false,
    )
    const before = snapshot()
    let strips = 0
    try {
      const out = await consumeShareLink({
        hash: await plainHash(docText([SOURCE, POOL], LAYOUT_VERSION)),
        confirm: () => true,
        stripFragment: () => {
          strips++
        },
      })
      expect(out).toEqual({ kind: 'failed', reason: 'apply-failed' })
    } finally {
      useGraphStore.setState({ loadDoc: real }, false)
    }
    expect(useGraphStore.getState().nodes).toBe(before.nodes) // nothing of the document changed...
    expect(useGraphStore.getState().simulationRev).toBe(before.rev)
    expect(useSimStore.getState().status).toBe('paused') // ...but the run IS stopped: `pause()` precedes `loadDoc`
    expect(useSimStore.getState().stepIndex).toBe(4)
    expect(strips).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe('Loop Studio: a share link failed while it was being applied; the run was stopped and the diagram may be partly replaced.')
  })

  it('a throw after `loadDoc`’s `set`: the canvas has the link’s document, the run is stopped at its old step, the autosave of this load did not happen', async () => {
    vi.stubGlobal('localStorage', new MemStorage())
    persistNow() // the autosave now holds the current document (the gate)
    const savedBefore = storedNodeIds()
    expect(savedBefore).toHaveLength(1)
    const before = snapshot()
    // the document-boundary sink runs inside `loadDoc` AFTER `set` and the
    // sidecars, BEFORE `bump()` and `persist()` (#392 A order)
    setDocumentBoundarySink(() => {
      throw new Error('boundary boom')
    })
    let strips = 0
    try {
      const out = await consumeShareLink({
        hash: await plainHash(docText([SOURCE, POOL], LAYOUT_VERSION)),
        confirm: () => true,
        stripFragment: () => {
          strips++
        },
      })
      expect(out).toEqual({ kind: 'failed', reason: 'apply-failed' })
    } finally {
      setDocumentBoundarySink(PROJECT_SINK)
    }
    // what is left, exactly (SEMANTICS-U.md §U5.5):
    expect(useGraphStore.getState().nodes.map((n) => n.id).sort()).toEqual(['p', 's']) // the document IS replaced
    expect(useFrameStore.getState().snapshot()).toEqual([]) // the sidecar too (the link had no frame)
    expect(useGraphStore.getState().simulationRev).toBe(before.rev) // no bump: the run was not reset...
    expect(useSimStore.getState().status).toBe('paused') // ...only stopped, where it was
    expect(useSimStore.getState().stepIndex).toBe(4)
    expect(storedNodeIds()).toEqual(savedBefore) // this load wrote no autosave: a reload returns to the saved document
    expect(strips).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe('Loop Studio: a share link failed while it was being applied; the run was stopped and the diagram may be partly replaced.')
  })
})

describe('a protected link', () => {
  it('older layout that cannot be re-placed: after the right password the "not a diagram" notice, nothing touched, the promise settles when the notice closes', async () => {
    const before = snapshot()
    const strip = vi.fn()
    let settled: unknown = null
    const done = consumeShareLink({ hash: await protectedHash(docText([POOL, NO_DATA], 0)), confirm: NEVER, stripFragment: strip }).then((o) => {
      settled = o
      return o
    })
    await tick()
    expect(useProtectedLinkStore.getState().open).toEqual({ phase: 'prompt', busy: false, failures: 0 })
    await submitProtectedPassword(PASSWORD)
    expect(useProtectedLinkStore.getState().open).toEqual({ phase: 'notice', notice: 'content' }) // not `busy`, not a retry
    expect(settled).toBeNull() // the boot flow waits for the notice, as for any notice
    const after = snapshot()
    expect(after.rev).toBe(before.rev)
    expect(after.nodes).toBe(before.nodes)
    expect(after.sim).toBe(before.sim)
    expect(after.sim.status).toBe('running')
    expect(after.mc).toBe(before.mc)
    expect(after.frames).toEqual(before.frames)
    expect(strip).toHaveBeenCalledTimes(1) // the protected flow strips as soon as the bytes are in memory (§P6 step 2)
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'protected-content' })
    expect(useProtectedLinkStore.getState().open).toEqual({ phase: 'idle' })
    expect(warn.mock.calls).toEqual([['Loop Studio: a protected share link opened, but what it carries is not a diagram.']])
  })

  it('a load that throws after it began: its OWN notice (not "not a diagram"), the run stopped, the prompt not left busy, the promise settles on dismiss', async () => {
    const real = useGraphStore.getState().loadDoc
    useGraphStore.setState(
      {
        loadDoc: () => {
          throw new Error('boom')
        },
      },
      false,
    )
    try {
      const done = consumeShareLink({ hash: await protectedHash(docText([SOURCE, POOL], LAYOUT_VERSION)), confirm: () => true, stripFragment: () => {} })
      await tick()
      await submitProtectedPassword(PASSWORD)
      expect(useProtectedLinkStore.getState().open).toEqual({ phase: 'notice', notice: 'apply' })
      expect(useSimStore.getState().status).toBe('paused')
      dismissProtectedNotice()
      expect(await done).toEqual({ kind: 'failed', reason: 'protected-apply-failed' })
    } finally {
      useGraphStore.setState({ loadDoc: real }, false)
    }
    expect(useProtectedLinkStore.getState().open).toEqual({ phase: 'idle' })
    expect(warn.mock.calls).toEqual([['Loop Studio: a protected share link failed while it was being applied; the run was stopped and the diagram may be partly replaced.']])
  })
})
