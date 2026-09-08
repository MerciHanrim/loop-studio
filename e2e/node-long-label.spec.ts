import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/mmo-multilingual-layout.md §MML1 — the general node renderer must keep a
// long title inside the box:
//   • an official-length label wraps to AT MOST TWO lines around the ~135 px
//     soft-max, the box GROWS in height to fit (never past the per-kind
//     ceiling), the title stays clear of the value / sub rows, and the handles
//     re-centre on the grown box;
//   • an abnormally long SINGLE token (no break opportunity) is the last-resort
//     case — it may force-break, but it must never spill outside the silhouette;
//   • a pathologically long multi-word label may wrap to many lines, but the
//     text still must not overflow the vessel sideways and the silhouette must
//     stay intact.
// Same rules for a user-authored node — this graph is a plain import.

// the longest label shipped in any bundled template is "Cafe & retail bean
// demand (kg/day)" (33 chars) — it must wrap to at most two lines
const OFFICIAL_LONG = 'Cafe & retail bean demand (kg/day)'
// longer than any real label — graceful degradation: wraps to > 2 lines, still
// no sideways spill, silhouette intact
const OVERLONG = 'Cumulative regional wholesale distribution demand measured in kilograms per operating day'
const HUGE_TOKEN = 'Supercalifragilisticexpialidocious' + 'antidisestablishmentarianism'.repeat(2)
// docs/visual-language.md §VL11.2 — the multi-script / CJK / Cyrillic / emoji
// stress string. It lives HERE (a DOM functional test), not in the pixel matrix,
// because its glyphs depend on the runner's installed OS fonts. The guarantees
// are the same as any long label: the full string is kept on the element, it
// never spills sideways out of the vessel, the silhouette grows to fit, and the
// resource handles re-centre on the grown box.
const MULTISCRIPT = "Trésor d'or — a deliberately very long label that overflows · 黄金の保管庫 · Хранилище · 🪙"

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'short', type: 'pool', position: { x: 40, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'official', type: 'pool', position: { x: 40, y: 240 }, data: { kind: 'pool', label: OFFICIAL_LONG, activation: 'passive', initial: 42, capacity: null, mode: 'pullAny' } },
    { id: 'token', type: 'pool', position: { x: 40, y: 440 }, data: { kind: 'pool', label: HUGE_TOKEN, activation: 'passive', initial: 7, capacity: null, mode: 'pullAny' } },
    { id: 'overlong', type: 'pool', position: { x: 40, y: 640 }, data: { kind: 'pool', label: OVERLONG, activation: 'passive', initial: 1, capacity: null, mode: 'pullAny' } },
    { id: 'multiscript', type: 'pool', position: { x: 40, y: 840 }, data: { kind: 'pool', label: MULTISCRIPT, activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } },
  ],
  edges: [],
})

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

async function box(page: Page, id: string) {
  return page.evaluate((nid) => {
    const wrap = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!
    const nf = wrap.querySelector('.nodef') as HTMLElement
    const title = wrap.querySelector('.nodef__title') as HTMLElement
    const shape = wrap.querySelector('.nodef__shape') as SVGSVGElement
    const value = wrap.querySelector('.nodef__value') as HTMLElement | null
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null)
    const lineH = parseFloat(getComputedStyle(title).lineHeight) || 16
    return {
      boxW: nf.offsetWidth,
      boxH: nf.offsetHeight,
      titleLines: Math.round(title.offsetHeight / lineH),
      titleScrollW: title.scrollWidth,
      titleClientW: title.clientWidth,
      viewBox: shape.getAttribute('viewBox'),
      nfRect: r(nf),
      titleRect: r(title),
      valueRect: r(value),
    }
  }, id)
}

test.describe('§MML1 — long node labels stay inside the box', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GRAPH)
    await expect(node(page, 'overlong')).toBeVisible()
    // pin zoom to 1 so getBoundingClientRect() px == flow px (the RF zoom
    // transform is on an ancestor); every node stays on screen at x 40, y 40–640
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: 240, y: 20, zoom: 1 },
        { duration: 0 },
      ),
    )
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250) // let the ResizeObserver grow-pass settle
  })

  test('a short label is unchanged — one line, 64 px box', async ({ page }) => {
    const b = await box(page, 'short')
    expect(b.titleLines).toBe(1)
    expect(b.boxH).toBe(64)
    expect(b.viewBox).toBe('0 0 120 64')
  })

  test('an official-length label wraps to ≤ 2 lines and the box grows to fit', async ({ page }) => {
    const b = await box(page, 'official')
    expect(b.titleLines).toBeLessThanOrEqual(2)
    expect(b.titleLines).toBeGreaterThan(1)
    expect(b.titleScrollW, 'no sideways overflow').toBeLessThanOrEqual(b.titleClientW + 1)
    expect(b.boxH, 'box grew past the base').toBeGreaterThan(64)
    expect(b.boxH, 'but not past the pool ceiling (MAX_NODE_H.pool)').toBeLessThanOrEqual(132)
    expect(b.viewBox, 'silhouette redrawn at the grown height').toBe(`0 0 120 ${b.boxH}`)
    expect(b.titleRect!.bottom, 'title clears the value row').toBeLessThanOrEqual(b.valueRect!.top + 0.5)
    expect(b.titleRect!.right, 'title stays inside the box').toBeLessThanOrEqual(b.nfRect!.right + 1)
  })

  test('an abnormally long single token never escapes the silhouette', async ({ page }) => {
    const b = await box(page, 'token')
    // the token force-broke to stay inside — no horizontal overflow of the title
    expect(b.titleScrollW).toBeLessThanOrEqual(b.titleClientW + 2)
    // the glyphs stay within the node box on every side
    expect(b.titleRect!.left).toBeGreaterThanOrEqual(b.nfRect!.left - 1)
    expect(b.titleRect!.right).toBeLessThanOrEqual(b.nfRect!.right + 1)
    expect(b.titleRect!.bottom).toBeLessThanOrEqual(b.nfRect!.bottom + 1)
    expect(b.viewBox).toBe(`0 0 120 ${b.boxH}`)
    expect(b.boxH).toBeLessThanOrEqual(132)
  })

  test('a pathologically long multi-word label wraps but the vessel stays intact', async ({ page }) => {
    const b = await box(page, 'overlong')
    // many lines are allowed here (it is longer than any real label) — the
    // guarantees are: no sideways spill, and the silhouette viewBox matches the
    // box height (the vessel is not torn)
    expect(b.titleScrollW).toBeLessThanOrEqual(b.titleClientW + 2)
    expect(b.titleRect!.left).toBeGreaterThanOrEqual(b.nfRect!.left - 1)
    expect(b.titleRect!.right).toBeLessThanOrEqual(b.nfRect!.right + 1)
    expect(b.viewBox).toBe(`0 0 120 ${b.boxH}`)
    expect(b.boxH).toBeLessThanOrEqual(132)
  })

  test('handles re-centre on the grown box; the selection ring uses the grown height', async ({ page }) => {
    const b = await box(page, 'official')
    // the left/right RESOURCE ports (not the top/bottom state ports) sit on the
    // vertical centre of the GROWN box
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.react-flow__node[data-id="official"]') as HTMLElement
      const nf = wrap.querySelector('.nodef') as HTMLElement
      const nfR = nf.getBoundingClientRect()
      const ports = [...wrap.querySelectorAll('.h--in, .h--out')].map((h) => {
        const r = h.getBoundingClientRect()
        return (r.top + r.bottom) / 2 - nfR.top
      })
      return { ports, nfH: nf.offsetHeight, wrapH: wrap.offsetHeight }
    })
    expect(m.ports.length).toBeGreaterThan(0)
    // the RF node wrapper tracks the grown box height…
    expect(Math.abs(m.wrapH - m.nfH)).toBeLessThanOrEqual(2)
    // …and each resource port is on that grown box's vertical centre
    for (const cy of m.ports) expect(Math.abs(cy - b.boxH / 2)).toBeLessThanOrEqual(8)

    await node(page, 'official').click()
    await expect(node(page, 'official').locator('.nodef__sel')).toBeVisible()
    const selVB = await page.evaluate(() =>
      document
        .querySelector('.react-flow__node[data-id="official"] .nodef__shape')!
        .getAttribute('viewBox'),
    )
    expect(selVB).toBe(`0 0 120 ${b.boxH}`)
  })

  test('a multi-script / CJK / Cyrillic / emoji label — full string kept, no spill, vessel grows, handles re-centre', async ({ page }) => {
    // bring the multiscript node (flow y 840) fully on screen at zoom 1
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: 240, y: -640, zoom: 1 },
        { duration: 0 },
      ),
    )
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)

    // the WHOLE string is on the element — nothing is dropped for AT
    await expect(node(page, 'multiscript').locator('.nodef__title')).toHaveText(MULTISCRIPT)

    const b = await box(page, 'multiscript')
    expect(b.titleScrollW, 'no sideways overflow').toBeLessThanOrEqual(b.titleClientW + 2)
    expect(b.titleRect!.left).toBeGreaterThanOrEqual(b.nfRect!.left - 1)
    expect(b.titleRect!.right).toBeLessThanOrEqual(b.nfRect!.right + 1)
    expect(b.titleRect!.bottom).toBeLessThanOrEqual(b.nfRect!.bottom + 1)
    expect(b.boxH, 'the vessel grew to fit').toBeGreaterThan(64)
    expect(b.boxH, 'but not past the pool ceiling').toBeLessThanOrEqual(132)
    expect(b.viewBox, 'silhouette redrawn at the grown height').toBe(`0 0 120 ${b.boxH}`)

    // the resource ports sit on the vertical centre of the GROWN box
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.react-flow__node[data-id="multiscript"]') as HTMLElement
      const nf = wrap.querySelector('.nodef') as HTMLElement
      const nfR = nf.getBoundingClientRect()
      const ports = [...wrap.querySelectorAll('.h--in, .h--out')].map((h) => {
        const r = h.getBoundingClientRect()
        return (r.top + r.bottom) / 2 - nfR.top
      })
      return { ports, nfH: nf.offsetHeight, wrapH: wrap.offsetHeight }
    })
    expect(m.ports.length).toBeGreaterThan(0)
    expect(Math.abs(m.wrapH - m.nfH)).toBeLessThanOrEqual(2)
    for (const cy of m.ports) expect(Math.abs(cy - b.boxH / 2)).toBeLessThanOrEqual(8)
  })

  test('renders in dark mode without sideways clipping', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await importGraph(page, GRAPH)
    await expect(node(page, 'official')).toBeVisible()
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: 240, y: 20, zoom: 1 },
        { duration: 0 },
      ),
    )
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const b = await box(page, 'official')
    expect(b.titleLines).toBeLessThanOrEqual(2)
    expect(b.titleRect!.right).toBeLessThanOrEqual(b.nfRect!.right + 1)
  })
})
