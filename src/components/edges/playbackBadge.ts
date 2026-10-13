// issue #330 PR 1 (v0.22.0), docs/simulation-playback.md §PB4.5 — the `+N`
// badge that rides beside the round token, and the one overlap test that dims
// a connection's OWN label while the token or its badge covers it. Pure
// geometry in flow px; the label box is measured once per text by LoopEdge.

/** the badge's place beside the token: up and to the right of the dot */
export const BADGE_DX = 6
export const BADGE_DY = -11
/** the badge pill's height and side padding, px */
export const BADGE_H = 13
const BADGE_PAD = 4
/** the token's own box: the dot (r 3.6) at its largest (×1.2 on arrive) */
export const TOKEN_R = 4.4

/** one decimal at most, as the token's amount always showed */
const fmtAmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** the badge text: always signed, from `+1` */
export const badgeText = (amount: number): string => `+${fmtAmt(amount)}`

/** the badge's font, as `.pb-badge__n` sets it (index.css) */
const BADGE_FONT_PX = 10
const widths = new Map<string, number>()
let ctx: CanvasRenderingContext2D | null | undefined

/** the badge text's width in px: measured with the badge's own font once per
 *  text (a canvas, never the DOM); an estimate where no canvas exists (tests) */
export function badgeTextWidth(text: string): number {
  const hit = widths.get(text)
  if (hit != null) return hit
  let w = text.length * 6.1
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (ctx) {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'
    ctx.font = `700 ${BADGE_FONT_PX}px ${family}`
    w = ctx.measureText(text).width
  }
  widths.set(text, w)
  return w
}

/** the badge pill's width for a text */
export const badgeWidth = (text: string): number => Math.ceil(badgeTextWidth(text) + 2 * BADGE_PAD)

export type Box = { x0: number; y0: number; x1: number; y1: number }

/** which side of its anchor the badge sits: right of a travelling token (the
 *  approved mockup); left of the target end for the reduced-motion static
 *  badge, so it stays off the target node. Both are above the anchor. */
export type BadgeSide = 'right' | 'left'

/** docs/simulation-playback.md §PB4.8 — the four places of the L2 travelling
 *  badge (./badgePlan chooses one per connection); `up-right` is `right` */
export type BadgePlace = 'up-right' | 'down-right' | 'up-left' | 'down-left'
export const BADGE_PLACES: readonly BadgePlace[] = ['up-right', 'down-right', 'up-left', 'down-left']
const placeOf = (p: BadgeSide | BadgePlace): BadgePlace => (p === 'right' ? 'up-right' : p === 'left' ? 'up-left' : p)

/** the badge's left edge relative to its anchor */
export const badgeX = (text: string, side: BadgeSide | BadgePlace): number =>
  placeOf(side).endsWith('right') ? BADGE_DX : -BADGE_DX - badgeWidth(text)
/** the badge's vertical centre relative to its anchor */
export const badgeDY = (side: BadgeSide | BadgePlace): number => (placeOf(side).startsWith('up') ? BADGE_DY : -BADGE_DY)

/** the box of a badge `w` wide beside an anchor (x, y), in one of the places */
export function badgeBoxAt(x: number, y: number, w: number, place: BadgePlace): Box {
  const x0 = place.endsWith('right') ? x + BADGE_DX : x - BADGE_DX - w
  const cy = y + badgeDY(place)
  return { x0, y0: cy - BADGE_H / 2, x1: x0 + w, y1: cy + BADGE_H / 2 }
}

/** the token and its badge at the token's centre (x, y) */
export function tokenAndBadgeBoxes(x: number, y: number, text: string, side: BadgeSide | BadgePlace = 'right'): [Box, Box] {
  return [
    { x0: x - TOKEN_R, y0: y - TOKEN_R, x1: x + TOKEN_R, y1: y + TOKEN_R },
    badgeBoxAt(x, y, badgeWidth(text), placeOf(side)),
  ]
}

export const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** whether a label box (centred on the label point, `w` × `h`) meets the token
 *  or its badge; `text` null ⇒ a token without its badge (issue #330 PR 3: the
 *  fast tier shows `+N` only on arrival) */
export function labelUnderToken(
  label: { x: number; y: number; w: number; h: number } | null,
  x: number,
  y: number,
  text: string | null,
  side: BadgeSide | BadgePlace = 'right',
): boolean {
  if (!label || label.w <= 0) return false
  const L: Box = { x0: label.x - label.w / 2, y0: label.y - label.h / 2, x1: label.x + label.w / 2, y1: label.y + label.h / 2 }
  const [token, badge] = tokenAndBadgeBoxes(x, y, text ?? '', side)
  return overlaps(L, token) || (text != null && overlaps(L, badge))
}
