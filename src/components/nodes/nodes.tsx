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
  maskBox,
  NODE_RINGS,
  silhouettePath,
  VESSEL_INSET_Y,
  VESSEL_MIN_PAD_Y,
} from './silhouette'
import { formatRegisterValue, readAccent, readParameterData, readRegisterData } from '../../model/model'
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
// Pool (value, capacity), Register (result, `= expr`) and Parameter (value,
// unit). The Source / Drain / Converter mode row keeps its place: its pointed
// or notched vessel scales with the width, so fitting it there would widen a
// node far more than its row needs (measured in #332, deferred).
const ROW_FIT_KINDS: ReadonlySet<NodeKind> = new Set(['pool', 'parameter', 'register'])

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

const sameFit = (a: RowFit | null, b: RowFit): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b)

/** the row fit as the frame's CSS custom properties (index.css reads them) */
function fitStyle(fit: RowFit | null): Record<string, string | number> | null {
  if (!fit) return null
  const s: Record<string, string | number> = {}
  for (const key of ['value', 'sub'] as const) {
    if (fit.start[key] != null) s[`--vra-${key}-start`] = `${fit.start[key]}px`
    if (fit.maxWidth[key] != null) s[`--vra-${key}-max`] = `${fit.maxWidth[key]}px`
  }
  if (fit.minWidth != null) s.minWidth = fit.minWidth
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
   *  (space + unit, e.g. `464 kKRW/day`). Absent ⇒ the value renders exactly as
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
  arriving?: boolean
  /** §VL3 — the model layer's `invalid` state (a Register the engine can't
   *  evaluate, or an unreadable model node). A `--warning` dashed outline + a
   *  top-right `!` flag; carries no value (the caller passes `—`). */
  invalid?: boolean
  stepKey: number
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
  arriving,
  invalid,
  stepKey,
}: FrameProps) {
  const tip = useT()
  const lod = useLod()
  const mapOnly = lod === 'L0' // no text at all — silhouette + type dot
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
  const [fit, setFit] = useState<RowFit | null>(null)
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
  // a content change that keeps the stack's size (a new number of the same
  // length, a shorter sub inside a title-wide node) still moves a row's glyph
  // extent, so any change of the rendered strings is re-read once, after
  // React commits it: one read per change, never per animation frame
  const fonts = useFontLoads()
  const fitKey = JSON.stringify([value, unit, sub, title, locale, fonts])
  useLayoutEffect(() => {
    const frame = frameRef.current
    const stack = stackRef.current
    if (!frame || !stack || !ROW_FIT_KINDS.has(kind)) return
    // the height the content asks for, read in the same pass as the box's
    // own (so the fit and the height land in ONE re-render of the node: a
    // second one, for 2,400 nodes, cost about 0.7 s)
    const h = boxHeightOf(kind, stack)
    const input = `${fitKey}|${h}`
    if (input === fitInput.current) return
    fitInput.current = input
    rowFitMeasured()
    const next = measureRowFit(frame, stack, kind, h)
    setFit((prev) => (sameFit(prev, next) ? prev : next))
  }, [fitKey, boxH, kind])
  // No explicit `updateNodeInternals` call here: React Flow's own internal
  // per-node ResizeObserver already keeps `node.measured` (and the handle
  // bounds edge routing reads) in sync with this wrapper's real DOM size,
  // in dev and production alike. Regression coverage:
  // e2e/template-label-overlay.spec.ts (dev) and e2e/dist.spec.ts (prod) —
  // re-run both if a React Flow upgrade touches node measurement.
  const grown = boxH > BASE_NODE_H

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

  const path = silhouettePath(kind, boxH)
  // FC-4.1 — only a stored-form colour is drawn; the ids are this component's
  // own (never built from the node id or the colour)
  const accent = readAccent(accentProp)
  const uid = 'nf' + useId().replace(/[^A-Za-z0-9_-]/g, '_')
  const box = maskBox(boxH)
  // state ports are invisible at rest; they surface on hover / selection /
  // keyboard focus / while a state wire is being dragged. A port that already
  // carries a state edge stays faintly visible so the wiring reads.
  const revealed = hovered || focused || isSelected || selected === true || draggingState
  const opIn = revealed ? 1 : stateInWired ? 0.5 : 0
  const opOut = revealed ? 1 : stateOutWired ? 0.5 : 0
  // §VL3 stacking — every state is its own layer, so a Register that is
  // selected AND keyboard-focused AND invalid shows all three cues at once:
  // the outer --warning invalid ring, the solid selection ring, the inset
  // dashed focus ring, and the corner `!` flag. The accessible name carries
  // `invalid` too (not colour / shape alone).
  // the accessible name is localized like every other label: the kind word
  // from the canvas catalog, the state words from `node.aria.*` — never the
  // raw kind token or an English literal
  const aria =
    `${tip(`canvas.nodeKind.${kind}` as MessageKey)} ${title}` +
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
        (accent ? ' has-accent' : '')
      }
      data-invalid={invalid ? '' : undefined}
      data-accent={accent}
      style={
        grown || accent || fit
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

      <svg
        className="nodef__shape"
        viewBox={`0 0 120 ${boxH}`}
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
        {accent || selected || invalid || focused ? (
          <defs>
            {accent ? (
              <clipPath id={`${uid}-in`}>
                <path d={path} />
              </clipPath>
            ) : null}
            {selected ? <OutsideMask id={`${uid}-sel`} d={path} box={box} from={NODE_RINGS.selection.from} /> : null}
            {invalid ? <OutsideMask id={`${uid}-inv`} d={path} box={box} from={NODE_RINGS.invalid.from} /> : null}
            {focused ? <InsideMask id={`${uid}-foc`} d={path} box={box} from={NODE_RINGS.focus.from} /> : null}
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
        {firing ? <path key={`w${stepKey}`} className="nodef__wave" d={path} /> : null}
        {arriving ? (
          <circle
            key={`a${stepKey}`}
            className="nodef__arrival"
            cx="60"
            cy={boxH / 2}
            r="15"
          />
        ) : null}
        {/* L0 map: type colour collapses to one dot inside the silhouette */}
        {mapOnly ? <circle className="nodef__cdot" cx="60" cy={boxH / 2} r="9" /> : null}
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
        <span className="nodef__eval" aria-hidden="true" title={tip('node.evaluatedCue')} />
      ) : null}

      {/* The body is ALWAYS in the DOM so the node's footprint / hit target is
          byte-identical across L2 / L1 / L0 (§VL7.1). The `lod-*` class fades
          the elided text: L1 hides `sub`, L0 hides the whole body — the
          silhouette + `cdot` carry the map view. */}
      <div className="nodef__body">
        <div className="nodef__stack" ref={stackRef}>
        <span className="nodef__head">
          <span className="nodef__chip" />
          <span
            className={phrased ? 'nodef__title nodef__title--phrased' : 'nodef__title'}
            dir={titleDir}
          >
            {titleNode}
          </span>
        </span>
        {value != null ? (
          <span className={`nodef__value${valueDir ? ` nodef__value--${valueDir}` : ''}`} dir="ltr">
            {value}
            {unit ? <span className="nodef__unit" dir="auto">{' '}{unit}</span> : null}
          </span>
        ) : null}
        {sub ? (
          <span className="nodef__sub" dir={subDir}>
            {sub}
          </span>
        ) : null}
        </div>
      </div>
    </div>
  )
}

function PoolNode({ id, data, selected }: NodeProps) {
  const d = data as PoolData
  const live = useSimStore((s) => (s.values ? s.values[id] : undefined))
  const shown = live ?? d.initial
  const stepKey = useSimStore((s) => s.stepIndex)
  const arriving = useSimStore((s) => s.arrivedPoolIds.includes(id))
  // Pool's face is its count; mode / capacity stay in the inspector
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="pool"
        title={d.label}
        titleDir="auto"
        value={fmt(shown)}
        valueDir={useValueDir(shown)}
        sub={d.capacity != null ? `≤ ${d.capacity}` : undefined}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        arriving={arriving}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
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
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function DrainNode({ id, data, selected }: NodeProps) {
  const d = data as DrainData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="drain"
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
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="gate"
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
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function ConverterNode({ id, data, selected }: NodeProps) {
  const d = data as ConverterData
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="converter"
        title={d.label}
        titleDir="auto"
        sub={d.mode}
        subDir="ltr"
        selected={selected}
        accent={(data as FlowColour).accent}
        firing={useFiring(id)}
        evaluated={useEvaluated(id)}
        activity={useNodeActivityOpacity(id)}
        stepKey={stepKey}
      />
      <Handle type="source" position={Position.Right} id="out" className="h h--out" />
    </>
  )
}

function EndNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string }
  const stepKey = useSimStore((s) => s.stepIndex)
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="h h--in" />
      <NodeFrame
        nodeId={id}
        kind="end"
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
  const read = readParameterData(data)
  if (!read.ok) return <UnreadableModelNode id={id} kind="parameter" selected={selected} />
  const d = read.data
  return (
    <NodeFrame
      nodeId={id}
      kind="parameter"
      title={d.label || 'Parameter'}
      titleDir="auto"
      value={fmt(d.value)}
      sub={d.unit || undefined}
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
