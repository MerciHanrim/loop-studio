import { describe, expect, it } from 'vitest'
import { PARAM_UNIT_MAX_BYTES, SOURCE_ID_MAX_BYTES, SOURCE_KEY_MAX_BYTES, readParameterData } from './parameter'

// SEMANTICS-M.md §M1 + SEMANTICS-R2.md §R2-1.1.

const okp = (raw: unknown) => {
  const r = readParameterData(raw)
  if (!r.ok) throw new Error(`expected ok, got payload-invalid: ${r.detail}`)
  return r
}

describe('loop-model/1 parameter — defensive read (§M1)', () => {
  it('value is the only semantic field; absent ⇒ 0 + PARAM_VALUE_FIXED; never invalid', () => {
    const r = okp({ kind: 'parameter', label: 'Price' })
    expect(r.data).toEqual({ kind: 'parameter', label: 'Price', value: 0 })
    expect(r.notices).toEqual(['PARAM_VALUE_FIXED'])
  })

  it('keeps a stored value exactly (−0 → 0), no rounding', () => {
    expect(okp({ label: 'x', value: 4.5 }).data.value).toBe(4.5)
    expect(Object.is(okp({ label: 'x', value: -0 }).data.value, 0)).toBe(true)
  })

  it('a non-number / non-finite value is payload-invalid (structural gate)', () => {
    expect(readParameterData({ label: 'x', value: {} }).ok).toBe(false)
    expect(readParameterData({ label: 'x', value: 'nope' }).ok).toBe(false)
    expect(readParameterData({ label: 'x', value: Number.POSITIVE_INFINITY }).ok).toBe(false)
    expect(readParameterData({ label: 'x', value: Number.NaN }).ok).toBe(false)
    expect(readParameterData({ label: 42, value: 1 }).ok).toBe(false)
    expect(readParameterData(null).ok).toBe(false)
  })

  it('min/max only survive as a coherent finite pair; otherwise dropped + PARAM_RANGE_INVALID', () => {
    expect(okp({ label: 'x', value: 5, min: 0, max: 10 }).data).toMatchObject({ min: 0, max: 10 })
    const bad = okp({ label: 'x', value: 5, min: 10, max: 1 })
    expect(bad.data.min).toBeUndefined()
    expect(bad.data.max).toBeUndefined()
    expect(bad.notices).toContain('PARAM_RANGE_INVALID')
    const lone = okp({ label: 'x', value: 5, min: 3 })
    expect(lone.data.min).toBeUndefined()
    expect(lone.notices).toContain('PARAM_RANGE_INVALID')
  })

  it('step survives only when finite and > 0', () => {
    expect(okp({ label: 'x', value: 0, step: 0.5 }).data.step).toBe(0.5)
    expect(okp({ label: 'x', value: 0, step: 0 }).notices).toContain('PARAM_STEP_INVALID')
    expect(okp({ label: 'x', value: 0, step: -1 }).data.step).toBeUndefined()
  })

  it('unit is trimmed (Unicode White_Space), NFC, capped at 24 bytes', () => {
    expect(okp({ label: 'x', value: 0, unit: '  gold  ' }).data.unit).toBe('gold')
    expect(okp({ label: 'x', value: 0, unit: '   ' }).data.unit).toBeUndefined()
    const long = 'x'.repeat(40)
    const r = okp({ label: 'x', value: 0, unit: long })
    expect(r.data.unit!.length).toBe(PARAM_UNIT_MAX_BYTES)
    expect(r.notices).toContain('PARAM_UNIT_TOO_LONG')
  })

  it('an out-of-range value is kept unclamped with an advisory notice', () => {
    const r = okp({ label: 'x', value: 99, min: 0, max: 10 })
    expect(r.data.value).toBe(99)
    expect(r.notices).toContain('PARAM_VALUE_OUT_OF_RANGE')
  })
})

// docs/data-import.md §DI9 / §DI13 (`loop-revision/8`, SEMANTICS-R8.md).
describe('loop-model/1 parameter — data-import provenance (§DI9)', () => {
  it('absent on an ordinary hand-created Parameter; no notice', () => {
    const r = okp({ label: 'x', value: 0 })
    expect(r.data.sourceTableId).toBeUndefined()
    expect(r.data.sourceKey).toBeUndefined()
    expect(r.data.sourceColumnId).toBeUndefined()
    expect(r.data.labelAutoComposed).toBeUndefined()
    expect(r.notices).toEqual([])
  })

  it('the full generating triple + labelAutoComposed survive verbatim', () => {
    const r = okp({
      label: 'x',
      value: 10,
      sourceTableId: 'srctable_1',
      sourceKey: 'itm_blade_ssr',
      sourceColumnId: 'srccol_1',
      labelAutoComposed: true,
    })
    expect(r.data).toMatchObject({
      sourceTableId: 'srctable_1',
      sourceKey: 'itm_blade_ssr',
      sourceColumnId: 'srccol_1',
      labelAutoComposed: true,
    })
    expect(r.notices).toEqual([])
  })

  it('each of the four fields is read INDEPENDENTLY — an incoherent PARTIAL triple survives (not a coherent-pair-or-drop rule like min/max)', () => {
    const r = okp({ label: 'x', value: 0, sourceKey: 'itm_blade_ssr' }) // no table/column id at all
    expect(r.data.sourceKey).toBe('itm_blade_ssr')
    expect(r.data.sourceTableId).toBeUndefined()
    expect(r.data.sourceColumnId).toBeUndefined()
    expect(r.notices).toEqual([]) // a genuinely absent field is not "invalid" — only a WRONG-TYPED one is
  })

  it('a wrong-typed field is dropped with PARAM_SOURCE_INVALID; sibling fields are unaffected', () => {
    const r = okp({ label: 'x', value: 0, sourceTableId: 42, sourceKey: 'itm_blade_ssr' })
    expect(r.data.sourceTableId).toBeUndefined()
    expect(r.data.sourceKey).toBe('itm_blade_ssr') // unaffected — no cross-field coherence rule
    expect(r.notices).toContain('PARAM_SOURCE_INVALID')
  })

  it('an empty string is not a valid id / key — dropped with PARAM_SOURCE_INVALID', () => {
    expect(okp({ label: 'x', value: 0, sourceTableId: '' }).data.sourceTableId).toBeUndefined()
    expect(okp({ label: 'x', value: 0, sourceKey: '' }).notices).toContain('PARAM_SOURCE_INVALID')
  })

  it('sourceTableId / sourceColumnId respect their own SOURCE_ID_MAX_BYTES ceiling', () => {
    const ok = 'x'.repeat(SOURCE_ID_MAX_BYTES)
    const tooLong = 'x'.repeat(SOURCE_ID_MAX_BYTES + 1)
    expect(okp({ label: 'x', value: 0, sourceTableId: ok }).data.sourceTableId).toBe(ok)
    const r = okp({ label: 'x', value: 0, sourceTableId: tooLong })
    expect(r.data.sourceTableId).toBeUndefined()
    expect(r.notices).toContain('PARAM_SOURCE_INVALID')
  })

  it('sourceKey respects its OWN SOURCE_KEY_MAX_BYTES ceiling, independent of SOURCE_ID_MAX_BYTES or PARAM_UNIT_MAX_BYTES', () => {
    expect(SOURCE_KEY_MAX_BYTES).toBeGreaterThan(SOURCE_ID_MAX_BYTES) // a designer key, not an internal id
    expect(SOURCE_KEY_MAX_BYTES).toBeGreaterThan(PARAM_UNIT_MAX_BYTES)
    const ok = 'k'.repeat(SOURCE_KEY_MAX_BYTES)
    const tooLong = 'k'.repeat(SOURCE_KEY_MAX_BYTES + 1)
    expect(okp({ label: 'x', value: 0, sourceKey: ok }).data.sourceKey).toBe(ok)
    expect(okp({ label: 'x', value: 0, sourceKey: tooLong }).data.sourceKey).toBeUndefined()
  })

  it('labelAutoComposed survives independently of the triple — no coupling enforced at read time', () => {
    const withoutTriple = okp({ label: 'x', value: 0, labelAutoComposed: false })
    expect(withoutTriple.data.labelAutoComposed).toBe(false)
    expect(withoutTriple.notices).toEqual([])
  })

  it('a non-boolean labelAutoComposed is dropped with PARAM_LABEL_AUTO_COMPOSED_INVALID', () => {
    const r = okp({ label: 'x', value: 0, labelAutoComposed: 'yes' })
    expect(r.data.labelAutoComposed).toBeUndefined()
    expect(r.notices).toContain('PARAM_LABEL_AUTO_COMPOSED_INVALID')
  })

  it('provenance never makes an otherwise-valid Parameter payload-invalid', () => {
    expect(readParameterData({ label: 'x', value: 1, sourceTableId: {}, sourceKey: [], labelAutoComposed: 3 }).ok).toBe(true)
  })
})
