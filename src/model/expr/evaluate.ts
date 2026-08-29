// loop-expr/1 (SEMANTICS-X.md §X5 / §X6) — the evaluator.
//
// Pure and deterministic: a function of the AST and the finite numbers
// `resolve` returns per `@id` (X-INV-2). Single depth-first left-to-right pass,
// no short-circuit; the FIRST error in that order is reported. Every result is
// finite or it is a §X7 evaluate error — never NaN / ±Infinity / a stand-in
// (X-INV-1).

import type { ExprNode } from './ast'
import { type ExprError, type ExprResolveError, evalError, resolveError } from './errors'

export type ResolveOutcome =
  | { ok: true; value: number }
  | { ok: false; error: ExprResolveError }

/** Resolver for `@id` references. `loop-model/1` §M3.1 decides which kinds
 *  resolve and to what number; this signature is all `loop-expr/1` needs. */
export type Resolver = (id: string) => ResolveOutcome

export type EvalResult = { ok: true; value: number } | { ok: false; error: ExprError }

class EvalFailure {
  readonly error: ExprError
  constructor(error: ExprError) {
    this.error = error
  }
}

const norm = (x: number) => (Object.is(x, -0) ? 0 : x)

function walk(node: ExprNode, resolve: Resolver): number {
  switch (node.type) {
    case 'number':
      return norm(node.value)

    case 'ref': {
      const out = resolve(node.id)
      if (!out.ok) throw new EvalFailure(out.error)
      if (!Number.isFinite(out.value)) {
        throw new EvalFailure(resolveError('REF_NOT_FINITE', node.id))
      }
      return norm(out.value)
    }

    case 'unary': {
      const v = walk(node.operand, resolve)
      const r = -v
      if (!Number.isFinite(r)) throw new EvalFailure(evalError('EVAL_NOT_FINITE'))
      return norm(r)
    }

    case 'binary': {
      const l = walk(node.left, resolve) // left first (§X6 left-to-right)
      const r = walk(node.right, resolve)
      let out: number
      switch (node.op) {
        case '+':
          out = l + r
          break
        case '-':
          out = l - r
          break
        case '*':
          out = l * r
          break
        case '/':
          if (r === 0) throw new EvalFailure(evalError('EVAL_DIV_ZERO'))
          out = l / r
          break
      }
      if (Number.isNaN(out) || !Number.isFinite(out)) {
        throw new EvalFailure(evalError('EVAL_NOT_FINITE'))
      }
      return norm(out)
    }
  }
}

export function evaluate(ast: ExprNode, resolve: Resolver): EvalResult {
  try {
    return { ok: true, value: walk(ast, resolve) }
  } catch (e) {
    if (e instanceof EvalFailure) return { ok: false, error: e.error }
    throw e
  }
}
