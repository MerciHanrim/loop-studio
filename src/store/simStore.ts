import { create } from 'zustand'
import { initSim, step } from '../engine'
import type { SimState, SimValues, StateEvent, TriggerQueueEntry } from '../engine'
import { MAX_SERIES } from '../model/limits'
import { useGraphStore } from './graphStore'

export type SimStatus = 'idle' | 'running' | 'paused' | 'ended'

type SimStore = {
  status: SimStatus
  speedMs: number
  /** reserved for randomness (unused by the current deterministic slice) */
  seed: number
  stepIndex: number
  values: SimValues | null
  activeByEdge: Record<string, number>
  firedNodeIds: string[]
  /** pending delayed state triggers, carried between steps (SEMANTICS-S.md §S8) */
  triggerQueue: TriggerQueueEntry[]
  /** state-edge effects from the step that produced the current head — drives
   *  the trigger pulse / activator tint / label flash. `[]` at step 0 and after
   *  Reset. (SEMANTICS-S.md §S9, SEMANTICS-S2.md §S2-9) */
  stateEvents: StateEvent[]
  /** pools that received resources on the last step — drives the arrival cue */
  arrivedPoolIds: string[]

  series: { step: number; values: SimValues }[]

  /** which pools the timeline plots — 'all' or an explicit id list */
  trackedIds: 'all' | string[]

  play: () => void
  pause: () => void
  stepOnce: () => void
  reset: () => void
  /** replace the head with a verified snapshot (Workspace Import, SEMANTICS-W.md
   *  §W5 / D1). Always lands paused / ended — never running, never a timer. Does
   *  NOT touch the graph store, so it triggers no `simulationRev` bump. */
  restoreSnapshot: (snap: SimSnapshot) => void
  setSpeed: (ms: number) => void
  setSeed: (seed: number) => void
  toggleTracked: (id: string, allPoolIds: string[]) => void
}

export type SimSnapshot = {
  /** null ⇒ keep the current seed */
  seed: number | null
  step: number
  ended: boolean
  values: SimValues
  fired: string[]
  triggerQueue: TriggerQueueEntry[]
  stateEvents: StateEvent[]
  series: { step: number; values: SimValues }[]
}

let timer: ReturnType<typeof setInterval> | undefined

export const useSimStore = create<SimStore>((set, get) => {
  const graph = () => useGraphStore.getState()

  function stopTimer() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  /** Current sim head, seeding an initial state on first use. */
  const head = (): SimState => {
    const s = get()
    if (s.values)
      return {
        step: s.stepIndex,
        values: s.values,
        ended: s.status === 'ended',
        fired: s.firedNodeIds,
        triggerQueue: s.triggerQueue,
      }
    const init = initSim(graph().nodes)
    set({ values: init.values, stepIndex: 0, triggerQueue: [], series: [{ step: 0, values: init.values }] })
    return init
  }

  const advance = () => {
    const g = graph()
    const r = step(g.nodes, g.edges, head(), get().seed)

    const activeByEdge: Record<string, number> = {}
    const arrived = new Set<string>()
    const kindOf = new Map(g.nodes.map((n) => [n.id, n.data.kind]))
    for (const ev of r.report.events) {
      activeByEdge[ev.edgeId] = (activeByEdge[ev.edgeId] ?? 0) + ev.amount
      if (kindOf.get(ev.to) === 'pool') arrived.add(ev.to)
    }

    set((s) => ({
      values: r.state.values,
      stepIndex: r.state.step,
      activeByEdge,
      firedNodeIds: r.report.fired,
      triggerQueue: r.state.triggerQueue,
      stateEvents: r.report.stateEvents,
      arrivedPoolIds: [...arrived],
      series: [...s.series, { step: r.state.step, values: r.state.values }].slice(-MAX_SERIES),
      status: r.state.ended ? 'ended' : s.status === 'idle' ? 'paused' : s.status,
    }))
    if (r.state.ended) stopTimer()
  }

  const startTimer = () => {
    stopTimer()
    timer = setInterval(advance, get().speedMs)
  }

  return {
    status: 'idle',
    speedMs: 600,
    seed: 1,
    stepIndex: 0,
    values: null,
    activeByEdge: {},
    firedNodeIds: [],
    triggerQueue: [],
    stateEvents: [],
    arrivedPoolIds: [],
    series: [],
    trackedIds: 'all',

    play: () => {
      head()
      set({ status: 'running' })
      startTimer()
    },

    pause: () => {
      stopTimer()
      set((s) => (s.status === 'running' ? { status: 'paused' } : {}))
    },

    stepOnce: () => {
      if (get().status === 'running') return
      advance()
    },

    reset: () => {
      stopTimer()
      const init = initSim(graph().nodes)
      set({
        status: 'idle',
        stepIndex: 0,
        values: init.values,
        activeByEdge: {},
        firedNodeIds: [],
        triggerQueue: [],
        stateEvents: [],
        arrivedPoolIds: [],
        series: [{ step: 0, values: init.values }],
      })
    },

    restoreSnapshot: (snap) => {
      stopTimer()
      set({
        status: snap.ended ? 'ended' : 'paused',
        stepIndex: snap.step,
        values: snap.values,
        firedNodeIds: snap.fired,
        triggerQueue: snap.triggerQueue,
        stateEvents: snap.stateEvents,
        series: snap.series.length > 0 ? snap.series : [{ step: snap.step, values: snap.values }],
        activeByEdge: {},
        arrivedPoolIds: [],
        ...(snap.seed != null ? { seed: snap.seed } : {}),
      })
    },

    setSpeed: (ms) => {
      set({ speedMs: ms })
      if (get().status === 'running') startTimer()
    },

    // SEMANTICS-B1.md §B1.3: accept a finite integer, normalise into uint32.
    // NaN / Infinity / fractional are rejected (previous seed kept). Changing
    // the seed changes the whole random trajectory, so the run restarts.
    setSeed: (raw) => {
      if (!Number.isInteger(raw)) return
      const seed = raw >>> 0
      if (seed === get().seed) return
      set({ seed })
      get().reset()
    },

    toggleTracked: (id, allPoolIds) => {
      const cur = get().trackedIds
      const list = cur === 'all' ? allPoolIds.slice() : cur.slice()
      const i = list.indexOf(id)
      if (i >= 0) list.splice(i, 1)
      else list.push(id)
      // back to 'all' when every pool is selected again
      const isAll = allPoolIds.length > 0 && allPoolIds.every((p) => list.includes(p))
      set({ trackedIds: isAll ? 'all' : list })
    },
  }
})

// Any simulation-relevant graph change stops the timer and returns to step 0,
// so a run is never observed against a graph it did not come from.
let lastRev = useGraphStore.getState().simulationRev
useGraphStore.subscribe((g) => {
  if (g.simulationRev !== lastRev) {
    lastRev = g.simulationRev
    useSimStore.getState().reset()
  }
})
