import type { Locator, Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, test } from './support/loop'

// #523 — in forced colours a series' square mark was only a background, so it vanished
// and the legend no longer tied a name to a line. The chart's lines keep their colours
// there, so a mark has to as well. Read in pixels: a computed style says nothing about
// what forced colours paint.

type Bridge = { __loop: Record<string, { getState: () => any }> }

/** forced colours ignore accents and use six series colours, so a seventh Pool shares one */
const POOLS = 7
const pool = (i: number) => ({ id: `p${i}`, type: 'pool', position: { x: i * 220, y: 0 }, data: { kind: 'pool', label: `Pool ${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
const source = (i: number) => ({ id: `s${i}`, type: 'source', position: { x: i * 220, y: 200 }, data: { kind: 'source', label: `Source ${i}`, activation: 'automatic', mode: 'pushAny' } })
const line = (id: string, from: string, to: string, flow: string) => ({ id, source: from, target: to, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow } })

const each = [...Array(POOLS).keys()]
const DOC = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [...each.map(pool), ...each.map(source)],
  edges: each.map((i) => line(`e${i}`, `s${i}`, `p${i}`, String(i + 1))),
  recommendedRunConfig: { timelineSeries: 'all' },
})

/** how many of an element's pixels are drawn in `color` */
async function inked(page: Page, el: Locator, color: string): Promise<number> {
  const png = (await el.screenshot()).toString('base64')
  return page.evaluate(
    async ([src, want]) => {
      const img = new Image()
      img.src = `data:image/png;base64,${src}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.fillStyle = want!
      x.fillRect(0, 0, 1, 1)
      const [r, g, b] = x.getImageData(0, 0, 1, 1).data
      x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - r!) < 40 && Math.abs(d[i + 1]! - g!) < 40 && Math.abs(d[i + 2]! - b!) < 40) n++
      return n
    },
    [png, color] as const,
  )
}

/** each mark in a surface shows its series' colour */
async function everyMarkShows(page: Page, surface: Locator) {
  const marks = surface.locator('.timeline__mark')
  await expect(marks).toHaveCount(POOLS)
  for (const mark of await marks.all()) {
    // the series colour is a custom property, which a canvas cannot read
    const color = await mark.evaluate((el) => {
      const raw = (el as HTMLElement).style.background || (el.querySelector('line') as SVGLineElement).style.stroke
      const name = /--[\w-]+/.exec(raw)?.[0]
      return name ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : raw
    })
    expect(await inked(page, mark, color), `a mark in ${color}`).toBeGreaterThan(4)
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`forced colours (${colorScheme}): the legend, the series list and the step reading show each series' mark`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    await openApp(page)
    await importGraph(page, DOC)
    await ensureTimelineOpen(page)
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      for (let i = 0; i < 4; i++) s.advance()
    })
    await expect(page.locator('.timeline__line')).toHaveCount(POOLS)

    // the colour two share: one solid mark, and one with its pattern
    await expect(page.locator('.timeline__key .timeline__mark--line')).toHaveCount(1)
    await everyMarkShows(page, page.locator('.timeline__keys'))

    await page.locator('.timeline__svg').click({ position: { x: 300, y: 60 } })
    await everyMarkShows(page, page.locator('.timeline__reading'))
    await page.locator('.timeline__reading-x').click()

    await page.locator('.timeline__series').click()
    await everyMarkShows(page, page.locator('.tl-series'))
  })
}
