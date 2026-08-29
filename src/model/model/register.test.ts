import { describe, expect, it } from 'vitest'
import { readRegisterData } from './register'

// SEMANTICS-M.md §M2 + SEMANTICS-R2.md §R2-1.1.

const okr = (raw: unknown) => {
  const r = readRegisterData(raw)
  if (!r.ok) throw new Error(`expected ok, got payload-invalid: ${r.detail}`)
  return r
}

describe('loop-model/1 register — defensive read (§M2)', () => {
  it('expr defaults to "0" and is stored in §X8 canonical form', () => {
    expect(okr({ kind: 'register', label: 'Profit' }).data.expr).toBe('0')
    expect(okr({ label: 'p', expr: '@rev-@cost' }).data.expr).toBe('@rev - @cost')
    expect(okr({ label: 'p', expr: '  1.0 + @{pool_x} ' }).data.expr).toBe('1 + @pool_x')
  })

  it('a non-string or unparseable expr is payload-invalid (structural gate)', () => {
    expect(readRegisterData({ label: 'p', expr: 42 }).ok).toBe(false)
    expect(readRegisterData({ label: 'p', expr: '@a +' }).ok).toBe(false)
    expect(readRegisterData({ label: 'p', expr: 'min(@a,@b)' }).ok).toBe(false)
    expect(readRegisterData({ label: 5, expr: '0' }).ok).toBe(false)
    expect(readRegisterData('nope').ok).toBe(false)
  })

  it('a parseable expr with a dangling @id is kept (invalid only at eval)', () => {
    expect(okr({ label: 'p', expr: '@missing * 2' }).data.expr).toBe('@missing * 2')
  })

  it('unit follows the §M1.2 rule; format must be int/float/percent', () => {
    expect(okr({ label: 'p', expr: '0', unit: '  gold ' }).data.unit).toBe('gold')
    expect(okr({ label: 'p', expr: '0', format: 'percent' }).data.format).toBe('percent')
    const bad = okr({ label: 'p', expr: '0', format: 'money' })
    expect(bad.data.format).toBeUndefined()
    expect(bad.notices).toContain('REG_FORMAT_INVALID')
  })
})
