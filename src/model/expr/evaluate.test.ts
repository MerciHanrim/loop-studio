import { describe, expect, it } from 'vitest'
import { type Resolver, evaluate } from './evaluate'
import { parse } from './parse'
import { resolveError } from './errors'

// SEMANTICS-X.md §X5 (numeric rules), §X6 (evaluation model), §X7 (errors).

const ast = (src: string) => {
  const r = parse(src)
  if (!r.ok) throw new Error(`parse failed: ${r.error.code}`)
  return r.ast
}

const env = (m: Record<string, number>): Resolver => (id) =>
  id in m ? { ok: true, value: m[id] } : { ok: false, error: resolveError('REF_UNKNOWN', id) }

const val = (src: string, m: Record<string, number> = {}) => {
  const r = evaluate(ast(src), env(m))
  if (!r.ok) throw new Error(`eval error: ${r.error.code}`)
  return r.value
}
const evErr = (src: string, resolve: Resolver) => {
  const r = evaluate(ast(src), resolve)
  if (r.ok) throw new Error(`expected an error, got ${r.value}`)
  return r.error
}

describe('loop-expr/1 evaluate — arithmetic', () => {
  it('respects precedence, associativity, and grouping', () => {
    expect(val('1 + 2 * 3')).toBe(7)
    expect(val('(1 + 2) * 3')).toBe(9)
    expect(val('10 - 3 - 2')).toBe(5)
    expect(val('10 - (3 - 2)')).toBe(9)
    expect(val('2 * 3 / 4')).toBe(1.5)
    expect(val('--5')).toBe(5)
    expect(val('-@a * @b', { a: 2, b: 3 })).toBe(-6)
  })

  it('resolves @id via the resolver', () => {
    expect(val('@rev - @cost', { rev: 100, cost: 42 })).toBe(58)
    expect(val('@{pool x} / 2', { 'pool x': 9 })).toBe(4.5)
  })

  it('normalises -0 to 0', () => {
    expect(Object.is(val('-0'), 0)).toBe(true)
    expect(Object.is(val('0 * -1'), 0)).toBe(true)
  })
})

describe('loop-expr/1 evaluate — errors (§X7)', () => {
  it('division by zero → EVAL_DIV_ZERO (incl. 0 / 0)', () => {
    expect(evErr('1 / 0', env({})).code).toBe('EVAL_DIV_ZERO')
    expect(evErr('0 / 0', env({})).code).toBe('EVAL_DIV_ZERO')
    expect(evErr('@a / (@b - @b)', env({ a: 1, b: 5 })).code).toBe('EVAL_DIV_ZERO')
  })

  it('a non-finite intermediate/final result → EVAL_NOT_FINITE', () => {
    expect(evErr('@big * @big', env({ big: 1e200 })).code).toBe('EVAL_NOT_FINITE')
    expect(evErr('@big + @big', env({ big: Number.MAX_VALUE })).code).toBe('EVAL_NOT_FINITE')
  })

  it('a resolve failure surfaces the resolver error (first, left-to-right)', () => {
    const r: Resolver = (id) =>
      id === 'a'
        ? { ok: false, error: resolveError('REF_WRONG_KIND', id, 'gate') }
        : { ok: false, error: resolveError('REF_UNKNOWN', id) }
    // left operand fails first
    expect(evErr('@a + @b', r).code).toBe('REF_WRONG_KIND')
    expect(evErr('@b + @a', r).code).toBe('REF_UNKNOWN')
  })

  it('a resolver that returns a non-finite value → REF_NOT_FINITE (defensive)', () => {
    const r: Resolver = () => ({ ok: true, value: Number.POSITIVE_INFINITY })
    expect(evErr('@a', r).code).toBe('REF_NOT_FINITE')
  })

  it('is pure: same AST + same inputs ⇒ identical result', () => {
    const a = ast('@x * @x - @y / 2')
    const e = env({ x: 3, y: 8 })
    const r1 = evaluate(a, e)
    const r2 = evaluate(a, e)
    expect(r1).toEqual(r2)
    expect(r1.ok && r1.value).toBe(5)
  })
})
