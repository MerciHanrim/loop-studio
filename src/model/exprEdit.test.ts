import { describe, expect, it } from 'vitest'
import { insertOperator } from './exprEdit'

describe('insertOperator — §RXA8b operator / paren buttons', () => {
  it('inserts an operator with a space on each side at the caret', () => {
    expect(insertOperator('12', 1, 1, '*')).toEqual({ value: '1 * 2', caret: 4 })
    expect(insertOperator('@a@b', 2, 2, '+')).toEqual({ value: '@a + @b', caret: 5 })
  })

  it('maps the × / ÷ glyphs to the grammar operators * and /', () => {
    expect(insertOperator('1', 1, 1, '*').value).toBe('1 * ')
    expect(insertOperator('1', 1, 1, '/').value).toBe('1 / ')
  })

  it('does not double a space that is already there', () => {
    expect(insertOperator('1 2', 2, 2, '+')).toEqual({ value: '1 + 2', caret: 4 }) // caret after "1 ", a trailing space is added
    expect(insertOperator('1  2', 2, 2, '-')).toEqual({ value: '1 - 2', caret: 3 }) // between the two existing spaces — no space added either side
    expect(insertOperator('1 ', 2, 2, '*')).toEqual({ value: '1 * ', caret: 4 })
  })

  it('no leading space at the very start of the field; still a trailing space', () => {
    expect(insertOperator('', 0, 0, '+')).toEqual({ value: '+ ', caret: 2 })
    expect(insertOperator('9', 0, 0, '-')).toEqual({ value: '- 9', caret: 2 })
  })

  it('replaces the selection with the operator', () => {
    // select the "x" placeholder between two refs, press ×
    expect(insertOperator('@a x @b', 3, 4, '*')).toEqual({ value: '@a * @b', caret: 4 })
  })

  it('group: wraps a non-empty selection in ( … ), caret after the close paren', () => {
    expect(insertOperator('@a + @b * 2', 0, 7, 'group')).toEqual({
      value: '(@a + @b) * 2',
      caret: 9,
    })
  })

  it('group: no selection ⇒ inserts () and puts the caret between the parens', () => {
    expect(insertOperator('1 + ', 4, 4, 'group')).toEqual({ value: '1 + ()', caret: 5 })
    expect(insertOperator('', 0, 0, 'group')).toEqual({ value: '()', caret: 1 })
  })

  it('clamps out-of-range caret / selection indices', () => {
    expect(insertOperator('12', 9, 9, '+')).toEqual({ value: '12 + ', caret: 5 })
    expect(insertOperator('12', -3, 1, 'group')).toEqual({ value: '(1)2', caret: 3 })
  })

  it('only ever adds the operator/parens and at most one space per side', () => {
    const r = insertOperator('@stock', 6, 6, '/')
    expect(r.value).toBe('@stock / ')
    expect(r.value).not.toMatch(/ {2}/) // no double space
  })
})
