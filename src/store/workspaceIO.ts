// Workspace Export / Import — store wiring (SEMANTICS-W.md, loop-workspace/1).
//
// Slice B: assemble a payload from the stores, and restore a file atomically —
// the graph loads once (one `simulationRev` bump), then config / result / view /
// sim are applied in a single synchronous pass that causes no further bump, so
// the graph-store subscriptions cannot re-reset the sim or re-stale the result
// (§W5.1). The download / upload UI and the size prompt are Slice C.

import type { MonteCarloResult, StateEvent } from '../engine'
import { deserialize, serialize } from '../model/serialize'
import {
  buildWorkspacePayload,
  readWorkspace,
  semanticDigest,
  type WorkspacePayload,
} from '../model/workspace'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'

export type Viewport = { x: number; y: number; zoom: number }
export type ImportOutcome = { workspace: boolean; warnings: string[]; canvas?: Viewport }

/** Collect the current session into a `workspace` payload (§W2). Store-reading
 *  only — the size check and `resultOmitted` handling are Slice C. */
export function collectWorkspacePayload(canvas: Viewport): WorkspacePayload {
  const sim = useSimStore.getState()
  const mc = useMcStore.getState()
  const hasResult = mc.status === 'done' && mc.result != null
  return buildWorkspacePayload({
    mc: {
      config: { ...mc.config },
      ...(hasResult ? { result: mc.result! } : {}),
      ...(mc.resultGraphDigest ? { resultGraphDigest: mc.resultGraphDigest } : {}),
      stale: mc.stale,
    },
    view: {
      timeline: mc.view,
      distributionPoolId: mc.distributionPoolId,
      showMean: mc.showMean,
    },
    canvas,
    simulation: {
      seed: sim.seed,
      step: sim.stepIndex,
      ended: sim.status === 'ended',
      values: sim.values ?? {},
      fired: sim.firedNodeIds,
      triggerQueue: sim.triggerQueue,
      stateEvents: sim.stateEvents,
      series: sim.series,
    },
  })
}

/** The full file string for a Workspace Export (graph + optional workspace). */
export function serializeWorkspaceFile(payload: WorkspacePayload): string {
  const g = useGraphStore.getState()
  return serialize(g.nodes, g.edges, useMcStore.getState().config, payload)
}

/**
 * Import a Loop Studio file. A plain Graph file behaves exactly as today. A
 * Workspace file restores the workspace atomically after the graph load.
 */
export async function importFile(text: string): Promise<ImportOutcome> {
  const parsed = deserialize(text) // throws on a bad graph, as today

  // Digest the graph-to-be BEFORE any store mutation, so the restore below is
  // one uninterrupted synchronous pass (§W5.1).
  const graphDigest =
    parsed.workspace != null
      ? await semanticDigest({ nodes: parsed.nodes, edges: parsed.edges })
      : ''

  // ── from here: synchronous ──────────────────────────────────────────
  useGraphStore.getState().loadDoc({ nodes: parsed.nodes, edges: parsed.edges }) // the ONE bump
  useMcStore.getState().applyRecommended(parsed.recommendedRunConfig)

  if (parsed.workspace == null) {
    return { workspace: false, warnings: [] } // plain graph — done
  }

  const { restored, warnings } = readWorkspace(
    parsed.workspace,
    { nodes: parsed.nodes, edges: parsed.edges },
    graphDigest,
  )
  if (!restored) return { workspace: true, warnings }

  const mc = useMcStore.getState()
  mc.setConfig(restored.mcConfig)
  // `readWorkspace` already validated the result's shape (§W3.3)
  mc.restoreResult(
    restored.result
      ? { ...restored.result, result: restored.result.result as MonteCarloResult }
      : null,
  )
  mc.setView(restored.view.timeline)
  mc.setDistributionPoolId(restored.view.distributionPoolId)
  mc.setShowMean(restored.view.showMean)

  if (restored.simulation) {
    useSimStore.getState().restoreSnapshot({
      seed: restored.simulation.seed,
      step: restored.simulation.step,
      ended: restored.simulation.ended,
      values: restored.simulation.values,
      fired: restored.simulation.fired,
      triggerQueue: restored.simulation.triggerQueue,
      stateEvents: restored.simulation.stateEvents as StateEvent[],
      series: restored.simulation.series,
    })
  }

  return { workspace: true, warnings, canvas: restored.canvas }
}
