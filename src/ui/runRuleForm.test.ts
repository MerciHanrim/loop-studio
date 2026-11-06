import { describe, expect, it } from 'vitest'
import { draftState, fractionOfPercent, isAboveZero, isPlainNumber, nextDraft, percentOfFraction } from './runRuleForm'

describe('the Lowest field', () => {
  it('shows a stored fraction as a percent, exactly', () => {
    expect(percentOfFraction('0.5')).toBe('50')
    expect(percentOfFraction('0.125')).toBe('12.5')
    expect(percentOfFraction('0.07')).toBe('7')
    expect(percentOfFraction(undefined)).toBe('')
  })

  it('stores a typed percent as a fraction, exactly', () => {
    expect(fractionOfPercent('50')).toBe('0.5')
    expect(fractionOfPercent('12.5')).toBe('0.125')
    expect(fractionOfPercent('7')).toBe('0.07')
    expect(fractionOfPercent('100')).toBe('1')
    expect(fractionOfPercent('0')).toBe('0')
  })

  it('refuses what is no percent', () => {
    expect(fractionOfPercent('100.1')).toBeNull()
    expect(fractionOfPercent('-1')).toBeNull()
    expect(fractionOfPercent('half')).toBeNull()
  })
})

describe('the number fields', () => {
  it('take plain decimals only, and a band above 0', () => {
    expect(isPlainNumber('1500')).toBe(true)
    expect(isPlainNumber('0')).toBe(true)
    expect(isPlainNumber('1e3')).toBe(false)
    expect(isPlainNumber('-1')).toBe(false)
    expect(isAboveZero('0')).toBe(false)
    expect(isAboveZero('0.0')).toBe(false)
    expect(isAboveZero('0.5')).toBe(true)
  })
})

describe('a draft', () => {
  it('starts a tank on the Fill side', () => {
    expect(nextDraft({}, { tank: 'a' })).toEqual({ tank: 'a', side: 'fill' })
  })

  it('drops what no longer belongs', () => {
    expect(nextDraft({ tank: 'a', level: '1', band: '1', side: 'empty', table: 't' }, { tank: undefined })).toEqual({ table: 't' })
    expect(nextDraft({ table: 't', rated: 'l', tank: 'a', level: '1', band: '1', side: 'fill' }, { table: undefined })).toEqual({ tank: 'a', level: '1', band: '1', side: 'fill' })
  })

  it('drops a unit written for another tank, and keeps the level to be read again', () => {
    expect(nextDraft({ tank: 'a', level: '1', band: '1', side: 'fill', unit: 'L' }, { tank: 'b' })).toEqual({ tank: 'b', level: '1', band: '1', side: 'fill' })
    expect(nextDraft({ tank: 'a', level: '1', band: '1', side: 'fill', unit: 'L' }, { level: '2' })).toEqual({ tank: 'a', level: '2', band: '1', side: 'fill', unit: 'L' })
  })

  it('becomes a rule only when it reads', () => {
    expect(draftState({})).toEqual({ kind: 'empty' })
    expect(draftState({ tank: 'a', side: 'fill' })).toEqual({ kind: 'draft' })
    expect(draftState({ tank: 'a', level: '1', side: 'fill' })).toEqual({ kind: 'draft' })
    expect(draftState({ tank: 'a', level: '1', band: '1', side: 'fill' }).kind).toBe('rule')
    expect(draftState({ table: 't' }).kind).toBe('rule')
  })
})
