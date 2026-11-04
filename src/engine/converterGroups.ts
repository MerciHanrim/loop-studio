import type { LoopEdge, LoopNode } from '../model/types'

// Converter groups (issue #471, Deploy 2 — SEMANTICS.md §6 erratum, part 2;
// the multi-supply Gate, issue #476 — part 3).
//
// A GROUP is a set of routers (Gates and Converters) joined by resource
// connections between routers, that contains at least one Converter fed by a
// router OR at least one Gate with two supplies. Inside a group every router →
// router connection must deliver exactly what its receiver consumes (I5), so
// the members' run fractions and throughputs are tied together and have to be
// decided as one plan. The shape of the group decides what that plan is:
//
//   tree          no split that rejoins, and every Gate has one supply — one
//                 free number; the plan is the smallest bound (step.ts)
//   split-rejoin  two forward paths from one router meet again at a later
//                 router of the group (every connection points forward — this
//                 is NOT a directed cycle; a zero-storage cycle is a different
//                 thing, SEMANTICS §S4). With a Converter in the group the only
//                 exact plan can be zero, and a plan that happens to agree
//                 flips with the branches that are live, so the shape is
//                 REFUSED before the run (F1), whatever the numbers. A group of
//                 Gates only merges what arrives and is never refused; its join
//                 has two supplies, so `step` plans it as a multi group (#471,
//                 SEMANTICS.md §6 erratum, part 4). Connections between the same two routers
//                 count once (rev 3 design): a Gate's share to a connection and
//                 a Converter's need on it are both that connection's rate, so
//                 parallel connections always agree on the one fraction, and
//                 the plan sums them per pair.
//   multi         a Gate with two supplies: two upstream routers, or one
//                 upstream router and its own Pool inputs. Two or more free
//                 numbers; the split is decided by a fixed priority in the
//                 engine's existing order (#476, SEMANTICS.md §6 erratum,
//                 part 3), with or without a Converter behind the Gate, and
//                 also when two multi-supply Gates' downstreams meet at one
//                 Converter (the Converter's one fraction then sets the second
//                 Gate's throughput from the first's; step.ts `planMulti`).
//
// The classification is on structure only. Over the FULL graph it decides the
// refusal shown before a run (the simulation and Monte Carlo stores); over the
// live connections of one step (routers that fire, branches that are not
// dead) it decides which groups `step` plans — a live subgraph of a tree is a
// tree, so a graph accepted here is accepted at every step.

export type GroupClass = 'tree' | 'split-rejoin' | 'multi'

export type ConverterGroup = {
  /** every member router, ascending id */
  members: string[]
  cls: GroupClass
  /** `split-rejoin`: the router where the two paths part, and the first router
   *  (ascending id) where they meet again; null for the other classes */
  split: string | null
  join: string | null
  /** `multi`: the Gates with two supplies */
  multiGates: string[]
  /** the group contains a Converter fed by a router (a Gate-only group does
   *  not; it is planned when `multi`, never refused) */
  hasConverter: boolean
}

type Kind = string | undefined
const isRouterKind = (k: Kind) => k === 'gate' || k === 'converter'

/** The groups of `edges` (resource connections only) over `nodes`. `live`
 *  narrows the connections considered (the step passes the ones that carry
 *  something this step); the full graph is the default. */
export function converterGroups(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  live: (e: LoopEdge) => boolean = () => true,
): ConverterGroup[] {
  const kind = new Map<string, Kind>(nodes.map((n) => [n.id, n.data.kind]))
  const kindOf = (id: string): Kind => kind.get(id)
  const res = edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource' && live(e))
  const rr = res.filter((e) => isRouterKind(kindOf(e.source)) && isRouterKind(kindOf(e.target)))
  if (rr.length === 0) return []

  const outs = new Map<string, LoopEdge[]>()
  const ins = new Map<string, LoopEdge[]>()
  const adj = new Map<string, Set<string>>()
  for (const e of rr) {
    ;(outs.get(e.source) ?? outs.set(e.source, []).get(e.source)!).push(e)
    ;(ins.get(e.target) ?? ins.set(e.target, []).get(e.target)!).push(e)
    ;(adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target)
    ;(adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source)
  }
  const ownPoolInput = (gateId: string) => res.some((e) => e.target === gateId && kindOf(e.source) === 'pool')

  const seen = new Set<string>()
  const groups: ConverterGroup[] = []
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue
    const members: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const v = stack.pop()!
      members.push(v)
      for (const w of adj.get(v) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w) }
    }
    members.sort()
    // a group is about a Converter that is fed by a router, or a Gate with
    // two supplies (#476: the priority applies to every such Gate)
    const hasConverter = members.some((m) => kindOf(m) === 'converter' && (ins.get(m)?.length ?? 0) > 0)
    const multiGates = members.filter((m) => {
      if (kindOf(m) !== 'gate') return false
      const ups = new Set((ins.get(m) ?? []).map((e) => e.source))
      return ups.size >= 2 || (ups.size >= 1 && ownPoolInput(m))
    })
    if (!hasConverter && multiGates.length === 0) continue

    const rejoin = findSplitRejoin(members, outs)
    groups.push({
      members,
      cls: rejoin ? 'split-rejoin' : multiGates.length ? 'multi' : 'tree',
      split: rejoin?.split ?? null,
      join: rejoin?.join ?? null,
      multiGates,
      hasConverter,
    })
  }
  return groups
}

/** The first router (ascending id) with two forward paths that meet again,
 *  and the first router where they meet. Branches out of a router: one per
 *  distinct target (parallel connections count once). */
function findSplitRejoin(
  members: string[],
  outs: Map<string, LoopEdge[]>,
): { split: string; join: string } | null {
  const reach = (from: string): Set<string> => {
    const set = new Set<string>([from])
    const stack = [from]
    while (stack.length) {
      const v = stack.pop()!
      for (const e of outs.get(v) ?? []) if (!set.has(e.target)) { set.add(e.target); stack.push(e.target) }
    }
    return set
  }
  for (const u of members) {
    const es = outs.get(u) ?? []
    if (es.length < 2) continue
    const branches = [...new Set(es.map((e) => e.target))].sort()
    if (branches.length < 2) continue
    const sets = branches.map(reach)
    let join: string | null = null
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        for (const x of sets[i]) if (sets[j].has(x) && (join === null || x < join)) join = x
      }
    }
    if (join !== null) return { split: u, join }
  }
  return null
}

/** The groups a graph cannot run with (a split that rejoins, with a Converter
 *  in the group), over the full graph — what the run bar, the Inspector and
 *  the Monte Carlo dialog show before any run, and what `step` refuses to
 *  compute. A group of Gates only is never refused. */
export function refusedGroups(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): ConverterGroup[] {
  return converterGroups(nodes, edges).filter((g) => g.cls === 'split-rejoin' && g.hasConverter)
}
