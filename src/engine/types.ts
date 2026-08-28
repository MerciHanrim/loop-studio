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

/** One state connection that had an effect this step (SEMANTICS-S.md §S9).
 *  Emitted in ascending `edgeId`. Drives the state-edge UI pulse. */
export type StateEvent = {
  edgeId: string
  from: string
  to: string
  mode: 'trigger' | 'activator' | 'label'
  effect:
    | { kind: 'trigger'; delivered: true; applied: boolean }
    | { kind: 'activator'; satisfied: boolean }
    // `delta` is this edge's raw requested change (for `=N` / `=S`, `N − running`).
    // `clampAdjustment` is the target's SINGLE end-of-Phase-0 clamp correction,
    // carried on the last label event into that target (0 elsewhere, 0 when the
    // final value needed no clamp). Net external change on the target =
    // Σ(delta over its label edges) + clampAdjustment = final − start.
    | { kind: 'label'; delta: number; clampAdjustment: number }
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
}

export type StepResult = {
  state: SimState
  report: StepReport
}

export const EPSILON = 1e-9
