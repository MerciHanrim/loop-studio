import { describe, expect, it } from 'vitest'
import { canonicaliseExpr, evaluate, parse, type Resolver } from './index'
import { MAX_EXPR_DEPTH } from './parse'

// SEMANTICS-X.md sets no numeric size cap, but a pathological string must never
// crash the recursive-descent parser or the AST walks — it must return a clean
// §X7 parse error (X-INV-8), never a thrown RangeError.

const num: Resolver = () => ({ ok: true, value: 1 })

describe('loop-expr/1 — pathological input never overflows the stack', () => {
  it('deeply nested parentheses → EXPR_SYNTAX, no throw', () => {
    const deep = '('.repeat(50_000) + '1' + ')'.repeat(50_000)
    const r = parse(deep)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('EXPR_SYNTAX')
  })

  it('deeply stacked unary minus → EXPR_SYNTAX, no throw', () => {
    const r = parse('-'.repeat(50_000) + '@a')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('EXPR_SYNTAX')
  })

  it('a very long left-assoc chain → EXPR_SYNTAX, no throw', () => {
    const chain = Array.from({ length: 50_000 }, () => '@a').join(' + ')
    const r = parse(chain)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('EXPR_SYNTAX')
  })

  it('accepts nesting up to the limit and evaluates / canonicalises it', () => {
    const n = MAX_EXPR_DEPTH - 1
    const src = '('.repeat(n) + '@a + 1' + ')'.repeat(n)
    const r = parse(src)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const ev = evaluate(r.ast, num)
      expect(ev.ok && ev.value).toBe(2)
      expect(canonicaliseExpr(src)).toBe('@a + 1')
    }
  })

  it('a chain just under the limit still evaluates', () => {
    const chain = Array.from({ length: MAX_EXPR_DEPTH - 1 }, () => '1').join(' + ')
    const r = parse(chain)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const ev = evaluate(r.ast, num)
      expect(ev.ok && ev.value).toBe(MAX_EXPR_DEPTH - 1)
    }
  })
})
