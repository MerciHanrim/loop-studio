// docs/canvas-text-layer.md §CTL5 — which changes make the canvas text layer
// read its geometry again. Reading every line is the layer's one costly step
// (each line sampled every few world px: about 0.9 s on the MMO's 144 lines on
// the dev machine, #554), so a change that leaves every node box and every line
// path where it was asks only for a draw.

/** what a change asks the next frame to do: draw on the geometry already read,
 *  read the nodes again (cheap), or read the lines too */
export type Need = 0 | 1 | 2
export const DRAW: Need = 0
export const NODES: Need = 1
export const LINES: Need = 2

/** the elements whose adding or removing changes the read geometry */
const GEOM_EL = '.react-flow__node, .react-flow__edge-path'
/** a node's inline style properties that move or size it */
const NODE_BOX_STYLE = ['transform', 'width', 'height', 'visibility', 'display']
let styleProbe: HTMLElement | null = null

const hasGeomEl = (list: NodeList) => {
  for (const n of list) if (n.nodeType === 1 && ((n as Element).matches(GEOM_EL) || (n as Element).querySelector(GEOM_EL))) return true
  return false
}

/** what one record inside the canvas viewport asks for (the observer gives each
 *  `style` and `d` record its old value).
 *  - Lines: a node or a line added or removed; a line's path `d` changed.
 *  - Nodes: a node's own box style (`transform`, size, visibility) changed, or
 *    anything inside a node rewritten — its name, its value, its symbol.
 *  - A draw only: a line's colour, width or activity tint (`style` on its
 *    path), a `d` written with the same value, an edge label, anything outside
 *    the nodes and lines. */
export function needOf(r: MutationRecord): Need {
  const el = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement
  if (!el) return DRAW
  if (r.type === 'childList' && (hasGeomEl(r.addedNodes) || hasGeomEl(r.removedNodes))) return LINES
  if (r.type === 'attributes' && r.attributeName === 'd') return el.matches('.react-flow__edge-path') && r.oldValue !== el.getAttribute('d') ? LINES : DRAW
  const node = el.closest('.react-flow__node')
  if (!node) return DRAW
  if (r.type === 'attributes' && r.attributeName === 'style' && el === node) {
    styleProbe ??= document.createElement('div')
    styleProbe.style.cssText = r.oldValue ?? ''
    const now = (el as HTMLElement).style
    const probe = styleProbe.style
    return NODE_BOX_STYLE.some((p) => probe.getPropertyValue(p) !== now.getPropertyValue(p)) ? NODES : DRAW
  }
  return NODES
}

export type NodeBox = { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number | null; height?: number | null; hidden?: boolean }

/** whether a node was added, removed, moved or resized between two node lists —
 *  not a selection, a drag flag or a data change alone (a data change that
 *  resizes a node comes back as its measured size) */
export function nodesMoved(a: readonly NodeBox[], b: readonly NodeBox[]): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i]
    if (p === q) continue
    if (p.id !== q.id || p.position.x !== q.position.x || p.position.y !== q.position.y) return true
    if (p.width !== q.width || p.height !== q.height || p.hidden !== q.hidden) return true
    if (p.measured?.width !== q.measured?.width || p.measured?.height !== q.measured?.height) return true
  }
  return false
}
