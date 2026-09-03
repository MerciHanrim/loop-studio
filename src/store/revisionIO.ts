import {
  canonicalContent,
  computeThreeWay,
  digestOfCanonical,
  graphStructureIssues,
  readProject,
  readRevisionSide,
  type HunkSelection,
  type ProjectPayload,
  type ProposalBase,
  type ThreeWayPlan,
} from '../model/revision'
import { deserialize, type SavedFrame } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'
import { useProjectStore, type ApplyResult } from './projectStore'
import { importFile, type ImportOutcome, type Viewport } from './workspaceIO'

// SEMANTICS-R.md §R10 — one file input, routed. Import ≠ Apply: a proposal for
// the open project opens a non-destructive Review (Slice 1C); it changes
// nothing here. Everything else loads exactly as `loop-workspace/1` does, plus
// the `projectStore` header for a revision file.

export type RouteResult =
  /** plain Graph / Workspace file — loaded as today; open project cleared.
   *  `structuralWarning` is set when the graph carries an edge the structural
   *  rules reject (e.g. an edge touching a `parameter` / `register`): the graph
   *  still loads and the engine ignores those edges (SEMANTICS-M.md §M1.3). */
  | { kind: 'graph' | 'workspace'; outcome: ImportOutcome; structuralWarning?: string }
  /** a Project **revision** file — graph (+ workspace) loaded, projectStore adopts its header */
  | { kind: 'revision'; outcome: ImportOutcome; project: ProjectPayload; structuralWarning?: string }
  /** a Project **proposal** file — NOTHING mutated; hand off to the Review UI (1C) */
  | { kind: 'proposal'; project: ProjectPayload; base: ProposalBase; sameProject: boolean; proposedText: string }
  /** the file had a `project` key that failed validation — graph/workspace still loaded, project ignored */
  | { kind: 'project-dropped'; outcome: ImportOutcome; warning: string }

function rawProjectOf(text: string): unknown {
  try {
    const o = JSON.parse(text) as { project?: unknown }
    return o && typeof o === 'object' ? o.project : undefined
  } catch {
    return undefined
  }
}

/**
 * Route an imported file. Throws only when the *graph* itself is invalid
 * (exactly as `deserialize` does today). A bad `project` payload never blocks
 * the graph (R-INV-10). A proposal is classified but not loaded (R-INV-11).
 */
export async function routeImport(text: string): Promise<RouteResult> {
  const parsed = deserialize(text) // throws on a bad graph
  // any import invalidates a pending Export plan (§R2.1 / review round 2)
  useProjectStore.setState({ activePlanId: null })
  const raw = rawProjectOf(text)

  // The ONE structural rule shared with whole / selective Apply: no edge may be
  // incident to a `parameter` / `register` (they have no ports), and handles
  // must match the edge kind. A violation isolates the graph (the engine
  // ignores those edges) with a warning; for a `project` file it also drops the
  // header — such a graph is not a trustworthy model doc.
  const structural = graphStructureIssues(parsed.nodes, parsed.edges)
  const structuralWarning = structural.length
    ? `this graph has structural problems and those connections are ignored:\n${structural.join('\n')}`
    : undefined

  if (raw === undefined) {
    const outcome = await importFile(text)
    useProjectStore.getState().clear()
    return { kind: outcome.workspace ? 'workspace' : 'graph', outcome, structuralWarning }
  }

  if (structuralWarning) {
    const outcome = await importFile(text)
    useProjectStore.getState().clear()
    return { kind: 'project-dropped', outcome, warning: structuralWarning }
  }

  // §R2-5 — the ordered pipeline for the file's own graph: normalise →
  // defensive read (structural gate) → version predicate → version-appropriate
  // projection. A malformed model payload (§R2-5.1) never blocks the graph and
  // never enters Review / Apply.
  const side = readRevisionSide(
    // SEMANTICS-R5.md §R5-5.1 — `frames` is part of the side; ≥ 1 surviving
    // entry makes this a `loop-revision/5` side and its digest is verified
    // WITH `frames` projected.
    {
      nodes: parsed.nodes,
      edges: parsed.edges,
      recommendedRunConfig: parsed.recommendedRunConfig,
      frames: parsed.frames,
    },
    undefined,
    parsed.modelVersion,
  )
  if (!side.ok) {
    const outcome = await importFile(text)
    useProjectStore.getState().clear()
    return {
      kind: 'project-dropped',
      outcome,
      warning: `this file's model-layer content is not readable (${side.detail})`,
    }
  }
  const loaded = side.content
  const read = readProject(raw, loaded)

  if (!read.ok) {
    const outcome = await importFile(text)
    useProjectStore.getState().clear()
    return { kind: 'project-dropped', outcome, warning: read.warning }
  }

  if (read.project.role === 'proposal') {
    // §R10 step 5 / R-INV-11 — do not touch the graph / sim / undo / project.
    const openId = useProjectStore.getState().open?.projectId
    return {
      kind: 'proposal',
      project: read.project,
      base: read.proposalBase!,
      sameProject: openId != null && openId === read.project.projectId,
      proposedText: text,
    }
  }

  // a revision file — load the graph/workspace, then adopt the header
  const outcome = await importFile(text)
  useProjectStore.getState().openRevisionFromFile(read.project, digestOfCanonical(loaded))
  return { kind: 'revision', outcome, project: read.project }
}

/** A routed proposal awaiting a Review-panel decision. */
export type PendingProposal = Extract<RouteResult, { kind: 'proposal' }>

/** the proposed graph carried by a routed proposal (deserialised once).
 *  LGR Slice 5 — `frames` rides along so a whole-proposal Apply / "Open as a
 *  document" adopts the proposal's saved frames atomically (`SEMANTICS-R5.md`
 *  §R5-6); `deserialize` always yields an array (`[]` when the file has none). */
function proposedGraph(
  p: PendingProposal,
): { nodes: LoopNode[]; edges: LoopEdge[]; modelVersion: 1 | 2; frames: SavedFrame[] } {
  const { nodes, edges, modelVersion, frames } = deserialize(p.proposedText)
  return { nodes, edges, modelVersion, frames }
}

/** §R7A.2 — classify without applying, for the Review UI. */
export function classifyPendingProposal(p: PendingProposal) {
  return useProjectStore.getState().classifyProposal({
    project: p.project,
    base: p.base,
    proposed: proposedGraph(p),
  })
}

/** §R7A.3 — the per-hunk three-way plan (`base` vs the LIVE target vs the
 *  proposal), for the Review UI's hunk list. Pure read; nothing mutated. */
export function threeWayForPending(p: PendingProposal): ThreeWayPlan {
  const g = useGraphStore.getState()
  const proposed = proposedGraph(p)
  return computeThreeWay(
    p.base.content,
    // SEMANTICS-R5.md §R5-6 — the LIVE target must carry the on-screen saved
    // frames so the `frames` hunk verdict (noop / clean / conflict) is right.
    canonicalContent(
      { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
      { modelVersion: g.modelVersion },
    ),
    canonicalContent(proposed, { modelVersion: proposed.modelVersion }),
  )
}

/** the live target digest a hunk selection is being built against — passed back
 *  to `applyProposal` as `expectTargetDigest` so a moved target is rejected
 *  (`target-moved`) instead of silently re-using a stale selection. Includes the
 *  live saved `frames` (SEMANTICS-R5.md §R5-6 — a frame edit flips `dirty` and
 *  moves this digest, exactly like a `label` rename); it must stay identical to
 *  `projectStore`'s `liveDigest()`, which is what Apply checks it against. */
export function currentTargetDigest(): string {
  const g = useGraphStore.getState()
  return digestOfCanonical(
    canonicalContent(
      { nodes: g.nodes, edges: g.edges, frames: useFrameStore.getState().snapshot() },
      { modelVersion: g.modelVersion },
    ),
  )
}

/** §R7 — whole-proposal Apply. `confirmed` is the §R7A.4 consent (required for
 *  every non-`exact` class); `expectTargetDigest` pins the snapshot the
 *  confirmation was shown against. Re-gates / re-validates / re-classifies. */
export function applyPendingProposal(
  p: PendingProposal,
  opts: { confirmed?: boolean; expectTargetDigest?: string; selection?: HunkSelection } = {},
): ApplyResult {
  return useProjectStore.getState().applyProposal(
    { project: p.project, base: p.base, proposed: proposedGraph(p) },
    { confirmed: opts.confirmed, expectTargetDigest: opts.expectTargetDigest, selection: opts.selection },
  )
}

/** §R10.5 — "Open as a document": adopt the proposed content, no apply, no new
 *  revision, base pinned for re-export. */
export function openPendingProposalAsDocument(p: PendingProposal): void {
  useProjectStore.getState().openProposalAsDocument(p.project, p.base, proposedGraph(p))
}

export type { Viewport }
