// issue #330 PR 3 (v0.24.0), docs/simulation-playback.md §PB6.1 — the three
// speed tiers: what a step draws at the per-step beat the user chose. Exact
// boundaries on the continuous desktop slider (120 … 2400 ms):
//
//   ≥ 400 ms       full       the token travels its path with `+N` beside it
//   200 … 399 ms   fast       the token travels; `+N` shows when it arrives
//   < 200 ms       very fast  the path flashes, then the token appears at the
//                             end and leads into the arrival with `+N`
//
// The tier is read ONCE, when a step starts (the transition carries it); a
// speed change during a step re-rates that step's clock (§PB6.2) but changes its
// tier only from the next step. Step (the button) always draws the full tier,
// whatever the slider says. Reduced motion has its own static form (§PB9) and
// ignores the tier. Presentation only: no engine, RNG or result depends on it.

export type PlaybackTier = 'full' | 'fast' | 'veryFast'

/** the slowest beat that is still `fast`, + 1 ms: from here up it is `full` */
export const TIER_FULL_MIN_MS = 400
/** from here up to `TIER_FULL_MIN_MS` it is `fast`; below it `veryFast` */
export const TIER_FAST_MIN_MS = 200

export const tierOf = (ms: number): PlaybackTier =>
  ms >= TIER_FULL_MIN_MS ? 'full' : ms >= TIER_FAST_MIN_MS ? 'fast' : 'veryFast'

/** issue #330 PR 3 — the display profile a step is drawn with, fixed when it
 *  starts (like the tier): `phone` in the mobile view/run layout (at most 12
 *  token-and-badge pairs, no departure ring), `desktop` otherwise. Reduced
 *  motion keeps its own static form within the 24 on either. */
export type PlaybackProfile = 'desktop' | 'phone'

/** docs/mobile.md §MV4 — the phone's four speeds under `⋯ → Playback speed`;
 *  each falls in exactly one tier */
export const PHONE_SPEEDS = [
  { key: 'slow', ms: 1000 },
  { key: 'normal', ms: 600 },
  { key: 'fast', ms: 300 },
  { key: 'veryFast', ms: 120 },
] as const
