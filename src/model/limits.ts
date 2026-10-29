/** The bounded live-timeline history the sim store keeps, and the maximum
 *  `series` length a Workspace snapshot may carry (SEMANTICS-W.md §W11 / D10). */
export const MAX_SERIES = 400

/** The most dice one flow may roll per draw (`<n>D<d>`, SEMANTICS-B1.md §B1
 *  validation). Each die is one seeded draw on the main thread, so an unbounded
 *  count (`99999999D6`) froze the tab for the whole run (issue #389); above
 *  this the flow is rejected like any other malformed random form — `0` plus
 *  one run diagnostic. 10 000 dice cost about 2 ms per edge per step. */
export const MAX_DICE_COUNT = 10_000
