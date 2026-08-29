// loop-expr/1 (SEMANTICS-X.md §X2 / §X3.1) — the lexer.
//
// Produces a flat token list with 1-based start columns. Whitespace (space,
// tab, CR, LF) between tokens is skipped; whitespace *inside* a token is
// EXPR_BAD_TOKEN. References are decoded here: `@id` and `@{id}` both yield a
// `ref` token whose `id` is the decoded target node id.

import { type ExprParseError, parseError } from './errors'

export type Token =
  | { type: 'number'; value: number; col: number; raw: string }
  | { type: 'ref'; id: string; col: number }
  | { type: 'op'; op: '+' | '-' | '*' | '/'; col: number }
  | { type: 'lparen'; col: number }
  | { type: 'rparen'; col: number }
  | { type: 'eof'; col: number }

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n'
const isDigit = (c: string) => c >= '0' && c <= '9'
const isAlpha = (c: string) =>
  (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_'
const isControl = (c: string) => {
  const p = c.codePointAt(0)!
  return (p >= 0x00 && p <= 0x1f) || (p >= 0x7f && p <= 0x9f)
}

const quoteChar = (c: string) => {
  if (c === '') return 'end of input'
  if (isControl(c)) return `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  return `"${c}"`
}

export function tokenize(src: string): { ok: true; tokens: Token[] } | { ok: false; error: ExprParseError } {
  const tokens: Token[] = []
  let i = 0
  const n = src.length

  while (i < n) {
    const c = src[i]
    if (isWs(c)) {
      i++
      continue
    }
    const col = i + 1 // 1-based

    // operators & parens
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ type: 'op', op: c, col })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', col })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', col })
      i++
      continue
    }

    // number: DIGIT+ ( "." DIGIT+ )? ( ("e"|"E") ("+"|"-")? DIGIT+ )?
    if (isDigit(c)) {
      let j = i
      while (j < n && isDigit(src[j])) j++
      if (src[j] === '.') {
        // require ≥ 1 digit after the point (`5.` is a parse error)
        if (!isDigit(src[j + 1])) {
          return { ok: false, error: parseError('EXPR_BAD_TOKEN', j + 1, quoteChar(src[j] ?? '')) }
        }
        j++
        while (j < n && isDigit(src[j])) j++
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1
        if (src[k] === '+' || src[k] === '-') k++
        if (!isDigit(src[k])) {
          // `1e`, `1e+` — stray char where an exponent digit was expected
          return { ok: false, error: parseError('EXPR_BAD_TOKEN', k + 1, quoteChar(src[k] ?? '')) }
        }
        k++
        while (k < n && isDigit(src[k])) k++
        j = k
      }
      const raw = src.slice(i, j)
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        return { ok: false, error: parseError('EXPR_NUMBER_RANGE', col) }
      }
      tokens.push({ type: 'number', value, col, raw })
      i = j
      continue
    }

    // reference: "@" ( safe-id | "{" braced-id "}" )
    if (c === '@') {
      const next = src[i + 1]
      if (next === '{') {
        let j = i + 2
        let id = ''
        let closed = false
        while (j < n) {
          const ch = src[j]
          if (ch === '\\') {
            const e = src[j + 1]
            if (e === '}' || e === '\\') {
              id += e
              j += 2
              continue
            }
            return { ok: false, error: parseError('EXPR_BAD_ESCAPE', j + 1) }
          }
          if (ch === '}') {
            closed = true
            j++
            break
          }
          if (isControl(ch)) {
            return { ok: false, error: parseError('EXPR_BAD_TOKEN', j + 1, quoteChar(ch)) }
          }
          id += ch
          j++
        }
        if (!closed) {
          return { ok: false, error: parseError('EXPR_UNCLOSED_REF', col) }
        }
        tokens.push({ type: 'ref', id, col })
        i = j
        continue
      }
      if (next != null && isAlpha(next)) {
        let j = i + 1
        while (j < n && (isAlpha(src[j]) || isDigit(src[j]))) j++
        tokens.push({ type: 'ref', id: src.slice(i + 1, j), col })
        i = j
        continue
      }
      // `@` followed by a digit, whitespace, punctuation, or EOF
      return { ok: false, error: parseError('EXPR_BAD_TOKEN', i + 2, quoteChar(next ?? '')) }
    }

    // anything else — stray character (identifiers, `%`, `^`, `!`, `?`, `:`, …)
    return { ok: false, error: parseError('EXPR_BAD_TOKEN', col, quoteChar(c)) }
  }

  tokens.push({ type: 'eof', col: n + 1 })
  return { ok: true, tokens }
}
