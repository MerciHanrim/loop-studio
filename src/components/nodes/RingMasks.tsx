// docs/flow-colour-and-compact-nodes.md FC-4.1 — the masks that cut each node
// ring out of a wider stroke on the silhouette, at a fixed screen-px distance
// (`NODE_RINGS` in ./silhouette). Every stroke inside is non-scaling, so the
// distance holds on a viewBox stretched by `preserveAspectRatio="none"`.

import type { MaskBox } from './silhouette'

/** shows only what lies MORE than `from` px outside the silhouette `d` */
export function OutsideMask({ id, d, box, from }: { id: string; d: string; box: MaskBox; from: number }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" {...box}>
      <rect {...box} fill="white" />
      <path d={d} fill="black" stroke="black" strokeWidth={2 * from} vectorEffect="non-scaling-stroke" />
    </mask>
  )
}

/** shows only what lies inside the silhouette `d`, MORE than `from` px in */
export function InsideMask({ id, d, box, from }: { id: string; d: string; box: MaskBox; from: number }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" {...box}>
      <path d={d} fill="white" />
      <path d={d} fill="none" stroke="black" strokeWidth={2 * from} vectorEffect="non-scaling-stroke" />
    </mask>
  )
}
