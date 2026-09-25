import { describe, expect, it } from 'vitest'
import { CSV_EOL, csvField, detectDelimiter, parseDelimitedText, stripBom, toCsv } from './csv'

// docs/data-import.md -- Phase 1B delimited-text parsing. This module owns
// SYNTAX only; ragged rows and cell-content rules live in
// dataImportValidate.ts, not here (§DI7's column-count check runs after
// header-row selection and row trim, which a bare parser can't do).

const BOM = '﻿'

describe('stripBom', () => {
  it('drops a leading U+FEFF', () => {
    expect(stripBom(`${BOM}a,b`)).toBe('a,b')
  })
  it('leaves text with no BOM untouched', () => {
    expect(stripBom('a,b')).toBe('a,b')
  })
  it('does not strip a U+FEFF that is not at offset 0', () => {
    expect(stripBom(`a${BOM}b`)).toBe(`a${BOM}b`)
  })
})

describe('detectDelimiter', () => {
  it('picks tab when one appears outside quotes in the first row', () => {
    expect(detectDelimiter('a\tb\tc\nd,e,f')).toBe('\t')
  })
  it('picks comma by default', () => {
    expect(detectDelimiter('a,b,c\nd\te\tf')).toBe(',')
  })
  it('ignores a tab INSIDE a properly quoted field -- still comma', () => {
    expect(detectDelimiter('a,"b\tc",d')).toBe(',')
  })
  it('ignores a comma inside a properly quoted field when a real tab exists outside', () => {
    expect(detectDelimiter('a\t"b,c"\td')).toBe('\t')
  })
  it('handles an escaped quote ("") without losing quote-tracking state', () => {
    // a field like "he said ""hi""" contains an escaped quote; the tab right
    // after it is still inside the quoted run and must not be counted
    expect(detectDelimiter('"he said ""hi""\t more",b,c')).toBe(',')
  })
  it('strips a BOM before detecting', () => {
    expect(detectDelimiter('﻿a\tb')).toBe('\t')
  })
  it('only looks at the first logical row', () => {
    expect(detectDelimiter('a,b\nc\td\te')).toBe(',')
  })
})

describe('parseDelimitedText -- well-formed input succeeds', () => {
  it('parses a simple comma document', () => {
    const r = parseDelimitedText('a,b,c\n1,2,3', ',')
    expect(r.ok && r.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('a BOM-prefixed document parses fine once stripped by the caller', () => {
    const r = parseDelimitedText(stripBom('﻿a,b\n1,2'), ',')
    expect(r.ok && r.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(r.ok && r.rows[0][0]).toBe('a') // no stray U+FEFF glued to the header cell
  })

  it('a properly quoted field containing the delimiter is one field, unsplit', () => {
    const r = parseDelimitedText('a,"b,c",d', ',')
    expect(r.ok && r.rows).toEqual([['a', 'b,c', 'd']])
  })

  it('a properly quoted field containing a tab parses fine under comma delimiter', () => {
    const r = parseDelimitedText('a,"b\tc",d', ',')
    expect(r.ok && r.rows).toEqual([['a', 'b\tc', 'd']])
  })

  it('a properly quoted field containing a comma parses fine under tab delimiter', () => {
    const r = parseDelimitedText('a\t"b,c"\td', '\t')
    expect(r.ok && r.rows).toEqual([['a', 'b,c', 'd']])
  })

  it('doubled quotes escape a literal quote inside a quoted field', () => {
    const r = parseDelimitedText('a,"he said ""hi""",c', ',')
    expect(r.ok && r.rows).toEqual([['a', 'he said "hi"', 'c']])
  })

  it('a quoted field may contain an embedded newline', () => {
    const r = parseDelimitedText('a,"line1\nline2",c', ',')
    expect(r.ok && r.rows).toEqual([['a', 'line1\nline2', 'c']])
  })

  it('CRLF, LF, and bare CR line endings all terminate a row', () => {
    const expected = [
      ['a', 'b'],
      ['c', 'd'],
    ]
    const crlf = parseDelimitedText('a,b\r\nc,d', ',')
    expect(crlf.ok && crlf.rows).toEqual(expected)
    const lf = parseDelimitedText('a,b\nc,d', ',')
    expect(lf.ok && lf.rows).toEqual(expected)
    const cr = parseDelimitedText('a,b\rc,d', ',')
    expect(cr.ok && cr.rows).toEqual(expected)
  })

  it('a single trailing newline produces NO phantom extra row', () => {
    const r = parseDelimitedText('a,b\n1,2\n', ',')
    expect(r.ok && r.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('no trailing newline at all still parses the last row', () => {
    const r = parseDelimitedText('a,b\n1,2', ',')
    expect(r.ok && r.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('an embedded genuinely blank row (two consecutive newlines) is KEPT, not dropped', () => {
    const r = parseDelimitedText('a,b\n\n1,2', ',')
    expect(r.ok && r.rows).toEqual([['a', 'b'], [''], ['1', '2']])
  })

  it('a trailing genuinely blank row (double trailing newline) is KEPT, not dropped', () => {
    const r = parseDelimitedText('a,b\n', ',')
    expect(r.ok && r.rows).toEqual([['a', 'b']])
    const r2 = parseDelimitedText('a,b\n\n', ',')
    expect(r2.ok && r2.rows).toEqual([['a', 'b'], ['']])
  })

  it('a row of bare delimiters is kept as real (empty-celled) data', () => {
    const r = parseDelimitedText('a,b,c\n,,', ',')
    expect(r.ok && r.rows).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ])
  })

  it('empty input produces zero rows', () => {
    const r = parseDelimitedText('', ',')
    expect(r.ok && r.rows).toEqual([])
  })
})

describe('parseDelimitedText -- malformed input is rejected with position', () => {
  it('an unterminated quoted field is unterminated-quote, at the OPENING quote', () => {
    const r = parseDelimitedText('a,"b,c\nd,e', ',')
    expect(!r.ok && r.error.kind).toBe('unterminated-quote')
    expect(!r.ok && r.error.line).toBe(1)
    expect(!r.ok && r.error.column).toBe(3) // the opening quote is the 3rd char of line 1
  })

  it('a bare quote inside an unquoted field is quote-in-unquoted-field ("ab"cd" case)', () => {
    const r = parseDelimitedText('ab"cd,e', ',')
    expect(!r.ok && r.error.kind).toBe('quote-in-unquoted-field')
    expect(!r.ok && r.error.line).toBe(1)
    expect(!r.ok && r.error.column).toBe(3) // the stray quote is the 3rd char
  })

  it('text immediately after a closing quote (before the delimiter/newline) is text-after-quote', () => {
    const r = parseDelimitedText('"ab"cd,e', ',')
    expect(!r.ok && r.error.kind).toBe('text-after-quote')
  })

  it('reports the correct line for a syntax error on a later row', () => {
    const r = parseDelimitedText('a,b\nc,"d\ne,f', ',')
    expect(!r.ok && r.error.kind).toBe('unterminated-quote')
    expect(!r.ok && r.error.line).toBe(2)
  })

  it('does NOT reject a ragged row -- that check belongs to dataImportValidate.ts', () => {
    const r = parseDelimitedText('a,b,c\n1,2', ',')
    expect(r.ok).toBe(true)
    expect(r.ok && r.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ])
  })
})


// docs/data-import.md -- the WRITE side of the same syntax module. Every CSV
// this product downloads goes through `toCsv`, so the record separator and the
// quoting rule have ONE owner and one test, instead of the per-writer idiom
// that had diverged five ways (measured 2026-09-26: five writers joined rows
// with a bare LF and replaced `"` / `,` / newline inside a label with a SPACE,
// losing it; only the change-proposal writer was RFC 4180).

describe('csvField (RFC 4180)', () => {
  it('leaves a value that needs no quoting alone', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('')).toBe('')
    expect(csvField(42)).toBe('42')
    expect(csvField('a b')).toBe('a b')
    expect(csvField('ตั๋ว')).toBe('ตั๋ว')
  })

  it('quotes a comma, a quote, CR and LF -- and NEVER replaces them', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvField('a\rb')).toBe('"a\rb"')
    expect(csvField(`a${CSV_EOL}b`)).toBe(`"a${CSV_EOL}b"`)
  })

  it('doubles an internal quote, inside quotes', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('"')).toBe('""""')
  })

  it('does not quote a tab -- a CSV field may hold one', () => {
    expect(csvField('a\tb')).toBe('a\tb')
  })
})

describe('toCsv', () => {
  it('separates records with CRLF and terminates the last one too', () => {
    expect(CSV_EOL).toBe('\r\n')
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n')
  })

  it('a document with no rows is empty, not a lone separator', () => {
    expect(toCsv([])).toBe('')
  })

  it('takes numbers as well as strings', () => {
    expect(toCsv([['step', 'n'], [0, 12]])).toBe('step,n\r\n0,12\r\n')
  })

  it("round-trips a hostile label LOSSLESSLY through this module's own parser", () => {
    const hostile = ['plain', 'a,b', 'say "hi"', 'two\nlines', 'crlf\r\nhere', 'ตั๋ว [ticket_free]']
    const text = toCsv([hostile, [1, 2, 3, 4, 5, 6]])
    const parsed = parseDelimitedText(text, ',')
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.rows[0]).toEqual(hostile)
    expect(parsed.ok && parsed.rows).toHaveLength(2)
  })

  it('a BOM-prefixed document still parses -- the download boundary adds one', () => {
    const text = BOM + toCsv([['a', 'b']])
    const parsed = parseDelimitedText(stripBom(text), ',')
    expect(parsed.ok && parsed.rows).toEqual([['a', 'b']])
  })
})
