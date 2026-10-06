import { describe, expect, it } from 'vitest'
import { ACCENT_STORED, carryAccent, parseAccentInput, readAccent } from './accent'

// docs/flow-colour-and-compact-nodes.md FC-2.2 / FC-2.3 — every row of the two
// tables, so the contract and the code cannot drift apart.

describe('parseAccentInput (FC-2.2, the hex field)', () => {
  it.each([
    ['#3a7bd5', '#3A7BD5'],
    ['3A7BD5', '#3A7BD5'],
    [' #3a7bd5 ', '#3A7BD5'],
    ['#3ad', '#33AADD'],
    ['3ad', '#33AADD'],
    ['#ABCDEF', '#ABCDEF'],
  ])('%j is stored as %s', (typed, stored) => {
    expect(parseAccentInput(typed)).toEqual({ ok: true, value: stored })
    expect(ACCENT_STORED.test(stored)).toBe(true)
  })

  it.each(['#3a7bd580', '#3ad8', '3ad8'])('%j carries alpha: not applied', (typed) => {
    expect(parseAccentInput(typed)).toEqual({ ok: false, reason: 'alpha' })
  })

  it.each(['red', 'rgb(1, 2, 3)', '#12345', '#1234567', '#ggg', '##123456', '#12 345', 'transparent'])(
    '%j is not a colour: not applied',
    (typed) => {
      expect(parseAccentInput(typed)).toEqual({ ok: false, reason: 'format' })
    },
  )

  it('an empty field is no change, not a colour', () => {
    expect(parseAccentInput('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAccentInput('   ')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('readAccent (FC-2.3, a file value)', () => {
  it('keeps a six-digit hex and upper-cases it', () => {
    expect(readAccent('#3a7bd5')).toBe('#3A7BD5')
    expect(readAccent('#3A7BD5')).toBe('#3A7BD5')
  })

  it.each([
    ['a short form', '#3ad'],
    ['alpha', '#3a7bd580'],
    ['no hash', '3a7bd5'],
    ['white space', ' #3a7bd5'],
    ['a colour name', 'red'],
    ['a number', 0x3a7bd5],
    ['null', null],
    ['an object', { r: 1 }],
    ['an empty string', ''],
  ])('drops %s', (_why, raw) => {
    expect(readAccent(raw)).toBeUndefined()
  })

  it('carryAccent copies a valid value and nothing else', () => {
    const ok: { accent?: string } = {}
    carryAccent({ accent: '#abcdef' }, ok)
    expect(ok).toEqual({ accent: '#ABCDEF' })
    const bad: { accent?: string } = {}
    carryAccent({ accent: 'red' }, bad)
    expect(bad).toEqual({})
    expect('accent' in bad).toBe(false)
  })
})
