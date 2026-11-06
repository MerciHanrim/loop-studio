import type { Activation, LoopEdge, LoopNode } from '../model/types'
import { kindFindingText, refusingKindFindings, resolveKinds, type ResourceKindDecl } from '../model/kinds'
import { applyUnits } from '../model/engineValues'
import { hasTimetables } from '../model/modelVersion'
import { applyTimetables, timetableFindings, timetableFindingText, timetableLines, unmetAmount, type PlannedLine, type Timetable } from '../model/timetable'
import type { DocTime } from '../model/units'
import { boundaryOutflowByKind } from './boundaryOutflow'
import { converterGroups, refusedGroups } from './converterGroups'
import { evalDet, evalRand, type ModelVersion, rateOf } from './flow'
import { resolveFlowExprs, routerOrder } from './gateChance'
import { categorical, sample } from './rng'
import {
  ACT_WHY,
  LABEL_WHY,
  ROUTER_KINDS,
  parseActivatorExpr,
  parseDelay,
  parseLabelExpr,
  parseLabelTiming,
  parseLabelWhen,
  resolveParamRhs,
} from './stateExpr'
// docs/label-timing-authoring.md LTA-D13 — `ROUTER_KINDS`'s canonical home is
// `stateExpr.ts` (shared with the Inspector's `eligibleLabelPreset`); this
// re-export keeps `src/engine/index.ts`'s public `ROUTER_KINDS` path — and
// every other direct `from './step'` import of it — unchanged. A bare
// `import` does not re-export a name, so this line is required.
export { ROUTER_KINDS } from './stateExpr'
import { EPSILON, type FlowEvent, type GateStatus, type SimState, type SimValues, type StateEvent, type StepNotice, type StepResult, type TimetableLineReport, type TriggerQueueEntry } from './types'

// Engine A — the deterministic core. Implements SEMANTICS.md §6 exactly:
// Phase 1 push (Sources), then Phase 2 pull (Gate / Converter / Drain / End)
// as one forward walk of the router DAG in topological order, with a
// reservation ledger so pool capacity is never double-spent.
//
// Engine B Part 1 (SEMANTICS-B1.md) adds, behind a `seed`: random flow
// evaluation (`1-3`, `2D6`) via a keyed RNG, cached one draw per edge per step;
// and the probabilistic Gate (one branch per step by categorical sampling).
//
// State connections (SEMANTICS-S.md, loop-state/1) add a Phase 0 before Push:
// `trigger` — a one-step pulse (optional integer `delay`) firing a `passive` /
// `interactive` target on the delivery step; `activator` — an AND-combined level
// gate on the target's firing; `label` — a numeric edit on the target Pool's
// step-start balance, with a single end-of-Phase-0 clamp. The `label` event
// reporting shape (`delta` + `clampAdjustment`) is loop-state/2 (SEMANTICS-S2.md);
// everything else is loop-state/1.

const nz = (x: number) => (Math.abs(x) < EPSILON ? 0 : x)
const cap = (n: LoopNode): number =>
  n.data.kind === 'pool' && n.data.capacity != null ? n.data.capacity : Infinity

function requireFinite(v: number, what: string): number {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${what} must be a finite number ≥ 0 (got ${v})`)
  return v
}

export function initSim(nodes: LoopNode[], opts: Pick<StepOptions, 'kinds' | 'time'> = {}): SimState {
  // loop-model/4 (SEMANTICS-M4.md §M4-2.1) — a Pool authored in a unit starts
  // at its engine value; a graph with no field unit is read as it is
  nodes = applyUnits(nodes, [], opts.kinds, opts.time).nodes
  const values: SimValues = {}
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    values[n.id] = requireFinite(n.data.initial, `Pool "${n.data.label}" initial`)
    if (n.data.capacity != null) {
      requireFinite(n.data.capacity, `Pool "${n.data.label}" capacity`)
      // issue #406 — a starting amount above the capacity is refused here, not
      // clamped by the first step's Commit in silence; the document keeps the
      // pair as authored, for the user to correct
      if (n.data.initial > n.data.capacity)
        throw new Error(
          `Pool "${n.data.label}" initial must be ≤ its capacity (initial ${n.data.initial}, capacity ${n.data.capacity})`,
        )
    }
  }
  return { step: 0, values, ended: false, fired: [], triggerQueue: [] }
}

const TRIGGERABLE = new Set(['passive', 'interactive'])

/** §M5-6 — what each table line actually moved this step */
function withMoved(lines: readonly PlannedLine[], events: readonly FlowEvent[]): TimetableLineReport[] {
  return lines.map((l) => ({ ...l, moved: events.reduce((sum, ev) => (ev.edgeId === l.edgeId ? sum + ev.amount : sum), 0) }))
}

export type StepOptions = {
  /** loop-model/3 (SEMANTICS-M3.md) — the document's kinds table. With a
   *  non-empty one, a refusing finding (§M3-4: a conflict, a not-computable or
   *  a broken balance where a conserved kind is involved) stops the step before
   *  anything moves, and the report carries `boundaryOutflow` (§M3-5). Absent
   *  or empty ⇒ the loop-model/2 behaviour, event for event (M3-INV-1). */
  kinds?: readonly ResourceKindDecl[]
  /** loop-model/4 (SEMANTICS-M4.md §M4-3) — the document's step length, which
   *  a per-time or rate-unit field's engine value depends on. Absent ⇒ no
   *  per-time field resolves (its number is read as the base unit per step). */
  time?: DocTime
  /** loop-model/5 (SEMANTICS-M5.md) — the document's timetables, which a `~id`
   *  flow reads. A document with no table line steps as it did, event for event. */
  timetables?: readonly Timetable[]
  /** the fraction each Converter may run at this step, by node id: 0 to 1, and
   *  absent means 1. The engine reaches for it and no further, and `pull all`
   *  means reaching it (SEMANTICS.md §9). With no entry a step is what it was. */
  runTargets?: Readonly<Record<string, number>>
}

export function step(
  nodes: LoopNode[],
  edges: LoopEdge[],
  prev: SimState,
  seed = 1,
  modelVersion: ModelVersion = 1,
  opts: StepOptions = {},
): StepResult {
  // SEMANTICS.md §6 — "if `ended` was set, the run stops": an ended state is a
  // fixed point of `step`. Nothing is evaluated, nothing moves, the step count
  // and the values stay, and the report is empty (issue #419 item 1: until
  // now only the callers held this — the PlayBar's Replay resets first, the
  // Monte-Carlo loops stop on `st.ended` — while `step` itself kept moving
  // resources past the End).
  if (prev.ended) {
    return {
      state: { step: prev.step, values: prev.values, ended: true, fired: [], triggerQueue: prev.triggerQueue },
      report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: [], notices: [], gates: [] },
    }
  }
  const curStep = prev.step + 1 // the step being computed — the RNG key's `step`
  // a Converter's target, and what `pull all` must reach of it. A ratio, so a small
  // target cannot pass with nothing moved; at a target of 1 it is the `1 − EPSILON`
  // this test has always been.
  const runOf = (id: string): number => opts.runTargets?.[id] ?? 1
  const RUN_REACHED = 1 - EPSILON
  /** a planned group's `pull all` need per member: the target its number asks for */
  const planNeed = new Map<string, number>()
  // loop-model/4 (SEMANTICS-M4.md §M4-2.1) — the engine reads the DERIVED
  // graph: every unit-bearing field at its engine value. The same arrays come
  // back when no field names a unit (M4-INV-1). The kind findings below read
  // the authored graph: their balance is exact over the authored decimals.
  const authoredNodes = nodes
  const authoredEdges = edges
  ;({ nodes, edges } = applyUnits(nodes, edges, opts.kinds, opts.time))
  // loop-model/5 (SEMANTICS-M5.md §M5-5) — a table line that cannot run refuses
  // the step: nothing moves and the step is not consumed. Otherwise each table
  // line carries this step's amount as a constant from here on, so every phase
  // below reads it as it reads any other number.
  let tablePlan: ReturnType<typeof applyTimetables> | null = null
  if (hasTimetables(modelVersion) && timetableLines(edges).length > 0) {
    const found = timetableFindings(nodes, edges, opts.timetables, opts.kinds, opts.time)
    if (found.length) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: found.map((f) => timetableFindingText(f, nodes, edges)), notices: [], gates: [] },
      }
    }
    tablePlan = applyTimetables(nodes, edges, opts.timetables!, opts.kinds, opts.time!, curStep)
    if (tablePlan.notFinite) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: { events: [], activated: [], fired: [], stateEvents: [], diagnostics: [timetableFindingText(tablePlan.notFinite, nodes, edges)], notices: [], gates: [] },
      }
    }
    edges = tablePlan.edges
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // loop-model/1: `parameter` / `register` have no ports — the engine ignores
  // ANY edge incident to one (a malformed / hand-authored file can carry them).
  const MODEL = new Set(['parameter', 'register'])
  const modelId = (id: string) => MODEL.has(byId.get(id)?.data.kind as string)
  const liveEdges = edges.filter((e) => !modelId(e.source) && !modelId(e.target))
  const resEdges = liveEdges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  // #471 Deploy 2 (F1) — a split that rejoins (two forward paths from one
  // router meeting again at a later Gate or Converter) has no plan but zero,
  // and one that happens to agree flips with the branches that are live. The
  // run bar refuses such a graph before Play, Step or Monte Carlo start
  // (`refusedGroups`, the same classification); this is the engine's own
  // refusal for a caller that steps anyway: nothing moves, the step is not
  // consumed, and the report says why. Never a silent zero.
  const refused = refusedGroups(nodes, liveEdges)
  if (refused.length) {
    const label = (id: string | null) => byId.get(id ?? '')?.data.label ?? id ?? '?'
    return {
      state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
      report: {
        events: [], activated: [], fired: [], stateEvents: [],
        diagnostics: refused.map(
          (g) =>
            `Can't run: resources split at "${label(g.split)}" and meet again at "${label(g.join)}". This model version does not support paths that split and meet again, so nothing moved. Remove one of the paths, or add a Pool on one of them (that path then moves one step later).`,
        ),
        notices: [],
        gates: [],
      },
    }
  }
  // loop-model/3 (SEMANTICS-M3.md §M3-4, D1) — with a kinds table, a finding
  // where a conserved kind is involved refuses the step the same way: nothing
  // moves, the step is not consumed, one diagnostic per finding. The run bars
  // refuse before Play with the same findings (`simStore.kindRefusals`).
  const kinds = opts.kinds ?? []
  const kindRes = kinds.length > 0 ? resolveKinds(nodes, liveEdges) : null
  if (kindRes) {
    const liveAuthored = authoredEdges.filter((e) => !modelId(e.source) && !modelId(e.target))
    const findings = refusingKindFindings(authoredNodes, liveAuthored, kinds, modelVersion, opts.time)
    if (findings.length) {
      return {
        state: { step: prev.step, values: prev.values, ended: false, fired: [], triggerQueue: prev.triggerQueue },
        report: {
          events: [], activated: [], fired: [], stateEvents: [],
          diagnostics: findings.map((f) => kindFindingText(f, authoredNodes, liveAuthored)),
          notices: [],
          gates: [],
        },
      }
    }
  }
  // loop-model/5 (§M5-4) — a `stop` table does not cover this step: the run ends
  // before it. Nothing is invented for the part of the step it does not describe.
  if (tablePlan?.endedBy) {
    return {
      state: { step: prev.step, values: prev.values, ended: true, fired: [], triggerQueue: prev.triggerQueue },
      report: {
        events: [], activated: [], fired: [], stateEvents: [], diagnostics: [], gates: [],
        notices: [{ kind: 'timetableEnded', tableId: tablePlan.endedBy.id, label: tablePlan.endedBy.label }],
      },
    }
  }
  // loop-model/2 (SEMANTICS-M2.md §M2-3): in a v2 document, resolve every
  // `@id` / malformed-`@…` flow to a `const` once, before any phase. Every
  // unresolved reference contributes 0 + one diagnostic; a resolved finite
  // value follows the identical-literal rules (§M2-3.1). Deduped per edge.
  // Shared with the panel's Gate chances (./gateChance.ts), so the two read
  // every flow alike.
  const { flowOf, paramDiagnostics } = resolveFlowExprs(byId, resEdges, modelVersion)
  const fe = (e: LoopEdge) => flowOf.get(e.id)!
  const isRandExpr = (e: LoopEdge) => {
    const k = fe(e).kind
    return k === 'range' || k === 'dice'
  }

  const outRes = new Map<string, LoopEdge[]>()
  const inRes = new Map<string, LoopEdge[]>()
  for (const e of resEdges) {
    let o = outRes.get(e.source)
    if (!o) outRes.set(e.source, (o = []))
    o.push(e)
    let i = inRes.get(e.target)
    if (!i) inRes.set(e.target, (i = []))
    i.push(e)
  }
  const outOf = (id: string) => outRes.get(id) ?? []
  const inOf = (id: string) => inRes.get(id) ?? []
  const kindOf = (id: string) => byId.get(id)?.data.kind
  const isPool = (id: string) => kindOf(id) === 'pool'
  const cmpEdge = (a: LoopEdge, b: LoopEdge) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

  const S = { ...prev.values } // snapshot — read-only
  const working: SimValues = { ...prev.values } // mutated, committed
  const taken = new Map<string, number>() // pulled OUT of a pool this step
  const reserved = new Map<string, number>() // promised INTO a pool, not yet in `working`
  const inbox = new Map<string, number>() // handed to a router by an upstream router
  const ownReserve = new Map<string, Map<string, number>>() // converterId → poolId → reserved for its own output
  const addOwn = (cid: string, pid: string, q: number) => {
    let m = ownReserve.get(cid)
    if (!m) ownReserve.set(cid, (m = new Map()))
    m.set(pid, (m.get(pid) ?? 0) + q)
  }

  const events: StepResult['report']['events'] = []
  const activated = new Set<string>()
  const fired = new Set<string>()
  const diagnostics: string[] = [...paramDiagnostics]
  const notices: StepNotice[] = [] // worded by the UI in the user's language
  const gates: GateStatus[] = [] // #477 — the committed pass's per-Gate evidence
  let ended: boolean = prev.ended // `false` here (the ended fixed point returned above)

  // A random draw / gate pick is memoised at `step()` scope so the shadow probe
  // pass (see `pullPass`) reuses the SAME result as the real pass — no extra
  // draw. Its *diagnostic* must not leak the same way: a probe rewinds
  // `diagnostics`, so a bad `range` / `dice` flow or an inert probabilistic gate
  // first seen during a probe would record then discard its reason, and the
  // committed pass would read only the cached value and never re-surface it.
  // So the reason is cached alongside the value and flushed to `diagnostics`
  // (exactly once) only when the cache is actually consumed with `emitDiag`
  // true — i.e. during the committed pass, on a path that really executes.
  let emitDiag = true // false only for the duration of a probe pullPass
  const randReason = new Map<string, string>() // edgeId → its bad-random diagnostic
  const gateInertReason = new Map<string, string>() // gateId → its inert-gate diagnostic
  const diagShown = new Set<string>() // `rand:<edgeId>` / `gate:<gateId>` already flushed
  const surfaceRandDiag = (edgeId: string) => {
    const key = `rand:${edgeId}`
    if (emitDiag && randReason.has(edgeId) && !diagShown.has(key)) {
      diagnostics.push(randReason.get(edgeId)!)
      diagShown.add(key)
    }
  }
  const surfaceGateDiag = (gateId: string) => {
    const key = `gate:${gateId}`
    if (emitDiag && gateInertReason.has(gateId) && !diagShown.has(key)) {
      diagnostics.push(gateInertReason.get(gateId)!)
      diagShown.add(key)
    }
  }

  // ── Engine B: one draw per random edge per step (SEMANTICS-B1.md §B3) ─────
  // `sampled` holds the drawn value for `range`/`dice` edges only; it is filled
  // on first touch (whether as an amount or as a weight) and reused everywhere.
  const sampled = new Map<string, number>()
  const drawnValue = (e: LoopEdge): number => {
    const hit = sampled.get(e.id)
    if (hit !== undefined) {
      surfaceRandDiag(e.id)
      return hit
    }
    const v = evalRand(fe(e), 0, 0, (purpose, i) => sample(seed, curStep, e.id, purpose, i).u, (reason) => {
      if (!randReason.has(e.id)) randReason.set(e.id, `Edge "${e.id}" ${reason}; contributes 0.`)
      surfaceRandDiag(e.id)
    })
    sampled.set(e.id, v)
    return v
  }
  /** Flow as an amount: deterministic forms exactly as Engine A; random forms
   *  from the per-step draw cache. */
  const amountOf = (e: LoopEdge, available: number, snapshot: number): number =>
    isRandExpr(e) ? drawnValue(e) : evalDet(fe(e), available, snapshot)
  // issue #396 (Lumi, 2026-10-30) — a percent on a connection that touches a
  // Converter is REFUSED: everywhere else `N%` is the amount `frac · S[source
  // Pool]` (SEMANTICS.md §8), but a Converter reads its edges as per-activation
  // rates, where a Converter's out-edge and a Converter → Converter edge have
  // no Pool to take a percent of, and reading the token as the bare fraction
  // gave "50%" two meanings. The edge contributes 0 and one diagnostic names
  // the connection and the expression; the document is never rewritten (a
  // number, 0.5 for what "50%" used to do, is the author's own change). The
  // diagnostic follows the random-flow pattern: cached per edge, flushed once,
  // and only on the committed pass.
  // issue #471 item 5 (Lumi, 2026-11-03) — `all` on such a connection is
  // refused the same way: everywhere else the token is the Pool as it stands
  // (a Gate's demand, a Drain's pull, §8), and a Converter's connection read
  // it as the rate 1 — one unit per activation, whatever the Pool held. The
  // edge contributes 0, the diagnostic names the connection and the number
  // that keeps the rate it used to mean (`1`), the document is never
  // rewritten. A Converter with no other live input or output does not run.
  const rateReason = new Map<string, string>() // edgeId → its refused-rate diagnostic
  const isRefusedRate = (e: LoopEdge): boolean => {
    const k = fe(e).kind
    return (k === 'percent' || k === 'all') && (kindOf(e.source) === 'converter' || kindOf(e.target) === 'converter')
  }
  const refusedRate = (e: LoopEdge): number => {
    const key = `rate:${e.id}`
    if (emitDiag && !diagShown.has(key)) {
      if (!rateReason.has(e.id)) {
        const raw = String((e.data as { flow?: unknown } | undefined)?.flow ?? '')
        const x = fe(e)
        rateReason.set(
          e.id,
          x.kind === 'all'
            ? `Edge "${e.id}" flow "${raw}" is \`all\` on a Converter connection; a Converter's rate cannot be \`all\` — contributes 0 (write 1 for the rate "${raw}" used to mean).`
            : `Edge "${e.id}" flow "${raw}" is a percent on a Converter connection; a Converter's rate cannot be a percent — contributes 0 (write ${(x as { frac?: number }).frac ?? 0} for the rate "${raw}" used to mean).`,
        )
      }
      diagnostics.push(rateReason.get(e.id)!)
      diagShown.add(key)
    }
    return 0
  }
  /** Flow as a weight / per-activation rate: `%`→frac, `const`→value,
   *  random→the drawn integer, `all`→1 as a Gate's split weight; a percent or
   *  `all` on a Converter connection → 0 (#396, #471 item 5). */
  const rateOfCached = (e: LoopEdge): number =>
    isRefusedRate(e) ? refusedRate(e) : isRandExpr(e) ? drawnValue(e) : rateOf(fe(e))

  // #471 Deploy 2 — a tree group's plan claims the Pool inputs of its
  // Converters at the group's FIRST router's turn (SEMANTICS.md §6 erratum,
  // part 2: the input reservation). Until that Converter's own turn the claim
  // is held here, and every other router reads the Pool net of it, as
  // `headroom` already reads a Pool net of `reserved`.
  const reservedIn = new Map<string, number>() // poolId → claimed by a planned Converter not yet at its turn
  const availOf = (id: string) => (S[id] ?? 0) - (taken.get(id) ?? 0) - (reservedIn.get(id) ?? 0)
  const reservedOf = (id: string) => reserved.get(id) ?? 0
  const headroom = (id: string) => {
    const n = byId.get(id)
    if (!n) return 0
    return cap(n) - (working[id] ?? 0) - reservedOf(id)
  }
  const takeFrom = (poolId: string, amt: number) => {
    taken.set(poolId, (taken.get(poolId) ?? 0) + amt)
    working[poolId] = (working[poolId] ?? 0) - amt
  }
  const emit = (e: LoopEdge, from: string, to: string, amount: number) => {
    if (amount > EPSILON) events.push({ edgeId: e.id, from, to, amount })
  }

  // ── Phase 0: state connections (SEMANTICS-S.md §S2) ─────────────────────
  // `trigger` (pulse + delay), `activator` (AND level gate) and `label` (numeric
  // edit on the target Pool's step-start balance) are live. A legacy `node` /
  // unrecognised mode is inert + one diagnostic per step.
  const stateEvents: StateEvent[] = []
  const stateEdgeCmp = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const KNOWN_STATE_MODES = new Set(['trigger', 'activator', 'label'])
  const stateEdges = liveEdges
    .filter((e): e is LoopEdge & { data: { kind: 'state'; mode: string; delay?: number } } => e.data?.kind === 'state')
    .sort(stateEdgeCmp)
  for (const e of stateEdges) {
    if (!KNOWN_STATE_MODES.has(e.data.mode)) {
      diagnostics.push(`State edge "${e.id}" mode "${e.data.mode}" is not supported; connection has no effect.`)
    }
  }
  const triggerEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'trigger'; delay?: number } } => e.data.mode === 'trigger',
  )

  // ── activator gate (§S4) ──────────────────────────────────────────────
  // `enabled(target)` = AND over its activator edges; empty ⇒ true. Source
  // must be a Pool; a non-Pool source or an unparseable comparison is inert +
  // diagnostic (does NOT disable the target).
  //
  // §S6 grammar (parser in ./stateExpr, shared with the Inspector) —
  // `(>=|>|<=|<|==|!=)\s*<finite real>`, whitespace-tolerant. Everything it
  // rejects — empty, operator-only, `NaN` / `±Infinity`, `+5` / `.5` / `5.` /
  // `1e3`, trailing junk — stays invalid: the edge is inert (dropped from the
  // AND) and adds exactly one diagnostic line this step.
  const cmp = (v: number, op: string, n: number): boolean => {
    switch (op) {
      case '>=': return v >= n
      case '<=': return v <= n
      case '>': return v > n
      case '<': return v < n
      case '==': return v === n
      case '!=': return v !== n
      default: return true
    }
  }
  const activatorEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'activator'; expr: string } } => e.data.mode === 'activator',
  )
  const enabledByNode = new Map<string, boolean>() // activator targets only
  for (const e of activatorEdges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      diagnostics.push(`Activator "${e.id}" connects a removed node; ignored.`)
      continue
    }
    if (!isPool(e.source)) {
      diagnostics.push(`Activator "${e.id}" needs a Pool source; ignored.`)
      continue
    }
    const rawExpr = (e.data as { expr?: string }).expr ?? ''
    const p = parseActivatorExpr(rawExpr, modelVersion)
    if (!p.ok) {
      // PA5 Class 1 — grammar-invalid `expr` (including every PA4 rejection:
      // a doubled sign, a fractional/out-of-range offset, a second reference,
      // parentheses). Unchanged from loop-state/1: inert, fail-OPEN for the
      // target — this edge never enters `enabledByNode`.
      diagnostics.push(`Activator "${e.id}" expression "${rawExpr}" ${ACT_WHY[p.reason]}; ignored.`)
      continue
    }
    // docs/parameter-activator.md §PA5 — a `param-term` RHS resolves once,
    // here, against this step's node map (never a prior step's — a Parameter
    // edit must take effect the very next step), via the SAME
    // `resolveParamRhs` the Inspector's live preview calls — one predicate,
    // so the preview can never drift from what the engine actually gates on.
    // A resolution failure (Class 2: unknown id, wrong kind, non-finite
    // value, or an overflowing `v ± offset`) is the OPPOSITE of Class 1: the
    // activator still counts — it joins the AND as `satisfied: false`,
    // fail-CLOSED, gating its target off — a syntactically valid `@id` is a
    // declared gating intent, and a broken reference must stop resource
    // movement, not silently remove the gate (PA11-D3).
    let n: number
    if (p.rhs.kind === 'literal') {
      n = p.rhs.n
    } else {
      const paramId = p.rhs.id
      const resolution = resolveParamRhs(p.rhs, (id) => {
        const node = byId.get(id)
        return node ? { kind: node.data.kind, value: (node.data as { value?: unknown }).value } : undefined
      })
      if (!resolution.ok) {
        const why =
          resolution.reason === 'unknown'
            ? `references an unknown parameter "@${paramId}"`
            : resolution.reason === 'not-param'
              ? `reference "@${paramId}" must be a parameter node (got ${resolution.kind})`
              : resolution.reason === 'non-finite'
                ? `parameter "@${paramId}" is not a finite number`
                : `parameter "@${paramId}" resolves to a non-finite threshold`
        diagnostics.push(`Activator "${e.id}" ${why}; target not gated on this comparison.`)
        const prevOk = enabledByNode.get(e.target)
        enabledByNode.set(e.target, prevOk === undefined ? false : prevOk && false)
        stateEvents.push({
          edgeId: e.id, from: e.source, to: e.target, mode: 'activator',
          effect: { kind: 'activator', satisfied: false },
        })
        continue
      }
      n = resolution.threshold
    }
    const satisfied = cmp(S[e.source] ?? 0, p.op, n)
    const prevOk = enabledByNode.get(e.target)
    enabledByNode.set(e.target, prevOk === undefined ? satisfied : prevOk && satisfied)
    stateEvents.push({
      edgeId: e.id, from: e.source, to: e.target, mode: 'activator',
      effect: { kind: 'activator', satisfied },
    })
  }
  const isEnabled = (id: string): boolean => enabledByNode.get(id) ?? true

  // Validate each trigger edge's `delay` once this step: a non-negative integer;
  // NaN / Infinity / fractional / negative → 0 + exactly one diagnostic.
  const delayByEdge = new Map<string, number>()
  for (const e of triggerEdges) {
    const raw = e.data.delay
    const d = parseDelay(raw)
    if (raw == null || d.ok) {
      delayByEdge.set(e.id, d.ok ? d.delay : 0)
    } else {
      diagnostics.push(`State edge "${e.id}" delay ${raw} is not an integer ≥ 0; treated as 0.`)
      delayByEdge.set(e.id, 0)
    }
  }

  // deliver every queue entry due this step; a delivery whose edge or target no
  // longer exists is dropped with no effect (§S8).
  const prevQueue = prev.triggerQueue ?? []
  const triggerEdgeIds = new Set(triggerEdges.map((e) => e.id))
  const triggered = new Set<string>() // targets pulsed this step
  const deliveredEdgeIds = new Set<string>()
  const carriedQueue: TriggerQueueEntry[] = []
  for (const q of prevQueue) {
    if (q.deliveryStep > curStep) {
      carriedQueue.push(q)
      continue
    }
    // due (== curStep) or stale (< curStep, shouldn't happen) — consumed either way
    if (q.deliveryStep < curStep) {
      diagnostics.push(`Dropped a stale queued trigger (edge "${q.edgeId}", due ${q.deliveryStep}).`)
      continue
    }
    if (triggerEdgeIds.has(q.edgeId) && byId.has(q.target)) {
      triggered.add(q.target)
      deliveredEdgeIds.add(q.edgeId)
    } else {
      diagnostics.push(`Dropped a queued trigger for a removed edge / node (edge "${q.edgeId}").`)
    }
  }

  // loop-model/1: `parameter` / `register` nodes have no `activation` and never
  // fire — the engine ignores them entirely (SEMANTICS-M.md §M6.1).
  const actOf = (n: { data: LoopNode['data'] }): Activation =>
    n.data && typeof n.data === 'object' && 'activation' in n.data ? n.data.activation : 'passive'

  const firing = (n: LoopNode) =>
    isEnabled(n.id) &&
    (actOf(n) === 'automatic' ||
      (actOf(n) === 'onStart' && prev.step === 0) ||
      (TRIGGERABLE.has(actOf(n)) && triggered.has(n.id)))

  const sumInRate = (id: string) => inOf(id).reduce((s, e) => s + rateOfCached(e), 0)

  const cmpId = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const isProbGate = (n: LoopNode | undefined) =>
    n?.data.kind === 'gate' && n.data.distribution === 'probabilistic'

  // ── label modifier — end of Phase 0 ─────────────────────────────────
  // Value semantics: loop-state/1 §S5. A numeric edit on the target Pool's
  // step-start balance (`working[target]`, seeded from `S[target]`). Source AND
  // target must be Pools. `expr` is one of `+N -N =N +S -S =S` (N a finite real
  // ≥ 0, whitespace tolerated; `S` = the literal token for `S[source]`). A
  // non-Pool endpoint, a removed node, an empty or unparseable `expr` ⇒ inert +
  // exactly one diagnostic this step. Several edges into one target apply in
  // ascending `edge.id` to the running value; intermediate out-of-range values
  // are allowed. Then ONE clamp per target: `[0, capacity]`, or floor-0 only
  // when the Pool is uncapped. Grammar parser in ./stateExpr (shared with the
  // Inspector).
  //
  // Reporting: loop-state/2 §S2-9 (SEMANTICS-S2.md). Each edge's `delta` is its
  // OWN raw requested change — the clamp is never folded into a per-edge figure
  // (that could invert an edge's apparent direction). The single per-target
  // clamp correction is reported once as `clampAdjustment` on the last label
  // event into that target. Net external change on the target =
  // `Σ delta + clampAdjustment = final − start`; this is I1′'s explicit term.
  // `label` never touches `report.events`, never schedules
  // a trigger, and never sets `ended`.
  const labelEdges = stateEdges.filter(
    (e): e is LoopEdge & { data: { kind: 'state'; mode: 'label'; expr: string } } => e.data.mode === 'label',
  )
  // CSU / loop-state/3 (SEMANTICS-S3.md) — a `label` may run `timing:
  // "afterPull"` (Phase 2.5, after the pull, gated by `when`) instead of the
  // default unconditional Phase 0. Split validation happens here, once, in
  // `labelEdges`' existing ascending-`edge.id` order; `pendingAfterPull` is
  // consumed after Phase 2 (see below). `timing`/`when` are validated
  // fail-closed (CSU3-5): an edge whose declared intent cannot be honoured is
  // fully inert — it NEVER falls back to running as a plain Phase-0 label.
  const pendingAfterPull: { e: LoopEdge; op: '+' | '-' | '='; n: number }[] = []
  const pendingPhase0: { e: LoopEdge; op: '+' | '-' | '='; token: 'N' | 'S'; n: number }[] = []
  for (const e of labelEdges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      diagnostics.push(`Label "${e.id}" connects a removed node; ignored.`)
      continue
    }
    const rawTiming = (e.data as { timing?: unknown }).timing
    const timingParse = parseLabelTiming(rawTiming)
    if (!timingParse.ok) {
      diagnostics.push(`Label "${e.id}" timing "${rawTiming}" is not supported; ignored.`)
      continue
    }
    const rawWhen = (e.data as { when?: unknown }).when
    if (timingParse.timing === 'phase0') {
      // fail-closed (CSU3-5): a `when` on a `phase0` label is never silently
      // dropped in favour of running unconditionally — the whole edge is inert.
      if (rawWhen !== undefined) {
        diagnostics.push(`Label "${e.id}" has a "when" but is not timing: "afterPull"; ignored.`)
        continue
      }
      if (!isPool(e.source)) {
        diagnostics.push(`Label "${e.id}" needs a Pool source; ignored.`)
        continue
      }
      if (!isPool(e.target)) {
        diagnostics.push(`Label "${e.id}" needs a Pool target; ignored.`)
        continue
      }
      const raw = (e.data as { expr?: string }).expr ?? ''
      const p = parseLabelExpr(raw)
      if (!p.ok) {
        diagnostics.push(`Label "${e.id}" expression "${raw}" ${LABEL_WHY[p.reason]}; ignored.`)
        continue
      }
      pendingPhase0.push({ e, op: p.op, token: p.token, n: p.n })
      continue
    }
    // timing === 'afterPull'
    if (rawWhen === undefined) {
      diagnostics.push(`Label "${e.id}" (timing: "afterPull") needs when: "source-fired"; ignored.`)
      continue
    }
    const whenParse = parseLabelWhen(rawWhen)
    if (!whenParse.ok) {
      diagnostics.push(`Label "${e.id}" when "${rawWhen}" is not supported; ignored.`)
      continue
    }
    const srcKind = kindOf(e.source)
    if (!srcKind || !ROUTER_KINDS.has(srcKind)) {
      diagnostics.push(
        `Label "${e.id}" (timing: "afterPull") needs a Gate / Converter / Drain / End source; ignored.`,
      )
      continue
    }
    if (!isPool(e.target)) {
      diagnostics.push(`Label "${e.id}" needs a Pool target; ignored.`)
      continue
    }
    const raw = (e.data as { expr?: string }).expr ?? ''
    const p = parseLabelExpr(raw)
    if (!p.ok) {
      diagnostics.push(`Label "${e.id}" expression "${raw}" ${LABEL_WHY[p.reason]}; ignored.`)
      continue
    }
    if (p.token === 'S') {
      diagnostics.push(`Label "${e.id}" (timing: "afterPull") cannot read S; use a numeric literal; ignored.`)
      continue
    }
    pendingAfterPull.push({ e, op: p.op, n: p.n })
  }
  const labelTargets = new Set<string>()
  const labelApplied: { e: LoopEdge; delta: number }[] = []
  for (const item of pendingPhase0) {
    const e = item.e
    const operand = item.token === 'S' ? S[e.source] ?? 0 : item.n
    const running = working[e.target] ?? 0
    const delta = item.op === '+' ? operand : item.op === '-' ? -operand : operand - running
    working[e.target] = running + delta
    labelTargets.add(e.target)
    labelApplied.push({ e, delta })
  }
  // one clamp per target, after every label edge across all targets; record the
  // correction (clamped − unclamped) so it can be reported once, un-attributed.
  const clampAdjByTarget = new Map<string, number>()
  for (const tid of labelTargets) {
    const unclamped = working[tid] ?? 0
    const clamped = Math.min(cap(byId.get(tid)!), Math.max(0, unclamped))
    working[tid] = clamped
    clampAdjByTarget.set(tid, nz(clamped - unclamped))
  }
  // one label event per valid edge, ascending edge.id; `delta` is the edge's own
  // raw request, `clampAdjustment` rides on the last event into each target.
  const lastLabelIdx = new Map<string, number>()
  labelApplied.forEach((r, i) => lastLabelIdx.set(r.e.target, i))
  labelApplied.forEach((r, i) => {
    stateEvents.push({
      edgeId: r.e.id,
      from: r.e.source,
      to: r.e.target,
      mode: 'label',
      effect: {
        kind: 'label',
        delta: r.delta,
        clampAdjustment: lastLabelIdx.get(r.e.target) === i ? clampAdjByTarget.get(r.e.target) ?? 0 : 0,
      },
    })
  })

  // ── Phase 1: push ────────────────────────────────────────────────────────
  const sources = nodes
    .filter((n) => n.data.kind === 'source' && firing(n))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const src of sources) {
    activated.add(src.id)
    const outs = outOf(src.id)
    const plan = outs.map((e) => {
      // a Source edge has no source pool → available / snapshot are 0; `all` and
      // `%` stay 0 there, but `range` / `dice` now draw (SEMANTICS-B1.md §B2.1)
      return { e, want: amountOf(e, 0, 0), pool: isPool(e.target) }
    })
    const pushAll = src.data.kind === 'source' && src.data.mode === 'pushAll'
    if (pushAll) {
      // issue #419 item 2 — a push-all Source with a non-Pool target used to
      // `continue` here in silence: the atomic check failed on that edge before
      // the per-edge loop below could report it, so the Source moved nothing on
      // ANY of its edges and said nothing. Report each such edge (a Source →
      // Drain / Gate / Converter / End line is drawable); the amount stays 0.
      for (const p of plan) {
        if (p.pool) continue
        const t = byId.get(p.e.target)
        diagnostics.push(
          `Edge "${p.e.id}" from Source "${src.data.label}" goes to ${t?.data.kind ?? 'a missing node'} "${t?.data.label ?? p.e.target}", not a Pool; a push-all Source moves nothing while one of its targets is not a Pool.`,
        )
      }
      if (!plan.every((p) => p.pool && headroom(p.e.target) >= p.want - EPSILON)) {
        continue // atomic: nothing
      }
    }
    let did = 0
    for (const p of plan) {
      if (!p.pool) {
        diagnostics.push(`Source "${src.data.label}" pushes to a non-Pool; ignored in Engine A.`)
        continue
      }
      const h = headroom(p.e.target)
      const moved = nz(Math.max(0, Math.min(p.want, h)))
      if (moved > 0) {
        working[p.e.target] = (working[p.e.target] ?? 0) + moved
        did += moved
        emit(p.e, src.id, p.e.target, moved)
      }
    }
    if (did > EPSILON) fired.add(src.id)
  }

  // ── Phase 2: pull over the router DAG ────────────────────────────────────
  const routers = nodes.filter((n) => firing(n) && ROUTER_KINDS.has(n.data.kind))
  const dead = new Set<string>() // edge ids on a router-only cycle
  // a resource edge into a disabled router is inert — the upstream keeps the
  // resource (§S4). This is kept SEPARATE from `dead`: a *deterministic* gate /
  // converter re-splits its output over the still-active branches (allowed —
  // conservation holds), but a *probabilistic* gate must keep its full branch
  // set for the `gate-route` draw (frozen loop-rng/1 no-spill / no-reroll). A
  // probabilistic pick that lands on a disabled branch simply accepts 0, so the
  // resource stays upstream — no redraw, no re-normalised weights.
  // The same rule holds for a router that does not FIRE this step for any
  // other reason (`passive` / `interactive` without a pulse, `onStart` after
  // step 1): it is not in `order`, so an inbox handed to it would never be
  // consumed and the amount would vanish (issue #388 A — reproduced with a
  // passive Gate downstream of a Gate: the share left the source Pool and
  // reached nothing, reported as fired, no diagnostic).
  const willFire = new Set(routers.map((r) => r.id))
  const disabledInto = new Set<string>()
  for (const e of resEdges) {
    const k = kindOf(e.target)
    if (k && ROUTER_KINDS.has(k) && !willFire.has(e.target)) disabledInto.add(e.id)
  }
  // deterministic routing / accept / reserve skip both a dead branch and a
  // branch into a disabled router; `pickBranch` (probabilistic) skips only `dead`.
  const skipDet = (id: string): boolean => dead.has(id) || disabledInto.has(id)

  // Kahn topological sort of router→router edges, ascending-id tiebreak
  // (./gateChance.ts `routerOrder`, shared with the panel's Gate chances)
  const { order, cyclic } = routerOrder(
    routers.map((r) => r.id),
    resEdges,
  )
  if (cyclic.length) {
    for (const e of resEdges) {
      if (cyclic.includes(e.source) || cyclic.includes(e.target)) dead.add(e.id)
    }
    order.push(...cyclic.sort())
    diagnostics.push(
      `${cyclic.length} router node(s) form a zero-storage cycle; those connections are inactive (a loop must contain a Pool).`,
    )
  }

  // Probabilistic Gate branch selection — one `gate-route` draw per gate per
  // step (SEMANTICS-B1.md §B4). Memoised so `accept()` and execution agree (I10).
  const gatePick = new Map<string, LoopEdge | null>()
  const pickBranch = (g: LoopNode): LoopEdge | null => {
    const memo = gatePick.get(g.id)
    if (memo !== undefined) {
      if (memo === null) surfaceGateDiag(g.id)
      return memo
    }
    const outs = outOf(g.id)
      .filter((e) => !dead.has(e.id))
      .sort(cmpId) // canonical order: edge.id ascending (§B4.2)
    const weights = outs.map((e) => rateOfCached(e))
    const idx = categorical(weights, sample(seed, curStep, g.id, 'gate-route', 0).u)
    if (idx < 0) {
      if (!gateInertReason.has(g.id)) {
        gateInertReason.set(
          g.id,
          weights.some((w) => !Number.isFinite(w) || w < 0)
            ? `Probabilistic gate "${g.data.label}": invalid branch weight; gate is inert this step.`
            : `Probabilistic gate "${g.data.label}": no positive branch weight; gate is inert this step.`,
        )
      }
      surfaceGateDiag(g.id)
      gatePick.set(g.id, null)
      return null
    }
    gatePick.set(g.id, outs[idx])
    return outs[idx]
  }

  // `pullAll` Converters proven unfillable by the probe pass (see `pullPass`).
  // Rebuilt each iteration of the feasibility fixpoint; empty for the common
  // no-`pullAll`-Converter graph, so behaviour there is byte-identical.
  let disabledPullAll = new Set<string>()

  // #492 (SEMANTICS.md §6 erratum, part 5) — a plain tree of routers, outside
  // every group, can reach one Pool by two paths. `accept` bounds each branch on
  // its own, so each read the Pool's whole room: the router at the root sent
  // more than the Pool could take, its reservations passed the room, and the
  // Gates below were handed what they could not deliver. `branches` is what the
  // router sends into each of its targets per unit it moves; this follows them
  // through the firing Gates below and returns the largest number of units that
  // fits every Pool reached by two or more paths: its room, plus what those
  // Gates (and `own`) already hold there, over its path-summed share. A
  // Converter's `takes` come off the share: what it takes from a Pool in the
  // same activation is room it may fill. A Pool reached by one path is left to
  // `accept`, whose arithmetic stays as it was. (A pick is memoised, so reading
  // a probabilistic Gate's branch here makes no extra draw.)
  const sharedPoolBound = (branches: Map<string, number>, own?: Map<string, number>, takes?: Map<string, number>): number => {
    const share = new Map<string, number>()
    const paths = new Map<string, number>()
    const held = new Map<string, number>(own)
    const follow = (target: string, c: number) => {
      if (isPool(target)) {
        share.set(target, (share.get(target) ?? 0) + c)
        paths.set(target, (paths.get(target) ?? 0) + 1)
        return
      }
      // any other router or terminal bounds its branch through `accept`
      if (kindOf(target) !== 'gate' || !willFire.has(target)) return
      for (const [q, a] of ownReserve.get(target) ?? []) held.set(q, (held.get(q) ?? 0) + a)
      const g = byId.get(target)!
      if (isProbGate(g)) {
        const sel = pickBranch(g)
        if (sel && !skipDet(sel.id)) follow(sel.target, c)
        return
      }
      const outs = outOf(target).filter((e) => !skipDet(e.id))
      const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
      if (sumW <= EPSILON) return
      const wInto = new Map<string, number>() // two connections into one target are one path
      for (const e of outs) {
        const w = rateOfCached(e)
        if (w > EPSILON) wInto.set(e.target, (wInto.get(e.target) ?? 0) + w)
      }
      for (const [t, w] of wInto) follow(t, (c * w) / sumW)
    }
    for (const [t, c] of branches) follow(t, c)
    let bound = Infinity
    for (const [q, n] of paths) {
      if (n < 2) continue
      const net = (share.get(q) ?? 0) - (takes?.get(q) ?? 0)
      if (net > EPSILON) bound = Math.min(bound, Math.max(0, headroom(q) + (held.get(q) ?? 0)) / net)
    }
    return bound
  }

  // `accept(id)` — max the node can take on its input side, live. Memo is valid
  // only while `working`/`reserved` are stable, so it is rebuilt per router turn.
  const makeAccept = () => {
    const memo = new Map<string, number>()

    const accept = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!
      const k = kindOf(id)
      let v: number
      // a router that does not fire this step is inert — like a zero-weight
      // branch (§S4; disabled by an activator, or not firing — #388 A)
      if (k && ROUTER_KINDS.has(k) && !willFire.has(id)) v = 0
      else if (k === 'pool') v = Math.max(0, headroom(id))
      else if (k === 'drain' || k === 'end') v = Infinity
      else if (k === 'converter') {
        // SEMANTICS.md §9 — a `pullAll` Converter is all-or-nothing. The probe
        // pass has already decided which ones cannot reach f = 1 this step; an
        // upstream router must route NOTHING into those (§11 / I5). Checked
        // before reading any input edge so a disabled Converter's edges are not
        // even evaluated on the committed pass.
        if (disabledPullAll.has(id)) {
          memo.set(id, 0)
          return 0
        }
        const sumIn = sumInRate(id)
        // #388 D — a Converter with no LIVE output cannot run: with every
        // branch skipped (dead, or into a router that does not fire) it must
        // accept 0, or it pulls its inputs and has nowhere to deliver them.
        // #471 (V3r) — two outputs into one target share what it can take:
        // the bound is per TARGET, `accept(target) / Σ rate into it`. Per
        // connection, each of two outputs into one Gate saw the Gate's whole
        // accept, and the Gate was handed more than it could deliver.
        let fmax = 1
        const makeInto = new Map<string, number>()
        for (const e of outOf(id)) {
          if (skipDet(e.id)) continue
          const r = rateOfCached(e)
          if (r <= EPSILON) continue
          makeInto.set(e.target, (makeInto.get(e.target) ?? 0) + r)
        }
        for (const [target, make] of makeInto) fmax = Math.min(fmax, accept(target) / make)
        if (makeInto.size === 0) fmax = 0
        v = Math.max(0, Math.min(1, fmax)) * sumIn
      } else if (k === 'gate') {
        // #388 B — a Gate fed by an upstream router has a reservation standing
        // in its target Pool(s) on ITS behalf (`planReserve`). Its own accept
        // must credit that back, exactly as a Converter's does (`back` below),
        // or the delivery it is about to make counts against it and T comes
        // out 0: the inbox was already pulled from the source Pool and is lost.
        const own = ownReserve.get(id)
        const acceptInto = (target: string): number =>
          isPool(target) ? Math.max(0, headroom(target) + (own?.get(target) ?? 0)) : accept(target)
        if (isProbGate(byId.get(id))) {
          // one live branch of effective weight 1 (§B4.4)
          const sel = pickBranch(byId.get(id)!)
          v = sel ? acceptInto(sel.target) : 0
        } else {
          const outs = outOf(id).filter((e) => !skipDet(e.id))
          const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
          if (sumW <= EPSILON) v = 0
          else {
            // #471 (V3g) — two branches into one Pool share its room: the
            // bound is per target, `acceptInto(target) · sumW / Σ w into it`.
            // Per branch, each saw the Pool's whole room, the Gate sent twice
            // it, and the commit clamp cut the excess unreported.
            const wInto = new Map<string, number>()
            for (const e of outs) {
              const w = rateOfCached(e)
              if (w <= EPSILON) continue
              wInto.set(e.target, (wInto.get(e.target) ?? 0) + w)
            }
            v = Infinity
            for (const [target, w] of wInto) v = Math.min(v, acceptInto(target) * (sumW / w))
            // #492 — a Pool reached through the Gates below by two paths
            const shares = new Map<string, number>()
            for (const [target, w] of wInto) shares.set(target, w / sumW)
            v = Math.min(v, sharedPoolBound(shares, own))
          }
        }
      } else v = 0
      memo.set(id, v)
      return v
    }
    return accept
  }

  /** Reserve the pool headroom that `amountIn` arriving at `destId` will consume downstream. */
  const planReserve = (destId: string, amountIn: number) => {
    const k = kindOf(destId)
    if (k === 'converter') {
      const sumIn = sumInRate(destId)
      const f = sumIn > EPSILON ? Math.min(1, amountIn / sumIn) : 0
      for (const e of outOf(destId)) {
        if (skipDet(e.id)) continue
        const q = nz(f * rateOfCached(e))
        if (q <= 0) continue
        if (isPool(e.target)) {
          reserved.set(e.target, reservedOf(e.target) + q)
          addOwn(destId, e.target, q)
        } else planReserve(e.target, q)
      }
    } else if (k === 'gate') {
      if (isProbGate(byId.get(destId))) {
        // a probabilistic gate routes the whole amount down its one live branch;
        // if the draw landed on a disabled-router branch it reserves nothing and
        // the resource stays upstream (no redraw — frozen loop-rng/1).
        const sel = pickBranch(byId.get(destId)!)
        if (sel && !skipDet(sel.id)) {
          if (isPool(sel.target)) {
            reserved.set(sel.target, reservedOf(sel.target) + nz(amountIn))
            addOwn(destId, sel.target, nz(amountIn)) // #388 B — the Gate's own, credited back in accept and settled on delivery
          } else planReserve(sel.target, nz(amountIn))
        }
        return
      }
      const outs = outOf(destId).filter((e) => !skipDet(e.id))
      const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
      for (const e of outs) {
        const share = sumW > EPSILON ? nz((amountIn * rateOfCached(e)) / sumW) : 0
        if (share <= 0) continue
        if (isPool(e.target)) {
          reserved.set(e.target, reservedOf(e.target) + share)
          addOwn(destId, e.target, share) // #388 B
        } else planReserve(e.target, share)
      }
    }
    // drain / end / pool: nothing further to reserve
  }

  // ── Phase 2 as a re-runnable pass ───────────────────────────────────────
  // `pullPass` walks the canonical router `order` exactly once. With
  // `commit = false` it is a *probe*: every mutation lands on a shadow copy of
  // `working` / `taken` / `reserved` / `inbox` / `ownReserve` / `activated` /
  // `fired`, `events` / `diagnostics` are rewound, `ended` is restored, and the
  // set of `pullAll` Converters that could not reach f = 1 is returned. The
  // probabilistic branch picks (`gatePick`) and random-flow draws (`sampled`)
  // are memoised at `step()` scope, so a probe reuses the SAME results as the
  // real pass — no extra draws; `emitDiag = false` keeps a probe from
  // publishing a diagnostic (`surfaceRandDiag` / `surfaceGateDiag` flush it on
  // the committed pass instead). `disabledPullAll` (closed over by
  // `makeAccept`) selects which `pullAll` Converters are non-accepting.
  const cloneOwn = (m: Map<string, Map<string, number>>) =>
    new Map([...m].map(([k, v]) => [k, new Map(v)]))
  const pullPass = (commit: boolean): Set<string> => {
    const pullShort = new Set<string>()
    const prevEmitDiag = emitDiag
    emitDiag = commit
    const snap = commit
      ? null
      : {
          working: { ...working },
          taken: new Map(taken),
          reserved: new Map(reserved),
          reservedIn: new Map(reservedIn),
          inbox: new Map(inbox),
          ownReserve: cloneOwn(ownReserve),
          activated: new Set(activated),
          fired: new Set(fired),
          eventsLen: events.length,
          diagLen: diagnostics.length,
          ended,
        }

    // ── #471 Deploy 2 — Converter groups and the joint plan ─────────────────
    // (SEMANTICS.md §6 erratum, part 2.) The connections that carry something
    // THIS step: a router → router connection is live when both ends fire, it
    // is not dead, its source is not a disabled `pull all` Converter (its
    // flows are never read on the committed pass), it is the picked branch of
    // a probabilistic Gate, and its rate is positive; a Pool → router
    // connection is live when the router fires. Over those, `converterGroups`
    // finds every group with a router-fed Converter and classes it: a TREE is
    // planned as one at the turn of its first router in `order` (one free
    // number `s`; every member's amount is a fixed multiple of it); a MULTI
    // group (a Gate with two supplies) is planned at the same turn by filling
    // the Gates' supplies one after the other at a fixed priority (#476,
    // `planMulti` below), two such Gates meeting at one Converter included.
    // A split that rejoins was refused at the top of `step` when the group has
    // a Converter; a group of Gates only that rejoins is a multi group (#471).
    const liveEdge = (e: LoopEdge): boolean => {
      if (dead.has(e.id)) return false
      const sk = kindOf(e.source)
      const tk = kindOf(e.target)
      if (tk && ROUTER_KINDS.has(tk) && !willFire.has(e.target)) return false
      if (sk && ROUTER_KINDS.has(sk) && !willFire.has(e.source)) return false
      if (sk === 'converter' && disabledPullAll.has(e.source)) return false
      if (sk === 'pool') return true
      if (!(tk && ROUTER_KINDS.has(tk))) return true
      if (sk === 'gate' && isProbGate(byId.get(e.source))) return pickBranch(byId.get(e.source)!) === e
      return rateOfCached(e) > EPSILON
    }
    const orderIdx = new Map(order.map((id, i) => [id, i]))
    const treeAtRoot = new Map<string, string[]>() // root id → the group's members
    const multiAtRoot = new Map<string, { members: string[]; multiGates: string[]; rejoin: boolean }>() // #476 — root id → the multi group (#471 part 4: a Gate-only split that rejoins is one)
    for (const g of converterGroups(nodes, resEdges, liveEdge)) {
      // with a Converter: refused at the top of `step`. Gates only (#471,
      // erratum part 4): the join has two supplies, so the group is a multi
      // group — the cut at the join's inputs leaves trees, and the join's two
      // supplies from one piece sum that piece's paths
      if (g.cls === 'split-rejoin' && g.hasConverter) continue
      const root = g.members.reduce((a, b) => ((orderIdx.get(b) ?? Infinity) < (orderIdx.get(a) ?? Infinity) ? b : a))
      if (g.cls === 'tree') treeAtRoot.set(root, g.members)
      else multiAtRoot.set(root, { members: g.members, multiGates: g.multiGates, rejoin: g.cls === 'split-rejoin' })
    }
    const planned = new Set<string>() // members of a planned group
    const planF = new Map<string, number>() // Converter member → its run fraction
    const planT = new Map<string, number>() // Gate member → its throughput
    const planTakes = new Map<string, { e: LoopEdge; a: number }[]>() // Converter member → its Pool takes
    const planPulls = new Map<string, { e: LoopEdge; a: number }[]>() // #476 — multi-supply Gate → its own-Pool takes
    const liveOuts = (id: string): LoopEdge[] => {
      const n = byId.get(id)!
      if (isProbGate(n)) {
        const sel = pickBranch(n)
        return sel && !skipDet(sel.id) ? [sel] : []
      }
      return outOf(id).filter((e) => !skipDet(e.id))
    }
    const modeOfRouter = (id: string) => ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny')

    // ── #477 — a Gate's execution evidence (`GateStatus`, types.ts) ─────────
    // The design is the QA record gate-state-design.md rev 2 (Lumi,
    // 2026-11-02). `demand` / `available` are PLAN-FREE: read at the router's
    // own turn — or at its group's plan, before the plan claims anything —
    // from rates and what its inputs hold THEN, upstream first. A router input
    // is the upstream's number propagated through its share, never what the
    // plan delivered (the inbox IS the plan's limit: read as demand it made
    // every Gate the plan cut look `full`). Memoised per pass; a probe pass
    // computes and discards.
    type Nums = { demand: number; available: number; ownWant: number; ownAvail: number }
    const routerNums = new Map<string, Nums>()
    /** what router `up` sends on `e` when it runs at `x` */
    const sendOf = (up: string, e: LoopEdge, x: number): number => {
      if (kindOf(up) === 'gate') {
        if (isProbGate(byId.get(up))) return pickBranch(byId.get(up)!) === e ? x : 0
        const outs = outOf(up).filter((o) => !skipDet(o.id))
        const Wsum = outs.reduce((s, o) => s + rateOfCached(o), 0)
        return Wsum > EPSILON ? (x * rateOfCached(e)) / Wsum : 0
      }
      const sumIn = sumInRate(up)
      return Math.min(1, sumIn > EPSILON ? x / sumIn : 0) * rateOfCached(e)
    }
    const numsOf = (id: string): Nums => {
      const hit = routerNums.get(id)
      if (hit) return hit
      const v: Nums = { demand: 0, available: 0, ownWant: 0, ownAvail: 0 }
      for (const e of inOf(id)) {
        if (dead.has(e.id)) continue
        const src = e.source
        if (isPool(src)) {
          const want = Math.max(0, amountOf(e, availOf(src), S[src] ?? 0))
          const have = Math.min(want, Math.max(0, availOf(src)))
          v.demand += want
          v.available += have
          v.ownWant += want
          v.ownAvail += have
        } else if (willFire.has(src) && !(kindOf(src) === 'converter' && disabledPullAll.has(src))) {
          const up = numsOf(src)
          v.demand += sendOf(src, e, up.demand)
          v.available += sendOf(src, e, up.available)
        }
      }
      routerNums.set(id, v)
      return v
    }
    const gateEntries = new Map<string, GateStatus>()
    const planZeroWhy = new Map<string, 'pullAll' | 'plan'>() // a planned Gate that moves nothing, by the plan's cause
    const cyclicSet = new Set(cyclic)
    const r6 = (x: number) => Number(x.toFixed(6))
    /** the Gate's verdict, recorded at the point that decided what it moved */
    const recordGate = (id: string, moved: number, fault?: 'inert' | 'cycle') => {
      const { demand, available, ownWant, ownAvail } = numsOf(id)
      let state: GateStatus['state']
      let why: GateStatus['why']
      if (fault) {
        state = 'fault'
        why = fault
      } else if (available <= 1e-6) state = 'idle'
      else if (moved >= demand - 1e-6) state = 'full'
      else if (moved <= 1e-6) {
        // at the reported precision (6 decimals): a bisection against a
        // disabled `pull all` Converter can leave a residual of ~1e-8
        state = 'held'
        why = planZeroWhy.get(id) ?? (modeOfRouter(id) === 'pullAll' && ownAvail < ownWant - 1e-6 ? 'pullAll' : 'room')
      } else {
        state = 'partial'
        why = moved < available - 1e-6 ? 'room' : ownAvail < ownWant - 1e-6 ? 'supply' : 'upstream'
      }
      const entry: GateStatus = { nodeId: id, state, demand: r6(demand), available: r6(available), moved: r6(moved) }
      if (why) entry.why = why
      gateEntries.set(id, entry)
    }

    /** what a group's plan reads of its members: a Gate's live branches and
     *  their weights, a Converter's live outputs and Pool needs, and the live
     *  router → router connections summed per pair (shared by the tree plan
     *  and the multi-supply plan) */
    const memberShapes = (members: string[]) => {
      const inGroup = new Set(members)
      const W = new Map<string, number>() // Gate → Σ rate over its live branches
      const gateInto = new Map<string, Map<string, number>>() // Gate → target → Σ rate
      const convMake = new Map<string, Map<string, number>>() // Converter → target → Σ rate
      const convNeed = new Map<string, Map<string, number>>() // Converter → source Pool → Σ rate
      const convPoolIns = new Map<string, LoopEdge[]>()
      for (const m of members) {
        const into = new Map<string, number>()
        let sum = 0
        for (const e of liveOuts(m)) {
          const r = rateOfCached(e)
          if (r <= EPSILON) continue
          sum += r
          into.set(e.target, (into.get(e.target) ?? 0) + r)
        }
        if (kindOf(m) === 'gate') {
          W.set(m, sum)
          gateInto.set(m, into)
        } else {
          convMake.set(m, into)
          const ins = inOf(m).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
          convPoolIns.set(m, ins)
          const need = new Map<string, number>()
          for (const e of ins) {
            const r = rateOfCached(e)
            if (r <= EPSILON) continue
            need.set(e.source, (need.get(e.source) ?? 0) + r)
          }
          convNeed.set(m, need)
        }
      }
      // the router → router connections inside the group, summed per pair
      const pair = new Map<string, number>()
      const fedByRouter = new Set<string>()
      for (const e of resEdges) {
        if (!inGroup.has(e.source) || !inGroup.has(e.target) || !liveEdge(e)) continue
        const key = `${e.source}\u0000${e.target}`
        pair.set(key, (pair.get(key) ?? 0) + rateOfCached(e))
        fedByRouter.add(e.target)
      }
      return { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter }
    }
    /** a Pool-fed Gate's own inputs this step, in pull order */
    const ownIns = (id: string) => inOf(id).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
    const planGroup = (members: string[]) => {
      const cof = new Map<string, number>() // member → its amount per unit of s (a Converter's f, a Gate's T)
      const { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter } = memberShapes(members)
      // coefficients by traversal from the root (c = 1), in either direction:
      // Gate g → X scales by the branch share `w / W`; into a Converter the
      // share is divided by that connection's rate (what one run consumes);
      // Converter C → X scales by its rate on the connection; into a Gate the
      // whole amount arrives. So the factor source → target is
      // (source a Gate ? 1 / W : 1) · (target a Gate ? w : 1).
      const root = members.reduce((a, b) => ((orderIdx.get(b) ?? Infinity) < (orderIdx.get(a) ?? Infinity) ? b : a))
      cof.set(root, 1)
      for (let changed = true; changed && cof.size < members.length; ) {
        changed = false
        for (const [key, w] of pair) {
          const [u, v] = key.split('\u0000')
          const hasU = cof.has(u)
          const hasV = cof.has(v)
          if (hasU === hasV) continue
          const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
          if (Wu <= EPSILON) continue
          const F = (1 / Wu) * (kindOf(v) === 'gate' ? w : 1)
          if (hasU) cof.set(v, cof.get(u)! * F)
          else cof.set(u, cof.get(v)! / F)
          changed = true
        }
      }
      // the bounds — s is the smallest of them
      let sMax = Infinity
      const bound = (v: number) => {
        if (v < sMax) sMax = v
      }
      const inNeed = new Map<string, number>() // Pool → Σ c_C · need
      const outCoef = new Map<string, number>() // Pool → Σ c · amount delivered per unit of s
      for (const m of members) {
        const c = cof.get(m) ?? 0
        if (kindOf(m) === 'gate') {
          if ((W.get(m) ?? 0) <= EPSILON) bound(0) // no live branch — delivers nothing (#388 D)
          const Wm = W.get(m) ?? 1
          for (const [q, w] of gateInto.get(m)!) if (isPool(q)) outCoef.set(q, (outCoef.get(q) ?? 0) + (c * w) / Wm)
          continue
        }
        if (disabledPullAll.has(m)) bound(0) // an upstream router routes nothing into it (§11 / I5)
        if (c > EPSILON) bound(runOf(m) / c) // f ≤ the target ≤ 1
        if (convMake.get(m)!.size === 0) bound(0) // no live output, no run (#388 D)
        // a router input that delivers nothing this step (its router does not
        // fire, the connection is dead, a probabilistic Gate picked another
        // branch, a disabled `pull all` Converter): one f on every connection
        // is 0, for the whole group
        if (inOf(m).some((e) => !isPool(e.source) && !liveEdge(e) && rateOfCached(e) > EPSILON)) bound(0)
        const need = convNeed.get(m)!
        for (const [p, r] of need) inNeed.set(p, (inNeed.get(p) ?? 0) + c * r)
        for (const [q, make] of convMake.get(m)!) if (isPool(q)) outCoef.set(q, (outCoef.get(q) ?? 0) + c * make)
      }
      for (const [p, k] of inNeed) if (k > EPSILON) bound(Math.max(0, availOf(p)) / k)
      // #471 item 5 (Lumi, 2026-11-03) — a Pool's room is checked ALONG THE
      // GROUP'S COMMIT ORDER, not on the members' total: from the Pool as it
      // stands, each member's take lowers the level at its turn and each
      // member's delivery raises it, and the plan must keep the level within
      // the capacity at every point. A Converter takes and makes inside one
      // activation, so a Pool it both takes from and makes into is bounded on
      // its net; a take by an EARLIER member (the source Gate, an upstream
      // Converter) is room a later member's delivery may fill; a take by a
      // later member is not. With a source Gate's take on such a Pool the
      // level is not linear in `s` (its pulls are greedy and capped), so the
      // bound is found by bisection on the same walk.
      const roomOf = (q: string) => {
        let room = headroom(q)
        for (const m of members) room += ownReserve.get(m)?.get(q) ?? 0
        return Math.max(0, room)
      }
      const inOrder = [...members].sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity))
      const sourceGate = inOrder.find((m) => kindOf(m) === 'gate' && !fedByRouter.has(m))
      const gateWants = sourceGate
        ? inOf(sourceGate)
            .filter((e) => isPool(e.source) && !dead.has(e.id))
            .sort(cmpEdge)
            .map((e) => ({ e, want: amountOf(e, availOf(e.source), S[e.source] ?? 0) }))
        : []
      /** the source Gate's greedy pulls at the plan number `s`, per Pool (the commit's own order) */
      const gateTakes = (s: number): Map<string, number> => {
        const took = new Map<string, number>()
        if (!sourceGate) return took
        let need = (cof.get(sourceGate) ?? 0) * s - (inbox.get(sourceGate) ?? 0)
        for (const w of gateWants) {
          if (need <= EPSILON) break
          const avail = Math.max(0, availOf(w.e.source) - s * (inNeed.get(w.e.source) ?? 0) - (took.get(w.e.source) ?? 0))
          const a = Math.max(0, Math.min(need, w.want, avail))
          took.set(w.e.source, (took.get(w.e.source) ?? 0) + a)
          need -= a
        }
        return took
      }
      /** the highest level above the Pool's start that the walk reaches at `s` */
      const peakAt = (q: string, s: number): number => {
        const gt = gateTakes(s)
        let level = 0
        let peak = 0
        for (const m of inOrder) {
          const c = cof.get(m) ?? 0
          if (kindOf(m) === 'gate') {
            if (m === sourceGate) level -= gt.get(q) ?? 0
            const Wm = W.get(m) ?? 0
            if (Wm > EPSILON) level += (c * s * (gateInto.get(m)!.get(q) ?? 0)) / Wm
          } else {
            level -= c * s * (convNeed.get(m)!.get(q) ?? 0)
            level += c * s * (convMake.get(m)!.get(q) ?? 0)
          }
          if (level > peak) peak = level
        }
        return peak
      }
      const gateTouches = (q: string) => gateWants.some((w) => w.e.source === q)
      const walked: string[] = [] // Pools whose bound needs the bisection
      for (const [q, k] of outCoef) {
        if (k <= EPSILON) continue
        if (gateTouches(q)) {
          walked.push(q)
          continue
        }
        const peak = peakAt(q, 1) // linear in s without the Gate's pulls
        if (peak > EPSILON) bound(roomOf(q) / peak)
      }
      // a Gate fed from its own Pools (a group's source — a Gate fed by a
      // router has no Pool input, or the group would be multi): what it can
      // reach by its greedy pulls, net of what the plan claims from the same
      // Pools; the reach falls as s grows, so the largest feasible s is found
      // by bisection when a Pool is shared, and is the plain reach otherwise.
      const sourceGates: { id: string; demand: number; c: number }[] = []
      for (const m of members) {
        if (kindOf(m) !== 'gate' || fedByRouter.has(m)) continue
        const c = cof.get(m) ?? 0
        const inb = inbox.get(m) ?? 0
        const ins = inOf(m).filter((e) => isPool(e.source) && !dead.has(e.id)).sort(cmpEdge)
        const wants = ins.map((e) => ({ e, want: amountOf(e, availOf(e.source), S[e.source] ?? 0) }))
        const demand = inb + wants.reduce((t, w) => t + w.want, 0)
        sourceGates.push({ id: m, demand, c })
        if (c <= EPSILON) continue
        const reach = (s: number): number => {
          const used = new Map<string, number>()
          let r = inb
          for (const w of wants) {
            const avail = Math.max(0, availOf(w.e.source) - s * (inNeed.get(w.e.source) ?? 0) - (used.get(w.e.source) ?? 0))
            const a = Math.max(0, Math.min(w.want, avail))
            used.set(w.e.source, (used.get(w.e.source) ?? 0) + a)
            r += a
          }
          return r
        }
        const shared = wants.some((w) => (inNeed.get(w.e.source) ?? 0) > EPSILON)
        let hi = Math.min(sMax, reach(0) / c)
        // no slack (#471, erratum part 4): a value kept is one the Gate reaches
        if (shared && !(reach(hi) >= c * hi)) {
          let lo = 0
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2
            if (reach(mid) >= c * mid) lo = mid
            else hi = mid
          }
          hi = lo
        }
        bound(hi)
      }
      // the Pools the source Gate pulls from and a member delivers into: the
      // largest `s` under every other bound at which the walk keeps every such
      // Pool's level within its room (feasible at 0; bisection from there)
      if (walked.length > 0 && Number.isFinite(sMax) && sMax > 0) {
        const fits = (s: number) => walked.every((q) => peakAt(q, s) <= roomOf(q)) // no slack (#471, erratum part 4)
        if (!fits(sMax)) {
          let lo = 0
          let hi = sMax
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2
            if (fits(mid)) lo = mid
            else hi = mid
          }
          bound(lo)
        }
      }
      let s = Number.isFinite(sMax) ? Math.max(0, sMax) : 0
      // `pull all` members fix the number: the group runs at it or not at all
      // (SEMANTICS.md §9; a short one is recorded for the fixpoint).
      const modeOf = (id: string) => ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny')
      let zeroAt: string | null = null // #477 — '' for a short `pull all` Converter, the Gate's id for its own fixed demand
      // the number the targets alone allow: what a `pull all` member must reach
      const targeted = members.some((m) => opts.runTargets?.[m] !== undefined)
      const sCap = targeted ? Math.min(...members.filter((m) => kindOf(m) === 'converter' && (cof.get(m) ?? 0) > EPSILON).map((m) => runOf(m) / cof.get(m)!)) : 1
      for (const m of members) {
        if (kindOf(m) !== 'converter' || disabledPullAll.has(m)) continue
        const need = targeted ? Math.min(1, (cof.get(m) ?? 0) * sCap) : 1
        planNeed.set(m, need)
        if (modeOf(m) === 'pullAll' && (cof.get(m) ?? 0) * s < need * RUN_REACHED) {
          pullShort.add(m)
          s = 0
          zeroAt ??= ''
        }
      }
      for (const g of sourceGates) {
        if (modeOf(g.id) === 'pullAll' && g.c * s < g.demand - EPSILON) {
          s = 0
          zeroAt ??= g.id
        }
      }
      if (zeroAt !== null) for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, m === zeroAt ? 'pullAll' : 'plan')
      // record the plan; claim the inputs (`reservedIn`) and the output room
      // (`reserved`, owned by the member that delivers it, settled on delivery)
      for (const m of members) {
        planned.add(m)
        const c = cof.get(m) ?? 0
        if (kindOf(m) === 'gate') {
          const T = nz(Math.max(0, c * s))
          planT.set(m, T)
          const Wm = W.get(m) ?? 1
          for (const [q, w] of gateInto.get(m)!) {
            if (!isPool(q)) continue
            const amt = nz((T * w) / Wm)
            if (amt <= 0) continue
            reserved.set(q, reservedOf(q) + amt)
            addOwn(m, q, amt)
          }
          continue
        }
        const f = nz(Math.max(0, Math.min(1, c * s)))
        planF.set(m, f)
        const takes: { e: LoopEdge; a: number }[] = []
        for (const e of convPoolIns.get(m)!) {
          const a = nz(f * rateOfCached(e))
          if (a <= 0) continue
          takes.push({ e, a })
          reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) + a)
        }
        planTakes.set(m, takes)
        for (const [q, make] of convMake.get(m)!) {
          if (!isPool(q)) continue
          const amt = nz(f * make)
          if (amt <= 0) continue
          reserved.set(q, reservedOf(q) + amt)
          addOwn(m, q, amt)
        }
      }
    }
    // ── #476 — the multi-supply Gate: a fixed priority in the existing order ──
    // (SEMANTICS.md §6 erratum, part 3.) A group with a Gate that has two
    // supplies has one free number per supply beyond the tree's one. Cutting
    // every router → router connection INTO a multi-supply Gate leaves PIECES,
    // each a tree: a piece headed by a multi-supply Gate runs at that Gate's
    // throughput `T = Σ supplies`; a source piece (no Gate at its head) has a
    // number of its own, set through the supply connection it feeds. The
    // supplies of each multi-supply Gate are filled one by one — the Gates in
    // router order; for each, its upstream routers in router order, then its
    // own Pool connections in `(source, edge)` order — every supply to the
    // largest amount that keeps the WHOLE group feasible with the earlier ones
    // fixed and the later ones at zero (closed form without a shared Pool;
    // bisection with one: every claim grows with the supply, so feasibility
    // is monotone in it). The throughput is whatever that order leaves, not a
    // maximum: the order is a contract so the losing supply follows from the
    // model. A `pull all` multi-supply Gate wants its own Pool connections at
    // their amounts (`all` = the Pool's available amount at plan time) and
    // each router supply at what that branch can deliver on its own (its
    // reach, never its connection rate); the plan is that point if it is
    // feasible, else the whole group moves nothing. `pull all` Converters and
    // source Gates keep the tree rule (f = 1 or nothing; the source Gate's
    // demand or nothing). Two multi-supply Gates whose downstreams meet at one
    // Converter share a piece: the Converter's one fraction sets the second
    // Gate's throughput from the first's (`cof · s`), so the first Gate, in
    // order, is filled as above while the second is held to what that leaves
    // it — its supplies, in their order, each up to its own bound, cover
    // exactly the throughput the first Gate implies (`settle`); when they
    // cannot, the first Gate's supply is smaller, and a `pull all` second Gate
    // whose fixed demand is not that throughput zeroes the group (D-fixed).
    // The two loss notices stay as safety nets: a planned group never reaches
    // them.
    //
    // #471 (erratum part 4): a group of Gates only that splits and rejoins is
    // planned here too (`rejoin`). The join has two supplies from one piece,
    // so the piece's paths sum (G-R2); every free number is filled in the
    // same order, `pull all` or not (G-R5); then a `pull all` Gate whose
    // planned throughput is below its fixed demand — its throughput with
    // every entry at its full amount — zeroes the whole group, side exits and
    // entries that never reach it included (G-R6, D-fixed).
    //
    // Every bound below is checked with no slack (#471 review of rev 2): a
    // value the bisection keeps is feasible against the actual availability
    // and room, so the commit never clips a planned amount. A tolerance only
    // classifies a difference already computed (a `pull all` demand met, two
    // supplies covering a throughput).
    const planMulti = (members: string[], multiGates: string[], rejoin = false) => {
      const { W, gateInto, convMake, convNeed, convPoolIns, pair, fedByRouter } = memberShapes(members)
      const multi = new Set(multiGates)
      const byOrder = (a: string, b: string) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity)
      // the pieces: components over the pairs that do not enter a multi-supply Gate
      type Piece = { id: number; members: string[]; head: string | null; root: string; cof: Map<string, number> }
      const pieces: Piece[] = []
      const pieceOf = new Map<string, number>()
      {
        const adj = new Map<string, Set<string>>(members.map((m) => [m, new Set()]))
        for (const key of pair.keys()) {
          const [u, v] = key.split('\u0000')
          if (multi.has(v)) continue
          adj.get(u)!.add(v)
          adj.get(v)!.add(u)
        }
        for (const start of [...members].sort(byOrder)) {
          if (pieceOf.has(start)) continue
          const ms: string[] = []
          const stack = [start]
          pieceOf.set(start, pieces.length)
          while (stack.length) {
            const v = stack.pop()!
            ms.push(v)
            for (const w of adj.get(v)!) if (!pieceOf.has(w)) { pieceOf.set(w, pieces.length); stack.push(w) }
          }
          ms.sort(byOrder)
          const head = ms.find((m) => multi.has(m)) ?? null
          pieces.push({ id: pieces.length, members: ms, head, root: head ?? ms[0], cof: new Map() })
        }
      }
      // coefficients within each piece from its root (c = 1), as the tree plan does
      for (const p of pieces) {
        p.cof.set(p.root, 1)
        for (let changed = true; changed && p.cof.size < p.members.length; ) {
          changed = false
          for (const [key, w] of pair) {
            const [u, v] = key.split('\u0000')
            if (multi.has(v) || pieceOf.get(u) !== p.id || pieceOf.get(v) !== p.id) continue
            const hasU = p.cof.has(u)
            const hasV = p.cof.has(v)
            if (hasU === hasV) continue
            const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
            if (Wu <= EPSILON) continue
            const F = (1 / Wu) * (kindOf(v) === 'gate' ? w : 1)
            if (hasU) p.cof.set(v, p.cof.get(u)! * F)
            else p.cof.set(u, p.cof.get(v)! / F)
            changed = true
          }
        }
      }
      // the supplies of each multi-supply Gate, in the contract order
      type Sup = { kind: 'router'; src: string; piece: number; coef: number } | { kind: 'own'; e: LoopEdge; want: number }
      const supplies = new Map<string, Sup[]>()
      for (const G of multiGates) {
        const list: Sup[] = []
        const ups: { u: string; w: number }[] = []
        for (const [key, w] of pair) {
          const [u, v] = key.split('\u0000')
          if (v === G) ups.push({ u, w })
        }
        ups.sort((a, b) => byOrder(a.u, b.u))
        for (const { u, w } of ups) {
          const p = pieces[pieceOf.get(u)!]
          const Wu = kindOf(u) === 'gate' ? (W.get(u) ?? 0) : 1
          const coef = Wu > EPSILON ? (p.cof.get(u) ?? 0) * (1 / Wu) * w : 0 // the amount on the connection per unit of the piece's number
          list.push({ kind: 'router', src: u, piece: p.id, coef })
        }
        for (const e of ownIns(G)) list.push({ kind: 'own', e, want: Math.max(0, amountOf(e, availOf(e.source), S[e.source] ?? 0)) })
        supplies.set(G, list)
      }
      const orderedMulti = [...multiGates].sort(byOrder)
      const sPiece = new Map<number, number>() // source piece → its number
      const uOwn = new Map<string, number>() // own-Pool supply connection → its amount
      const fixed = new Set<string>() // the supplies filled so far
      const tentative = new Set<string>() // what `settle` set for a Gate that is not its piece's root; redone on every test
      const keyOf = (sup: Sup) => (sup.kind === 'own' ? `own:${sup.e.id}` : `piece:${sup.piece}`)
      const valueOf = (sup: Sup) => (sup.kind === 'own' ? (uOwn.get(sup.e.id) ?? 0) : sup.coef * (sPiece.get(sup.piece) ?? 0))
      /** every piece's number: a source piece's own; a headed piece's number is the throughput of the Gate at its root (its supplies are all upstream, so earlier in the order) */
      const sOf = (): Map<number, number> => {
        const s = new Map<number, number>()
        for (const p of pieces) if (p.head === null) s.set(p.id, sPiece.get(p.id) ?? 0)
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root !== G) continue
          let T = 0
          for (const sup of supplies.get(G)!) T += sup.kind === 'router' ? sup.coef * (s.get(sup.piece) ?? 0) : (uOwn.get(sup.e.id) ?? 0)
          s.set(p.id, T)
        }
        return s
      }
      /** A multi-supply Gate that is not the root of its piece has its throughput set by the root (`cof · s`). Its supplies
       *  not yet filled are set here, in their order, each up to its own bound, to cover exactly that throughput — so a test
       *  of an earlier supply sees the later Gate as its own fill will leave it. False when they cannot cover it (or the
       *  filled ones already exceed it). */
      const settle = (): boolean => {
        for (const k of tentative) {
          if (fixed.has(k)) continue // its own fill set it while the tests still listed it here: the value stands
          if (k.startsWith('own:')) uOwn.delete(k.slice(4))
          else sPiece.delete(Number(k.slice(6)))
        }
        tentative.clear()
        const s = sOf()
        let ok = true
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root === G) continue
          let need = (p.cof.get(G) ?? 0) * (s.get(p.id) ?? 0)
          const open: Sup[] = []
          for (const sup of supplies.get(G)!) {
            if (fixed.has(keyOf(sup)) || (sup.kind === 'router' && sPiece.has(sup.piece))) need -= valueOf(sup)
            else open.push(sup)
          }
          for (const sup of open) {
            const k = keyOf(sup)
            if (tentative.has(k)) continue // a second connection from the same source piece: determined with the first
            tentative.add(k)
            if (sup.kind === 'own') {
              const v = Math.max(0, Math.min(need, sup.want, availOf(sup.e.source)))
              uOwn.set(sup.e.id, v)
              need -= v
            } else {
              const coef = open.reduce((t, o) => (o.kind === 'router' && o.piece === sup.piece ? t + o.coef : t), 0)
              const cap = coef > EPSILON ? coef * pieceMax(pieces[sup.piece]) : 0
              const v = Math.max(0, Math.min(need, cap))
              sPiece.set(sup.piece, coef > EPSILON ? v / coef : 0)
              need -= v
            }
          }
          if (Math.abs(need) > EPSILON) ok = false
        }
        return ok
      }
      /** member → its amount (a Gate's T, a Converter's f) */
      const amountsOf = (s: Map<number, number>) => {
        const c = new Map<string, number>()
        for (const m of members) {
          const p = pieces[pieceOf.get(m)!]
          c.set(m, (p.cof.get(m) ?? 0) * (s.get(p.id) ?? 0))
        }
        return c
      }
      const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v)
      /** the tree plan's bounds, as a test of the whole group at once */
      const feasible = (): boolean => {
        if (!settle()) return false
        const c = amountsOf(sOf())
        const claim = new Map<string, number>() // Pool → taken by the plan
        const give = new Map<string, number>() // Pool → delivered by the plan
        // per member, in the group's commit order: what it takes from and
        // delivers into each Pool (#471 item 5 — the room is checked along
        // that order, below)
        const takesBy = new Map<string, Map<string, number>>()
        const givesBy = new Map<string, Map<string, number>>()
        const addBy = (by: Map<string, Map<string, number>>, m: string, q: string, v: number) => {
          let row = by.get(m)
          if (!row) by.set(m, (row = new Map()))
          row.set(q, (row.get(q) ?? 0) + v)
        }
        for (const m of members) {
          const v = c.get(m) ?? 0
          if (kindOf(m) === 'gate') {
            // a positive amount, however small, is checked: skipping one below
            // epsilon let the bisection plan ~1e-9 into a full Pool (#471)
            if (v <= 0) continue
            const Wm = W.get(m) ?? 0
            if (Wm <= EPSILON) return false // no live branch — delivers nothing (#388 D)
            for (const [q, w] of gateInto.get(m)!) {
              if (!isPool(q)) continue
              add(give, q, (v * w) / Wm)
              addBy(givesBy, m, q, (v * w) / Wm)
            }
            continue
          }
          if (v > 1) return false // f ≤ 1
          if (v <= 0) continue
          if (disabledPullAll.has(m) || convMake.get(m)!.size === 0) return false
          if (inOf(m).some((e) => !isPool(e.source) && !liveEdge(e) && rateOfCached(e) > EPSILON)) return false
          const need = convNeed.get(m)!
          for (const [p, r] of need) {
            add(claim, p, v * r)
            addBy(takesBy, m, p, v * r)
          }
          for (const [q, make] of convMake.get(m)!) {
            if (!isPool(q)) continue
            add(give, q, v * make)
            addBy(givesBy, m, q, v * make)
          }
        }
        for (const G of multiGates) {
          for (const sup of supplies.get(G)!) {
            if (sup.kind !== 'own') continue
            const u = uOwn.get(sup.e.id) ?? 0
            if (u > sup.want) return false
            add(claim, sup.e.source, u)
            addBy(takesBy, G, sup.e.source, u)
          }
        }
        for (const [p, v] of claim) if (v > availOf(p)) return false
        // a source Gate reaches its T by its greedy pulls, net of the plan's claims
        const used = new Map<string, number>()
        for (const m of members) {
          if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m)) continue
          const T = c.get(m) ?? 0
          if (T <= 0) continue
          let r = inbox.get(m) ?? 0
          let need = Math.max(0, T - r)
          for (const e of ownIns(m)) {
            const want = amountOf(e, availOf(e.source), S[e.source] ?? 0)
            const avail = Math.max(0, availOf(e.source) - (claim.get(e.source) ?? 0) - (used.get(e.source) ?? 0))
            const a = Math.max(0, Math.min(want, avail))
            add(used, e.source, a)
            r += a
            // what the commit will actually pull from this Pool: up to what is still needed
            const pulled = Math.min(a, need)
            need -= pulled
            if (pulled > 0) addBy(takesBy, m, e.source, pulled)
          }
          if (r < T) return false
        }
        // the room, along the commit order (#471 item 5): from the Pool as it
        // stands, each member's take lowers the level at its turn and its
        // delivery raises it; the level never passes the room. A Converter's
        // own take and delivery on one Pool meet at its turn (its net); an
        // earlier member's take is room a later delivery may fill.
        const inOrder = [...members].sort((a, b) => (orderIdx.get(a) ?? Infinity) - (orderIdx.get(b) ?? Infinity))
        for (const q of give.keys()) {
          let room = headroom(q)
          for (const m of members) room += ownReserve.get(m)?.get(q) ?? 0
          let level = 0
          for (const m of inOrder) {
            level -= takesBy.get(m)?.get(q) ?? 0
            level += givesBy.get(m)?.get(q) ?? 0
            if (level > room) return false
          }
        }
        return true
      }
      /** a `pull all` source Gate of a piece runs at its demand or not at all (the tree rule) */
      const pullAllSourcesOk = (p: Piece): boolean => {
        const c = amountsOf(sOf())
        for (const m of p.members) {
          if (kindOf(m) !== 'gate' || multi.has(m) || fedByRouter.has(m) || modeOfRouter(m) !== 'pullAll') continue
          const T = c.get(m) ?? 0
          if (T <= EPSILON) continue
          let demand = inbox.get(m) ?? 0
          for (const e of ownIns(m)) demand += amountOf(e, availOf(e.source), S[e.source] ?? 0)
          if (T < demand - EPSILON) return false
        }
        return true
      }
      /** a finite upper bound for a source piece's number from its own members (the shared constraints are left to `feasible`) */
      const pieceMax = (p: Piece): number => {
        let hi = Infinity
        for (const m of p.members) {
          const cm = p.cof.get(m) ?? 0
          if (cm <= EPSILON) continue
          if (kindOf(m) === 'converter') hi = Math.min(hi, 1 / cm)
          else if (!multi.has(m) && !fedByRouter.has(m)) {
            let r = inbox.get(m) ?? 0
            for (const e of ownIns(m)) r += Math.max(0, Math.min(amountOf(e, availOf(e.source), S[e.source] ?? 0), availOf(e.source)))
            hi = Math.min(hi, r / cm)
          }
        }
        return Number.isFinite(hi) ? Math.max(0, hi) : 0
      }
      /** the largest value of one free number that keeps the group feasible, then its own all-or-nothing rule */
      const largest = (set: (v: number) => void, hi: number, ok: () => boolean): number => {
        const test = (v: number) => { set(v); return feasible() }
        let best = 0
        if (hi > EPSILON) {
          if (test(hi)) best = hi
          else {
            let lo = 0
            let h = hi
            for (let i = 0; i < 64; i++) {
              const mid = (lo + h) / 2
              if (test(mid)) lo = mid
              else h = mid
            }
            best = lo
          }
        }
        set(best)
        if (best > EPSILON && !ok()) { best = 0; set(0) }
        return best
      }
      type Item = { sup: Sup; p: Piece | null }
      const fill = (it: Item): number => {
        tentative.delete(keyOf(it.sup)) // from here on this supply is set by its own fill, not by `settle`
        fixed.add(keyOf(it.sup)) // and `settle` reads the value under test as given
        const v = it.sup.kind === 'own'
          ? largest((x) => uOwn.set((it.sup as { e: LoopEdge }).e.id, x), Math.min(it.sup.want, Math.max(0, availOf(it.sup.e.source))), () => true)
          : largest((x) => sPiece.set(it.p!.id, x), pieceMax(it.p!), () => rejoin || pullAllSourcesOk(it.p!)) // a rejoin's `pull all` Gates: G-R6, after the fill
        fixed.add(keyOf(it.sup))
        return v
      }
      let zero = false
      let zeroAt: string | null = null // #477 — the `pull all` Gate whose fixed demand could not be met
      for (const G of orderedMulti) {
        const items: Item[] = []
        for (const sup of supplies.get(G)!) {
          if (sup.kind === 'router') {
            const p = pieces[sup.piece]
            if (p.head === null) items.push({ sup, p }) // a supply whose piece is already set (`determined`) is skipped below
          } else items.push({ sup, p: null })
        }
        const determined = (it: Item) => it.p !== null && sPiece.has(it.p.id) && !tentative.has(`piece:${it.p.id}`)
        if (!rejoin && modeOfRouter(G) === 'pullAll') {
          // D-demand (the reach reading) and D-fixed
          const reach = items.map((it) => {
            if (it.sup.kind === 'own') return it.sup.want
            if (determined(it)) return NaN
            const v = fill(it)
            sPiece.delete(it.p!.id)
            fixed.delete(keyOf(it.sup))
            return v
          })
          items.forEach((it, i) => {
            if (Number.isNaN(reach[i])) return
            tentative.delete(keyOf(it.sup))
            if (it.sup.kind === 'own') uOwn.set(it.sup.e.id, reach[i])
            else sPiece.set(it.p!.id, reach[i])
            fixed.add(keyOf(it.sup))
          })
          if (!feasible()) { zero = true; zeroAt = G; break }
        } else for (const it of items) if (!determined(it)) fill(it)
      }
      if (!zero && !feasible()) zero = true // the later Gate of a shared piece could not be met exactly
      const failedPullAll = new Set<string>() // G-R6 — every `pull all` Gate of a rejoin whose fixed demand was missed
      if (!zero && rejoin) {
        // the fixed demand: every entry at its full amount (a source piece at
        // its own maximum, an own-Pool connection at min(rate, availability)),
        // through the same coefficients as the plan
        const full = new Map<number, number>()
        for (const p of pieces) if (p.head === null) full.set(p.id, pieceMax(p))
        for (const G of orderedMulti) {
          const p = pieces[pieceOf.get(G)!]
          if (p.root !== G) continue
          let T = 0
          for (const sup of supplies.get(G)!) T += sup.kind === 'router' ? sup.coef * (full.get(sup.piece) ?? 0) : Math.min(sup.want, Math.max(0, availOf(sup.e.source)))
          full.set(p.id, T)
        }
        const demand = amountsOf(full)
        const plan = amountsOf(sOf())
        for (const m of members) {
          if (kindOf(m) !== 'gate' || modeOfRouter(m) !== 'pullAll') continue
          if ((plan.get(m) ?? 0) < (demand.get(m) ?? 0) - EPSILON) failedPullAll.add(m)
        }
        if (failedPullAll.size) zero = true
      }
      if (!zero) {
        const c = amountsOf(sOf())
        for (const m of members) {
          if (kindOf(m) !== 'converter' || disabledPullAll.has(m) || modeOfRouter(m) !== 'pullAll') continue
          if ((c.get(m) ?? 0) < 1 - EPSILON) { pullShort.add(m); zero = true }
        }
      }
      if (zero) { sPiece.clear(); uOwn.clear(); fixed.clear(); tentative.clear() }
      // #477 — a zeroed group's Gates say why: the `pull all` Gate whose
      // fixed demand failed, `pullAll`; every other Gate of the group, `plan`
      if (zero) for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, m === zeroAt || failedPullAll.has(m) ? 'pullAll' : 'plan')
      // record the plan; claim the inputs (`reservedIn`) and the output room, as the tree plan does
      const c = amountsOf(sOf())
      for (const m of members) {
        planned.add(m)
        if (kindOf(m) === 'gate') {
          const T = nz(Math.max(0, c.get(m) ?? 0))
          planT.set(m, T)
          const Wm = W.get(m) ?? 1
          for (const [q, w] of gateInto.get(m)!) {
            if (!isPool(q)) continue
            const amt = nz((T * w) / Wm)
            if (amt <= 0) continue
            reserved.set(q, reservedOf(q) + amt)
            addOwn(m, q, amt)
          }
          if (multi.has(m)) {
            const pulls: { e: LoopEdge; a: number }[] = []
            for (const sup of supplies.get(m)!) {
              if (sup.kind !== 'own') continue
              const a = nz(uOwn.get(sup.e.id) ?? 0)
              if (a <= 0) continue
              pulls.push({ e: sup.e, a })
              reservedIn.set(sup.e.source, (reservedIn.get(sup.e.source) ?? 0) + a)
            }
            planPulls.set(m, pulls)
          }
          continue
        }
        const f = nz(Math.max(0, Math.min(1, c.get(m) ?? 0)))
        planF.set(m, f)
        const takes: { e: LoopEdge; a: number }[] = []
        for (const e of convPoolIns.get(m)!) {
          const a = nz(f * rateOfCached(e))
          if (a <= 0) continue
          takes.push({ e, a })
          reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) + a)
        }
        planTakes.set(m, takes)
        for (const [q, make] of convMake.get(m)!) {
          if (!isPool(q)) continue
          const amt = nz(f * make)
          if (amt <= 0) continue
          reserved.set(q, reservedOf(q) + amt)
          addOwn(m, q, amt)
        }
      }
    }
    const multiLoss = new Set<string>() // Converters whose D1 diagnostic is out this pass

    for (const id of order) {
      const n = byId.get(id)!
      activated.add(id)
      const k = n.data.kind
      const accept = makeAccept()
      const group = treeAtRoot.get(id)
      const mg = multiAtRoot.get(id)
      // #477 — the plan-free numbers are read BEFORE the plan claims anything;
      // a group with a `pull all` Converter the fixpoint disabled runs that
      // piece at nothing, so its Gates that move nothing say `plan`
      // (a disabled `pull all` Converter's connections are never read on the
      // committed pass — a random flow only it consumes raises no diagnostic)
      const isDisabledConverter = (m: string) => kindOf(m) === 'converter' && disabledPullAll.has(m)
      if (!isDisabledConverter(id)) numsOf(id)
      const members = group ?? mg?.members ?? []
      for (const m of members) if (!isDisabledConverter(m)) numsOf(m)
      if (members.some((m) => kindOf(m) === 'converter' && disabledPullAll.has(m)))
        for (const m of members) if (kindOf(m) === 'gate') planZeroWhy.set(m, 'plan')
      if (group) planGroup(group)
      if (mg) planMulti(mg.members, mg.multiGates, mg.rejoin)

      if (k === 'drain' || k === 'end') {
        // a terminal consumes what a router handed it: the entry is cleared, or
        // the held-amount sweep at the end of the pass would report a Drain's
        // intake as a loss (#471 review 3 — the visual matrix fixture's Gate
        // hands its Drain 999 999 and the phone run bar grew a notice row)
        let got = inbox.get(id) ?? 0
        inbox.set(id, 0)
        const ins = inOf(id)
          .filter((e) => isPool(e.source) && !dead.has(e.id))
          .sort(cmpEdge)
        const mode = (n.data as { mode?: 'pullAny' | 'pullAll' }).mode ?? 'pullAny'
        const wants = ins.map((e) => ({
          e,
          want: amountOf(e, availOf(e.source), S[e.source] ?? 0),
        }))
        const feasible =
          mode === 'pullAll' ? wants.every((w) => availOf(w.e.source) >= w.want - EPSILON) : true
        if (feasible) {
          for (const w of wants) {
            const a =
              mode === 'pullAll'
                ? nz(w.want)
                : nz(Math.max(0, Math.min(w.want, availOf(w.e.source))))
            if (a > 0) {
              takeFrom(w.e.source, a)
              got += a
              emit(w.e, w.e.source, id, a)
            }
          }
        }
        if (got > EPSILON) {
          fired.add(id)
          if (k === 'end') ended = true
        }
        continue
      }

      if (k === 'gate') {
        const mode = n.data.mode ?? 'pullAny'
        const probabilistic = isProbGate(n)
        // invalid / zero-sum weights ⇒ the gate is inert this step (diagnostic
        // already pushed by pickBranch); do not touch the input pools.
        if (cyclicSet.has(id)) {
          recordGate(id, 0, 'cycle') // every connection of a router on a zero-storage cycle is dead
          continue
        }
        const sel = probabilistic ? pickBranch(n) : null
        if (probabilistic && !sel) {
          recordGate(id, 0, 'inert')
          continue
        }

        let T: number
        // #492 — what came through the inbox: `planReserve` already walked it
        // down to the Pools when the upstream router handed it over, so only
        // the rest of T reserves room as it is passed on. Reserving it again
        // cancelled out on a chain (the Gate's own credit) but ate the room of
        // a sibling that shares the Pool
        let fromInboxT = 0
        const plPulls = planPulls.get(id)
        if (plPulls !== undefined) {
          // #476 — a multi-supply Gate moves exactly its plan: the inbox (its
          // router supplies, delivered at the plan) plus the own-Pool amounts
          // the plan claimed at the group's first router, released here. The
          // plan already applied `pull all` (the point or nothing), so the
          // demand test below does not run again on the Pool net of the claim.
          let got = inbox.get(id) ?? 0
          inbox.set(id, 0)
          for (const { e, a } of plPulls) {
            reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) - a)
            takeFrom(e.source, a)
            got += a
            emit(e, e.source, id, a)
          }
          T = nz(Math.max(0, got))
          if (T <= EPSILON) {
            recordGate(id, 0)
            continue
          }
        } else {
          let inb = inbox.get(id) ?? 0
          const ins = inOf(id)
            .filter((e) => isPool(e.source) && !dead.has(e.id))
            .sort(cmpEdge)
          let demand = inb
          let inputAvail = inb
          const wants = ins.map((e) => {
            const w = amountOf(e, availOf(e.source), S[e.source] ?? 0)
            demand += w
            inputAvail += availOf(e.source)
            return { e, want: w }
          })

          // a planned Gate moves exactly its plan's throughput (#471 Deploy 2);
          // for a Gate fed by a member the inbox IS that amount
          const plT = planT.get(id)
          T =
            plT !== undefined
              ? nz(Math.max(0, Math.min(plT, demand, inputAvail)))
              : nz(Math.max(0, Math.min(demand, inputAvail, accept(id))))
          if (mode === 'pullAll' && T < demand - EPSILON) T = 0
          if (T <= EPSILON) {
            recordGate(id, 0)
            continue
          }

          // consume inbox first, then pull the rest from pools in (source, edge) order
          let need = T
          const fromInbox = Math.min(need, inb)
          fromInboxT = fromInbox
          need -= fromInbox
          inbox.set(id, inb - fromInbox)
          inb -= fromInbox
          for (const w of wants) {
            if (need <= EPSILON) break
            const a = nz(Math.min(need, availOf(w.e.source), w.want))
            if (a > 0) {
              takeFrom(w.e.source, a)
              need -= a
              emit(w.e, w.e.source, id, a)
            }
          }
        }

        // #388 B — delivering into a Pool settles the reservation that was made
        // for THIS Gate there (and only that), the way a Converter's does.
        const settleOwn = (poolId: string, q: number) => {
          const own = ownReserve.get(id)
          const held = Math.min(q, own?.get(poolId) ?? 0)
          if (held <= 0) return
          reserved.set(poolId, reservedOf(poolId) - held)
          own!.set(poolId, own!.get(poolId)! - held)
        }

        if (probabilistic) {
          // the whole of T goes down the one selected branch (§B4.3)
          if (isPool(sel!.target)) {
            settleOwn(sel!.target, T)
            working[sel!.target] = (working[sel!.target] ?? 0) + T
          } else {
            inbox.set(sel!.target, (inbox.get(sel!.target) ?? 0) + T)
            if (!planned.has(sel!.target) && T > fromInboxT) planReserve(sel!.target, T - fromInboxT) // a plan member's room is already held
          }
          emit(sel!, id, sel!.target, T)
          fired.add(id)
          recordGate(id, T)
          continue
        }

        const outs = outOf(id).filter((e) => !skipDet(e.id))
        // `sumW > ε` here: `accept(gate)` sums the SAME `outs` and returns 0 for
        // `sumW ≤ ε`, so `T` is 0 and the Gate was left at `T ≤ ε` above. The
        // equal-split arm that stood here for that case was unreachable (#419
        // item 4).
        const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
        for (const e of outs) {
          const share = nz((T * rateOfCached(e)) / sumW)
          if (share <= 0) continue
          if (isPool(e.target)) {
            settleOwn(e.target, share)
            working[e.target] = (working[e.target] ?? 0) + share
          } else {
            inbox.set(e.target, (inbox.get(e.target) ?? 0) + share)
            if (!planned.has(e.target) && T > fromInboxT) planReserve(e.target, fromInboxT > 0 ? (share * (T - fromInboxT)) / T : share)
          }
          emit(e, id, e.target, share)
        }
        fired.add(id)
        recordGate(id, T)
        continue
      }

      if (k === 'converter') {
        // A `pullAll` Converter the fixpoint has already disabled moves nothing
        // — skip it before any edge is read, so its flows are not evaluated on
        // the committed pass (a diagnostic from a branch only this Converter
        // would have consumed must not surface). A refused rate on one of its
        // own connections (#396, #471 item 5) is a fact of the connection, not
        // of this step's branches, and is still reported.
        if (disabledPullAll.has(id)) {
          for (const e of [...inOf(id), ...outOf(id)]) if (isRefusedRate(e)) refusedRate(e)
          continue
        }
        const mode = n.data.mode ?? 'pullAny'
        const inboxHave = inbox.get(id) ?? 0
        // pool-fed inputs: pull up to the per-activation rate
        const poolIns = inOf(id)
          .filter((e) => isPool(e.source) && !dead.has(e.id))
          .sort(cmpEdge)
        const sumIn = sumInRate(id)
        const own = ownReserve.get(id)

        // the outputs at `f`: into a Pool, settling only the reservation made
        // for THIS Converter (#388 C — releasing the Pool's total let a
        // pool-fed Converter free another router's promise); into a router,
        // an INBOX (#388 D — `working` is summed over Pools only at commit)
        // with its room reserved downstream, unless the target is a member of
        // a planned group, whose room the plan already holds.
        const deliver = (f: number) => {
          for (const e of outOf(id)) {
            if (skipDet(e.id)) continue
            const q = nz(f * rateOfCached(e))
            if (q <= 0) continue
            if (isPool(e.target)) {
              const held = Math.min(q, own?.get(e.target) ?? 0)
              if (held > 0) {
                reserved.set(e.target, reservedOf(e.target) - held)
                own!.set(e.target, own!.get(e.target)! - held)
              }
              working[e.target] = (working[e.target] ?? 0) + q
            } else {
              inbox.set(e.target, (inbox.get(e.target) ?? 0) + q)
              if (!planned.has(e.target)) planReserve(e.target, q)
            }
            emit(e, id, e.target, q)
          }
          fired.add(id)
        }

        // #471 Deploy 2 — a member of a planned tree group runs at the plan's
        // fraction: it takes exactly the Pool amounts the plan claimed at the
        // group's first router (releasing that claim), its upstream members
        // delivered exactly `f · rate`, and it makes `f · rate` on every output.
        const plF = planF.get(id)
        if (plF !== undefined) {
          let received = inboxHave
          inbox.set(id, 0)
          for (const { e, a } of planTakes.get(id) ?? []) {
            reservedIn.set(e.source, (reservedIn.get(e.source) ?? 0) - a)
            takeFrom(e.source, a)
            received += a
            emit(e, e.source, id, a)
          }
          // the plan's f, bounded by what arrived (equal, up to rounding)
          let f = sumIn > EPSILON ? Math.min(plF, received / sumIn) : 0
          f = nz(Math.max(0, Math.min(1, f)))
          if (mode === 'pullAll' && f < (planNeed.get(id) ?? 1) * RUN_REACHED) {
            pullShort.add(id)
            f = 0
          }
          if (f <= EPSILON) continue
          deliver(f)
          continue
        }

        // Not planned: either every input is a Pool (the revision-1 rule below),
        // or a router input delivers nothing this step — its router does not
        // fire, the connection is dead, or a probabilistic Gate picked another
        // branch — and one f on every connection (I2) is then 0: the Converter
        // does not run from its Pools alone (the "half a batch" defect, V2).
        // Or it is a member of a MULTI group (a live router input), which
        // keeps the rule it had (unresolved; #471 stays open).
        const routerIns = inOf(id).filter((e) => !isPool(e.source) && !dead.has(e.id) && rateOfCached(e) > EPSILON)
        const routerFed = routerIns.some((e) => liveEdge(e))
        if (!routerFed && inOf(id).some((e) => !isPool(e.source) && rateOfCached(e) > EPSILON)) {
          if (mode === 'pullAll') pullShort.add(id)
          continue
        }

        // #471 — plan, then commit (SEMANTICS.md §6 erratum; I2 / I4). The run
        // fraction is decided from the ledgers BEFORE anything is taken, and
        // every connection then moves exactly its share of it. The old order,
        // "pull what each input has, sum it, then divide", did three things
        // wrong (all measured in #471):
        //   V1  the output room was short, and the inputs were still taken in
        //       full — the difference vanished;
        //   V2  one input was short, the others were taken in full and summed,
        //       so no single f held per connection;
        //   V3  two outputs went into one capped Pool, each saw the Pool's
        //       whole room, and the commit clamp cut the excess unreported.
        // Inputs are grouped by source Pool and outputs by target (Pool or
        // router), so two connections off one Pool, or into one target, share
        // its availability or room (SEMANTICS.md §9 keeps the `pull all` rule:
        // f < 1 ⇒ nothing moves — a probe pass records it in `pullShort`).
        //
        // Pool side: for each source Pool P, `avail_P / Σ rate from P`.
        const needFrom = new Map<string, number>()
        for (const e of poolIns) {
          const r = rateOfCached(e)
          if (r <= EPSILON) continue
          needFrom.set(e.source, (needFrom.get(e.source) ?? 0) + r)
        }
        let fPool = 1
        for (const [p, need] of needFrom) fPool = Math.min(fPool, availOf(p) / need)
        fPool = Math.max(0, fPool)
        let sumInPool = 0
        for (const need of needFrom.values()) sumInPool += need
        // Output side: for each target Q, `room_Q / Σ rate into Q` — a Pool's
        // headroom plus this Converter's own reservation there (so it is not
        // blocked by itself; #388 B/C), a router's live `accept` (#388 D — a
        // router's `headroom` is unbounded, and sizing by it handed a blocked
        // Gate an inbox it could not deliver). A Pool that is both an input
        // and an output of this Converter is bounded on the NET amount,
        // `room / (make − need)`: the take and the make happen inside one
        // activation, so what it takes is room it may fill, while what it
        // takes is bounded on the Pool as it stands (#471 item 5, Lumi
        // 2026-11-03 — the one-Converter case of the rule that a Pool's room
        // is checked along the plan unit's commit order).
        const makeInto = new Map<string, number>()
        for (const e of outOf(id)) {
          if (skipDet(e.id)) continue
          const r = rateOfCached(e)
          if (r <= EPSILON) continue
          makeInto.set(e.target, (makeInto.get(e.target) ?? 0) + r)
        }
        let fOut = makeInto.size > 0 ? 1 : 0 // #388 D — no live output, no run
        for (const [q, make] of makeInto) {
          if (isPool(q)) {
            const net = make - (needFrom.get(q) ?? 0)
            if (net > EPSILON) fOut = Math.min(fOut, (headroom(q) + (own?.get(q) ?? 0)) / net)
          } else fOut = Math.min(fOut, accept(q) / make)
        }
        fOut = Math.min(fOut, sharedPoolBound(makeInto, own, needFrom)) // #492 — a Pool reached by two paths

        // the fraction, before anything moves — `pull all` is decided on it
        let fDry = sumIn > EPSILON ? (inboxHave + fPool * sumInPool) / sumIn : 0
        fDry = nz(Math.max(0, Math.min(runOf(id), fDry, fOut)))
        if (mode === 'pullAll' && fDry < runOf(id) * RUN_REACHED) {
          pullShort.add(id) // probe pass: this pullAll Converter cannot reach f = 1
          continue
        }
        if (fDry <= EPSILON) continue

        // What each Pool connection moves. A Converter fed from Pools only:
        // exactly `f · rate` on every one of them (I2). A router-fed Converter
        // outside every plan (no classified group reaches this since #476; the
        // safety net behind the loss notice): the upstream routers already
        // delivered at THEIR fraction, which this step cannot undo; its Pool
        // side keeps the rule it had, `fPool · rate`, the production below
        // follows what was received, so nothing is created, and what was
        // received above what it could use is reported (D1).
        const fTake = routerFed ? fPool : fDry
        let received = inboxHave
        inbox.set(id, 0)
        for (const e of poolIns) {
          const a = nz(fTake * rateOfCached(e))
          if (a > 0) {
            takeFrom(e.source, a)
            received += a
            emit(e, e.source, id, a)
          }
        }
        let f = sumIn > EPSILON ? received / sumIn : 0
        f = nz(Math.max(0, Math.min(1, f, fOut)))
        if (mode === 'pullAll' && f < runOf(id) * RUN_REACHED) {
          pullShort.add(id)
          f = 0
        }
        if (routerFed && emitDiag && !multiLoss.has(id)) {
          const loss = received - f * sumIn
          if (loss > 1e-6) {
            multiLoss.add(id)
            // D1 — as data; the run bars word it in the user's language
            // (`playbar.diag.multiSupplyLoss`), with the node and the amount
            notices.push({ kind: 'multiSupplyLoss', nodeId: id, label: n.data.label, amount: Number(loss.toFixed(6)) })
          }
        }
        if (f <= EPSILON) continue
        deliver(f)
        continue
      }
    }

    // #471 Deploy 2 (review 2) — an amount handed to a router this step that
    // the router did not pass on is gone at the end of the pass (an inbox is
    // per step; in G7 the Gate whose Converter accepts nothing keeps what the
    // upstream Converter delivered). Named like the Converter's loss (D1), so
    // the notices of a step add up to what the Pools lost. Committed pass only.
    if (emitDiag) {
      for (const [rid, v] of [...inbox].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (v > 1e-6) notices.push({ kind: 'multiSupplyHeld', nodeId: rid, label: byId.get(rid)?.data.label ?? rid, amount: Number(v.toFixed(6)) })
      }
      // #477 — the committed pass publishes the Gates' evidence, the held
      // amount (the notice's number) on the Gate it names
      for (const [rid, v] of inbox) {
        const g = gateEntries.get(rid)
        if (g && v > 1e-6) g.held = r6(v)
      }
      gates.push(...[...gateEntries.values()].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)))
    }

    if (snap) {
      for (const key of Object.keys(working)) delete working[key]
      Object.assign(working, snap.working)
      taken.clear()
      for (const [key, v] of snap.taken) taken.set(key, v)
      reserved.clear()
      for (const [key, v] of snap.reserved) reserved.set(key, v)
      reservedIn.clear()
      for (const [key, v] of snap.reservedIn) reservedIn.set(key, v)
      inbox.clear()
      for (const [key, v] of snap.inbox) inbox.set(key, v)
      ownReserve.clear()
      for (const [key, v] of snap.ownReserve) ownReserve.set(key, v)
      activated.clear()
      for (const v of snap.activated) activated.add(v)
      fired.clear()
      for (const v of snap.fired) fired.add(v)
      events.length = snap.eventsLen
      diagnostics.length = snap.diagLen // no-op while emitDiag is false, kept as a guard
      ended = snap.ended
    }
    emitDiag = prevEmitDiag
    return pullShort
  }

  // ── Phase 2 feasibility fixpoint ────────────────────────────────────────
  // Only `pullAll` Converters can force a re-run; without any, this is a single
  // committed pass identical to before. Disabling a short `pullAll` Converter
  // only ever frees resource for the rest, so the disabled set grows monotonic-
  // ally and must settle within `#pullAll Converters + 1` probes (SEMANTICS.md
  // §9 / §11). A canonical-order winner among Converters contending for one Pool
  // fills first in the probe and stays enabled; the loser lands in the set.
  const isPullAllConverter = (id: string) =>
    kindOf(id) === 'converter' &&
    ((byId.get(id)?.data as { mode?: string } | undefined)?.mode ?? 'pullAny') === 'pullAll'
  const pullAllConverterCount = order.filter(isPullAllConverter).length
  if (pullAllConverterCount > 0) {
    const capIters = pullAllConverterCount + 1
    let settled = false
    for (let i = 0; i < capIters; i++) {
      const short = pullPass(false)
      let grew = false
      for (const id of short) {
        if (!disabledPullAll.has(id)) {
          disabledPullAll = new Set(disabledPullAll).add(id)
          grew = true
        }
      }
      if (!grew) {
        settled = true
        break
      }
    }
    if (!settled) {
      diagnostics.push(
        `pull-all feasibility did not settle within ${capIters} probe passes; ` +
          `results for this step may be approximate.`,
      )
    }
  }
  pullPass(true)

  // ── Phase 2.5: afterPull labels (CSU / SEMANTICS-S3.md) ─────────────────
  // Applied once, using THIS step's real, committed `fired` set (built above
  // by Phase 1 push + the committed Phase 2 pull) — never a probe's. Ascending
  // `edge.id` (labelEdges, and so pendingAfterPull, is already in that order);
  // the running `working[target]` carries between edges into the same target,
  // exactly like a Phase-0 label; intermediate out-of-range values are
  // allowed. There is no separate Phase-2.5 clamp point — the correction is
  // computed here (so it can be attributed and reported) using the identical
  // §S5(d) formula the Commit clamp below would apply anyway, so Commit then
  // finds the value already in range (a harmless no-op second pass).
  const afterPullDelta = new Map<string, number>() // edgeId -> delta, applied edges only
  const afterPullTargets = new Set<string>()
  for (const item of pendingAfterPull) {
    const e = item.e
    if (!fired.has(e.source)) continue // `when` not satisfied this step — inert
    const running = working[e.target] ?? 0
    const delta = item.op === '+' ? item.n : item.op === '-' ? -item.n : item.n - running
    working[e.target] = running + delta
    afterPullDelta.set(e.id, delta)
    afterPullTargets.add(e.target)
  }
  const afterPullClampByTarget = new Map<string, number>()
  for (const tid of afterPullTargets) {
    const unclamped = working[tid] ?? 0
    const clamped = Math.min(cap(byId.get(tid)!), Math.max(0, unclamped))
    working[tid] = clamped
    afterPullClampByTarget.set(tid, nz(clamped - unclamped))
  }
  // clamp correction rides on the target's LAST APPLIED edge (CSU3-6); an
  // inert edge is never the attribution target and always reports 0 / 0.
  const lastAppliedIdxByTarget = new Map<string, number>()
  pendingAfterPull.forEach((item, i) => {
    if (afterPullDelta.has(item.e.id)) lastAppliedIdxByTarget.set(item.e.target, i)
  })
  pendingAfterPull.forEach((item, i) => {
    const e = item.e
    const applied = afterPullDelta.has(e.id)
    stateEvents.push({
      edgeId: e.id,
      from: e.source,
      to: e.target,
      mode: 'label',
      effect: {
        kind: 'label',
        applied,
        delta: applied ? afterPullDelta.get(e.id)! : 0,
        clampAdjustment:
          applied && lastAppliedIdxByTarget.get(e.target) === i
            ? afterPullClampByTarget.get(e.target) ?? 0
            : 0,
      },
    })
  })

  // ── Commit ──────────────────────────────────────────────────────────────
  for (const nid of Object.keys(working)) {
    const n = byId.get(nid)
    const c = n ? cap(n) : Infinity
    let v = nz(working[nid])
    if (v < 0) v = 0
    if (v > c) v = c
    working[nid] = v
  }

  // ── Phase 0 wrap-up: state events + schedule future triggers ────────────
  for (const e of triggerEdges) {
    if (!deliveredEdgeIds.has(e.id)) continue
    // §S9: applied = the pulse made the target eligible to fire this step =
    // target is passive/interactive AND its activator gate is open
    const applied = TRIGGERABLE.has(actOf(byId.get(e.target)!)) && isEnabled(e.target)
    stateEvents.push({
      edgeId: e.id,
      from: e.source,
      to: e.target,
      mode: 'trigger',
      effect: { kind: 'trigger', delivered: true, applied },
    })
  }
  // §S9: emitted in ascending edgeId (activator events were pushed in Phase 0)
  stateEvents.sort((a, b) => (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))

  const triggerQueue: TriggerQueueEntry[] = [...carriedQueue]
  for (const e of triggerEdges) {
    if (!fired.has(e.source)) continue
    triggerQueue.push({
      edgeId: e.id,
      target: e.target,
      deliveryStep: curStep + delayByEdge.get(e.id)! + 1, // SEMANTICS-S.md §S3.1
    })
  }
  triggerQueue.sort(
    (a, b) =>
      a.deliveryStep - b.deliveryStep ||
      (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0),
  )

  const firedList = [...fired].sort()

  // §M5-6 — a table line short of its plan says so. A want below `EPSILON` moves
  // nothing by the engine's own rule: unmet in the numbers, not worth a message.
  const tableLines = tablePlan ? withMoved(tablePlan.lines, events) : null
  for (const l of tableLines ?? []) {
    const amount = unmetAmount(l.planned, l.moved)
    if (amount > EPSILON) notices.push({ kind: 'timetableUnmet', edgeId: l.edgeId, tableId: l.tableId, label: opts.timetables!.find((t) => t.id === l.tableId)!.label, amount })
  }

  return {
    state: { step: curStep, values: working, ended, fired: firedList, triggerQueue },
    report: {
      events,
      activated: [...activated].sort(),
      fired: firedList,
      stateEvents,
      diagnostics,
      notices,
      gates,
      ...(tableLines ? { timetableLines: tableLines } : {}),
      // §M3-5 (L1) — only for a document with a kinds table; a v2 report has no key
      ...(kindRes ? { boundaryOutflow: boundaryOutflowByKind(events, nodes, liveEdges, kindRes.edgeKind) } : {}),
    },
  }
}
