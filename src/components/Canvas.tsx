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
import { useGraphStore } from '../store/graphStore'
import { BUNDLED_MODULES, cloneModuleDoc } from '../model/modules'
import { refInsertVerdict, type RefResolveKind } from '../model/exprRefs'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { useI18n, useT, type MessageKey } from '../i18n'
import { moduleLabelOverlay } from '../i18n/moduleLabels'
import { useFilterStore } from '../store/filterStore'
import { nodeTypes } from './nodes/nodes'
import { edgeTypes } from './edges/LoopEdge'
import { EdgeMarkers } from './edges/EdgeMarkers'
import { useFocusSet } from './focusSet'
import { useHiddenSet } from './filterSet'
import { FilterPanel } from './FilterPanel'
import { FrameLayer } from './frames/FrameLayer'
import { PanSurface } from './PanSurface'
import { useFrameStore, hasFrames } from '../store/frameStore'
import { useAutoFrameStore, hasAutoFrames, autoFramesStale } from '../store/autoFrameStore'
import { WORTH_IT_FLOOR } from './frames/autoFrames'
import { CanvasHintNote, useHintEligible } from './HintNote'
import { canvasFitInsets, viewportForRect } from './canvasFit'
import { MinimapDock } from './MinimapDock'
import { useHintStore, useTier3Ready, useLargeGraphInteractionGate } from '../store/hintStore'
import { useTourStore } from '../store/tourStore'

// docs/large-graph-readability.md §LGR3.1 — the class the CSS fades on an
// out-of-focus node / edge. It fades only the body / silhouette / label; the
// §VL7.1 required set (rings, invalid flag, run cues) is left full-strength.
const DEEMPH_CLASS = 'lgr-deemph'
const withDeemph = (base: string | undefined): string =>
  base ? `${base} ${DEEMPH_CLASS}` : DEEMPH_CLASS

const DND_TYPE = 'application/loop-node'
// docs/module-system.md §MS3.2 — a Building block dragged from the Insert-module
// menu (kept in sync with `ModuleMenu.tsx`, mirroring the `DND_TYPE` duplication
// between this file and `Toolbar.tsx`).
const MODULE_DND_TYPE = 'application/loop-module'

// the <ReactFlow> zoom clamp — shared with PanSurface's own pinch-zoom math
// (docs/dense-graph-pan.md) so a pinch can never take the viewport past what
// the Controls +/- or wheel-zoom would allow.
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2

// React Flow's `StoreUpdater` syncs a fixed list of props into its own store and
// compares each with `===`. `Canvas` re-renders on every pointer move of a node
// drag (it feeds `nodes` to React Flow), so a fresh object literal in one of
// those props writes to the store on every move — and `defaultEdgeOptions` in
// particular is read by EVERY `EdgeWrapper` with default equality, which
// re-renders every edge. These two never change, so they are hoisted; the
// translated `ariaLabelConfig` is memoized at its use site instead.
const DEFAULT_EDGE_OPTIONS = { type: 'loop' } as const
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1.2 } as const

// docs/visual-language.md §VL7.2 — "Grid fades out entering L1". The dot grid is
// a scan aid for the detail view only; below the L2 threshold it is dropped so
// the map view stays clean. Pure function of zoom — a threshold round-trip
// restores it exactly (no hysteresis).
function LodGrid() {
  const showGrid = useStore((s) => s.transform[2] >= 0.8)
  return showGrid ? <Background gap={16} color="var(--line-hairline)" /> : null
}

export function Canvas() {
  // docs/contextual-inline-help.md §CIH3 #4 — the `.canvas` element, for a
  // one-shot "did the user ever touch this" interaction listener.
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const insertModule = useGraphStore((s) => s.insertModule)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { screenToFlowPosition, fitView, setViewport, getViewport } = useReactFlow()
  const rfStore = useStoreApi()
  const isMobile = useIsMobile()
  const canvasLocked = useUiStore((s) => s.canvasLocked)
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

  // docs/mobile.md §MV-D10 / docs/mmo-multilingual-layout.md §MML3 — the minimap
  // (a fixed ~202×152 overlay) only earns its space on a canvas large enough to
  // want an overview. Below this it is hidden (like on mobile), so a small
  // desktop window / split view is not two-thirds minimap.
  const minimapFits = !isMobile && paneW >= 640 && paneH >= 380
  // the user can collapse the minimap (persisted); `minimapVisible` is whether
  // it is ACTUALLY on screen right now — the value `applyInitialView` reserves
  // space for. Read through a ref inside the callback so a collapse / expand
  // never changes `applyInitialView`'s identity and so cannot re-run the
  // (untouched) §MML1 fit / measurement-settle effect.
  const minimapCollapsed = useUiStore((s) => s.minimapCollapsed)
  const minimapVisible = minimapFits && !minimapCollapsed
  const minimapVisibleRef = useRef(minimapVisible)
  minimapVisibleRef.current = minimapVisible
  // DEV / E2E only — the last `applyInitialView` result, so a test can assert
  // whether the minimap inset was reserved. Tree-shaken from the production /
  // portable bundle with the rest of `import.meta.env.DEV`.
  const lastInitialViewRef = useRef<{ insetR: number; insetB: number; zoom: number } | null>(null)

  // §MML3 — a menu-opened Template can carry a fixed graph-coordinate `rect` to
  // frame instead of fit-all. Fit `rect` into the pane MINUS the fixed overlays
  // (the minimap — only when it is actually visible; the zoom Controls, ~44
  // wide on the left), so the framed nodes never sit under the minimap.
  // Left-align `rect` horizontally (a progression graph reads beginning-first);
  // centre it vertically, or top-align when it is taller than the usable
  // height. Clamp the zoom to `[minZoom, 1.2]`. Pure function of the rect + pane
  // size — identical for every UI language, and unchanged on a language switch
  // (this only runs on a `fitRev` swap).
  const applyInitialView = useCallback(
    (iv: { rect: { x: number; y: number; width: number; height: number }; minZoom: number }) => {
      // the computation itself lives in `canvasFit.ts` (shared with the
      // import wizard's post-commit view, docs/data-import.md §DI17); the
      // insets are this Canvas's own overlays.
      const insets = canvasFitInsets(minimapVisibleRef.current)
      const vp = viewportForRect(iv.rect, { width: paneW, height: paneH }, insets, { floor: iv.minZoom, ceil: 1.2 })
      if (!vp) return void fitView({ padding: 0.3, maxZoom: 1.2 })
      setViewport(vp, { duration: 0 })
      if (import.meta.env.DEV) lastInitialViewRef.current = { insetR: insets.right, insetB: insets.bottom, zoom: vp.zoom }
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
    else void fitView({ padding: 0.3, maxZoom: 1.2 })
  }, [fitRev, loadRev, nodesInitialized, measuredSig, settleTick, fitView, getViewport])

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
  const rfEdges = useMemo(() => {
    if (!hidden && !focusSet) return edges
    return edges.map((e) => {
      if (hidden?.edges.has(e.id)) return { ...e, hidden: true }
      if (focusSet && !focusSet.edges.has(e.id)) return { ...e, className: withDeemph(e.className) }
      return e
    })
  }, [edges, hidden, focusSet])

  // docs/large-graph-readability.md §LGR3.4 / LGR-D4 — Reset view: one UI-only
  // action that fits the graph and clears the exploration lens (filter
  // selections + the focused node). The Focus *mode* on/off preference is left
  // alone, and nothing touches the GraphDoc / digest / undo.
  const resetView = useCallback(() => {
    useFilterStore.getState().clear()
    setSelection(null, null)
    void fitView({ padding: 0.3, maxZoom: 1.2 })
  }, [setSelection, fitView])

  // structural editing is off on mobile (docs/mobile.md §MV3a) OR when the
  // desktop Canvas is edit-locked (uiStore.canvasLocked). Selection, pan / zoom,
  // the minimap, the Timeline and the sim are unaffected either way.
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

  // never leave the tool armed across a context it cannot apply to: the Frame
  // tool taking over, Pan mode coming on, or the layout turning mobile.
  useEffect(() => {
    if (regionSelectArmed && (frameToolArmed || panMode || isMobile)) disarmRegionSelect()
  }, [regionSelectArmed, frameToolArmed, panMode, isMobile, disarmRegionSelect])

  // React Flow's built-in a11y strings (Controls buttons, the keyboard hints on
  // nodes / edges, the handle label) — localized via the one config prop
  // (docs/localization.md Slice 2b). The MiniMap keeps its explicit `ariaLabel`.
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
    'minimap.ariaLabel': t('canvas.minimap'),
    'handle.ariaLabel': t('rf.handle.label'),
    'node.a11yDescription.default': t('rf.node.a11y'),
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
      w.__loop.rf = { setViewport, getViewport, fitView }
      // the last `applyInitialView` result — lets an e2e assert the minimap
      // inset was / was not reserved on a menu-open framing (ux/minimap-collapse)
      w.__loop.canvas = { lastInitialView: () => lastInitialViewRef.current }
    }
  }, [setViewport, getViewport, fitView])

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
        void fitView({ padding: 0.3, maxZoom: 1.2 })
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

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // docs/module-system.md §MS3.2 — a bundled Building block dragged from the
      // Insert-module menu drops at the pointer. Blocks are v1 + self-contained,
      // so no consent / notice path is reachable here; a validation refusal
      // (never expected for a bundled block) just alerts.
      const moduleId = e.dataTransfer.getData(MODULE_DND_TYPE)
      if (moduleId) {
        const block = BUNDLED_MODULES.find((m) => m.id === moduleId)
        if (block) {
          const locale = useI18n.getState().activeLocale
          const r = insertModule(cloneModuleDoc(block, moduleLabelOverlay(moduleId, locale)), {
            at,
            bundledModuleId: moduleId,
          })
          if (!r.ok) window.alert(r.reason)
        }
        return
      }
      const kind = e.dataTransfer.getData(DND_TYPE) as NodeKind
      if (!kind) return
      addNodeAt(kind, at)
    },
    [addNodeAt, insertModule, screenToFlowPosition],
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
      className={`canvas${canvasLocked ? ' canvas--locked' : ''}${refInsertArmed ? ' canvas--ref-insert' : ''}`}
      data-tour="canvas"
      onDrop={noEdit ? undefined : handleDrop}
      onDragOver={noEdit ? undefined : handleDragOver}
      onContextMenu={noEdit ? (e) => e.preventDefault() : undefined}
    >
      <ReactFlow<LoopNode, LoopEdge>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={noEdit ? undefined : onConnect}
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
        zoomOnDoubleClick={!isMobile}
        deleteKeyCode={noEdit ? null : undefined}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        ariaLabelConfig={ariaLabelConfig}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // §LGR6 — while the Frame tool is armed, a pane drag draws a frame
        // instead of panning the canvas. §LGR12 — while region select is armed,
        // a pane drag rubber-bands a selection box instead. With both off,
        // `panOnDrag` is `true`, exactly as before either tool existed.
        panOnDrag={!frameToolArmed && !regionSelectArmed}
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
            below every `.react-flow__panel` (Controls / MiniMap / hints, z 5)
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
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        />
        <EdgeMarkers />
        <LodGrid />
        {/* docs/large-graph-readability.md §LGR6 — transient group frames
            (behind the nodes) + their interactive chrome. Render / UI-only. */}
        <FrameLayer />
        {/* docs/large-graph-readability.md §LGR12.3 — the "N nodes selected"
            readout is NOT a canvas panel: desktop → DesktopInspector (the right
            column, directly above the Inspector), mobile → MobileInspectorSheet
            (two or more selected only). Measured, a bottom-centre Panel here
            covered the top of the bottom node row at L0. */}
        {/* docs/large-graph-readability.md §LGR2.1 — Focus is armed but no node
            is selected yet, so nothing on the canvas has changed. Tell the user
            the mode is on and waiting. Never takes the pointer. */}
        {focusMode && !focusSet && (
          <Panel position="top-center" className="lgr-focus-hint">
            {t('canvas.focus.hint')}
          </Panel>
        )}
        {/* docs/…-auto-frames.md §AF9.2 — while suggested frames are on screen,
            a one-line note that they are STRUCTURAL, not domain regions. Never
            takes the pointer. */}
        {importHintShowing && lastImportBatch && (
          <Panel position="top-center" className="hint-note" role="note">
            <span>
              {t('hint.importFirstCommit.body', {
                n: lastImportBatch.count,
                tables: lastImportBatch.tables.map((l) => `"${l}"`).join(', '),
              })}
            </span>
            <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={importHint.close}>
              ✕
            </button>
          </Panel>
        )}
        {frameMoveHintShowing && (
          <Panel position="top-center" className="hint-note" role="note">
            <span>{t('hint.frameMove.body')}</span>
            <button type="button" className="hint-note__x" aria-label={t('hint.close')} onClick={frameMoveHint.close}>
              ✕
            </button>
          </Panel>
        )}
        {autoFramesExist && !suggestNoteDismissed && !importHintShowing && !frameMoveHintShowing && (
          <Panel position="top-center" className="lgr-suggest-note">
            <span>{t('canvas.frame.suggestNote')}</span>
            <button
              type="button"
              className="lgr-suggest-note__x"
              aria-label={t('canvas.frame.suggestNoteDismiss')}
              onClick={() => setSuggestNoteDismissed(true)}
            >
              ✕
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
        {/* docs/mobile.md §MV3 / §MV-D10: the minimap is too small to help on a
            phone (or a small desktop window — see `minimapFits`) and eats
            space — not docked there. When it IS docked the user can collapse it
            to a single restore button (MinimapDock, persisted). */}
        {minimapFits && <MinimapDock />}
        {/* our own edit-lock replaces React Flow's "interactive" toggle, which
            also kills selection (so the Inspector can't open). `canvasLocked`
            keeps selection + a read-only Inspector; it only blocks structural
            edits. Hidden on mobile — the mobile layout is always view-only. */}
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
              ⌖
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
              nodes. Transient, session-only, never in the GraphDoc / undo. */}
          {!isMobile && !canvasLocked && (
            <ControlButton
              onClick={() => (frameToolArmed ? disarmFrameTool() : armFrameTool())}
              title={frameToolArmed ? t('canvas.frame.drawing') : t('canvas.frame.draw')}
              aria-label={frameToolArmed ? t('canvas.frame.drawing') : t('canvas.frame.draw')}
              aria-pressed={frameToolArmed}
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
              Shown when either a manual or an auto frame exists. */}
          {!isMobile && !canvasLocked && (framesExist || autoFramesExist) && (
            <ControlButton
              onClick={() => {
                clearFrames()
                clearAutoFrames()
              }}
              title={t('canvas.frame.clearAll')}
              aria-label={t('canvas.frame.clearAll')}
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
              title={canvasLocked ? t('canvas.lock.unlock') : t('canvas.lock.lock')}
              aria-label={canvasLocked ? t('canvas.lock.unlock') : t('canvas.lock.lock')}
              aria-pressed={canvasLocked}
              className="rf-lock"
            >
              {canvasLocked ? '🔒' : '🔓'}
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
      </ReactFlow>
    </div>
  )
}
