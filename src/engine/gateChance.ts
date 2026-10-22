// A probabilistic Gate's branch chances, read from the document the way the
// engine reads it (Lumi, 2026-10-20: the panel shows result · weight · chance
// on the Gate's outgoing rows and the same figure on each of its lines; note
// 94's chance table, generalised). Pure: no random draw is made or consumed,
// no state is read or written — the panel may call it on every render.
//
// The engine's rules it shares (`step.ts` uses the same two functions below):
// - which lines count: resource lines not touching a Parameter / Register;
// - each line's flow as a weight: `parseFlow`, then — in a v2 document — an
//   `@id` resolved to its Parameter's value (unknown / not a Parameter / not a
//   finite number ⇒ 0; a negative value ⇒ 1, the literal rule), and `rateOf`
//   (`all` ⇒ 1, `n%` ⇒ n / 100);
// - a line on a router-only cycle is dead; `pickBranch` skips dead lines,
//   draws one branch by `categorical` (any weight not finite or < 0, or a sum
//   ≤ 0 ⇒ no branch: the gate is inert that step).
//
// What a static reading cannot fix, it says so instead of guessing:
// - a random weight (`1-3`, `2D6`) is drawn anew each step ⇒ every chance of
//   that Gate is decided at run time;
// - a router-only cycle is judged among the routers that FIRE in a step, which
//   only a run knows ⇒ a Gate with a line on such a cycle among all its
//   routers is decided at run time too.
import { parseFlow, rateOf, type FlowExpr, type ModelVersion } from './flow'
import { ROUTER_KINDS } from './stateExpr'
import type { LoopEdge, LoopNode } from '../model/types'

const MODEL_KINDS = new Set(['parameter', 'register'])

/** the resource lines the engine reads: none incident to a Parameter or a
 *  Register (they have no ports; a hand-made file can still carry such lines) */
export function engineResourceEdges(nodes: LoopNode[], edges: LoopEdge[]): LoopEdge[] {
  const kind = new Map(nodes.map((n) => [n.id, n.data.kind as string]))
  return edges.filter(
    (e) => !MODEL_KINDS.has(kind.get(e.source) ?? '') && !MODEL_KINDS.has(kind.get(e.target) ?? '') && (e.data?.kind ?? 'resource') === 'resource',
  )
}

/** every resource line's flow as the engine evaluates it (SEMANTICS-M2.md
 *  §M2-3): parsed, and in a v2 document each `@id` resolved once to a
 *  `const`; the diagnostics an unresolved reference raises */
export function resolveFlowExprs(
  byId: Map<string, LoopNode>,
  resEdges: LoopEdge[],
  modelVersion: ModelVersion,
): { flowOf: Map<string, FlowExpr>; paramDiagnostics: string[] } {
  const flowOf = new Map<string, FlowExpr>(
    resEdges.map((e) => [e.id, parseFlow(e.data?.kind === 'resource' ? e.data.flow : '1', modelVersion)]),
  )
  const paramDiagnostics: string[] = []
  if (modelVersion === 2) {
    for (const e of resEdges) {
      const fx = flowOf.get(e.id)!
      if (fx.kind !== 'param' && fx.kind !== 'paramBad') continue
      if (fx.kind === 'paramBad') {
        flowOf.set(e.id, { kind: 'const', value: 0 })
        paramDiagnostics.push(`Edge "${e.id}" flow "${fx.raw}" is not a valid parameter reference; contributes 0.`)
        continue
      }
      const target = byId.get(fx.id)
      if (!target) {
        flowOf.set(e.id, { kind: 'const', value: 0 })
        paramDiagnostics.push(`Edge "${e.id}" flow "@${fx.id}" references an unknown parameter; contributes 0.`)
        continue
      }
      if (target.data.kind !== 'parameter') {
        flowOf.set(e.id, { kind: 'const', value: 0 })
        paramDiagnostics.push(
          `Edge "${e.id}" flow "@${fx.id}" must reference a parameter node (got ${target.data.kind}); contributes 0.`,
        )
        continue
      }
      const v = (target.data as { value?: unknown }).value
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        flowOf.set(e.id, { kind: 'const', value: 0 })
        paramDiagnostics.push(`Edge "${e.id}" flow "@${fx.id}": parameter value is not a finite number; contributes 0.`)
        continue
      }
      // §M2-3.1 — the identical-literal rule: `parseFlow`'s literal gate is
      // `n >= 0`, so a negative resolves exactly as the literal "-2" does (⇒ 1).
      flowOf.set(e.id, { kind: 'const', value: v >= 0 ? v : 1 })
    }
  }
  return { flowOf, paramDiagnostics }
}

/** Kahn topological order of router→router lines, ascending-id tiebreak; the
 *  routers left over form a zero-storage cycle */
export function routerOrder(routerIds: string[], resEdges: LoopEdge[]): { order: string[]; cyclic: string[] } {
  const rIds = new Set(routerIds)
  const indeg = new Map(routerIds.map((id) => [id, 0]))
  const radj = new Map<string, string[]>(routerIds.map((id) => [id, []]))
  for (const e of resEdges) {
    if (rIds.has(e.source) && rIds.has(e.target)) {
      radj.get(e.source)!.push(e.target)
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    }
  }
  const order: string[] = []
  let frontier = routerIds.filter((id) => (indeg.get(id) ?? 0) === 0).sort()
  while (frontier.length) {
    const id = frontier.shift()!
    order.push(id)
    for (const t of radj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1)
      if (indeg.get(t) === 0) {
        frontier.push(t)
        frontier = frontier.sort()
      }
    }
  }
  const cyclic = routerIds.filter((id) => !order.includes(id))
  return { order, cyclic }
}

export type GateBranch = {
  edgeId: string
  target: string
  /** the weight the engine would read; null when it is drawn at run time */
  weight: number | null
  /** weight ÷ the sum; null unless the whole Gate is `fixed` */
  chance: number | null
}

export type GateChances = {
  /** `fixed`: every chance is known; `runtime`: decided while running (a random
   *  weight, or a line on a possible router-only cycle); `inert`: the weights
   *  sum to 0, so no branch is ever taken; `none`: no outgoing line */
  status: 'fixed' | 'runtime' | 'inert' | 'none'
  /** why `runtime` */
  reason?: 'random' | 'cycle'
  /** the sum of the weights, when every weight is known */
  sum: number | null
  /** in the engine's canonical order (line id ascending, `pickBranch`) */
  branches: GateBranch[]
}

const cmpId = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** the chances of a probabilistic Gate's outgoing lines, or null when `gateId`
 *  is not a probabilistic Gate */
export function gateChances(nodes: LoopNode[], edges: LoopEdge[], gateId: string, modelVersion: ModelVersion): GateChances | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const g = byId.get(gateId)
  if (!g || g.data.kind !== 'gate' || g.data.distribution !== 'probabilistic') return null
  const resEdges = engineResourceEdges(nodes, edges)
  const outs = resEdges.filter((e) => e.source === gateId).sort(cmpId)
  if (outs.length === 0) return { status: 'none', sum: null, branches: [] }
  const { flowOf } = resolveFlowExprs(byId, outs, modelVersion)
  const routers = nodes.filter((n) => ROUTER_KINDS.has(n.data.kind)).map((n) => n.id)
  const { cyclic } = routerOrder(routers, resEdges)
  const onCycle = outs.some((e) => cyclic.includes(e.source) || cyclic.includes(e.target))
  const random = outs.some((e) => {
    const k = flowOf.get(e.id)!.kind
    return k === 'range' || k === 'dice'
  })
  const branches: GateBranch[] = outs.map((e) => {
    const fx = flowOf.get(e.id)!
    const isRandom = fx.kind === 'range' || fx.kind === 'dice'
    return { edgeId: e.id, target: e.target, weight: isRandom ? null : rateOf(fx), chance: null }
  })
  if (random || onCycle) {
    return { status: 'runtime', reason: random ? 'random' : 'cycle', sum: random ? null : branches.reduce((s, b) => s + (b.weight ?? 0), 0), branches }
  }
  const sum = branches.reduce((s, b) => s + (b.weight ?? 0), 0)
  // `categorical`: a sum ≤ 0 takes no branch. (A fixed weight here is never
  // negative or non-finite: `parseFlow` and the reference rule above make every
  // fixed weight a finite number ≥ 0.)
  if (!(sum > 0)) return { status: 'inert', sum, branches }
  return { status: 'fixed', sum, branches: branches.map((b) => ({ ...b, chance: (b.weight ?? 0) / sum })) }
}
