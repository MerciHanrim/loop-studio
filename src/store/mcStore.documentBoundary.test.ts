import { beforeEach, describe, expect, it, vi } from 'vitest'

// A Monte Carlo run belongs to the document it started on (review finding S3,
// 2026-11-15; reproduced 2026-11-20 in the browser with real Workers: a run on
// document A, ending after B was opened, replaced B's own finished result).
// The rule (Lumi, 2026-11-21): opening another document — New, a Template, a
// file, a share link, a Workspace — cancels the run in flight. Whatever that
// run answers later (its result, its cancellation, its progress) changes
// nothing of the document now open. A run started on B is completed and
// cancelled on B only. An EDIT of the same document is not another document:
// #407 stands (the run goes on and lands stale; mcStore.mid-run-edit.test.ts).
//
// The runner is a stand-in the test settles by hand, so two runs are in flight
// in a fixed order, as they can be in the app (Workers, or the browser's
// yielding local path). It does not settle itself on abort: a late answer of
// either kind is the test's to send. Everything else is real.

type Pending = {
  label: string
  signal: AbortSignal
  resolve: (r: unknown) => void
  reject: (e: unknown) => void
  progress: (p: { provisional: boolean; completedRuns: number; totalRuns: number; progress: number }) => void
}
const pending: Pending[] = []
vi.mock('../engine', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    runMonteCarloParallel: (_n: unknown, _e: unknown, config: { runs: number }, opts: { signal: AbortSignal; onProgress?: Pending['progress'] }) =>
      new Promise((resolve, reject) => {
        pending.push({ label: `runs=${config.runs}`, signal: opts.signal, resolve, reject, progress: (p) => opts.onProgress?.(p) })
      }),
  }
})

const { useGraphStore } = await import('./graphStore')
const { MC_DEFAULT_CONFIG, useMcStore } = await import('./mcStore')
const { importFile, planWorkspaceExport } = await import('./workspaceIO')
const { runMonteCarlo } = (await vi.importActual('../engine')) as { runMonteCarlo: (n: unknown, e: unknown, c: unknown) => unknown }
const riskyText = JSON.stringify((await import('../../examples/risky-factory.json')).default)

const G = () => useGraphStore.getState()
const M = () => useMcStore.getState()
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/** document A: a Source feeding a Pool (one Pool, so its result is told apart from B's) */
function openA() {
  G().newGraph()
  G().addNodeAt('source', { x: 0, y: 0 })
  G().addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = G().nodes
  G().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  G().setEdgeData(G().edges[0].id, { kind: 'resource', flow: '1-3' })
  G().updateNodeData(p.id, { initial: 100 })
}

/** a real result for the document open now, from the real engine (small) */
function realResult(runs: number) {
  const g = G()
  return runMonteCarlo(g.nodes, g.edges, { ...M().config, runs, steps: 5, modelVersion: g.modelVersion, kinds: g.kinds, time: g.time })
}

/** risky-factory (B) with a finished result, written as a Workspace file */
async function workspaceB(): Promise<{ text: string; digest: string }> {
  G().loadJSON(riskyText)
  M().setConfig({ runs: 3, steps: 5 })
  const run = M().run()
  await flush()
  pending.shift()!.resolve(realResult(3))
  await run
  expect(M().status).toBe('done')
  return { text: planWorkspaceExport({ x: 0, y: 0, zoom: 1 }).full.text, digest: M().resultGraphDigest! }
}

/** A's run in flight: its promise (boxed), its stand-in, and A's own numbers to answer with */
async function startA() {
  openA()
  M().setConfig({ runs: 400, steps: 5 })
  const aResult = realResult(4)
  const running = M().run()
  await flush()
  expect(M().status).toBe('running')
  const a = pending.shift()!
  return { running, a, aResult }
}

/** everything of the Monte Carlo state a late answer could change */
const shown = () => {
  const s = M()
  return {
    status: s.status,
    result: s.result,
    runGraph: s.runGraph,
    runRev: s.runRev,
    resultGraphDigest: s.resultGraphDigest,
    resultEngineRevision: s.resultEngineRevision,
    lastThroughput: s.lastThroughput,
    stale: s.stale,
    progress: s.progress,
    completedRuns: s.completedRuns,
    message: s.message,
    errorDetail: s.errorDetail,
    view: s.view,
  }
}

beforeEach(() => {
  pending.length = 0
  M().clear()
  M().setConfig(MC_DEFAULT_CONFIG)
})

describe('opening another document while a Monte Carlo run is in flight', () => {
  it('a Workspace file: the run is cancelled at once, and B\'s restored result is what shows', async () => {
    const wB = await workspaceB()
    const { running, a } = await startA()
    await importFile(wB.text)
    expect(a.signal.aborted).toBe(true)
    expect(M()).toMatchObject({ status: 'done', resultGraphDigest: wB.digest, stale: false })
    a.reject(abortError())
    await running
  })

  it('the cancelled run\'s late completion changes nothing of B', async () => {
    const wB = await workspaceB()
    const { running, a, aResult } = await startA()
    await importFile(wB.text)
    const before = shown()
    a.resolve(aResult)
    await running
    await flush()
    expect(shown()).toEqual(before)
    expect(M().resultGraphDigest).toBe(wB.digest)
  })

  it('the cancelled run\'s late cancellation changes nothing of B: no "cancelled" note, no status change', async () => {
    const wB = await workspaceB()
    const { running, a } = await startA()
    await importFile(wB.text)
    const before = shown()
    a.reject(abortError())
    await running
    await flush()
    expect(shown()).toEqual(before)
  })

  it('the cancelled run\'s late progress does not move B\'s', async () => {
    const wB = await workspaceB()
    const { running, a } = await startA()
    await importFile(wB.text)
    const before = shown()
    a.progress({ provisional: true, completedRuns: 200, totalRuns: 400, progress: 0.5 })
    expect(shown()).toEqual(before)
    a.reject(abortError())
    await running
  })

  for (const [what, open] of [
    ['a plain file (no Workspace)', () => G().loadJSON(riskyText)],
    ['New', () => G().newGraph()],
    ['a Template (loadGraph)', () => G().loadGraph({ nodes: JSON.parse(riskyText).nodes, edges: JSON.parse(riskyText).edges }, { canvasLocked: false, modelVersion: 1 })],
  ] as const) {
    it(`${what}: the run is cancelled, the status is not left running, and its late completion writes nothing`, async () => {
      const { running, a, aResult } = await startA()
      open()
      expect(a.signal.aborted).toBe(true)
      expect(M().status).not.toBe('running')
      const before = shown()
      a.resolve(aResult)
      await running
      await flush()
      expect(shown()).toEqual(before)
      expect(M().result).toBeNull()
    })
  }
})

describe('a run started on B while A\'s cancelled run has not answered yet', () => {
  async function startBOverA() {
    const wB = await workspaceB()
    const { running: runningA, a, aResult } = await startA()
    await importFile(wB.text)
    M().setConfig({ runs: 50, steps: 5 })
    const runningB = M().run()
    await flush()
    expect(M().status).toBe('running')
    const b = pending.shift()!
    return { wB, runningA, a, aResult, runningB, b }
  }

  it('A\'s late completion leaves B\'s run running, with B\'s progress', async () => {
    const { runningA, a, aResult, runningB, b } = await startBOverA()
    b.progress({ provisional: true, completedRuns: 10, totalRuns: 50, progress: 0.2 })
    a.resolve(aResult)
    await runningA
    await flush()
    expect(M()).toMatchObject({ status: 'running', progress: 0.2, completedRuns: 10 })
    b.reject(abortError())
    await runningB
  })

  it('A\'s late progress does not move B\'s run\'s progress', async () => {
    const { runningA, a, runningB, b } = await startBOverA()
    b.progress({ provisional: true, completedRuns: 10, totalRuns: 50, progress: 0.2 })
    a.progress({ provisional: true, completedRuns: 300, totalRuns: 400, progress: 0.75 })
    expect(M()).toMatchObject({ status: 'running', progress: 0.2, completedRuns: 10 })
    a.reject(abortError())
    b.reject(abortError())
    await Promise.all([runningA, runningB])
  })

  it('Cancel reaches B\'s run after A\'s late answer, and B\'s cancellation is reported on B', async () => {
    const { wB, runningA, a, aResult, runningB, b } = await startBOverA()
    a.resolve(aResult)
    await runningA
    await flush()
    M().cancel()
    expect(b.signal.aborted).toBe(true)
    b.reject(abortError())
    await runningB
    // B's earlier (restored) result stays, as any cancelled run leaves the last result
    expect(M()).toMatchObject({ status: 'done', message: 'cancelled', resultGraphDigest: wB.digest })
  })

  it('B\'s run completes with B\'s own result, current, whatever A answered in between', async () => {
    const { wB, runningA, a, aResult, runningB, b } = await startBOverA()
    a.resolve(aResult)
    await runningA
    const bResult = realResult(50)
    b.resolve(bResult)
    await runningB
    expect(M()).toMatchObject({ status: 'done', stale: false, resultGraphDigest: wB.digest, completedRuns: 50 })
    expect(M().result).toBe(bResult)
  })
})

describe('what is not another document (controls)', () => {
  it('an edit of the same document does not cancel the run; it lands stale (#407)', async () => {
    const { running, a, aResult } = await startA()
    const pool = G().nodes.find((n) => n.data.kind === 'pool')!
    G().updateNodeData(pool.id, { initial: 5 })
    expect(a.signal.aborted).toBe(false)
    a.resolve(aResult)
    await running
    expect(M()).toMatchObject({ status: 'done', stale: true })
    expect(M().result).toBe(aResult)
  })

  it('a revision Apply on the same document does not cancel the run; it lands stale', async () => {
    const { running, a, aResult } = await startA()
    const doc = { nodes: G().nodes.map((n) => (n.data.kind === 'pool' ? { ...n, data: { ...n.data, initial: 7 } } : n)), edges: G().edges }
    G().loadDoc(doc as never, { mode: 'revision-apply' })
    expect(a.signal.aborted).toBe(false)
    a.resolve(aResult)
    await running
    expect(M()).toMatchObject({ status: 'done', stale: true })
    expect(M().result).toBe(aResult)
  })

  it('Cancel on the document the run started on still cancels it', async () => {
    const { running, a } = await startA()
    M().cancel()
    expect(a.signal.aborted).toBe(true)
    a.reject(abortError())
    await running
    expect(M()).toMatchObject({ status: 'idle', message: 'cancelled' })
  })
})
