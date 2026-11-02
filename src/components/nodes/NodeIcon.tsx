import { useId, useMemo } from 'react'
import { useStore } from '@xyflow/react'
import type { NodeIconId } from '../../model/model'
import { NODE_ICON_BIG_ZOOM } from './nodeIconMeta'
import { NODE_ICON_DRAWINGS } from './nodeIconDrawings'

// SEMANTICS-R12.md — the mark a flow node's `data.icon` draws: a 16 px filled
// silhouette in `currentColor`, `aria-hidden` (its name is read from the node
// frame's accessible name, and from the picker's options).

/** one mark; `big` picks the 24-unit drawing */
export function NodeIcon({ id, big, className }: { id: NodeIconId; big: boolean; className?: string }) {
  // a mask in the drawing needs an id no other mark on the page shares
  const uid = 'ni' + useId().replace(/[^A-Za-z0-9_-]/g, '_')
  const d = NODE_ICON_DRAWINGS[id]
  // one string per drawing: a re-render for any other reason leaves the
  // SVG's children alone
  const body = useMemo(() => (big ? d.big : (d.small ?? d.big)).replaceAll('{uid}', uid), [big, d, uid])
  return (
    <svg
      className={className}
      viewBox={d.vb}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-icon={id}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}

/** the mark on the canvas: the drawing follows the rendered size, so it
 *  subscribes to the zoom — but only to the one boolean, so a pan or a zoom
 *  within a size band renders nothing */
export function CanvasNodeIcon({ id }: { id: NodeIconId }) {
  const big = useStore((s) => s.transform[2] >= NODE_ICON_BIG_ZOOM)
  return <NodeIcon id={id} big={big} className="nodef__icon" />
}
