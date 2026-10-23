import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// connectTouchHold.ts — which touchmoves a touch that began on a port holds,
// and when the hold goes away. The unit tests run without a DOM, so `window`
// is a plain EventTarget and TouchEvent a minimal stand-in carrying the two
// touch lists the module reads; the browser behaviour itself is covered by
// e2e/touch-connect-next-tap.spec.ts.

type T = { identifier: number }
class FakeTouchEvent extends Event {
  touches: { length: number; [i: number]: T }
  changedTouches: { length: number; [i: number]: T }
  constructor(type: string, init: { touches?: T[]; changedTouches?: T[]; cancelable?: boolean }) {
    super(type, { cancelable: init.cancelable ?? true })
    const list = (a: T[] = []) => Object.assign({ length: a.length }, a)
    this.touches = list(init.touches)
    this.changedTouches = list(init.changedTouches)
  }
}

let win: EventTarget
let mod: typeof import('./connectTouchHold')
beforeEach(async () => {
  win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('TouchEvent', FakeTouchEvent)
  vi.resetModules()
  mod = await import('./connectTouchHold')
})
afterEach(() => {
  mod.releaseConnectTouch()
  vi.unstubAllGlobals()
})

const touch = (type: string, touches: number[], changed: number[], cancelable = true) =>
  new FakeTouchEvent(type, { touches: touches.map((identifier) => ({ identifier })), changedTouches: changed.map((identifier) => ({ identifier })), cancelable })
const move = (touches: number[], cancelable = true) => {
  const e = touch('touchmove', touches, touches, cancelable)
  win.dispatchEvent(e)
  return e.defaultPrevented
}

describe('connectTouchHold', () => {
  it('a mouse or pen start arms nothing', () => {
    mod.holdConnectTouch(new Event('mousedown') as unknown as MouseEvent)
    expect(mod.connectTouchHeld()).toBe(false)
    expect(move([1])).toBe(false)
  })

  it('a touch start holds that touch’s cancelable moves, and only those', () => {
    mod.holdConnectTouch(touch('touchstart', [7], [7]) as unknown as TouchEvent)
    expect(mod.connectTouchHeld()).toBe(true)
    expect(move([7]), 'its own move').toBe(true)
    expect(move([3]), 'another touch alone').toBe(false)
    expect(move([7], false), 'a move the browser will not let be cancelled').toBe(false)
  })

  it('a second finger while it is down: the pinch is held too (the event carries both)', () => {
    mod.holdConnectTouch(touch('touchstart', [7], [7]) as unknown as TouchEvent)
    expect(move([7, 8])).toBe(true)
  })

  it('released when that touch ends or is cancelled — another finger lifting does not release it', () => {
    mod.holdConnectTouch(touch('touchstart', [7], [7]) as unknown as TouchEvent)
    win.dispatchEvent(touch('touchend', [7], [8]))
    expect(mod.connectTouchHeld(), 'the other finger lifted').toBe(true)
    win.dispatchEvent(touch('touchend', [8], [7]))
    expect(mod.connectTouchHeld(), 'its own finger lifted').toBe(false)
    expect(move([8]), 'nothing held after it').toBe(false)

    mod.holdConnectTouch(touch('touchstart', [5], [5]) as unknown as TouchEvent)
    win.dispatchEvent(touch('touchcancel', [], [5]))
    expect(mod.connectTouchHeld()).toBe(false)
  })

  it('a second finger that starts on another port while the first is down keeps the first finger’s hold', () => {
    mod.holdConnectTouch(touch('touchstart', [1], [1]) as unknown as TouchEvent)
    // the second finger's touchstart lists both on the screen, the new one changed
    mod.holdConnectTouch(touch('touchstart', [1, 2], [2]) as unknown as TouchEvent)
    win.dispatchEvent(touch('touchend', [1], [2]))
    expect(mod.connectTouchHeld(), 'the second finger lifted: still held').toBe(true)
    expect(move([1]), 'the first finger’s move alone').toBe(true)
    win.dispatchEvent(touch('touchend', [], [1]))
    expect(mod.connectTouchHeld(), 'the first finger lifted').toBe(false)
  })

  it('a further finger during a hold is told apart from the held touch and from a fresh start', () => {
    expect(mod.isFurtherTouchDuringHold(touch('touchstart', [1], [1]) as unknown as TouchEvent), 'nothing held').toBe(false)
    mod.holdConnectTouch(touch('touchstart', [1], [1]) as unknown as TouchEvent)
    expect(mod.isFurtherTouchDuringHold(touch('touchstart', [1, 2], [2]) as unknown as TouchEvent), 'a second finger').toBe(true)
    expect(mod.isFurtherTouchDuringHold(touch('touchstart', [3], [3]) as unknown as TouchEvent), 'the held touch has left the screen').toBe(false)
    win.dispatchEvent(touch('touchend', [], [1]))
    expect(mod.isFurtherTouchDuringHold(touch('touchstart', [1, 2], [2]) as unknown as TouchEvent), 'released').toBe(false)
  })

  it('a release is idempotent; a new hold replaces one whose touch has left the screen (one set of listeners)', () => {
    mod.holdConnectTouch(touch('touchstart', [1], [1]) as unknown as TouchEvent)
    mod.holdConnectTouch(touch('touchstart', [2], [2]) as unknown as TouchEvent)
    expect(move([1]), 'the replaced touch').toBe(false)
    expect(move([2])).toBe(true)
    mod.releaseConnectTouch()
    mod.releaseConnectTouch()
    expect(mod.connectTouchHeld()).toBe(false)
    expect(move([2])).toBe(false)
  })
})
