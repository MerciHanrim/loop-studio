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

// docs/node-shell-content-in-vessel.md — the rendered content (chip + title +
// value + `= expr` sub) must sit INSIDE the DRAWN vessel FILL, not just the
// invisible rectangular bounding box. #167 fixed the VERTICAL case (the box
// height now tracks the real stack height + vessel inset + a clear gap), but
// the Parameter / Register left+right edges are ROUNDED and the SVG viewBox is
// a fixed `0 0 120 H` while the CSS box width varies, so on a wide node a
// content corner could still sit inside the bbox yet OUTSIDE the rounded fill.
// The follow-up re-cut both silhouettes to near-full-width rounded rectangles
// and gave the two bodies a width-scaled `padding-inline`, so every content
// corner is now path-verified inside the fill with a CSS-px safety margin.
test.describe('content ⊂ vessel — path-aware (isPointInFill)', () => {
  // long titles are widened by a unit / expr so they wrap to ≤ 2 lines and
  // never hit MAX_NODE_H (that ceiling clamp is a separate, pre-existing
  // tradeoff — asserted against below so a fixture that starts clamping fails
  // loudly instead of silently changing what this test exercises).
  const SHELL = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'poolPlain', type: 'pool', position: { x: 40, y: 40 }, data: { kind: 'pool', label: 'Wallet', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
      { id: 'poolCap', type: 'pool', position: { x: 300, y: 40 }, data: { kind: 'pool', label: 'Savings', activation: 'passive', initial: 34, capacity: 100, mode: 'pullAny' } },
      { id: 'src', type: 'source', position: { x: 560, y: 40 }, data: { kind: 'source', label: 'Activity', activation: 'automatic', mode: 'pushAny' } },
      { id: 'param', type: 'parameter', position: { x: 40, y: 240 }, data: { kind: 'parameter', label: 'Daily rate', value: 12.5, unit: 'kKRW/day' } },
      { id: 'paramBare', type: 'parameter', position: { x: 300, y: 240 }, data: { kind: 'parameter', label: 'Target', value: 100 } },
      // wide parameter — a long title + a big value + unit push it near its
      // widest, so the rounded left/right corners are exercised
      { id: 'paramWide', type: 'parameter', position: { x: 560, y: 240 }, data: { kind: 'parameter', label: 'Projected operating margin', value: 3468.2, unit: 'kKRW/day' } },
      { id: 'regNoExpr', type: 'register', position: { x: 40, y: 440 }, data: { kind: 'register', label: 'X', expr: '1', format: 'integer' } },
      { id: 'regExpr', type: 'register', position: { x: 300, y: 440 }, data: { kind: 'register', label: 'Net worth', expr: '@poolPlain + @poolCap', format: 'integer' } },
      { id: 'regUnit', type: 'register', position: { x: 620, y: 440 }, data: { kind: 'register', label: 'Progress to target', expr: '@poolCap / @paramBare', format: 'percent', unit: '%' } },
      // the worst case: a long `= expr` (no break opportunity) drives the node
      // to its 260 px max-width, so the content bbox reaches deepest toward
      // BOTH rounded ends
      { id: 'regWide', type: 'register', position: { x: 40, y: 640 }, data: { kind: 'register', label: 'Bleed rate', expr: '@poolPlain + @poolCap + @regExpr - 300 + @poolCap - @regNoExpr + 42', format: 'integer' } },
    ],
    edges: [],
  })

  // For every parameter / register node: map the 4 corners of the content AABB
  // (`.nodef__stack`) AND the 4 corners of `.nodef__chip` into viewBox space and
  // walk each one OUTWARD (away from the node centre) against `.nodef__fill`
  // (`SVGGeometryElement.isPointInFill`). Reports the smallest surviving margin
  // in CSS px. A negative margin = that corner is already outside the fill.
  async function fillMargins(page: Page) {
    return page.evaluate(() => {
      const out: Record<
        string,
        { kind: string; w: number; h: number; boxH: number; minMarginCss: number; clamped: boolean; subEllipsis: boolean }
      > = {}
      for (const nf of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = nf.getAttribute('data-id')!
        const el = nf.querySelector('.nodef') as HTMLElement | null
        if (!el) continue
        const kind = (el.className.match(/nodef--(\w+)/) || [])[1]
        if (kind !== 'parameter' && kind !== 'register') continue
        const svg = nf.querySelector('.nodef__shape') as SVGSVGElement
        const fill = nf.querySelector('.nodef__fill') as SVGGeometryElement
        const stack = nf.querySelector('.nodef__stack') as HTMLElement
        const chip = nf.querySelector('.nodef__chip') as HTMLElement
        const sub = nf.querySelector('.nodef__sub') as HTMLElement | null
        const vb = svg.viewBox.baseVal
        const box = svg.getBoundingClientRect()
        const sx = box.width / vb.width
        const sy = box.height / vb.height
        const toVB = (cx: number, cy: number) => ({
          x: vb.x + ((cx - box.left) / box.width) * vb.width,
          y: vb.y + ((cy - box.top) / box.height) * vb.height,
        })
        const cornersVB = (elm: Element) => {
          const r = elm.getBoundingClientRect()
          const a = toVB(r.left, r.top)
          const b = toVB(r.right, r.bottom)
          return [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
          ]
        }
        const pts = [...cornersVB(stack), ...cornersVB(chip)]
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        const P = svg.createSVGPoint()
        const inside = (x: number, y: number) => {
          P.x = x
          P.y = y
          return fill.isPointInFill(P)
        }
        let minMarginCss = Infinity
        for (const p of pts) {
          const dx = Math.sign(p.x - cx)
          const dy = Math.sign(p.y - cy)
          if (!inside(p.x, p.y)) {
            minMarginCss = -0.5
            break
          }
          let m = 0
          for (let k = 0.25; k <= 16; k += 0.25) {
            if (!inside(p.x + dx * (k / sx), p.y + dy * (k / sy))) break
            m = k
          }
          minMarginCss = Math.min(minMarginCss, m)
        }
        const title = nf.querySelector('.nodef__title') as HTMLElement | null
        const value = nf.querySelector('.nodef__value') as HTMLElement | null
        out[id] = {
          kind,
          w: Math.round(el.offsetWidth),
          h: Math.round(el.offsetHeight),
          boxH: vb.height,
          minMarginCss: +minMarginCss.toFixed(2),
          clamped: vb.height >= 120, // MAX_NODE_H.parameter / .register
          subEllipsis: sub ? sub.scrollWidth > sub.clientWidth + 1 : false,
          titleEllipsis: title ? title.scrollWidth > title.clientWidth + 1 : false,
          valueEllipsis: value ? value.scrollWidth > value.clientWidth + 1 : false,
        }
      }
      return out
    })
  }

  for (const loc of ['en', 'ko', 'ja'] as const) {
    test(`every parameter / register corner is inside the fill — ${loc}`, async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await page.evaluate((l) => (window as any).__loop.i18n.getState().setLocale(l), loc)
      await importGraph(page, SHELL)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(450)
      const m = await fillMargins(page)
      // param + paramBare + paramWide + regNoExpr + regExpr + regUnit + regWide
      expect(Object.keys(m).length).toBe(7)
      for (const [id, v] of Object.entries(m)) {
        // the fixture must exercise the curve corners, NOT the MAX_NODE_H clamp
        expect(v.clamped, `${id} unexpectedly at the height ceiling — re-widen the fixture`).toBe(false)
        // every stack + chip corner is inside the drawn fill with ≥ 2 CSS px to
        // spare (measured margin is 3.25 – 3.75; a plain "point in fill" test
        // would pass with zero clearance, which is the bug this replaces)
        expect(
          v.minMarginCss,
          `${id} (${v.kind}, ${v.w}px) nearest content corner vs fill boundary`,
        ).toBeGreaterThanOrEqual(2)
        // the title / value / unit never ellipsise (§MML1 — only the `= expr`
        // sub line may, and only at max width; a NEW title/value clip would mean
        // the width-scaled inset stole readable space)
        expect(v.titleEllipsis, `${id} title must not clip`).toBe(false)
        expect(v.valueEllipsis, `${id} value must not clip`).toBe(false)
      }
      // the 260 px register ellipsises its long `= expr` — the documented cost
      // of the width-scaled inset (docs/node-shell-content-in-vessel.md)
      expect(m.regWide.w).toBeGreaterThanOrEqual(240)
      expect(m.regWide.subEllipsis, 'regWide expr ellipsises at max width').toBe(true)
    })
  }

  // #167 regression — the vertical containment it fixed must still hold: the
  // content AABB clears the drawn stroke top and bottom.
  for (const loc of ['en', 'ko', 'ja'] as const) {
    test(`content clears the vessel top / bottom — ${loc}`, async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await page.evaluate((l) => (window as any).__loop.i18n.getState().setLocale(l), loc)
      await importGraph(page, SHELL)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(450)
      const s = await page.evaluate(() => {
        const out: Record<string, { kind: string; top: number; bot: number }> = {}
        for (const nf of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
          const id = nf.getAttribute('data-id')!
          const kind = (nf.querySelector('.nodef')?.className.match(/nodef--(\w+)/) || [])[1]
          const stroke = nf.querySelector('.nodef__stroke') as SVGPathElement
          const stack = nf.querySelector('.nodef__stack') as HTMLElement
          if (!stroke || !stack) continue
          const v = stroke.getBoundingClientRect()
          const c = stack.getBoundingClientRect()
          out[id] = { kind, top: +(v.top - c.top).toFixed(1), bot: +(c.bottom - v.bottom).toFixed(1) }
        }
        return out
      })
      expect(Object.keys(s).length).toBe(10)
      for (const [id, v] of Object.entries(s)) {
        expect(v.top, `${id} (${v.kind}) content top vs stroke`).toBeLessThanOrEqual(-3)
        expect(v.bot, `${id} (${v.kind}) content bottom vs stroke`).toBeLessThanOrEqual(-3)
      }
    })
  }

  test('a Source / plain Pool are unchanged — still the 64 px base box', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, SHELL)
    await page.waitForTimeout(300)
    const h = await page.evaluate(() => ({
      src: (document.querySelector('.react-flow__node[data-id="src"] .nodef') as HTMLElement).offsetHeight,
      poolPlain: (document.querySelector('.react-flow__node[data-id="poolPlain"] .nodef') as HTMLElement).offsetHeight,
    }))
    expect(h.src).toBe(64)
    expect(h.poolPlain).toBe(64)
  })
})
