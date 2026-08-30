import type { Edge, Node } from '@xyflow/react'

/**
 * Loop Studio graph model.
 *
 * This mirrors the vocabulary of a Machinations-style diagram: nodes that hold,
 * produce, consume, route, or convert resources, wired together with resource
 * connections (they carry resources) and state connections (they read one
 * node's state and modify another). Execution semantics live in src/engine and
 * are documented in SEMANTICS.md — this file is only the shape of the data.
 */

/** The six flow kinds the engine executes. */
export type FlowNodeKind = 'pool' | 'source' | 'drain' | 'gate' | 'converter' | 'end'
/** loop-model/1 (SEMANTICS-M.md) — annotation kinds: no ports, no engine
 *  phase, referenced only from expressions. */
export type ModelNodeKind = 'parameter' | 'register'
export type NodeKind = FlowNodeKind | ModelNodeKind

/** When a node fires during a simulation step. */
export type Activation = 'passive' | 'automatic' | 'onStart' | 'interactive'

export type PushMode = 'pushAny' | 'pushAll'
export type PullMode = 'pullAny' | 'pullAll'
export type ResourceMode = PushMode | PullMode

export type GateDistribution = 'deterministic' | 'probabilistic'

export type PoolData = {
  kind: 'pool'
  label: string
  activation: Activation
  /** Resources present when the simulation starts. */
  initial: number
  /** Upper bound on stored resources; null means unbounded. */
  capacity: number | null
  mode: ResourceMode
}

export type SourceData = {
  kind: 'source'
  label: string
  activation: Activation
  mode: PushMode
}

export type DrainData = {
  kind: 'drain'
  label: string
  activation: Activation
  mode: PullMode
}

export type GateData = {
  kind: 'gate'
  label: string
  activation: Activation
  distribution: GateDistribution
  /** all-or-nothing intake; optional, defaults to 'pullAny' */
  mode?: PullMode
}

export type ConverterData = {
  kind: 'converter'
  label: string
  activation: Activation
  mode: PullMode
}

export type EndData = {
  kind: 'end'
  label: string
  activation: Activation
  /** all-or-nothing intake when pool-fed; optional, defaults to 'pullAny' */
  mode?: PullMode
}

export type RegisterFormat = 'int' | 'float' | 'percent'

/** loop-model/1 §M1 — a fixed, user-tuned numeric input. `value` is the only
 *  semantic field; `min` / `max` / `step` / `unit` are advisory hints. Never
 *  `invalid`. Has no ports; referenced only from expressions. */
export type ParameterData = {
  kind: 'parameter'
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
}

/** loop-model/1 §M2 — a derived readout: `expr` is a `loop-expr/1` string in
 *  §X8 canonical form (default `"0"`); the Register stores no value. `unit` /
 *  `format` are advisory display hints. Has no ports. */
export type RegisterData = {
  kind: 'register'
  label: string
  expr: string
  unit?: string
  format?: RegisterFormat
}

export type FlowNodeData = PoolData | SourceData | DrainData | GateData | ConverterData | EndData
export type ModelNodeData = ParameterData | RegisterData

export type NodeData = FlowNodeData | ModelNodeData

/** How a state connection acts on its target. */
export type StateMode = 'label' | 'node' | 'trigger' | 'activator'

export type ResourceEdgeData = {
  kind: 'resource'
  /** Flow expression: "1", "all", "2D6", "1-3", "25%", ... (parsed by the engine). */
  flow: string
}

export type StateEdgeData = {
  kind: 'state'
  mode: StateMode
  /** Modifier or condition expression, e.g. "+1" or ">=5". Unused for triggers. */
  expr: string
  /** `trigger` only: integer ≥ 0 steps before delivery (SEMANTICS-S.md §S6).
   *  `deliveryStep = firedStep + delay + 1`. Absent / invalid ⇒ 0. */
  delay?: number
}

export type LoopEdgeData = ResourceEdgeData | StateEdgeData

export type LoopNode = Node<NodeData, NodeKind>
export type LoopEdge = Edge<LoopEdgeData, 'loop'>
