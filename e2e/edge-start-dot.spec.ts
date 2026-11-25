import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// #612 item 4 — a selected, idle flow connection shows a small dot near its start
// (`circle.flow-rest`, src/components/edges/LoopEdge.tsx). It was placed at 8 % of the
// STRAIGHT line from source to target, whatever the drawn path is: on a routed or curved
// connection it floated off the line (MEASURED on main 7a507219, the Desalination Template:
// 8 of its 47 flow connections had the dot more than 2 px off the drawn path, the worst
// `e_turbine_brine` 55.5 px). It is now placed along the drawn path itself (at 8 % of its
// length), so it is on the line for every shape. The test asks what the finding is about: the
// dot on the drawn line, and near its start; not the exact 8 %.

type L = { __loop: Record<string, { getState: () => any; setState: (s: object) => void }> }

/** select one connection alone, the way the store marks it */
const selectOnlyEdge = (page: Page, id: string) =>
  page.evaluate((eid) => {
    const g = (window as unknown as L).__loop.graph
    g.setState({ edges: g.getState().edges.map((x: { id: string }) => ({ ...x, selected: x.id === eid })) })
  }, id)
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/** how far the dot is from the drawn path, and where along it (a length fraction) its nearest point is */
const measure = (page: Page, id: string) =>
  page.evaluate((eid) => {
    const el = document.querySelector(`.react-flow__edge[data-id="${eid}"]`)
    const dot = el?.querySelector<SVGCircleElement>('circle.flow-rest')
    const path = el?.querySelector<SVGPathElement>('path.react-flow__edge-path')
    if (!dot || !path) return null
    const x = dot.cx.baseVal.value
    const y = dot.cy.baseVal.value
    const len = path.getTotalLength()
    let off = Infinity
    let along = 0
    for (let s = 0; s <= len; s += 0.5) {
      const p = path.getPointAtLength(s)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < off) {
        off = d
        along = s / len
      }
    }
    return { off, along }
  }, id)

test.describe('the start dot of a selected idle connection is on its drawn path (#612 item 4)', () => {
  test('every flow connection of the Desalination Template: the dot is on the drawn line, near its start', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await expect(page.locator('.react-flow__node')).toHaveCount(43)
    const ids: string[] = await page.evaluate(() =>
      (window as unknown as L).__loop.graph
        .getState()
        .edges.filter((e: { data?: { kind?: string } }) => e.data?.kind !== 'state')
        .map((e: { id: string }) => e.id),
    )
    expect(ids.length).toBeGreaterThan(40)
    const off: { id: string; off: number; along: number }[] = []
    let measured = 0
    for (const id of ids) {
      await selectOnlyEdge(page, id)
      await nextFrames(page)
      const m = await measure(page, id)
      if (!m) continue
      measured++
      // on the line (1 px), and at its start: its nearest point within the first 15 % of the length
      if (m.off > 1 || m.along > 0.15) off.push({ id, off: +m.off.toFixed(1), along: +m.along.toFixed(3) })
    }
    expect(measured, 'a dot was measured on (nearly) every flow connection').toBeGreaterThan(40)
    expect(off, 'connections whose dot is off the drawn line, or not near its start').toEqual([])
  })
})
