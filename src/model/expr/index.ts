// loop-expr/1 (SEMANTICS-X.md) — public surface.
//
// A small, deterministic arithmetic language: finite number literals, `@id` /
// `@{id}` node references, grouping, unary minus, binary `+ - * /`. Used by
// `loop-model/1` for Register expressions. Everything beyond the arithmetic
// core (functions, comparisons, `?:`) is a deferred amendment (§X11 X-1).

export type { ExprNode } from './ast'
export {
  type ExprError,
  type ExprErrorCode,
  type ExprEvalCode,
  type ExprEvalError,
  type ExprParseCode,
  type ExprParseError,
  type ExprResolveCode,
  type ExprResolveError,
} from './errors'
export { canonicalNumber, canonicalPrint, canonicalRef, SAFE_ID } from './canonical'
export { evaluate, type EvalResult, type Resolver, type ResolveOutcome } from './evaluate'
export { parse, type ParseResult } from './parse'

import type { ExprNode } from './ast'
import { canonicalPrint } from './canonical'
import type { ExprParseError } from './errors'
import { parse } from './parse'

export type ParsedExpr = { ast: ExprNode; canonical: string }
export type ParseExprResult = { ok: true; expr: ParsedExpr } | { ok: false; error: ExprParseError }

/** Parse and, on success, also compute the §X8 canonical text. */
export function parseExpr(src: string): ParseExprResult {
  const r = parse(src)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, expr: { ast: r.ast, canonical: canonicalPrint(r.ast) } }
}

/**
 * §X8 — the stored / digested form. Returns the canonical re-serialisation of
 * `src`'s AST, or `null` when `src` does not parse (the caller decides what an
 * unparseable expression means — for `loop-model/1` it is a malformed file,
 * `SEMANTICS-R2.md` §R2-1.1).
 */
export function canonicaliseExpr(src: string): string | null {
  const r = parse(src)
  return r.ok ? canonicalPrint(r.ast) : null
}

/** Collect every distinct `@id` target referenced by an AST, in first-seen
 *  (left-to-right) order. Iterative — safe for an AST of any depth. */
export function refsOf(ast: ExprNode): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const stack: ExprNode[] = [ast]
  while (stack.length > 0) {
    const n = stack.pop()!
    switch (n.type) {
      case 'ref':
        if (!seen.has(n.id)) {
          seen.add(n.id)
          out.push(n.id)
        }
        break
      case 'unary':
        stack.push(n.operand)
        break
      case 'binary':
        stack.push(n.right) // push right first so the left subtree is visited first
        stack.push(n.left)
        break
      case 'number':
        break
    }
  }
  return out
}
