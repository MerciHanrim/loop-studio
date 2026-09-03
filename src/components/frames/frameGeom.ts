import type { LoopNode } from '../../model/types'
import type { FrameRect } from '../../store/frameStore'

// docs/large-graph-readability.md §LGR6 — pure geometry + validation helpers for
// the transient group-frame layer. No store access, no React.

/** screen-space minimum a drawn frame must reach (either dimension smaller ⇒
 *  the drag is treated as an accidental click and produces no frame). */
export const FRAME_MIN_SCREEN_PX = 48

/** normalise a drag (any direction) into a positive-size rect */
export function normaliseRect(a: { x: number; y: number }, b: { x: number; y: number }): FrameRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

/** a node's flow-space bounding box, using React Flow's measured size when it is
 *  available (it always is once the node has rendered) and a small default
 *  otherwise. Position is the node's flow position (top-left). */
export function nodeRect(n: {
  position: { x: number; y: number }
  measured?: { width?: number | null; height?: number | null } | null
  width?: number | null
  height?: number | null
}): FrameRect {
  const w = n.measured?.width ?? n.width ?? 150
  const h = n.measured?.height ?? n.height ?? 40
  return { x: n.position.x, y: n.position.y, w, h }
}

/** is the inner rect fully inside the outer rect? */
export function rectContains(outer: FrameRect, inner: FrameRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/**
 * §LGR6 answer — a drawn rect becomes a frame only when BOTH hold:
 *   - it is at least `FRAME_MIN_SCREEN_PX` in each dimension ON SCREEN
 *     (`flowRect` * `zoom`), and
 *   - at least one node is FULLY contained in it.
 * This is a one-time creation guard; the frame tracks no membership afterwards.
 */
export function frameIsCreatable(
  flowRect: FrameRect,
  zoom: number,
  nodes: readonly LoopNode[],
): boolean {
  if (flowRect.w * zoom < FRAME_MIN_SCREEN_PX || flowRect.h * zoom < FRAME_MIN_SCREEN_PX) {
    return false
  }
  return nodes.some((n) => rectContains(flowRect, nodeRect(n as never)))
}

// ── activity overlay (§LGR6-cues / LGR-D7) ────────────────────────────────
// A per-element "recently effective" score over a trailing window of committed
// steps. Binary per step: an element counts once for a step whether it moved
// one unit or many (the goal is *frequency*, not volume). Linear recency
// weight: the newest of the last N steps weighs 1, the oldest weighs 1/N.

/** how many committed steps the trailing window spans (a Slice-4a tuning value,
 *  §LGR11 — the doc fixes only *what* it shows and that it never persists). */
export const ACTIVITY_WINDOW = 8
/** the tint never exceeds this opacity, however busy an element is. */
export const ACTIVITY_MAX_OPACITY = 0.15

/**
 * `steps` is the ring buffer of the last (≤ `ACTIVITY_WINDOW`) committed steps,
 * OLDEST first, each the set of ids that were `effective` that step (fired
 * nodes + `events` edge ids + `stateEvents` edge ids). Returns id → tint
 * opacity in `[0, ACTIVITY_MAX_OPACITY]`.
 */
export function activityOpacityById(steps: readonly ReadonlySet<string>[]): Map<string, number> {
  const out = new Map<string, number>()
  if (steps.length === 0) return out
  const n = Math.min(steps.length, ACTIVITY_WINDOW)
  const recent = steps.slice(-n)
  // max possible weighted count if an id were active every step in the window
  let denom = 0
  for (let i = 0; i < n; i++) denom += (i + 1) / n
  const acc = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const w = (i + 1) / n // oldest → 1/n, newest → 1
    for (const id of recent[i]) acc.set(id, (acc.get(id) ?? 0) + w)
  }
  for (const [id, sum] of acc) {
    out.set(id, (sum / denom) * ACTIVITY_MAX_OPACITY)
  }
  return out
}
