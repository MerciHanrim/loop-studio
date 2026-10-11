import { describe, expect, it } from 'vitest'
import { HANDLE, STRIP, freeSpans, placeChip, placeHandle, stripRect } from './frameChrome'

// the tight frame of the study (share 20-frame-and-busy-name.md): bodies 56 px
// tall at y 164, the frame 16 px clear of them
const r = { x: 224, y: 148, w: 587, h: 88 }
// boxes measured there (flow px): Waiting room's name above its body, Triage
// desk's below, Treated today's to the right; each node's bridge (the 12 px
// gap) and body
const waitingName = { x: 240, y: 136, w: 95, h: 16 }
const triageName = { x: 448, y: 232, w: 113, h: 16 }
const treatedName = { x: 807, y: 184, w: 90, h: 16 }
const waitingBridge = { x: 240, y: 152, w: 139, h: 12 }
const triageBridge = { x: 448, y: 220, w: 88, h: 12 }
const treatedBridge = { x: 795, y: 164, w: 12, h: 56 }
const waitingBody = { x: 240, y: 164, w: 139, h: 56 }
const triageBody = { x: 448, y: 164, w: 88, h: 56 }
const treatedBody = { x: 656, y: 164, w: 139, h: 56 }
const stripBlockers = [waitingName, triageName, treatedName, waitingBridge, triageBridge, treatedBridge]
const chipBlockers = [...stripBlockers, waitingBody, triageBody, treatedBody]

describe('stripRect', () => {
  it('is the 12 px band centred on each border', () => {
    expect(stripRect(r, 'top')).toEqual({ x: 224, y: 148 - STRIP / 2, w: 587, h: STRIP })
    expect(stripRect(r, 'right')).toEqual({ x: 224 + 587 - STRIP / 2, y: 148, w: STRIP, h: 88 })
  })
})

describe('freeSpans — the select / move strips', () => {
  it("without blockers it is today's strip: the whole border in one span", () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(freeSpans(r, side, [])).toEqual([{ start: 0, len: side === 'top' || side === 'bottom' ? 587 : 88 }])
    }
  })
  it('cuts the top strip around the name and bridge that cross it, and keeps the rest', () => {
    // Waiting room's name (240–335) and bridge (240–379) lie on the top border
    expect(freeSpans(r, 'top', stripBlockers)).toEqual([
      { start: 0, len: 16 },
      { start: 379 - 224, len: 587 - (379 - 224) },
    ])
  })
  it('cuts the bottom strip around the name below Triage desk', () => {
    const spans = freeSpans(r, 'bottom', stripBlockers)
    expect(spans[0]).toEqual({ start: 0, len: 448 - 224 })
    expect(spans[spans.length - 1]).toEqual({ start: 561 - 224, len: 587 - (561 - 224) })
  })
  it('cuts the right strip over the bridge and name that cross it', () => {
    expect(freeSpans(r, 'right', stripBlockers)).toEqual([
      { start: 0, len: 164 - 148 },
      { start: 220 - 148, len: 236 - 220 },
    ])
  })
  it('a blocker inside the frame, away from the border, cuts nothing', () => {
    expect(freeSpans(r, 'top', [{ x: 300, y: 180, w: 50, h: 20 }])).toEqual([{ start: 0, len: 587 }])
  })
})

describe('placeChip — the title chip', () => {
  const chip = { w: 70, h: 17 }
  it('stays home when nothing overlaps it', () => {
    expect(placeChip(r, chip, [triageName, treatedName, triageBody])).toEqual({ x: 0, inside: false, placed: true })
  })
  it('slides right along the top border past the name that overlaps it', () => {
    // the chip at 224–294 × 131–148 overlaps Waiting room's name (240–335 × 136–152)
    expect(placeChip(r, chip, chipBlockers)).toEqual({ x: 335 - 224 + 4, inside: false, placed: true })
  })
  it('keeps sliding past a second blocker that the first move lands on', () => {
    const second = { x: 335 + 4 + 10, y: 130, w: 40, h: 20 }
    expect(placeChip(r, chip, [waitingName, second])).toEqual({ x: second.x + second.w - 224 + 4, inside: false, placed: true })
  })
  it('moves just inside the top border when the outside row has no room', () => {
    // a blocker over the whole outside row (120–148), ending on the border
    const wall = { x: 224, y: 120, w: 587, h: 28 }
    expect(placeChip(r, chip, [wall])).toEqual({ x: 0, inside: true, placed: true })
  })
  it('a BODY under the inside row is not a free place either (Lumi): it slides past it', () => {
    const wall = { x: 224, y: 120, w: 587, h: 28 }
    const bodyAtCorner = { x: 224, y: 148, w: 100, h: 56 }
    expect(placeChip(r, chip, [wall, bodyAtCorner])).toEqual({ x: 100 + 4, inside: true, placed: true })
  })
  it('reports the collision when neither row has room: home, placed = false (never hidden)', () => {
    const wallOut = { x: 224, y: 120, w: 587, h: 28 }
    const wallIn = { x: 224, y: 148, w: 587, h: 30 }
    expect(placeChip(r, chip, [wallOut, wallIn])).toEqual({ x: 0, inside: false, placed: false })
  })
})

describe('placeHandle — the resize handle', () => {
  it('stays home (centred on the bottom-right corner) when nothing overlaps it', () => {
    expect(placeHandle(r, chipBlockers)).toEqual({ dx: 0, dy: 0, placed: true })
  })
  it('slides left along the bottom border past a name across the corner', () => {
    // the corner frame of the small graph: right edge 540 runs through Triage desk's name (448–561 × 232–248)
    const c = { x: 224, y: 148, w: 316, h: 88 }
    const home = { x: 540 - HANDLE / 2, y: 236 - HANDLE / 2 }
    const got = placeHandle(c, [triageName, triageBridge, triageBody, waitingName, waitingBridge, waitingBody])
    expect(got).toEqual({ dx: 448 - HANDLE - 4 - home.x, dy: 0, placed: true })
    // the moved handle lies clear of every blocker and still on the bottom border
    const box = { x: home.x + got.dx, y: home.y, w: HANDLE, h: HANDLE }
    expect(box.x).toBeGreaterThanOrEqual(c.x)
    expect(box.x + box.w).toBeLessThan(triageName.x)
  })
  it('goes up the right border when the bottom border has no room', () => {
    const c = { x: 224, y: 148, w: 316, h: 88 }
    const bottomWall = { x: 200, y: 226, w: 360, h: 30 }
    const got = placeHandle(c, [bottomWall])
    expect(got.placed).toBe(true)
    expect(got.dx).toBe(0)
    expect(got.dy).toBeLessThan(0)
    expect(236 - HANDLE / 2 + got.dy + HANDLE).toBeLessThanOrEqual(bottomWall.y)
  })
  it('reports the collision when neither border has room', () => {
    const c = { x: 224, y: 148, w: 316, h: 88 }
    const all = { x: 200, y: 120, w: 400, h: 140 }
    expect(placeHandle(c, [all])).toEqual({ dx: 0, dy: 0, placed: false })
  })
})
