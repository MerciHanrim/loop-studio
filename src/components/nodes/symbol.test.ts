import { describe, expect, it } from 'vitest'
import css from './nodeStructure.css?raw'
import type { NodeKind, PortFace } from '../../model/types'
import { AUX_LINE_H, CELL, CENTRE, LABEL_MAX_W, NAME_LINE_H, SYMBOLS, symbolAnchor, symbolBox, symbolValueFits, VALUE_ROOM, VALUE_SIZE } from './symbol'

// the outside label's type box lives in nodeStructure.css; symbol.ts repeats
// it for a reader of the geometry (frames/autoFrameShown.ts). Fails closed: a
// rule that is missing or no longer states the property fails, not passes.
describe('the outside label constants match nodeStructure.css', () => {
  const rule = (selector: string): string => {
    const m = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)
    if (!m) throw new Error(`no rule ${selector} in nodeStructure.css`)
    return m[1]
  }
  const px = (block: string, prop: string): number => {
    const m = new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([0-9.]+)px\\s*;`).exec(block)
    if (!m) throw new Error(`no ${prop} in px`)
    return Number(m[1])
  }
  it('reads the stylesheet (vite.config.ts lets a `?raw` CSS import keep its text)', () => {
    expect(css.length).toBeGreaterThan(1000)
  })
  it('label and name max-width, name and aux line heights', () => {
    expect(px(rule('.nodef__label'), 'max-width')).toBe(LABEL_MAX_W)
    expect(px(rule('.nodef__name'), 'max-width')).toBe(LABEL_MAX_W)
    expect(px(rule('.nodef__aux'), 'max-width')).toBe(LABEL_MAX_W)
    expect(px(rule('.nodef__name'), 'line-height')).toBe(NAME_LINE_H)
    expect(px(rule('.nodef__aux'), 'line-height')).toBe(AUX_LINE_H)
  })
  it('the label gap is not restated in the stylesheet (the node sets it from LABEL_GAP)', () => {
    expect(css).not.toMatch(/--label-gap:\s*[0-9]/)
  })
})

// The workbench redesign, step 4 — the symbol geometry every port, route and
// box reads (symbol.ts). The anchors are what `routeMap.portPoint` returns and
// what the DOM handles are drawn at, so a change here moves every connection
// end.

const KINDS = Object.keys(SYMBOLS) as NodeKind[]
const FACES: PortFace[] = ['top', 'right', 'bottom', 'left']

describe('symbol geometry', () => {
  it('covers every node kind, centred in the 56 px cell', () => {
    expect(KINDS.sort()).toEqual(['converter', 'drain', 'end', 'gate', 'parameter', 'pool', 'register', 'source'])
    expect(CELL).toBe(56)
    expect(CENTRE).toBe(28)
  })

  it('puts the left and right ports on the old port row, so stored positions keep their lines', () => {
    for (const k of KINDS) {
      expect(symbolAnchor(k, 'left').y, k).toBe(28)
      expect(symbolAnchor(k, 'right').y, k).toBe(28)
    }
  })

  it('puts the top and bottom ports on the centre column', () => {
    for (const k of KINDS) {
      expect(symbolAnchor(k, 'top').x, k).toBe(28)
      expect(symbolAnchor(k, 'bottom').x, k).toBe(28)
    }
  })

  it('anchors each face on the outline: the approved shapes', () => {
    expect(FACES.map((f) => symbolAnchor('pool', f))).toEqual([{ x: 28, y: 0 }, { x: 56, y: 28 }, { x: 28, y: 56 }, { x: 0, y: 28 }])
    expect(FACES.map((f) => symbolAnchor('gate', f))).toEqual([{ x: 28, y: -3 }, { x: 59, y: 28 }, { x: 28, y: 59 }, { x: -3, y: 28 }])
    expect(FACES.map((f) => symbolAnchor('converter', f))).toEqual([{ x: 28, y: 6 }, { x: 58, y: 28 }, { x: 28, y: 50 }, { x: -2, y: 28 }])
    expect(FACES.map((f) => symbolAnchor('parameter', f))).toEqual([{ x: 28, y: 2 }, { x: 54, y: 28 }, { x: 28, y: 54 }, { x: 2, y: 28 }])
    expect(FACES.map((f) => symbolAnchor('register', f))).toEqual([{ x: 28, y: 6 }, { x: 62, y: 28 }, { x: 28, y: 50 }, { x: -6, y: 28 }])
  })

  it('anchors a triangle’s side ports where its slanted sides cross the port row', () => {
    // source: flat top at −22 (half width 28), point at +26 → 28 × 26 / 48
    expect(symbolAnchor('source', 'left')).toEqual({ x: 28 - 15.17, y: 28 })
    expect(symbolAnchor('source', 'right')).toEqual({ x: 28 + 15.17, y: 28 })
    expect(symbolAnchor('source', 'top')).toEqual({ x: 28, y: 6 })
    expect(symbolAnchor('source', 'bottom')).toEqual({ x: 28, y: 54 })
    // drain: the mirror
    expect(symbolAnchor('drain', 'top')).toEqual({ x: 28, y: 2 })
    expect(symbolAnchor('drain', 'bottom')).toEqual({ x: 28, y: 50 })
    expect(symbolAnchor('drain', 'left').x).toBeCloseTo(28 - 15.17, 2)
  })

  it('gives the router the symbol’s own box, which may overflow the cell', () => {
    expect(symbolBox('pool')).toEqual({ x: 0, y: 0, w: 56, h: 56 })
    expect(symbolBox('gate')).toEqual({ x: -3, y: -3, w: 62, h: 62 })
    expect(symbolBox('register')).toEqual({ x: -6, y: 6, w: 68, h: 44 })
    for (const k of KINDS) {
      const b = symbolBox(k)
      for (const f of FACES) {
        const a = symbolAnchor(k, f)
        expect(a.x >= b.x - 1e-9 && a.x <= b.x + b.w + 1e-9 && a.y >= b.y - 1e-9 && a.y <= b.y + b.h + 1e-9, `${k} ${f} inside its box`).toBe(true)
      }
    }
  })
})

describe('the value fit', () => {
  // a stand-in face: every character 0.6 em wide
  const widthOf = (text: string) => (px: number) => text.length * 0.6 * px

  it('measures at the workbench size only: 16 px, 15 in a readout — never a smaller size to make it fit', () => {
    const sizes: number[] = []
    const spy = (text: string) => (px: number) => (sizes.push(px), widthOf(text)(px))
    expect(symbolValueFits('pool', spy('12'))).toBe(true)
    expect(symbolValueFits('register', spy('= 180'))).toBe(true)
    expect(symbolValueFits('pool', spy('123456'))).toBe(false)
    expect(sizes).toEqual([VALUE_SIZE.pool, VALUE_SIZE.register, VALUE_SIZE.pool])
  })

  it('fits against each symbol’s own room', () => {
    // at 16 px a character is 9.6 px here: 4 fit the circle's 44, 5 do not
    expect(symbolValueFits('pool', widthOf('1234'))).toBe(true)
    expect(symbolValueFits('pool', widthOf('12345'))).toBe(false)
    expect(VALUE_ROOM).toEqual({ pool: 44, parameter: 42, register: 58 })
  })
})
