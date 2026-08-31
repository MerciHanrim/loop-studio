// docs/simulation-playback.md §PB4.5 / PB-Q4 — DOM bounds for the choreography.
// One tunable block; changing these is purely cosmetic — it never touches
// engine data, `toState`, or the committed value shown on the edge label.

/** max per-transfer breakdown chips a *selected* edge shows for one step; the
 *  rest collapse into a single `+N` affordance. The moving dot's own label
 *  always shows the exact summed amount regardless of this cap. */
export const MAX_PLAYBACK_TOKENS = 12

/** max travelling tokens rendered across ALL edges in one step. Past this, a
 *  flowing edge still commits its value and keeps its label, it just does not
 *  animate. The bearing edges are chosen deterministically (ascending edgeId)
 *  so the set is stable across re-render / deselect+reselect / speed change. */
export const MAX_PLAYBACK_TOKENS_TOTAL = 60
