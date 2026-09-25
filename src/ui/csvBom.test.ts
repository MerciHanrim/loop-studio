import { describe, expect, it } from 'vitest'
import { CSV_MIME, withCsvBom } from './download'

// The "exactly one BOM" half of the CSV download contract.
//
// The byte-level check on a real download lives in
// `e2e/csv-download-encoding.spec.ts`; the "nothing else may write a CSV" half
// is `scripts/check-csv-boundary.mjs`. What is falsifiable here without a
// browser is the payload rule itself, and it has two sides that fail in
// opposite directions: no BOM leaves Excel guessing the ANSI code page, and a
// second BOM puts a stray U+FEFF inside the first cell. Both look like
// "encoding is broken" to a user.

const BOM = String.fromCharCode(0xfeff)

/** How many BOM characters the payload starts with. */
const leadingBoms = (s: string): number => {
  let n = 0
  while (s.startsWith(BOM.repeat(n + 1))) n++
  return n
}

describe('withCsvBom adds exactly one BOM', () => {
  it('a document with no BOM gets exactly one', () => {
    const csv = 'step,레벨\n0,1\n'
    const out = withCsvBom(csv)
    expect(leadingBoms(out)).toBe(1)
    expect(out.slice(1)).toBe(csv)
  })

  it('a document that already carries one still has exactly one', () => {
    const csv = 'step,레벨\n0,1\n'
    const out = withCsvBom(BOM + csv)
    expect(leadingBoms(out)).toBe(1)
    expect(out.slice(1)).toBe(csv)
  })

  it('applying it twice is the same as applying it once', () => {
    const csv = 'step,레벨\n0,1\n'
    expect(withCsvBom(withCsvBom(csv))).toBe(withCsvBom(csv))
    expect(leadingBoms(withCsvBom(withCsvBom(csv)))).toBe(1)
  })

  it('the body after the BOM is byte-identical, Korean included', () => {
    const csv = 'step,레벨,경험치,획득 경험치\n0,1,0,0\n'
    const out = withCsvBom(csv)
    const bytes = new TextEncoder().encode(out)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(3))).toBe(csv)
  })

  it('an empty document still gets its BOM', () => {
    expect(leadingBoms(withCsvBom(''))).toBe(1)
    expect(withCsvBom('')).toBe(BOM)
  })

  it('a U+FEFF that is NOT leading is left alone', () => {
    // only a LEADING BOM is the encoding mark; one in the middle is data and
    // removing or counting it would corrupt a cell
    const csv = 'a,b' + BOM + 'c\n'
    const out = withCsvBom(csv)
    expect(leadingBoms(out)).toBe(1)
    expect(out.slice(1)).toBe(csv)
    expect(out.slice(1).includes(BOM)).toBe(true)
  })

  it('the media type is the one the boundary declares', () => {
    expect(CSV_MIME).toBe('text/csv;charset=utf-8')
  })

  it('the counter itself can tell one BOM from two', () => {
    // otherwise every assertion above could pass on a broken helper
    expect(leadingBoms('x')).toBe(0)
    expect(leadingBoms(BOM + 'x')).toBe(1)
    expect(leadingBoms(BOM + BOM + 'x')).toBe(2)
  })
})
