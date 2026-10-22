// A connection drawn by TOUCH: hold that touch's moves for the drag.
//
// Measured 2026-10-22 under Chromium touch emulation (the final verification,
// scratch/share/final-verification-2026-10-23/touch-first-tap): after a
// connection drawn by touch and lifted while the finger still moved, the next
// tap anywhere made no click — the control under it did nothing, the tap after
// it worked. React Flow's connection drag (`XYHandle.onPointerDown`) listens to
// the document's `touchmove` and never prevents it; preventing that one touch's
// moves for the length of the drag made the next tap a click again there. That
// is the observed workaround, not a claim about the browser's internals or
// about every real device.
//
// Scope, kept narrow on purpose:
//   • armed only by a TOUCH that starts on a port (Canvas's touchstart, capture
//     phase — React Flow only reports the connection once the drag passes its
//     threshold, and by then the first move has gone unprevented, which was
//     measured not to help); a mouse or pen press arms nothing; only that
//     touch is followed (its `identifier`);
//   • only a cancelable `touchmove` that still carries that touch is prevented
//     — a tap, a node move, a pan or a pinch elsewhere is never touched;
//   • a second finger while the connection's finger is down: the event carries
//     both, so the pinch is held too, for as long as that finger is down;
//   • released when that touch ends or is cancelled, when the connection ends,
//     and when the canvas goes away. After its finger lifts nothing is held,
//     whatever React Flow then does with a finger still on the screen.

let held: { id: number; release: () => void } | null = null

/** release the hold, if any (idempotent) */
export function releaseConnectTouch(): void {
  const h = held
  held = null
  h?.release()
}

const carriesId = (list: TouchList, id: number) => {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return true
  return false
}

/** arm for the touch `start` began (a touchstart on a port); a non-touch
 *  event arms nothing. A hold whose touch is still on the screen is kept: a
 *  second finger that lands on another port while the connection's finger is
 *  down neither replaces nor releases it (measured 2026-10-22: it moved the
 *  hold to the new finger, which released it on lifting, and the connection
 *  and the next tap were lost) */
export function holdConnectTouch(start: MouseEvent | TouchEvent): void {
  if (typeof TouchEvent === 'undefined' || !(start instanceof TouchEvent)) {
    releaseConnectTouch()
    return
  }
  if (held && carriesId(start.touches, held.id)) return
  releaseConnectTouch()
  const first = start.changedTouches[0]
  if (!first) return
  const id = first.identifier
  const carries = (list: TouchList) => carriesId(list, id)
  const onMove = (e: TouchEvent) => {
    if (e.cancelable && carries(e.touches)) e.preventDefault()
  }
  const onEnd = (e: TouchEvent) => {
    if (carries(e.changedTouches)) releaseConnectTouch()
  }
  window.addEventListener('touchmove', onMove, { capture: true, passive: false })
  window.addEventListener('touchend', onEnd, { capture: true })
  window.addEventListener('touchcancel', onEnd, { capture: true })
  held = {
    id,
    release: () => {
      window.removeEventListener('touchmove', onMove, { capture: true })
      window.removeEventListener('touchend', onEnd, { capture: true })
      window.removeEventListener('touchcancel', onEnd, { capture: true })
    },
  }
}

/** whether `start` is a FURTHER finger landing while the held touch is still
 *  on the screen — on a port, that press must not start a second connection,
 *  which would take the first finger's away (measured 2026-10-23) */
export function isFurtherTouchDuringHold(start: TouchEvent): boolean {
  return held != null && carriesId(start.touches, held.id) && !carriesId(start.changedTouches, held.id)
}

/** whether a connection touch is being held (tests) */
export const connectTouchHeld = (): boolean => held !== null
