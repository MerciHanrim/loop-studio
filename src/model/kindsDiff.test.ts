// SEMANTICS-R14.md §R14-2 — what the review's Kinds line shows of two kinds tables.
import { describe, expect, it } from 'vitest'
import type { ResourceKindDecl } from './kinds'
import { kindsDiff } from './kindsDiff'

const KG: ResourceKindDecl = { name: 'coffee mass', conserved: true, baseUnit: 'kg', rateUnits: [{ name: 'kg per min', factor: '1', per: 'min' }] }

describe('kindsDiff', () => {
  it('two equal tables differ in nothing', () => {
    expect(kindsDiff([KG], [KG])).toEqual([])
    expect(kindsDiff(null, null)).toEqual([])
  })

  it('a renamed base unit is named with both values, and shows on every unit of the kind', () => {
    // the factor of the rate unit is the same text on both sides, and 1 kg/min is not 1 g/min
    expect(kindsDiff([KG], [{ ...KG, baseUnit: 'g' }])).toEqual([
      { kind: 'coffee mass', what: 'baseUnit', yours: 'kg', theirs: 'g' },
      { kind: 'coffee mass', what: 'unit', unit: 'kg per min', yours: '1 kg/min', theirs: '1 g/min' },
    ])
  })

  it('a changed factor is told by what one unit is worth on each side', () => {
    expect(kindsDiff([KG], [{ ...KG, baseUnit: 'g', rateUnits: [{ name: 'kg per min', factor: '1000', per: 'min' }] }])).toEqual([
      { kind: 'coffee mass', what: 'baseUnit', yours: 'kg', theirs: 'g' },
      { kind: 'coffee mass', what: 'unit', unit: 'kg per min', yours: '1 kg/min', theirs: '1000 g/min' },
    ])
    expect(kindsDiff([KG], [{ ...KG, rateUnits: [{ name: 'kg per min', factor: '60', per: 'h' }] }])).toEqual([{ kind: 'coffee mass', what: 'unit', unit: 'kg per min', yours: '1 kg/min', theirs: '60 kg/h' }])
  })

  it('a unit one side lacks has no worth there', () => {
    const bags = { ...KG, units: [{ name: 'bag', factor: '60' }] }
    expect(kindsDiff([KG], [bags])).toEqual([{ kind: 'coffee mass', what: 'unit', unit: 'bag', yours: null, theirs: '60 kg' }])
    expect(kindsDiff([bags], [KG])).toEqual([{ kind: 'coffee mass', what: 'unit', unit: 'bag', yours: '60 kg', theirs: null }])
  })

  it('a kind without a base unit is worth its bare factor, and gaining one is told', () => {
    const bare: ResourceKindDecl = { name: 'tokens', conserved: false, units: [{ name: 'dozen', factor: '12' }] }
    expect(kindsDiff([bare], [{ ...bare, baseUnit: 'pc' }])).toEqual([
      { kind: 'tokens', what: 'baseUnit', yours: null, theirs: 'pc' },
      { kind: 'tokens', what: 'unit', unit: 'dozen', yours: '12', theirs: '12 pc' },
    ])
  })

  it('conserved, and a kind only one side holds', () => {
    expect(kindsDiff([KG], [{ ...KG, conserved: false }])).toEqual([{ kind: 'coffee mass', what: 'conserved', yours: true, theirs: false }])
    const chaff: ResourceKindDecl = { name: 'chaff', conserved: false, baseUnit: 'g' }
    expect(kindsDiff([KG], [KG, chaff])).toEqual([
      { kind: 'chaff', what: 'kind', yours: false, theirs: true },
      { kind: 'chaff', what: 'baseUnit', yours: null, theirs: 'g' },
    ])
    expect(kindsDiff([KG, chaff], [KG])).toEqual([
      { kind: 'chaff', what: 'kind', yours: true, theirs: false },
      { kind: 'chaff', what: 'baseUnit', yours: 'g', theirs: null },
    ])
  })

  it('the proposal’s kinds come first, in its order', () => {
    const a: ResourceKindDecl = { name: 'a', conserved: false }
    const b: ResourceKindDecl = { name: 'b', conserved: false }
    expect(kindsDiff([a, b], [{ ...b, conserved: true }, { ...a, conserved: true }]).map((r) => r.kind)).toEqual(['b', 'a'])
  })
})
