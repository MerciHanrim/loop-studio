// loop-expr/1 (SEMANTICS-X.md §X2) — an explicit-stack (shunting-yard) parser.
//
//   expr    = add
//   add     = mul ( ("+"|"-") mul )*        left-assoc
//   mul     = unary ( ("*"|"/") unary )*    left-assoc
//   unary   = "-" unary | primary           prefix, right-assoc, stackable
//   primary = number | ref | "(" expr ")"
//
// There is exactly one parse for any accepted string (§X2). §X puts **no**
// numeric cap on an expression, so a grammatically valid string of any depth
// parses successfully — the two working stacks grow on the heap, never the
// call stack. A failure yields a single §X7 parse error with a 1-based column.

import { bin, type ExprNode, neg, num, ref } from './ast'
import { type ExprParseError, parseError } from './errors'
import { tokenize } from './tokenize'

export type ParseResult = { ok: true; ast: ExprNode } | { ok: false; error: ExprParseError }

type OpEntry =
  | { kind: 'binop'; op: '+' | '-' | '*' | '/'; prec: 1 | 2; col: number }
  | { kind: 'unary'; col: number }
  | { kind: 'lparen'; col: number }

const binPrec = (op: '+' | '-' | '*' | '/'): 1 | 2 => (op === '+' || op === '-' ? 1 : 2)

export function parse(src: string): ParseResult {
  if (src.trim() === '') return { ok: false, error: parseError('EXPR_EMPTY', 1) }

  const lexed = tokenize(src)
  if (!lexed.ok) return { ok: false, error: lexed.error }
  const toks = lexed.tokens

  const output: ExprNode[] = []
  const ops: OpEntry[] = []
  let expectOperand = true

  const fail = (err: ExprParseError): ParseResult => ({ ok: false, error: err })

  /** collapse the top operator into the output stack */
  const reduceTop = (): ExprParseError | null => {
    const top = ops.pop()!
    if (top.kind === 'unary') {
      if (output.length < 1) return parseError('EXPR_SYNTAX', top.col)
      output.push(neg(output.pop()!))
    } else if (top.kind === 'binop') {
      if (output.length < 2) return parseError('EXPR_SYNTAX', top.col)
      const r = output.pop()!
      const l = output.pop()!
      output.push(bin(top.op, l, r))
    }
    // a 'lparen' is never reduced (callers break on it) — nothing to do
    return null
  }

  for (const t of toks) {
    if (t.type === 'eof') break

    if (t.type === 'number' || t.type === 'ref') {
      if (!expectOperand) return fail(parseError('EXPR_SYNTAX', t.col))
      output.push(t.type === 'number' ? num(t.value) : ref(t.id))
      expectOperand = false
      continue
    }

    if (t.type === 'lparen') {
      if (!expectOperand) return fail(parseError('EXPR_SYNTAX', t.col))
      ops.push({ kind: 'lparen', col: t.col })
      continue
    }

    if (t.type === 'rparen') {
      if (expectOperand) return fail(parseError('EXPR_SYNTAX', t.col))
      while (ops.length > 0 && ops[ops.length - 1].kind !== 'lparen') {
        const e = reduceTop()
        if (e) return fail(e)
      }
      if (ops.length === 0) return fail(parseError('EXPR_SYNTAX', t.col)) // unmatched ")"
      ops.pop() // discard the matching "("
      expectOperand = false
      continue
    }

    // an operator token
    if (expectOperand) {
      if (t.op === '-') {
        ops.push({ kind: 'unary', col: t.col }) // prefix minus, right-assoc, stackable
        continue
      }
      // "+", "*", "/" cannot start an operand
      return fail(parseError('EXPR_SYNTAX', t.col, `unexpected "${t.op}" at column ${t.col}`))
    }
    // binary operator: pop while the top binds at least as tightly (left-assoc)
    const prec = binPrec(t.op)
    while (ops.length > 0) {
      const top = ops[ops.length - 1]
      if (top.kind === 'lparen') break
      const topPrec = top.kind === 'unary' ? 3 : top.prec
      if (topPrec < prec) break
      const e = reduceTop()
      if (e) return fail(e)
    }
    ops.push({ kind: 'binop', op: t.op, prec, col: t.col })
    expectOperand = true
  }

  // end of input
  if (expectOperand) {
    return fail(parseError('EXPR_SYNTAX', toks[toks.length - 1].col))
  }
  while (ops.length > 0) {
    const top = ops[ops.length - 1]
    if (top.kind === 'lparen') return fail(parseError('EXPR_UNCLOSED_PAREN', top.col))
    const e = reduceTop()
    if (e) return fail(e)
  }
  if (output.length !== 1) return fail(parseError('EXPR_SYNTAX', 1))
  return { ok: true, ast: output[0] }
}
