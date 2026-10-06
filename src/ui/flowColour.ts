// docs/flow-colour-and-compact-nodes.md FC-3 — the flow-colour palette and the
// advice the colour control gives. A notice never blocks a colour (D-3).

import { ACCENT_STORED } from '../model/model'

/** FC-3.2 — the default palette. Names and hues are the frame accents'; the
 *  values are their own (one stored value has to pass the light AND the dark
 *  surfaces, a frame token is tuned per theme), so the frame tokens are not
 *  touched and are not reused here. Every value gives no notice at all. */
export const FLOW_PALETTE = [
  { id: 'slate', hex: '#638EA5' },
  { id: 'sage', hex: '#74906B' },
  { id: 'gold', hex: '#A78243' },
  { id: 'violet', hex: '#9182A8' },
  { id: 'rose', hex: '#B47599' },
] as const
export type FlowPaletteId = (typeof FLOW_PALETTE)[number]['id']

/** The surfaces a flow colour is drawn on, per theme: `--surface-canvas` and
 *  `--surface-raised` (the node face). Pinned against src/index.css by
 *  flowColour.test.ts. */
export const SURFACES = {
  light: { canvas: '#fdfdfc', node: '#ffffff' },
  dark: { canvas: '#202320', node: '#323632' },
} as const

/** The state colours a flow colour should not be mistaken for (FC-3.3): the
 *  run signal, the focus ring, the warning. Selection is not here — it keeps
 *  its own ring (FC-4.1). Pinned against src/index.css by flowColour.test.ts. */
export const NOTICE_STATE_COLOURS = {
  signal: { light: '#2f746e', dark: '#76b7ae' },
  focus: { light: '#3f6fb6', dark: '#83a9e6' },
  warning: { light: '#a56332', dark: '#d59660' },
} as const

/** WCAG non-text contrast floor */
export const CONTRAST_MIN = 3
/** OKLab distance under which a colour counts as close to a state colour */
export const STATE_DISTANCE_MIN = 0.06

const channels = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabDistance(a: string, b: string): number {
  const p = oklab(a)
  const q = oklab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

export type AccentNotice =
  | { kind: 'contrast'; theme: 'light' | 'dark'; place: 'canvas' | 'node' }
  | { kind: 'state' }

/**
 * FC-3.3 — what to tell the user about `hex` (`#RRGGBB`) where it will be
 * drawn: an edge and a node's L0 dot sit on the canvas; a node's colour band
 * and chip sit on the node face, next to the canvas around the node. So any
 * selection is checked against the canvas, and a selection with a node is
 * checked against the node face too. Light before dark, canvas before node.
 */
export function accentNotices(hex: string, scope: { nodes: boolean; edges: boolean }): AccentNotice[] {
  const out: AccentNotice[] = []
  if (!scope.nodes && !scope.edges) return out
  for (const theme of ['light', 'dark'] as const) {
    if (contrastRatio(hex, SURFACES[theme].canvas) < CONTRAST_MIN) out.push({ kind: 'contrast', theme, place: 'canvas' })
  }
  if (scope.nodes) {
    for (const theme of ['light', 'dark'] as const) {
      if (contrastRatio(hex, SURFACES[theme].node) < CONTRAST_MIN) out.push({ kind: 'contrast', theme, place: 'node' })
    }
  }
  const near = Object.values(NOTICE_STATE_COLOURS).some(
    (c) => oklabDistance(hex, c.light) < STATE_DISTANCE_MIN || oklabDistance(hex, c.dark) < STATE_DISTANCE_MIN,
  )
  if (near) out.push({ kind: 'state' })
  return out
}

/** A DOM-safe id fragment for a STORED colour: its six hex digits in lower
 *  case — never the `#`, never what the user typed. `null` for anything that
 *  is not in the stored form, so no other string can reach an id. */
export const accentIdPart = (stored: string): string | null =>
  ACCENT_STORED.test(stored) ? stored.slice(1).toLowerCase() : null

/** FC-4.2 — the id of the arrow marker of an edge with a flow colour (one per
 *  distinct colour, in `EdgeMarkers.tsx`): built from the stored value's six
 *  digits only; `null` when the value is not in the stored form, so the caller
 *  falls back to the edge-class arrow. */
export const accentMarkerId = (stored: string): string | null => {
  const part = accentIdPart(stored)
  return part === null ? null : `loop-arrow-accent-${part}`
}
