import { describe, expect, it } from 'vitest'
import { pluralArms, pluralBlocks } from './icuPlural'

// docs/localization.md §L2.20 — the fixtures for the plural walker.
//
// Each one is a SHAPE a real catalog message takes. They live here rather than
// in a per-locale copy test because the walker is shared: a regression in it
// would make every locale's plural guard vacuous at once, and this file is the
// thing that fails first.

const ONE = String.fromCharCode(0x27) // ASCII apostrophe, spelled out so the
// surrounding quoting of this file can never be what the fixture is testing

describe('pluralBlocks finds every block, whatever the message looks like', () => {
  it('a block that starts at index 0', () => {
    const m = '{n, plural, other {# โหนดถูกเลือก}}'
    expect(pluralBlocks(m)).toEqual([m])
  })

  it('the naive split idiom gets exactly that case wrong', () => {
    // This is the defect this module exists to prevent, asserted rather than
    // described. A zero-width match at index 0 does not split.
    expect('abc'.split(/(?=a)/)).toEqual(['abc'])
    const m = '{n, plural, other {# โหนดถูกเลือก}}'
    expect(m.split(/(?=\{\s*\w+\s*,\s*plural\s*,)/).slice(1)).toEqual([])
    expect(pluralBlocks(m)).toHaveLength(1)
  })

  it('a block after leading prose', () => {
    const m = 'พร้อมนำเข้า {tables, plural, other {# ตาราง}} แล้ว'
    expect(pluralBlocks(m)).toEqual(['{tables, plural, other {# ตาราง}}'])
  })

  it('two blocks in one value', () => {
    const m = '{a, plural, other {# ปัญหา}} ใน {b, plural, other {# ตาราง}}'
    expect(pluralBlocks(m)).toEqual([
      '{a, plural, other {# ปัญหา}}',
      '{b, plural, other {# ตาราง}}',
    ])
  })

  it('three blocks, the shape `import.status.counts` actually has', () => {
    const m =
      '{cols, plural, other {# คอลัมน์}} × {rows, plural, other {# แถว}} → {n, plural, other {# พารามิเตอร์}}'
    expect(pluralBlocks(m)).toHaveLength(3)
  })

  it('a slot inside an arm does not end the block early', () => {
    const m = '{n, plural, other {# จาก {total}}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)[0][1]).toBe('# จาก {total}')
  })

  it('an ICU quoted brace inside an arm is text, not depth', () => {
    // `error.EXPR_UNCLOSED_REF.message` carries a real `'{'`. Put one inside a
    // plural arm and a bare depth counter never closes the block.
    const m = '{n, plural, other {# ครั้งที่พบ ' + ONE + '{' + ONE + '}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)).toEqual([['other', '# ครั้งที่พบ ' + ONE + '{' + ONE]])
  })

  it('a bare depth counter drops that fixture — the repair is load-bearing', () => {
    const m = '{n, plural, other {# ครั้งที่พบ ' + ONE + '{' + ONE + '}}'
    const naive = (s: string) => {
      let depth = 0
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') {
          depth--
          if (depth === 0) return s.slice(0, i + 1)
        }
      }
      return null // ran off the end: the block would be silently skipped
    }
    expect(naive(m)).toBeNull()
    expect(pluralBlocks(m)).toHaveLength(1)
  })

  it('a doubled apostrophe is an escaped one, not an empty quote', () => {
    // `''` is ICU's escape for a literal apostrophe. Recognising a quote only
    // before `{`, `}` or `#` already declines to open one here — but the pair
    // must also not be read as an OPEN-then-CLOSE that swallows the brace
    // after it, which is how a walker that scans for the next `'` goes wrong.
    // The arm still has to close where its own `}` is.
    const m = '{n, plural, other {# l' + ONE + ONE + 'unità {label}}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)).toEqual([['other', '# l' + ONE + ONE + 'unità {label}']])
  })

  it('a doubled apostrophe immediately before a brace still escapes only itself', () => {
    // The adversarial ordering: `''` followed by a real slot. If the first
    // apostrophe opened a quote because the SECOND one is followed by `{`, the
    // slot would be swallowed and the block would end in the wrong place.
    const m = '{n, plural, other {# ' + ONE + ONE + '{label} ที่เหลือ}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)[0][1]).toBe('# ' + ONE + ONE + '{label} ที่เหลือ')
  })

  it('a doubled apostrophe INSIDE a quoted literal does not close it', () => {
    // The other half of the same rule, and the reason the close cannot be an
    // `indexOf`: inside `'…'`, `''` is still one literal apostrophe.
    const m = '{n, plural, other {# ' + ONE + '{a' + ONE + ONE + 'b}' + ONE + '}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)[0][1]).toBe('# ' + ONE + '{a' + ONE + ONE + 'b}' + ONE)
  })

  it('an ordinary apostrophe does not open a quote', () => {
    // `d'un` in French and a Turkish suffix apostrophe are ordinary text. If
    // they opened a quoted literal, everything up to the next apostrophe would
    // stop being counted and the walk would go wrong in the other direction.
    const m = '{n, plural, other {# d' + ONE + 'un {label} par heure}}'
    expect(pluralBlocks(m)).toEqual([m])
    expect(pluralArms(m)[0][1]).toBe('# d' + ONE + 'un {label} par heure')
  })

  it('a message with no plural has no blocks', () => {
    expect(pluralBlocks('ข้อความธรรมดาที่ไม่มีพหูพจน์')).toEqual([])
    expect(pluralBlocks('{label} ถูกลบแล้ว')).toEqual([])
  })

  it('a select block is not a plural block', () => {
    expect(pluralBlocks('{kind, select, pool {บ่อ} other {อื่น}}')).toEqual([])
  })

  it('an unbalanced block throws instead of vanishing', () => {
    expect(() => pluralBlocks('{n, plural, other {# โหนด}')).toThrow(/unbalanced/)
  })
})

describe('pluralArms reads the selectors and keeps the bodies', () => {
  it('a two-arm block', () => {
    expect(pluralArms('{n, plural, one {# düğüm} other {# düğüm}}')).toEqual([
      ['one', '# düğüm'],
      ['other', '# düğüm'],
    ])
  })

  it('an offset is not mistaken for an arm', () => {
    const arms = pluralArms('{n, plural, offset:1 one {# อื่น} other {# อื่น}}')
    expect(arms.map(([s]) => s)).toEqual(['one', 'other'])
  })

  it('an explicit `=0` arm is a selector', () => {
    const arms = pluralArms('{n, plural, =0 {ไม่มี} other {# รายการ}}')
    expect(arms.map(([s]) => s)).toEqual(['=0', 'other'])
  })

  it('the body is prose and survives, slots and all', () => {
    // The hole this closes: stripping every `{...}` group also strips the
    // sentence inside each arm, and a copy guard then reads none of it.
    const arms = pluralArms('{n, plural, other {# แถวจาก {file} ถูกข้าม}}')
    expect(arms[0][1]).toContain('ถูกข้าม')
    expect(arms[0][1]).toContain('{file}')
  })

  it('a non-block throws rather than returning nothing', () => {
    expect(() => pluralArms('{label} ถูกลบแล้ว')).toThrow(/not a plural block/)
  })
})
