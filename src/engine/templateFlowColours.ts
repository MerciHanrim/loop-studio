import type { LoopEdge, LoopNode } from '../model/types'
import { FLOW_PALETTE, type FlowPaletteId } from '../ui/flowColour'

// docs/flow-colour-and-compact-nodes.md FC-6 — a bundled Template's restrained
// flow colours, written by its builder into the shipped JSON (the file is the
// only source). Each listed node takes its flow's palette colour, and so does
// every resource edge whose two ends sit in the same flow. Parameters and
// Registers never take one. Cosmetic only (FC-2.4): the engine never reads it,
// so a Template's simulation is unchanged.
//
// Fails closed: an id that is not in the graph, a Parameter or a Register, or a
// node listed under two colours throws, so a builder change cannot silently
// drop or misplace a colour.

export type TemplateFlows = Partial<Record<FlowPaletteId, readonly string[]>>

const HEX = new Map<string, string>(FLOW_PALETTE.map((p) => [p.id, p.hex]))

export function withTemplateFlowColours(
  nodes: LoopNode[],
  edges: LoopEdge[],
  flows: TemplateFlows,
): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const kindOf = new Map(nodes.map((n) => [n.id, n.data.kind]))
  const colourOf = new Map<string, string>()
  for (const [id, ids] of Object.entries(flows)) {
    const hex = HEX.get(id)!
    for (const nodeId of ids ?? []) {
      const kind = kindOf.get(nodeId)
      if (kind === undefined) throw new Error(`template flow colour: no node ${nodeId}`)
      if (kind === 'parameter' || kind === 'register') throw new Error(`template flow colour: ${nodeId} is a ${kind}`)
      if (colourOf.has(nodeId)) throw new Error(`template flow colour: ${nodeId} is listed twice`)
      colourOf.set(nodeId, hex)
    }
  }
  return {
    nodes: nodes.map((n) => (colourOf.has(n.id) ? ({ ...n, data: { ...n.data, accent: colourOf.get(n.id) } } as LoopNode) : n)),
    edges: edges.map((e) => {
      const a = colourOf.get(e.source)
      return e.data?.kind === 'resource' && a !== undefined && colourOf.get(e.target) === a
        ? ({ ...e, data: { ...e.data, accent: a } } as LoopEdge)
        : e
    }),
  }
}
