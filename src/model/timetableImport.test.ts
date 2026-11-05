import { describe, expect, it } from 'vitest'
import { buildTable, fillGaps, gapChoiceFits, gapRows, parseTableText, pickColumns, proposeEnd, tableId, type ImportRow, type TableForm } from './timetableImport'

const rows = (text: string, time = 0, rate = 1) => pickColumns(parseTableText(text)!, time, rate)
const row = (n: number, time: string, rate: string): ImportRow => ({ row: n, time, rate })
const form: TableForm = { label: 'Intake', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'stop', end: '6' }

describe('reading the text', () => {
  it('takes a header row, and numbers rows as the file does', () => {
    const t = parseTableText('hour,flow\n0,10\n3,20\n')!
    expect(t.columns).toEqual(['hour', 'flow'])
    expect(pickColumns(t, 0, 1)).toEqual([row(2, '0', '10'), row(3, '3', '20')])
  })

  it('takes a table with no header, a tab-separated paste, and a BOM', () => {
    expect(rows('0\t10\n3\t20')).toEqual([row(1, '0', '10'), row(2, '3', '20')])
    expect(rows('﻿0,10\n3,20')[0]).toEqual(row(1, '0', '10'))
  })

  it('picks any two columns', () => {
    expect(rows('site,hour,flow\nA,0,10\nA,3,20', 1, 2)).toEqual([row(2, '0', '10'), row(3, '3', '20')])
  })

  it('a blank line is not data, and empty text is nothing to read', () => {
    expect(rows('0,10\n\n3,20').map((r) => r.row)).toEqual([1, 3])
    expect(parseTableText('  \n ')).toBeNull()
  })
})

describe('a gap stops the import until a choice is made', () => {
  const gapped = [row(1, '0', '10'), row(2, '1', ''), row(3, '2', ''), row(4, '4', '40')]

  it('names the rows', () => expect(gapRows(gapped)).toEqual([2, 3]))

  it('remove: the rows go', () => expect(fillGaps(gapped, 'remove').map((r) => r.row)).toEqual([1, 4]))

  it('hold: the last value is written into each row', () => {
    expect(fillGaps(gapped, 'hold').map((r) => r.rate)).toEqual(['10', '10', '10', '40'])
  })

  it('line: a straight line across the gap is written as real points', () => {
    expect(fillGaps(gapped, 'line').map((r) => r.rate)).toEqual(['10', '17.5', '25', '40'])
  })

  it('a value no 15 digits reach is the nearest 15-digit point', () => {
    const r = fillGaps([row(1, '0', '0'), row(2, '1', ''), row(3, '3', '1')], 'line')
    expect(r[1].rate).toBe('0.333333333333333')
  })

  it('hold needs a value before the gap, and line one on both sides', () => {
    expect(gapChoiceFits([row(1, '0', ''), row(2, '1', '5')], 'hold')).toBe(false)
    expect(gapChoiceFits([row(1, '0', '5'), row(2, '1', '')], 'hold')).toBe(true)
    expect(gapChoiceFits([row(1, '0', '5'), row(2, '1', '')], 'line')).toBe(false)
    expect(gapChoiceFits(gapped, 'line')).toBe(true)
    expect(gapChoiceFits([row(1, '0', '')], 'remove')).toBe(true)
  })
})

describe('the proposed end', () => {
  const day = [row(1, '0', '100'), row(2, '12', '200'), row(3, '24', '100')]
  const open = [row(1, '0', '100'), row(2, '6', '200'), row(3, '9', '150')]

  it('hold: the last point plus the last interval', () => {
    expect(proposeEnd(open, 'hold', 'stop')).toEqual({ end: '12', dropLast: false, asks: false })
  })

  it('linear, not repeating: the last point', () => {
    expect(proposeEnd(open, 'linear', 'stop')).toEqual({ end: '9', dropLast: false, asks: false })
  })

  it('a repeating table that closes its own day: the last row is dropped and end is its time', () => {
    expect(proposeEnd(day, 'linear', 'repeat')).toEqual({ end: '24', dropLast: true, asks: false })
    expect(proposeEnd(day, 'hold', 'repeat')).toEqual({ end: '24', dropLast: true, asks: false })
  })

  it('a linear repeat whose last value differs stops and asks: a jump would be invented', () => {
    expect(proposeEnd(open, 'linear', 'repeat')).toEqual({ end: '', dropLast: false, asks: true })
  })

  it('a hold repeat keeps its last stretch', () => {
    expect(proposeEnd(open, 'hold', 'repeat')).toEqual({ end: '12', dropLast: false, asks: false })
  })

  it('one point gives no interval: the person says', () => {
    expect(proposeEnd([row(1, '0', '5')], 'hold', 'stop').end).toBe('')
  })

  it('adds decimals exactly', () => {
    expect(proposeEnd([row(1, '0.1', '1'), row(2, '0.3', '1')], 'hold', 'stop').end).toBe('0.5')
  })
})

describe('the id', () => {
  it('comes from the name, and stays unique', () => {
    expect(tableId('Intake by tide', [])).toBe('intake_by_tide')
    expect(tableId('Intake', ['intake'])).toBe('intake_1')
    expect(tableId('Intake', ['intake', 'intake_1'])).toBe('intake_2')
  })

  it('a name with no ASCII letter takes a numbered id', () => {
    expect(tableId('조수 유입', [])).toBe('table_1')
    expect(tableId('조수 유입', ['table_1'])).toBe('table_2')
  })
})

describe('the table', () => {
  it('builds a table the file contract accepts', () => {
    const r = buildTable([row(2, '0', '10'), row(3, '3', '20')], form, [])
    expect(r.ok && r.table).toEqual({ id: 'intake', label: 'Intake', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'hold', end: '6', after: 'stop', points: [['0', '10'], ['3', '20']] })
  })

  it('names the file’s own row when one is out of order', () => {
    const r = buildTable([row(2, '0', '10'), row(5, '3', '20'), row(9, '2', '30')], form, [])
    expect(!r.ok && r.problem).toMatchObject({ code: 'time-out-of-order', row: 9 })
  })

  it('names a value that is not a number, and a negative one', () => {
    expect(buildTable([row(2, '0', 'n/a')], form, [])).toMatchObject({ ok: false, problem: { code: 'bad-point', row: 2 } })
    expect(buildTable([row(7, '0', '-1')], form, [])).toMatchObject({ ok: false, problem: { code: 'bad-point', row: 7 } })
  })

  it('refuses an end that breaks the rule, and a first time that is not 0', () => {
    expect(buildTable([row(2, '0', '10'), row(3, '6', '20')], form, [])).toMatchObject({ ok: false, problem: { code: 'bad-end' } })
    expect(buildTable([row(2, '1', '10')], form, [])).toMatchObject({ ok: false, problem: { code: 'first-not-zero', row: 2 } })
  })
})
