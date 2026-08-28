import { create } from 'zustand'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  runMonteCarloParallel,
  type MonteCarloProgress,
  type MonteCarloResult,
  type RunConfig,
} from '../engine'
import type { RecommendedRunConfig } from '../model/serialize'
import { semanticDigest } from '../model/workspace'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

// Monte-Carlo run state. Deliberately NOT persisted to localStorage — a
// distribution is an experiment result, not part of the document.

export type McStatus = 'idle' | 'running' | 'done' | 'error'
export type McView = 'live' | 'distribution'

export const MC_DEFAULT_CONFIG: RunConfig = {
  baseSeed: 1,
  runs: 200,
  steps: 30,
  tracked: [],
}

type McStore = {
  config: RunConfig
  status: McStatus
  /** 0..1 while running */
  progress: number
  completedRuns: number
  /** short transient status line ("Cancelled", an error message) */
  message: string

  result: MonteCarloResult | null
  /** the graph the current `result` was produced from */
  runGraph: { nodes: LoopNode[]; edges: LoopEdge[] } | null
  /** `simulationRev` at the moment `result` was produced */
  runRev: number
  /** wall-clock throughput of the last completed run, for a tighter next
   *  estimate — in-memory only, valid while `simulationRev` still matches */
  lastThroughput: { rev: number; msPerRunStep: number } | null
  /** the graph's simulation semantics changed since `result` — still viewable,
   *  export disabled, cleared on the next successful run or on Clear */
  stale: boolean
  /** semantic digest of the graph that PRODUCED `result` (SEMANTICS-W.md §W3.2).
   *  Made only on a completed run; carried verbatim through Workspace
   *  export/restore — never recomputed against a later graph. */
  resultGraphDigest: string | null

  view: McView
  /** which Pool the Distribution band chart shows (persisted in a Workspace) */
  distributionPoolId: string | null
  /** whether the band chart draws the mean line (persisted in a Workspace) */
  showMean: boolean
  dialogOpen: boolean

  setConfig: (patch: Partial<RunConfig>) => void
  /** apply a file's `recommendedRunConfig` — valid fields only, never throws */
  applyRecommended: (m: RecommendedRunConfig | undefined) => void
  openDialog: () => void
  closeDialog: () => void
  setView: (v: McView) => void
  setDistributionPoolId: (id: string | null) => void
  setShowMean: (v: boolean) => void
  /** attach a result restored from a Workspace file WITHOUT recomputing its
   *  digest (SEMANTICS-W.md §W3.2 / §W5.1). `null` clears any result. */
  restoreResult: (p: { result: MonteCarloResult; resultGraphDigest: string; stale: boolean } | null) => void
  run: () => Promise<void>
  cancel: () => void
  clear: () => void
}

let controller: AbortController | null = null
let messageTimer: ReturnType<typeof setTimeout> | undefined

export const useMcStore = create<McStore>((set, get) => ({
  config: MC_DEFAULT_CONFIG,
  status: 'idle',
  progress: 0,
  completedRuns: 0,
  message: '',
  result: null,
  runGraph: null,
  runRev: -1,
  lastThroughput: null,
  stale: false,
  resultGraphDigest: null,
  distributionPoolId: null,
  showMean: false,
  view: 'live',
  dialogOpen: false,

  setConfig: (patch) => set({ config: { ...get().config, ...patch } }),

  applyRecommended: (m) => {
    if (!m || typeof m !== 'object') return
    const patch: Partial<RunConfig> = {}
    // baseSeed: same rule as the seed input / SEMANTICS-B1.md §B1.3 — a finite
    // integer, then normalised to uint32 with `>>> 0` (so -1 → 4294967295,
    // 4294967296 → 0); NaN / Infinity / fractional are ignored.
    if (Number.isInteger(m.baseSeed)) patch.baseSeed = (m.baseSeed as number) >>> 0
    if (Number.isInteger(m.runs) && (m.runs as number) >= 1) patch.runs = m.runs as number
    if (Number.isInteger(m.steps) && (m.steps as number) >= 1) patch.steps = m.steps as number
    if (Array.isArray(m.tracked)) {
      if (m.tracked.length === 0) {
        patch.tracked = [] // "all pools"
      } else {
        // intersect with the loaded graph's Pools, graph order; unknown ids drop.
        // Mirrors reconcileTracked: an emptied explicit subset falls to the first
        // Pool rather than silently widening to "all".
        const wanted = new Set(m.tracked.filter((x): x is string => typeof x === 'string'))
        const poolIds = useGraphStore
          .getState()
          .nodes.filter((n) => n.data.kind === 'pool')
          .map((n) => n.id)
        const kept = poolIds.filter((id) => wanted.has(id))
        patch.tracked = kept.length > 0 ? kept : poolIds.length > 0 ? [poolIds[0]] : []
      }
    }
    if (Object.keys(patch).length > 0) set({ config: { ...get().config, ...patch } })
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  setView: (v) => set({ view: v }),
  setDistributionPoolId: (id) => set({ distributionPoolId: id }),
  setShowMean: (v) => set({ showMean: v }),

  restoreResult: (p) => {
    const rev = useGraphStore.getState().simulationRev
    if (!p) {
      set({
        status: 'idle',
        result: null,
        runGraph: null,
        runRev: rev,
        resultGraphDigest: null,
        stale: false,
        progress: 0,
        completedRuns: 0,
      })
      return
    }
    set({
      status: 'done',
      result: p.result,
      // the producing graph is not carried in the file; the digest is the binding
      runGraph: null,
      // current rev ⇒ the simulationRev subscription won't re-stale this (§W5.1)
      runRev: rev,
      resultGraphDigest: p.resultGraphDigest,
      stale: p.stale,
      progress: 1,
      completedRuns: p.result.completedRuns,
      message: '',
    })
  },

  run: async () => {
    if (get().status === 'running') return
    const g = useGraphStore.getState()
    const nodes = g.nodes.map((n) => ({ ...n }))
    const edges = g.edges.map((e) => ({ ...e }))
    const rev = g.simulationRev
    const config = get().config

    useSimStore.getState().pause() // the live run yields to the batch

    clearTimeout(messageTimer)
    controller = new AbortController()
    // keep any previous successful result visible until this run succeeds
    set({ status: 'running', progress: 0, completedRuns: 0, message: '' })

    const onProgress = (p: MonteCarloProgress) => {
      if (get().status !== 'running') return
      set({ progress: p.progress, completedRuns: p.completedRuns })
    }

    const t0 = performance.now()
    try {
      const result = await runMonteCarloParallel(nodes, edges, config, {
        signal: controller.signal,
        onProgress,
      })
      const wallMs = performance.now() - t0
      const denom = Math.max(1, result.completedRuns * config.steps)
      // §W3.2 — the digest is minted here, from the graph this run executed on
      const resultGraphDigest = await semanticDigest({ nodes, edges })
      set({
        status: 'done',
        result,
        runGraph: { nodes, edges },
        runRev: rev,
        resultGraphDigest,
        lastThroughput: { rev, msPerRunStep: wallMs / denom },
        stale: false,
        progress: 1,
        completedRuns: result.completedRuns,
        view: 'distribution',
        message: '',
      })
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        // previous successful result (if any) stays; brief "Cancelled" note
        set({ status: get().result ? 'done' : 'idle', progress: 0, message: 'Cancelled' })
        messageTimer = setTimeout(() => {
          if (get().message === 'Cancelled') set({ message: '' })
        }, 2500)
      } else {
        set({ status: 'error', message: err.message || 'Monte-Carlo run failed' })
      }
    } finally {
      controller = null
    }
  },

  cancel: () => {
    controller?.abort()
  },

  clear: () => {
    controller?.abort()
    set({
      status: 'idle',
      result: null,
      runGraph: null,
      runRev: -1,
      resultGraphDigest: null,
      lastThroughput: null,
      stale: false,
      progress: 0,
      completedRuns: 0,
      message: '',
      view: 'live',
      distributionPoolId: null,
      showMean: false,
    })
  },
}))

/**
 * Keep `config.tracked` sane as Pools come and go, without ever widening a
 * user's explicit subset into "all":
 *  - `[]` ("all") stays `[]`
 *  - an explicit list is intersected with the current Pool ids
 *  - if that intersection is empty but Pools remain, fall to the first Pool
 *  - if there are no Pools at all, leave the (now-dead) list; the dialog shows
 *    an empty list and disables Run
 */
function reconcileTracked(): void {
  const { config } = useMcStore.getState()
  if (config.tracked.length === 0) return
  const poolIds = useGraphStore
    .getState()
    .nodes.filter((n) => n.data.kind === 'pool')
    .map((n) => n.id)
  const kept = config.tracked.filter((id) => poolIds.includes(id))
  if (kept.length === config.tracked.length) return
  if (kept.length > 0) {
    useMcStore.setState({ config: { ...config, tracked: kept } })
  } else if (poolIds.length > 0) {
    useMcStore.setState({ config: { ...config, tracked: [poolIds[0]] } })
  }
}

// mark a result stale when the graph's simulation semantics change (structure or
// sim-relevant data — never position / selection / a pure label rename; and
// never a config edit — runs/steps/seed/tracked only apply to the next run).
let lastRev = useGraphStore.getState().simulationRev
useGraphStore.subscribe((g) => {
  if (g.simulationRev === lastRev) return
  lastRev = g.simulationRev
  reconcileTracked()
  const s = useMcStore.getState()
  if (s.result && !s.stale) useMcStore.setState({ stale: true })
})
