import { describe, expect, it } from 'vitest'
import { canonicaliseExpr, parseExpr } from './index'

// SEMANTICS-X.md §X8 (canonical form) + X-INV-4 / X-INV-5.

const canon = (src: string) => {
  const c = canonicaliseExpr(src)
  if (c == null) throw new Error(`expected ${JSON.stringify(src)} to parse`)
  return c
}

describe('loop-expr/1 §X8 canonical form', () => {
  it('one space around a binary op, none around unary minus / grouping', () => {
    expect(canon('@a+@b')).toBe('@a + @b')
    expect(canon('  @a  *  @c ')).toBe('@a * @c')
    expect(canon('-@a')).toBe('-@a')
    expect(canon('-(@a+@b)')).toBe('-(@a + @b)')
    expect(canon('( @a + @b )')).toBe('@a + @b')
  })

  it('keeps parens iff removing them changes the parse', () => {
    expect(canon('@a + @b * @c')).toBe('@a + @b * @c')
    expect(canon('(@a + @b) * @c')).toBe('(@a + @b) * @c')
    expect(canon('@a - (@b - @c)')).toBe('@a - (@b - @c)')
    expect(canon('@a - @b - @c')).toBe('@a - @b - @c')
    expect(canon('(@a - @b) - @c')).toBe('@a - @b - @c')
    expect(canon('-(@a * @b)')).toBe('-(@a * @b)')
    expect(canon('-@a * @b')).toBe('-@a * @b')
    expect(canon('@a + (@b - @c)')).toBe('@a + (@b - @c)')
  })

  it('number literals: shortest round-tripping decimal, -0 → 0', () => {
    expect(canon('007')).toBe('7')
    expect(canon('1.50')).toBe('1.5')
    expect(canon('2.0')).toBe('2')
    expect(canon('1e3')).toBe('1000')
    expect(canon('1e21')).toBe('1e+21')
    expect(canon('0.0')).toBe('0')
  })

  it('references: @id for a SAFE_ID target, @{…} otherwise; @{safe} folds to @safe', () => {
    expect(canon('@{pool_x}')).toBe('@pool_x')
    expect(canon('@{a-b.c}')).toBe('@{a-b.c}')
    expect(canon('@{1leading}')).toBe('@{1leading}')
    expect(canon('@{a\\}b}')).toBe('@{a\\}b}')
    expect(canon('@{a\\\\b}')).toBe('@{a\\\\b}')
  })

  it('does NOT fold constants, reorder operands, or reassociate (X-INV-4)', () => {
    expect(canon('1 + 1')).toBe('1 + 1')
    expect(canon('@a + @b')).not.toBe(canon('@b + @a'))
    expect(canon('@a + @b')).toBe('@a + @b')
  })

  it('canonicalise is idempotent (X-INV-5)', () => {
    for (const src of ['@a+@b*@c', '-(@a-@b)-@c', '1.0 + @{pool_x} / (@r - 2)', '@{a-b} * -@c']) {
      const once = canon(src)
      expect(canon(once)).toBe(once)
    }
  })

  it('parseExpr returns the AST and its canonical text together', () => {
    const r = parseExpr('@a+@b')
    expect(r.ok && r.expr.canonical).toBe('@a + @b')
  })

  it('canonicaliseExpr returns null for an unparseable string', () => {
    expect(canonicaliseExpr('@a +')).toBeNull()
    expect(canonicaliseExpr('')).toBeNull()
  })
})
