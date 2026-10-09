// docs/simulation-playback.md §PB4.5 / PB-Q4 — DOM bounds for the choreography.
// One tunable block; changing these is purely cosmetic — it never touches
// engine data, `toState`, or the committed value shown on the edge label.

/** max per-transfer breakdown chips a *selected* edge shows for one step; the
 *  rest collapse into a single `+N` affordance. The moving dot's own label
 *  always shows the exact summed amount regardless of this cap. */
export const MAX_PLAYBACK_TOKENS = 12

/** issue #330 PR 1 (v0.22.0) — max token-and-badge pairs (the round token and
 *  its `+N` badge, counted together) across ALL edges in one step; it replaced
 *  the 60 travelling-cue budget. Past it, a resource edge that moved keeps its
 *  path highlight and its arrival cue, it just carries no token; it still
 *  commits its value and keeps its label. The bearing edges are chosen
 *  deterministically (ascending edgeId) so the set is stable across re-render /
 *  deselect+reselect / speed change. */
export const MAX_PLAYBACK_TOKENS_TOTAL = 24

/** issue #330 PR 3 (v0.24.0) — the phone's budget (the mobile view/run layout,
 *  docs/mobile.md §MV4): the FIRST 12 of the same stable order, so a phone
 *  pair is always a desktop pair. Past it, as past the 24, a moved edge keeps
 *  its path highlight and its arrival cue. Fixed per step with the transition's
 *  display profile, so a rotation or resize mid-step changes nothing on screen. */
export const MAX_PLAYBACK_TOKENS_PHONE = 12
