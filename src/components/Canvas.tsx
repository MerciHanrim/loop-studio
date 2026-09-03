import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DragEvent } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { useT } from '../i18n'
import { useFilterStore } from '../store/filterStore'
import { nodeTypes } from './nodes/nodes'
import { edgeTypes } from './edges/LoopEdge'
import { EdgeMarkers } from './edges/EdgeMarkers'
import { useFocusSet } from './focusSet'
import { useHiddenSet } from './filterSet'
import { FilterPanel } from './FilterPanel'
import { FrameLayer } from './frames/FrameLayer'
import { useFrameStore, hasFrames } from '../store/frameStore'

// docs/large-graph-readability.md §LGR3.1 — the class the CSS fades on an
// out-of-focus node / edge. It fades only the body / silhouette / label; the
// §VL7.1 required set (rings, invalid flag, run cues) is left full-strength.
const DEEMPH_CLASS = 'lgr-deemph'
const withDeemph = (base: string | undefined): string =>
  base ? `${base} ${DEEMPH_CLASS}` : DEEMPH_CLASS

const DND_TYPE = 'application/loop-node'

// docs/visual-language.md §VL7.2 — "Grid fades out entering L1". The dot grid is
// a scan aid for the detail view only; below the L2 threshold it is dropped so
// the map view stays clean. Pure function of zoom — a threshold round-trip
// restores it exactly (no hysteresis).
function LodGrid() {
  const showGrid = useStore((s) => s.transform[2] >= 0.8)
  return showGrid ? <Background gap={16} color="var(--line-hairline)" /> : null
}

// minimap node fill by kind — resolved from the theme tokens (var() in an inline
// style property stays theme-reactive)
const MINIMAP_HUE: Record<NodeKind, string> = {
  pool: 'var(--hue-pool)',
  source: 'var(--hue-source)',
  drain: 'var(--hue-drain)',
  gate: 'var(--hue-gate)',
  converter: 'var(--hue-converter)',
  end: 'var(--hue-end)',
  // loop-model/1 — annotation nodes read as structure, not a flow hue
  parameter: 'var(--line-structure)',
  register: 'var(--line-structure)',
}

export function Canvas() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { screenToFlowPosition, fitView, setViewport, getViewport } = useReactFlow()
  const isMobile = useIsMobile()
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  const toggleCanvasLocked = useUiStore((s) => s.toggleCanvasLocked)
  const focusMode = useUiStore((s) => s.focusMode)
  const toggleFocusMode = useUiStore((s) => s.toggleFocusMode)
  const filterPanelOpen = useUiStore((s) => s.filterPanelOpen)
  const toggleFilterPanel = useUiStore((s) => s.toggleFilterPanel)
  const activityOverlay = useUiStore((s) => s.activityOverlay)
  const toggleActivityOverlay = useUiStore((s) => s.toggleActivityOverlay)
  const frameToolArmed = useFrameStore((s) => s.toolArmed)
  const armFrameTool = useFrameStore((s) => s.armTool)
  const disarmFrameTool = useFrameStore((s) => s.disarmTool)
  const clearFrames = useFrameStore((s) => s.clearFrames)
  const selectFrame = useFrameStore((s) => s.selectFrame)
  const framesExist = useFrameStore(hasFrames)
  const fitRev = useGraphStore((s) => s.fitRev)
  const loadRev = useGraphStore((s) => s.loadRev)
  const nodesInitialized = useNodesInitialized()
  const t = useT()

  // A Templates load / pasted-graph swap bumps `graphStore.fitRev` — a
  // whole-graph replacement that carries NO viewport of its own and lands on
  // top of a graph the user was already looking at. React Flow keeps the
  // previous camera on a swap, so a new template can open panned to the *old*
  // graph's viewport (a blank / clipped first impression). Re-fit once per
  // swap, AFTER React Flow has laid out and MEASURED the new nodes
  // (`useNodesInitialized`), so the bounds are real — no `setTimeout`, no
  // retry. Excluded upstream: `newGraph` and `loadDoc` (file / Workspace /
  // Share / revision import — a Workspace restores its own saved view). Skipped
  // if a `loadDoc` landed after the arm, or if the camera was moved between the
  // swap and the measure (a deliberate pan wins). The initial mount is left to
  // `<ReactFlow fitView>`. Pan / zoom, "Reset view", Focus, filters and the
  // mobile orientation re-fit are untouched; nothing here reads or writes the
  // GraphDoc / node positions / undo / digest.
  const seenFitRev = useRef<number | null>(null)
  const armedSwap = useRef<{
    rev: number
    atLoadRev: number
    fromVp: { x: number; y: number; zoom: number }
  } | null>(null)
  useEffect(() => {
    if (seenFitRev.current === null) {
      seenFitRev.current = fitRev // first run: adopt the mount's graph
      return
    }
    if (fitRev !== seenFitRev.current && armedSwap.current?.rev !== fitRev) {
      seenFitRev.current = fitRev
      armedSwap.current = { rev: fitRev, atLoadRev: loadRev, fromVp: getViewport() }
    }
    const armed = armedSwap.current
    if (!armed || !nodesInitialized) return // wait for the measure pass
    armedSwap.current = null
    // a `loadDoc` (file / Workspace / Share / revision import) that landed
    // AFTER this swap was armed bumps `loadRev` but not `fitRev` — it owns the
    // camera (or restores a saved one), so drop the pending fit.
    if (armed.atLoadRev !== loadRev) return
    const now = getViewport()
    const untouched =
      Math.abs(now.x - armed.fromVp.x) < 0.5 &&
      Math.abs(now.y - armed.fromVp.y) < 0.5 &&
      Math.abs(now.zoom - armed.fromVp.zoom) < 1e-6
    if (untouched) void fitView({ padding: 0.3, maxZoom: 1.2 })
  }, [fitRev, loadRev, nodesInitialized, fitView, getViewport])

  // docs/large-graph-readability.md §LGR3.3 — the two lenses COMPOSE: filter
  // hides first (removes from the canvas), then focus dims the remainder. Both
  // only tag the objects React Flow RENDERS (`hidden` / a class); the graphStore
  // arrays that serialize / diff / undo are never touched (LGR-INV-1), and React
  // Flow's change events still flow back to the store unchanged.
  const focusSet = useFocusSet()
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
      if (focusSet && !focusSet.nodes.has(n.id)) return { ...n, className: withDeemph(n.className) }
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

  // React Flow's built-in a11y strings (Controls buttons, the keyboard hints on
  // nodes / edges, the handle label) — localized via the one config prop
  // (docs/localization.md Slice 2b). The MiniMap keeps its explicit `ariaLabel`.
  const ariaLabelConfig = {
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
  }

  // Dev-only: expose the viewport controls so the browser E2E can set an EXACT,
  // repeatable zoom for the deterministic screenshot matrix. Tree-shaken out of
  // the production / portable build (`import.meta.env.DEV` is statically false).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __loop?: Record<string, unknown> }
    if (w.__loop) w.__loop.rf = { setViewport, getViewport, fitView }
  }, [setViewport, getViewport, fitView])

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
      setSelection(sn[0]?.id ?? null, se[0]?.id ?? null)
    },
    [setSelection],
  )

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DND_TYPE) as NodeKind
      if (!kind) return
      addNodeAt(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
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
      className={`canvas${canvasLocked ? ' canvas--locked' : ''}`}
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
        nodesDraggable={!noEdit}
        nodesConnectable={!noEdit}
        edgesReconnectable={!noEdit}
        zoomOnDoubleClick={!isMobile}
        deleteKeyCode={noEdit ? null : undefined}
        defaultEdgeOptions={{ type: 'loop' }}
        ariaLabelConfig={ariaLabelConfig}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.2}
        maxZoom={2}
        // §LGR6 — while the Frame tool is armed, a pane drag draws a frame
        // instead of panning the canvas.
        panOnDrag={!frameToolArmed}
        onPaneClick={() => selectFrame(null)}
      >
        <EdgeMarkers />
        <LodGrid />
        {/* docs/large-graph-readability.md §LGR6 — transient group frames
            (behind the nodes) + their interactive chrome. Render / UI-only. */}
        <FrameLayer />
        {/* docs/large-graph-readability.md §LGR2.1 — Focus is armed but no node
            is selected yet, so nothing on the canvas has changed. Tell the user
            the mode is on and waiting. Never takes the pointer. */}
        {focusMode && !focusSet && (
          <Panel position="top-center" className="lgr-focus-hint">
            {t('canvas.focus.hint')}
          </Panel>
        )}
        {/* docs/large-graph-readability.md §LGR3.2 — the transient-filter panel,
            desktop only (mobile controls live in the More sheet, §LGR9). */}
        {!isMobile && filterPanelOpen && <FilterPanel />}
        {/* docs/mobile.md §MV3 / §MV-D10: the minimap is too small to help on a
            phone and eats space — not rendered in the mobile layout */}
        {!isMobile && (
          <MiniMap
            pannable
            zoomable
            ariaLabel={t('canvas.minimap')}
            nodeColor={(n) => MINIMAP_HUE[(n.type as NodeKind) ?? 'pool'] ?? 'var(--line-strong)'}
            nodeStrokeColor="var(--line-strong)"
            nodeStrokeWidth={2}
            nodeBorderRadius={2}
            maskColor="var(--minimap-mask)"
            maskStrokeColor="var(--signal-primary)"
            maskStrokeWidth={1}
            bgColor="var(--surface-raised)"
          />
        )}
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
          {/* docs/large-graph-readability.md §LGR6 — the one-shot "draw a group
              frame" tool (desktop only; frame drawing is not on mobile, §LGR9).
              Armed ⇒ a pane drag rubber-bands a labelled rectangle behind the
              nodes. Transient, session-only, never in the GraphDoc / undo. */}
          {!isMobile && (
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
          {!isMobile && framesExist && (
            <ControlButton
              onClick={() => clearFrames()}
              title={t('canvas.frame.clear')}
              aria-label={t('canvas.frame.clear')}
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
        </Controls>
      </ReactFlow>
    </div>
  )
}
