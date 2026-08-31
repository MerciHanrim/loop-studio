import { describe, expect, it } from 'vitest'
import { __formatCacheSize, formatMessage } from './format'

describe('formatMessage — intl-messageformat wrapper', () => {
  it('substitutes a named slot', () => {
    expect(formatMessage('en', 'k.a', 'Step {n}', { n: 4 })).toBe('Step 4')
    expect(formatMessage('ko', 'k.a', '{n}단계', { n: 4 })).toBe('4단계')
  })

  it('handles ICU plural with per-locale categories', () => {
    const m = '{n, plural, one {# item} other {# items}}'
    expect(formatMessage('en', 'k.p', m, { n: 1 })).toBe('1 item')
    expect(formatMessage('en', 'k.p', m, { n: 3 })).toBe('3 items')
    // Korean has only `other`
    expect(formatMessage('ko', 'k.p', '{n, plural, other {#개}}', { n: 3 })).toBe('3개')
  })

  it('handles select', () => {
    const m = '{g, select, a {Alpha} b {Beta} other {?}}'
    expect(formatMessage('en', 'k.s', m, { g: 'b' })).toBe('Beta')
    expect(formatMessage('en', 'k.s', m, { g: 'z' })).toBe('?')
  })

  it('a message with no params passes through', () => {
    expect(formatMessage('en', 'k.n', 'Play')).toBe('Play')
  })

  it('a malformed pattern falls back to the raw string, never throws', () => {
    expect(formatMessage('en', 'k.bad', 'Step {n')).toBe('Step {n')
  })

  it('caches the compiled formatter per (locale, key, message)', () => {
    const before = __formatCacheSize()
    formatMessage('en', 'cache.x', 'X {a}', { a: 1 })
    formatMessage('en', 'cache.x', 'X {a}', { a: 2 })
    formatMessage('en', 'cache.x', 'X {a}', { a: 3 })
    expect(__formatCacheSize()).toBe(before + 1)
    formatMessage('ko', 'cache.x', 'X {a}', { a: 1 }) // different locale ⇒ new entry
    expect(__formatCacheSize()).toBe(before + 2)
  })
})
