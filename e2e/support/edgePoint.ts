import { expect, type Page } from '@playwright/test'

/** a point of a connection's own line where the pointer reaches THAT line —
 *  as a user selects it. Where a line crosses a frame's border, the frame's
 *  edge strip is on top and takes the click (an existing priority, recorded on
 *  its own; measured 2026-10-19: with the symbol nodes e_leave of the
 *  node-structure fixture runs straight and its 30 % point lies on the Clinic
 *  floor strip). Tries `first` along the line, then the next clear point;
 *  fails the test when no tried point reaches the line. */
export async function reachablePointOnEdge(page: Page, id: string, first = 0.3): Promise<{ x: number; y: number }> {
  const p = await page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate(
    (el, { id, first }) => {
      const s = el as SVGPathElement
      const m = s.getScreenCTM()!
      for (const f of [first, 0.3, 0.4, 0.5, 0.6, 0.7, 0.2, 0.8]) {
        const q = s.getPointAtLength(s.getTotalLength() * f)
        const at = { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
        if (document.elementFromPoint(at.x, at.y)?.closest('.react-flow__edge')?.getAttribute('data-id') === id) return at
      }
      return null
    },
    { id, first },
  )
  expect(p, `${id}: a point of its line the pointer reaches`).not.toBeNull()
  return p!
}
