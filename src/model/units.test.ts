import { describe, expect, it } from 'vitest'
import { initSim, step } from '../engine/step'
import { applyUnits, stripFieldUnits } from './engineValues'
import { convertersWhoseVerdictChanges, kindFindings, readKinds, readKindsAt, refusingKindFindings, type ResourceKindDecl } from './kinds'
import { extractModule, insertGraph } from './moduleGraph'
import { add, displayRational, equals, parseDecimal, rational, terminatingDecimal, toDouble } from './rational'
import { canonicalContent } from './revision'
import { deserialize, normalizeGraph, serialize } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { currentAmountText, engineValue, previewUnitChange, readDocTime, readFactor, reexpress, resolveFieldUnit, type DocTime } from './units'
import { canonicalGraphString } from './workspace'

// loop-model/4 (SEMANTICS-M4.md; #471 U1 stage 2, units-display-design.md
// rev 6) — exact rationals, the unit read, the derived engine value, the exact
// balance, the unit-change preview and the graph/4 boundary.

const XY = { x: 0, y: 0 }
const pool = (id: string, resourceType?: string, extra: Record<string, unknown> = {}): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...(resourceType ? { resourceType } : {}), ...extra } as LoopNode['data'],
})
const converter = (id: string): LoopNode => ({
  id, type: 'converter', position: XY,
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAll' } as unknown as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow: string, unit?: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow, ...(unit ? { unit } : {}) } as LoopEdge['data'],
})

const WATER: ResourceKindDecl[] = [
  { name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'MLD', factor: '1000', per: 'd' }] },
]
const revisionCanonical = (doc: Parameters<typeof canonicalContent>[0], modelVersion: 3 | 4) => JSON.stringify(canonicalContent(doc, { modelVersion }))
const HOUR: DocTime = { step: { value: 1, unit: 'h' } }
const DAY: DocTime = { step: { value: 1, unit: 'd' } }

describe('rational — exact decimals and R≈', () => {
  it('adds decimals exactly: 0.1 + 0.2 = 0.3, which a double does not', () => {
    const r = (s: string) => parseDecimal(s)!
    expect(equals(add(r('0.1'), r('0.2')), r('0.3'))).toBe(true)
    expect(0.1 + 0.2 === 0.3).toBe(false)
  })

  it('prints a terminating value exactly and a non-terminating one with ≈ and 15 significant digits', () => {
    expect(displayRational(rational(1n, 8n))).toEqual({ text: '0.125', approx: false })
    expect(displayRational(rational(7000n, 1n))).toEqual({ text: '7000', approx: false })
    expect(displayRational(rational(-1n, 1000000000000000n))).toEqual({ text: '-0.000000000000001', approx: false })
    expect(displayRational(rational(7n, 24n))).toEqual({ text: '≈ 0.291666666666667', approx: true })
    expect(terminatingDecimal(rational(1n, 3n))).toBeNull()
    // never the exponent form, however small or large
    expect(displayRational(rational(1n, 3000000000000000000n))).toEqual({ text: '≈ 0.000000000000000000333333333333333', approx: true })
    expect(displayRational(rational(10n ** 22n, 3n))).toEqual({ text: '≈ 3333333333333330000000', approx: true })
  })

  it('reads plain decimals and exponents, refuses anything else', () => {
    expect(parseDecimal('1e-3')).toEqual(rational(1n, 1000n))
    expect(parseDecimal('-2.50')).toEqual(rational(-5n, 2n))
    for (const bad of ['', '1/2', '25%', 'all', '@p', '1-3', '0x10', 'Infinity']) expect(parseDecimal(bad)).toBeNull()
  })

  it('refuses an exponent past every finite double, so a hostile file cannot hang the page', () => {
    expect(parseDecimal('1e308')).not.toBeNull()
    expect(parseDecimal('5e-324')).not.toBeNull()
    const t0 = performance.now()
    expect(parseDecimal('1e999999999')).toBeNull()
    expect(parseDecimal('1e-999999999')).toBeNull()
    expect(parseDecimal(`0.${'1'.repeat(100000)}`)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(50)
  })

  it('takes the nearest double of a rational', () => {
    expect(toDouble(rational(1n, 10n))).toBe(0.1)
    expect(toDouble(rational(7n, 24n))).toBe(7 / 24)
  })
})

describe('the §M4-1 read — unit lists and the step length', () => {
  it('keeps well-formed units in file order, unique across both lists and apart from the base unit', () => {
    const [k] = readKinds([
      {
        name: 'water', conserved: true, baseUnit: 'm³',
        units: [{ name: 'L', factor: '0.001' }, { name: 'm³', factor: '1' }, { name: 'bad/name', factor: '2' }, { name: 'kL', factor: 0 }, { name: 'L', factor: '5' }, { name: 'ML', factor: 1000.0 }],
        rateUnits: [{ name: 'L', factor: '1', per: 'h' }, { name: 'MLD', factor: '1000', per: 'd' }, { name: 'x', factor: '1', per: 'week' }],
      },
    ])
    expect(k!.units).toEqual([{ name: 'L', factor: '0.001' }, { name: 'ML', factor: '1000' }])
    expect(k!.rateUnits).toEqual([{ name: 'MLD', factor: '1000', per: 'd' }])
  })

  it('reads no unit list from a document before version 4', () => {
    expect(readKindsAt([{ name: 'water', conserved: true, units: [{ name: 'L', factor: '0.001' }] }], 3)).toEqual([{ name: 'water', conserved: true }])
    expect(readKindsAt([{ name: 'water', conserved: true, units: [{ name: 'L', factor: '0.001' }] }], 4)[0]!.units).toEqual([{ name: 'L', factor: '0.001' }])
  })

  it('reads a step length of 1…10⁶ whole s / min / h / d, and nothing else', () => {
    expect(readDocTime({ step: { value: 30, unit: 'min' }, display: 'h' })).toEqual({ step: { value: 30, unit: 'min' }, display: 'h' })
    for (const bad of [{ step: { value: 0, unit: 'h' } }, { step: { value: 1.5, unit: 'h' } }, { step: { value: 1, unit: 'week' } }, { step: 1 }, null]) expect(readDocTime(bad)).toBeUndefined()
  })
})

describe('the runnable range of a factor (§M4-1, Lumi review 1 of #488)', () => {
  it('reads 10⁻¹⁵ … 10¹⁵ and refuses a 15-digit factor outside it, such as 1e400', () => {
    expect(readFactor('1e15')).toBe('1000000000000000')
    expect(readFactor('1e-15')).toBe('0.000000000000001')
    for (const bad of ['1e400', '1e16', '1.000000000000001e15', '1e-16', '9.99e-16', '0', '-1']) expect(readFactor(bad)).toBeNull()
    expect(readKinds([{ name: 'w', conserved: false, units: [{ name: 'Big', factor: '1e400' }], rateUnits: [{ name: 'Hot', factor: '1e400', per: 's' }] }])).toEqual([{ name: 'w', conserved: false }])
  })

  it('keeps every engine value finite at the edges: the largest factor, per second, at the longest step', () => {
    const decl: ResourceKindDecl = { name: 'w', conserved: false, units: [{ name: 'P', factor: '1e15' }], rateUnits: [{ name: 'Pps', factor: '1e15', per: 's' }] }
    const longest: DocTime = { step: { value: 1_000_000, unit: 'd' } }
    for (const u of ['P/s', 'Pps']) {
      const fu = resolveFieldUnit(u, decl, longest, 'rate')
      expect(Number.isFinite(engineValue('1e280', fu, longest))).toBe(true)
      expect(engineValue('1', fu, longest)).toBe(8.64e25)
    }
    const smallest: ResourceKindDecl = { name: 'w', conserved: false, units: [{ name: 'f', factor: '1e-15' }] }
    expect(engineValue('1', resolveFieldUnit('f', smallest, HOUR, 'stock'), HOUR)).toBe(1e-15)
  })

  it('refuses a run on an authored value whose engine value is not finite, conserved kind or not', () => {
    const decl: ResourceKindDecl[] = [{ name: 'w', conserved: false, rateUnits: [{ name: 'Pps', factor: '1e15', per: 's' }] }]
    const longest: DocTime = { step: { value: 1_000_000, unit: 'd' } }
    const source: LoopNode = { id: 'src', type: 'source', position: XY, data: { kind: 'source', label: 'src', activation: 'automatic', mode: 'pushAny' } as unknown as LoopNode['data'] }
    const nodes = [pool('p', 'w'), source]
    const edges = [res('e', 'src', 'p', '1e300', 'Pps')]
    expect(kindFindings(nodes, edges, decl, 4, longest)).toEqual([{ cls: 'outOfRange', nodeId: null, edgeId: 'e', value: '1e300', unit: 'Pps', refuses: true }])
    expect(refusingKindFindings(nodes, edges, decl, 4, longest)).toHaveLength(1)
    const r = step(nodes, edges, initSim(nodes, { kinds: decl, time: longest }), 1, 4, { kinds: decl, time: longest })
    expect(r.state.values.p).toBe(0)
    expect(r.report.diagnostics[0]).toMatch(/holds 1e300 Pps, which is beyond the numbers a run can hold/)
    // below 10²⁸⁰ the rate stays finite even at the longest step, and runs
    expect(refusingKindFindings(nodes, [res('e', 'src', 'p', '1e280', 'Pps')], decl, 4, longest)).toEqual([])
  })
})

describe('a module insert keeps every field’s meaning (§M4-4, Lumi review 1 of #488)', () => {
  const water = (units?: ResourceKindDecl['units'], baseUnit = 'm³'): ResourceKindDecl[] => [{ name: 'water', conserved: false, baseUnit, ...(units ? { units } : {}) }]
  const source: LoopNode = { id: 'src', type: 'source', position: XY, data: { kind: 'source', label: 'src', activation: 'automatic', mode: 'pushAny' } as unknown as LoopNode['data'] }
  /** Lumi's module: written at a 1 h step, `24 L/day` = 1 L per step */
  const mod = (time: DocTime | undefined, units = [{ name: 'L', factor: '0.001' }]) => ({
    nodes: [source, pool('tank', 'water')], edges: [res('feed', 'src', 'tank', '24', 'L/d')], modelVersion: 4 as const, kinds: water(units), ...(time ? { time } : {}),
  })
  const host = (time: DocTime | undefined, kinds = water(), extra: { nodes?: LoopNode[]; edges?: LoopEdge[] } = {}) => ({
    ...normalizeGraph({ nodes: [pool('h', 'water'), ...(extra.nodes ?? [])], edges: extra.edges ?? [] }), modelVersion: 4 as const, kinds, ...(time ? { time } : {}),
  })

  it('refuses a module written with another step length: 24 L/day at 1 h into a 1 d document would move 24 L per step, not 1 L', () => {
    const r = insertGraph(host(DAY), mod(HOUR), { at: XY })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/written with a step of 1 h and this document's step is 1 d/)
  })

  it('inserts at an equal step length however it is written (60 min = 1 h), every engine value kept', () => {
    const r = insertGraph(host({ step: { value: 60, unit: 'min' } }), mod(HOUR), { at: XY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const derived = applyUnits(r.nodes, r.edges, r.kinds, r.time)
    expect((derived.edges.at(-1)!.data as { flow: string }).flow).toBe('0.001') // 1 L per step
  })

  it('a host with no step length adopts the module’s when that changes no field, and refuses when it would', () => {
    const ok = insertGraph(host(undefined), mod(HOUR), { at: XY })
    expect(ok.ok && ok.time).toEqual(HOUR)
    // a host field written `L/min` read as the base unit for want of a step length; adopting 1 h would scale it
    const hostEdges = [res('hf', 'hsrc', 'h', '5', 'L/min')]
    const hostSrc: LoopNode = { ...source, id: 'hsrc' }
    const bad = insertGraph(host(undefined, water([{ name: 'L', factor: '0.001' }]), { nodes: [hostSrc], edges: hostEdges }), mod(HOUR), { at: XY })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason, bad.reason).toMatch(/would change what these fields move: the connection from src to h/)
  })

  it('brings the module’s units into the host’s kind, and refuses a unit name both declare with another factor', () => {
    const joined = insertGraph(host(HOUR, water()), mod(HOUR), { at: XY })
    expect(joined.ok && joined.kinds).toEqual(water([{ name: 'L', factor: '0.001' }]))
    const clash = insertGraph(host(HOUR, water([{ name: 'L', factor: '1' }])), mod(HOUR), { at: XY })
    expect(clash.ok).toBe(false)
    if (!clash.ok) expect(clash.reason).toMatch(/Unit "L" of "water" is 0.001 in the structure and 1 in this document/)
    const same = insertGraph(host(HOUR, water([{ name: 'L', factor: '0.001' }])), mod(HOUR), { at: XY })
    expect(same.ok).toBe(true)
  })

  it('refuses two different base units for one kind: the numbers count different amounts', () => {
    const r = insertGraph(host(HOUR, water(undefined, 'L')), mod(HOUR), { at: XY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/counted in "m³" in the structure and in "L" in this document/)
  })

  it('a module whose rate is a Parameter reference still inserts: the reference is renamed, its meaning is not', () => {
    const param: LoopNode = { id: 'q', type: 'parameter', position: XY, data: { kind: 'parameter', label: 'q', value: 2 } as unknown as LoopNode['data'] }
    const m2 = { ...normalizeGraph({ nodes: [source, pool('tank', 'water'), param], edges: [res('feed', 'src', 'tank', '@q')] }), modelVersion: 4 as const, kinds: water(), time: HOUR }
    const r = insertGraph(host(HOUR), m2, { at: XY })
    expect(r.ok).toBe(true)
  })

  it('a selection from a document with a step length carries it, so the insert can compare', () => {
    const src = { nodes: [source, pool('tank', 'water')], edges: [res('feed', 'src', 'tank', '3')], modelVersion: 4 as const, kinds: water(), time: HOUR }
    const x = extractModule(src, ['src', 'tank'])
    expect(x.ok && x.modelVersion).toBe(4)
    expect(x.ok && x.time).toEqual(HOUR)
  })
})

describe('a field unit — fail-safe to the base unit (§M4-2.2)', () => {
  const decl = WATER[0]!
  it('resolves amount, per-time and rate units by role and step length', () => {
    expect(resolveFieldUnit('L', decl, HOUR, 'stock')).toMatchObject({ kind: 'amount' })
    expect(resolveFieldUnit('L/min', decl, HOUR, 'rate')).toMatchObject({ kind: 'amount', per: 'min' })
    expect(resolveFieldUnit('MLD', decl, HOUR, 'rate')).toMatchObject({ kind: 'rate' })
  })
  it('reads an unknown name, a rate on a stock and a per-time unit without a step length as the base unit', () => {
    expect(resolveFieldUnit('gal', decl, HOUR, 'rate')).toEqual({ kind: 'base' })
    expect(resolveFieldUnit('MLD', decl, HOUR, 'stock')).toEqual({ kind: 'base' })
    expect(resolveFieldUnit('L/min', decl, HOUR, 'stock')).toEqual({ kind: 'base' })
    expect(resolveFieldUnit('L/min', decl, undefined, 'rate')).toEqual({ kind: 'base' })
    expect(resolveFieldUnit('MLD', decl, undefined, 'rate')).toEqual({ kind: 'base' })
  })
  it('derives the engine value from the exact rational: 1 L/min at a 1 h step is 0.06 m³ per step', () => {
    expect(engineValue('1', resolveFieldUnit('L/min', decl, HOUR, 'rate'), HOUR)).toBe(0.06)
    expect(engineValue('1000', resolveFieldUnit('L', decl, HOUR, 'stock'), HOUR)).toBe(1)
    expect(engineValue('7', { kind: 'base' }, HOUR)).toBe(7)
  })
})

describe('an engine value shown in its Pool unit — 15 significant digits, ≈ when it is not the engine value (§M4-5, Lumi review of the desalination example)', () => {
  const L = resolveFieldUnit('L', WATER[0], HOUR, 'stock')
  it('marks the float residue of 1000/24 m³ steps with ≈ at 15 significant digits, never as an exact 1699999.999999984', () => {
    // 720 steps: the residue (−1.6 × 10⁻¹¹ m³, 9.4 × 10⁻¹⁵ relative) is just above 15-digit resolution
    expect(reexpress(1699.999999999984, L, HOUR)).toEqual({ text: '≈ 1699999.99999998', approx: true })
    expect(currentAmountText(1699.999999999984, 200000, 'L', L, HOUR)).toBe('≈ 1699999.99999998 L')
    // 24 steps: the residue (+2.3 × 10⁻¹³ m³) is below it, and the text is the model value, marked
    expect(currentAmountText(250.00000000000023, 200000, 'L', L, HOUR)).toBe('≈ 250000 L')
    expect(currentAmountText(202.08333333333334, 200000, 'L', L, HOUR)).toBe('≈ 202083.333333333 L')
  })
  it('shows an engine value it holds exactly with no ≈, and the authored value before a run', () => {
    expect(reexpress(200, L, HOUR)).toEqual({ text: '200000', approx: false })
    expect(reexpress(18.75, L, HOUR)).toEqual({ text: '18750', approx: false })
    expect(currentAmountText(undefined, 200000, 'L', L, HOUR)).toBe('200000 L')
  })
  it('a double that is not its decimal is marked: 0.1 m³ is 100.000000000000005551… L', () => {
    expect(reexpress(0.1, L, HOUR)).toEqual({ text: '≈ 100', approx: true })
  })
  it('a Pool in the base unit keeps the two-decimal format, and nothing here touches a stored value', () => {
    expect(currentAmountText(499.99999999999994, 500, undefined, { kind: 'base' }, HOUR)).toBe('500.00')
    expect(currentAmountText(undefined, 500, undefined, { kind: 'base' }, HOUR)).toBe('500')
  })
})

describe('a unit change — exact or confirmed, never silent (§M4-4, D10)', () => {
  const decl = WATER[0]!
  const perDay = (u: string) => resolveFieldUnit(u, decl, DAY, 'rate')
  it('applies at once when the re-expressed value is exact within 15 digits', () => {
    expect(previewUnitChange('7', { kind: 'base' }, perDay('L'), DAY)).toEqual({ exact: true, value: '7000' })
    expect(previewUnitChange('7', { kind: 'base' }, perDay('MLD'), DAY)).toEqual({ exact: true, value: '0.007' })
  })
  it('offers the rounded value with its deviation under R≈ when it is not', () => {
    const p = previewUnitChange('7', { kind: 'base' }, perDay('L/h'), DAY)
    // 7 m³/day = 7000/24 L/h = 291.666… L/h
    expect(p).toMatchObject({ exact: false, rounded: '291.666666666667', exactShown: '≈ 291.666666666667' })
    expect(p && !p.exact && p.deviation.approx).toBe(false)
    expect(p && !p.exact && p.deviation.text).toBe('0.000000000000008')
  })
})

describe('C1 exact — the balance over authored decimals and units (D4)', () => {
  const nodes = [pool('sea', 'water'), converter('ro'), pool('perm', 'water'), pool('brine', 'water')]
  const recipe = (feed: string, feedUnit: string | undefined, perm: string, brine: string, unit?: string) => [
    res('f', 'sea', 'ro', feed, feedUnit), res('p', 'ro', 'perm', perm, unit), res('b', 'ro', 'brine', brine, unit),
  ]
  it('balances 0.3 = 0.1 + 0.2 and 100 = 45 + 53 + 2 with no epsilon', () => {
    expect(kindFindings(nodes, recipe('0.3', undefined, '0.1', '0.2'), WATER, 4)).toEqual([])
    expect(kindFindings(nodes, recipe('0.3', undefined, '0.1', '0.2000000000000001'), WATER, 4)).toMatchObject([{ cls: 'broken', diffText: '0.0000000000000001', approx: false }])
  })
  it("keeps Lumi's recipe balanced in two units: 7 m³ per step in, 3000 L + 4000 L out", () => {
    expect(kindFindings(nodes, recipe('7', undefined, '3000', '4000', 'L'), WATER, 4, DAY)).toEqual([])
  })
  it('a mixed recipe: 1 L/min in, 0.06 m³ per step out balances at a 1 h step and breaks at 30 min', () => {
    const edges = [res('f', 'sea', 'ro', '1', 'L/min'), res('p', 'ro', 'perm', '0.06')]
    const half: DocTime = { step: { value: 30, unit: 'min' } }
    const at1h = kindFindings(nodes, edges, WATER, 4, HOUR)
    const at30 = kindFindings(nodes, edges, WATER, 4, half)
    expect(at1h).toEqual([])
    expect(at30).toMatchObject([{ cls: 'broken', converterId: 'ro', inText: '0.03', outText: '0.06', diffText: '0.03', approx: false }])
    expect(convertersWhoseVerdictChanges(at1h, at30)).toEqual(['ro'])
    expect(convertersWhoseVerdictChanges(at1h, at1h)).toEqual([])
  })
  it('a resolved @param is read in the base unit, as the engine reads it', () => {
    const param: LoopNode = { id: 'q', type: 'parameter', position: XY, data: { kind: 'parameter', label: 'q', value: 7 } as unknown as LoopNode['data'] }
    const edges = [res('f', 'sea', 'ro', '@q', 'L'), res('p', 'ro', 'perm', '7')]
    expect(kindFindings([...nodes, param], edges, WATER, 4)).toEqual([])
  })
})

describe('the derived graph the engine reads (§M4-2.1)', () => {
  it('is the same arrays when no field names a unit (M4-INV-1)', () => {
    const nodes = [pool('a', 'water')]
    const edges = [res('e', 'a', 'a', '1')]
    const r = applyUnits(nodes, edges, WATER, HOUR)
    expect(r.nodes).toBe(nodes)
    expect(r.edges).toBe(edges)
  })
  it('carries each unit-bearing field at its engine value and leaves non-decimal flows alone', () => {
    const nodes = [pool('sea', 'water', { initial: 2000, capacity: 5000, unit: 'L' }), pool('perm', 'water')]
    const edges = [res('f', 'sea', 'perm', '500', 'L/h'), res('g', 'sea', 'perm', '25%', 'L')]
    const r = applyUnits(nodes, edges, WATER, HOUR)
    expect(r.nodes[0]!.data).toMatchObject({ initial: 2, capacity: 5, unit: 'L' })
    expect((r.edges[0]!.data as { flow: string }).flow).toBe('0.5')
    expect(r.edges[1]).toBe(edges[1])
  })
  it('Play starts and steps on the engine values', () => {
    const source: LoopNode = { id: 'src', type: 'source', position: XY, data: { kind: 'source', label: 'src', activation: 'automatic', mode: 'pushAny' } as unknown as LoopNode['data'] }
    const nodes = [pool('sea', 'water', { initial: 2000, unit: 'L' }), source]
    const edges = [res('f', 'src', 'sea', '500', 'L')]
    const opts = { kinds: WATER, time: HOUR }
    const s0 = initSim(nodes, opts)
    expect(s0.values.sea).toBe(2)
    const s1 = step(nodes, edges, s0, 1, 4, opts).state
    expect(s1.values.sea).toBe(2.5)
    // the same graph without its units steps on the authored numbers
    const plain = stripFieldUnits(nodes, edges)
    expect(step(plain.nodes, plain.edges, initSim(plain.nodes, opts), 1, 4, opts).state.values.sea).toBe(2500)
  })
})

describe('the graph/4 boundary (§M4-1, D5)', () => {
  const nodes = [pool('sea', 'water', { initial: 2000, unit: 'L' }), pool('perm', 'water')]
  const edges = [res('f', 'sea', 'perm', '1', 'L/min')]
  const time: DocTime = { step: { value: 1, unit: 'h' }, display: 'd' }

  it('writes and reads units, unit lists and the step length on a /graph/4 document', () => {
    const text = serialize(nodes, edges, undefined, undefined, undefined, 4, undefined, undefined, WATER, time)
    const doc = deserialize(text)
    expect(JSON.parse(text).schema).toBe('loop-studio/graph/4')
    expect(doc.modelVersion).toBe(4)
    expect(doc.time).toEqual(time)
    expect(doc.kinds).toEqual(WATER)
    expect((doc.nodes[0]!.data as { unit?: string }).unit).toBe('L')
    expect((doc.edges[0]!.data as { unit?: string }).unit).toBe('L/min')
  })

  it('refuses to write any of them below version 4', () => {
    expect(() => serialize(nodes, edges, undefined, undefined, undefined, 3, undefined, undefined, [{ name: 'water', conserved: true }])).toThrow(/version 4/)
    expect(() => serialize([pool('a')], [], undefined, undefined, undefined, 3, undefined, undefined, undefined, time)).toThrow(/version 4/)
    expect(() => serialize([pool('a')], [], undefined, undefined, undefined, 3, undefined, undefined, WATER)).toThrow(/version 4/)
  })

  it('reads none of them from an earlier schema: the numbers are the base unit', () => {
    const raw = JSON.parse(serialize(nodes, edges, undefined, undefined, undefined, 4, undefined, undefined, WATER, time))
    raw.schema = 'loop-studio/graph/3'
    const doc = deserialize(JSON.stringify(raw))
    expect(doc.modelVersion).toBe(3)
    expect(doc.time).toBeUndefined()
    expect(doc.kinds).toEqual([{ name: 'water', conserved: true, baseUnit: 'm³' }])
    expect('unit' in doc.nodes[0]!.data).toBe(false)
    expect('unit' in (doc.edges[0]!.data as object)).toBe(false)
  })

  it('digests the step length and the field units at version 4, not the display unit', () => {
    const base = canonicalGraphString({ nodes, edges, kinds: WATER, time }, 4)
    expect(base).toContain('"time":{"step":{"unit":"h","value":1}}')
    expect(base).not.toContain('"display"')
    expect(canonicalGraphString({ nodes, edges, kinds: WATER, time: { ...time, display: 'h' } }, 4)).toBe(base)
    expect(canonicalGraphString({ nodes, edges, kinds: WATER, time: { step: { value: 30, unit: 'min' } } }, 4)).not.toBe(base)
    expect(canonicalGraphString({ nodes, edges: [res('f', 'sea', 'perm', '1', 'L/h')], kinds: WATER, time }, 4)).not.toBe(base)
    expect(revisionCanonical({ nodes, edges, kinds: WATER, time }, 4)).toContain('"unit":"L/min"')
  })

  it('leaves an earlier document’s digest untouched (M4-INV-1)', () => {
    const plain = stripFieldUnits(nodes, edges)
    const v3 = [{ name: 'water', conserved: true }]
    expect(canonicalGraphString({ nodes, edges, kinds: v3, time }, 3)).toBe(canonicalGraphString({ ...plain, kinds: v3 }, 3))
    expect(revisionCanonical({ ...plain, kinds: v3 }, 3)).toBe(revisionCanonical({ ...plain, kinds: v3, time }, 3))
  })
})
