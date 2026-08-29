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

  const parseExpr = (): ExprNode => parseAdd()

  const parseAdd = (): ExprNode => {
    let left = parseMul()
    for (;;) {
      const t = peek()
      if (t.type === 'op' && (t.op === '+' || t.op === '-')) {
        advance()
        const right = parseMul()
        left = bin(t.op, left, right)
      } else break
    }
    return left
  }

  const parseMul = (): ExprNode => {
    let left = parseUnary()
    for (;;) {
      const t = peek()
      if (t.type === 'op' && (t.op === '*' || t.op === '/')) {
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
      return neg(parseUnary())
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
      const inner = parseExpr()
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
