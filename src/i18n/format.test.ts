import { afterEach, describe, expect, it, vi } from 'vitest'
import { __formatCacheSize, tryFormat } from './format'
import { t } from './index'
import enCatalog from './locales/en'
import { useI18n } from './store'

afterEach(() => {
  vi.restoreAllMocks()
  useI18n.setState({ activeLocale: 'en', activeCatalog: enCatalog })
})

describe('tryFormat — never throws, never leaks the pattern', () => {
  it('formats a named slot / plural / select', () => {
    expect(tryFormat('en', 'k.a', 'Step {n}', { n: 4 })).toBe('Step 4')
    expect(tryFormat('ko', 'k.a', '{n}단계', { n: 4 })).toBe('4단계')
    expect(tryFormat('en', 'k.p', '{n, plural, one {# item} other {# items}}', { n: 3 })).toBe('3 items')
    expect(tryFormat('en', 'k.s', '{g, select, b {Beta} other {?}}', { g: 'b' })).toBe('Beta')
  })

  it('returns null (not the raw pattern) on a malformed message', () => {
    expect(tryFormat('en', 'k.bad', 'Step {n')).toBeNull()
  })

  it('returns null when a required argument is missing', () => {
    expect(tryFormat('en', 'k.mi', 'Step {n}', {})).toBeNull()
    expect(tryFormat('en', 'k.mi2', 'Step {n}')).toBeNull()
    expect(tryFormat('en', 'k.mi3', '{n, plural, one {#} other {#}}', {})).toBeNull()
  })

  it('a wrong-kind argument degrades without a throw and without leaking the pattern', () => {
    // a string in a plural slot: intl-messageformat renders "NaN", it does not
    // throw. The output is not the raw ICU pattern; the CI arg-KIND check
    // (validate.ts) is the real guard against a catalog shipping this.
    const out = tryFormat('en', 'k.wk', '{n, plural, one {#} other {#}}', { n: 'abc' })
    expect(out).not.toContain('plural')
    expect(out).not.toContain('{n')
  })

  it('warns in dev with key + locale + error class only — never the message or params', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    tryFormat('en', 'secret.key', 'The password is {pw}', {})
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0][0] as string
    expect(line).toContain('secret.key')
    expect(line).toContain('(en)')
    expect(line).not.toContain('password') // raw message never logged
    expect(line).not.toContain('{pw}')
  })

  it('caches the compiled formatter per (locale, key, message)', () => {
    const before = __formatCacheSize()
    tryFormat('en', 'cache.x', 'X {a}', { a: 1 })
    tryFormat('en', 'cache.x', 'X {a}', { a: 2 })
    expect(__formatCacheSize()).toBe(before + 1)
  })
})

describe('t() — the §L4.4 fallback chain: active → en → generic → key', () => {
  const withActive = (catalog: Record<string, string>) =>
    useI18n.setState({ activeLocale: 'xx', activeCatalog: catalog as never })

  it('1→2: a malformed active message falls back to the `en` message', () => {
    withActive({ ...enCatalog, 'playbar.step': 'step {n' }) // broken in the active locale
    expect(t('playbar.step', { n: 5 })).toBe('step 5') // the en message
  })

  it('1→2: an active message missing a required arg falls back to `en` (which has it)', () => {
    // active wants {extra} that no call site supplies; en wants only {n}
    withActive({ ...enCatalog, 'playbar.step': 'step {n} of {extra}' })
    expect(t('playbar.step', { n: 3 })).toBe('step 3') // the en message
  })

  it('2→3: when `en` also fails (missing param on both), a localised notice + the key — no raw ICU, no throw', () => {
    withActive({ ...enCatalog }) // active == en; the required param is not supplied
    let out = ''
    expect(() => {
      out = t('playbar.step') // needs {n}, none given ⇒ both active and en fail
    }).not.toThrow()
    expect(out).toBe('text unavailable (playbar.step)')
    expect(out).not.toContain('{n}')
  })

  it('the notice is localised to the active locale', () => {
    // active catalog carries the KO notice; only the notice key resolves
    withActive({ 'i18n.messageError': '문구를 표시할 수 없음 ({key})' })
    expect(t('playbar.step')).toBe('문구를 표시할 수 없음 (playbar.step)')
  })
})
