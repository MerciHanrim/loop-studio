import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
} from '@xyflow/react'
import { selectOnly, useGraphStore, type GestureSnapshot } from '../store/graphStore'
import type { InitialView } from '../model/templates'
import { refInsertVerdict, type RefResolveKind } from '../model/exprRefs'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { edgePortKind, faceOf, rfHandleId } from '../model/ports'
import { connectVerdict } from '../model/connectKind'
import { useFitAll } from './useFitAll'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { blocksCanvasKey } from '../ui/keyboardTarget'
import { createKeyGesture } from '../ui/keyGestureLifetime'
import { dragSnap, keyMoveGuides } from '../model/layout/dragSnap'
import { beginLiveLayout, bendAtClick, bendInsertIndex, bendRejection, currentRouteMap, diagramBounds, endLiveLayout, keyboardBend, useRouteInputs } from '../store/routeMap'
import { MIN_ZOOM as SAVED_VIEW_MIN_ZOOM } from '../model/workspace'
import { useRouteEditStore } from '../store/routeEditStore'
import { useGuideStore } from '../store/guideStore'
import { GRID, snapNodePosition } from '../model/layout/grid'
import { type MessageKey, useLocaleDirection, useT } from '../i18n'
import { useFilterStore } from '../store/filterStore'
import { nodeTypes } from './nodes/nodes'
import { edgeTypes } from './edges/LoopEdge'
import { EdgeMarkers } from './edges/EdgeMarkers'
import { holdConnectTouch, isFurtherTouchDuringHold, releaseConnectTouch } from './edges/connectTouchHold'
import { useFocusSet } from './focusSet'
import { useHiddenSet } from './filterSet'
import { FilterPanel } from './FilterPanel'
import { FrameLayer } from './frames/FrameLayer'
import { SmartGuideLayer } from './SmartGuideLayer'
import { PanSurface } from './PanSurface'
import { useFrameStore, hasFrames } from '../store/frameStore'
import { useAutoFrameStore, hasAutoFrames, autoFramesStale } from '../store/autoFrameStore'
import { WORTH_IT_FLOOR } from './frames/autoFrames'
import { CanvasHintNote, useHintEligible } from './HintNote'
import { NOTICE_RAIL_ID, RailOrPanel } from '../ui/noticeRail'
import { canvasFitInsets, viewportForRect } from './canvasFit'
import { useHintStore, useTier3Ready, useLargeGraphInteractionGate } from '../store/hintStore'
import { useTourStore } from '../store/tourStore'
import { isolateAuto } from '../i18n/bidiIsolate'
import { Icon } from '../ui/icons'

// docs/large-graph-readability.md §LGR3.1 — the class the CSS fades on an
// out-of-focus node / edge. It fades only the body / silhouette / label; the
// §VL7.1 required set (rings, invalid flag, run cues) is left full-strength.
const DEEMPH_CLASS = 'lgr-deemph'
const withDeemph = (base: string | undefined): string =>
  base ? `${base} ${DEEMPH_CLASS}` : DEEMPH_CLASS

const DND_TYPE = 'application/loop-node'

// the <ReactFlow> zoom clamp — shared with PanSurface's own pinch-zoom math
// (docs/dense-graph-pan.md) so a pinch can never take the viewport past what
// the Controls +/- or wheel-zoom would allow. MIN_ZOOM is the least a hand
// zooms to; the canvas lowers it only where the whole diagram needs less to
// fit (`zoomFloor` below).
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2
// how far (px) a press on a connection or a frame's name chip may drift and
// stay a click, while Select a region is armed (§LGR12.1). More than the
// pane's own 1 px (React Flow's default): a click there selects the
// connection or opens the frame's properties, and with 1 px a click that
// drifted 2–3 px made a box instead (2026-10-28, Lumi)
const HANDOFF_DRAG_DISTANCE = 4

// React Flow's `StoreUpdater` syncs a fixed list of props into its own store and
// compares each with `===`. `Canvas` re-renders on every pointer move of a node
// drag (it feeds `nodes` to React Flow), so a fresh object literal in one of
// those props writes to the store on every move — and `defaultEdgeOptions` in
// particular is read by EVERY `EdgeWrapper` with default equality, which
// re-renders every edge. These two never change, so they are hoisted; the
// translated `ariaLabelConfig` is memoized at its use site instead.
const DEFAULT_EDGE_OPTIONS = { type: 'loop' } as const

// F4 — React Flow hands its live-region formatter a bare English direction
// ('left' / 'right' / 'up' / 'down'); map it to a real key so `check:i18n` can
// see every one of them (a template literal would read as a dead key).
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** issue #344 §DL3 — an arrow key's grid direction and React Flow's word for it */
const ARROW_DIR: Record<string, [number, number, string]> = {
  ArrowLeft: [-1, 0, 'left'],
  ArrowRight: [1, 0, 'right'],
  ArrowUp: [0, -1, 'up'],
  ArrowDown: [0, 1, 'down'],
}
const RF_DIR_KEY: Record<string, MessageKey> = {
  left: 'rf.dir.left',
  right: 'rf.dir.right',
  up: 'rf.dir.up',
  down: 'rf.dir.down',
}
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1.2 } as const

// docs/visual-language.md §VL7.2 — "Grid fades out entering L1". The dot grid is
// a scan aid for the detail view only; below the L2 threshold it is dropped so
// the map view stays clean. Pure function of zoom — a threshold round-trip
// restores it exactly (no hysteresis).
function LodGrid() {
  const showGrid = useStore((s) => s.transform[2] >= 0.8)
  return showGrid ? <Background gap={16} color="var(--grid)" /> : null
}

export function Canvas() {
  // §L9.3 — the canvas subtree is pinned ltr, so every localized string
  // rendered inside it opts back into the reader's direction explicitly.
  const uiDir = useLocaleDirection()
  // docs/contextual-inline-help.md §CIH3 #4 — the `.canvas` element, for a
  // one-shot "did the user ever touch this" interaction listener.
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const tidyToGrid = useGraphStore((s) => s.tidyToGrid)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { screenToFlowPosition, fitView, setViewport, getViewport, deleteElements } = useReactFlow()
  // the whole-diagram fit that contains the outside names (./useFitAll), the
  // same one the workbench status bar's Fit runs
  const fitAll = useFitAll(useCallback(() => canvasRef.current, []))
  const rfStore = useStoreApi()
  const isMobile = useIsMobile()
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  // issue #344 §ER14.5 — routed connections not drawn yet (their first sliced
  // generation is running): the canvas says it is busy
  const routesBusy = useRouteInputs((s) => s.busy)
  const toggleCanvasLocked = useUiStore((s) => s.toggleCanvasLocked)
  const focusMode = useUiStore((s) => s.focusMode)
  const toggleFocusMode = useUiStore((s) => s.toggleFocusMode)
  const filterPanelOpen = useUiStore((s) => s.filterPanelOpen)
  const toggleFilterPanel = useUiStore((s) => s.toggleFilterPanel)
  const activityOverlay = useUiStore((s) => s.activityOverlay)
  const toggleActivityOverlay = useUiStore((s) => s.toggleActivityOverlay)
  const panMode = useUiStore((s) => s.panMode)
  const togglePanMode = useUiStore((s) => s.togglePanMode)
  const setPanMode = useUiStore((s) => s.setPanMode)
  const regionSelectArmed = useUiStore((s) => s.regionSelectArmed)
  // docs/large-graph-readability-frame-colour.md §FC10 — a frame's properties
  // popover is placed in SCREEN space from its title's measured rect, so the
  // canvas is frozen while it is open: a pan or a zoom underneath would slide
  // the panel off its own anchor, and §FC10's contract is that opening it and
  // recolouring from it move nothing at all.
  const framePropsOpen = useUiStore((s) => s.frameProps !== null)
  const setRegionSelectArmed = useUiStore((s) => s.setRegionSelectArmed)
  // docs/register-expression-authoring.md §RXA8 — arm-and-click reference insert
  const refInsert = useUiStore((s) => s.refInsert)
  const pickRefInsert = useUiStore((s) => s.pickRefInsert)
  const setRefInsertHint = useUiStore((s) => s.setRefInsertHint)
  const disarmRefInsert = useUiStore((s) => s.disarmRefInsert)
  const refInsertArmed = refInsert != null
  const frameToolArmed = useFrameStore((s) => s.toolArmed)
  const armFrameTool = useFrameStore((s) => s.armTool)
  const disarmFrameTool = useFrameStore((s) => s.disarmTool)
  const clearFrames = useFrameStore((s) => s.clearFrames)
  const selectFrame = useFrameStore((s) => s.selectFrame)
  const framesExist = useFrameStore(hasFrames)
  // docs/large-graph-readability-auto-frames.md §AF — "Suggest frames" (P1: an
  // explicit action, never auto) + its derived set.
  const suggestFrames = useAutoFrameStore((s) => s.suggest)
  const clearAutoFrames = useAutoFrameStore((s) => s.clearAuto)
  const autoFramesExist = useAutoFrameStore(hasAutoFrames)
  const autoSuggestSignature = useAutoFrameStore((s) => s.lastSignature)
  // §AF9.2 — the "structural, not domain meaning" note, dismissible for the
  // session (a plain component-state flag — resets on a full reload).
  const [suggestNoteDismissed, setSuggestNoteDismissed] = useState(false)
  // docs/contextual-inline-help.md §CIH2.3a — tier-3 (CIH's own discovery
  // canvas hints) needs the tour idle + past its post-tour cooldown; §CIH3
  // #4 additionally needs a real interaction or the fallback delay.
  const tourIdle = useTourStore((s) => s.phase === 'idle')
  const tier3Ready = useTier3Ready()
  const largeGraphInteractionGate = useLargeGraphInteractionGate()
  const focusOrFilterEverUsed = useHintStore((s) => s.focusOrFilterEverUsed)
  const graphEditRev = useGraphStore((s) => s.nodes)
  // §AF2.2 — the "Suggest frames" control only appears when the whole graph is
  // big enough for the feature to help (below the floor it would only ever
  // produce nothing). Also keeps the controls column from growing on a small
  // graph.
  const suggestEligible = useMemo(
    () =>
      graphEditRev.filter((n) => {
        const k = (n.data as { kind?: string } | undefined)?.kind ?? String(n.type)
        return k !== 'parameter' && k !== 'register'
      }).length >= WORTH_IT_FLOOR,
    [graphEditRev],
  )
  const suggestStale = useMemo(
    () => autoFramesStale(autoSuggestSignature),
    // re-check whenever the graph's node array identity changes (an edit) or a
    // new suggest resets the signature; positions are read live inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoSuggestSignature, graphEditRev],
  )
  const fitRev = useGraphStore((s) => s.fitRev)
  const loadRev = useGraphStore((s) => s.loadRev)
  const nodesInitialized = useNodesInitialized()
  const paneW = useStore((s) => s.width)
  const paneH = useStore((s) => s.height)
  const t = useT()
  // the zoom-out limit: MIN_ZOOM for a hand on the wheel, the pinch or −,
  // lowered only as far as the WHOLE diagram needs to fit this pane (Lumi,
  // 2026-10-20: the Early MMO's whole-diagram fit at 1280 × 800 stopped at
  // 0.2 and left 30 of its 97 nodes off screen). The same padding as the
  // fit (useFitAll: `fitBounds` padding 0.3, bounds × 1.3), a hair under so
  // the fit is never the one clamped; never below the least zoom a saved
  // view restores to.
  const zoomFloor = useMemo(() => {
    const b = diagramBounds(nodes)
    if (!b || paneW <= 0 || paneH <= 0 || b.width <= 0 || b.height <= 0) return MIN_ZOOM
    const fit = Math.min(paneW / (b.width * 1.3), paneH / (b.height * 1.3)) * 0.98
    return Math.max(SAVED_VIEW_MIN_ZOOM, Math.min(MIN_ZOOM, fit))
  }, [nodes, paneW, paneH])


  // the zoom Controls rail is on screen on the phone only (canvasFitInsets)
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile
  // DEV / E2E only — the last `applyInitialView` result, so a test can assert
  // the insets and zoom it framed with. Tree-shaken from the production /
  // portable bundle with the rest of `import.meta.env.DEV`.
  const lastInitialViewRef = useRef<{ insetL: number; insetT: number; zoom: number } | null>(null)

  // §MML3 — a menu-opened Template can carry a fixed graph-coordinate `rect` to
  // frame instead of fit-all. Fit `rect` into the pane MINUS the fixed overlays
  // (the zoom Controls, ~44 wide on the left, where they are shown).
  // Left-align `rect` horizontally (a progression graph reads beginning-first);
  // centre it vertically, or top-align when it is taller than the usable
  // height. Clamp the zoom to `[minZoom, 1.2]`. Pure function of the rect + pane
  // size — identical for every UI language, and unchanged on a language switch
  // (this only runs on a `fitRev` swap).
  const applyInitialView = useCallback(
    (iv: InitialView) => {
      // the computation itself lives in `canvasFit.ts` (shared with the
      // import wizard's post-commit view, docs/data-import.md §DI17); the
      // insets are this Canvas's own overlays. `keep` (issue #344) caps the
      // zoom so the core start nodes stay whole.
      const insets = canvasFitInsets(0, isMobileRef.current)
      const vp = viewportForRect(iv.rect, { width: paneW, height: paneH }, insets, { floor: iv.minZoom, ceil: 1.2, keep: iv.keep })
      if (!vp) return void fitAll()
      setViewport(vp, { duration: 0 })
      if (import.meta.env.DEV) lastInitialViewRef.current = { insetL: insets.left, insetT: insets.top, zoom: vp.zoom }
    },
    [paneW, paneH, setViewport, fitView],
  )
  // keep the re-fit effect's deps stable (fitRev / loadRev / a settle signal)
  // — `applyInitialView` changes identity with the pane size and must not
  // re-trigger or tear down the pending swap fit.
  const applyInitialViewRef = useRef(applyInitialView)
  applyInitialViewRef.current = applyInitialView

  // §MML1 — a node whose title wraps grows its box ONE measure pass after
  // `nodesInitialized` first turns true (and fires `updateNodeInternals`), so
  // React Flow's node bounds keep moving for a beat. A cheap sum of the
  // measured node sizes is a "layout settled" signal: hold the pending fit
  // until it stops changing frame-to-frame, else a graph wider than `maxZoom`
  // opens clipped (fitView clamps up and overflows).
  const measuredSig = useStore((s) => {
    let sig = 0
    for (const n of s.nodeLookup.values()) sig += (n.measured?.width ?? 0) * 31 + (n.measured?.height ?? 0)
    return Math.round(sig)
  })

  // A Templates load / pasted-graph swap bumps `graphStore.fitRev` — a
  // whole-graph replacement that carries NO viewport of its own and lands on
  // top of a graph the user was already looking at. React Flow keeps the
  // previous camera on a swap, so a new template can open panned to the *old*
  // graph's viewport (a blank / clipped first impression). Re-fit once per
  // swap, AFTER React Flow has laid out and MEASURED the new nodes
  // (`useNodesInitialized`) AND those measurements have settled (§MML1) — no
  // `setTimeout`, no retry loop. Excluded upstream: `newGraph` and `loadDoc`
  // (file / Workspace / Share / revision import — a Workspace restores its own
  // saved view). Skipped if a `loadDoc` landed after the arm, or if the camera
  // was moved between the swap and the fit (a deliberate pan wins). The initial
  // mount is left to `<ReactFlow fitView>`. Pan / zoom, "Reset view", Focus,
  // filters and the mobile orientation re-fit are untouched; nothing here reads
  // or writes the GraphDoc / node positions / undo / digest.
  const seenFitRev = useRef<number | null>(null)
  const armedSwap = useRef<{
    rev: number
    atLoadRev: number
    fromVp: { x: number; y: number; zoom: number }
    sig: number | null
  } | null>(null)
  const [settleTick, setSettleTick] = useState(0)
  // DEV / E2E only — the swap's fit-all while it is landing (React Flow's
  // fitView resolves a frame or more later), for `swapFitPending` below
  const swapFitLanding = useRef<Promise<void> | null>(null)
  // a touch connection's hold never outlives the canvas
  useEffect(() => releaseConnectTouch, [])
  useEffect(() => {
    if (seenFitRev.current === null) {
      seenFitRev.current = fitRev // first run: adopt the mount's graph
      return
    }
    if (fitRev !== seenFitRev.current && armedSwap.current?.rev !== fitRev) {
      seenFitRev.current = fitRev
      armedSwap.current = { rev: fitRev, atLoadRev: loadRev, fromVp: getViewport(), sig: null }
    }
    const armed = armedSwap.current
    if (!armed || !nodesInitialized) return // wait for the measure pass
    // a `loadDoc` (file / Workspace / Share / revision import) that landed
    // AFTER this swap was armed bumps `loadRev` but not `fitRev` — it owns the
    // camera (or restores a saved one), so drop the pending fit.
    if (armed.atLoadRev !== loadRev) {
      armedSwap.current = null
      return
    }
    // hold until the measured node sizes are stable for one frame (§MML1)
    if (armed.sig !== measuredSig) {
      armed.sig = measuredSig
      const id = requestAnimationFrame(() => setSettleTick((n) => n + 1))
      return () => cancelAnimationFrame(id)
    }
    armedSwap.current = null
    const now = getViewport()
    const untouched =
      Math.abs(now.x - armed.fromVp.x) < 0.5 &&
      Math.abs(now.y - armed.fromVp.y) < 0.5 &&
      Math.abs(now.zoom - armed.fromVp.zoom) < 1e-6
    if (!untouched) return
    // §MML3 — a menu-opened Template may frame a sub-region instead of fit-all
    const iv = useGraphStore.getState().pendingInitialView
    if (iv) applyInitialViewRef.current(iv)
    else {
      const landing = fitAll()
      if (import.meta.env.DEV) {
        swapFitLanding.current = landing
        void landing.finally(() => {
          if (swapFitLanding.current === landing) swapFitLanding.current = null
        })
      }
    }
  }, [fitRev, loadRev, nodesInitialized, measuredSig, settleTick, fitView, getViewport])

  // the notice rail (src/ui/noticeRail.tsx, `#notice-rail`) sits between the
  // toolbar and this pane: when a note comes or goes the pane's TOP EDGE moves
  // by the rail's height change. Lumi (2026-10-12): nothing on the canvas may
  // move when that happens. So whenever this pane's size changes, its top edge
  // is compared with the last one and the viewport is shifted by the
  // difference in the same layout pass: every node keeps its place ON SCREEN,
  // the rail reveals or frees the strip at the top. No zoom change, no fit, no
  // re-centring (those run on a Template swap only). A pane that only grows or
  // shrinks at the BOTTOM (the timeline panel, a window resize) moves nothing.
  // The pane element is observed, not the rail, so a re-created rail (a locale
  // or direction switch rebuilds the chrome) cannot detach the observer.
  // Measured before this: a 39 px jump broke the hit-test and frame-drag e2e.
  // The shift is not a user's pan: a swap armed above compares the viewport
  // with the one it saw at arming to tell a pan from an untouched camera, so
  // the armed reference moves with the shift — measured 2026-10-12: a hint
  // entering the rail between a Template swap and its fit cancelled the
  // Template's start view (the Gacha initial-load e2e).
  // Only the RAIL's own height counts (measured 2026-10-12, the full e2e on the
  // release tree): shifting on every move of the pane's top edge also fired
  // when the toolbar wrapped at a narrow width, and the phone layout in
  // between detached and re-attached the observer with a new reference, so a
  // resize to 560 px and back left the camera 108 px off. The rail's height is
  // read afresh on every callback, so a rebuilt rail element is no problem.
  useEffect(() => {
    if (isMobile || typeof ResizeObserver === 'undefined') return
    const pane = rfStore.getState().domNode
    if (!pane) return
    const railHeight = () => document.getElementById(NOTICE_RAIL_ID)?.getBoundingClientRect().height ?? 0
    let lastRail = railHeight()
    const ro = new ResizeObserver(() => {
      const h = railHeight()
      const d = h - lastRail
      lastRail = h
      if (d === 0) return
      const v = getViewport()
      void setViewport({ x: v.x, y: v.y - d, zoom: v.zoom }, { duration: 0 })
      const armed = armedSwap.current
      if (armed) armed.fromVp = { ...armed.fromVp, y: armed.fromVp.y - d }
    })
    ro.observe(pane)
    return () => ro.disconnect()
  }, [isMobile, rfStore, getViewport, setViewport])

  // docs/large-graph-readability.md §LGR3.3 — the two lenses COMPOSE: filter
  // hides first (removes from the canvas), then focus dims the remainder. Both
  // only tag the objects React Flow RENDERS (`hidden` / a class); the graphStore
  // arrays that serialize / diff / undo are never touched (LGR-INV-1), and React
  // Flow's change events still flow back to the store unchanged.
  const focusSet = useFocusSet()
  // docs/contextual-inline-help.md §CIH2.3a — the two LGR notices below are
  // TIER 2; CIH's own canvas hints (empty-canvas, Focus/Filter discovery) are
  // TIER 3 and yield the shared top-center slot to either of these.
  // docs/data-import.md §DI17 / §CIH2.3a tier 1 — the one-shot hint right
  // after the first spreadsheet import lands. It follows a deliberate action
  // (the Import button), so it takes the `top-center` slot over the tier-2
  // auto-frame suggest note (which yields below) and, like every hint, over
  // the tier-3 discovery hints. Its trigger is the wizard's `lastImportBatch`,
  // cleared when the wizard opens again — after which the note retires for
  // good (a second import never re-shows it).
  const lastImportBatch = useUiStore((s) => s.lastImportBatch)
  const importHint = useHintEligible('import-first-commit', lastImportBatch !== null, tourIdle)
  const importHintShowing = importHint.eligible && lastImportBatch !== null
  // docs/large-graph-readability.md §LGR6.5 / docs/contextual-inline-help.md
  // §CIH3 #9 (2026-09-20) — the first time a SAVED frame is selected on an
  // editable desktop canvas: "an edge drag carries the contents; Alt+drag moves
  // the frame alone". Tier 1 (follows a deliberate action) — it takes the slot
  // over the tier-3 discovery hints below.
  const savedFrameSelected = useFrameStore((s) => s.selectedId !== null && s.frames.some((f) => f.id === s.selectedId))
  // `ready` yields to the import note: while it holds the slot the frame-move
  // note neither renders nor is consumed (`seen` is recorded on render only).
  const frameMoveHint = useHintEligible('frame-move', savedFrameSelected && !isMobile && !canvasLocked, tourIdle && !importHintShowing)
  const frameMoveHintShowing = frameMoveHint.eligible && savedFrameSelected
  const lgrNoticeShowing =
    (focusMode && !focusSet) || (autoFramesExist && !suggestNoteDismissed) || importHintShowing || frameMoveHintShowing
  const hidden = useHiddenSet()
  // §LGR6-cues — the opt-in Activity overlay tint composes AFTER hide (a
  // filtered element is gone, tint and all) and independently of dim (a
  // de-emphasised element keeps its tint, which just reads faintly at the dim
  // opacity). Canvas does NOT apply it: React Flow v12 forwards a node object's
  // `style` to `.react-flow__node`, which is an auto-width wrapper (a
  // rectangular overlay on it overflows the visible silhouette), and an edge
  // object's `style` never reaches the path at all. So `NodeFrame` and
  // `LoopEdge` each read their own opacity (`useNode/EdgeActivityOpacity`) and
  // draw a shape-accurate tint themselves.
  const rfNodes = useMemo(() => {
    if (!hidden && !focusSet) return nodes
    return nodes.map((n) => {
      if (hidden?.nodes.has(n.id)) return { ...n, hidden: true }
      // A SELECTED node is never de-emphasised, whatever the focus set says.
      // The focus set is anchored on `selectedNodeId` — the first selected node
      // only (§LGR2.2) — so with several nodes selected the others fell outside
      // it and rendered at `lgr-deemph`'s 0.26 with their type dot hidden, while
      // still being selected. The selection outline survives the fade by design,
      // but a 2 px ring on a 74 %-transparent body is not a legible "this is
      // selected". Selection wins over focus; the focus calculation itself is
      // unchanged and still applies to every node the user did NOT select.
      if (focusSet && !focusSet.nodes.has(n.id) && !n.selected)
        return { ...n, className: withDeemph(n.className) }
      return n
    })
  }, [nodes, hidden, focusSet])
  // node structure (src/model/ports.ts) — under the new structure a node offers
  // one DOM handle per face per port, so a connection with a stored face binds
  // to `<id>@<face>`; the document's edge keeps the plain id. Today's structure
  // has only the default handles, so a stored face is drawn at the default
  // face there (the document is untouched either way).
  const nodeStructure = useUiStore((s) => s.nodeStructure)
  const facedEdges = useMemo(() => {
    if (nodeStructure !== 'outside') return edges
    return edges.map((e) => {
      const k = edgePortKind(e)
      const sh = rfHandleId(k, 'source', faceOf(e, 'source'))
      const th = rfHandleId(k, 'target', faceOf(e, 'target'))
      return sh === e.sourceHandle && th === e.targetHandle ? e : { ...e, sourceHandle: sh, targetHandle: th }
    })
  }, [edges, nodeStructure])
  const rfEdges = useMemo(() => {
    if (!hidden && !focusSet) return facedEdges
    return facedEdges.map((e) => {
      if (hidden?.edges.has(e.id)) return { ...e, hidden: true }
      if (focusSet && !focusSet.edges.has(e.id)) return { ...e, className: withDeemph(e.className) }
      return e
    })
  }, [facedEdges, hidden, focusSet])
  // pointing to read (17-implementation-rules.md §2 cues): the connection under
  // the pointer, so its whole route and its own label are identified together
  const setHoverEdgeId = useUiStore((s) => s.setHoverEdgeId)

  // docs/large-graph-readability.md §LGR3.4 / LGR-D4 — Reset view: one UI-only
  // action that fits the graph and clears the exploration lens (filter
  // selections + the focused node). The Focus *mode* on/off preference is left
  // alone, and nothing touches the GraphDoc / digest / undo.
  const resetView = useCallback(() => {
    useFilterStore.getState().clear()
    setSelection(null, null)
    void fitAll()
  }, [setSelection, fitView])

  // structural editing is off on mobile (docs/mobile.md §MV3a) OR when the
  // desktop Canvas is edit-locked (uiStore.canvasLocked). Selection, pan / zoom,
  // the Timeline and the sim are unaffected either way.
  const noEdit = isMobile || canvasLocked

  // docs/dense-graph-pan.md — the pan-capture overlay is live on mobile (always
  // — view / run only) and on desktop while Pan mode is on. The Frame tool
  // takes precedence (a pane drag draws a frame). While it is live, node
  // dragging is off so a resolved tap can never start a drag.
  const panSurfaceActive = (isMobile || panMode) && !frameToolArmed && !regionSelectArmed

  // docs/large-graph-readability.md §LGR12 — the three drag tools are mutually
  // exclusive. Arming region select turns the Frame tool and Pan mode off;
  // arming either of those cancels region select. The existing Frame ↔ Pan
  // precedence (`panSurfaceActive` already yields to `frameToolArmed`) is NOT
  // changed here, and with every tool off nothing about node drag, connect or
  // pan differs from before.
  const armRegionSelect = useCallback(() => {
    disarmFrameTool()
    setPanMode(false)
    setRegionSelectArmed(true)
  }, [disarmFrameTool, setPanMode, setRegionSelectArmed])
  const disarmRegionSelect = useCallback(() => setRegionSelectArmed(false), [setRegionSelectArmed])
  // the selection a rubber-band box started from, so Esc can put it back
  // (§LGR12.1). Non-null exactly while a box is in flight.
  const selectionBeforeBox = useRef<{ nodes: string[]; edges: string[] } | null>(null)
  const clearRfSelectionBox = useCallback(
    () => rfStore.setState({ userSelectionActive: false, userSelectionRect: null }),
    [rfStore],
  )
  // the pointer was taken away mid-box, so React Flow will never see a
  // `pointerup`: clear its rubber-band rectangle too, or it stays frozen on the
  // canvas until the user's next click.
  const cancelRegionSelect = useCallback(() => {
    disarmRegionSelect()
    selectionBeforeBox.current = null
    clearRfSelectionBox()
  }, [disarmRegionSelect, clearRfSelectionBox])
  const toggleRegionSelect = useCallback(
    () => (regionSelectArmed ? disarmRegionSelect() : armRegionSelect()),
    [regionSelectArmed, armRegionSelect, disarmRegionSelect],
  )

  // how many nodes are selected — shown whether or not the canvas is locked, so
  // the count does not vanish at the moment the user unlocks to act on it.
  // Esc cancels the TOOL without touching the selection (§LGR12). Capture phase,
  // like the §RXA8 disarm, so a focused control cannot swallow it first.
  //
  // `pointercancel` spends it too: when the browser takes the pointer away
  // mid-box there is no `pointerup`, so React Flow never fires `onSelectionEnd`
  // and the tool would otherwise stay armed with no box on screen — the next
  // pane drag would silently rubber-band instead of pan.
  useEffect(() => {
    if (!regionSelectArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const snap = selectionBeforeBox.current
      if (snap) {
        // a box is in flight: React Flow has already been re-selecting nodes as
        // it grew, and the release would commit that. Abandon the gesture — put
        // the selection back where the box started and take the rectangle away.
        selectionBeforeBox.current = null
        const want = new Set(snap.nodes)
        const nChanges = useGraphStore
          .getState()
          .nodes.filter((n) => !!n.selected !== want.has(n.id))
          .map((n) => ({ id: n.id, type: 'select' as const, selected: want.has(n.id) }))
        if (nChanges.length) onNodesChange(nChanges)
        const wantE = new Set(snap.edges)
        const eChanges = useGraphStore
          .getState()
          .edges.filter((x) => !!x.selected !== wantE.has(x.id))
          .map((x) => ({ id: x.id, type: 'select' as const, selected: wantE.has(x.id) }))
        if (eChanges.length) onEdgesChange(eChanges)
        clearRfSelectionBox()
      }
      disarmRegionSelect()
    }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('pointercancel', cancelRegionSelect, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointercancel', cancelRegionSelect, true)
    }
  }, [regionSelectArmed, disarmRegionSelect, cancelRegionSelect, clearRfSelectionBox, onNodesChange, onEdgesChange])

  // §LGR12.1 — while armed, a drag that starts on a connection or a frame's
  // name chip draws the box too (2026-10-28, Lumi: before, it did nothing).
  // React Flow starts a box only from a press on the pane itself, so once the
  // press has moved past HANDOFF_DRAG_DISTANCE it is handed to the pane, from
  // where it started. A press that moves less stays a click: the connection is
  // selected, the chip opens the frame's properties, as before.
  // Nodes, frame borders, bends and end grips keep their own drags.
  useEffect(() => {
    if (!regionSelectArmed) return
    const pane = rfStore.getState().domNode?.querySelector<HTMLElement>('.react-flow__pane')
    if (!pane) return
    let from: { x: number; y: number; id: number; type: string } | null = null
    const onDown = (e: PointerEvent) => {
      from = null
      if (!e.isTrusted || e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return
      if (!(e.target as Element).closest('.react-flow__edge, .lgr-frame__label')) return
      from = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType }
    }
    const onMove = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) <= HANDOFF_DRAG_DISTANCE) return
      const s = from
      from = null
      pane.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, pointerId: s.id, pointerType: s.type, isPrimary: true, button: 0, buttons: 1 }),
      )
    }
    const onUp = () => (from = null)
    pane.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    return () => {
      pane.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
    }
  }, [regionSelectArmed, rfStore])

  // never leave the tool armed across a context it cannot apply to: the Frame
  // tool taking over, Pan mode coming on, or the layout turning mobile.
  useEffect(() => {
    if (regionSelectArmed && (frameToolArmed || panMode || isMobile)) disarmRegionSelect()
  }, [regionSelectArmed, frameToolArmed, panMode, isMobile, disarmRegionSelect])

  // React Flow's built-in a11y strings (Controls buttons, the keyboard hints on
  // nodes / edges, the handle label) — localized via the one config prop
  // (docs/localization.md Slice 2b).
  //
  // Memoized on `t`, which is the correct and only dependency: `useT` keys its
  // `useCallback` on `[activeLocale, activeCatalog]` and `setLocale` commits
  // both in ONE set once the catalog has loaded (docs/localization.md §L4.5), so
  // `t`'s identity moves on a language switch and on a lazily-loaded catalog
  // arriving, and on nothing else. Memoizing on `[]` — or on the locale alone —
  // would freeze these strings at whatever language rendered first;
  // `e2e/canvas-aria-locale.spec.ts` is the guard.
  const ariaLabelConfig = useMemo(() => ({
    'controls.ariaLabel': t('rf.controls.label'),
    'controls.zoomIn.ariaLabel': t('rf.controls.zoomIn'),
    'controls.zoomOut.ariaLabel': t('rf.controls.zoomOut'),
    'controls.fitView.ariaLabel': t('rf.controls.fitView'),
    'controls.interactive.ariaLabel': t('rf.controls.interactive'),
    'handle.ariaLabel': t('rf.handle.label'),
    'node.a11yDescription.default': t('rf.node.a11y'),
    // F4 (audit 2026-09-20) — React Flow announces every arrow-key node move in
    // its own assertive region; without this it stays English in every locale.
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }: { direction: string; x: number; y: number }) =>
      t('rf.node.moved', { direction: t(RF_DIR_KEY[direction] ?? 'rf.dir.right'), x, y }),
    'node.a11yDescription.keyboardDisabled': t('rf.node.a11yKeyboard'),
    'edge.a11yDescription.default': t('rf.edge.a11y'),
  }), [t])

  // Dev-only: expose the viewport controls so the browser E2E can set an EXACT,
  // repeatable zoom for the deterministic screenshot matrix. Tree-shaken out of
  // the production / portable build (`import.meta.env.DEV` is statically false).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __loop?: Record<string, unknown> }
    if (w.__loop) {
      w.__loop.rf = { setViewport, getViewport, fitView, fitAll }
      // the last `applyInitialView` result — lets an e2e assert the insets and
      // zoom of a menu-open framing
      w.__loop.canvas = {
        lastInitialView: () => lastInitialViewRef.current,
        // whether a swap's own fit is still to come: its `fitRev` not seen
        // yet, armed and waiting for the measure pass, or landing. An e2e
        // that sets its own viewport after a load waits for this first —
        // else the fit, armed after that viewport, sees an untouched camera
        // and lands on top of it.
        swapFitPending: () =>
          seenFitRev.current !== useGraphStore.getState().fitRev || armedSwap.current != null || swapFitLanding.current != null,
      }
    }
  }, [setViewport, getViewport, fitView, fitAll])

  // docs/contextual-inline-help.md §CIH3 #4 — any real canvas interaction
  // (a pan, a pinch/wheel zoom, a node drag, a tap-select) satisfies the
  // Focus/Filter hint's interaction-or-delay gate immediately. One-shot,
  // session-only; markInteracted() no-ops once already true.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const mark = () => useHintStore.getState().markInteracted()
    el.addEventListener('pointerdown', mark, { once: true, capture: true })
    el.addEventListener('wheel', mark, { once: true, capture: true, passive: true })
    return () => {
      el.removeEventListener('pointerdown', mark, true)
      el.removeEventListener('wheel', mark, true)
    }
  }, [])

  // docs/mobile.md §MV3d: on a real orientation flip, re-fit the whole diagram
  // exactly once. Pan / pinch-zoom within one orientation never re-fits — the
  // re-fit is gated on the portrait/landscape flag actually changing.
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return
    let landscape = window.innerWidth > window.innerHeight
    let raf = 0
    const onResize = () => {
      const now = window.innerWidth > window.innerHeight
      if (now === landscape) return
      landscape = now
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        void fitAll()
      })
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [isMobile, fitView])

  const onSelectionChange = useCallback(
    ({ nodes: sn, edges: se }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
      // while a §RXA8 pick is armed, selection is frozen (elementsSelectable is
      // off) — ignore any stray selection-change so the edited Register stays put
      if (useUiStore.getState().refInsert) return
      setSelection(sn[0]?.id ?? null, se[0]?.id ?? null)
    },
    [setSelection],
  )

  // §RXA8 — a click on a node while armed inserts its `@id` (or explains why it
  // cannot); Esc / an empty-canvas click disarm. The click never changes which
  // Register the Inspector shows.
  const kindLabel = useCallback((k: RefResolveKind) => t(`canvas.nodeKind.${k}` as MessageKey), [t])
  const onArmedNodeClick = useCallback(
    (nodeId: string) => {
      const arm = useUiStore.getState().refInsert
      if (!arm) return
      const v = refInsertVerdict(useGraphStore.getState().nodes, arm.editingId, nodeId, kindLabel)
      if (v.ok) pickRefInsert(nodeId)
      else setRefInsertHint(v.reason === 'cycle' ? { reason: 'cycle', name: v.withName } : { reason: v.reason })
    },
    [kindLabel, pickRefInsert, setRefInsertHint],
  )
  useEffect(() => {
    if (!refInsertArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        disarmRefInsert()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [refInsertArmed, disarmRefInsert])

  // issue #344 step 3 (docs/edge-routing.md §ER16) — "Add bend": armed from the
  // Inspector for the selected connection. The next click on its line inserts
  // one bend point on the segment clicked, snapped along it (Alt: free), into
  // the span the click lands on; or Enter inserts one in the middle of the
  // longest editable segment (`keyboardBend`) and moves the focus to its
  // handle. Either is one undo entry and disarms. A point inside a node or on
  // the connection's own port stub is refused (nothing changes; Enter says so
  // through the canvas live region and stays armed). Escape disarms; so does
  // another selection, the edit lock or the phone layout, which also drop the
  // focused bend point.
  const addBendFor = useRouteEditStore((s) => s.addBendFor)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  useEffect(() => {
    const r = useRouteEditStore.getState()
    if (noEdit) {
      r.clear()
      return
    }
    if (r.addBendFor != null && r.addBendFor !== selectedEdgeId) r.armAddBend(null)
    if (r.bend != null && r.bend.edgeId !== selectedEdgeId) r.selectBend(null)
  }, [noEdit, selectedEdgeId])
  /** insert bend point `p` of `edgeId` into the span it lies on: one entry */
  const insertBend = useCallback((edgeId: string, p: { x: number; y: number }) => {
    const r = useRouteEditStore.getState()
    const g = useGraphStore.getState()
    const edge = g.edges.find((x) => x.id === edgeId)
    const route = currentRouteMap(g.nodes, g.edges).get(edgeId)
    if (!edge || !route) return
    const wps = (edge.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints ?? []
    const i = bendInsertIndex(route.points, wps, p)
    r.armAddBend(null) // one bend point per arming
    g.setEdgeRouting(edgeId, { route: 'orthogonal', waypoints: [...wps.slice(0, i), p, ...wps.slice(i)] })
    r.selectBend({ edgeId, index: i })
  }, [])
  useEffect(() => {
    if (addBendFor == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        useRouteEditStore.getState().armAddBend(null)
        return
      }
      if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.defaultPrevented || blocksCanvasKey(e.target)) return
      // Enter would otherwise press the focused Add bend button (disarming)
      e.preventDefault()
      e.stopPropagation()
      const g = useGraphStore.getState()
      const route = currentRouteMap(g.nodes, g.edges).get(addBendFor)
      const p = route ? keyboardBend(g.nodes, g.edges, addBendFor, route) : null
      if (p) {
        insertBend(addBendFor, p)
        return
      }
      const st = rfStore.getState() as unknown as { ariaLiveMessage?: string }
      if ('ariaLiveMessage' in st) rfStore.setState({ ariaLiveMessage: t('canvas.route.noBendRoom') } as never)
      useRouteEditStore.getState().setNotice('canvas.route.noBendRoom')
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [addBendFor, insertBend, rfStore, t])
  const onAddBendClick = useCallback(
    (e: React.MouseEvent, edge: LoopEdge) => {
      const r = useRouteEditStore.getState()
      if (r.addBendFor !== edge.id) return
      const g = useGraphStore.getState()
      const route = currentRouteMap(g.nodes, g.edges).get(edge.id)
      if (!route) return
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const p = bendAtClick(route.points, at, e.altKey)
      if (!p || bendRejection(g.nodes, g.edges, edge.id, p) !== null) {
        r.armAddBend(null)
        return
      }
      insertBend(edge.id, p)
    },
    [screenToFlowPosition, insertBend],
  )
  // A connection's LABEL beats another connection's line (Lumi, 2026-10-12).
  // The label chip takes no pointer of its own (§LGR4.1: a chip drawn over a
  // node must not swallow the node's click — nodes still win, they sit above
  // the lines), so a click on a chip lands on whatever line runs under it,
  // and where another connection's route crosses the chip that OTHER
  // connection got selected (measured on the Gacha Template: `e_pickup_29`'s
  // label over `e_pickup_35`'s line). Narrow rule, applied to a click that
  // reached a line: if the point is inside a visible label chip of a
  // different connection, the selection goes to the chip's connection.
  const onEdgeClick = useCallback(
    (e: React.MouseEvent, edge: LoopEdge) => {
      if (useRouteEditStore.getState().addBendFor != null && !noEdit) {
        onAddBendClick(e, edge)
        return
      }
      const target = e.target as Element | null
      if (!target?.closest('.react-flow__edge-interaction, .react-flow__edge-path')) return
      for (const chip of document.querySelectorAll<HTMLElement>('.edge-label:not(.edge-label--measure)')) {
        const r = chip.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue
        const id = chip.dataset.edgeId
        if (!id || id === edge.id) return
        // #390 — through `select` changes against the DOCUMENT's elements,
        // never React Flow's `setEdges` / `setNodes`: on this controlled flow
        // those send `replace` changes carrying the drawn copies (`facedEdges`'
        // `out@bottom` handle ids, a filter's `hidden`, Focus's class), which
        // `onEdgesChange` / `onNodesChange` wrote into the document — autosave,
        // export, the digest and the route map all moved on a selection click,
        // and under the edit lock the same click was refused instead.
        selectOnly({ edge: id })
        return
      }
    },
    [noEdit, onAddBendClick],
  )

  // §LGR6.6 — ONE owner for the destructive canvas keys. React Flow's built-in
  // handler is switched off (`deleteKeyCode={null}` below) because it (a)
  // defaults to `Backspace` ALONE, so `Delete` did nothing although our own
  // screen-reader text promised it (audit F1), (b) fires straight through an
  // open modal dialog (F3), and (c) knows nothing about frames. Priority:
  // selected nodes / edges first — exactly React Flow's own semantics, via
  // `deleteElements` so the connected-edge cascade is unchanged — otherwise the
  // selected frame (a saved one is an undoable delete, a suggested one is
  // dismissed, the same split the ✕ button already makes).
  useEffect(() => {
    if (noEdit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (e.defaultPrevented || blocksCanvasKey(e.target)) return
      const g = useGraphStore.getState()
      const nodesSel = g.nodes.filter((n) => n.selected)
      const edgesSel = g.edges.filter((x) => x.selected)
      if (nodesSel.length || edgesSel.length) {
        e.preventDefault()
        void deleteElements({ nodes: nodesSel, edges: edgesSel })
        return
      }
      const fid = useFrameStore.getState().selectedId
      if (!fid) return
      e.preventDefault()
      if (useFrameStore.getState().frames.some((f) => f.id === fid)) useFrameStore.getState().removeFrame(fid)
      else if (useAutoFrameStore.getState().autoFrames.some((f) => f.id === fid)) useAutoFrameStore.getState().dismissAuto(fid)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [noEdit, deleteElements])

  // §LGR6.7 — F2. React Flow moves a selected node with the arrow keys and
  // reports it as a `position` change with `dragging: false`; `onNodesChange`
  // only commits a `dragging: true`, so the move used to create NO history
  // entry — and the next Ctrl+Z then undid the PREVIOUS unrelated edit while
  // the position merely looked restored (audit 2026-09-20).
  //
  // The fix brackets React Flow's own movement with the same transaction the
  // frame gestures use, without touching the pointer path (which still commits
  // on its first `dragging: true`) and without reinterpreting `dragging: false`
  // (a pointer drag ends with one too, and so does React Flow's aborted-drag
  // restore — committing on that alone would double-count every drag).
  //
  // A capture-phase keydown runs BEFORE React Flow applies the move (measured),
  // which is what makes the pre-move snapshot possible. The transaction opens
  // only for an arrow aimed at a node React Flow will really move: the event
  // target inside a `.react-flow__node`, that node selected and draggable, no
  // text field, no modal, not locked / mobile. A frame, its resize handle and
  // any other button therefore never open one, even with a node still selected.
  useEffect(() => {
    if (noEdit) return
    type Pt = { x: number; y: number }
    type Origin = { snapshot: GestureSnapshot; positions: Record<string, Pt>; announceId: string }
    let open: Origin | null = null

    /** the nodes React Flow will move for an arrow aimed at `target`, or [] */
    const movableFor = (target: EventTarget | null): string[] => {
      const el = (target as HTMLElement | null)?.closest?.('.react-flow__node') as HTMLElement | null
      if (!el) return []
      const id = el.getAttribute('data-id')
      const g = useGraphStore.getState()
      // React Flow's own gate: the FOCUSED node must be selected and draggable
      const focused = g.nodes.find((n) => n.id === id)
      if (!focused?.selected || focused.draggable === false) return []
      // …and then it moves every selected, draggable node by the same delta
      return g.nodes.filter((n) => n.selected && n.draggable !== false).map((n) => n.id)
    }
    const changedFrom = (positions: Record<string, Pt>) => {
      const g = useGraphStore.getState()
      return Object.entries(positions).some(([id, p]) => {
        const n = g.nodes.find((x) => x.id === id)
        return !!n && (n.position.x !== p.x || n.position.y !== p.y)
      })
    }
    /** React Flow announces its own moves in its live region; a restore does not
     *  go through that path, so say the settled origin once, in the same place. */
    const announceRestore = (p: Pt) => {
      const st = rfStore.getState() as unknown as { ariaLiveMessage?: string }
      if (!('ariaLiveMessage' in st)) return // upstream renamed it — silently skip
      rfStore.setState({ ariaLiveMessage: t('rf.node.moveCancelled', { x: Math.round(p.x), y: Math.round(p.y) }) } as never)
    }

    const gesture = createKeyGesture((reason) => {
      const o = open
      open = null
      if (!o) return
      if (reason === 'cancel') {
        if (changedFrom(o.positions)) {
          useGraphStore.getState().applyGesturePositions(o.positions, {})
          announceRestore(o.positions[o.announceId])
        }
        return
      }
      if (changedFrom(o.positions)) useGraphStore.getState().pushGestureEntry(o.snapshot)
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!gesture.active) return // no gesture ⇒ React Flow's own deselect
        e.preventDefault()
        e.stopPropagation()
        gesture.end('cancel')
        return
      }
      if (!ARROW_KEYS.has(e.key) || blocksCanvasKey(e.target)) return
      const ids = movableFor(e.target)
      if (ids.length === 0) return
      if (!gesture.active) {
        const g = useGraphStore.getState()
        const positions: Record<string, Pt> = {}
        for (const id of ids) {
          const n = g.nodes.find((x) => x.id === id)
          if (n) positions[id] = { x: n.position.x, y: n.position.y }
        }
        open = { snapshot: g.captureGestureSnapshot(), positions, announceId: ids[0] }
      }
      gesture.press(e.key)
      // issue #344 §DL3 — the move itself: one grid step (Shift: four), the
      // focused node landing on the grid (left edge + port row) and every
      // selected node moved by the same delta. React Flow's own 5 / 20 px step
      // never runs (this capture listener is ahead of it).
      e.preventDefault()
      e.stopPropagation()
      const dir = ARROW_DIR[e.key]
      const g = useGraphStore.getState()
      const focusedId = (e.target as HTMLElement | null)?.closest?.('.react-flow__node')?.getAttribute('data-id')
      const anchor = g.nodes.find((n) => n.id === focusedId)
      if (!dir || !anchor) return
      const step = GRID * (e.shiftKey ? 4 : 1)
      const to = snapNodePosition({ x: anchor.position.x + dir[0] * step, y: anchor.position.y + dir[1] * step })
      const dx = to.x - anchor.position.x
      const dy = to.y - anchor.position.y
      const moved: Record<string, Pt> = {}
      for (const id of ids) {
        const n = g.nodes.find((x) => x.id === id)
        if (n) moved[id] = { x: n.position.x + dx, y: n.position.y + dy }
      }
      g.applyGesturePositions(moved, {})
      // §DL3.6 — the row and column it now sits on, briefly
      useGuideStore.getState().flash(keyMoveGuides(useGraphStore.getState().nodes, Object.keys(moved), anchor.id))
      // the announcement React Flow would have made for its own move
      const st = rfStore.getState() as unknown as { ariaLiveMessage?: string }
      if ('ariaLiveMessage' in st) {
        rfStore.setState({ ariaLiveMessage: t('rf.node.moved', { direction: t(RF_DIR_KEY[dir[2]] ?? 'rf.dir.right'), x: Math.round(to.x), y: Math.round(to.y) }) } as never)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (ARROW_KEYS.has(e.key)) gesture.release(e.key)
    }
    const onBlur = () => gesture.end('blur')
    const onVisibility = () => gesture.end('visibility')
    const onPointerDown = () => gesture.end('pointerdown')

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      gesture.end('blur') // never unmount with a transaction open
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [noEdit, rfStore, t])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // (2026-10: a bundled module dragged from the Insert-module menu was also
      // dropped here; that menu and its blocks are gone. A saved structure is
      // inserted from the File menu.)
      const kind = e.dataTransfer.getData(DND_TYPE) as NodeKind
      if (!kind) return
      addNodeAt(kind, at, { free: e.altKey }) // issue #344 §DL3 — on the grid; Alt = free
    },
    [addNodeAt, screenToFlowPosition],
  )

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  // docs/mobile.md §MV3a — structural editing is desktop-only. On mobile the
  // canvas is view + run: nodes don't move or connect, nothing deletes, the
  // browser context menu is suppressed. Selection stays on for the read-only
  // Inspector sheet.
  return (
    <div
      ref={canvasRef}
      className={`canvas${canvasLocked ? ' canvas--locked' : ''}${refInsertArmed ? ' canvas--ref-insert' : ''}${nodeStructure === 'outside' ? ' canvas--nodes-outside' : ''}`}
      data-tour="canvas"
      data-covered-by-sheets=""
      aria-busy={routesBusy || undefined}
      onDrop={noEdit ? undefined : handleDrop}
      onDragOver={noEdit ? undefined : handleDragOver}
      onContextMenu={noEdit ? (e) => e.preventDefault() : undefined}
      // a touch that starts on a port may draw a connection: hold its moves
      // until it ends, so the next tap is still a click (edges/connectTouchHold.ts).
      // A further finger that lands on another port while that finger is down
      // starts no second connection (it would end the first): its touchstart
      // stops here, before the port's handler. Any other multi-touch is as it was.
      onTouchStartCapture={noEdit ? undefined : (e) => {
        if (!(e.target as Element).closest?.('.react-flow__handle:not([data-off])')) return
        if (isFurtherTouchDuringHold(e.nativeEvent)) {
          e.stopPropagation()
          return
        }
        holdConnectTouch(e.nativeEvent)
      }}
    >
      <ReactFlow<LoopNode, LoopEdge>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        // issue #344 §DL3 — which node a drag grabbed and whether Alt is held
        // (Alt = free move); the store snaps the drag by that node's correction.
        // §ER14.5 — while it lasts only the routes the moved nodes touch are
        // routed again; the drop builds one full generation
        onNodeDragStart={(e, node, dragged) => { dragSnap.begin(node.id, e.altKey, dragged.map((n) => n.id), useGraphStore.getState().nodes, getViewport().zoom); beginLiveLayout() }}
        onNodeDrag={(e) => dragSnap.update(e.altKey)}
        onNodeDragStop={(e) => { dragSnap.update(e.altKey); dragSnap.end(); useGuideStore.getState().clear(); endLiveLayout() }}
        onSelectionDragStart={(e, dragged) => { dragSnap.begin(dragged[0]?.id ?? null, e.altKey, dragged.map((n) => n.id), useGraphStore.getState().nodes, getViewport().zoom); beginLiveLayout() }}
        onSelectionDrag={(e) => dragSnap.update(e.altKey)}
        onSelectionDragStop={(e) => { dragSnap.update(e.altKey); dragSnap.end(); useGuideStore.getState().clear(); endLiveLayout() }}
        onEdgesChange={onEdgesChange}
        // the workbench, direction B (src/model/connectKind.ts): a drawing takes
        // the kind chosen in the tool row; the same check that refuses it in
        // the store tells React Flow which drops are valid, and a refused drop
        // says its reason (the status bar) instead of becoming another kind
        onConnect={noEdit ? undefined : (c) => {
          const v = onConnect(c, useUiStore.getState().connectKind)
          useUiStore.getState().setConnectRefusal(v.ok ? null : { verdict: v, source: c.source, target: c.target })
        }}
        isValidConnection={(c) => {
          if (!c.source || !c.target) return false
          const g = useGraphStore.getState()
          return connectVerdict(g.nodes, g.edges, useUiStore.getState().connectKind, { source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle }).ok
        }}
        onConnectEnd={(_e, state) => {
          releaseConnectTouch()
          // a drop ON a node that the kind refuses: say why (nothing is made)
          const from = state.fromNode?.id
          const to = state.toNode?.id
          if (state.isValid || !from || !to) return
          const g = useGraphStore.getState()
          const fromIsSource = state.fromHandle?.type !== 'target'
          const ends = fromIsSource
            ? { source: from, target: to, sourceHandle: state.fromHandle?.id ?? null, targetHandle: state.toHandle?.id ?? null }
            : { source: to, target: from, sourceHandle: state.toHandle?.id ?? null, targetHandle: state.fromHandle?.id ?? null }
          const v = connectVerdict(g.nodes, g.edges, useUiStore.getState().connectKind, ends)
          useUiStore.getState().setConnectRefusal(v.ok ? null : { verdict: v, source: ends.source, target: ends.target })
        }}
        onSelectionChange={onSelectionChange}
        // §RXA8 — while armed, freeze selection (the edited Register stays
        // selected), node dragging, and node focus (so the caret returns to the
        // expression input after a pick); a click still fires `onNodeClick`
        elementsSelectable={!refInsertArmed}
        nodesFocusable={!refInsertArmed}
        nodesDraggable={!noEdit && !panSurfaceActive && !refInsertArmed}
        nodesConnectable={!noEdit && !refInsertArmed}
        edgesReconnectable={!noEdit}
        onNodeClick={refInsertArmed ? (_e, n) => onArmedNodeClick(n.id) : undefined}
        onEdgeClick={onEdgeClick}
        onEdgeMouseEnter={nodeStructure === 'outside' ? (_e, edge) => setHoverEdgeId(edge.id) : undefined}
        onEdgeMouseLeave={nodeStructure === 'outside' ? () => setHoverEdgeId(null) : undefined}
        zoomOnDoubleClick={!isMobile && !framePropsOpen}
        zoomOnScroll={!framePropsOpen}
        zoomOnPinch={!framePropsOpen}
        deleteKeyCode={null} /* §LGR6.6 — owned by the effect above */
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        ariaLabelConfig={ariaLabelConfig}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={zoomFloor}
        maxZoom={MAX_ZOOM}
        // §LGR6 — while the Frame tool is armed, a pane drag draws a frame
        // instead of panning the canvas. §LGR12 — while region select is armed,
        // a pane drag rubber-bands a selection box instead. With both off,
        // `panOnDrag` is `true`, exactly as before either tool existed.
        // §FC10 adds the third: while the properties popover is open the canvas
        // holds still. A press outside dismisses it, and that dismissing press
        // must not also pan — the popover defers its own close by a task so
        // this stays false for the whole gesture. A wheel does not dismiss at
        // all, so scroll-zoom simply stays off until the popover is gone.
        panOnDrag={!frameToolArmed && !regionSelectArmed && !framePropsOpen}
        selectionOnDrag={regionSelectArmed}
        onSelectionStart={() => {
          selectionBeforeBox.current = {
            nodes: nodes.filter((n) => n.selected).map((n) => n.id),
            edges: edges.filter((x) => x.selected).map((x) => x.id),
          }
        }}
        // §LGR12 — one shot: releasing the box confirms the selection and puts
        // the canvas back to plain panning.
        onSelectionEnd={() => {
          selectionBeforeBox.current = null
          disarmRegionSelect()
        }}
        onPaneClick={() => {
          if (useUiStore.getState().refInsert) disarmRefInsert()
          selectFrame(null)
          // a click with no drag clears the selection (React Flow's own
          // behaviour) — the tool is spent either way.
          disarmRegionSelect()
        }}
      >
        {/* docs/dense-graph-pan.md — the pan-capture overlay. A child of
            <ReactFlow> so it sits inside the `.react-flow` stacking context:
            above the node / edge renderer (equal z-index, later in the DOM),
            below every `.react-flow__panel` (Controls / hints, z 5)
            so those stay clickable while Pan mode is on. `pointer-events` only
            while active — edit gestures are untouched otherwise. Fed the
            connected `setViewport` / `getViewport` from this component, and
            the same zoom clamp <ReactFlow> uses so its own pinch-zoom math
            (real-device pinch showed React Flow's own never actually ran with
            the overlay capturing the first finger) can't exceed it. */}
        <PanSurface
          active={panSurfaceActive}
          setViewport={setViewport}
          getViewport={getViewport}
          minZoom={zoomFloor}
          maxZoom={MAX_ZOOM}
        />
        <EdgeMarkers />
        <LodGrid />
        {/* docs/large-graph-readability.md §LGR6 — transient group frames
            (behind the nodes) + their interactive chrome. Render / UI-only. */}
        <FrameLayer />
        {/* docs/diagram-layout.md §DL3.6 — the smart guides of a node drag */}
        <SmartGuideLayer />
        {/* docs/large-graph-readability.md §LGR12.3 — the "N nodes selected"
            readout is NOT a canvas panel: desktop → DesktopInspector (the right
            column, directly above the Inspector), mobile → MobileInspectorSheet
            (two or more selected only). Measured, a bottom-centre Panel here
            covered the top of the bottom node row at L0. */}
        {/* docs/large-graph-readability.md §LGR2.1 — Focus is armed but no node
            is selected yet, so nothing on the canvas has changed. Tell the user
            the mode is on and waiting. Never takes the pointer. */}
        {focusMode && !focusSet && (
          <Panel position="top-center" className="lgr-focus-hint" dir={uiDir}>
            {t('canvas.focus.hint')}
          </Panel>
        )}
        {/* docs/…-auto-frames.md §AF9.2 — while suggested frames are on screen,
            a one-line note that they are STRUCTURAL, not domain regions. Never
            takes the pointer. */}
        {/* the two tier-1 hint notes render into the notice rail on desktop
            (src/ui/noticeRail.tsx), a top-centre Panel on the phone */}
        {importHintShowing && lastImportBatch && (
          <RailOrPanel className="hint-note" role="note">
            <span dir={uiDir}>
              {t('hint.importFirstCommit.body', {
                n: lastImportBatch.count,
                tables: lastImportBatch.tables.map((l) => `"${isolateAuto(l)}"`).join(', '),
              })}
            </span>
            <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={importHint.close}>
              <Icon name="close" />
            </button>
          </RailOrPanel>
        )}
        {frameMoveHintShowing && (
          <RailOrPanel className="hint-note" role="note">
            <span dir={uiDir}>{t('hint.frameMove.body')}</span>
            <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={frameMoveHint.close}>
              <Icon name="close" />
            </button>
          </RailOrPanel>
        )}
        {autoFramesExist && !suggestNoteDismissed && !importHintShowing && !frameMoveHintShowing && (
          <Panel position="top-center" className="lgr-suggest-note">
            <span dir={uiDir}>{t('canvas.frame.suggestNote')}</span>
            <button
              type="button"
              className="lgr-suggest-note__x"
              aria-label={t('canvas.frame.suggestNoteDismiss')}
              onClick={() => setSuggestNoteDismissed(true)}
            >
              <Icon name="close" />
            </button>
          </Panel>
        )}
        {/* docs/contextual-inline-help.md #1 — a genuinely empty canvas, the
            first thing a new/blank graph shows and the one situation no
            first-run tour step could demonstrate (nothing existed on the
            canvas yet when the tour ran). Desktop only (§CIH6) —
            `MobileOpenFileHint` already owns this moment on mobile. */}
        {!isMobile && (
          <CanvasHintNote
            dir={uiDir}
            id="empty-canvas"
            trigger={nodes.length === 0}
            ready={tourIdle && tier3Ready && !lgrNoticeShowing}
          >
            {t('hint.emptyCanvas.body')}
          </CanvasHintNote>
        )}
        {/* docs/contextual-inline-help.md #4 — Focus / Filter discovery once a
            graph is dense enough (WORTH_IT_FLOOR) that they'd actually help.
            Waits for the tour + its cooldown, a real interaction or the
            fallback delay, and yields the slot to a tier-2 LGR notice
            (§CIH2.3a / §CIH3 #4) — otherwise a freshly-opened large Template
            would show this at the exact same instant as the auto-frame
            suggestion. Clears itself the moment Focus or Filter is actually
            used, and stays cleared even if it was used-then-off before the
            hint ever got a chance to show (`focusOrFilterEverUsed`, latched
            above — not the current on/off state). */}
        {!isMobile && (
          <CanvasHintNote
            dir={uiDir}
            id="focus-filter-discovery"
            trigger={nodes.length >= WORTH_IT_FLOOR && !focusOrFilterEverUsed}
            ready={tourIdle && tier3Ready && largeGraphInteractionGate && !lgrNoticeShowing}
          >
            {t('hint.focusFilter.body')}
          </CanvasHintNote>
        )}
        {/* docs/large-graph-readability.md §LGR3.2 — the transient-filter panel,
            desktop only (mobile controls live in the More sheet, §LGR9). */}
        {!isMobile && filterPanelOpen && <FilterPanel />}
        {/* our own edit-lock replaces React Flow's "interactive" toggle, which
            also kills selection (so the Inspector can't open). `canvasLocked`
            keeps selection + a read-only Inspector; it only blocks structural
            edits. Hidden on mobile — the mobile layout is always view-only. */}
        {/* the workbench (2026-10, step 5): on the desktop every control of
            this rail has its place in the tool row, the menus and the status
            bar (share workbench-mapping.md); the phone keeps the rail (zoom
            and Reset view, its only buttons there) */}
        {isMobile ? (
        <Controls showInteractive={false} showFitView={false}>
          {/* docs/large-graph-readability.md §LGR3.4 / LGR-D4 — Reset view:
              fit the graph + clear the exploration lens (filters + focused
              node). Replaces React Flow's plain fit-view button. */}
          <ControlButton
            onClick={resetView}
            title={t('canvas.resetView')}
            aria-label={t('canvas.resetView')}
            className="rf-resetview"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </ControlButton>
          {/* docs/large-graph-readability.md §LGR2.1 / §LGR9 — the Focus toggle.
              A global UI preference (uiStore, persisted), default off. Desktop:
              here in the canvas controls. Mobile: in the More sheet
              (MobileMoreMenu), not here. */}
          {!isMobile && (
            <ControlButton
              onClick={toggleFocusMode}
              title={focusMode ? t('canvas.focus.off') : t('canvas.focus.on')}
              aria-label={focusMode ? t('canvas.focus.off') : t('canvas.focus.on')}
              aria-pressed={focusMode}
              className="rf-focus"
            >
              <Icon name="focus" size={14} />
            </ControlButton>
          )}
          {/* docs/large-graph-readability.md §LGR3.2 / §LGR9 — the Filters
              toggle (desktop). Opens / closes the panel; the open state is a
              sticky preference. Mobile: the More sheet. */}
          {!isMobile && (
            <ControlButton
              onClick={toggleFilterPanel}
              title={filterPanelOpen ? t('canvas.filter.close') : t('canvas.filter.open')}
              aria-label={filterPanelOpen ? t('canvas.filter.close') : t('canvas.filter.open')}
              aria-pressed={filterPanelOpen}
              className="rf-filter"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M2 3h12l-4.6 5.6v4L6.6 14V8.6z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </ControlButton>
          )}
          {/* docs/large-graph-readability.md §LGR12 — the one-shot "select a
              region" tool (desktop only, like the Frame tool: on mobile the pan
              surface owns the drag gesture). Armed ⇒ a pane drag rubber-bands a
              selection box; releasing it confirms and disarms. Shift-drag keeps
              working unchanged — this is the discoverable way in, not a
              replacement. Selection only: never in the GraphDoc / undo, and
              allowed under the edit-lock because selecting is already a
              read-only action there (§EM13.8). */}
          {!isMobile && (
            <ControlButton
              onClick={toggleRegionSelect}
              title={regionSelectArmed ? t('canvas.regionSelect.on') : t('canvas.regionSelect.off')}
              aria-label={regionSelectArmed ? t('canvas.regionSelect.on') : t('canvas.regionSelect.off')}
              aria-pressed={regionSelectArmed}
              className="rf-regionselect"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect
                  x="2.5"
                  y="2.5"
                  width="11"
                  height="11"
                  rx="1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeDasharray="2.6 2"
                />
                <circle cx="6" cy="6.5" r="1.5" fill="currentColor" />
                <circle cx="10" cy="10" r="1.5" fill="currentColor" />
              </svg>
            </ControlButton>
          )}
          {/* docs/large-graph-readability.md §LGR6 — the one-shot "draw a group
              frame" tool (desktop only; frame drawing is not on mobile, §LGR9).
              Armed ⇒ a pane drag rubber-bands a labelled rectangle behind the
              nodes. Transient, session-only, never in the GraphDoc / undo.
              #338 — while the canvas is locked it stays in place, `disabled`
              (a saved frame is document content, #334), so the rail keeps its
              height; locking also turns an armed tool off (store/editPolicy). */}
          {!isMobile && (
            <ControlButton
              onClick={() => (frameToolArmed ? disarmFrameTool() : armFrameTool())}
              title={frameToolArmed ? t('canvas.frame.drawing') : t('canvas.frame.draw')}
              aria-label={frameToolArmed ? t('canvas.frame.drawing') : t('canvas.frame.draw')}
              aria-pressed={frameToolArmed}
              disabled={canvasLocked}
              className="rf-frame"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect
                  x="2.5"
                  y="3.5"
                  width="11"
                  height="9"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeDasharray="2.4 2"
                />
              </svg>
            </ControlButton>
          )}
          {/* issue #344 §DL2.10 — Tidy to grid: re-place the document on the
              grid by the conversion's own rules, as ONE undo step. Desktop
              only (the phone does not edit); `disabled` while locked, never
              removed, so the rail keeps its height (#338). */}
          {!isMobile && (
            <ControlButton
              onClick={() => tidyToGrid()}
              title={t('canvas.tidy')}
              aria-label={t('canvas.tidy')}
              disabled={canvasLocked}
              className="rf-tidy"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </ControlButton>
          )}
          {/* docs/…-auto-frames.md §AF4.1 — "Suggest frames": an EXPLICIT
              action (P1). Never runs on a sim / Activity / Focus / Filter
              change or on a graph edit. `is-stale` = the structure or a node
              moved since the last Suggest (§AF4.3) — a hint, still no
              auto-recompute. */}
          {!isMobile && (suggestEligible || autoFramesExist) && (
            <ControlButton
              onClick={() => suggestFrames()}
              title={suggestStale ? t('canvas.frame.suggestStale') : t('canvas.frame.suggest')}
              aria-label={suggestStale ? t('canvas.frame.suggestStale') : t('canvas.frame.suggest')}
              className={`rf-suggest${suggestStale ? ' is-stale' : ''}`}
              data-stale={suggestStale ? '' : undefined}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect x="1.5" y="2.5" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.6 1.4" />
                <rect x="8.5" y="8.5" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.6 1.4" />
              </svg>
            </ControlButton>
          )}
          {/* §AF5 R4 — the DEFAULT clear removes BOTH kinds ("Clear all frames").
              Shown when either a manual or an auto frame exists. #338 —
              `disabled` while the canvas is locked, never removed. */}
          {!isMobile && (framesExist || autoFramesExist) && (
            <ControlButton
              onClick={() => {
                clearFrames()
                clearAutoFrames()
              }}
              title={t('canvas.frame.clearAll')}
              aria-label={t('canvas.frame.clearAll')}
              disabled={canvasLocked}
              className="rf-frame-clear"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </ControlButton>
          )}
          {/* §AF5 R4 — the auxiliary "Clear suggested frames": only the derived
              auto set, keeps every manual frame. Shown only when auto frames
              exist. */}
          {!isMobile && autoFramesExist && (
            <ControlButton
              onClick={() => clearAutoFrames()}
              title={t('canvas.frame.clearSuggested')}
              aria-label={t('canvas.frame.clearSuggested')}
              className="rf-suggest-clear"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.8" />
                <path d="M6 6l4 4M10 6l-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </ControlButton>
          )}
          {/* docs/large-graph-readability.md §LGR6-cues — the opt-in Activity
              overlay toggle (a sticky global pref, default off). */}
          {!isMobile && (
            <ControlButton
              onClick={toggleActivityOverlay}
              title={activityOverlay ? t('canvas.activity.on') : t('canvas.activity.off')}
              aria-label={activityOverlay ? t('canvas.activity.on') : t('canvas.activity.off')}
              aria-pressed={activityOverlay}
              className="rf-activity"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M1 9h3l2-5 3 8 2-4h4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </ControlButton>
          )}
          {!isMobile && (
            <ControlButton
              onClick={toggleCanvasLocked}
              // #335 — a toggle: the NAME is fixed ("Edit lock"), `aria-pressed`
              // carries the state, and the tooltip names the next action
              title={canvasLocked ? t('canvas.lock.unlock') : t('canvas.lock.lock')}
              aria-label={t('canvas.lock.name')}
              aria-pressed={canvasLocked}
              className="rf-lock"
            >
              <Icon name={canvasLocked ? 'lock' : 'unlock'} size={14} />
            </ControlButton>
          )}
          {/* docs/dense-graph-pan.md — desktop Pan mode. Session-only; not on
              mobile (mobile is always effectively panning). */}
          {!isMobile && (
            <ControlButton
              onClick={togglePanMode}
              title={panMode ? t('canvas.panMode.on') : t('canvas.panMode.off')}
              aria-label={t('canvas.panMode.rowLabel')}
              aria-pressed={panMode}
              className="rf-panmode"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M8 1.5v13M1.5 8h13M8 1.5 5.6 4M8 1.5 10.4 4M8 14.5 5.6 12M8 14.5 10.4 12M1.5 8 4 5.6M1.5 8 4 10.4M14.5 8 12 5.6M14.5 8 12 10.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </ControlButton>
          )}
        </Controls>
        ) : null}
      </ReactFlow>
    </div>
  )
}
