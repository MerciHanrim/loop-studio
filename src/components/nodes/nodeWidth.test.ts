import { describe, expect, it } from 'vitest'
import { reservationOf, reservedWidth, W1_CAP, W1_FLOOR } from './nodeWidth'

const pool = (initial: number, capacity: number | null) => ({ type: 'pool', data: { kind: 'pool', label: 'x', activation: 'passive', initial, capacity, mode: 'pullAny' } })
const parameter = (value: number, unit?: string) => ({ type: 'parameter', data: { kind: 'parameter', label: 'x', value, ...(unit ? { unit } : {}) } })
const register = (unit?: string) => ({ type: 'register', data: { kind: 'register', label: 'x', expr: '0', ...(unit ? { unit } : {}) } })

describe('W1 — the body width from the display format (17-implementation-rules.md §4.1)', () => {
  it('is reserved from the format, never from the current value: a Pool with a capacity reserves `capacity / capacity`', () => {
    expect(reservationOf(pool(0, 20)).mono).toBe('20 / 20')
    expect(reservationOf(pool(4, 20)).mono).toBe('20 / 20')
    expect(reservedWidth(pool(0, 20))).toBe(reservedWidth(pool(19, 20)))
  })

  it('guards: an authored initial wider than the capacity reserves its own digits; a capacity that is not a finite number counts as none', () => {
    expect(reservationOf(pool(123, 20)).mono).toBe('123 / 20')
    expect(reservationOf(pool(4, 20)).mono).toBe('20 / 20')
    expect(reservationOf({ type: 'pool', data: { ...pool(0, 20).data, capacity: Number.NaN } }).mono).toBe('999999')
    expect(reservationOf({ type: 'pool', data: { ...pool(0, 20).data, capacity: '20' } }).mono).toBe('999999')
    expect(reservationOf({ type: 'pool', data: { ...pool(0, 20).data, initial: Number.POSITIVE_INFINITY } }).mono).toBe('999999 / 20')
  })

  it('an uncapped Pool and a Register reserve six digits', () => {
    expect(reservationOf(pool(0, null)).mono).toBe('999999')
    expect(reservationOf(register()).mono).toBe('-999999')
    expect(reservedWidth(pool(0, null))).toBe(reservedWidth(pool(123456, null)))
  })

  it('a Parameter reserves its AUTHORED value and unit, so an edit of the authored value changes the width', () => {
    expect(reservationOf(parameter(3, 'people'))).toEqual({ mono: '-3', unit: 'people' })
    expect(reservedWidth(parameter(3))).toBeLessThan(reservedWidth(parameter(1234567)))
    expect(reservedWidth(parameter(3))).toBeLessThan(reservedWidth(parameter(3, 'people per day')))
  })

  it('keeps every kind between the floor and the cap, and the cap stops the growth without touching the format', () => {
    for (const n of [pool(0, null), pool(0, 20), parameter(3), register('kKRW/day'), { type: 'source', data: {} }, { type: 'gate', data: {} }]) {
      const w = reservedWidth(n)
      expect(w).toBeGreaterThanOrEqual(W1_FLOOR)
      expect(w).toBeLessThanOrEqual(W1_CAP)
      expect(Number.isInteger(w)).toBe(true)
    }
    expect(reservedWidth({ type: 'source', data: {} })).toBe(W1_FLOOR)
    expect(reservedWidth(parameter(1e15, 'a very long unit name indeed'))).toBe(W1_CAP)
  })

  it('does not depend on the label or the language (the name is outside)', () => {
    const a = reservedWidth({ type: 'pool', data: { ...pool(0, 20).data, label: 'Waiting room' } })
    const b = reservedWidth({ type: 'pool', data: { ...pool(0, 20).data, label: 'Очень длинное название зала ожидания для пациентов' } })
    expect(a).toBe(b)
  })
})
