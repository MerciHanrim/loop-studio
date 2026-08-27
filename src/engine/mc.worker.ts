// Monte-Carlo Worker (SEMANTICS-B2.md §MC7.1). Initialised once with the graph;
// each job is a half-open run-index range. It returns only raw trajectories —
// all quantile / mean / summary aggregation happens once on the main thread.

import type { LoopEdge, LoopNode } from '../model/types'
import { runRange, type RunConfig } from './montecarlo'

type InitMsg = {
  type: 'init'
  nodes: LoopNode[]
  edges: LoopEdge[]
  config: RunConfig
  poolIds: string[]
}
type JobMsg = { type: 'job'; startRun: number; endRun: number }

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<InitMsg | JobMsg>) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}

let g: { nodes: LoopNode[]; edges: LoopEdge[]; config: RunConfig; poolIds: string[] } | null = null

ctx.onmessage = (ev) => {
  const msg = ev.data
  try {
    if (msg.type === 'init') {
      g = { nodes: msg.nodes, edges: msg.edges, config: msg.config, poolIds: msg.poolIds }
      ctx.postMessage({ type: 'ready' })
      return
    }
    if (!g) throw new Error('worker received a job before init')
    const { values, endedAt } = runRange(
      g.nodes,
      g.edges,
      g.config,
      g.poolIds,
      msg.startRun,
      msg.endRun,
    )
    ctx.postMessage(
      {
        type: 'result',
        startRun: msg.startRun,
        endRun: msg.endRun,
        poolIds: g.poolIds,
        steps: g.config.steps,
        values,
        endedAt,
      },
      [values.buffer, endedAt.buffer],
    )
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
