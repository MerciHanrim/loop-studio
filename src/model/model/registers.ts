// loop-model/1 (SEMANTICS-M.md §M3) — the pure Register evaluation pass.
//
// `R(k) = evaluate every Register against the committed snapshot S(k)` in one
// topo-ordered DAG pass. A Register on a dependency cycle, or whose expression
// parses/evaluates to an error, or that references something unresolvable /
// wrong-kind, is `invalid` and skipped; Registers depending on it cascade to
// `invalid` (`depends-on-invalid`). Deterministic — independent Registers are
// order-independent (pure eval, §X6), so `R(k)` is a function of `S(k)`.
//
// The topological pass is an iterative Kahn sort, so an arbitrarily long
// acyclic Register chain never recurses. Only the (normally tiny) set of
// Registers that fail to sort — those on / downstream of a cycle — is walked
// with a depth-guarded DFS.

import { type ExprNode, evaluate, parse, refsOf } from '../expr'

export type MRegCode =
  | 'M_REG_PARSE'
  | 'M_REG_EVAL'
  | 'M_REG_UNKNOWN_REF'
  | 'M_REG_WRONG_KIND'
  | 'M_REG_INVALID_ID'
  | 'M_REG_CYCLE'
  | 'M_REG_DEPENDS_ON_INVALID'

export type RegisterOutcome =
  | { invalid: false; value: number }
  | { invalid: true; code: MRegCode; detail?: string }

/** What a target node's id resolves to for expression purposes (§M3.1). */
export type RefKind = 'pool' | 'parameter' | 'register' | 'other' | 'missing'

export type RegisterSnapshotView = {
  /** each Register's id + its stored `expr` text (canonical or raw) */
  registers: { id: string; expr: string }[]
  /** classify a referenced id */
  refKind: (id: string) => RefKind
  /** a pool's count in S(k) */
  poolCount: (id: string) => number
  /** a parameter's `data.value` */
  paramValue: (id: string) => number
}

/** Guard for the DFS over the un-sortable (cyclic) sub-graph — far above any
 *  legitimate tangle; hitting it just means everything still unresolved is
 *  reported `M_REG_CYCLE` rather than overflowing the stack. */
const MAX_CYCLE_DFS_DEPTH = 5000

const hasControlChar = (id: string): boolean => {
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    if ((c >= 0x00 && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) return true
  }
  return false
}

type Prepared =
  | { kind: 'ok'; ast: ExprNode; deps: string[]; selfRef: boolean }
  | { kind: 'parse-failed'; detail: string }

class RefFail {
  readonly code: MRegCode
  readonly detail?: string
  constructor(code: MRegCode, detail?: string) {
    this.code = code
    this.detail = detail
  }
}

export function evaluateRegisters(view: RegisterSnapshotView): Map<string, RegisterOutcome> {
  const ids = view.registers.map((r) => r.id)
  const idSet = new Set(ids)
  const result = new Map<string, RegisterOutcome>()

  // 1. parse each expr; collect Register→Register deps + reverse edges
  const prepared = new Map<string, Prepared>()
  const deps = new Map<string, string[]>() // id → registers it depends on (unique, excl. self)
  const dependents = new Map<string, string[]>() // id → registers that depend on it
  for (const id of ids) dependents.set(id, [])

  for (const r of view.registers) {
    const p = parse(r.expr)
    if (!p.ok) {
      prepared.set(r.id, { kind: 'parse-failed', detail: p.error.code })
      deps.set(r.id, [])
      continue
    }
    const refs = refsOf(p.ast)
    const selfRef = refs.includes(r.id)
    const regDeps = [...new Set(refs.filter((t) => idSet.has(t) && t !== r.id))]
    prepared.set(r.id, { kind: 'ok', ast: p.ast, deps: regDeps, selfRef })
    deps.set(r.id, regDeps)
    for (const d of regDeps) dependents.get(d)!.push(r.id)
  }

  // 2. resolve one register whose register-deps are all already in `result`
  const evalOne = (id: string): RegisterOutcome => {
    const prep = prepared.get(id)!
    if (prep.kind === 'parse-failed') {
      return { invalid: true, code: 'M_REG_PARSE', detail: prep.detail }
    }
    if (prep.selfRef) return { invalid: true, code: 'M_REG_CYCLE' } // a self-ref is a cycle
    try {
      const ev = evaluate(prep.ast, (refId) => {
        if (hasControlChar(refId)) throw new RefFail('M_REG_INVALID_ID', refId)
        switch (view.refKind(refId)) {
          case 'missing':
            throw new RefFail('M_REG_UNKNOWN_REF', refId)
          case 'other':
            throw new RefFail('M_REG_WRONG_KIND', refId)
          case 'pool':
            return { ok: true, value: view.poolCount(refId) }
          case 'parameter':
            return { ok: true, value: view.paramValue(refId) }
          case 'register': {
            const dep = result.get(refId)
            if (!dep || dep.invalid) throw new RefFail('M_REG_DEPENDS_ON_INVALID', refId)
            return { ok: true, value: dep.value }
          }
        }
      })
      if (ev.ok) return { invalid: false, value: ev.value }
      if (ev.error.class === 'evaluate') return { invalid: true, code: 'M_REG_EVAL', detail: ev.error.code }
      return ev.error.code === 'REF_UNKNOWN'
        ? { invalid: true, code: 'M_REG_UNKNOWN_REF' }
        : ev.error.code === 'REF_WRONG_KIND'
          ? { invalid: true, code: 'M_REG_WRONG_KIND' }
          : ev.error.code === 'REF_INVALID_ID'
            ? { invalid: true, code: 'M_REG_INVALID_ID' }
            : { invalid: true, code: 'M_REG_EVAL', detail: ev.error.code }
    } catch (e) {
      if (e instanceof RefFail) return { invalid: true, code: e.code, detail: e.detail }
      throw e
    }
  }

  const isSelfRef = (id: string): boolean => {
    const p = prepared.get(id)!
    return p.kind === 'ok' && p.selfRef
  }

  // 3. iterative Kahn topological pass — no recursion for the acyclic majority.
  //    A self-referential Register is never enqueued (it is a cycle, step 4).
  const pending = new Map<string, number>() // id → count of register-deps not yet resolved
  const queue: string[] = []
  for (const id of ids) {
    const n = deps.get(id)!.length
    pending.set(id, n)
    if (n === 0 && !isSelfRef(id)) queue.push(id)
  }
  let qi = 0
  while (qi < queue.length) {
    const id = queue[qi++]
    result.set(id, evalOne(id))
    for (const dep of dependents.get(id)!) {
      if (result.has(dep)) continue
      const left = pending.get(dep)! - 1
      pending.set(dep, left)
      if (left === 0 && !isSelfRef(dep)) queue.push(dep)
    }
  }

  // 4. whatever is left is on, or downstream of, a cycle. Classify with a
  //    depth-guarded DFS over just this sub-graph (tiny in practice).
  const unresolved = ids.filter((id) => !result.has(id))
  if (unresolved.length > 0) {
    const onCycle = cycleMembers(unresolved, deps)
    for (const id of unresolved) if (isSelfRef(id)) onCycle.add(id)
    for (const id of unresolved) {
      result.set(id, {
        invalid: true,
        code: onCycle.has(id) ? 'M_REG_CYCLE' : 'M_REG_DEPENDS_ON_INVALID',
      })
    }
  }

  return result
}

/**
 * Return the ids in `nodes` that lie on a dependency cycle (a non-trivial SCC,
 * or a self-loop). Iterative-friendly recursion capped at MAX_CYCLE_DFS_DEPTH —
 * beyond that every still-unclassified node is treated as on a cycle.
 */
function cycleMembers(nodes: string[], deps: Map<string, string[]>): Set<string> {
  const set = new Set(nodes)
  const onCycle = new Set<string>()
  // colour: 0 = unseen, 1 = on the current DFS path, 2 = done
  const colour = new Map<string, number>()
  for (const n of nodes) colour.set(n, 0)

  for (const root of nodes) {
    if (colour.get(root) !== 0) continue
    // explicit stack of { node, iterator index into its deps }
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }]
    colour.set(root, 1)
    while (stack.length > 0) {
      if (stack.length > MAX_CYCLE_DFS_DEPTH) {
        for (const f of stack) onCycle.add(f.id)
        stack.length = 0
        break
      }
      const frame = stack[stack.length - 1]
      const edges = (deps.get(frame.id) ?? []).filter((d) => set.has(d))
      if (frame.i < edges.length) {
        const w = edges[frame.i++]
        const c = colour.get(w) ?? 2
        if (c === 1) {
          // back-edge → every node from `w` up the stack is on the cycle
          let mark = false
          for (const f of stack) {
            if (f.id === w) mark = true
            if (mark) onCycle.add(f.id)
          }
        } else if (c === 0) {
          colour.set(w, 1)
          stack.push({ id: w, i: 0 })
        }
      } else {
        colour.set(frame.id, 2)
        stack.pop()
      }
    }
  }
  return onCycle
}
