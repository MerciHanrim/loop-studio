import type {
  ConverterData,
  DrainData,
  EndData,
  GateData,
  LoopNode,
  NodeKind,
  ParameterData,
  PoolData,
  RegisterData,
  SourceData,
} from './types'

let seq = 0

/** Short, collision-resistant id with a readable prefix. */
export function nextId(prefix = 'n'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`
}

type DataByKind = {
  pool: PoolData
  source: SourceData
  drain: DrainData
  gate: GateData
  converter: ConverterData
  end: EndData
  parameter: ParameterData
  register: RegisterData
}

/** Starting data for a freshly dropped node of each kind. */
export function defaultData<K extends NodeKind>(kind: K): DataByKind[K] {
  const map: { [P in NodeKind]: DataByKind[P] } = {
    pool: {
      kind: 'pool',
      label: 'Pool',
      activation: 'passive',
      initial: 0,
      capacity: null,
      mode: 'pullAny',
    },
    source: { kind: 'source', label: 'Source', activation: 'automatic', mode: 'pushAny' },
    drain: { kind: 'drain', label: 'Drain', activation: 'automatic', mode: 'pullAny' },
    gate: { kind: 'gate', label: 'Gate', activation: 'automatic', distribution: 'deterministic' },
    converter: { kind: 'converter', label: 'Converter', activation: 'automatic', mode: 'pullAny' },
    end: { kind: 'end', label: 'End', activation: 'automatic' },
    // loop-model/1 — `value` default 0 (§M1.1); `expr` default "0" (§M2).
    parameter: { kind: 'parameter', label: 'Parameter', value: 0 },
    register: { kind: 'register', label: 'Register', expr: '0' },
  }
  return map[kind]
}

export function createNode(kind: NodeKind, position: { x: number; y: number }): LoopNode {
  return { id: nextId(kind), type: kind, position, data: defaultData(kind) }
}
