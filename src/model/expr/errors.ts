// loop-expr/1 (SEMANTICS-X.md §X7) — the enumerated error contract.
//
// The CODES are frozen and part of the compatibility surface (X-INV-8). The
// human strings here are the non-normative Appendix X-A wording (X-4) and may
// be reworded without a spec change.

export type ExprParseCode =
  | 'EXPR_EMPTY'
  | 'EXPR_SYNTAX'
  | 'EXPR_UNCLOSED_PAREN'
  | 'EXPR_UNCLOSED_REF'
  | 'EXPR_BAD_ESCAPE'
  | 'EXPR_NUMBER_RANGE'
  | 'EXPR_BAD_TOKEN'

export type ExprResolveCode =
  | 'REF_UNKNOWN'
  | 'REF_WRONG_KIND'
  | 'REF_INVALID_ID'
  | 'REF_NOT_FINITE'

export type ExprEvalCode = 'EVAL_DIV_ZERO' | 'EVAL_NOT_FINITE'

export type ExprErrorCode = ExprParseCode | ExprResolveCode | ExprEvalCode

/** A parse failure: carries a 1-based `column` into the raw text (§X7). */
export type ExprParseError = {
  class: 'parse'
  code: ExprParseCode
  column: number
  message: string
}

/** A resolve failure: carries the offending `id` (§X7). */
export type ExprResolveError = {
  class: 'resolve'
  code: ExprResolveCode
  id: string
  message: string
}

/** An evaluate failure: a runtime fact, no text position (§X7). */
export type ExprEvalError = {
  class: 'evaluate'
  code: ExprEvalCode
  message: string
}

export type ExprError = ExprParseError | ExprResolveError | ExprEvalError

export function parseError(
  code: ExprParseCode,
  column: number,
  detail?: string,
): ExprParseError {
  return { class: 'parse', code, column, message: parseMessage(code, column, detail) }
}

export function resolveError(code: ExprResolveCode, id: string, detail?: string): ExprResolveError {
  return { class: 'resolve', code, id, message: resolveMessage(code, id, detail) }
}

export function evalError(code: ExprEvalCode): ExprEvalError {
  return { class: 'evaluate', code, message: EVAL_STRINGS[code] }
}

// ── Appendix X-A strings (non-normative) ──────────────────────────────────

function parseMessage(code: ExprParseCode, column: number, detail?: string): string {
  switch (code) {
    case 'EXPR_EMPTY':
      return 'the expression is empty'
    case 'EXPR_SYNTAX':
      return detail ?? `unexpected token at column ${column}`
    case 'EXPR_UNCLOSED_PAREN':
      return `"(" at column ${column} is never closed`
    case 'EXPR_UNCLOSED_REF':
      return `"@{" at column ${column} is never closed`
    case 'EXPR_BAD_ESCAPE':
      return `"\\" at column ${column} must be followed by "}" or "\\"`
    case 'EXPR_NUMBER_RANGE':
      return `the number at column ${column} is too large`
    case 'EXPR_BAD_TOKEN':
      return detail ? `stray ${detail} at column ${column}` : `stray character at column ${column}`
  }
}

function resolveMessage(code: ExprResolveCode, id: string, detail?: string): string {
  switch (code) {
    case 'REF_UNKNOWN':
      return `no node with id "${id}"`
    case 'REF_WRONG_KIND':
      return `"${id}" is a ${detail ?? 'node'}; only pools, parameters and registers can be referenced`
    case 'REF_INVALID_ID':
      return `node "${id}" has an invalid id (contains a control character) and cannot be referenced`
    case 'REF_NOT_FINITE':
      return `"${id}" has no finite value`
  }
}

const EVAL_STRINGS: Record<ExprEvalCode, string> = {
  EVAL_DIV_ZERO: 'division by zero',
  EVAL_NOT_FINITE: 'the result is not a finite number',
}
