// loop-expr/1 (SEMANTICS-X.md §X5 / §X6) — the evaluator.
//
// Pure and deterministic: a function of the AST and the finite numbers
// `resolve` returns per `@id` (X-INV-2). Single depth-first left-to-right pass,
// no short-circuit; the FIRST error in that order is reported. Every result is
// finite or it is a §X7 evaluate error — never NaN / ±Infinity / a stand-in
// (X-INV-1). The walk uses an explicit work stack, so an AST of any depth
// evaluates without growing the call stack.

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

const apply = (op: '+' | '-' | '*' | '/', l: number, r: number): number => {
  switch (op) {
    case '+':
      return l + r
    case '-':
      return l - r
    case '*':
      return l * r
    case '/': {
      if (r === 0) throw new EvalFailure(evalError('EVAL_DIV_ZERO'))
      return l / r
    }
  }
}

type Frame = { node: ExprNode; entered: boolean }

/** Iterative depth-first, left-to-right post-order walk (§X6). */
function walk(ast: ExprNode, resolve: Resolver): number {
  const work: Frame[] = [{ node: ast, entered: false }]
  const vals: number[] = []

  while (work.length > 0) {
    const frame = work[work.length - 1]
    const node = frame.node

    if (node.type === 'number') {
      work.pop()
      vals.push(norm(node.value))
      continue
    }
    if (node.type === 'ref') {
      work.pop()
      const out = resolve(node.id)
      if (!out.ok) throw new EvalFailure(out.error)
      if (!Number.isFinite(out.value)) throw new EvalFailure(resolveError('REF_NOT_FINITE', node.id))
      vals.push(norm(out.value))
      continue
    }

    if (!frame.entered) {
      frame.entered = true
      // push children so the LEFT operand is evaluated first (§X6)
      if (node.type === 'unary') {
        work.push({ node: node.operand, entered: false })
      } else {
        work.push({ node: node.right, entered: false })
        work.push({ node: node.left, entered: false })
      }
      continue
    }

    // post-order: operand value(s) are on top of `vals`
    work.pop()
    let out: number
    if (node.type === 'unary') {
      out = -vals.pop()!
    } else {
      const r = vals.pop()!
      const l = vals.pop()!
      out = apply(node.op, l, r)
    }
    if (Number.isNaN(out) || !Number.isFinite(out)) throw new EvalFailure(evalError('EVAL_NOT_FINITE'))
    vals.push(norm(out))
  }

  return vals[0]
}

export function evaluate(ast: ExprNode, resolve: Resolver): EvalResult {
  try {
    return { ok: true, value: walk(ast, resolve) }
  } catch (e) {
    if (e instanceof EvalFailure) return { ok: false, error: e.error }
    throw e
  }
}
