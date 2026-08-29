// loop-model/1 (SEMANTICS-M.md §M3) — the pure Register evaluation pass.
//
// `R(k) = evaluate every Register against the committed snapshot S(k)` in one
// topo-ordered DAG pass. A Register on a dependency cycle, or whose expression
// parses/evaluates to an error, or that references something unresolvable /
// wrong-kind, is `invalid` and skipped; Registers depending on it cascade to
// `invalid` (`depends-on-invalid`). Deterministic — independent Registers are
// order-independent (pure eval, §X6), so `R(k)` is a function of `S(k)`.

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

const hasControlChar = (id: string): boolean => {
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    if ((c >= 0x00 && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) return true
  }
  return false
}

type Prepared =
  | { id: string; kind: 'ok'; ast: ExprNode; deps: string[] }
  | { id: string; kind: 'parse-failed'; code: 'M_REG_PARSE'; detail: string }

/** Tarjan SCC — returns the set of Register ids that sit on a dependency cycle
 *  (an SCC of size > 1, or a self-referential singleton). */
function registersOnCycle(ids: string[], depsOf: Map<string, string[]>): Set<string> {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const onCycle = new Set<string>()
  let counter = 0

  const strongconnect = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter++
    stack.push(v)
    onStack.add(v)
    for (const w of depsOf.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!))
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = []
      for (;;) {
        const w = stack.pop()!
        onStack.delete(w)
        comp.push(w)
        if (w === v) break
      }
      const selfLoop = comp.length === 1 && (depsOf.get(comp[0]) ?? []).includes(comp[0])
      if (comp.length > 1 || selfLoop) for (const w of comp) onCycle.add(w)
    }
  }

  for (const id of ids) if (!index.has(id)) strongconnect(id)
  return onCycle
}

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

  // 1. parse each expr; collect Register→Register deps
  const prepared = new Map<string, Prepared>()
  const depsOf = new Map<string, string[]>()
  for (const r of view.registers) {
    const p = parse(r.expr)
    if (!p.ok) {
      prepared.set(r.id, { id: r.id, kind: 'parse-failed', code: 'M_REG_PARSE', detail: p.error.code })
      depsOf.set(r.id, [])
      continue
    }
    const deps = refsOf(p.ast).filter((t) => idSet.has(t) && t !== r.id)
    // a self-reference is still a cycle
    const selfDep = refsOf(p.ast).includes(r.id)
    prepared.set(r.id, { id: r.id, kind: 'ok', ast: p.ast, deps })
    depsOf.set(r.id, selfDep ? [...deps, r.id] : deps)
  }

  // 2. cycle detection
  const onCycle = registersOnCycle(ids, depsOf)

  // 3. evaluate in dependency order (memoised DFS; cycle nodes short-circuit)
  const evaluating = new Set<string>()
  const compute = (id: string): RegisterOutcome => {
    const cached = result.get(id)
    if (cached) return cached

    if (onCycle.has(id)) {
      const out: RegisterOutcome = { invalid: true, code: 'M_REG_CYCLE' }
      result.set(id, out)
      return out
    }

    const prep = prepared.get(id)!
    if (prep.kind === 'parse-failed') {
      const out: RegisterOutcome = { invalid: true, code: 'M_REG_PARSE', detail: prep.detail }
      result.set(id, out)
      return out
    }

    evaluating.add(id)
    let out: RegisterOutcome
    try {
      const ev = evaluate(prep.ast, (refId) => {
        if (hasControlChar(refId)) throw new RefFail('M_REG_INVALID_ID', refId)
        const kind = view.refKind(refId)
        switch (kind) {
          case 'missing':
            throw new RefFail('M_REG_UNKNOWN_REF', refId)
          case 'other':
            throw new RefFail('M_REG_WRONG_KIND', refId)
          case 'pool':
            return { ok: true, value: view.poolCount(refId) }
          case 'parameter':
            return { ok: true, value: view.paramValue(refId) }
          case 'register': {
            const dep = compute(refId)
            if (dep.invalid) throw new RefFail('M_REG_DEPENDS_ON_INVALID', refId)
            return { ok: true, value: dep.value }
          }
        }
      })
      if (ev.ok) {
        out = { invalid: false, value: ev.value }
      } else if (ev.error.class === 'evaluate') {
        out = { invalid: true, code: 'M_REG_EVAL', detail: ev.error.code }
      } else {
        // a resolve error we surfaced from the resolver: map the loop-expr code
        out =
          ev.error.code === 'REF_UNKNOWN'
            ? { invalid: true, code: 'M_REG_UNKNOWN_REF' }
            : ev.error.code === 'REF_WRONG_KIND'
              ? { invalid: true, code: 'M_REG_WRONG_KIND' }
              : ev.error.code === 'REF_INVALID_ID'
                ? { invalid: true, code: 'M_REG_INVALID_ID' }
                : { invalid: true, code: 'M_REG_EVAL', detail: ev.error.code }
      }
    } catch (e) {
      if (e instanceof RefFail) {
        out = { invalid: true, code: e.code, detail: e.detail }
      } else {
        throw e
      }
    } finally {
      evaluating.delete(id)
    }
    result.set(id, out)
    return out
  }

  for (const id of ids) compute(id)
  return result
}
