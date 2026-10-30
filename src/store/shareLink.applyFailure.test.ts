import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deserialize, LAYOUT_VERSION, serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { encodeShareText } from '../model/share'
import { sealShareText } from '../model/shareProtected'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'
import { migrateDocument } from './layoutConvert'
import { useMcStore } from './mcStore'
import { __resetProtectedLinkForTests, dismissProtectedNotice, submitProtectedPassword, useProtectedLinkStore } from './protectedLink'
import { consumeShareLink } from './shareLink'
import { useSimStore } from './simStore'

// #420 — a share link whose document `deserialize` accepts but the load cannot
// open. The known case: an older layout (`layoutVersion: 0`, issue #344) whose
// node entry has no `data` — `deserialize` checks only id and position, and the
// re-placement reads `data.label`. Before this fix the re-placement ran inside
// `loadDoc`, after the confirm and after the run-stop; the promise rejected,
// the fragment stayed in the address bar, and the first-run Welcome card (which
// waits on the promise) never appeared. Now the re-placement runs with the other
// validation (§U5.2), before the confirm and before any store change, and a
// throw from the load itself still ends the flow.

const NEVER = (): never => {
  throw new Error('must not be called')
}
const PASSWORD = 'correct horse battery staple'

const POOL = { id: 'p', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P', initial: 3 } }
const SOURCE = { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S' } }
const NO_DATA = { id: 'n', position: { x: 0, y: 80 } }

/** a loop-studio/graph document with the given raw node entries, at the given layout version */
function docText(nodes: unknown[], layoutVersion: number): string {
  const base = JSON.parse(serialize([] as LoopNode[], [] as LoopEdge[])) as Record<string, unknown>
  return JSON.stringify({ ...base, nodes, edges: [], layoutVersion })
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
})

describe('a plain link whose older layout cannot be re-placed', () => {
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

  it('a valid older-layout link still loads, re-placed exactly as `loadDoc` re-placed it', async () => {
    const text = docText([SOURCE, POOL], 0)
    const parsed = deserialize(text)
    const expected = migrateDocument({ nodes: parsed.nodes, edges: parsed.edges, frames: [] })
    const out = await consumeShareLink({ hash: await plainHash(text), confirm: () => true, stripFragment: () => {} })
    expect(out).toEqual({ kind: 'loaded' })
    const nodes = useGraphStore.getState().nodes
    expect(nodes.map((n) => ({ id: n.id, position: n.position }))).toEqual(expected.nodes.map((n) => ({ id: n.id, position: n.position })))
    expect(useGraphStore.getState().edges.map((e) => (e.data as { route?: unknown } | undefined)?.route)).toEqual(expected.edges.map((e) => (e.data as { route?: unknown } | undefined)?.route))
    expect(LAYOUT_VERSION).toBeGreaterThan(0) // the re-placement is a real step, not a no-op
    expect(useSimStore.getState().status).not.toBe('running') // the normal load still stops the run first
  })

  it('a throw from the load itself (after the run-stop) still ends the flow: bad-graph, fragment stripped, no rejection', async () => {
    const real = useGraphStore.getState().loadDoc
    useGraphStore.setState(
      {
        loadDoc: () => {
          throw new Error('boom')
        },
      },
      false,
    )
    let strips = 0
    try {
      const out = await consumeShareLink({
        hash: await plainHash(docText([SOURCE, POOL], LAYOUT_VERSION)),
        confirm: () => true,
        stripFragment: () => {
          strips++
        },
      })
      expect(out).toEqual({ kind: 'failed', reason: 'bad-graph' })
    } finally {
      useGraphStore.setState({ loadDoc: real }, false)
    }
    expect(strips).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe('Loop Studio: a share link could not be applied.')
  })
})

describe('a protected link whose older layout cannot be re-placed', () => {
  it('after the right password: the "not a diagram" notice, nothing touched, the promise settles when the notice closes', async () => {
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
})
