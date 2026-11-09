import type { Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

// #533 follow-up (Lumi, 2026-11-09) — on the desalination Template, opened from the menu, no
// node, outside name or run-rule line in frames 2 and 4 passes its frame's edge, in any
// shipped language, at 100 %. Zoomed in, a long name wraps to two lines and a run-rule line
// comes under a stage's name; in the overview neither happens, so the overview cannot show
// it. Before the fix, German "Versorgung der Stadt" passed frame 4's foot by 6, the
// Coagulation filter's name and run-rule line passed frame 2's foot by 11 (by 28 in
// Russian), and Grid feed C's name passed frame 4's right edge in seven languages.
// Frames 1, 3 and 5 still hold older crossings (#540) and are not checked here.

type Bridge = { __loop: Record<string, any> }

const FRAMES = ['f_pre', 'f_post']
const NODES = 43
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
  // the names are laid out for 100 % once the zoom has settled and the routes are drawn
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)).toBe(1)
}

/** each box in frames 2 and 4 that passes its frame's edge: the frame, the node, which box,
 *  which side and by how much, in canvas units */
function crossings(page: Page) {
  return page.evaluate((watched) => {
    const l = (window as unknown as Bridge).__loop
    const v = l.rf.getViewport()
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const toCanvas = (r: DOMRect) => ({ l: (r.left - pane.left - v.x) / v.zoom, t: (r.top - pane.top - v.y) / v.zoom, r: (r.right - pane.left - v.x) / v.zoom, b: (r.bottom - pane.top - v.y) / v.zoom })
    const frames = (l.frame.getState().frames as { id: string; rect: { x: number; y: number; w: number; h: number } }[]).filter((f) => watched.includes(f.id))
    const nodes = l.graph.getState().nodes as { id: string; position: { x: number; y: number } }[]
    const out: string[] = []
    /** what was measured, by kind of box, and the stages whose run-rule line was among them */
    const measured: Record<string, number> = { node: 0, name: 0, 'run rule': 0 }
    const ruleStages: string[] = []
    for (const f of frames) {
      const members = nodes.filter((n) => n.position.x >= f.rect.x && n.position.x <= f.rect.x + f.rect.w && n.position.y >= f.rect.y && n.position.y <= f.rect.y + f.rect.h)
      for (const n of members) {
        const el = document.querySelector(`.react-flow__node[data-id="${n.id}"]`)
        if (!el) {
          out.push(`${f.id} ${n.id}: not drawn`)
          continue
        }
        const boxes: [string, Element | null][] = [['node', el], ['name', el.querySelector('.nodef__label')], ['run rule', el.querySelector('.stage-tag__shown')]]
        for (const [what, b] of boxes) {
          if (!b) continue
          const r = b.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          measured[what]!++
          if (what === 'run rule') ruleStages.push(n.id)
          const d = toCanvas(r)
          const room = { left: d.l - f.rect.x, top: d.t - f.rect.y, right: f.rect.x + f.rect.w - d.r, bottom: f.rect.y + f.rect.h - d.b }
          for (const [side, by] of Object.entries(room)) if (by < -0.5) out.push(`${f.id} ${n.id} ${what}: past the ${side} edge by ${(-by).toFixed(1)}`)
        }
      }
    }
    return { out, measured, ruleStages: ruleStages.sort(), frames: frames.length }
  }, FRAMES)
}

test.describe('#533 — the desalination Template keeps its names inside frames 2 and 4', () => {
  for (const locale of LOCALES) {
    test(`${locale}: no name or run-rule line in frames 2 and 4 passes a frame edge at 100 %`, async ({ page }) => {
      await openAt100(page, locale)
      const r = await crossings(page)
      expect(r.frames).toBe(2)
      // both kinds the test is for were measured, not only found: the 19 nodes of frames 2 and 4
      // (8 and 11), each with its outside name, and the run-rule lines of the three stages
      // there that hold a rule. The same in every language when the test was written.
      expect(r.measured.node, 'node boxes').toBeGreaterThanOrEqual(19)
      expect(r.measured.name, 'outside names').toBeGreaterThanOrEqual(19)
      expect(r.measured['run rule'], 'run-rule lines').toBeGreaterThanOrEqual(3)
      expect(r.ruleStages).toEqual(expect.arrayContaining(['dpump', 'filter', 'remin']))
      expect(r.out, r.out.join('\n')).toEqual([])
    })
  }
})
