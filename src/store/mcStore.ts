import { create } from 'zustand'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  runMonteCarloParallel,
  type MonteCarloProgress,
  type MonteCarloResult,
  type RunConfig,
} from '../engine'
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

  view: McView
  dialogOpen: boolean

  setConfig: (patch: Partial<RunConfig>) => void
  openDialog: () => void
  closeDialog: () => void
  setView: (v: McView) => void
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
  view: 'live',
  dialogOpen: false,

  setConfig: (patch) => set({ config: { ...get().config, ...patch } }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  setView: (v) => set({ view: v }),

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
      set({
        status: 'done',
        result,
        runGraph: { nodes, edges },
        runRev: rev,
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
      lastThroughput: null,
      stale: false,
      progress: 0,
      completedRuns: 0,
      message: '',
      view: 'live',
    })
  },
}))

// mark a result stale when the graph's simulation semantics change (structure or
// sim-relevant data — never position / selection / a pure label rename)
let lastRev = useGraphStore.getState().simulationRev
useGraphStore.subscribe((g) => {
  if (g.simulationRev === lastRev) return
  lastRev = g.simulationRev
  const s = useMcStore.getState()
  if (s.result && !s.stale) useMcStore.setState({ stale: true })
})
