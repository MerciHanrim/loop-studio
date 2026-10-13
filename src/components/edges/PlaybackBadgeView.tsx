import { BADGE_DY, BADGE_H, type BadgeSide, badgeWidth, badgeX } from './playbackBadge'

/** issue #330 PR 1 — the `+N` badge: a pill beside its anchor (the token's
 *  centre, or the target end under reduced motion), in flow px, rendered in
 *  the label layer (LoopEdge puts it in an EdgeLabelRenderer). Its box is the
 *  one ./playbackBadge computes for the label test (`badgeX`, `BADGE_DY`,
 *  `badgeWidth`, `BADGE_H`); index.css sizes it to match. */
export function PlaybackBadge({
  edgeId,
  amount,
  at,
  side,
  dimmed,
  kind,
  colour,
  cased,
}: {
  edgeId: string
  /** the `+N` itself (./playbackBadge `badgeText`) */
  amount: string
  at: { x: number; y: number }
  side: BadgeSide
  dimmed: boolean
  kind: 'travel' | 'static'
  /** the connection's flow colour (docs/flow-colour-and-compact-nodes.md
   *  FC-4.3): the border takes it; the amount keeps the primary ink */
  colour?: string
  /** the colour is under 3:1 on this theme's canvas: a thin neutral rim
   *  outside the border (FC-4.3) */
  cased?: boolean
}) {
  return (
    // a sign and digits only: pinned ltr like every engine token (§L9.3)
    <div
      className={`pb-badge${dimmed ? ' pb-badge--dim' : ''}${cased ? ' pb-badge--cased' : ''}`}
      data-badge-for={edgeId}
      data-playback-badge={kind}
      aria-hidden="true"
      dir="ltr"
      style={{
        width: badgeWidth(amount),
        transform: `translate(${at.x + badgeX(amount, side)}px, ${at.y + BADGE_DY - BADGE_H / 2}px)`,
        ...(colour ? { ['--edge-run' as string]: colour } : null),
      }}
    >
      {amount}
    </div>
  )
}
