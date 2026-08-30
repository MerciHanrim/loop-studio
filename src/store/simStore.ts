import { create } from 'zustand'
import { initSim, step } from '../engine'
import type { SimState, SimValues, StateEvent, StepResult, TriggerQueueEntry } from '../engine'
import { MAX_SERIES } from '../model/limits'
import { useGraphStore } from './graphStore'

export type SimStatus = 'idle' | 'running' | 'paused' | 'ended'

// docs/simulation-playback.md — Slice 1 (the state machine; minimal visuals).
//
// A step is COMPUTED by `prepareTransition` (pure — no store write, no visible
// change) and COMMITTED by `commitPrepared` in one atomic `set`. Between the two
// the store still holds S(t): `committedStep === revealedStep` at every instant
// (§PB2.2). `advance` is now the thin wrapper `prepareTransition → commitPrepared`
// that the legacy immediate callers (Step from idle, tests) use unchanged
// (§PB2.8 / PB-INV-18).

/** the fixed beat fractions on the τ ∈ [0,1] axis (§PB2.1). */
const BEAT_ARRIVE = 0.8
const BEAT_SETTLE = 0.95
/** τ maps to this wall-clock duration; a floor so "fastest" is still a frame. */
const PLAYBACK_MIN_MS = 120

export type PreparedTransition = {
  transitionId: number
  fromStep: number
  /** the store generation this was prepared against (§PB2.7a / §PB7.5) */
  expectedCommitEpoch: number
  /** the GraphDoc generation this was prepared against (§PB7.5) */
  expectedSimulationRev: number
  /** the engine's fully-computed next state — NOT committed */
  toState: SimState
  /** render-side fields the commit applies alongside the state */
  derived: {
    activeByEdge: Record<string, number>
    firedNodeIds: string[]
    stateEvents: StateEvent[]
    arrivedPoolIds: string[]
    triggerQueue: TriggerQueueEntry[]
  }
}

export type CommitResult = 'committed' | 'stale' | 'already-settled'

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

  // ── playback state machine (docs/simulation-playback.md) ──────────────
  /** monotonic, session-scoped; bumped on every committed-state replacement
   *  (settle / reset / restoreSnapshot). Never serialised (PB-INV-19). */
  commitEpoch: number
  /** a minimal public view of the in-flight transition (Slice 2 grows this) */
  transition: { fromStep: number; tau: number } | null
  /** id of the current preparedTransition, or null (§PB7.3) */
  activeTransitionId: number | null
  /** id of the most recent transition that `commitPrepared` committed (§PB7.7) */
  lastSettledTransitionId: number | null

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

  /** §PB2.7 — pure: compute the next step, commit nothing. */
  prepareTransition: () => PreparedTransition
  /** §PB7.7 — the fixed decision ladder; one atomic commit on success. */
  commitPrepared: (p: PreparedTransition) => CommitResult
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

// ── module-private scheduler state (not in the store; disposable) ─────────
let rafId: number | undefined
let nextTransitionId = 1
let prepared: PreparedTransition | null = null
let tauStartedAt = 0
let arriveFired = false

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()
const isHidden = (): boolean =>
  typeof document !== 'undefined' && document.hidden === true
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export const useSimStore = create<SimStore>((set, get) => {
  const graph = () => useGraphStore.getState()

  const beatDuration = (): number => Math.max(get().speedMs, PLAYBACK_MIN_MS)

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

  const deriveFrom = (r: StepResult): PreparedTransition['derived'] => {
    const g = graph()
    const activeByEdge: Record<string, number> = {}
    const arrived = new Set<string>()
    const kindOf = new Map(g.nodes.map((n) => [n.id, n.data.kind]))
    for (const ev of r.report.events) {
      activeByEdge[ev.edgeId] = (activeByEdge[ev.edgeId] ?? 0) + ev.amount
      if (kindOf.get(ev.to) === 'pool') arrived.add(ev.to)
    }
    return {
      activeByEdge,
      firedNodeIds: r.report.fired,
      stateEvents: r.report.stateEvents,
      arrivedPoolIds: [...arrived],
      triggerQueue: r.state.triggerQueue,
    }
  }

  const prepareTransition = (): PreparedTransition => {
    const g = graph()
    const h = head()
    const r = step(g.nodes, g.edges, h, get().seed)
    return {
      transitionId: nextTransitionId++,
      fromStep: h.step,
      expectedCommitEpoch: get().commitEpoch,
      expectedSimulationRev: g.simulationRev,
      toState: r.state,
      derived: deriveFrom(r),
    }
  }

  const commitPrepared = (p: PreparedTransition): CommitResult => {
    // §PB7.7 — the fixed order; stop at the first match.
    if (p.transitionId === get().lastSettledTransitionId) return 'already-settled'
    if (p.transitionId !== get().activeTransitionId) return 'stale'
    if (
      p.expectedCommitEpoch !== get().commitEpoch ||
      p.expectedSimulationRev !== graph().simulationRev ||
      p.fromStep !== get().stepIndex
    ) {
      return 'stale'
    }
    // one atomic transaction (§PB1.2 / PB-INV-2)
    set((s) => ({
      values: p.toState.values,
      stepIndex: p.toState.step,
      triggerQueue: p.toState.triggerQueue,
      activeByEdge: p.derived.activeByEdge,
      firedNodeIds: p.derived.firedNodeIds,
      stateEvents: p.derived.stateEvents,
      arrivedPoolIds: p.derived.arrivedPoolIds,
      series: [...s.series, { step: p.toState.step, values: p.toState.values }].slice(-MAX_SERIES),
      status: p.toState.ended ? 'ended' : s.status === 'idle' ? 'paused' : s.status,
      commitEpoch: s.commitEpoch + 1,
      lastSettledTransitionId: p.transitionId,
      activeTransitionId: null,
      transition: null,
    }))
    return 'committed'
  }

  /** legacy immediate path (§PB2.8) — Step-from-idle and tests. */
  const advance = (): CommitResult => {
    const p = prepareTransition()
    // mark it active just for this synchronous commit, then let the ladder run
    set({ activeTransitionId: p.transitionId })
    const r = commitPrepared(p)
    if (r !== 'committed') set({ activeTransitionId: null }) // no leak on a raced call
    return r
  }

  // ── the rAF scheduler ─────────────────────────────────────────────────
  const stopLoop = () => {
    if (rafId != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
    rafId = undefined
  }

  /** tear down any in-flight transition without committing it (§PB7.1). */
  const discardTransition = () => {
    stopLoop()
    prepared = null
    arriveFired = false
    set({ activeTransitionId: null, transition: null })
  }

  const beginTransition = () => {
    if (get().status === 'ended') {
      stopLoop()
      return
    }
    const p = prepareTransition()
    prepared = p
    arriveFired = false
    tauStartedAt = now()
    set({ activeTransitionId: p.transitionId, transition: { fromStep: p.fromStep, tau: 0 } })
  }

  /** drive the current transition straight to `settle` (Step / fast-forward). */
  const forceSettleCurrent = () => {
    if (get().activeTransitionId == null || !prepared) return
    set({ transition: { fromStep: prepared.fromStep, tau: 1 } })
    settleActive()
  }

  const settleActive = () => {
    const p = prepared
    prepared = null
    arriveFired = false
    if (p) commitPrepared(p) // ladder; clears activeTransitionId + transition on success
    // a stale / already-settled result leaves the store untouched; the loop
    // will re-prepare from the current committed state on the next frame.
    set({ activeTransitionId: null, transition: null })
    if (get().status === 'ended') stopLoop()
  }

  const loop = () => {
    rafId = undefined
    const s = get()

    if (s.activeTransitionId != null && prepared) {
      const wall = (now() - tauStartedAt) / beatDuration()
      const tau = clamp01(Math.max(s.transition?.tau ?? 0, wall)) // monotonic (§PB6.2)
      if (tau >= BEAT_ARRIVE && !arriveFired) arriveFired = true // Slice 1: no visual yet
      if (tau >= BEAT_SETTLE) {
        settleActive()
      } else {
        set({ transition: { fromStep: prepared.fromStep, tau } })
      }
    } else if (s.status === 'running' && !isHidden()) {
      // §PB8.3 — never prepare a new transition while hidden
      beginTransition()
    }

    // keep ticking while a run is live or a transition is settling
    if ((get().status === 'running' || get().activeTransitionId != null) && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(loop)
    } else {
      stopLoop()
    }
  }

  const startLoop = () => {
    // resuming with an in-flight transition: rebase the wall clock so τ continues
    if (get().activeTransitionId != null && prepared) {
      tauStartedAt = now() - (get().transition?.tau ?? 0) * beatDuration()
    }
    if (rafId == null && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(loop)
    }
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
    commitEpoch: 0,
    transition: null,
    activeTransitionId: null,
    lastSettledTransitionId: null,

    prepareTransition,
    commitPrepared,

    play: () => {
      head()
      set({ status: 'running' })
      startLoop()
    },

    pause: () => {
      stopLoop()
      set((s) => (s.status === 'running' ? { status: 'paused' } : {}))
    },

    stepOnce: () => {
      // §PB3.3 — a Step during an active transition only settles it (one commit);
      // it does not begin the next step.
      if (get().activeTransitionId != null) {
        forceSettleCurrent()
        return
      }
      if (get().status === 'running') return
      advance()
    },

    reset: () => {
      discardTransition()
      const init = initSim(graph().nodes)
      set((s) => ({
        status: 'idle',
        stepIndex: 0,
        values: init.values,
        activeByEdge: {},
        firedNodeIds: [],
        triggerQueue: [],
        stateEvents: [],
        arrivedPoolIds: [],
        series: [{ step: 0, values: init.values }],
        commitEpoch: s.commitEpoch + 1,
        lastSettledTransitionId: null,
      }))
    },

    restoreSnapshot: (snap) => {
      discardTransition()
      set((s) => ({
        status: snap.ended ? 'ended' : 'paused',
        stepIndex: snap.step,
        values: snap.values,
        firedNodeIds: snap.fired,
        triggerQueue: snap.triggerQueue,
        stateEvents: snap.stateEvents,
        // exactly the file's (validated) history — never fabricated. The chart
        // handles an empty list; the next Step / Reset rebuilds it.
        series: snap.series,
        activeByEdge: {},
        arrivedPoolIds: [],
        commitEpoch: s.commitEpoch + 1,
        lastSettledTransitionId: null,
        ...(snap.seed != null ? { seed: snap.seed } : {}),
      }))
    },

    setSpeed: (ms) => {
      // §PB6.2 — reject 0 / NaN / ∞ / negative; keep the current value.
      if (!Number.isFinite(ms) || ms <= 0) return
      set({ speedMs: ms })
      // re-rate the in-flight transition: keep τ, change only its rate.
      if (get().activeTransitionId != null) {
        tauStartedAt = now() - (get().transition?.tau ?? 0) * beatDuration()
      }
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
