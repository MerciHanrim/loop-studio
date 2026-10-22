import type { Page } from '@playwright/test'

// Independent checks for a connection end on a symbol node (Lumi, 2026-10-19):
// a spec that takes the expected point from the product's own anchor function
// (`routeMap.portPoint`) would pass the same arithmetic error with it, so the
// end is also checked against what the browser DRAWS and HIT-TESTS:
//   • on the outline — the node's own stroke path, asked by the browser's
//     `isPointInStroke` (the stroke widened to ±`tol` px while asked), and
//   • at the handle — the DOM handle the connection is drawn to, its centre on
//     screen against the route's end point on screen.

/** is the flow point `p` on node `id`'s drawn outline, within ±tol px */
export function onDrawnOutline(page: Page, id: string, p: { x: number; y: number }, tol = 2): Promise<boolean> {
  return page.evaluate(
    ({ id, p, tol }) => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } } } }).__loop.graph.getState()
      const n = g.nodes.find((x) => x.id === id)!
      const stroke = document.querySelector<SVGPathElement>(`.react-flow__node[data-id="${id}"] .nodef__stroke`)!
      const svg = stroke.ownerSVGElement!
      const pt = svg.createSVGPoint()
      pt.x = p.x - n.position.x
      pt.y = p.y - n.position.y
      const was = stroke.style.strokeWidth
      stroke.style.strokeWidth = String(2 * tol)
      try {
        return stroke.isPointInStroke(pt)
      } finally {
        stroke.style.strokeWidth = was
      }
    },
    { id, p, tol },
  )
}

/** is the centre of node `id`'s DOM handle `selector` on its drawn outline,
 *  within ±tol px — screen to the stroke's own user space by its inverse CTM */
export function handleOnDrawnOutline(page: Page, id: string, selector: string, tol = 2): Promise<boolean> {
  return page.evaluate(
    ({ id, selector, tol }) => {
      const wrap = document.querySelector(`.react-flow__node[data-id="${id}"]`)!
      const stroke = wrap.querySelector<SVGPathElement>('.nodef__stroke')!
      const h = wrap.querySelector(selector)!.getBoundingClientRect()
      const svg = stroke.ownerSVGElement!
      const pt = svg.createSVGPoint()
      pt.x = h.left + h.width / 2
      pt.y = h.top + h.height / 2
      const local = pt.matrixTransform(stroke.getScreenCTM()!.inverse())
      const was = stroke.style.strokeWidth
      stroke.style.strokeWidth = String(2 * tol)
      try {
        return stroke.isPointInStroke(local)
      } finally {
        stroke.style.strokeWidth = was
      }
    },
    { id, selector, tol },
  )
}

/** the screen distance between a route's end (`at`: its first or last point)
 *  and the centre of the DOM handle `handleId` on node `id` */
export function endToDomHandle(page: Page, edgeId: string, at: 'start' | 'end', id: string, handleId: string): Promise<number> {
  return page.evaluate(
    ({ edgeId, at, id, handleId }) => {
      const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`)!
      const q = path.getPointAtLength(at === 'start' ? 0 : path.getTotalLength())
      const m = path.getScreenCTM()!
      const e = { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
      const h = document.querySelector(`.react-flow__node[data-id="${id}"] .react-flow__handle[data-handleid="${handleId}"]`)!.getBoundingClientRect()
      return Math.hypot(e.x - (h.left + h.width / 2), e.y - (h.top + h.height / 2))
    },
    { edgeId, at, id, handleId },
  )
}
