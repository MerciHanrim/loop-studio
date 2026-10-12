// The scene of the new node's state matrix — shared by
// `node-structure-matrix.spec.ts` (DOM evidence) and
// `node-structure-matrix-visual.spec.ts` (pixels). One node of every kind; a
// second Pool that stays empty so the Gate, the Converter, the End and the Drain
// behind it are activated without acting (`evaluated`); a second Register that
// is invalid at rest (division by zero).

export const MATRIX_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'feed', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Feed', activation: 'automatic', mode: 'pushAny' } },
    { id: 'store', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Store', activation: 'passive', initial: 5, capacity: 20, mode: 'pullAny' } },
    { id: 'busy', type: 'drain', position: { x: 480, y: 0 }, data: { kind: 'drain', label: 'Busy', activation: 'automatic', mode: 'pullAny' } },
    { id: 'dry', type: 'pool', position: { x: 0, y: 180 }, data: { kind: 'pool', label: 'Dry', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'idle', type: 'gate', position: { x: 240, y: 180 }, data: { kind: 'gate', label: 'Idle', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'conv', type: 'converter', position: { x: 480, y: 180 }, data: { kind: 'converter', label: 'Grind', activation: 'automatic', mode: 'pullAny' } },
    { id: 'fin', type: 'end', position: { x: 720, y: 180 }, data: { kind: 'end', label: 'Done', activation: 'automatic', mode: 'pullAny' } },
    { id: 'p1', type: 'parameter', position: { x: 0, y: 360 }, data: { kind: 'parameter', label: 'Rate', value: 2.5, unit: 'x' } },
    { id: 'r1', type: 'register', position: { x: 240, y: 360 }, data: { kind: 'register', label: 'Level', expr: '@store / 20', format: 'percent' } },
    { id: 'r_bad', type: 'register', position: { x: 480, y: 360 }, data: { kind: 'register', label: 'Broken', expr: '1 / (@store - @store)', format: 'float' } },
  ],
  edges: [
    { id: 'e_feed', type: 'loop', source: 'feed', target: 'store', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_sb', type: 'loop', source: 'store', target: 'busy', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_dg', type: 'loop', source: 'dry', target: 'idle', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_gc', type: 'loop', source: 'idle', target: 'conv', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_cf', type: 'loop', source: 'conv', target: 'fin', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

export const MATRIX_IDS = ['feed', 'store', 'busy', 'dry', 'idle', 'conv', 'fin', 'p1', 'r1', 'r_bad'] as const
export type MatrixId = (typeof MATRIX_IDS)[number]
export const MATRIX_KIND_OF: Record<MatrixId, 'source' | 'pool' | 'gate' | 'converter' | 'drain' | 'end' | 'parameter' | 'register'> = {
  feed: 'source',
  store: 'pool',
  busy: 'drain',
  dry: 'pool',
  idle: 'gate',
  conv: 'converter',
  fin: 'end',
  p1: 'parameter',
  r1: 'register',
  r_bad: 'register',
}
