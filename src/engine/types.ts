export type SimValues = Record<string, number>

export type SimState = {
  step: number
  values: SimValues
  ended: boolean
}

/** One packet of resources that moved along one connection during a step. */
export type FlowEvent = {
  edgeId: string
  /** source node id */
  from: string
  /** target node id */
  to: string
  amount: number
}

export type StepResult = {
  state: SimState
  events: FlowEvent[]
  firedNodeIds: string[]
}
