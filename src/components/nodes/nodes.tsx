import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Handle,
  Position,
  useConnection,
  useStore,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import {
  BASE_NODE_H,
  clampNodeHeight,
  isFixedDepth,
  maskBox,
  NODE_RINGS,
  POOL_PULSE_INSET,
  portInsetFraction,
  silhouettePath,
  VESSEL_INSET_Y,
  VESSEL_MIN_PAD_Y,
} from './silhouette'
import { type Extent, fitOutline, type OutlineFit, type OutlineGeometry, type OutlineRow } from './outlineFit'
import { formatRegisterValue, readAccent, readParameterData, readRegisterData } from '../../model/model'
import { PORT_ROW } from '../../model/layout/grid'
import { useGraphStore } from '../../store/graphStore'
import { useRegisterOutcome } from '../../store/registers'
import { useSimStore } from '../../store/simStore'
import { useUiStore } from '../../store/uiStore'
import { type MessageKey, useLocaleDirection, useT } from '../../i18n'
import type { ContentDir } from '../../i18n/contentDirection'
import { useI18n } from '../../i18n/store'
import { usePhrasedTitle } from './phraseTitle'
import { InsideMask, OutsideMask } from './RingMasks'
import { fitRows, type MeasuredRow, type RowFit, rowFitMeasured } from './rowFit'
import { type Box, convMarkSpot, type Spot } from './convMark'
import { useConversionMark, usePoolPulseKey } from './nodeCues'
import type {
  ConverterData,
  DrainData,
  FlowColour,
  GateData,
  NodeKind,
  PoolData,
  SourceData,
} from '../../model/types'
import { useLod } from '../lod'
import { useNodeActivityOpacity } from '../frames/useActivityTint'
import { faceOf, nameFaceFor } from '../../model/ports'
import type { PortFace } from '../../model/types'
import { PORT_COL } from '../../model/layout/grid'
import { setNodeNameBox } from '../../store/routeMap'
import { reservedWidth } from './nodeWidth'
import { roleSymbol, type SymbolPrim } from './roleSymbol'
import './nodeStructure.css'

/** node structure — the inner role symbol (./roleSymbol) as React elements */
function RoleSymbol({ prims, label }: { prims: SymbolPrim[]; label?: string }) {
  return (
    <svg className="nodef__role" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {label ? <title>{label}</title> : null}
      {prims.map((q, i) => {
        const a = q.attrs
        if (q.tag === 'circle') return <circle key={i} cx={a.cx} cy={a.cy} r={a.r} fill={a.fill} stroke={a.stroke} />
        if (q.tag === 'rect') return <rect key={i} x={a.x} y={a.y} width={a.width} height={a.height} rx={a.rx} fill={a.fill} stroke={a.stroke} />
        return <path key={i} d={a.d} fill={a.fill} stroke={a.stroke} />
      })}
    </svg>
  )
}

// ── Node structure, first implementation ──────────────────────────────────
// scratch/share/connection-editing-2/17-implementation-rules.md. While
// `uiStore.nodeStructure === 'outside'` the frame draws the NEW node: a small
// body (role silhouette + the key value) at the compact height, its width from
// the display format (W1, ./nodeWidth), the NAME outside the body from level 1,
// the body + name + the gap between them one hit region (the name and a
// transparent bridge are children of the node element, so pointing, clicking
// and dragging any of them is pointing at the node), and one DOM handle per
// face per port (the document handle ids are unchanged; a non-default face is
// `<id>@<face>`, ../../model/ports). The name's face is a CANDIDATE rule
// (§4.3): the first port-free face in the order below, right, left, top,
// derived from the node's connections, so it changes only when a connection
// is added or removed, never during a drag (`nameFaceFor`, ../../model/ports).

// ── N1 "Vessel" silhouettes ──────────────────────────────────────────────
// The outer shape carries the node's role. Type colour is used only on a small
// chip, never to fill the silhouette. Selection and firing are separate cues.
// The viewBox is `0 0 120 h` — `h` is the measured body height, floored at
// `BASE_NODE_H` (56, the compact floor of docs/flow-colour-and-compact-nodes.md
// FC-7) and grown by the content. `./silhouette` regenerates each of the paths
// for `h`, keeping stroke / radius / notch fixed (docs/mmo-multilingual-layout.md
// §MML1b); at h = 64 it returns the historic path verbatim.

// docs/visual-language.md §VL7.2 — three detail levels at fixed world-zoom
// thresholds; the classifier lives in ../lod so nodes, edges and playback all
// share it. Elision only fades supplementary TEXT; the silhouette, rings,
// invalid flag, run cues, footprint and hit target are identical at every
// level (§VL7.1 / §VL12.5).

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

// ── issue #332 — the value / detail rows' fit ─────────────────────────────
// Register (result, `= expr`) and Parameter (value, unit): ./rowFit. Issue
// #337 — the Pool (value, capacity) moved to the outline fit below with the
// other width-parametric kinds; #332's rules for its rows are kept there.
const ROW_FIT_KINDS: ReadonlySet<NodeKind> = new Set(['parameter', 'register'])

/** `el`'s offset from `frame`, in untransformed CSS px (a value's bump
 *  animation scales it, which a `getBoundingClientRect` would read) */
function offsetIn(el: HTMLElement, frame: HTMLElement): { left: number; top: number } {
  let left = 0
  let top = 0
  for (let e: HTMLElement | null = el; e && e !== frame; e = e.offsetParent as HTMLElement | null) {
    left += e.offsetLeft
    top += e.offsetTop
  }
  return { left, top }
}

/** a wrapped title's width on one line, from its own font (canvas
 *  `measureText`): never by laying the title out unwrapped, which would write
 *  to the DOM and force a layout of the whole canvas per node — a 2,400-node
 *  import measured 98 s that way */
let measureCtx: CanvasRenderingContext2D | null | undefined
function oneLineWidth(title: HTMLElement, cs: CSSStyleDeclaration): number | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return null
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  return measureCtx.measureText(title.textContent ?? '').width
}

/** the whole laid-out width of `el`'s text, even where its ellipsis cuts it
 *  short: the text's own rect, divided by `scale` (screen px per CSS px) */
function textWidth(el: HTMLElement, scale: number): number {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range.getBoundingClientRect().width / scale
}

/** One measurement pass: the stack's and the title's place, and each row's
 *  extent, all in CSS px within the box, unrounded and untransformed; then
 *  ./rowFit decides. Rects are scaled back by the frame's own (the canvas
 *  zoom); the value row's by its own too, as its bump animation scales it.
 *  Three style reads per node (frame, title, value): a 2,400-node import
 *  pays for every one. */
function measureRowFit(frame: HTMLElement, stack: HTMLElement, kind: NodeKind, h: number): RowFit {
  const width = parseFloat(getComputedStyle(frame).width) || frame.offsetWidth
  const box = frame.getBoundingClientRect()
  const scale = box.width / width || 1
  // `h` is the box height this fit is for, which the box may not be drawn at
  // yet (the first render's is the floor): the body centres the stack
  // vertically, so the rows will sit half the difference lower
  const dy = (h - frame.offsetHeight) / 2
  const stackStart = offsetIn(stack, frame).left
  const stackWidth = stack.getBoundingClientRect().width / scale
  const title = frame.querySelector<HTMLElement>('.nodef__title')
  const cs = title ? getComputedStyle(title) : null
  // the title's start unrounded: the Parameter / Register head's rim is a
  // fraction of a px that `offsetLeft` would round away
  const tBox = title?.getBoundingClientRect()
  const titleLeft = tBox ? (tBox.left - box.left) / scale : stackStart + 14
  const titleTop = (title ? offsetIn(title, frame).top : 0) + dy
  const lh = cs ? parseFloat(cs.lineHeight) || 1.2 * parseFloat(cs.fontSize) : 0
  const titleWrapped = title && cs ? title.offsetHeight > 1.5 * lh : false
  const titleBoxWidth = tBox ? tBox.width / scale : 0
  const rows: MeasuredRow[] = []
  for (const key of ['value', 'sub'] as const) {
    const el = frame.querySelector<HTMLElement>(`.nodef__${key}`)
    if (!el) continue
    const at = offsetIn(el, frame)
    // the value's bump scales it: its own rect over its used width
    const own = key === 'value' ? el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).width) || el.offsetWidth) : scale
    rows.push({ key, top: at.top + dy, bottom: at.top + dy + el.offsetHeight, width: textWidth(el, own || scale) })
  }
  return fitRows(
    kind,
    {
      height: h,
      width,
      stackStart,
      padEnd: width - stackStart - stackWidth,
      titleStart: titleLeft,
      titleWidth: title && cs ? (titleWrapped ? (oneLineWidth(title, cs) ?? titleBoxWidth) : titleBoxWidth) : 0,
      titleTop,
      titleBottom: titleTop + (title?.offsetHeight ?? 0),
      titleWrapped,
      titleMax: cs ? parseFloat(cs.maxWidth) || Infinity : Infinity,
    },
    rows,
  )
}

/** issue #330 PR 2 — the Converter's conversion-mark spot (./convMark): its
 *  title, mode text and chip boxes in CSS px within the box (rects scaled
 *  back by the canvas zoom), then the geometry decides. One pass per change,
 *  like the row fit; the mark is absolutely placed, so it moves nothing. */
function measureConvSpot(frame: HTMLElement, width: number, h: number): Spot | null {
  const box = frame.getBoundingClientRect()
  const scale = box.width / width || 1
  // `h` may not be drawn yet: the body centres the stack vertically
  const dy = (h - frame.offsetHeight) / 2
  const rel = (r: DOMRect): Box => ({
    left: (r.left - box.left) / scale,
    top: (r.top - box.top) / scale + dy,
    right: (r.right - box.left) / scale,
    bottom: (r.bottom - box.top) / scale + dy,
  })
  const glyphs = (el: Element | null): Box[] => {
    if (!el) return []
    const range = document.createRange()
    range.selectNodeContents(el)
    return [...range.getClientRects()].filter((r) => r.width > 0.5).map(rel)
  }
  const mode = glyphs(frame.querySelector('.nodef__sub'))
  const chip = frame.querySelector('.nodef__chip')
  const text = [...glyphs(frame.querySelector('.nodef__title')), ...mode, ...(chip ? [rel(chip.getBoundingClientRect())] : [])]
  const modeBox: Box | null = mode.length
    ? {
        left: Math.min(...mode.map((b) => b.left)),
        top: Math.min(...mode.map((b) => b.top)),
        right: Math.max(...mode.map((b) => b.right)),
        bottom: Math.max(...mode.map((b) => b.bottom)),
      }
    : null
  return convMarkSpot(width, h, text, modeBox)
}

/** issue #337 — one measurement pass for a width-parametric kind: the head (the
 *  chip and each title line) and the rows, in CSS px within the box at their
 *  place BEFORE the fit moves them (the head's own shift, a `margin-left`, is
 *  taken back out), each line's top / bottom its line box; then ./outlineFit
 *  decides. Like `measureRowFit`, nothing is written to the DOM. */
function measureOutlineFit(frame: HTMLElement, stack: HTMLElement, kind: NodeKind, h: number): OutlineFit {
  return fitOutline(measureOutlineGeometry(frame, stack, kind, h))
}

function measureOutlineGeometry(frame: HTMLElement, stack: HTMLElement, kind: NodeKind, h: number): OutlineGeometry {
  const width = parseFloat(getComputedStyle(frame).width) || frame.offsetWidth
  const box = frame.getBoundingClientRect()
  const scale = box.width / width || 1
  const dy = (h - frame.offsetHeight) / 2
  const stackStart = offsetIn(stack, frame).left
  const headEl = frame.querySelector<HTMLElement>('.nodef__head')
  const shiftNow = headEl ? parseFloat(getComputedStyle(headEl).marginLeft) || 0 : 0
  const at = (q: DOMRect | { left: number; right: number; top: number; bottom: number }): Extent => ({
    left: (q.left - box.left) / scale - shiftNow,
    right: (q.right - box.left) / scale - shiftNow,
    top: (q.top - box.top) / scale + dy,
    bottom: (q.bottom - box.top) / scale + dy,
  })
  const chipEl = frame.querySelector<HTMLElement>('.nodef__chip')
  const title = frame.querySelector<HTMLElement>('.nodef__title')
  const cs = title ? getComputedStyle(title) : null
  const lh = cs ? parseFloat(cs.lineHeight) || 1.2 * parseFloat(cs.fontSize) : 0
  const tBox = title ? at(title.getBoundingClientRect()) : null
  // each title line's glyphs; its top / bottom the line's BOX (the title's own
  // top plus the line's index × the line height), not the font's taller content
  const titleLines: Extent[] = []
  if (title && tBox) {
    const range = document.createRange()
    range.selectNodeContents(title)
    // (a line a line clamp hides lies below the title's own box: left out)
    const rects = [...range.getClientRects()].filter((q) => q.width > 0.5).map(at).filter((q) => (q.top + q.bottom) / 2 < tBox.bottom).sort((a, b) => a.top - b.top || a.left - b.left)
    for (const q of rects) {
      const line = Math.max(0, Math.round(((q.top + q.bottom) / 2 - tBox.top - lh / 2) / lh))
      const top = tBox.top + line * lh
      const L = titleLines.find((m) => Math.abs(m.top - top) < 0.5)
      if (L) { L.left = Math.min(L.left, q.left); L.right = Math.max(L.right, q.right) } else titleLines.push({ left: q.left, right: q.right, top, bottom: top + lh })
    }
  }
  const titleWrapped = title && cs ? title.offsetHeight > 1.5 * lh : false
  const rows: OutlineRow[] = []
  for (const key of ['value', 'sub'] as const) {
    const el = frame.querySelector<HTMLElement>(`.nodef__${key}`)
    if (!el) continue
    const o = offsetIn(el, frame)
    const own = key === 'value' ? el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).width) || el.offsetWidth) : scale
    const w = textWidth(el, own || scale)
    // the Gate centres its rows: their measured centre, with the whole text width
    const centre = o.left + el.offsetWidth / 2
    rows.push({ key, top: o.top + dy, bottom: o.top + dy + el.offsetHeight, width: w, left: centre - w / 2 })
  }
  return {
    kind,
    height: h,
    width,
    stackStart,
    // the body's own end padding: the Gate's stack shrinks to its content
    padEnd: stack.parentElement ? parseFloat(getComputedStyle(stack.parentElement).paddingRight) || 0 : 0,
    minWidth: parseFloat(getComputedStyle(frame).minWidth) || 118,
    chip: chipEl ? at(chipEl.getBoundingClientRect()) : null,
    titleLines,
    titleBoxStart: tBox ? tBox.left : stackStart + 14,
    // a wrapped title's one-line width from its own font (never by laying it
    // out unwrapped); an unwrapped one's is its box
    titleOneLine: title && cs && tBox ? (titleWrapped ? (oneLineWidth(title, cs) ?? tBox.right - tBox.left) : tBox.right - tBox.left) : 0,
    titleMax: cs ? parseFloat(cs.maxWidth) || Infinity : Infinity,
    rows,
  }
}

/** a count of the web-font loads that have finished: a face that arrives after
 *  the first measurement changes a row's text width without resizing a stack
 *  the fit already holds, so each load re-reads the fit once */
let fontLoads = 0
const fontLoadListeners = new Set<() => void>()
const onFontLoad = () => {
  fontLoads++
  for (const on of fontLoadListeners) on()
}
const subscribeFontLoads = (on: () => void): (() => void) => {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts) return () => {}
  if (fontLoadListeners.size === 0) fonts.addEventListener('loadingdone', onFontLoad)
  fontLoadListeners.add(on)
  return () => {
    fontLoadListeners.delete(on)
    if (fontLoadListeners.size === 0) fonts.removeEventListener('loadingdone', onFontLoad)
  }
}
const useFontLoads = (): number => useSyncExternalStore(subscribeFontLoads, () => fontLoads, () => 0)

/** the box height the stack's rendered content asks for (see NodeFrame) */
const boxHeightOf = (kind: NodeKind, stack: HTMLElement): number =>
  clampNodeHeight(kind, stack.offsetHeight + VESSEL_INSET_Y[kind] + 2 * VESSEL_MIN_PAD_Y)

type AnyFit = RowFit | OutlineFit

const sameFit = (a: AnyFit | null, b: AnyFit): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b)

/** the row fit as the frame's CSS custom properties (index.css reads them); an
 *  outline fit (#337) also sets the node's width and the head's shift */
function fitStyle(fit: AnyFit | null): Record<string, string | number> | null {
  if (!fit) return null
  const s: Record<string, string | number> = {}
  for (const key of ['value', 'sub'] as const) {
    if (fit.start[key] != null) s[`--vra-${key}-start`] = `${fit.start[key]}px`
    if (fit.maxWidth[key] != null) s[`--vra-${key}-max`] = `${fit.maxWidth[key]}px`
  }
  if ('headShift' in fit) {
    s.width = fit.width
    if (fit.headShift) s['--of-head-shift'] = `${fit.headShift}px`
  } else if (fit.minWidth != null) s.minWidth = fit.minWidth
  return s
}

function useFiring(id: string): boolean {
  return useSimStore((s) => s.firedNodeIds.includes(id))
}

// docs/large-graph-readability.md §LGR5 — the lighter run weight: a node the
// engine *evaluated* as an execution target this step but that did **not** act
// (`activated \ fired`). Node-only in v1, flow-execution nodes only (Parameter /
// Register are never in `activated`). Always on when a committed `StepReport`
// exists; cleared on the next commit / Reset with the rest of the run cues.
function useEvaluated(id: string): boolean {
  return useSimStore(
    (s) => s.activatedNodeIds.includes(id) && !s.firedNodeIds.includes(id),
  )
}

/** 'up' | 'down' for ~320ms after `value` changes */
function useValueDir(value: number): 'up' | 'down' | null {
  const prev = useRef(value)
  const [dir, setDir] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (value === prev.current) return
    setDir(value > prev.current ? 'up' : 'down')
    prev.current = value
    const t = window.setTimeout(() => setDir(null), 320)
    return () => window.clearTimeout(t)
  }, [value])
  return dir
}

/** docs/localization.md §L9.3 — a direction the CALLER decides.
 *
 *  NodeFrame renders whatever it is handed, and its callers hand it two
 *  different kinds of value: eight pass the user's own node label, one passes a
 *  catalog sentence. Those want different directions, and the element cannot
 *  tell them apart — so the direction travels with the value.
 *
 *  No default. A default would be a guess made on behalf of a caller who never
 *  considered the question, which is exactly how the canvas ends up pinning a
 *  user's Arabic label to ltr. */
type CallerDir = ContentDir

/** `sub` and `subDir` are a pair: neither, or both. A subtitle with no declared
 *  direction is a type error rather than a runtime fallback. */
type SubProps = { sub?: undefined; subDir?: undefined } | { sub: string | undefined; subDir: CallerDir }

type FrameProps = {
  nodeId: string
  kind: NodeKind
  title: string
  titleDir: CallerDir
  value?: string
  valueDir?: 'up' | 'down' | null
  /** loop-model/2 §M2 — an advisory display unit shown right after `value`
   *  (space + unit, e.g. `464 $/day`). Absent ⇒ the value renders exactly as
   *  before. Never engine- / digest-affecting. */
  unit?: string
  selected?: boolean
  /** docs/flow-colour-and-compact-nodes.md FC-4.1 — the node's flow colour as
   *  stored (`data.accent`); re-read here, so only `#RRGGBB` is ever drawn. */
  accent?: string
  firing?: boolean
  /** §LGR5 — `evaluated`: activated this step but did not fire. A small static
   *  bottom-left corner bracket, lower weight than `firing`'s outline pulse;
   *  ignored while `firing` is true. */
  evaluated?: boolean
  /** §LGR6-cues — the opt-in Activity overlay's per-node tint: a faint
   *  primary-fill copy of the silhouette at this opacity (0…~0.15). 0 / absent
   *  ⇒ nothing renders. Never covers the run cues / rings (drawn after it). */
  activity?: number
  /** issue #330 PR 2 — the Pool arrival pulse's step key (./nodeCues), or
   *  null / absent for none */
  pulseKey?: number | null
  /** issue #330 PR 2 — the Converter's conversion mark, `<step>:live` /
   *  `<step>:done` (./nodeCues), or null / absent for none */
  conversion?: string | null
  /** §VL3 — the model layer's `invalid` state (a Register the engine can't
   *  evaluate, or an unreadable model node). A `--warning` dashed outline + a
   *  top-right `!` flag; carries no value (the caller passes `—`). */
  invalid?: boolean
  stepKey: number
  /** issue #344 §DL1 — the resource ports this kind has (`in` left, `out`
   *  right); drawn here, where the box height is known, on the fixed port row */
  ports?: { in?: boolean; out?: boolean }
  /** node structure — the body width W1 reserves for this node (./nodeWidth),
   *  used only while the new structure is drawn */
  widthReserve?: number
  /** node structure — the inner role symbol (./roleSymbol): null = none */
  role?: SymbolPrim[] | null
  /** node structure — the catalog key of the word the symbol stands for (a
   *  Source / Drain activation, a Gate distribution): read into the accessible
   *  name and the symbol's tooltip, so the meaning does not rest on the symbol
   *  alone (Lumi, 2026-10-12) */
  roleKey?: MessageKey
} & SubProps

function NodeFrame({
  nodeId,
  kind,
  title,
  titleDir,
  value,
  valueDir,
  unit,
  sub,
  subDir,
  selected,
  accent: accentProp,
  firing,
  evaluated,
  activity,
  pulseKey,
  conversion,
  invalid,
  stepKey,
  ports,
  widthReserve,
  role,
  roleKey,
}: FrameProps) {
  const tip = useT()
  const lod = useLod()
  const mapOnly = lod === 'L0' // no text at all — silhouette + type dot
  // node structure — the new node, while the view switch is on
  const outside = useUiStore((s) => s.nodeStructure === 'outside')
  // the faces this node's connections use (stored face or the kind's default),
  // as a sorted key so the node re-renders only when the set changes — never
  // while it is dragged (positions are not part of it)
  const usedFacesKey = useStore((s) => {
    if (!outside) return ''
    const used = new Set<PortFace>()
    for (const e of s.edges) {
      if (e.source === nodeId) used.add(faceOf(e as never, 'source'))
      if (e.target === nodeId) used.add(faceOf(e as never, 'target'))
    }
    return [...used].sort().join(',')
  })
  const nameFace: PortFace = nameFaceFor(new Set(usedFacesKey.split(',').filter(Boolean) as PortFace[]))
  const nameRef = useRef<HTMLSpanElement>(null)
  // §MML1 — render-time phrase segmentation for JA / ZH titles (display only)
  const locale = useI18n((s) => s.activeLocale)
  const { node: titleNode, phrased } = usePhrasedTitle(title, locale)
  // per-direction: is a state edge already wired to this node's in / out port?
  const stateInWired = useStore((s) =>
    s.edges.some((e) => e.target === nodeId && e.targetHandle === 'state-target'),
  )
  const stateOutWired = useStore((s) =>
    s.edges.some((e) => e.source === nodeId && e.sourceHandle === 'state-source'),
  )
  // reveal every node's state target while a state connection is being dragged
  const draggingState = useConnection(
    (c) =>
      c.inProgress &&
      (c.fromHandle?.id === 'state-source' || c.fromHandle?.id === 'state-target'),
  )
  // node structure — any connection being dragged: the face handles of every
  // node surface so the drop can choose a face
  const connecting = useConnection((c) => c.inProgress)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const isSelected = useGraphStore((s) => s.selectedNodeId === nodeId)
  // docs/register-expression-authoring.md §RXA3.4 — a transient "peek" halo while
  // a Register expression reference is hovered / focused in the Inspector.
  // Boolean selector ⇒ only the peeked nodes re-render. Purely visual
  // (RXA-INV-3): no selection / Focus / undo / digest effect.
  // §RXA8 — while an arm-and-click insert is armed, every referenceable node
  // (Pool / Parameter / Register, except the one being edited) gets the same
  // faint "pick me" affordance.
  const refPeek = useUiStore(
    (s) =>
      s.peekRefNodeIds.includes(nodeId) ||
      (s.refInsert != null &&
        s.refInsert.editingId !== nodeId &&
        (kind === 'pool' || kind === 'parameter' || kind === 'register')),
  )
  const frameRef = useRef<HTMLDivElement>(null)

  // docs/mmo-multilingual-layout.md §MML1b + docs/node-shell-content-in-vessel.md —
  // the box height is driven by the RENDERED content, so the stack always sits
  // inside the DRAWN vessel (not the bounding box): the vessel path insets
  // its own top/bottom caps (`VESSEL_INSET_Y`) and a `parameter` / `register`
  // capsule is 24px shorter than its box, so a title + value + `= expr`
  // stack spilled past the outline at both ends. Measure `.nodef__stack`'s real
  // height, add the vessel inset + a min clear gap top and bottom, clamp to the
  // kind's silhouette range, and redraw the vessel + handles at that height.
  // `clampNodeHeight` floors at `BASE_NODE_H` (56), so a short node (Source /
  // Drain / Gate / Converter / End) sits at the floor and a one-line Pool at the
  // 58 its title and value need. The ResizeObserver settles
  // in one pass: the SVG is `position: absolute`, so a viewBox change never
  // feeds back into the box height.
  const stackRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(BASE_NODE_H)
  // issue #332 — the rows' fit (./rowFit): where the value and detail rows
  // start and how wide the node must be so no row crosses the vessel. Taken
  // after the height is known, only when the content, the language, the fonts
  // or the height change (below) — never per animation frame.
  // issue #337 — for a width-parametric kind, the outline fit (./outlineFit):
  // also the head's place and the node's width, which the outline is drawn for
  const fixedDepth = isFixedDepth(kind)
  // a content change that keeps the stack's size (a new number of the same
  // length, a shorter sub inside a title-wide node) still moves a row's glyph
  // extent, so any change of the rendered strings is re-read once, after
  // React commits it: one read per change, never per animation frame
  const fonts = useFontLoads()
  const fitKey = JSON.stringify([value, unit, sub, title, locale, fonts])
  // the fit and the strings, language and fonts it was read for
  const [fitState, setFitState] = useState<{ fit: AnyFit; key: string } | null>(null)
  // #337 — a node is read the way a fresh one is: when its strings, language
  // or fonts change it renders once without its fit (before the paint, so
  // nothing shows it) and the fit is read from that natural layout. Read under
  // the old width, a longer single word is squeezed rather than wrapped and its
  // one-line width comes out short (the same Template opened again in German),
  // and a Register kept the previous language's minimum width, so its title
  // wrapped, and its height came out, unlike a fresh open's.
  const fit = fitState && fitState.key === fitKey ? fitState.fit : null
  // the inputs of the last fit: a fit is read once per change of the rendered
  // strings, the language, the fonts or the box height, and never again for
  // the same ones (the re-render a fit itself causes reads nothing)
  const fitInput = useRef('')
  useLayoutEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    const read = () => {
      const next = boxHeightOf(kind, stack)
      setBoxH((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(stack)
    return () => ro.disconnect()
  }, [kind])
  // node structure — the outside name's box, relative to the node, for the
  // router (an obstacle like a node); read once per layout of the name, never
  // per frame; cleared when the name leaves (unmount or the switch going back)
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!outside || !el) {
      setNodeNameBox(nodeId, null)
      return
    }
    const read = () => setNodeNameBox(nodeId, { dx: el.offsetLeft, dy: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setNodeNameBox(nodeId, null)
    }
  }, [outside, nodeId, nameFace, title, locale])
  useLayoutEffect(() => {
    const frame = frameRef.current
    const stack = stackRef.current
    if (outside || !frame || !stack || !(fixedDepth || ROW_FIT_KINDS.has(kind))) return
    // the height the content asks for, read in the same pass as the box's
    // own (so the fit and the height land in ONE re-render of the node: a
    // second one, for 2,400 nodes, cost about 0.7 s)
    const h = boxHeightOf(kind, stack)
    const input = `${fitKey}|${h}`
    if (input === fitInput.current) return
    fitInput.current = input
    rowFitMeasured()
    const next: AnyFit = fixedDepth ? measureOutlineFit(frame, stack, kind, h) : measureRowFit(frame, stack, kind, h)
    setFitState((prev) => (prev && prev.key === fitKey && sameFit(prev.fit, next) ? prev : { fit: next, key: fitKey }))
  }, [fitKey, boxH, kind, fixedDepth, outside])
  // issue #330 PR 2 — a Converter's conversion-mark spot, read once per change
  // of the rendered strings, the language, the fonts or the box size (never per
  // frame, never while a step plays); the same at L1, where the mode row is
  // hidden but keeps its place; #337 — read only once the outline fit is in
  // place (the render without it is a measuring pass, never painted), and once
  // more whenever the fit moves the text or sets the width (the input carries
  // both, so an unchanged fit reads nothing)
  const [convSpot, setConvSpot] = useState<Spot | null>(null)
  const convInput = useRef('')
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || kind !== 'converter') return
    // node structure — the Converter's body holds no text and no inner symbol
    // (Lumi's set A: Converter / End show their silhouette alone), so the mark
    // takes the body's centre; nothing to measure (the name is outside)
    if (outside) {
      const width = parseFloat(getComputedStyle(frame).width) || frame.offsetWidth
      const next = { x: width / 2 - 6, y: boxH / 2 - 6 }
      setConvSpot((prev) => (prev?.x === next.x && prev?.y === next.y ? prev : next))
      return
    }
    if (fixedDepth && !fit) return
    const width = parseFloat(getComputedStyle(frame).width) || frame.offsetWidth
    const input = `${fitKey}|${boxH}|${width}|${fit ? JSON.stringify(fit) : ''}`
    if (input === convInput.current) return
    convInput.current = input
    const next = measureConvSpot(frame, width, boxH)
    setConvSpot((prev) => (prev?.x === next?.x && prev?.y === next?.y ? prev : next))
  }, [fitKey, boxH, kind, fit, fixedDepth, outside])
  const convPhase = conversion ? conversion.slice(conversion.indexOf(':') + 1) : null
  const convStep = conversion ? conversion.slice(0, conversion.indexOf(':')) : null
  // at L0 the mark takes the type dot's place; elsewhere it needs its spot
  const convOn = convPhase != null && (mapOnly || convSpot != null)
  // No explicit `updateNodeInternals` call here: React Flow's own internal
  // per-node ResizeObserver already keeps `node.measured` (and the handle
  // bounds edge routing reads) in sync with this wrapper's real DOM size,
  // in dev and production alike. Regression coverage:
  // e2e/template-label-overlay.spec.ts (dev) and e2e/dist.spec.ts (prod) —
  // re-run both if a React Flow upgrade touches node measurement.
  // node structure — the new body stays at the compact height (its stack is
  // the value row only) and takes W1's width; today's fits are not read for it
  const grown = !outside && boxH > BASE_NODE_H
  const bodyH = outside ? BASE_NODE_H : boxH
  const bodyW = outside ? (widthReserve ?? reservedWidth({ type: kind, data: {} as never })) : null

  // keyboard focus lands on React Flow's node wrapper, an ancestor of this div
  useEffect(() => {
    const rfNode = frameRef.current?.closest('.react-flow__node')
    if (!rfNode) return
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    rfNode.addEventListener('focusin', on)
    rfNode.addEventListener('focusout', off)
    return () => {
      rfNode.removeEventListener('focusin', on)
      rfNode.removeEventListener('focusout', off)
    }
  }, [])

  // #337 — a width-parametric outline is drawn for the node's width (the fit
  // sets it, before the first paint); the others in their 120-wide viewBox
  const pathW = outside ? (fixedDepth ? bodyW! : 120) : fixedDepth && fit && 'headShift' in fit ? fit.width : 120
  const path = silhouettePath(kind, bodyH, pathW)
  // FC-4.1 — only a stored-form colour is drawn; the ids are this component's
  // own (never built from the node id or the colour)
  const accent = readAccent(accentProp)
  const uid = 'nf' + useId().replace(/[^A-Za-z0-9_-]/g, '_')
  const box = maskBox(bodyH, pathW)
  // state ports are invisible at rest; they surface on hover / selection /
  // keyboard focus / while a state wire is being dragged. A port that already
  // carries a state edge stays faintly visible so the wiring reads.
  const revealed = hovered || focused || isSelected || selected === true || draggingState
  const opIn = revealed ? 1 : stateInWired ? 0.5 : 0
  const opOut = revealed ? 1 : stateOutWired ? 0.5 : 0
  // node structure (Lumi, 2026-10-12): pointing at a node is for READING it —
  // the body and name identify, nothing else appears; the face handles show
  // only when they are needed, i.e. while a connection is being dragged or
  // while the node is selected / keyboard-focused for editing
  const facesOn = connecting || isSelected || selected === true || focused
  // §VL3 stacking — every state is its own layer, so a Register that is
  // selected AND keyboard-focused AND invalid shows all three cues at once:
  // the outer --warning invalid ring, the solid selection ring, the inset
  // dashed focus ring, and the corner `!` flag. The accessible name carries
  // `invalid` too (not colour / shape alone).
  // the accessible name is localized like every other label: the kind word
  // from the canvas catalog, the state words from `node.aria.*` — never the
  // raw kind token or an English literal
  // node structure — the word the inner symbol stands for joins the name
  // ("Gate Triage desk, deterministic"), under the new structure only
  const roleWord = outside && roleKey ? tip(roleKey) : null
  const aria =
    `${tip(`canvas.nodeKind.${kind}` as MessageKey)} ${title}` +
    (roleWord ? `, ${roleWord}` : '') +
    (invalid ? `, ${tip('node.aria.invalid')}` : '') +
    (selected ? `, ${tip('node.aria.selected')}` : '') +
    (focused ? `, ${tip('node.aria.focused')}` : '')
  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={aria}
      className={
        `nodef nodef--${kind} lod-${lod}` +
        (selected ? ' is-selected' : '') +
        (focused ? ' is-focused' : '') +
        (invalid ? ' is-invalid' : '') +
        (refPeek ? ' is-ref-peek' : '') +
        (accent ? ' has-accent' : '') +
        // node structure — the new body; pointed at = thicker outline + the name
        // underlined (a form, not a colour; the model's candidate, §2 cues)
        (outside ? ` nodef--outside nodef--name-${nameFace}${hovered ? ' is-hover' : ''}` : '')
      }
      data-invalid={invalid ? '' : undefined}
      data-accent={accent}
      data-conv-spot={convSpot ? `${convSpot.x},${convSpot.y}` : undefined}
      data-name-face={outside ? nameFace : undefined}
      style={
        outside
          ? { width: bodyW!, height: BASE_NODE_H, ...(accent ? { ['--node-accent' as string]: accent } : null) }
          : grown || accent || fit
          ? {
              ...(grown ? { height: boxH } : null),
              ...(accent ? { ['--node-accent' as string]: accent } : null),
              ...fitStyle(fit),
            }
          : undefined
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* state ports (diamonds) — top in, bottom out; hidden until needed */}
      <Handle
        type="target"
        position={Position.Top}
        id="state-target"
        className="h h--state"
        style={{ opacity: opIn }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="state-source"
        className="h h--state"
        style={{ opacity: opOut }}
      />
      {/* node structure — the state ports on the other faces, and the resource
          ports on the faces they do not take by default: one DOM handle per
          face per port, revealed with the state ports; the document ids stay
          (../../model/ports `rfHandleId`) */}
      {outside ? (
        <>
          <Handle type="target" position={Position.Left} id="state-target@left" className="h h--state h--extra" style={{ top: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="target" position={Position.Right} id="state-target@right" className="h h--state h--extra" style={{ top: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="target" position={Position.Bottom} id="state-target@bottom" className="h h--state h--extra" style={{ left: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="source" position={Position.Top} id="state-source@top" className="h h--state h--extra" style={{ left: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="source" position={Position.Left} id="state-source@left" className="h h--state h--extra" style={{ top: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="source" position={Position.Right} id="state-source@right" className="h h--state h--extra" style={{ top: '50%', opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
        </>
      ) : null}
      <svg
        className="nodef__shape"
        viewBox={`0 0 ${pathW} ${bodyH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="nodef__fill" d={path} />
        {/* docs/visual-language.md §VL0 follow-up — the node-type hue wash: a
            faint (see --node-hue-opacity) ambient fill, always weaker than the
            Activity tint drawn right after it. Shape + `.nodef__chip` remain
            the primary type tell; this is a secondary assist only. */}
        <path className="nodef__hue" d={path} />
        {/* §RXA3.4 — the Inspector expression-reference peek halo. A wide soft
            stroke UNDER the crisp outline + every run / selection cue; a
            transient preview only (RXA-INV-3). */}
        {refPeek ? <path className="nodef__peek" d={path} /> : null}
        {/* §LGR6-cues — the opt-in Activity overlay tint: a faint primary-fill
            copy of the silhouette, above the fill but UNDER the stroke and
            every run / selection / focus cue below. Shape-accurate (never a
            rectangle overflowing an auto-width node wrapper). */}
        {activity ? (
          <path className="nodef__activity" d={path} style={{ opacity: activity }} />
        ) : null}
        {/* FC-4.1 — the masks that cut each ring out of a wider stroke at a
            fixed px distance from the silhouette (NODE_RINGS), and the clip
            that keeps the flow-colour band inside it */}
        {accent || selected || invalid || focused || pulseKey != null ? (
          <defs>
            {accent ? (
              <clipPath id={`${uid}-in`}>
                <path d={path} />
              </clipPath>
            ) : null}
            {selected ? <OutsideMask id={`${uid}-sel`} d={path} box={box} from={NODE_RINGS.selection.from} /> : null}
            {invalid ? <OutsideMask id={`${uid}-inv`} d={path} box={box} from={NODE_RINGS.invalid.from} /> : null}
            {focused ? <InsideMask id={`${uid}-foc`} d={path} box={box} from={NODE_RINGS.focus.from} /> : null}
            {pulseKey != null ? <InsideMask id={`${uid}-pul`} d={path} box={box} from={POOL_PULSE_INSET} /> : null}
          </defs>
        ) : null}
        {/* FC-4.1 — the flow-colour band: just inside the structure line,
            never over it, so a colour with no contrast never erases the node's
            edge */}
        {accent ? (
          <path
            className="nodef__band"
            d={path}
            clipPath={`url(#${uid}-in)`}
            strokeWidth={2 * NODE_RINGS.band}
          />
        ) : null}
        <path className="nodef__stroke" d={path} />
        {kind === 'end' ? (
          <line className="nodef__endbar" x1="95" y1="15" x2="95" y2={boxH - 15} />
        ) : null}
        {/* §VL3 / FC-4.1 — invalid: a --warning dashed ring, the OUTERMOST one;
            the dash pattern and the corner flag are the non-colour tell */}
        {invalid ? (
          <path
            className="nodef__invalid"
            d={path}
            mask={`url(#${uid}-inv)`}
            strokeWidth={2 * NODE_RINGS.invalid.to}
          />
        ) : null}
        {/* §VL3 / FC-4.1 — selection: a solid ring OUTSIDE the structure line
            ("2 px ring, offset 2 px"), never a recolour of the line itself */}
        {selected ? (
          <path
            className="nodef__sel"
            d={path}
            mask={`url(#${uid}-sel)`}
            strokeWidth={2 * NODE_RINGS.selection.to}
          />
        ) : null}
        {/* §VL3 / FC-4.1 — keyboard focus: a DASHED ring, the innermost one;
            dashed-vs-solid is the non-colour tell */}
        {focused ? (
          <path
            className="nodef__focus"
            d={path}
            mask={`url(#${uid}-foc)`}
            strokeWidth={2 * NODE_RINGS.focus.to}
          />
        ) : null}
        {/* node structure — the fired mark of the new node is the TICKS ring
            (Lumi's decision on the V2.6 captures, 2026-10-12): short marks in
            the 9–11 px band outside the invalid ring, an 8 on / 24 off repeat
            along the outline, the signal colour, static for the cue's lifetime
            (so reduced motion and motion draw the same frame); the outermost
            band, so it never meets the selection or invalid rings, and with the
            12 px name gap it never meets the name. Today's node keeps its
            scaled wave. */}
        {firing && outside ? (
          <>
            <defs>
              <OutsideMask id={`${uid}-fired`} d={path} box={box} from={9} />
            </defs>
            {/* `data-run-cue` — the §LGR5.1 `effective` cue, whichever form draws it */}
            <path key={`t${stepKey}`} className="nodef__fired-ticks" data-run-cue="effective" d={path} mask={`url(#${uid}-fired)`} strokeWidth={2 * 11} strokeDasharray="8 24" />
          </>
        ) : firing ? (
          <path key={`w${stepKey}`} className="nodef__wave" data-run-cue="effective" d={path} />
        ) : null}
        {/* issue #330 PR 2 — the Pool arrival pulse: a soft tint of the
            silhouette from `POOL_PULSE_INSET` px inside (clear of every ring),
            under the text, from the first token's arrival; its forced-colours
            form is the 2 px line (index.css). Keyed on its step, so the settle
            does not restart it. */}
        {pulseKey != null ? (
          <g key={`p${pulseKey}`} className="nodef__pulse" data-pulse-step={pulseKey}>
            <path className="nodef__pulse-tint" d={path} mask={`url(#${uid}-pul)`} />
            <path
              className="nodef__pulse-line"
              d={path}
              mask={`url(#${uid}-pul)`}
              strokeWidth={2 * (POOL_PULSE_INSET + 2)}
            />
          </g>
        ) : null}
        {/* L0 map: type colour collapses to one dot inside the silhouette; a
            conversion mark takes its place while it shows. #337 — in a
            width-parametric viewBox the dot is stretched by the same `w / 120`
            the 120-wide viewBox applies, so it draws exactly as on every other
            kind */}
        {mapOnly && !convOn ? (
          <g transform={pathW === 120 ? undefined : `scale(${pathW / 120} 1)`}>
            <circle className="nodef__cdot" cx="60" cy={boxH / 2} r="9" />
          </g>
        ) : null}
      </svg>

      {/* §VL4 — one persistent flag, top-right, non-colour tell for `invalid` */}
      {invalid ? (
        <span className="nodef__flag" aria-hidden="true" title={tip('node.invalidFlag')}>
          !
        </span>
      ) : null}

      {/* §LGR5 — `evaluated`: activated this step but did not act. A small
          BOTTOM-LEFT corner bracket (a rounded L: border-left + border-bottom
          only) — deliberately NOT a closed ring and NOT a circle, so it reads
          as neither a connection handle / type dot (circles), nor the
          selection / focus / invalid rings (full perimeter), nor the top-right
          `!` flag. Lower weight than the `firing` outline pulse; static in
          every motion mode; a `forced-colors` rule keeps the two strokes.
          Ignored while `firing`; not lod-gated — a run cue stays at every zoom
          (§VL7.1) and is exempt from `lgr-deemph` dimming (LGR-INV-6). */}
      {evaluated && !firing ? (
        <span className="nodef__eval" data-run-cue="evaluated" aria-hidden="true" title={tip('node.evaluatedCue')} />
      ) : null}

      {/* issue #330 PR 2 — the conversion mark (option A): a 10 px ⇄ drawing
          at this Converter's own spot (./convMark), from its onset to the
          settle, then it fades; at L0 it takes the type dot's place. Outside
          the body, so the L0 / L1 text elision never hides it, and not dimmed
          by Focus mode (a cue inside a node, §LGR2.3). Keyed on its step. */}
      {convOn ? (
        <svg
          key={`c${convStep}`}
          className={`nodef__conv nodef__conv--${convPhase}${mapOnly ? ' nodef__conv--map' : ''}`}
          data-conv-mark={convPhase}
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={mapOnly || !convSpot ? { top: boxH / 2 - 9 } : { left: convSpot.x, top: convSpot.y }}
        >
          <path d="M1.5 3.5 H10 M7.5 1 L10 3.5 L7.5 6 M10.5 8.5 H2 M4.5 6 L2 8.5 L4.5 11" />
        </svg>
      ) : null}

      {/* The body is ALWAYS in the DOM so the node's footprint / hit target is
          byte-identical across L2 / L1 / L0 (§VL7.1). The `lod-*` class fades
          the elided text: L1 hides `sub`, L0 hides the whole body — the
          silhouette + `cdot` carry the map view. */}
      <div className="nodef__body">
        <div className="nodef__stack" ref={stackRef}>
        {/* node structure — the body holds the role and the key value; the
            title moves outside (below), the detail line to the detail level */}
        {outside ? null : (
          <span className="nodef__head">
            <span className="nodef__chip" />
            <span
              className={phrased ? 'nodef__title nodef__title--phrased' : 'nodef__title'}
              dir={titleDir}
            >
              {titleNode}
            </span>
          </span>
        )}
        {value != null ? (
          <span
            className={`nodef__value${valueDir ? ` nodef__value--${valueDir}` : ''}`}
            dir="ltr"
            // §4.1 overflow — the format and precision never change for space; a
            // value wider than the reservation is elided (the CSS ellipsis is the
            // mark) and the whole text is on the pointer tooltip here and, for
            // keyboard and touch, in the Inspector of the selected node
            title={outside ? `${value}${unit ? ` ${unit}` : ''}` : undefined}
          >
            {value}
            {unit ? <span className="nodef__unit" dir="auto">{' '}{unit}</span> : null}
          </span>
        ) : outside && role ? (
          <RoleSymbol prims={role} label={roleWord ?? undefined} />
        ) : null}
        {sub && !outside ? (
          <span className="nodef__sub" dir={subDir}>
            {sub}
          </span>
        ) : null}
        </div>
      </div>

      {/* node structure — the name OUTSIDE the body on its face, and the
          transparent bridge over the gap: both children of the node element,
          so pointing at either is pointing at the node (§2 rule 3) */}
      {outside ? (
        <>
          <span className={`nodef__bridge nodef__bridge--${nameFace}`} aria-hidden="true" />
          <span
            ref={nameRef}
            className={`nodef__name nodef__name--${nameFace}${phrased ? ' nodef__name--phrased' : ''}`}
            dir={titleDir}
          >
            {titleNode}
          </span>
        </>
      ) : null}

      {/* issue #344 §DL1 — resource ports on the fixed row PORT_ROW px below
          the top, drawn ON the outline there (a fraction of the width: the
          outline stretches with the width only), whatever the height. Last in
          the frame, so they paint — and take the pointer — above the
          silhouette and the text they sit on. */}
      {ports?.in ? (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="h h--in"
          style={{ top: PORT_ROW, left: `${portInsetFraction(kind, bodyH, 'in', PORT_ROW, pathW) * 100}%` }}
        />
      ) : null}
      {ports?.out ? (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="h h--out"
          style={{ top: PORT_ROW, right: `${portInsetFraction(kind, bodyH, 'out', PORT_ROW, pathW) * 100}%` }}
        />
      ) : null}
      {/* node structure — the resource ports on the faces they do not take by
          default: top / bottom on the fixed lane `PORT_COL` from the near corner,
          the opposite side on the port row; revealed with the state ports. The
          anchors match `routeMap.portPoint`. */}
      {outside && ports?.in ? (
        <>
          <Handle type="target" position={Position.Top} id="in@top" className="h h--in h--extra" style={{ left: PORT_COL, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="target" position={Position.Bottom} id="in@bottom" className="h h--in h--extra" style={{ left: PORT_COL, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="target" position={Position.Right} id="in@right" className="h h--in h--extra" style={{ top: PORT_ROW, right: `${portInsetFraction(kind, bodyH, 'out', PORT_ROW, pathW) * 100}%`, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
        </>
      ) : null}
      {outside && ports?.out ? (
        <>
          <Handle type="source" position={Position.Top} id="out@top" className="h h--out h--extra" style={{ left: `calc(100% - ${PORT_COL}px)`, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="source" position={Position.Bottom} id="out@bottom" className="h h--out h--extra" style={{ left: `calc(100% - ${PORT_COL}px)`, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
          <Handle type="source" position={Position.Left} id="out@left" className="h h--out h--extra" style={{ top: PORT_ROW, left: `${portInsetFraction(kind, bodyH, 'in', PORT_ROW, pathW) * 100}%`, opacity: facesOn ? 1 : 0 }} data-off={facesOn ? undefined : ''} />
        </>
      ) : null}
    </div>
  )
}

/** node structure — the view switch, for the node components */
const useOutside = (): boolean => useUiStore((s) => s.nodeStructure === 'outside')

function PoolNode({ id, data, selected }: NodeProps) {
  const d = data as PoolData
  const live = useSimStore((s) => (s.values ? s.values[id] : undefined))
  const shown = live ?? d.initial
  const stepKey = useSimStore((s) => s.stepIndex)
  const pulseKey = usePoolPulseKey(id)
  const outside = useOutside()
  // Pool's face is its count; mode / capacity stay in the inspector. Node
  // structure — the new body shows `count / capacity` in one row (the study's
  // form); the width is reserved for the capacity and six digits (W1)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="pool"
        ports={{ in: true, out: true }}
        title={d.label}
        titleDir="auto"
        value={outside && d.capacity != null ? `${fmt(shown)} / ${d.capacity}` : fmt(shown)}
        valueDir={useValueDir(shown)}
        sub={d.capacity != null ? `≤ ${d.capacity}` : undefined}
        subDir="ltr"
        widthReserve={outside ? reservedWidth({ type: 'pool', data }) : undefined}
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        pulseKey={pulseKey}
        stepKey={stepKey}
      />
    </>
  )
}

function SourceNode({ id, data, selected }: NodeProps) {
  const d = data as SourceData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="source"
        ports={{ out: true }}
        widthReserve={reservedWidth({ type: 'source', data })}
        role={roleSymbol('source', d)}
        roleKey={`enum.activation.${d.activation}` as MessageKey}
        title={d.label}
        titleDir="auto"
        sub={`${d.activation} · ${d.mode}`}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

function DrainNode({ id, data, selected }: NodeProps) {
  const d = data as DrainData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="drain"
        ports={{ in: true }}
        widthReserve={reservedWidth({ type: 'drain', data })}
        role={roleSymbol('drain', d)}
        roleKey={`enum.activation.${d.activation}` as MessageKey}
        title={d.label}
        titleDir="auto"
        sub={`${d.activation} · ${d.mode}`}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

function GateNode({ id, data, selected }: NodeProps) {
  const d = data as GateData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="gate"
        ports={{ in: true, out: true }}
        widthReserve={reservedWidth({ type: 'gate', data })}
        role={roleSymbol('gate', d)}
        roleKey={`enum.distribution.${d.distribution}` as MessageKey}
        title={d.label}
        titleDir="auto"
        sub={d.distribution}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

function ConverterNode({ id, data, selected }: NodeProps) {
  const d = data as ConverterData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="converter"
        ports={{ in: true, out: true }}
        widthReserve={reservedWidth({ type: 'converter', data })}
        title={d.label}
        titleDir="auto"
        sub={d.mode}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        conversion={useConversionMark(id)}
        stepKey={stepKey}
      />
    </>
  )
}

function EndNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string }
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <NodeFrame
        nodeId={id}
        kind="end"
        ports={{ in: true }}
        widthReserve={reservedWidth({ type: 'end', data })}
        title={d.label}
        titleDir="auto"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
    </>
  )
}

// ── loop-model/1 annotation nodes — no ports, never fire ─────────────────

/** Shown when a `parameter` / `register` node's `data` cannot be read
 *  (`SEMANTICS-R2.md §R2-1.1`). Never displays a stand-in value — no `0`, no
 *  `"0"` — just the silhouette + an explicit "unreadable" cue. */
function UnreadableModelNode({
  id,
  kind,
  selected,
}: {
  id: string
  kind: 'parameter' | 'register'
  selected?: boolean
}) {
  // §L9.3 — catalog prose inside the ltr-pinned canvas opts back into the
  // reader's direction. The value comes from the app's own resolver, never
  // from re-reading <html dir> or re-deriving it from the locale code.
  const uiDir = useLocaleDirection()
  const t = useT()
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <NodeFrame
      nodeId={id}
      kind={kind}
      title={t('node.unreadable.title', { kind })}
      titleDir={uiDir}
      sub={t('node.unreadable.sub')}
      subDir={uiDir}
      selected={selected}
      invalid
      stepKey={stepKey}
    />
  )
}

function ParameterNode({ id, data, selected }: NodeProps) {
  const stepKey = useSimStore((s) => s.stepIndex)
  const outside = useOutside()
  const read = readParameterData(data)
  if (!read.ok) return <UnreadableModelNode id={id} kind="parameter" selected={selected} />
  const d = read.data
  // node structure — the unit rides the value row (`464 $/day`, as a
  // Register's does); today's node keeps it on the detail line. The width
  // reserved it (W1), so the row shows it (Lumi's review, 2026-10-12)
  return (
    <NodeFrame
      nodeId={id}
      kind="parameter"
      widthReserve={reservedWidth({ type: 'parameter', data })}
      title={d.label || 'Parameter'}
      titleDir="auto"
      value={fmt(d.value)}
      unit={outside ? d.unit || undefined : undefined}
      sub={outside ? undefined : d.unit || undefined}
      subDir="auto"
      selected={selected}
      accent={(data as FlowColour).accent}
      stepKey={stepKey}
    />
  )
}

function RegisterNode({ id, data, selected }: NodeProps) {
  const stepKey = useSimStore((s) => s.stepIndex)
  const outcome = useRegisterOutcome(id)
  const numeric = outcome && !outcome.invalid ? outcome.value : Number.NaN
  const dir = useValueDir(Number.isFinite(numeric) ? numeric : 0)
  const read = readRegisterData(data)
  if (!read.ok) return <UnreadableModelNode id={id} kind="register" selected={selected} />
  const d = read.data
  // §M3.5 — the value shown is R(currentStepIndex). §M6.2 — an invalid Register
  // shows NO number (never 0, never a stale value): a `—` placeholder.
  const invalid = !outcome || outcome.invalid
  return (
    <NodeFrame
      nodeId={id}
      kind="register"
      widthReserve={reservedWidth({ type: 'register', data })}
      title={d.label || 'Register'}
      titleDir="auto"
      value={invalid ? '—' : formatRegisterValue(numeric, d.format)}
      valueDir={invalid ? null : dir}
      unit={invalid ? undefined : d.unit || undefined}
      sub={`= ${d.expr}`}
      subDir="ltr"
      selected={selected}
      accent={(data as FlowColour).accent}
      invalid={invalid}
      stepKey={stepKey}
    />
  )
}

export const nodeTypes: NodeTypes = {
  pool: PoolNode,
  source: SourceNode,
  drain: DrainNode,
  gate: GateNode,
  converter: ConverterNode,
  end: EndNode,
  parameter: ParameterNode,
  register: RegisterNode,
}
