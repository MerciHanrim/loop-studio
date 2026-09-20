// docs/large-graph-readability.md §LGR6.6 / §LGR6.7 — the LIFETIME of a
// keyboard gesture, shared by the frame layer (move / resize) and the canvas
// (node move).
//
// Only the lifetime is shared, never the capture / apply / restore: the frame
// layer writes rects itself, while a node move is performed by React Flow and
// the canvas only brackets it with a history transaction. What is shared is the
// part that is easy to get wrong and must NOT diverge between the two owners:
//
//   • a gesture opens on the first held key and closes when the LAST one is
//     released — a key repeat is one gesture, tapping twice is two;
//   • it also closes on a focus loss, a tab switch or a pointer press, so a
//     `keyup` that never arrives (switch tabs mid-repeat) cannot leave a
//     transaction open;
//   • the owner is told WHICH of those ended it, because a cancel must restore
//     while every other reason commits;
//   • once closed, late events are ignored — a stray `keyup` after a blur
//     commit must not start or end anything.

export type GestureEndReason =
  /** the last held key came up — the normal end */
  | 'keyup'
  /** focus left, the tab went away, or a pointer was pressed: a `keyup` may
   *  never arrive, so the owner settles what it has */
  | 'blur'
  | 'visibility'
  | 'pointerdown'
  /** the owner started a gesture on a different target, so this one is done */
  | 'superseded'
  /** Escape — the owner restores instead of committing */
  | 'cancel'

export type KeyGesture = {
  /** true while a gesture is open */
  readonly active: boolean
  /** the keys currently held (a copy) */
  heldKeys: () => string[]
  /** Register a held key, opening the gesture if it was closed.
   *  Returns true when THIS call opened it (the owner captures its origin then). */
  press: (key: string) => boolean
  /** Release a key; the gesture ends with `'keyup'` when the last one goes up. */
  release: (key: string) => void
  /** End now for a reason of the owner's choosing. No-op when already closed. */
  end: (reason: GestureEndReason) => void
}

export function createKeyGesture(onEnd: (reason: GestureEndReason) => void): KeyGesture {
  const held = new Set<string>()
  let active = false
  const close = (reason: GestureEndReason) => {
    if (!active) return
    active = false
    held.clear()
    onEnd(reason)
  }
  return {
    get active() {
      return active
    },
    heldKeys: () => [...held],
    press: (key) => {
      const opened = !active
      active = true
      held.add(key)
      return opened
    },
    release: (key) => {
      if (!active) return // a late keyup after a blur / pointerdown commit
      held.delete(key)
      if (held.size === 0) close('keyup')
    },
    end: (reason) => close(reason),
  }
}
