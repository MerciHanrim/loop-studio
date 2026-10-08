import type { CSSProperties } from 'react'
import { useLocaleDirection } from '../i18n'
import { mirrorPathX } from './mirrorPath'

// Issue #298 — the product's own icons, drawn as inline SVG.
//
// MEASURED on 2026-10-01: of the symbols the UI typed as text, the shipped font
// drew three (`©`, `×`, `−`); every other one was drawn by whatever font the
// operating system chose, so the same button differed in weight, size and
// baseline from Windows to iOS, and `🔒`, `▶`, `⏸`, `⏭`, `☀`, `↗` and `✳` are
// emoji-capable characters that iOS draws in colour. An icon drawn here is the
// same shape everywhere, follows `currentColor` (so it also follows forced
// colours), and carries no text: the accessible name is the button's, in words.
//
// One 16 x 16 grid, 1.6 px strokes with round caps, the grammar the canvas
// control buttons already used. The size is `1em` by default, so an icon takes
// the height of the text it replaced and the control it sits in keeps its box.
//
// Four icons follow the reader (docs/localization.md §L9.3): the external-link
// mark, the submenu disclosure, undo and redo. Their RTL drawing is DERIVED from
// the LTR one by `mirrorPathX`, as data, never by a transform; every other icon
// has one drawing for every reader (a menu opens downward for everyone, the
// transport sits with the physical time axis). `ArrowIcon` is the only way to
// render a mirroring icon, and it reads the direction from the one hook the
// arrow layer already uses.

type Shape =
  | { tag: 'path'; d: string; fill?: boolean; strokeWidth?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill?: boolean; strokeWidth?: number }
  | { tag: 'rect'; x: number; y: number; w: number; h: number; rx?: number; fill?: boolean; strokeWidth?: number }

const W = 16
const p = (d: string, o: { fill?: boolean; strokeWidth?: number } = {}): Shape => ({ tag: 'path', d, ...o })
const c = (cx: number, cy: number, r: number, o: { fill?: boolean; strokeWidth?: number } = {}): Shape => ({ tag: 'circle', cx, cy, r, ...o })
const rect = (x: number, y: number, w: number, h: number, rx = 0, o: { fill?: boolean } = {}): Shape => ({ tag: 'rect', x, y, w, h, rx, ...o })

/** icons with ONE drawing for every reader */
export const ICONS = {
  // dialogs, sheets, hints
  close: [p('M4 4L12 12M12 4L4 12')],
  more: [c(3.5, 8, 1.4, { fill: true }), c(8, 8, 1.4, { fill: true }), c(12.5, 8, 1.4, { fill: true })],
  // a menu opens downward for everyone; the timeline sheet toggles up and down
  'chevron-down': [p('M4 6.5L8 10.5L12 6.5')],
  'chevron-up': [p('M4 10L8 6L12 10')],
  check: [p('M3.5 8.5L6.5 11.5L12.5 4.5')],
  plus: [p('M8 3V13M3 8H13')],
  // transport: sits with the physical time axis, never mirrors
  play: [p('M4.5 3V13L12.5 8Z', { fill: true })],
  pause: [p('M5.5 3.5V12.5M10.5 3.5V12.5', { strokeWidth: 2 })],
  step: [p('M3.5 3V13L10 8Z', { fill: true }), p('M12.5 3V13', { strokeWidth: 2 })],
  reset: [p('M12.5 8A4.5 4.5 0 1 1 9.7 3.84M12.5 3.5V7H9')],
  replay: [p('M3.5 8A4.5 4.5 0 1 0 6.3 3.84M3.5 3.5V7H7')],
  // theme
  sun: [c(8, 8, 3), p('M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.4 3.4L4.5 4.5M11.5 11.5L12.6 12.6M3.4 12.6L4.5 11.5M11.5 4.5L12.6 3.4')],
  moon: [p('M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5A5.5 5.5 0 1 0 13.5 9.5Z')],
  auto: [c(8, 8, 5.5), p('M8 2.5A5.5 5.5 0 0 1 8 13.5Z', { fill: true })],
  // canvas
  lock: [rect(3.5, 7.5, 9, 6, 1.2), p('M5.5 7.5V5.5A2.5 2.5 0 0 1 10.5 5.5V7.5')],
  // #335 — swung to the side: the left leg stays in the body, the right end
  // of the shackle lifts clear of it (a 2 px gap at 1×, measured), so open and
  // closed differ by silhouette, never by colour alone
  unlock: [rect(3.5, 7.5, 9, 6, 1.2), p('M5.5 7.5V4.5A2.5 2.5 0 0 1 10.35 3.6')],
  focus: [c(8, 8, 3.5), p('M8 1.5V3.5M8 12.5V14.5M1.5 8H3.5M12.5 8H14.5')],
  trigger: [p('M8 2V14M2 8H14M3.76 3.76L12.24 12.24M12.24 3.76L3.76 12.24', { strokeWidth: 1.5 })],
  // the revision chip
  pencil: [p('M3 13L4 9.5L11 2.5L13.5 5L6.5 12L3 13ZM10 3.5L12.5 6')],
  branch: [p('M2.5 4H5.5L10.5 12H13.5M9.5 4H13.5')],
  // the palette, in the canvas nodes' grammar
  'node-pool': [c(8, 8, 5.5), c(8, 8, 2.2, { fill: true })],
  'node-gate': [p('M8 2.5L13.5 8L8 13.5L2.5 8Z')],
  'node-converter': [p('M3 6H11L8.5 3.5M13 10H5L7.5 12.5')],
  'node-end': [c(8, 8, 5.5), p('M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5')],
  'node-parameter': [rect(2.5, 5, 11, 6, 1)],
} as const satisfies Record<string, readonly Shape[]>

export type IconName = keyof typeof ICONS

/** icons that follow the reader: the LTR drawing; the RTL one is derived */
export const ARROW_ICONS = {
  /** this opens something outside the app */
  'external-link': [p('M9 3H13V7M13 3L7 9M11 9V12.5H3.5V4.5H7')],
  /** a submenu or sheet opens on the inline-end side */
  submenu: [p('M6 4V12L11 8Z', { fill: true })],
  /** step back through the edit history */
  undo: [p('M4.5 6.5H10A3 3 0 0 1 10 12.5H7M7 3.5L4 6.5L7 9.5')],
  /** step forward through the edit history */
  redo: [p('M11.5 6.5H6A3 3 0 0 0 6 12.5H9M9 3.5L12 6.5L9 9.5')],
} as const satisfies Record<string, readonly Shape[]>

export type ArrowIconName = keyof typeof ARROW_ICONS

const mirror = (shapes: readonly Shape[]): Shape[] =>
  shapes.map((s) => {
    if (s.tag === 'path') return { ...s, d: mirrorPathX(s.d, W) }
    if (s.tag === 'circle') return { ...s, cx: W - s.cx }
    return { ...s, x: W - s.x - s.w }
  })

/** derived once, at module load: the two drawings cannot drift apart */
const ARROW_ICONS_RTL: Record<ArrowIconName, Shape[]> = Object.fromEntries(
  (Object.keys(ARROW_ICONS) as ArrowIconName[]).map((k) => [k, mirror(ARROW_ICONS[k])]),
) as Record<ArrowIconName, Shape[]>

function draw(shapes: readonly Shape[]) {
  return shapes.map((s, i) => {
    const paint = s.fill ? { fill: 'currentColor', stroke: 'none' } : { fill: 'none', stroke: 'currentColor', strokeWidth: s.strokeWidth ?? 1.6 }
    if (s.tag === 'path') return <path key={i} d={s.d} {...paint} strokeLinecap="round" strokeLinejoin="round" />
    if (s.tag === 'circle') return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...paint} />
    return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...paint} />
  })
}

type Props = {
  /** CSS size; the default `1em` takes the height of the text the icon replaced */
  size?: number | string
  className?: string
  style?: CSSProperties
}

/** A decorative icon: hidden from assistive technology, the name belongs to the control. */
export function Icon({ name, size = '1em', className, style }: Props & { name: IconName }) {
  return (
    <svg
      className={`icon icon--${name}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${W} ${W}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      style={style}
    >
      {draw(ICONS[name])}
    </svg>
  )
}

/** An icon whose sense is defined by the reading flow: drawn the other way round for an RTL reader. */
export function ArrowIcon({ unit, size = '1em', className, style }: Props & { unit: ArrowIconName }) {
  const dir = useLocaleDirection()
  return (
    <svg
      className={`icon icon--${unit}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${W} ${W}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-icon={unit}
      data-arrow={unit}
      data-dir={dir}
      style={style}
    >
      {draw(dir === 'rtl' ? ARROW_ICONS_RTL[unit] : ARROW_ICONS[unit])}
    </svg>
  )
}
