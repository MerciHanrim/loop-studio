import { useCallback } from 'react'
import type { DragEvent } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { nodeTypes } from './nodes/nodes'
import { edgeTypes } from './edges/LoopEdge'

const DND_TYPE = 'application/loop-node'

export function Canvas() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { screenToFlowPosition } = useReactFlow()

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
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  )
}
