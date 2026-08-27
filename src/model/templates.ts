import { MarkerType } from '@xyflow/react'
import { defaultData } from './factory'
import type { LoopEdge, LoopNode, NodeData, NodeKind } from './types'

export type Template = {
  id: string
  name: string
  blurb: string
  graph: { nodes: LoopNode[]; edges: LoopEdge[] }
}

type XY = { x: number; y: number }

const node = (
  kind: NodeKind,
  id: string,
  label: string,
  position: XY,
  extra: Partial<NodeData> = {},
): LoopNode => ({
  id,
  type: kind,
  position,
  data: { ...defaultData(kind), label, ...extra } as NodeData,
})

const link = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow },
  markerEnd: { type: MarkerType.ArrowClosed },
})

// The two acceptance diagrams from SEMANTICS.md §14, ready to drop on the canvas.
// Source ─3→ Vault(cap10) ─all→ Gate ─w2→ Refine(2→1) ─1→ Product(cap3)
//                                     └─w1→ Spill
// Equilibrium adds: Product ─1→ Consume

const baseNodes = (): LoopNode[] => [
  node('source', 'tpl-src', 'Faucet', { x: 40, y: 190 }),
  node('pool', 'tpl-vault', 'Vault', { x: 250, y: 180 }, { initial: 0, capacity: 10 }),
  node('gate', 'tpl-gate', 'Split', { x: 470, y: 180 }),
  node('converter', 'tpl-conv', 'Refine', { x: 690, y: 110 }),
  node('pool', 'tpl-prod', 'Product', { x: 910, y: 110 }, { initial: 0, capacity: 3 }),
  node('drain', 'tpl-spill', 'Spill', { x: 690, y: 300 }),
]

const baseEdges = (): LoopEdge[] => [
  link('tpl-e1', 'tpl-src', 'tpl-vault', '3'),
  link('tpl-e2', 'tpl-vault', 'tpl-gate', 'all'),
  link('tpl-e3', 'tpl-gate', 'tpl-conv', '2'),
  link('tpl-e4', 'tpl-gate', 'tpl-spill', '1'),
  link('tpl-e5', 'tpl-conv', 'tpl-prod', '1'),
]

export const TEMPLATES: Template[] = [
  {
    id: 'equilibrium',
    name: 'Flowing equilibrium',
    blurb:
      'Source feeds a vault, a gate splits 2:1 into a refiner and a drain, and a second drain bleeds the product. Settles to a steady state (Vault 3, Product 1).',
    graph: {
      nodes: [...baseNodes(), node('drain', 'tpl-consume', 'Consume', { x: 1130, y: 110 })],
      edges: [...baseEdges(), link('tpl-e6', 'tpl-prod', 'tpl-consume', '1')],
    },
  },
  {
    id: 'deadlock',
    name: 'Bottleneck deadlock',
    blurb:
      'The same system with no outlet on the product pool. It fills to capacity, the gate stalls, the vault backs up, and the source is throttled to zero — a stable frozen state.',
    graph: { nodes: baseNodes(), edges: baseEdges() },
  },
]
