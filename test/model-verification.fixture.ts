import type { LoopEdge, LoopNode } from '../src/model/types'

// The hands-on model-language demo — one connected, fully deterministic economy
// (no dice / gates) that exercises every loop-expr/1 + loop-model/1 feature:
//
//   • a `parameter` tuning knob (`p_rate`)
//   • a `register` reading a Pool + a Parameter        — `r_reserve = @gold * @p_rate`
//   • a `register` reading a `register` (the DAG)      — `r_head = @r_reserve + 10`
//   • a `register` that DIV-BY-ZEROes mid-run          — `r_ratio = @gold / @mana`
//   • depends-on-invalid cascade                       — `r_gap = @r_ratio - 1`
//   • a self-cycle (always M_REG_CYCLE, never halts)   — `r_loop = @r_loop + 1`
//   • an advisory `resourceType` on a Pool + an edge, with one deliberate MISMATCH
//
// `mana` starts at 2 and only drains ⇒ 2, 1, 0, 0, … so `r_ratio` is valid at
// t0/t1 and invalid from t2 (one contiguous run, then a gap) — the exact case
// `registerSeriesRuns` splits.

const node = (
  id: string,
  type: LoopNode['type'],
  x: number,
  y: number,
  data: Record<string, unknown>,
): LoopNode => ({ id, type, position: { x, y }, data: { ...data } } as LoopNode)

const res = (id: string, source: string, target: string, flow: string, resourceType?: string): LoopEdge =>
  ({
    id,
    source,
    target,
    type: 'loop',
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { kind: 'resource', flow, ...(resourceType ? { resourceType } : {}) },
  } as LoopEdge)

export function buildModelVerification(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes: LoopNode[] = [
    node('src', 'source', 0, 0, { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' }),
    node('gold', 'pool', 260, 0, {
      kind: 'pool',
      label: 'Gold',
      activation: 'passive',
      initial: 10,
      capacity: 100,
      mode: 'pullAny',
      resourceType: 'Gold',
    }),
    node('mana', 'pool', 260, 160, {
      kind: 'pool',
      label: 'Mana',
      activation: 'passive',
      initial: 2,
      capacity: 50,
      mode: 'pullAny',
      resourceType: 'Mana',
    }),
    node('sink', 'drain', 540, 0, { kind: 'drain', label: 'Upkeep', activation: 'automatic', mode: 'pullAny' }),
    node('p_rate', 'parameter', 0, 260, { kind: 'parameter', label: 'Reserve rate', value: 2, min: 0, max: 10, step: 0.5, unit: 'x' }),
    node('r_reserve', 'register', 260, 260, { kind: 'register', label: 'Reserve', expr: '@gold * @p_rate', unit: 'g', format: 'int' }),
    node('r_head', 'register', 260, 360, { kind: 'register', label: 'Headroom', expr: '@r_reserve + 10' }),
    node('r_ratio', 'register', 540, 260, { kind: 'register', label: 'Gold : Mana', expr: '@gold / @mana', format: 'float' }),
    node('r_gap', 'register', 540, 360, { kind: 'register', label: 'Ratio − 1', expr: '@r_ratio - 1' }),
    node('r_loop', 'register', 540, 460, { kind: 'register', label: 'Self loop', expr: '@r_loop + 1' }),
  ]

  const edges: LoopEdge[] = [
    res('e_src_gold', 'src', 'gold', '3', 'Gold'),
    // deliberate advisory MISMATCH: Gold pool, edge tagged Mana (run-neutral)
    res('e_gold_sink', 'gold', 'sink', '2', 'Mana'),
    res('e_mana_sink', 'mana', 'sink', '1', 'Mana'),
  ]

  return { nodes, edges }
}

/** a v1 baseline of the same graph — the model nodes + every advisory field
 *  stripped — for the loop-revision/2 conservative-extension + advisory-diff
 *  oracle. */
export function buildV1Baseline(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const { nodes, edges } = buildModelVerification()
  return {
    nodes: nodes
      .filter((n) => n.data.kind !== 'parameter' && n.data.kind !== 'register')
      .map((n) =>
        n.data.kind === 'pool'
          ? ({ ...n, data: Object.fromEntries(Object.entries(n.data).filter(([k]) => k !== 'resourceType')) } as LoopNode)
          : n,
      ),
    edges: edges.map((e) => ({ ...e, data: { kind: 'resource', flow: (e.data as { flow: string }).flow } } as LoopEdge)),
  }
}

/** the model graph with ONLY advisory fields nudged — `resourceType` on the
 *  Gold pool + its inbound edge, and a Register `unit`. No engine field, no
 *  structure change: `computeRevisionDiff` must report engineAffecting: false,
 *  advisoryAffecting: true (loop-revision/2 §R2-3). */
export function buildModelAdvisoryVariant(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const { nodes, edges } = buildModelVerification()
  return {
    nodes: nodes.map((n) => {
      if (n.id === 'gold') return { ...n, data: { ...n.data, resourceType: 'Bullion' } } as LoopNode
      if (n.id === 'r_reserve') return { ...n, data: { ...n.data, unit: 'gp' } } as LoopNode
      return n
    }),
    edges: edges.map((e) =>
      e.id === 'e_src_gold' ? ({ ...e, data: { ...e.data, resourceType: 'Bullion' } } as LoopEdge) : e,
    ),
  }
}

export const MODEL_VERIFICATION_ABOUT =
  'Model-language verification fixture (loop-expr/1 + loop-model/1 + loop-revision/2). Import model-verification.json, then follow examples/README.md.'
