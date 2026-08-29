import { useCallback, useEffect } from 'react'
import type { DragEvent } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { useIsMobile } from '../ui/media'
import { nodeTypes } from './nodes/nodes'
import { edgeTypes } from './edges/LoopEdge'

const DND_TYPE = 'application/loop-node'

// minimap node fill by kind — resolved from the theme tokens (var() in an inline
// style property stays theme-reactive)
const MINIMAP_HUE: Record<NodeKind, string> = {
  pool: 'var(--hue-pool)',
  source: 'var(--hue-source)',
  drain: 'var(--hue-drain)',
  gate: 'var(--hue-gate)',
  converter: 'var(--hue-converter)',
  end: 'var(--hue-end)',
}

export function Canvas() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const isMobile = useIsMobile()

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

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DND_TYPE) as NodeKind
      if (!kind) return
      addNodeAt(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    },
    [addNodeAt, screenToFlowPosition],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow<LoopNode, LoopEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        defaultEdgeOptions={{ type: 'loop' }}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={16} color="var(--line-hairline)" />
        {/* docs/mobile.md §MV3 / §MV-D10: the minimap is too small to help on a
            phone and eats space — not rendered in the mobile layout */}
        {!isMobile && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Graph minimap"
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
        <Controls />
      </ReactFlow>
    </div>
  )
}
