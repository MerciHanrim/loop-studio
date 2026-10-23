import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode, PortFace } from '../../model/types'
import { bodyBoxOf, hasAuxLine, labelBoxOf, shownRect, usedFacesOf } from './autoFrameShown'

// docs/large-graph-readability-auto-frames.md §AF8 — the shown rect of a
// suggested frame: R0 grown to its members' outside names where that is safe.
// A partial fix: the name is taken as one line at the label's full width.

const N = (id: string, x: number, y: number, kind = 'pool', data: Record<string, unknown> = {}): LoopNode =>
  ({ id, type: kind, position: { x, y }, data: { kind, label: id, ...data } }) as unknown as LoopNode
const E = (id: string, source: string, target: string, kind: 'resource' | 'state' = 'resource'): LoopEdge =>
  ({ id, type: 'loop', source, target, data: { kind } }) as unknown as LoopEdge
const faces = (...f: PortFace[]) => new Set<PortFace>(f)

// one member pool at the origin and the R0 a 150 × 40 footprint + 24 gives it:
// its name below (x −40…96, y 68…85) wants the left side out to −44 and the
// bottom out to 89; the top and right are already past it
const member = N('m', 0, 0)
const R0 = { x: -24, y: -24, w: 198, h: 88 }

describe('labelBoxOf — the CSS placement of .nodef__label--<face>, one line at the full width', () => {
  it('stands on the first free face, below → right → left → top, at the label gap from the symbol', () => {
    const p = N('p', 0, 0)
    expect(labelBoxOf(p, undefined)).toEqual({ x: -40, y: 68, w: 136, h: 17 })
    expect(labelBoxOf(p, faces('bottom'))).toEqual({ x: 68, y: 19.5, w: 136, h: 17 })
    expect(labelBoxOf(p, faces('bottom', 'right'))).toEqual({ x: -148, y: 19.5, w: 136, h: 17 })
    expect(labelBoxOf(p, faces('bottom', 'right', 'left'))).toEqual({ x: -40, y: -29, w: 136, h: 17 })
    // every face busy: below
    expect(labelBoxOf(p, faces('bottom', 'right', 'left', 'top'))).toEqual({ x: -40, y: 68, w: 136, h: 17 })
  })

  it('measures from each symbol’s own face (a gate’s point, a register’s width, a triangle’s flat top)', () => {
    expect(labelBoxOf(N('g', 0, 0, 'gate'), undefined).y).toBe(28 + 31 + 12)
    expect(labelBoxOf(N('r', 0, 0, 'register'), faces('bottom')).x).toBe(28 + 34 + 12)
    expect(labelBoxOf(N('s', 0, 0, 'source'), faces('bottom', 'right', 'left'))).toMatchObject({ y: 28 - 22 - 12 - 17 })
  })

  it('adds the aux line from the data alone: a pool’s capacity, a parameter’s or register’s unit', () => {
    expect(hasAuxLine(N('a', 0, 0, 'pool', { capacity: 10 }))).toBe(true)
    expect(hasAuxLine(N('a', 0, 0, 'pool'))).toBe(false)
    expect(hasAuxLine(N('a', 0, 0, 'parameter', { unit: 'kg' }))).toBe(true)
    expect(hasAuxLine(N('a', 0, 0, 'parameter', { unit: '' }))).toBe(false)
    expect(hasAuxLine(N('a', 0, 0, 'register', { unit: '%' }))).toBe(true)
    expect(hasAuxLine(N('a', 0, 0, 'converter', { unit: 'kg' }))).toBe(false)
    expect(labelBoxOf(N('a', 0, 0, 'pool', { capacity: 10 }), undefined)).toEqual({ x: -40, y: 68, w: 136, h: 17 + 15 })
  })

  it('takes the faces from the connections: a state link leaves below, a resource link on the right', () => {
    const used = usedFacesOf([E('s', 'a', 'b', 'state'), E('r', 'a', 'c')])
    expect([...(used.get('a') ?? [])].sort()).toEqual(['bottom', 'right'])
    expect([...(used.get('b') ?? [])]).toEqual(['top'])
    expect([...(used.get('c') ?? [])]).toEqual(['left'])
  })

  it('the body box holds a symbol wider than the cell', () => {
    expect(bodyBoxOf(N('g', 0, 0, 'gate'))).toEqual({ x: -3, y: -3, w: 62, h: 62 })
    expect(bodyBoxOf(N('r', 0, 0, 'register'))).toEqual({ x: -6, y: 0, w: 68, h: 56 })
  })
})

describe('shownRect — R0 grown to the members’ names, side by side, where safe', () => {
  it('grows the sides the names reach past, on whole px, and never shrinks R0', () => {
    const s = shownRect(R0, ['m'], [member], [], [])
    expect(s).toEqual({ rect: { x: -44, y: -24, w: 218, h: 113 }, held: [] })
  })

  it('is R0 itself when the names already sit inside it', () => {
    const big = { x: -200, y: -200, w: 600, h: 600 }
    expect(shownRect(big, ['m'], [member], [], [])).toEqual({ rect: big, held: [] })
  })

  it('reads no label text: a renamed member (any script, any length) gives the same rect', () => {
    const a = shownRect(R0, ['m'], [member], [], [])
    const b = shownRect(R0, ['m'], [N('m', 0, 0, 'pool', { label: '아주 긴 이름이 두 줄로 넘어가는 저장소 노드' })], [], [])
    expect(b).toEqual(a)
    expect(shownRect(R0, ['m'], [member], [], [])).toEqual(a)
  })

  it('holds a side that would reach a non-member’s body', () => {
    const below = N('x', 0, 80) // body y 80…136: the bottom out to 89 would reach it
    const s = shownRect(R0, ['m'], [member, below], [], [])
    expect(s).toEqual({ rect: { x: -44, y: -24, w: 218, h: 88 }, held: ['bottom'] })
  })

  it('holds a side that would cover MORE of a non-member’s name than R0 already does', () => {
    // its name (below it) spans x −150…−14, y 8…25: R0 already covers x −24…−14
    const beside = N('x', -110, -60)
    expect(labelBoxOf(beside, undefined)).toEqual({ x: -150, y: 8, w: 136, h: 17 })
    // the left is held; the bottom then holds too — alone it would carry the
    // held left border (x −24) down through m's own name (x −40…96)
    const s = shownRect(R0, ['m'], [member, beside], [], [])
    expect(s).toEqual({ rect: R0, held: ['bottom', 'left'] })
  })

  it('never runs a border newly through a member’s own name: the side across a held one holds too', () => {
    // the same, through the bottom: a body below blocks the bottom; the left
    // grows, and its border (x −44, y −24…64) stays above m's name (y 68…85)
    const below = N('x', 0, 80)
    expect(shownRect(R0, ['m'], [member, below], [], []).held).toEqual(['bottom'])
    // and when a member's name already reaches past R0 on one side only, the
    // other side across may not grow past it either
    const beside = N('x', -110, -60)
    const s = shownRect(R0, ['m'], [member, beside], [], [])
    const name = labelBoxOf(member, undefined)
    const leftBorderThroughName = s.rect.x > name.x && s.rect.x < name.x + name.w && s.rect.y + s.rect.h > name.y
    expect(leftBorderThroughName).toBe(false)
  })

  it('holds a side that would newly take a saved manual frame fully inside (a frame drag would carry it)', () => {
    const small = { rect: { x: -42, y: 0, w: 12, h: 10 } } // in the left growth only
    const inR0 = { rect: { x: 0, y: 0, w: 20, h: 20 } } // inside R0 already: no change
    const straddling = { rect: { x: -60, y: 70, w: 100, h: 100 } } // never fully inside
    // the left is held; the bottom with it (its border would cross m's name)
    expect(shownRect(R0, ['m'], [member], [], [small, inR0, straddling])).toEqual({ rect: R0, held: ['bottom', 'left'] })
    expect(shownRect(R0, ['m'], [member], [], [inR0, straddling])).toEqual({ rect: { x: -44, y: -24, w: 218, h: 113 }, held: [] })
  })

  it('checks each combination as a whole: sides safe alone but not together keep the larger safe one', () => {
    // m1's name below and m2's name on its right (a state link takes m2's
    // bottom face) want the bottom and the right; a body in the lower-right
    // corner is past both, so neither side alone reaches it, both together do
    const m1 = N('m1', 0, 0)
    const m2 = N('m2', 0, -100)
    const corner = N('x', 140, 70)
    const edges = [E('s', 'm2', 'x', 'state')]
    const r0 = { x: -60, y: -120, w: 180, h: 180 }
    const nodes = [m1, m2, corner]
    expect(shownRect(r0, ['m1', 'm2'], nodes, edges, [])).toEqual({ rect: { x: -60, y: -120, w: 268, h: 180 }, held: ['bottom'] })
  })

  it('ignores hidden nodes on both sides of the test', () => {
    const hiddenBelow = { ...N('x', 0, 80), hidden: true } as LoopNode
    expect(shownRect(R0, ['m'], [member, hiddenBelow], [], []).held).toEqual([])
  })

  it('lands on whole px when a name is centred on a half px (a side name, 17 px high)', () => {
    const r0 = { x: -24, y: -24, w: 104, h: 104 }
    const a = N('a', 0, 0)
    const s = shownRect(r0, ['a'], [a, N('b', 400, 0)], [E('st', 'a', 'b', 'state')], [])
    for (const v of Object.values(s.rect)) expect(Number.isInteger(v), String(v)).toBe(true)
    // the name stands on the right (below is taken): 68…204 + 4
    expect(s.rect.x + s.rect.w).toBe(208)
  })
})
