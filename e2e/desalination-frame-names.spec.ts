import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

// #533 follow-up and #540 — on the desalination Template, opened from the menu, at 100 %, in
// every shipped language: no node, outside name or run-rule line passes its frame's edge, no
// outside name lies over another node or another node's name in its frame, and the router
// draws every line (no `[route]` warning, which the dev build logs for a line it could only
// draw as `outer` or `blocked`). Zoomed in, a long name wraps to two lines and a run-rule
// line comes under a stage's name; in the overview neither happens, so the overview cannot
// show it.
//
// Before #541 and #540, among others: German "Versorgung der Stadt" passed frame 4's foot,
// the Coagulation filter's run-rule line passed frame 2's foot and lay over the Filtered
// water tank's name, Grid feed B's name lay over Recovered energy's in twelve languages, the
// Thickener passed frame 5's foot in sixteen, and the run-rule read line into the Coagulation
// filter was drawn blocked in six.

type Bridge = { __loop: Record<string, any> }
type Box = { l: number; t: number; r: number; b: number }

const FRAMES = ['f_intake', 'f_pre', 'f_ro', 'f_post', 'f_out']
const NODES = 43
/** the stages that hold a run rule, so their run-rule line is drawn under their name */
const RULED = ['adjust', 'dpump', 'filter', 'remin', 'ro', 'thick']
/** every shipped language: a name's width and wrap are the language's */
const LOCALES = ['en', 'ar', 'de', 'es-419', 'es-ES', 'fr', 'it', 'ja', 'ko', 'nl', 'pt-BR', 'pt-PT', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant']

async function openAt100(page: Page, locale: string): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openApp(page)
  if (locale !== 'en') await pickLocale(page, locale)
  await pickTemplate(page, 'desalination')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(NODES)
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }))
  await routesSettled(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)).toBe(1)
}

/** every box of the five frames against its frame's edges, and every name against the other
 *  nodes and names of its frame, in canvas units */
function measure(page: Page) {
  return page.evaluate((watched) => {
    const l = (window as unknown as Bridge).__loop
    const v = l.rf.getViewport()
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const toCanvas = (r: DOMRect): Box => ({ l: (r.left - pane.left - v.x) / v.zoom, t: (r.top - pane.top - v.y) / v.zoom, r: (r.right - pane.left - v.x) / v.zoom, b: (r.bottom - pane.top - v.y) / v.zoom })
    const boxOf = (el: Element | null): Box | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return r.width === 0 && r.height === 0 ? null : toCanvas(r)
    }
    const hit = (a: Box, b: Box) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
    const frames = (l.frame.getState().frames as { id: string; rect: { x: number; y: number; w: number; h: number } }[]).filter((f) => watched.includes(f.id))
    const nodes = l.graph.getState().nodes as { id: string; position: { x: number; y: number } }[]
    const problems: string[] = []
    const measured: Record<string, number> = { node: 0, name: 0, 'run rule': 0 }
    const ruled: string[] = []
    let inFrames = 0
    for (const f of frames) {
      const members = nodes.filter((n) => n.position.x >= f.rect.x && n.position.x <= f.rect.x + f.rect.w && n.position.y >= f.rect.y && n.position.y <= f.rect.y + f.rect.h)
      inFrames += members.length
      const boxes = members.map((n) => {
        const el = document.querySelector(`.react-flow__node[data-id="${n.id}"]`)
        if (!el) problems.push(`${f.id} ${n.id}: not drawn`)
        return { id: n.id, node: boxOf(el), name: boxOf(el?.querySelector('.nodef__label') ?? null), rule: boxOf(el?.querySelector('.stage-tag__shown') ?? null) }
      })
      for (const b of boxes) {
        for (const [what, box] of [['node', b.node], ['name', b.name], ['run rule', b.rule]] as const) {
          if (!box) continue
          measured[what]!++
          if (what === 'run rule') ruled.push(b.id)
          const room = { left: box.l - f.rect.x, top: box.t - f.rect.y, right: f.rect.x + f.rect.w - box.r, bottom: f.rect.y + f.rect.h - box.b }
          for (const [side, by] of Object.entries(room)) if (by < -0.5) problems.push(`${f.id} ${b.id} ${what}: past the ${side} edge by ${(-by).toFixed(1)}`)
        }
        // a name and a run-rule line, each against every other node, name and run-rule line of
        // the frame. The name's box holds the run-rule line under it, but the line is checked
        // on its own too, so a run-rule line over a neighbour is named as such (#540 began with
        // the Coagulation filter's run-rule line over the Filtered water tank's name).
        const texts = [['name', b.name], ['run rule', b.rule]] as const
        for (const [what, box] of texts) {
          if (!box) continue
          for (const o of boxes) {
            if (o.id === b.id) continue
            if (o.node && hit(box, o.node)) problems.push(`${f.id} ${b.id} ${what} over the node ${o.id}`)
            for (const [whatO, boxO] of [['name', o.name], ['run rule', o.rule]] as const) {
              // each pair of texts once: the same kinds in id order, mixed kinds both ways
              if (!boxO || (what === whatO && b.id > o.id)) continue
              if (hit(box, boxO)) problems.push(`${f.id} ${b.id} ${what} over the ${whatO === 'name' ? 'name' : 'run-rule line'} of ${o.id}`)
            }
          }
        }
      }
    }
    return { problems, measured, ruled: ruled.sort(), frames: frames.length, inFrames, nodes: nodes.length }
  }, FRAMES)
}

test.describe('#533 / #540 — the desalination Template keeps its names inside its frames and apart', () => {
  for (const locale of LOCALES) {
    test(`${locale}: at 100 %, no name passes a frame edge or lies over another, and every line is routed`, async ({ page }) => {
      const routeWarnings: string[] = []
      page.on('console', (m) => {
        if (m.text().startsWith('[route]')) routeWarnings.push(m.text())
      })
      await openAt100(page, locale)
      const r = await measure(page)
      expect(r.frames).toBe(5)
      // every node of the Template sits in one of the five frames, so every one was checked
      expect(r.inFrames).toBe(r.nodes)
      // what was measured, by kind, so an empty result cannot pass for a clean one: every node
      // box and outside name, and the run-rule line of each of the six ruled stages. The same
      // in every language when the test was written.
      expect(r.measured.node, 'node boxes').toBeGreaterThanOrEqual(NODES)
      expect(r.measured.name, 'outside names').toBeGreaterThanOrEqual(NODES)
      expect(r.measured['run rule'], 'run-rule lines').toBeGreaterThanOrEqual(RULED.length)
      expect(r.ruled).toEqual(expect.arrayContaining(RULED))
      expect(r.problems, r.problems.join('\n')).toEqual([])
      expect(routeWarnings, routeWarnings.join('\n')).toEqual([])
    })
  }
})
