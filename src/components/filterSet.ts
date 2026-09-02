import { useMemo } from 'react'
import { normalizeResourceType } from '../model/model/resourceType'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { useGraphStore } from '../store/graphStore'
import {
  EDGE_CLASSES,
  NODE_KINDS,
  UNTYPED,
  useFilterStore,
  type EdgeClass,
} from '../store/filterStore'

// docs/large-graph-readability.md §LGR3.2 — the transient-filter view layer.
// PURE + hooks, mirroring focusSet.ts: turns the ephemeral filter selections
// into the set of node / edge ids React Flow should render `hidden`. No
// GraphDoc / store mutation, no expression parsing.

const edgeClassOf = (e: Pick<LoopEdge, 'data'>): EdgeClass => {
  // `hint` is not in `LoopEdgeData` — it only exists on the revision Review
  // surface (§VL6). Read `kind` structurally so a future dependency-hint edge
  // still composes; a canvas edge is only ever `resource` / `state`.
  const k = (e.data as { kind?: string } | undefined)?.kind
  if (k === 'state') return 'state'
  if (k === 'hint') return 'hint'
  return 'resource'
}

const isResourceEdge = (e: Pick<LoopEdge, 'data'>): boolean =>
  (e.data?.kind ?? 'resource') === 'resource'

const readResourceType = (raw: unknown): string => normalizeResourceType(raw).value ?? UNTYPED

/**
 * The distinct resource-type entries **present in the open graph** — normalised
 * (§M4.1), deduped, sorted — collected from pool `data.resourceType` and
 * `resource`-edge `data.resourceType`. A free-form string, NOT a fixed palette.
 * The untyped bucket is a separate always-present entry (rendered by the panel),
 * so this returns only the typed strings.
 */
/**
 * The edge classes **actually present in the open graph**, in canonical order
 * (§LGR3.2). Like the resource-type list, this is derived from the graph — so a
 * plain canvas offers only `resource` / `state`, and `hint` (a Review-only
 * dotted edge, `docs/visual-language.md` §VL6) shows up only if such an edge is
 * ever fed in. An empty graph offers no edge-class filter at all.
 */
export function graphEdgeClasses(edges: readonly LoopEdge[]): EdgeClass[] {
  const present = new Set<EdgeClass>()
  for (const e of edges) present.add(edgeClassOf(e))
  return EDGE_CLASSES.filter((c) => present.has(c))
}

/**
 * The node kinds **actually present in the open graph**, canonical order
 * (§LGR3.2). Same graph-derived rule as the edge-class and resource-type lists —
 * a filter never offers a kind the current graph does not contain (no dead
 * always-0 option). Internally all eight kinds stay supported.
 */
export function graphNodeKinds(nodes: readonly LoopNode[]): NodeKind[] {
  const present = new Set<NodeKind>()
  for (const n of nodes) present.add(n.data.kind)
  return NODE_KINDS.filter((k) => present.has(k))
}

export function graphResourceTypes(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
): string[] {
  const typed = new Set<string>()
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    const v = normalizeResourceType((n.data as { resourceType?: unknown }).resourceType).value
    if (v != null) typed.add(v)
  }
  for (const e of edges) {
    if (!isResourceEdge(e)) continue
    const v = normalizeResourceType(
      (e.data as { resourceType?: unknown } | undefined)?.resourceType,
    ).value
    if (v != null) typed.add(v)
  }
  return [...typed].sort((a, b) => a.localeCompare(b))
}

export type HiddenSet = {
  readonly nodes: ReadonlySet<string>
  readonly edges: ReadonlySet<string>
} | null

export type FilterSelections = {
  hiddenEdgeClasses: ReadonlySet<EdgeClass>
  hiddenResourceTypes: ReadonlySet<string>
  hiddenNodeKinds: ReadonlySet<NodeKind>
}

/**
 * Pure. `null` when no filter is active (⇒ nothing hidden). Otherwise the node /
 * edge ids to render `hidden`:
 *  - a node whose kind is filtered, or a **pool** whose resource type is filtered;
 *  - an edge whose class is filtered, or a **resource** edge whose resource type
 *    is filtered, or an edge **incident to a hidden node** (§LGR3.2).
 */
export function computeHidden(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  f: FilterSelections,
): HiddenSet {
  if (
    f.hiddenEdgeClasses.size === 0 &&
    f.hiddenResourceTypes.size === 0 &&
    f.hiddenNodeKinds.size === 0
  ) {
    return null
  }

  const rtActive = f.hiddenResourceTypes.size > 0
  const rtHidden = (raw: unknown): boolean => rtActive && f.hiddenResourceTypes.has(readResourceType(raw))

  const hiddenNodes = new Set<string>()
  for (const n of nodes) {
    if (f.hiddenNodeKinds.has(n.data.kind)) {
      hiddenNodes.add(n.id)
    } else if (
      n.data.kind === 'pool' &&
      rtHidden((n.data as { resourceType?: unknown }).resourceType)
    ) {
      hiddenNodes.add(n.id)
    }
  }

  const hiddenEdges = new Set<string>()
  for (const e of edges) {
    if (
      f.hiddenEdgeClasses.has(edgeClassOf(e)) ||
      (isResourceEdge(e) &&
        rtHidden((e.data as { resourceType?: unknown } | undefined)?.resourceType)) ||
      hiddenNodes.has(e.source) ||
      hiddenNodes.has(e.target)
    ) {
      hiddenEdges.add(e.id)
    }
  }

  return { nodes: hiddenNodes, edges: hiddenEdges }
}

/** The resource-type strings in the open graph (typed only; the panel adds the
 *  untyped bucket). Recomputes only on a node / edge change. */
export function useGraphResourceTypes(): string[] {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  return useMemo(() => graphResourceTypes(nodes, edges), [nodes, edges])
}

/** The edge classes present in the open graph, canonical order. */
export function useGraphEdgeClasses(): EdgeClass[] {
  const edges = useGraphStore((s) => s.edges)
  return useMemo(() => graphEdgeClasses(edges), [edges])
}

/** The node kinds present in the open graph, canonical order. */
export function useGraphNodeKinds(): NodeKind[] {
  const nodes = useGraphStore((s) => s.nodes)
  return useMemo(() => graphNodeKinds(nodes), [nodes])
}

/** The live hidden set: `null` unless a filter is active. Recomputes only when
 *  the selections or the graph change — never on pan / zoom / hover / a sim
 *  step (LGR-INV-1 / -7). */
export function useHiddenSet(): HiddenSet {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const hiddenEdgeClasses = useFilterStore((s) => s.hiddenEdgeClasses)
  const hiddenResourceTypes = useFilterStore((s) => s.hiddenResourceTypes)
  const hiddenNodeKinds = useFilterStore((s) => s.hiddenNodeKinds)
  return useMemo(
    () =>
      computeHidden(nodes, edges, { hiddenEdgeClasses, hiddenResourceTypes, hiddenNodeKinds }),
    [nodes, edges, hiddenEdgeClasses, hiddenResourceTypes, hiddenNodeKinds],
  )
}
