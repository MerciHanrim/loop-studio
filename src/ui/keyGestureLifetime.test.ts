import { describe, expect, it, vi } from 'vitest'
import { createKeyGesture, type GestureEndReason } from './keyGestureLifetime'

// §LGR6.6 / §LGR6.7 — the shared gesture lifetime. The rules here are the ones
// that must never diverge between the frame layer and the canvas.

const mk = () => {
  const ends: GestureEndReason[] = []
  const g = createKeyGesture((r) => ends.push(r))
  return { g, ends }
}

describe('createKeyGesture', () => {
  it('opens on the first key and reports which press opened it', () => {
    const { g } = mk()
    expect(g.active).toBe(false)
    expect(g.press('ArrowRight'), 'the first press opens').toBe(true)
    expect(g.active).toBe(true)
    expect(g.press('ArrowRight'), 'a repeat of the same key does not re-open').toBe(false)
    expect(g.press('ArrowDown'), 'a second key does not re-open either').toBe(false)
    expect(g.heldKeys().sort()).toEqual(['ArrowDown', 'ArrowRight'])
  })

  it('a key repeat is ONE gesture and ends on the single keyup', () => {
    const { g, ends } = mk()
    g.press('ArrowRight')
    for (let i = 0; i < 5; i++) g.press('ArrowRight')
    expect(ends).toEqual([])
    g.release('ArrowRight')
    expect(ends).toEqual(['keyup'])
    expect(g.active).toBe(false)
  })

  it('ends only when the LAST held key is released', () => {
    const { g, ends } = mk()
    g.press('ArrowRight')
    g.press('ArrowLeft')
    g.release('ArrowRight')
    expect(ends, 'one key still held').toEqual([])
    expect(g.active).toBe(true)
    g.release('ArrowLeft')
    expect(ends).toEqual(['keyup'])
  })

  it('pressing again after a release is a NEW gesture', () => {
    const { g, ends } = mk()
    g.press('ArrowRight')
    g.release('ArrowRight')
    expect(g.press('ArrowRight'), 'the second tap opens again').toBe(true)
    g.release('ArrowRight')
    expect(ends).toEqual(['keyup', 'keyup'])
  })

  it.each(['blur', 'visibility', 'pointerdown', 'cancel'] as const)('ends on %s and reports that reason', (reason) => {
    const { g, ends } = mk()
    g.press('ArrowRight')
    g.end(reason)
    expect(ends).toEqual([reason])
    expect(g.active).toBe(false)
    expect(g.heldKeys(), 'held keys are dropped with the gesture').toEqual([])
  })

  it('ignores every late event after it ended', () => {
    const { g, ends } = mk()
    g.press('ArrowRight')
    g.press('ArrowDown')
    g.end('blur')
    expect(ends).toEqual(['blur'])
    g.release('ArrowRight') // the keyups that arrive afterwards
    g.release('ArrowDown')
    g.end('keyup')
    g.end('pointerdown')
    expect(ends, 'nothing else is reported').toEqual(['blur'])
    expect(g.active).toBe(false)
  })

  it('a release with no gesture open does nothing', () => {
    const { g, ends } = mk()
    g.release('ArrowRight')
    expect(ends).toEqual([])
    expect(g.active).toBe(false)
  })

  it('end() on a closed gesture is a no-op', () => {
    const onEnd = vi.fn()
    const g = createKeyGesture(onEnd)
    g.end('cancel')
    expect(onEnd).not.toHaveBeenCalled()
  })
})
