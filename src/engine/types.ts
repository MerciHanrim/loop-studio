export type SimValues = Record<string, number>

export type SimState = {
  step: number
  values: SimValues
  ended: boolean
}

/** One transfer of resources along one connection during a step. */
export type FlowEvent = {
  edgeId: string
  from: string
  to: string
  amount: number
}

export type StepReport = {
  /** transfers with amount > epsilon, in deterministic emission order */
  events: FlowEvent[]
  /** nodes evaluated as execution targets this step */
  activated: string[]
  /** nodes that actually moved / produced / consumed > epsilon this step */
  fired: string[]
  /** human-readable notices (random flow held inactive, router cycles, …) */
  diagnostics: string[]
}

export type StepResult = {
  state: SimState
  report: StepReport
}

export const EPSILON = 1e-9
