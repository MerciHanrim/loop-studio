import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #614 item 4 — the playback badge's width is measured once per text, on a canvas, with
// the badge's own font (src/components/edges/playbackBadge.ts). A text measured before the web
// font had arrived kept the fallback font's width for the whole session: on main `ba39e719`,
// with the font files held back, `+1` and `+2` kept 12.99 px against 12 drawn, so their pills
// stayed about 1 px wider; a narrower fallback would clip the text. The width is now measured
// again once the font has loaded.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const node = (id: string, kind: string, data: Record<string, unknown>, x: number, y: number) => ({ id, type: kind, position: { x, y }, data: { kind, label: id, ...data } })
const feed = (id: string, target: string, flow: string) => ({ id, source: 'src', target, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
/** a Source feeding two Pools, 1 and 2 a step: badges `+1` and `+2` */
const DOC = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [
    node('src', 'source', { label: 'Source', activation: 'automatic' }, 0, 0),
    node('a', 'pool', { label: 'Alpha', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 300, -100),
    node('b', 'pool', { label: 'Beta', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 300, 100),
  ],
  edges: [feed('e_a', 'a', '1'), feed('e_b', 'b', '2')],
})
const TEXTS = ['+1', '+2']

const steps = async (page: Page, n: number) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().activeTransitionId)).toBe(null)
  }
}
/** the badge's own font, loaded */
const badgeFontLoaded = (page: Page) =>
  page.evaluate(() => document.fonts.check(`700 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()}`))
/** each text's width as the badge cache holds it, against the same text drawn in a `.pb-badge` */
const widths = (page: Page) =>
  page.evaluate(async (texts) => {
    // the dev server's own module, the one the canvas uses
    const url = '/src/components/edges/playbackBadge.ts'
    const M = (await import(url)) as { badgeTextWidth: (t: string) => number }
    return texts.map((t) => {
      const probe = document.createElement('div')
      probe.className = 'pb-badge'
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:auto'
      probe.textContent = t
      document.body.appendChild(probe)
      const range = document.createRange()
      range.selectNodeContents(probe)
      const drawn = range.getBoundingClientRect().width
      probe.remove()
      return { t, cached: Number(M.badgeTextWidth(t).toFixed(2)), drawn: Number(drawn.toFixed(2)) }
    })
  }, TEXTS)
const apart = (w: { t: string; cached: number; drawn: number }[]) => w.filter((x) => Math.abs(x.cached - x.drawn) > 0.1).map((x) => `${x.t}: cached ${x.cached}, drawn ${x.drawn}`)

test.describe('#614 item 4 — the playback badge width follows the loaded font', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a badge text measured before the web font arrived is measured again once it has', async ({ page }) => {
    // the font files wait until the badges have been measured with the fallback font
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    await page.route(/\.woff2(\?|$)/, async (r) => {
      await gate
      await r.continue()
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, DOC)
    expect(await badgeFontLoaded(page), 'the badge font has not loaded yet').toBe(false)
    await steps(page, 3)
    await expect(page.locator('.pb-badge')).not.toHaveCount(0)

    release()
    await page.evaluate(async () => {
      await document.fonts.load(`700 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()}`)
      await document.fonts.ready
    })
    expect(await badgeFontLoaded(page), 'the badge font has loaded').toBe(true)
    await steps(page, 3)
    expect(apart(await widths(page))).toEqual([])
  })

  test('control: with the font loaded before the first step, the cached width is the drawn one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, DOC)
    await page.evaluate(async () => {
      await document.fonts.load(`700 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()}`)
      await document.fonts.ready
    })
    await steps(page, 3)
    expect(apart(await widths(page))).toEqual([])
  })
})
