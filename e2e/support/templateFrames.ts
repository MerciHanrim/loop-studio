import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled } from './loop'
import { pickLocale, pickTemplate } from './workbenchMenus'

// A bundled Template's names against its frames, opened from the menu at 100 % in one
// language: every node, outside name and run-rule line of a frame against the frame's edges,
// and every name and run-rule line against the other nodes and texts of its frame. First
// written for the desalination Template (#533, #540); the coffee roasting batch uses it too.

type Bridge = { __loop: Record<string, any> }
type Box = { l: number; t: number; r: number; b: number }

/** every shipped language: a name's width and wrap are the language's */
export const TEMPLATE_LOCALES = ['en', 'ar', 'de', 'es-419', 'es-ES', 'fr', 'it', 'ja', 'ko', 'nl', 'pt-BR', 'pt-PT', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant']

/** the Template `id` opened from the menu in `locale`, at 100 % with its lines routed */
export async function openTemplateAt100(page: Page, locale: string, id: string, nodeCount: number): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openApp(page)
  if (locale !== 'en') await pickLocale(page, locale)
  await pickTemplate(page, id)
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(nodeCount)
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }))
  await routesSettled(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)).toBe(1)
}

/** every box of the frames `frameIds` against its frame's edges, and every name against the
 *  other nodes and names of its frame, in canvas units */
export function measureFrames(page: Page, frameIds: readonly string[]) {
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
  }, [...frameIds])
}
