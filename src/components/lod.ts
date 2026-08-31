import { useStore } from '@xyflow/react'

// docs/visual-language.md §VL7.2 — the canvas has three detail levels switched
// at two fixed world-zoom thresholds. This is the SINGLE source of that
// classification: nodes, edges and the playback choreography all read it here so
// the L2 / L1 / L0 switch is one pure function of zoom with one threshold
// round-trip (§VL12.5). Elision only fades supplementary detail — geometry,
// silhouettes and edge `d` are identical at every level.
export const LOD_L2_MIN = 0.8 // ≥ 0.8  → L2 detail
export const LOD_L1_MIN = 0.45 // ≥ 0.45 → L1 compact ; < 0.45 → L0 map

export type Lod = 'L2' | 'L1' | 'L0'

export const lodFor = (z: number): Lod =>
  z >= LOD_L2_MIN ? 'L2' : z >= LOD_L1_MIN ? 'L1' : 'L0'

/** Subscribe to the current detail level; re-renders only when the level (not
 *  the raw zoom) changes. */
export function useLod(): Lod {
  return useStore((s) => lodFor(s.transform[2]))
}
