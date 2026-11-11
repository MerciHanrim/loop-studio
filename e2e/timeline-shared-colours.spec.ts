// Hanrim / Lumi, 2026-11-11 — the desalination example's four water tanks drew in its one water
// blue, told apart only by pattern. Where a pattern tells shared-colour lines apart, each later
// line now also takes a chart colour of its own, the same in the line, its legend chip and the
// step reading; the patterns stay, so colour is never the only tell. The canvas keeps the flow
// colour. Forced colours are unchanged. docs/timeline-series-contract.md.
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, openApp, resetAll, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

const advance = (page: Page, n: number) =>
  page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, n)

/** each drawn Pool line: its colour and pattern in the chart, its legend chip and its reading row */
const read = (page: Page) =>
  page.evaluate(() => {
    const mark = (m: Element | null) => {
      if (!m) return null
      if (m.tagName.toLowerCase() === 'svg') {
        const l = m.querySelector('line')!
        return { color: getComputedStyle(l).stroke, dash: getComputedStyle(l).strokeDasharray }
      }
      return { color: getComputedStyle(m).backgroundColor, dash: 'none' }
    }
    const lines = [...document.querySelectorAll('.timeline__svg path.timeline__line:not(.timeline__line--register)')] as SVGPathElement[]
    return lines.map((l) => {
      const id = l.getAttribute('data-series')!
      const label = (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === id)?.data.label as string
      const chip = [...document.querySelectorAll('.timeline__key')].find((k) => (k.textContent ?? '').replace(/[⁦-⁩]/g, '').startsWith(label))
      const row = document.querySelector(`.timeline__reading-row[data-series="${id}"]`)
      return {
        id,
        line: { color: getComputedStyle(l).stroke, dash: getComputedStyle(l).strokeDasharray },
        chip: mark(chip?.querySelector('.timeline__mark') ?? null),
        reading: mark(row?.querySelector('.timeline__mark') ?? null),
      }
    })
  })

async function pinStep(page: Page) {
  const box = (await page.locator('.timeline__svg').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await expect(page.locator('.timeline__reading')).toBeVisible()
}

test.describe('shared-colour Pools in the Timeline', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the four water tanks of the desalination example read four colours, the same in line, legend and reading, patterns kept`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await resetAll(page)
      await pickTemplate(page, 'desalination')
      await ensureTimelineOpen(page)
      await advance(page, 24)
      await pinStep(page)
      const s = await read(page)
      expect(s.length).toBe(4)
      // one colour per line, and each the same in its chip and its reading row
      expect(new Set(s.map((x) => x.line.color)).size).toBe(4)
      for (const x of s) {
        expect(x.chip, `${x.id}: the legend chip`).toEqual(x.line)
        expect(x.reading, `${x.id}: the reading row`).toEqual(x.line)
      }
      // the patterns stay, by document rank: the four drawn tanks are the 2nd to 5th water Pools
      // (the intake basin, the first, is not drawn), so each has a pattern of its own
      expect(s.map((x) => x.line.dash)).toEqual(['8px, 3px', '9px, 3px, 2px, 3px', '12px, 3px, 2px, 3px, 2px, 3px', '16px, 3px, 4px, 3px'])
      // the canvas keeps the water colour on every tank
      const accents = await page.evaluate((ids: string[]) => ids.map((id) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === id)?.data.accent), s.map((x) => x.id))
      expect(new Set(accents)).toEqual(new Set(['#638EA5']))
    })
  }

  test('forced colours: the palette by index as before, the patterns kept', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await ensureTimelineOpen(page)
    await advance(page, 24)
    await pinStep(page)
    const s = await read(page)
    expect(s.length).toBe(4)
    expect(new Set(s.map((x) => x.line.color)).size).toBe(4)
    for (const x of s) expect(x.chip, `${x.id}: the legend chip`).toEqual(x.line)
  })
})
