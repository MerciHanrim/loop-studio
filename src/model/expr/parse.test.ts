import { describe, expect, it } from 'vitest'
import { canonicalPrint } from './canonical'
import { parse } from './parse'

// SEMANTICS-X.md §X2 (grammar), §X3 (references), §X7 (parse errors).

const ok = (src: string) => {
  const r = parse(src)
  if (!r.ok) throw new Error(`expected parse ok for ${JSON.stringify(src)}, got ${r.error.code}`)
  return r.ast
}
const err = (src: string) => {
  const r = parse(src)
  if (r.ok) throw new Error(`expected parse error for ${JSON.stringify(src)}`)
  return r.error
}

const CTRL_1 = String.fromCharCode(0x01)
const CTRL_7F = String.fromCharCode(0x7f)

describe('loop-expr/1 parse — grammar', () => {
  it('parses a bare number, ref, and grouping', () => {
    expect(ok('1')).toEqual({ type: 'number', value: 1 })
    expect(ok('@pool_a')).toEqual({ type: 'ref', id: 'pool_a' })
    expect(canonicalPrint(ok('(1)'))).toBe('1')
  })

  it('precedence: + - < * / < unary - < primary', () => {
    expect(canonicalPrint(ok('@a + @b * @c'))).toBe('@a + @b * @c')
    expect(canonicalPrint(ok('(@a + @b) * @c'))).toBe('(@a + @b) * @c')
    expect(canonicalPrint(ok('-@a * @b'))).toBe('-@a * @b')
    expect(canonicalPrint(ok('-(@a * @b)'))).toBe('-(@a * @b)')
  })

  it('left-assoc for + - * /', () => {
    expect(canonicalPrint(ok('@a - @b - @c'))).toBe('@a - @b - @c')
    expect(canonicalPrint(ok('@a - (@b - @c)'))).toBe('@a - (@b - @c)')
    expect(canonicalPrint(ok('@a / @b / @c'))).toBe('@a / @b / @c')
    expect(canonicalPrint(ok('@a / (@b / @c)'))).toBe('@a / (@b / @c)')
  })

  it('unary minus stacks and binds tighter than *', () => {
    expect(canonicalPrint(ok('--@a'))).toBe('--@a')
    expect(canonicalPrint(ok('- - @a'))).toBe('--@a')
  })

  it('number literals require digits on both sides of the point', () => {
    expect(err('.5').code).toBe('EXPR_BAD_TOKEN')
    expect(err('5.').code).toBe('EXPR_BAD_TOKEN')
    expect(ok('0.5')).toEqual({ type: 'number', value: 0.5 })
    expect(ok('007')).toEqual({ type: 'number', value: 7 })
    expect(ok('1e3')).toEqual({ type: 'number', value: 1000 })
    expect(ok('2.5E-2')).toEqual({ type: 'number', value: 0.025 })
  })

  it('a non-finite literal is EXPR_NUMBER_RANGE', () => {
    const e = err('1e400')
    expect(e.code).toBe('EXPR_NUMBER_RANGE')
    expect(e.column).toBe(1)
  })

  it('whitespace between tokens is ignored; inside a token it is EXPR_BAD_TOKEN', () => {
    expect(canonicalPrint(ok('  @a   +\t@b\n'))).toBe('@a + @b')
    expect(err('1 . 5').code).toBe('EXPR_BAD_TOKEN')
    expect(err('1 e5').code).toBe('EXPR_BAD_TOKEN')
    expect(err('@ a').code).toBe('EXPR_BAD_TOKEN')
  })

  it('empty / all-whitespace is EXPR_EMPTY', () => {
    expect(err('').code).toBe('EXPR_EMPTY')
    expect(err('   \t\n').code).toBe('EXPR_EMPTY')
  })

  it('rejects every non-arithmetic token (X-INV-7)', () => {
    for (const bad of ['1 % 2', '2 ^ 3', '2 ** 3', '!@a', '@a > @b', '@a && @b', 'a', 'min(@a,@b)', '+@a']) {
      expect(err(bad).class).toBe('parse')
    }
  })

  it('unclosed paren / ref', () => {
    expect(err('(1 + 2').code).toBe('EXPR_UNCLOSED_PAREN')
    expect(err('@{pool').code).toBe('EXPR_UNCLOSED_REF')
  })

  it('trailing tokens after a complete expression', () => {
    expect(err('1 2').code).toBe('EXPR_SYNTAX')
    expect(err('@a @b').code).toBe('EXPR_SYNTAX')
    expect(err('(1) 1').code).toBe('EXPR_SYNTAX')
  })

  it('missing operand', () => {
    expect(err('@a +').code).toBe('EXPR_SYNTAX')
    expect(err('* @a').code).toBe('EXPR_SYNTAX')
    expect(err('()').code).toBe('EXPR_SYNTAX')
  })
})

describe('loop-expr/1 parse — references (§X3)', () => {
  it('bare @id decodes to the id', () => {
    expect(ok('@pool_mtc00jt3_2')).toEqual({ type: 'ref', id: 'pool_mtc00jt3_2' })
  })

  it('@{id} decodes braces and escapes; both forms denote the same target', () => {
    expect(ok('@{pool_x}')).toEqual({ type: 'ref', id: 'pool_x' })
    expect(ok('@{a-b.c}')).toEqual({ type: 'ref', id: 'a-b.c' })
    expect(ok('@{a\\}b}')).toEqual({ type: 'ref', id: 'a}b' })
    expect(ok('@{a\\\\b}')).toEqual({ type: 'ref', id: 'a\\b' })
    expect(ok('@{123 leading digit + space}')).toEqual({
      type: 'ref',
      id: '123 leading digit + space',
    })
  })

  it('a bad escape inside @{…} is EXPR_BAD_ESCAPE at the backslash', () => {
    const e = err('@{a\\b}')
    expect(e.code).toBe('EXPR_BAD_ESCAPE')
    expect(e.column).toBe(4)
  })

  it('a raw control char inside @{…} is EXPR_BAD_TOKEN', () => {
    expect(err(`@{a${CTRL_1}b}`).code).toBe('EXPR_BAD_TOKEN')
    expect(err(`@{a${CTRL_7F}b}`).code).toBe('EXPR_BAD_TOKEN')
  })
})
