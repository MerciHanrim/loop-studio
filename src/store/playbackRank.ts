import { ROUTER_KINDS } from '../engine'
import type { FlowEvent } from '../engine'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'

// docs/simulation-playback-ordering.md §PBO1 / §PBO2 — the ordered-cascade
// schedule. Presentation-only: derived here from the step-start graph snapshot +
// the step's `report.events`; NOTHING is added to `FlowEvent` / `StepReport` /
// any serialised structure or digest (PBO-INV-1).
//
// Ordering source (§PBO1, corrected — see the engine trace in the PR that
// introduced this file): the rank is the LONGEST-PREDECESSOR depth of the
// **full** resource-edge graph (Pools included) after SCC condensation — NOT the
// router-only condensation depth (a Drain whose input arrives through a Pool is
// indegree-0 in the router-only graph and would tie the pipeline flat), and NOT
// BFS shortest distance (a merge / short-circuit could rank a downstream node
// below its own upstream). Longest-predecessor depth guarantees every
// condensation edge points strictly deeper, so the cascade never runs backward
// (PBO-D2).

/** Fraction of τ ∈ [0,1] reserved for spreading bucket onsets (§PBO2). Tunable,
 *  not structural (PBO-D4). */
export const STAGGER_SPAN = 0.3
/** Max distinct onset buckets; deeper ranks fold into the last one, so the total
 *  step never grows with graph width (PBO-INV-2). Tunable (PBO-D4). */
export const STAGGER_MAX_BUCKETS = 6

/** The three geometrically-distinct playback cues (§PBO3). `emit` is always the
 *  depart side; `converge` / `absorb` are the arrive side, chosen from the
 *  target node kind by the edge layer (a Drain / End absorbs). */
export type CueRole = 'emit' | 'converge' | 'absorb'

export type StaggerSchedule = {
  /** edgeId → onset in [0, STAGGER_SPAN]; the edge's local τ starts here */
  onsetByEdge: Record<string, number>
  /** count of non-empty onset buckets this step (≤ STAGGER_MAX_BUCKETS) */
  bucketCount: number
}

const EMPTY: StaggerSchedule = { onsetByEdge: {}, bucketCount: 0 }

/** 'P1' = the Phase-1 (Source push) bucket; a number = a condensation-SCC id. */
type GroupKey = 'P1' | number

/**
 * Compute the per-edge onset schedule + arrive-cue roles for one step's
 * playback. Pure: a function of the graph snapshot and `events` only, fully
 * deterministic (every traversal is id-sorted). Called ONCE per transition
 * (docs/simulation-playback-ordering.md PBO-INV-7).
 */
export function computeStagger(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  events: readonly FlowEvent[],
): StaggerSchedule {
  if (import.meta.env.DEV) {
    const w = globalThis as unknown as { __staggerComputes?: number }
    w.__staggerComputes = (w.__staggerComputes ?? 0) + 1
  }
  if (events.length === 0) return EMPTY

  const kindOf = new Map<string, NodeKind>()
  for (const n of nodes) kindOf.set(n.id, n.data.kind)

  // ── full resource-edge digraph (Pools included), ids ascending ──────────
  const ids = [...kindOf.keys()].sort()
  const adj = new Map<string, string[]>()
  for (const id of ids) adj.set(id, [])
  for (const e of edges) {
    if ((e.data?.kind ?? 'resource') !== 'resource') continue
    if (!adj.has(e.source) || !adj.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
  }
  for (const id of ids) adj.get(id)!.sort()

  // ── strongly connected components (iterative Tarjan) ───────────────────
  const sccOf = new Map<string, number>()
  {
    let counter = 0
    let sccCount = 0
    const idx = new Map<string, number>()
    const low = new Map<string, number>()
    const onStack = new Set<string>()
    const tarjanStack: string[] = []
    for (const root of ids) {
      if (idx.has(root)) continue
      const work: { v: string; i: number }[] = [{ v: root, i: 0 }]
      while (work.length) {
        const frame = work[work.length - 1]
        const v = frame.v
        if (frame.i === 0) {
          idx.set(v, counter)
          low.set(v, counter)
          counter++
          tarjanStack.push(v)
          onStack.add(v)
        }
        const nbrs = adj.get(v)!
        if (frame.i < nbrs.length) {
          const w = nbrs[frame.i]
          frame.i++
          if (!idx.has(w)) {
            work.push({ v: w, i: 0 })
          } else if (onStack.has(w)) {
            low.set(v, Math.min(low.get(v)!, idx.get(w)!))
          }
        } else {
          if (low.get(v) === idx.get(v)) {
            for (;;) {
              const w = tarjanStack.pop()!
              onStack.delete(w)
              sccOf.set(w, sccCount)
              if (w === v) break
            }
            sccCount++
          }
          work.pop()
          if (work.length) {
            const parent = work[work.length - 1].v
            low.set(parent, Math.min(low.get(parent)!, low.get(v)!))
          }
        }
      }
    }
  }

  // ── condensation DAG + longest-predecessor depth ──────────────────────
  const sccIds = [...new Set(sccOf.values())].sort((a, b) => a - b)
  const cAdj = new Map<number, Set<number>>()
  const cIndeg = new Map<number, number>()
  for (const s of sccIds) {
    cAdj.set(s, new Set())
    cIndeg.set(s, 0)
  }
  for (const [u, outs] of adj) {
    const su = sccOf.get(u)!
    for (const v of outs) {
      const sv = sccOf.get(v)!
      if (su === sv || cAdj.get(su)!.has(sv)) continue
      cAdj.get(su)!.add(sv)
      cIndeg.set(sv, cIndeg.get(sv)! + 1)
    }
  }
  const depth = new Map<number, number>()
  for (const s of sccIds) depth.set(s, 0)
  const indegWork = new Map(cIndeg)
  let frontier = sccIds.filter((s) => indegWork.get(s) === 0).sort((a, b) => a - b)
  while (frontier.length) {
    const next: number[] = []
    for (const s of frontier) {
      for (const t of [...cAdj.get(s)!].sort((a, b) => a - b)) {
        if (depth.get(t)! < depth.get(s)! + 1) depth.set(t, depth.get(s)! + 1)
        indegWork.set(t, indegWork.get(t)! - 1)
        if (indegWork.get(t) === 0) next.push(t)
      }
    }
    frontier = next.sort((a, b) => a - b)
  }

  // ── classify events into groups (Phase-1, or a routing-node SCC) ───────
  const perEvent: { edgeId: string; group: GroupKey }[] = []
  let hasP1 = false
  for (const ev of events) {
    const fk = kindOf.get(ev.from)
    if (fk === 'source') {
      hasP1 = true
      perEvent.push({ edgeId: ev.edgeId, group: 'P1' })
    } else {
      // PBO-D2 — the routing node is the router endpoint (`from` if both are).
      const routing = fk && ROUTER_KINDS.has(fk) ? ev.from : ev.to
      perEvent.push({ edgeId: ev.edgeId, group: sccOf.get(routing) ?? -1 })
    }
  }

  // ── order the buckets: Phase-1 first, then Phase-2 SCCs by (depth, id) ──
  const p2groups = [
    ...new Set(perEvent.filter((e) => e.group !== 'P1').map((e) => e.group as number)),
  ].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || a - b)
  const orderedKeys: GroupKey[] = [...(hasP1 ? (['P1'] as const) : []), ...p2groups]

  const bucketCount = Math.min(orderedKeys.length, STAGGER_MAX_BUCKETS)
  const bucketOfKey = new Map<GroupKey, number>()
  orderedKeys.forEach((k, i) => bucketOfKey.set(k, Math.min(i, bucketCount - 1)))

  const onsetByEdge: Record<string, number> = {}
  for (const { edgeId, group } of perEvent) {
    if (edgeId in onsetByEdge) continue // §PBO2 point — first event on an edge wins
    const k = bucketOfKey.get(group) ?? 0
    onsetByEdge[edgeId] = bucketCount <= 1 ? 0 : (STAGGER_SPAN * k) / (bucketCount - 1)
  }

  return { onsetByEdge, bucketCount }
}
