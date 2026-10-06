import { describe, expect, it } from 'vitest'
import {
  accentIdPart,
  accentNotices,
  contrastRatio,
  FLOW_PALETTE,
  NOTICE_STATE_COLOURS,
  oklabDistance,
  SURFACES,
} from './flowColour'

// docs/flow-colour-and-compact-nodes.md FC-3 — the palette and the notices.

// The surfaces and state colours pinned in ./flowColour are checked against
// the computed theme tokens in e2e/flow-colour.spec.ts (Vitest does not load
// CSS), together with the frame tokens the flow palette must not reuse.

describe('FC-3.2 — the palette gives no notice of any kind', () => {
  it.each(FLOW_PALETTE.map((p) => [p.id, p.hex] as const))('%s %s', (_id, hex) => {
    expect(accentNotices(hex, { nodes: true, edges: true })).toEqual([])
    for (const theme of ['light', 'dark'] as const) {
      expect(contrastRatio(hex, SURFACES[theme].canvas)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(hex, SURFACES[theme].node)).toBeGreaterThanOrEqual(3)
    }
  })
  it('five colours, in the frame order, upper-case stored form', () => {
    expect(FLOW_PALETTE.map((p) => p.id)).toEqual(['slate', 'sage', 'gold', 'violet', 'rose'])
    for (const p of FLOW_PALETTE) expect(p.hex).toMatch(/^#[0-9A-F]{6}$/)
  })
})

describe('FC-3.3 — notices by where the colour is drawn', () => {
  it('measured faint colours: yellow and near-white on light, near-black on dark', () => {
    expect(accentNotices('#FFFF00', { nodes: false, edges: true })).toEqual([{ kind: 'contrast', theme: 'light', place: 'canvas' }])
    expect(accentNotices('#EEEEEE', { nodes: true, edges: false })).toEqual([
      { kind: 'contrast', theme: 'light', place: 'canvas' },
      { kind: 'contrast', theme: 'light', place: 'node' },
    ])
    expect(accentNotices('#111111', { nodes: false, edges: true })).toEqual([{ kind: 'contrast', theme: 'dark', place: 'canvas' }])
  })
  it('the node face is checked only when the selection has a node', () => {
    // the frame's light Slate: passes both canvases (4.53 / 3.44) but not the
    // dark node face (2.66), and is 0.069 from the nearest state colour
    const hex = '#527A91'
    expect(accentNotices(hex, { nodes: false, edges: true })).toEqual([])
    expect(accentNotices(hex, { nodes: true, edges: false })).toEqual([{ kind: 'contrast', theme: 'dark', place: 'node' }])
  })
  it('a state colour itself is called close; the selection grey is not on the list', () => {
    expect(accentNotices('#3F6FB6', { nodes: false, edges: true })).toContainEqual({ kind: 'state' })
    expect(accentNotices('#2F746E', { nodes: false, edges: true })).toContainEqual({ kind: 'state' })
    expect(accentNotices('#A56332', { nodes: false, edges: true })).toContainEqual({ kind: 'state' })
    expect(accentNotices('#54524C', { nodes: false, edges: true }).some((n) => n.kind === 'state')).toBe(false)
  })
  it('no selection, no notice', () => {
    expect(accentNotices('#FFFF00', { nodes: false, edges: false })).toEqual([])
  })
  it('the palette is at least 0.078 from every notice state colour', () => {
    const states = Object.values(NOTICE_STATE_COLOURS).flatMap((c) => [c.light, c.dark])
    const min = Math.min(...FLOW_PALETTE.flatMap((p) => states.map((s) => oklabDistance(p.hex, s))))
    expect(min).toBeGreaterThan(0.077)
  })
})

describe('the WCAG contrast and the OKLab distance', () => {
  it('black on white is 21, a colour on itself is 1 and distance 0', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#638EA5', '#638EA5')).toBe(1)
    expect(oklabDistance('#638EA5', '#638EA5')).toBe(0)
  })
})

describe('accentIdPart — a DOM-safe id fragment', () => {
  it('only from the stored form, six lower-case digits, no #', () => {
    expect(accentIdPart('#3A7BD5')).toBe('3a7bd5')
    expect(accentIdPart('#3a7bd5')).toBeNull()
    expect(accentIdPart('3A7BD5')).toBeNull()
    expect(accentIdPart('#3A7BD5"><script>')).toBeNull()
    expect(accentIdPart('url(#x)')).toBeNull()
  })
})
