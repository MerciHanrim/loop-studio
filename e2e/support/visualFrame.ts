import type { Page } from '@playwright/test'
import { expect } from './loop'

// docs/visual-snapshot-policy.md — the canvas clip is the `.react-flow` pane,
// 664 x 548 at the e2e viewport since the workbench (1280 x 800 is its wide
// band: the model list and the properties panel both open). A visual spec that
// compares node symbols, state rings or colours pans its scene so everything it
// shows is whole in that pane. This pans only: the zoom (and so the level of
// detail) stays what the spec set.

/** Pan so the union of the given nodes (each with everything it draws: name,
 *  rings, run cues, flag) and of any extra elements is centred in the pane at
 *  the current zoom, then assert all of them are whole inside it. Default: every node. */
export async function frameInPane(page: Page, opts: { ids?: string[]; extra?: string } = {}): Promise<void> {
  const box = () =>
    page.evaluate(({ ids, extra }) => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      const nodes = ids ? ids.map((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)!) : [...document.querySelectorAll('.react-flow__node')]
      const els = [...nodes.flatMap((n) => [n, ...n.querySelectorAll('*')]), ...(extra ? [...document.querySelectorAll(extra)] : [])]
      const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      const u = { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }
      return { pane: { l: pane.left, t: pane.top, r: pane.right, b: pane.bottom }, u }
    }, opts)
  const b = await box()
  const dx = (b.pane.l + b.pane.r) / 2 - (b.u.l + b.u.r) / 2
  const dy = (b.pane.t + b.pane.b) / 2 - (b.u.t + b.u.b) / 2
  await page.evaluate(
    ({ dx, dy }) => {
      const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o: unknown) => void } } }).__loop.rf
      const v = rf.getViewport()
      rf.setViewport({ x: Math.round(v.x + dx), y: Math.round(v.y + dy), zoom: v.zoom }, { duration: 0 })
    },
    { dx, dy },
  )
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const a = await box()
  const whole = a.u.l >= a.pane.l && a.u.r <= a.pane.r && a.u.t >= a.pane.t && a.u.b <= a.pane.b
  expect(whole, `the framed scene (${Math.round(a.u.r - a.u.l)} x ${Math.round(a.u.b - a.u.t)}) is whole in the pane (${Math.round(a.pane.r - a.pane.l)} x ${Math.round(a.pane.b - a.pane.t)})`).toBe(true)
}
