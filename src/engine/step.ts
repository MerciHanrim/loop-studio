import type { LoopEdge, LoopNode } from '../model/types'
import { evalDet, evalRand, parseFlow, rateOf, type FlowExpr } from './flow'
import { categorical, sample } from './rng'
import { EPSILON, type SimState, type SimValues, type StateEvent, type StepResult, type TriggerQueueEntry } from './types'

// Engine A — the deterministic core. Implements SEMANTICS.md §6 exactly:
// Phase 1 push (Sources), then Phase 2 pull (Gate / Converter / Drain / End)
// as one forward walk of the router DAG in topological order, with a
// reservation ledger so pool capacity is never double-spent.
//
// Engine B Part 1 (SEMANTICS-B1.md) adds, behind a `seed`: random flow
// evaluation (`1-3`, `2D6`) via a keyed RNG, cached one draw per edge per step;
// and the probabilistic Gate (one branch per step by categorical sampling).
//
// State connections (SEMANTICS-S.md, loop-state/1) add a Phase 0 before Push.
// Slice 1: `trigger` — a one-step pulse (optional integer `delay`) that fires a
// `passive` / `interactive` target on the delivery step. `activator` and
// `label` are inert until later slices.

const nz = (x: number) => (Math.abs(x) < EPSILON ? 0 : x)
const cap = (n: LoopNode): number =>
  n.data.kind === 'pool' && n.data.capacity != null ? n.data.capacity : Infinity

function requireFinite(v: number, what: string): number {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${what} must be a finite number ≥ 0 (got ${v})`)
  return v
}

export function initSim(nodes: LoopNode[]): SimState {
  const values: SimValues = {}
  for (const n of nodes) {
    if (n.data.kind !== 'pool') continue
    values[n.id] = requireFinite(n.data.initial, `Pool "${n.data.label}" initial`)
    if (n.data.capacity != null) requireFinite(n.data.capacity, `Pool "${n.data.label}" capacity`)
  }
  return { step: 0, values, ended: false, fired: [], triggerQueue: [] }
}

const ROUTER_KINDS = new Set(['gate', 'converter', 'drain', 'end'])
const TRIGGERABLE = new Set(['passive', 'interactive'])

export function step(
  nodes: LoopNode[],
  edges: LoopEdge[],
  prev: SimState,
  seed = 1,
): StepResult {
  const curStep = prev.step + 1 // the step being computed — the RNG key's `step`
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const resEdges = edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  const flowOf = new Map<string, FlowExpr>(
    resEdges.map((e) => [e.id, parseFlow(e.data?.kind === 'resource' ? e.data.flow : '1')]),
  )
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
  const diagnostics: string[] = []
  let ended = prev.ended

  // ── Engine B: one draw per random edge per step (SEMANTICS-B1.md §B3) ─────
  // `sampled` holds the drawn value for `range`/`dice` edges only; it is filled
  // on first touch (whether as an amount or as a weight) and reused everywhere.
  const sampled = new Map<string, number>()
  const badRandom = new Set<string>()
  const drawnValue = (e: LoopEdge): number => {
    const hit = sampled.get(e.id)
    if (hit !== undefined) return hit
    const v = evalRand(fe(e), 0, 0, (purpose, i) => sample(seed, curStep, e.id, purpose, i).u, (reason) => {
      if (badRandom.has(e.id)) return
      badRandom.add(e.id)
      diagnostics.push(`Edge "${e.id}" ${reason}; contributes 0.`)
    })
    sampled.set(e.id, v)
    return v
  }
  /** Flow as an amount: deterministic forms exactly as Engine A; random forms
   *  from the per-step draw cache. */
  const amountOf = (e: LoopEdge, available: number, snapshot: number): number =>
    isRandExpr(e) ? drawnValue(e) : evalDet(fe(e), available, snapshot)
  /** Flow as a weight / per-activation rate: `all`→1, `%`→frac, `const`→value,
   *  random→the drawn integer. */
  const rateOfCached = (e: LoopEdge): number => (isRandExpr(e) ? drawnValue(e) : rateOf(fe(e)))

  const availOf = (id: string) => (S[id] ?? 0) - (taken.get(id) ?? 0)
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
  // Slice 1 handles `trigger` only. `activator` / `label` are inert here; a
  // legacy `node` mode (or any unrecognised mode) is inert + one diagnostic.
  const stateEvents: StateEvent[] = []
  const stateEdgeCmp = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const KNOWN_STATE_MODES = new Set(['trigger', 'activator', 'label'])
  const stateEdges = edges
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

  // Validate each trigger edge's `delay` once this step: a non-negative integer;
  // NaN / Infinity / fractional / negative → 0 + exactly one diagnostic.
  const delayByEdge = new Map<string, number>()
  for (const e of triggerEdges) {
    const raw = e.data.delay
    if (raw == null) {
      delayByEdge.set(e.id, 0)
    } else if (Number.isInteger(raw) && raw >= 0) {
      delayByEdge.set(e.id, raw)
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

  const firing = (n: LoopNode) =>
    n.data.activation === 'automatic' ||
    (n.data.activation === 'onStart' && prev.step === 0) ||
    (TRIGGERABLE.has(n.data.activation) && triggered.has(n.id))

  const sumInRate = (id: string) => inOf(id).reduce((s, e) => s + rateOfCached(e), 0)

  const cmpId = (a: LoopEdge, b: LoopEdge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const isProbGate = (n: LoopNode | undefined) =>
    n?.data.kind === 'gate' && n.data.distribution === 'probabilistic'

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
    if (pushAll && !plan.every((p) => p.pool && headroom(p.e.target) >= p.want - EPSILON)) {
      continue // atomic: nothing
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
  const rIds = new Set(routers.map((r) => r.id))
  const dead = new Set<string>() // edge ids on a router-only cycle

  // Kahn topological sort of router→router edges, ascending-id tiebreak
  const indeg = new Map(routers.map((r) => [r.id, 0]))
  const radj = new Map<string, string[]>(routers.map((r) => [r.id, []]))
  for (const e of resEdges) {
    if (rIds.has(e.source) && rIds.has(e.target)) {
      radj.get(e.source)!.push(e.target)
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    }
  }
  const order: string[] = []
  let frontier = routers
    .filter((r) => (indeg.get(r.id) ?? 0) === 0)
    .map((r) => r.id)
    .sort()
  while (frontier.length) {
    const id = frontier.shift()!
    order.push(id)
    for (const t of radj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1)
      if (indeg.get(t) === 0) {
        frontier.push(t)
        frontier.sort()
      }
    }
  }
  const cyclic = routers.map((r) => r.id).filter((id) => !order.includes(id))
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
    if (memo !== undefined) return memo
    const outs = outOf(g.id)
      .filter((e) => !dead.has(e.id))
      .sort(cmpId) // canonical order: edge.id ascending (§B4.2)
    const weights = outs.map((e) => rateOfCached(e))
    const idx = categorical(weights, sample(seed, curStep, g.id, 'gate-route', 0).u)
    if (idx < 0) {
      diagnostics.push(
        weights.some((w) => !Number.isFinite(w) || w < 0)
          ? `Probabilistic gate "${g.data.label}": invalid branch weight; gate is inert this step.`
          : `Probabilistic gate "${g.data.label}": no positive branch weight; gate is inert this step.`,
      )
      gatePick.set(g.id, null)
      return null
    }
    gatePick.set(g.id, outs[idx])
    return outs[idx]
  }

  // `accept(id)` — max the node can take on its input side, live. Memo is valid
  // only while `working`/`reserved` are stable, so it is rebuilt per router turn.
  const makeAccept = () => {
    const memo = new Map<string, number>()
    const accept = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!
      const k = kindOf(id)
      let v: number
      if (k === 'pool') v = Math.max(0, headroom(id))
      else if (k === 'drain' || k === 'end') v = Infinity
      else if (k === 'converter') {
        const sumIn = sumInRate(id)
        let fmax = 1
        for (const e of outOf(id)) {
          if (dead.has(e.id)) continue
          const r = rateOfCached(e)
          if (r <= EPSILON) continue
          fmax = Math.min(fmax, accept(e.target) / r)
        }
        v = Math.max(0, Math.min(1, fmax)) * sumIn
      } else if (k === 'gate') {
        if (isProbGate(byId.get(id))) {
          // one live branch of effective weight 1 (§B4.4)
          const sel = pickBranch(byId.get(id)!)
          v = sel ? accept(sel.target) : 0
        } else {
          const outs = outOf(id).filter((e) => !dead.has(e.id))
          const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
          if (sumW <= EPSILON) v = 0
          else {
            v = Infinity
            for (const e of outs) {
              const w = rateOfCached(e)
              if (w <= EPSILON) continue
              v = Math.min(v, accept(e.target) * (sumW / w))
            }
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
        if (dead.has(e.id)) continue
        const q = nz(f * rateOfCached(e))
        if (q <= 0) continue
        if (isPool(e.target)) {
          reserved.set(e.target, reservedOf(e.target) + q)
          addOwn(destId, e.target, q)
        } else planReserve(e.target, q)
      }
    } else if (k === 'gate') {
      if (isProbGate(byId.get(destId))) {
        // a probabilistic gate routes the whole amount down its one live branch
        const sel = pickBranch(byId.get(destId)!)
        if (sel && !dead.has(sel.id)) {
          if (isPool(sel.target)) reserved.set(sel.target, reservedOf(sel.target) + nz(amountIn))
          else planReserve(sel.target, nz(amountIn))
        }
        return
      }
      const outs = outOf(destId).filter((e) => !dead.has(e.id))
      const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
      for (const e of outs) {
        const share = sumW > EPSILON ? nz((amountIn * rateOfCached(e)) / sumW) : 0
        if (share <= 0) continue
        if (isPool(e.target)) reserved.set(e.target, reservedOf(e.target) + share)
        else planReserve(e.target, share)
      }
    }
    // drain / end / pool: nothing further to reserve
  }

  for (const id of order) {
    const n = byId.get(id)!
    activated.add(id)
    const k = n.data.kind
    const accept = makeAccept()

    if (k === 'drain' || k === 'end') {
      let got = inbox.get(id) ?? 0
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
      const sel = probabilistic ? pickBranch(n) : null
      if (probabilistic && !sel) continue

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

      let T = nz(Math.max(0, Math.min(demand, inputAvail, accept(id))))
      if (mode === 'pullAll' && T < demand - EPSILON) T = 0
      if (T <= EPSILON) continue

      // consume inbox first, then pull the rest from pools in (source, edge) order
      let need = T
      const fromInbox = Math.min(need, inb)
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

      if (probabilistic) {
        // the whole of T goes down the one selected branch (§B4.3)
        if (isPool(sel!.target)) {
          working[sel!.target] = (working[sel!.target] ?? 0) + T
        } else {
          inbox.set(sel!.target, (inbox.get(sel!.target) ?? 0) + T)
          planReserve(sel!.target, T)
        }
        emit(sel!, id, sel!.target, T)
        fired.add(id)
        continue
      }

      const outs = outOf(id).filter((e) => !dead.has(e.id))
      const sumW = outs.reduce((s, e) => s + rateOfCached(e), 0)
      for (const e of outs) {
        const share =
          sumW > EPSILON ? nz((T * rateOfCached(e)) / sumW) : nz(T / Math.max(1, outs.length))
        if (share <= 0) continue
        if (isPool(e.target)) {
          working[e.target] = (working[e.target] ?? 0) + share
        } else {
          inbox.set(e.target, (inbox.get(e.target) ?? 0) + share)
          planReserve(e.target, share)
        }
        emit(e, id, e.target, share)
      }
      fired.add(id)
      continue
    }

    if (k === 'converter') {
      const mode = n.data.mode ?? 'pullAny'
      let received = inbox.get(id) ?? 0
      inbox.set(id, 0)
      // pool-fed inputs: pull up to the per-activation rate
      const poolIns = inOf(id)
        .filter((e) => isPool(e.source) && !dead.has(e.id))
        .sort(cmpEdge)
      for (const e of poolIns) {
        const r = rateOfCached(e)
        const a = nz(Math.max(0, Math.min(r, availOf(e.source))))
        if (a > 0) {
          takeFrom(e.source, a)
          received += a
          emit(e, e.source, id, a)
        }
      }
      const sumIn = sumInRate(id)
      // f is bounded by the input side; recheck output headroom, adding back
      // this converter's own reservation so it is not blocked by itself.
      const own = ownReserve.get(id)
      let f = sumIn > EPSILON ? received / sumIn : 0
      for (const e of outOf(id)) {
        if (dead.has(e.id)) continue
        const r = rateOfCached(e)
        if (r <= EPSILON) continue
        const back = own?.get(e.target) ?? 0
        f = Math.min(f, (headroom(e.target) + back) / r)
      }
      f = nz(Math.max(0, Math.min(1, f)))
      if (mode === 'pullAll' && f < 1 - EPSILON) f = 0
      if (f <= EPSILON) continue

      for (const e of outOf(id)) {
        if (dead.has(e.id)) continue
        const q = nz(f * rateOfCached(e))
        if (q <= 0) continue
        const held = Math.min(q, reservedOf(e.target))
        reserved.set(e.target, reservedOf(e.target) - held)
        working[e.target] = (working[e.target] ?? 0) + q
        emit(e, id, e.target, q)
      }
      fired.add(id)
      continue
    }
  }

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
    const applied = TRIGGERABLE.has(byId.get(e.target)!.data.activation)
    stateEvents.push({
      edgeId: e.id,
      from: e.source,
      to: e.target,
      mode: 'trigger',
      effect: { kind: 'trigger', delivered: true, applied },
    })
  }

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

  return {
    state: { step: curStep, values: working, ended, fired: firedList, triggerQueue },
    report: {
      events,
      activated: [...activated].sort(),
      fired: firedList,
      stateEvents,
      diagnostics,
    },
  }
}
