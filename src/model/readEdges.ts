// SEMANTICS-M6.md §M6-7 — the read connection: the line from a run rule's tank to its
// stage. It is DERIVED, never stored. It is worked out from `data.run.tank` for the
// router and the canvas only, so it reaches no document, digest, undo entry, engine
// input, connection list or export. It has no flow and cannot be chosen or edited.
//
// It has its own port, so it shares no stub with another line. A stage's faces are
// usually all taken: on the desalination document none of the 14 Converters has a free
// one. So a read connection takes a free face at its centre when there is one, and
// otherwise a spot beside a face's centre, where nothing else runs.
import { faceOf, nameFaceFor } from './ports'
import { ruleOf } from './runRule'
import type { LoopEdge, LoopNode, PortFace } from './types'

const READ_EDGE_PREFIX = 'read:'
/** how far beside a face's centre a read connection's own port sits, px: more than
 *  the router's 10 px parallel gap, and inside a Converter's flat side of ±16 */
export const READ_PORT_OFFSET = 12

/** A read connection is known by `data.readPort`, which only `readEdges` sets: a file
 *  may give a stored line any id or type, but reading a file rebuilds `data` from the
 *  keys it knows, so this one never comes from a file. */
export const isReadEdge = (e: { data?: unknown }): boolean => (e.data as { readPort?: unknown } | undefined)?.readPort !== undefined

function occupied(id: string, edges: readonly LoopEdge[]): { used: Set<PortFace>; name: PortFace } {
  const used = new Set<PortFace>()
  for (const e of edges) {
    if (e.source === id) used.add(faceOf(e, 'source'))
    if (e.target === id) used.add(faceOf(e, 'target'))
  }
  return { used, name: nameFaceFor(used) }
}

const OPPOSITE: Record<PortFace, PortFace> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/** the sides of `from` that face `to`, nearest first */
function towards(from: LoopNode, to: LoopNode): PortFace[] {
  const dx = to.position.x - from.position.x
  const dy = to.position.y - from.position.y
  const h: PortFace = dx >= 0 ? 'right' : 'left'
  const v: PortFace = dy >= 0 ? 'bottom' : 'top'
  return Math.abs(dx) >= Math.abs(dy) ? [h, v, OPPOSITE[v], OPPOSITE[h]] : [v, h, OPPOSITE[h], OPPOSITE[v]]
}

type Spot = { face: PortFace; d: number }

/** every spot an end may take, best first: a free face's centre, then each usable
 *  face beside its centre, on the side the other node lies and then the other side.
 *  Never the face the node's name sits on, and on a Converter never its left or right
 *  face beside the centre: those are points, with no flat side to meet. */
function spotsOn(n: LoopNode, other: LoopNode, edges: readonly LoopEdge[]): Spot[] {
  const order = towards(n, other)
  const { used, name } = occupied(n.id, edges)
  const free: Spot[] = order.filter((f) => !used.has(f) && f !== name).map((face) => ({ face, d: 0 }))
  const beside = order.filter((f) => f !== name && (n.data.kind !== 'converter' || f === 'top' || f === 'bottom'))
  const sideSpots = beside.flatMap((face) => {
    const along = face === 'top' || face === 'bottom' ? other.position.x - n.position.x : other.position.y - n.position.y
    const near = along >= 0 ? READ_PORT_OFFSET : -READ_PORT_OFFSET
    return [
      { face, d: near },
      { face, d: -near },
    ]
  })
  return [...free, ...sideSpots]
}

export type ReadEdgeResult = {
  edges: LoopEdge[]
  /** a read connection with no spot left at an end, which is not drawn: sharing a
   *  stub would hide what the line says */
  blocked: { stage: string; tank: string }[]
}

/** the read connections of a graph, one per stage whose rule reads a Pool */
export function readEdges(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): ReadEdgeResult {
  const out: LoopEdge[] = []
  const blocked: ReadEdgeResult['blocked'] = []
  // a spot holds one line: a tank that two stages read gives each its own
  const taken = new Set<string>()
  const key = (id: string, s: Spot) => `${id}|${s.face}|${s.d}`
  // a stored line may already hold the id: routes and React Flow key on it
  const ids = new Set(edges.map((e) => e.id))
  const freeId = (stageId: string): string => {
    let id = `${READ_EDGE_PREFIX}${stageId}`
    while (ids.has(id)) id += '~'
    ids.add(id)
    return id
  }
  for (const stage of nodes) {
    if (stage.data?.kind !== 'converter') continue
    const tankId = ruleOf(stage)?.tank
    if (tankId === undefined) continue
    const tank = nodes.find((n) => n.id === tankId)
    if (!tank || tank.data.kind !== 'pool') continue
    const a = spotsOn(tank, stage, edges).find((s) => !taken.has(key(tank.id, s)))
    const b = spotsOn(stage, tank, edges).find((s) => !taken.has(key(stage.id, s)))
    if (!a || !b) {
      blocked.push({ stage: stage.id, tank: tank.id })
      continue
    }
    taken.add(key(tank.id, a))
    taken.add(key(stage.id, b))
    out.push({
      id: freeId(stage.id),
      type: 'read',
      source: tank.id,
      target: stage.id,
      sourceHandle: 'state-source',
      targetHandle: 'state-target',
      // `readPort`: how far along each end's face its port sits, 0 at the centre
      data: { kind: 'state', mode: 'activator', expr: '', route: 'orthogonal', ports: { source: a.face, target: b.face }, readPort: { source: a.d, target: b.d } },
    } as unknown as LoopEdge)
  }
  return { edges: out, blocked }
}

let memo: { nodes: readonly LoopNode[]; edges: readonly LoopEdge[]; all: LoopEdge[]; reads: LoopEdge[]; blocked: ReadEdgeResult['blocked'] } | null = null

function derive(nodes: LoopNode[], edges: LoopEdge[]): NonNullable<typeof memo> {
  if (memo && memo.nodes === nodes && memo.edges === edges) return memo
  const { edges: reads, blocked } = readEdges(nodes, edges)
  memo = { nodes, edges, reads, blocked, all: reads.length > 0 ? [...edges, ...reads] : edges }
  return memo
}

/** the read connections of this graph, one array per graph */
export const graphReadEdges = (nodes: LoopNode[], edges: LoopEdge[]): LoopEdge[] => derive(nodes, edges).reads

/** the read connections with no spot left, which the stage tag says */
export const graphReadBlocked = (nodes: LoopNode[], edges: LoopEdge[]): ReadEdgeResult['blocked'] => derive(nodes, edges).blocked

/** what the router sees: the document's connections, then the read connections. The
 *  same array when there is none. */
export const withReadEdges = (nodes: LoopNode[], edges: LoopEdge[]): LoopEdge[] => derive(nodes, edges).all
