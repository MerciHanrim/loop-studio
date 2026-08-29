import {
  canonicalContent,
  digestOfCanonical,
  readProject,
  type ProjectPayload,
  type ProposalBase,
} from '../model/revision'
import { deserialize } from '../model/serialize'
import { useProjectStore } from './projectStore'
import { importFile, type ImportOutcome, type Viewport } from './workspaceIO'

// SEMANTICS-R.md §R10 — one file input, routed. Import ≠ Apply: a proposal for
// the open project opens a non-destructive Review (Slice 1C); it changes
// nothing here. Everything else loads exactly as `loop-workspace/1` does, plus
// the `projectStore` header for a revision file.

export type RouteResult =
  /** plain Graph / Workspace file — loaded as today; open project cleared */
  | { kind: 'graph' | 'workspace'; outcome: ImportOutcome }
  /** a Project **revision** file — graph (+ workspace) loaded, projectStore adopts its header */
  | { kind: 'revision'; outcome: ImportOutcome; project: ProjectPayload }
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

  if (raw === undefined) {
    const outcome = await importFile(text)
    useProjectStore.getState().clear()
    return { kind: outcome.workspace ? 'workspace' : 'graph', outcome }
  }

  const loaded = canonicalContent({ nodes: parsed.nodes, edges: parsed.edges })
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

export type { Viewport }
