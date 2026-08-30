import { describe, expect, it } from 'vitest'
import { canonicaliseExpr, evaluate, parse, refsOf, type Resolver } from './index'

// SEMANTICS-X.md puts NO numeric cap on an expression (§X2). A grammatically
// valid string of any depth MUST parse, evaluate, canonicalise, and have its
// refs collected — with no artificial EXPR_SYNTAX and no thrown RangeError.
// The parser, evaluator, canonical printer, and refsOf are all explicit-stack.

const one: Resolver = () => ({ ok: true, value: 1 })
const N = 60_000

describe('loop-expr/1 — deep but valid expressions succeed (no artificial limit)', () => {
  it('deeply nested parentheses parse and evaluate', () => {
    const src = '('.repeat(N) + '@a + 2' + ')'.repeat(N)
    const r = parse(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ev = evaluate(r.ast, one)
    expect(ev.ok && ev.value).toBe(3)
    expect(canonicaliseExpr(src)).toBe('@a + 2')
    expect(refsOf(r.ast)).toEqual(['a'])
  })

  it('deeply stacked unary minus parses and evaluates (parity of the count)', () => {
    const evenR = parse('-'.repeat(N) + '@a') // even ⇒ +1
    const oddR = parse('-'.repeat(N + 1) + '@a') // odd ⇒ -1
    expect(evenR.ok && oddR.ok).toBe(true)
    if (!evenR.ok || !oddR.ok) return
    expect(evaluate(evenR.ast, one)).toEqual({ ok: true, value: 1 })
    expect(evaluate(oddR.ast, one)).toEqual({ ok: true, value: -1 })
    expect(canonicaliseExpr('-'.repeat(4) + '@a')).toBe('----@a')
  })

  it('a very long left-assoc chain parses, evaluates, and canonicalises', () => {
    const src = Array.from({ length: N }, () => '@a').join(' + ')
    const r = parse(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(evaluate(r.ast, one)).toEqual({ ok: true, value: N })
    // canonical form of a left chain is itself, one space per operator
    expect(canonicaliseExpr(src)).toBe(src)
    expect(refsOf(r.ast)).toEqual(['a'])
  })

  it('a deep chain that hits a div-by-zero still reports the FIRST error, no overflow', () => {
    const src = `${Array.from({ length: N }, () => '1').join(' + ')} + 1 / 0`
    const r = parse(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(evaluate(r.ast, one)).toEqual({ ok: false, error: expect.objectContaining({ code: 'EVAL_DIV_ZERO' }) })
  })

  it('a genuinely invalid deep string still returns a clean §X7 code', () => {
    // 60k opens, only 59,999 closes ⇒ one unclosed paren
    const r = parse('('.repeat(N) + '1' + ')'.repeat(N - 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('EXPR_UNCLOSED_PAREN')
  })
})
