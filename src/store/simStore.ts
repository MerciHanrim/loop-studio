import { create } from 'zustand'
import { initSim, step } from '../engine'
import type { FlowEvent, SimState, SimValues, StateEvent, StepResult, TriggerQueueEntry } from '../engine'
import { MAX_SERIES } from '../model/limits'
import { bootTimelineSeries, setAutosaveTimelineSeries, useGraphStore } from './graphStore'

// docs/large-graph-readability.md §LGR6-cues — the trailing Activity-overlay
// window length. Kept in sync with `ACTIVITY_WINDOW` in
// `components/frames/frameGeom.ts` (the render / scoring side); a Slice-4a
// tuning value, never a persisted contract (§LGR11).
const ACTIVITY_WINDOW = 8

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
const BEAT_DEPART_END = 0.15
const BEAT_ARRIVE = 0.8
const BEAT_SETTLE = 0.95
export type PlaybackPhase = 'depart' | 'travel' | 'arrive'
const phaseOf = (tau: number): PlaybackPhase =>
  tau < BEAT_DEPART_END ? 'depart' : tau < BEAT_ARRIVE ? 'travel' : 'arrive'
/** τ maps to this wall-clock duration; a floor so "fastest" is still a frame. */
const PLAYBACK_MIN_MS = 120

/** the pure output of `prepareTransition` — no identity, no side effect. */
export type PreparedResult = {
  fromStep: number
  /** the store generation this was prepared against (§PB2.7a / §PB7.5) */
  expectedCommitEpoch: number
  /** the GraphDoc generation this was prepared against (§PB7.5) */
  expectedSimulationRev: number
  /** the RNG seed this was prepared against (§PB7.5 — seed is a prepare input) */
  expectedSeed: number
  /** the engine's fully-computed next state — NOT committed */
  toState: SimState
  /** render-side fields the commit applies alongside the state */
  derived: {
    activeByEdge: Record<string, number>
    /** the raw per-step transfers, in deterministic emission order — the token
     *  layer sums per edge and shows the breakdown on hover (Slice 2, §PB4.5). */
    events: FlowEvent[]
    firedNodeIds: string[]
    /** `StepReport.activated` — nodes the engine evaluated as execution targets
     *  this step. `fired ⊆ activated`; the difference drives the Slice-3
     *  `evaluated` run cue (docs/large-graph-readability.md §LGR5.1). */
    activatedNodeIds: string[]
    stateEvents: StateEvent[]
    arrivedPoolIds: string[]
    triggerQueue: TriggerQueueEntry[]
  }
}

/** a `PreparedResult` given an identity by `armPrepared` — what `commitPrepared`
 *  and the scheduler pass around. */
export type PreparedTransition = PreparedResult & { transitionId: number }

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
  /** `StepReport.activated` from the step that produced the current head —
   *  nodes the engine evaluated this step. `[]` at step 0, after Reset, and
   *  after a Workspace snapshot restore (the snapshot carries `fired` only).
   *  A node in here but NOT in `firedNodeIds` shows the `evaluated` run cue
   *  (docs/large-graph-readability.md §LGR5.1). */
  activatedNodeIds: string[]
  /** pending delayed state triggers, carried between steps (SEMANTICS-S.md §S8) */
  triggerQueue: TriggerQueueEntry[]
  /** state-edge effects from the step that produced the current head — drives
   *  the trigger pulse / activator tint / label flash. `[]` at step 0 and after
   *  Reset. (SEMANTICS-S.md §S9, SEMANTICS-S2.md §S2-9) */
  stateEvents: StateEvent[]
  /** pools that received resources on the last step — drives the arrival cue */
  arrivedPoolIds: string[]

  /** docs/large-graph-readability.md §LGR6-cues — the opt-in Activity overlay's
   *  history: a ring buffer (OLDEST first, ≤ 8 entries) of the ids that were
   *  `effective` on each committed step — fired node ids + `events` edge ids +
   *  `stateEvents` edge ids. Accumulates on Step / Play; HELD on pause / end;
   *  emptied on sim Reset and on a graph reload. View-only, never serialized
   *  (§LGR3.4). (There is no "seek" today; a future jump-to-step must clear it.) */
  activitySteps: string[][]

  series: { step: number; values: SimValues }[]

  /** which series the timeline plots by default — 'all' or an explicit id list
   *  of Pool AND Register ids. Applied from `recommendedRunConfig.timelineSeries`
   *  on document / template load; a legend toggle updates it in place. The
   *  current value is also restored across a plain reload via the `localStorage`
   *  autosave record (seeded here by `bootTimelineSeries()`, written back by
   *  `setAutosaveTimelineSeries`). UI-only — never in the GraphDoc, the
   *  loop-revision/* digest, undo, or `simulationRev`, and distinct from the
   *  Monte-Carlo `tracked` list. */
  timelineSeries: 'all' | string[]

  // ── playback state machine (docs/simulation-playback.md) ──────────────
  /** monotonic, session-scoped; bumped on every committed-state replacement
   *  (settle / reset / restoreSnapshot). Never serialised (PB-INV-19). */
  commitEpoch: number
  /** a minimal public view of the in-flight transition (Slice 2 grows this) */
  /** a READ-ONLY view of the in-flight transition for the Slice 2 choreography
   *  layer — the state machine never reads it back. */
  transition:
    | {
        fromStep: number
        /** animation progress ∈ [0, 1] on the beat axis (§PB2.1) */
        tau: number
        /** which beat the τ is in — an observable DOM tell for tests (§PB2.1) */
        phase: PlaybackPhase
        /** summed resource amount per edge for THIS step (settle has not run) */
        flowByEdge: Record<string, number>
        /** raw transfers for the breakdown (§PB4.5) */
        events: FlowEvent[]
        /** state-edge effects for THIS step */
        stateEvents: StateEvent[]
      }
    | null
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
  /** flip one Pool or Register in the default visible set; collapses back to
   *  'all' when every series is on again. A legend action only — no GraphDoc /
   *  undo / digest effect. */
  toggleTimelineSeries: (id: string, allSeriesIds: string[]) => void
  /** set the default visible series from a file's
   *  `recommendedRunConfig.timelineSeries` (undefined / empty ⇒ 'all'). Sorted +
   *  de-duped; unknown ids are kept verbatim and simply not drawn. */
  setTimelineSeries: (ids: readonly string[] | undefined) => void

  /** §PB2.7 — PURE: compute the next step; commit nothing, mint no id, move no
   *  counter. Repeat calls return a fully-identical result. */
  prepareTransition: () => PreparedResult
  /** §PB2.7 — the one impure step: give a `PreparedResult` a fresh
   *  `transitionId`, mark it the active transition, and (in dev) freeze it so
   *  the animation layer cannot mutate `toState` / `derived`. */
  armPrepared: (r: PreparedResult) => PreparedTransition
  /** §PB7.7 — the fixed decision ladder; one atomic commit on success. */
  commitPrepared: (p: PreparedTransition) => CommitResult
  /** §PB2.8 — the tokenless immediate path: `armPrepared(prepareTransition()) →
   *  commitPrepared`, no animation. NOT used by the Step / Play UI (both go
   *  through the choreography). For Monte-Carlo / Predict / engine tests. */
  advance: () => CommitResult
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
const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches === true
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/** recursively `Object.freeze` a plain-data value (dev only) so a bug that
 *  mutates `prepared.toState` / `prepared.derived` throws instead of silently
 *  corrupting a committed state. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

export const useSimStore = create<SimStore>((set, get) => {
  const graph = () => useGraphStore.getState()

  // §PB6 — τ maps to this wall-clock span. Reduced motion does NOT get its own
  // (shorter) span here: instead `loop()` drives an RM transition straight to
  // `settle` with no τ ramp at all (§PB9 — no artificial wait), so this is only
  // ever the full-motion pacing.
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

  const deriveFrom = (r: StepResult): PreparedResult['derived'] => {
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
      events: [...r.report.events],
      firedNodeIds: [...r.report.fired],
      activatedNodeIds: [...r.report.activated],
      stateEvents: [...r.report.stateEvents],
      arrivedPoolIds: [...arrived],
      triggerQueue: [...r.state.triggerQueue],
    }
  }

  /** §PB2.7 — PURE. No `set`, no id, no counter; repeat calls are identical. */
  const prepareTransition = (): PreparedResult => {
    const g = graph()
    const h = head()
    const r = step(g.nodes, g.edges, h, get().seed, g.modelVersion)
    return {
      fromStep: h.step,
      expectedCommitEpoch: get().commitEpoch,
      expectedSimulationRev: g.simulationRev,
      expectedSeed: get().seed,
      toState: r.state,
      derived: deriveFrom(r),
    }
  }

  /** §PB2.7 — the one impure step: mint an id, mark active, freeze in dev so the
   *  animation layer cannot mutate `toState` / `derived`. */
  const armPrepared = (r: PreparedResult): PreparedTransition => {
    const armed: PreparedTransition = { ...r, transitionId: nextTransitionId++ }
    set({ activeTransitionId: armed.transitionId })
    if (import.meta.env.DEV) deepFreeze(armed)
    return armed
  }

  const commitPrepared = (p: PreparedTransition): CommitResult => {
    // §PB7.7 — the fixed order; stop at the first match.
    if (p.transitionId === get().lastSettledTransitionId) return 'already-settled'
    if (p.transitionId !== get().activeTransitionId) return 'stale'
    const g = graph()
    if (
      p.expectedCommitEpoch !== get().commitEpoch ||
      p.expectedSimulationRev !== g.simulationRev ||
      p.expectedSeed !== get().seed ||
      p.fromStep !== get().stepIndex
    ) {
      return 'stale'
    }
    // one atomic transaction (§PB1.2 / PB-INV-2). `p.toState` / `p.derived` are
    // frozen (dev); everything is copied by value / reference into fresh fields.
    set((s) => ({
      values: p.toState.values,
      stepIndex: p.toState.step,
      triggerQueue: [...p.toState.triggerQueue],
      activeByEdge: { ...p.derived.activeByEdge },
      firedNodeIds: [...p.derived.firedNodeIds],
      activatedNodeIds: [...p.derived.activatedNodeIds],
      stateEvents: [...p.derived.stateEvents],
      arrivedPoolIds: [...p.derived.arrivedPoolIds],
      // §LGR6-cues — this committed step's `effective` id set, appended to the
      // trailing Activity-overlay window (fired nodes + resource-edge ids from
      // `events` + state-edge ids from `stateEvents`).
      activitySteps: [
        ...s.activitySteps,
        [
          ...new Set<string>([
            ...p.derived.firedNodeIds,
            ...Object.keys(p.derived.activeByEdge),
            ...p.derived.stateEvents.map((e) => e.edgeId),
          ]),
        ].sort(),
      ].slice(-ACTIVITY_WINDOW),
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
    const p = armPrepared(prepareTransition())
    const r = commitPrepared(p)
    if (r !== 'committed') set({ activeTransitionId: null }) // no leak on a raced call
    return r
  }

  // ── the rAF scheduler ─────────────────────────────────────────────────
  const stopLoop = () => {
    if (rafId != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
    rafId = undefined
  }

  /** §PB7.1 — tear down the in-flight transition without committing it: kill the
   *  rAF, drop the prepared payload, clear the active id. Called by every
   *  committed-state replacement (reset / restoreSnapshot / the simulationRev
   *  subscription) BEFORE the state swap, so a graph edit cancels playback
   *  immediately — it does not wait for the next settle. */
  const discardTransition = () => {
    stopLoop()
    prepared = null
    arriveFired = false
    set({ activeTransitionId: null, transition: null })
  }

  /** prepare + arm + start the τ clock for ONE step's choreography. Used by both
   *  UI Step (one-shot) and Play (the loop re-calls it after each settle). It
   *  does not decide whether to continue — the loop does, gated on `status`. */
  const beginTransition = () => {
    if (get().status === 'ended' || isHidden() || get().activeTransitionId != null) return
    const p = armPrepared(prepareTransition())
    prepared = p
    arriveFired = false
    tauStartedAt = now()
    set({
      transition: {
        fromStep: p.fromStep,
        tau: 0,
        phase: phaseOf(0),
        flowByEdge: { ...p.derived.activeByEdge },
        events: p.derived.events,
        stateEvents: p.derived.stateEvents,
      },
    })
  }

  /** run the ladder for the in-flight transition, then FULLY tear down. A
   *  non-`committed` result (stale / already-settled) also drops the run out of
   *  auto-Play — the user re-presses Play (Round 2 §2). */
  const settleActive = () => {
    const p = prepared
    prepared = null
    arriveFired = false
    const res = p ? commitPrepared(p) : 'stale'
    if (res !== 'committed') {
      stopLoop()
      set((s) => ({
        activeTransitionId: null,
        transition: null,
        status: s.status === 'running' ? 'paused' : s.status,
      }))
    }
    // on 'committed', commitPrepared already cleared active/transition + set
    // status (ended / paused / running). The loop's next tick begins t+2.
  }

  /** drive the current transition straight to `settle` (Step / fast-forward). */
  const forceSettleCurrent = () => {
    if (get().activeTransitionId == null || !prepared) return
    set((s) => ({ transition: s.transition ? { ...s.transition, tau: 1, phase: 'arrive' as const } : null }))
    settleActive()
  }

  const loop = () => {
    rafId = undefined

    // §PB8.3 — while hidden: freeze in place. Do NOT advance τ, settle, or
    // prepare. Keep the rAF armed so the first visible tick catches the gap.
    if (isHidden()) {
      if ((get().status === 'running' || get().activeTransitionId != null) && typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(loop)
      }
      return
    }

    const s = get()
    if (s.activeTransitionId != null && prepared) {
      // §PB9 — reduced motion: no τ ramp. The remaining beats collapse and this
      // transition settles on THIS tick. `Math.max` still applies, so τ only
      // ever moves forward: toggling RM mid-`travel` finishes the *current*
      // transition once (same `prepared`, same id) — never a rewind or restart.
      const wall = reducedMotion() ? 1 : (now() - tauStartedAt) / beatDuration()
      const tau = clamp01(Math.max(s.transition?.tau ?? 0, wall)) // monotonic (§PB6.2)
      if (tau >= BEAT_ARRIVE && !arriveFired) arriveFired = true // Slice 1: no visual yet
      if (tau >= BEAT_SETTLE) {
        settleActive() // §PB8.2 — a giant gap settles ONCE here; t+2 begins next tick
      } else {
        set((s) => ({ transition: s.transition ? { ...s.transition, tau, phase: phaseOf(tau) } : null }))
      }
    } else if (s.status === 'running') {
      beginTransition()
    }

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
    // docs/simulation-playback.md §PB6 — the per-step beat for normal playback
    // ONLY (never the engine / RNG / Monte-Carlo result). Default is the
    // slowest slider stop (~2400 ms/step) so a fresh document / template plays
    // at a follow-by-eye pace; the user drags up for the old speeds.
    speedMs: 2400,
    seed: 1,
    stepIndex: 0,
    values: null,
    activeByEdge: {},
    firedNodeIds: [],
    activatedNodeIds: [],
    triggerQueue: [],
    stateEvents: [],
    arrivedPoolIds: [],
    activitySteps: [],
    series: [],
    // seeded from the autosave record (serialize.ts) so a plain reload keeps the
    // Timeline legend's visible set; 'all' when the record has none.
    timelineSeries: bootTimelineSeries(),
    commitEpoch: 0,
    transition: null,
    activeTransitionId: null,
    lastSettledTransitionId: null,

    prepareTransition,
    armPrepared,
    commitPrepared,
    advance,

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
      // §PB3.1 / PB3.3 — the UI Step uses the SAME choreographed one-step path
      // as Play (prepare → depart → travel → arrive → settle), it just does not
      // continue to the next transition. Only Play's loop continues.
      if (get().activeTransitionId != null && prepared) {
        forceSettleCurrent() // Step during a paused transition ⇒ finish it now
        return
      }
      if (get().activeTransitionId != null) set({ activeTransitionId: null })
      if (get().status === 'running') return // Step is disabled while Play runs
      beginTransition()
      if (typeof requestAnimationFrame === 'undefined' || reducedMotion()) {
        // no animation clock (SSR / vitest), or reduced motion ⇒ a Step's
        // one-step choreography settles instantly (§PB9 — no artificial wait).
        set((s) => ({ transition: s.transition ? { ...s.transition, tau: 1, phase: 'arrive' as const } : null }))
        settleActive()
      } else {
        startLoop()
      }
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
        activatedNodeIds: [],
        triggerQueue: [],
        stateEvents: [],
        arrivedPoolIds: [],
    activitySteps: [],
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
        // a Workspace snapshot carries `fired` only — no `activated`. The
        // `evaluated` cue simply re-derives on the next Step (§LGR5.1).
        activatedNodeIds: [],
        triggerQueue: snap.triggerQueue,
        stateEvents: snap.stateEvents,
        // exactly the file's (validated) history — never fabricated. The chart
        // handles an empty list; the next Step / Reset rebuilds it.
        series: snap.series,
        activeByEdge: {},
        arrivedPoolIds: [],
    activitySteps: [],
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

    toggleTimelineSeries: (id, allSeriesIds) => {
      const cur = get().timelineSeries
      const list = cur === 'all' ? allSeriesIds.slice() : cur.slice()
      const i = list.indexOf(id)
      if (i >= 0) list.splice(i, 1)
      else list.push(id)
      // back to 'all' when every series is selected again
      const isAll = allSeriesIds.length > 0 && allSeriesIds.every((s) => list.includes(s))
      const next: 'all' | string[] = isAll ? 'all' : [...list].sort()
      set({ timelineSeries: next })
      setAutosaveTimelineSeries(next) // ride the autosave record so a reload keeps it
    },

    setTimelineSeries: (ids) => {
      let next: 'all' | string[] = 'all'
      if (Array.isArray(ids) && ids.length > 0) {
        const uniq = [...new Set(ids.filter((s): s is string => typeof s === 'string'))].sort()
        if (uniq.length > 0) next = uniq
      }
      set({ timelineSeries: next })
      setAutosaveTimelineSeries(next)
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
