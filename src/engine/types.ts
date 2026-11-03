import type { BoundaryOutflow } from './boundaryOutflow'

export type SimValues = Record<string, number>

/** A pending delayed state-trigger delivery (SEMANTICS-S.md §S8). */
export type TriggerQueueEntry = {
  edgeId: string
  target: string
  /** absolute step index the pulse is delivered on */
  deliveryStep: number
}

export type SimState = {
  step: number
  values: SimValues
  ended: boolean
  /** node ids that fired on the step producing this state (`[]` at step 0).
   *  Carried so `state` alone determines the next `step` (I6′). */
  fired: string[]
  /** delayed trigger deliveries, canonical order `(deliveryStep, edgeId)`. */
  triggerQueue: TriggerQueueEntry[]
}

/** One transfer of resources along one connection during a step. */
export type FlowEvent = {
  edgeId: string
  from: string
  to: string
  amount: number
}

/** One state connection that had an effect this step. `trigger` / `activator`:
 *  SEMANTICS-S.md §S9 (loop-state/1). `label`: SEMANTICS-S2.md §S2-9
 *  (loop-state/2). Emitted in ascending `edgeId`. Drives the state-edge UI pulse. */
export type StateEvent = {
  edgeId: string
  from: string
  to: string
  mode: 'trigger' | 'activator' | 'label'
  effect:
    | { kind: 'trigger'; delivered: true; applied: boolean }
    | { kind: 'activator'; satisfied: boolean }
    // loop-state/2: `delta` is this edge's raw requested change (for `=N` / `=S`,
    // `N − running`). `clampAdjustment` is the target's SINGLE end-of-Phase-0
    // clamp correction, carried on the last label event into that target (0
    // elsewhere, 0 when the final value needed no clamp). Net external change on
    // the target = Σ(delta over its label edges) + clampAdjustment = final − start.
    // This exact shape — no `applied` field — is what a `timing: "phase0"` (or
    // untyped) label edge always reports (loop-state/3 CSU9-D5: byte-identical
    // report for every legacy graph).
    | { kind: 'label'; delta: number; clampAdjustment: number }
    // loop-state/3 (SEMANTICS-S3.md, CSU) — a `timing: "afterPull"` label only.
    // `applied` distinguishes "the `when` gate held, `delta` / `clampAdjustment`
    // are real" from "inert this step" (`applied: false` ⇒ always `delta: 0,
    // clampAdjustment: 0` — an inert edge never carries a clamp correction). A
    // consumer that does not know this variant should read a MISSING `applied`
    // as `true` (`'applied' in effect ? effect.applied : true`).
    | { kind: 'label'; applied: boolean; delta: number; clampAdjustment: number }
}

export type StepReport = {
  /** transfers with amount > epsilon, in deterministic emission order */
  events: FlowEvent[]
  /** nodes evaluated as execution targets this step */
  activated: string[]
  /** nodes that actually moved / produced / consumed > epsilon this step */
  fired: string[]
  /** state connections that took effect this step, ascending edgeId */
  stateEvents: StateEvent[]
  /** human-readable notices (random flow held inactive, router cycles, …) */
  diagnostics: string[]
  /** structured notices the UI words in the user's language (issue #471,
   *  Deploy 2 — the Lumi review of #473: a notice the user sees is not an
   *  English sentence from the engine). Same lifecycle as `diagnostics`. */
  notices: StepNotice[]
  /** issue #477 — one entry per Gate that was fired this step, ascending
   *  `nodeId`: what it did with the step's supply, as data (the state LED and
   *  the Inspector's line read it; the UI never derives the state from the
   *  amounts). A Gate with no entry is `off` (not fired this step, or no run).
   *  Same lifecycle as `notices`. */
  gates: GateStatus[]
  /** loop-model/3 (SEMANTICS-M3.md §M3-5, L1) — this step's deliveries into
   *  Drains and Ends, grouped per kind and per exit node. Present only when
   *  `step` was given a kinds table; a `loop-model/2` report is unchanged. */
  boundaryOutflow?: BoundaryOutflow[]
}

/** issue #477 — a Gate's execution evidence for one step (the design: the QA
 *  record `gate-state-design.md` rev 2, Lumi 2026-11-02). `demand` and
 *  `available` are PLAN-FREE: computed from rates upstream-first, so a Gate
 *  the group plan cut never reads as `full` — an own-Pool input wants its
 *  rate (`all` wants the Pool) and holds `min(want, the Pool's value)`; a
 *  router input wants what the upstream router would send if it ran at its
 *  own demand (a Gate: its share of it; a Converter: its output rate at
 *  `f = min(1, demand / Σ input rates)`) and holds the same of the upstream's
 *  `available`. For an unplanned Gate they are the `demand` / `inputAvail`
 *  of its own turn. */
export type GateStatus = {
  nodeId: string
  /** `idle`: nothing to pass (`available ≤ ε`; a normal zero, never a
   *  warning). `full`: `moved = demand`. `partial`: `0 < moved < demand`.
   *  `held`: `available > 0` and `moved = 0`. `fault`: a reason names the
   *  Gate itself (inert branch weights, a zero-storage cycle; a refusal before
   *  the run is the store's `refusals`, not an entry). */
  state: 'idle' | 'full' | 'partial' | 'held' | 'fault'
  /** why a `partial`, `held` or `fault`; absent for `idle` and `full`.
   *  `supply`: its own Pools held less than it asked for. `upstream`: a
   *  router that feeds it could deliver no more — it took all it was offered
   *  (a `pull all` Gate too: the rule binds its own Pools only, D-demand).
   *  `room`: its outlet had no room left for it (a full target, no live
   *  branch, or an earlier supply of its group took the room). `pullAll`: its
   *  all-or-nothing demand on its own Pools was not met. `plan`: the group it
   *  runs with moved nothing (a `pull all` Converter short of `f = 1`, or a
   *  shared piece that cannot be met). */
  why?: 'supply' | 'upstream' | 'room' | 'pullAll' | 'plan' | 'inert' | 'cycle'
  /** what it would have moved with nothing binding it (rounded to 6 decimals) */
  demand: number
  /** what its inputs held against that demand this step (6 decimals) */
  available: number
  /** what it moved: Σ its output events this step (6 decimals) */
  moved: number
  /** an amount handed to it this step that it did not pass on (the
   *  `multiSupplyHeld` notice's number), when > 0 */
  held?: number
}

/** A notice `step` reports as data; the catalogs carry its sentence
 *  (`playbar.diag.<kind>`). */
export type StepNotice = {
  /** `multiSupplyLoss`: a Converter in a multi-supply group received more
   *  than it could use at the fraction it ran, and that amount was lost (D1).
   *  `multiSupplyHeld`: a router was handed an amount this step that it did
   *  not pass on (its inbox is per step), and that amount was lost — the
   *  same shape's second loss. Since #476 every group with a multi-supply
   *  Gate is planned and never reaches either; both remain as safety nets
   *  (a group of Gates only that splits and rejoins keeps the per-Gate rule
   *  and can still hold an amount at a full target). The run bars word both
   *  as the measured fact (which node, how much) and name no cause. */
  kind: 'multiSupplyLoss' | 'multiSupplyHeld'
  nodeId: string
  /** the node's label at the time of the step */
  label: string
  /** the amount lost, rounded to 6 decimals */
  amount: number
}

export type StepResult = {
  state: SimState
  report: StepReport
}

export const EPSILON = 1e-9
