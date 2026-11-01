import { describe, expect, it } from 'vitest'
import { readDraft } from './draftNumber'

// #422 item 2 — the input boundary of the number fields: a blank is no value,
// and nothing non-finite is ever a value.
describe('readDraft', () => {
  it('a blank is no value', () => {
    expect(readDraft('')).toEqual({ kind: 'blank' })
  })
  it('a finite number is a value', () => {
    expect(readDraft('7')).toEqual({ kind: 'value', n: 7 })
    expect(readDraft('-3')).toEqual({ kind: 'value', n: -3 })
    expect(readDraft('2.5')).toEqual({ kind: 'value', n: 2.5 })
  })
  it('nothing non-finite is a value', () => {
    for (const text of ['Infinity', '-Infinity', '1e400', '-1e400', 'NaN', '-', 'abc']) {
      expect(readDraft(text), text).toEqual({ kind: 'invalid' })
    }
  })
  it('the field’s own rule applies to a finite parse only', () => {
    const nonNegative = (n: number) => n >= 0
    expect(readDraft('0', nonNegative)).toEqual({ kind: 'value', n: 0 })
    expect(readDraft('-1', nonNegative)).toEqual({ kind: 'invalid' })
    expect(readDraft('Infinity', () => true)).toEqual({ kind: 'invalid' })
  })
})
