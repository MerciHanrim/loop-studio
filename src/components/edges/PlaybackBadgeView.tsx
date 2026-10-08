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
}: {
  edgeId: string
  /** the `+N` itself (./playbackBadge `badgeText`) */
  amount: string
  at: { x: number; y: number }
  side: BadgeSide
  dimmed: boolean
  kind: 'travel' | 'static'
}) {
  return (
    // a sign and digits only: pinned ltr like every engine token (§L9.3)
    <div
      className={`pb-badge${dimmed ? ' pb-badge--dim' : ''}`}
      data-badge-for={edgeId}
      data-playback-badge={kind}
      aria-hidden="true"
      dir="ltr"
      style={{
        width: badgeWidth(amount),
        transform: `translate(${at.x + badgeX(amount, side)}px, ${at.y + BADGE_DY - BADGE_H / 2}px)`,
      }}
    >
      {amount}
    </div>
  )
}
