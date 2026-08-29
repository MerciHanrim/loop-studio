// loop-expr/1 (SEMANTICS-X.md §X2) — recursive-descent parser.
//
//   expr    = add
//   add     = mul ( ("+"|"-") mul )*        left-assoc
//   mul     = unary ( ("*"|"/") unary )*    left-assoc
//   unary   = "-" unary | primary           prefix, right-assoc, stackable
//   primary = number | ref | "(" expr ")"
//
// There is exactly one parse for any accepted string (§X2). A failure yields a
// single §X7 parse error with a 1-based column.

import { bin, type ExprNode, neg, num, ref } from './ast'
import { type ExprParseError, parseError } from './errors'
import { type Token, tokenize } from './tokenize'

export type ParseResult = { ok: true; ast: ExprNode } | { ok: false; error: ExprParseError }

/**
 * Grammar-nesting guard. §X sets no numeric cap on an expression, but the
 * recursive-descent parser (and the AST walk in `evaluate`) must not overflow
 * the call stack on a pathological input. Real Register expressions nest a
 * handful deep; this limit is orders of magnitude above any legitimate use, so
 * hitting it means a hand-crafted/hostile string, reported as an ordinary §X7
 * parse error (`EXPR_SYNTAX`) with a column — never a thrown `RangeError`.
 */
export const MAX_EXPR_DEPTH = 1000

class ParseAbort {
  readonly error: ExprParseError
  constructor(error: ExprParseError) {
    this.error = error
  }
}

export function parse(src: string): ParseResult {
  if (src.trim() === '') return { ok: false, error: parseError('EXPR_EMPTY', 1) }

  const lexed = tokenize(src)
  if (!lexed.ok) return { ok: false, error: lexed.error }
  const toks = lexed.tokens

  let pos = 0
  const peek = (): Token => toks[pos]
  const advance = (): Token => toks[pos++]

  const abort = (err: ExprParseError): never => {
    throw new ParseAbort(err)
  }

  let depth = 0
  const descend = <T>(at: number, fn: () => T): T => {
    if (++depth > MAX_EXPR_DEPTH) {
      abort(parseError('EXPR_SYNTAX', at, `expression nested too deeply at column ${at}`))
    }
    try {
      return fn()
    } finally {
      depth--
    }
  }

  const parseExpr = (): ExprNode => parseAdd()

  // A left-assoc chain builds a left-leaning spine that `evaluate` / the
  // canonical printer later walk recursively; cap its length with the same
  // guard so a 100k-long `@a + @a + …` cannot overflow those walks.
  const parseAdd = (): ExprNode => {
    let left = parseMul()
    let run = 0
    for (;;) {
      const t = peek()
      if (t.type === 'op' && (t.op === '+' || t.op === '-')) {
        if (++run > MAX_EXPR_DEPTH) abort(parseError('EXPR_SYNTAX', t.col, `expression nested too deeply at column ${t.col}`))
        advance()
        const right = parseMul()
        left = bin(t.op, left, right)
      } else break
    }
    return left
  }

  const parseMul = (): ExprNode => {
    let left = parseUnary()
    let run = 0
    for (;;) {
      const t = peek()
      if (t.type === 'op' && (t.op === '*' || t.op === '/')) {
        if (++run > MAX_EXPR_DEPTH) abort(parseError('EXPR_SYNTAX', t.col, `expression nested too deeply at column ${t.col}`))
        advance()
        const right = parseUnary()
        left = bin(t.op, left, right)
      } else break
    }
    return left
  }

  const parseUnary = (): ExprNode => {
    const t = peek()
    if (t.type === 'op' && t.op === '-') {
      advance()
      return neg(descend(t.col, parseUnary))
    }
    return parsePrimary()
  }

  const parsePrimary = (): ExprNode => {
    const t = peek()
    if (t.type === 'number') {
      advance()
      return num(t.value)
    }
    if (t.type === 'ref') {
      advance()
      return ref(t.id)
    }
    if (t.type === 'lparen') {
      const open = advance()
      const inner = descend(open.col, parseExpr)
      const close = peek()
      if (close.type !== 'rparen') {
        abort(parseError('EXPR_UNCLOSED_PAREN', open.col))
      }
      advance()
      return inner
    }
    // number / ref / "(" expected here
    if (t.type === 'op') {
      abort(parseError('EXPR_SYNTAX', t.col, `unexpected "${t.op}" at column ${t.col}`))
    }
    if (t.type === 'rparen') {
      abort(parseError('EXPR_SYNTAX', t.col, `unexpected ")" at column ${t.col}`))
    }
    return abort(parseError('EXPR_SYNTAX', t.col, `expected a number, reference or "(" at column ${t.col}`))
  }

  try {
    const ast = parseExpr()
    const rest = peek()
    if (rest.type !== 'eof') {
      const what =
        rest.type === 'op'
          ? `"${rest.op}"`
          : rest.type === 'number'
            ? `"${rest.raw}"`
            : rest.type === 'ref'
              ? `a reference`
              : rest.type === 'rparen'
                ? `")"`
                : `a token`
      return {
        ok: false,
        error: parseError('EXPR_SYNTAX', rest.col, `unexpected ${what} at column ${rest.col}`),
      }
    }
    return { ok: true, ast }
  } catch (e) {
    if (e instanceof ParseAbort) return { ok: false, error: e.error }
    throw e
  }
}
