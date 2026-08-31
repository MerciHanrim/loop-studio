import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// fix/timeline-end-label-collisions (+ layout follow-up) — several series ending
// near the same value while the Y-max is large used to pile their endpoint
// value labels into one blob. The dots stay at their real (x, y); only the
// LABELS are laid out to avoid collision, deterministically (sorted by y then
// id). A lone high value keeps its exact spot with no leader; only the crowded
// labels move. When the plot is too short for every label the extras collapse
// into a "+N" chip (legend order wins). This spec runs under BOTH the desktop
// `chromium` project and the 390px `mobile` project.

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 500

/** one series climbs high; N capped pools plateau at close-together values.
 *  `caps[i]` is the plateau value of pool `p${i}` (stable id→value mapping);
 *  `reverse` only changes the ORDER nodes/edges are listed in the JSON. */
const clusterGraph = (bigFlow: number, caps: number[], reverse = false) => {
  const idx = caps.map((_, i) => i)
  const order = reverse ? [...idx].reverse() : idx
  return JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'sBig', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Big tap', activation: 'automatic', mode: 'pushAny' } },
      { id: 'big', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gauge A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      ...order.flatMap((i) => [
        { id: `s${i}`, type: 'source', position: { x: 0, y: 120 + i * 70 }, data: { kind: 'source', label: `t${i}`, activation: 'automatic', mode: 'pushAny' } },
        { id: `p${i}`, type: 'pool', position: { x: 240, y: 120 + i * 70 }, data: { kind: 'pool', label: `P${i}`, activation: 'passive', initial: 0, capacity: caps[i], mode: 'pullAny' } },
      ]),
    ],
    edges: [
      { id: 'eBig', type: 'loop', source: 'sBig', target: 'big', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: String(bigFlow) } },
      ...order.map((i) => ({ id: `e${i}`, type: 'loop', source: `s${i}`, target: `p${i}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '40' } })),
    ],
  })
}

// the reported case: 305 alongside 4 / 5 / 6 / 10 (p0=6, p1=4, p2=10, p3=5)
const G = clusterGraph(1, [6, 4, 10, 5])

const stepK = (page: Page, k: number) =>
  page.evaluate((n) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < n; i++) sim.advance()
  }, k)

const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

/** rendered geometry — labels & leaders in client px (getBoundingClientRect),
 *  plus each label's SVG-space y / dy and each bead's SVG cx/cy. */
function geom(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.timeline__svg') as SVGSVGElement | null
    if (!svg) return null
    const pr = svg.getBoundingClientRect()
    const beads = [...svg.querySelectorAll('circle.timeline__bead')].map((c) => ({
      cx: +(c as SVGCircleElement).getAttribute('cx')!,
      cy: +(c as SVGCircleElement).getAttribute('cy')!,
    }))
    const labels = [...svg.querySelectorAll('text.timeline__endlabel')].map((t) => {
      const r = (t as SVGTextElement).getBoundingClientRect()
      return {
        id: t.getAttribute('data-series'),
        text: t.textContent,
        dy: t.getAttribute('dy'),
        svgY: +t.getAttribute('y')!,
        top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      }
    })
    const leaders = [...svg.querySelectorAll('polyline.timeline__lead')].map((p) => {
      const pts = (p.getAttribute('points') || '').trim().split(/\s+/).map((s) => s.split(',').map(Number))
      return { start: pts[0], end: pts[pts.length - 1] }
    })
    return {
      plot: { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right },
      beads, labels, leaders,
    }
  })
}

const overlaps = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

async function setup(page: Page, graph = G) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
  if (isMobile(page)) {
    const tl = page.locator('.pstrip--mobile .pstrip__tl, .pstrip--mobile button[aria-label*="imeline" i]').first()
    if (await tl.count()) await tl.click().catch(() => {})
  }
  await expect(page.locator('.timeline__svg')).toBeVisible()
}

// enough steps that `big` ≈ 305 and every capped pool is at its cap
const PRIME = 305

test.describe('Timeline — endpoint label collision avoidance', () => {
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: null }).catch(() => {})
  })

  test('no label bbox overlaps another; every label stays inside the plot; one shared baseline', async ({ page }) => {
    await setup(page)
    await stepK(page, PRIME)
    const g = (await geom(page))!
    const real = g.labels.filter((l) => l.id !== '__more__')
    expect(real.length).toBe(5)
    expect(real.map((l) => l.text).sort()).toEqual(['10', '305', '4', '5', '6'])

    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) {
        expect(overlaps(g.labels[i], g.labels[j]), `${g.labels[i].text} vs ${g.labels[j].text}`).toBe(false)
      }
      expect(g.labels[i].top).toBeGreaterThanOrEqual(g.plot.top - 1)
      expect(g.labels[i].bottom).toBeLessThanOrEqual(g.plot.bottom + 1)
      expect(g.labels[i].left).toBeGreaterThanOrEqual(g.plot.left - 1)
    }
    // every endpoint label uses the same vertical anchor (no baseline mixing)
    expect(new Set(g.labels.map((l) => l.dy))).toEqual(new Set(['0.32em']))
  })

  // ── 1. an isolated high value is pinned to its own dot ────────────────────
  test('the lone 305 keeps its endpoint Y and gets NO leader; only the four small labels move; exactly 4 leaders', async ({ page }) => {
    await setup(page)
    await stepK(page, PRIME)
    const g = (await geom(page))!
    // 305 is the highest series ⇒ its bead is the top-most one
    const topBead = [...g.beads].sort((a, b) => a.cy - b.cy)[0]
    const lbl305 = g.labels.find((l) => l.text === '305')!
    // its label's SVG y sits on its dot (within a few px of boundary slack)
    expect(Math.abs(lbl305.svgY - topBead.cy)).toBeLessThan(4)
    // …and no leader touches it (a leader endpoint at the 305 label's y)
    for (const ld of g.leaders) {
      expect(Math.abs(ld.end[1] - lbl305.svgY) < 3, 'a leader ends at the 305 label').toBe(false)
    }
    // the four clustered small labels are the only adjusted ones: exactly 4
    // leaders, every leader starting on one of the four small (bottom) dots
    expect(g.leaders.length).toBe(4)
    const smallDots = [...g.beads].sort((a, b) => a.cy - b.cy).slice(1)
    for (const ld of g.leaders) {
      const onSmall = smallDots.some((b) => Math.hypot(b.cx - ld.start[0], b.cy - ld.start[1]) < 0.75)
      expect(onSmall, `leader from a small-value dot (${ld.start})`).toBe(true)
    }
  })

  // ── 2. mobile — real bounding boxes, both viewport widths ─────────────────
  test('no overlap and inside the chart, verified from rendered bounding boxes', async ({ page }) => {
    // the mobile project already runs this at 390; also force 380 under chromium
    if (!isMobile(page)) await page.setViewportSize({ width: 380, height: 720 })
    await setup(page)
    await stepK(page, PRIME)
    const g = (await geom(page))!
    expect(g.labels.length).toBeGreaterThan(0)
    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) {
        expect(overlaps(g.labels[i], g.labels[j]), `${g.labels[i].text} vs ${g.labels[j].text} @${page.viewportSize()?.width}`).toBe(false)
      }
      expect(g.labels[i].top).toBeGreaterThanOrEqual(g.plot.top - 1)
      expect(g.labels[i].bottom).toBeLessThanOrEqual(g.plot.bottom + 1)
      expect(g.labels[i].right).toBeLessThanOrEqual(g.plot.right + 1)
    }
    expect(new Set(g.labels.map((l) => l.dy))).toEqual(new Set(['0.32em']))
  })

  test('every leader starts exactly on a real endpoint dot', async ({ page }) => {
    await setup(page)
    await stepK(page, PRIME)
    const g = (await geom(page))!
    for (const ld of g.leaders) {
      const hit = g.beads.some((b) => Math.hypot(b.cx - ld.start[0], b.cy - ld.start[1]) < 0.75)
      expect(hit, `leader start ${ld.start} on a bead`).toBe(true)
    }
  })

  test('three identical values are each shown and separated', async ({ page }) => {
    await setup(page, clusterGraph(5, [7, 7, 7]))
    await stepK(page, PRIME)
    const g = (await geom(page))!
    const sevens = g.labels.filter((l) => l.text === '7')
    expect(sevens.length).toBe(3)
    for (let i = 0; i < sevens.length; i++)
      for (let j = i + 1; j < sevens.length; j++) expect(overlaps(sevens[i], sevens[j])).toBe(false)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`no overlap in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await setup(page)
      await stepK(page, PRIME)
      const g = (await geom(page))!
      for (let i = 0; i < g.labels.length; i++)
        for (let j = i + 1; j < g.labels.length; j++) expect(overlaps(g.labels[i], g.labels[j])).toBe(false)
    })
  }

  // ── 3. stability ─────────────────────────────────────────────────────────
  test('305→306, Pause, selection and theme change leave the placement byte-identical; the isolated label stays pinned', async ({ page }) => {
    await setup(page)
    await stepK(page, PRIME)
    const snap = async () =>
      (await geom(page))!.labels.map((l) => [l.id, Math.round(l.svgY), l.dy] as const).sort()
    // `big` is always the highest series ⇒ the top-most bead is its endpoint
    const topBeadCy = async () => [...(await geom(page))!.beads].sort((a, b) => a.cy - b.cy)[0].cy
    const y305 = async () => (await geom(page))!.labels.find((l) => /^30[56]$/.test(l.text ?? ''))!.svgY

    const s0 = await snap()
    await stepK(page, 1) // 305 → 306
    expect(Math.abs((await y305()) - (await topBeadCy()))).toBeLessThan(4) // still on its dot

    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
    const sPause = await snap()
    // selection is a desktop-only rerender trigger (on mobile it swaps the
    // Inspector sheet in for the Timeline sheet)
    if (!isMobile(page)) {
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setSelection('big', null))
      await page.waitForTimeout(60)
      const ids = (s: readonly (readonly [string | null, number, string | null])[]) => s.map((r) => `${r[0]}@${r[1]}/${r[2]}`)
      expect(ids(await snap())).toEqual(ids(sPause))
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(60)
    const ids = (s: readonly (readonly [string | null, number, string | null])[]) => s.map((r) => `${r[0]}@${r[1]}/${r[2]}`)
    expect(ids(await snap())).toEqual(ids(sPause))
    void s0
  })

  test('reversing the series input order gives an identical (y, id) placement', async ({ page }) => {
    await setup(page, clusterGraph(5, [6, 4, 10, 5], false))
    await stepK(page, PRIME)
    const a = Object.fromEntries((await geom(page))!.labels.map((l) => [l.id, Math.round(l.svgY)]))

    await setup(page, clusterGraph(5, [6, 4, 10, 5], true)) // SAME id→value map, nodes/edges listed in reverse
    await stepK(page, PRIME)
    const b = Object.fromEntries((await geom(page))!.labels.map((l) => [l.id, Math.round(l.svgY)]))
    expect(b).toEqual(a)
  })

  // ── 4. space-constrained: deterministic overflow into a "+N" chip ─────────
  test('too many series for the plot ⇒ a "+N" chip; shown labels do not overlap; shown + N === total; deterministic', async ({ page }) => {
    const many = clusterGraph(5, [3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15]) // 12 clustered + big = 13 series
    await setup(page, many)
    await stepK(page, PRIME)
    const g = (await geom(page))!
    const more = g.labels.find((l) => l.id === '__more__')
    expect(more, 'a +N chip is shown').toBeTruthy()
    const shown = g.labels.filter((l) => l.id !== '__more__')
    const n = Number(more!.text!.replace('+', ''))
    expect(shown.length + n).toBe(13) // every series accounted for
    // no overlap among the shown labels + the chip, all inside the plot
    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) expect(overlaps(g.labels[i], g.labels[j])).toBe(false)
      expect(g.labels[i].top).toBeGreaterThanOrEqual(g.plot.top - 1)
      expect(g.labels[i].bottom).toBeLessThanOrEqual(g.plot.bottom + 1)
    }
    // deterministic across a rerender (theme change — safe on mobile too)
    const before = g.labels.map((l) => [l.id, Math.round(l.svgY)]).sort()
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(60)
    const after = (await geom(page))!.labels.map((l) => [l.id, Math.round(l.svgY)]).sort()
    expect(after).toEqual(before)
  })

  test('the endpoint dots and line paths are unchanged by the label layout; digest / undo untouched', async ({ page }) => {
    await setup(page)
    const d0 = await digest(page)
    const undo0 = await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.graph.getState()
      return [s.canUndo, s.canRedo]
    })
    await stepK(page, PRIME)
    const { dots, paths } = await page.evaluate(() => ({
      dots: [...document.querySelectorAll('.timeline__svg circle.timeline__bead')].map((c) => [
        (c as SVGCircleElement).getAttribute('cx'), (c as SVGCircleElement).getAttribute('cy'),
      ]),
      paths: [...document.querySelectorAll('.timeline__svg path.timeline__line:not(.timeline__line--register)')].map((p) => p.getAttribute('d')),
    }))
    for (const [cx, cy] of dots) {
      const onSome = paths.some((d) => (d || '').includes(`${Number(cx).toFixed(1)} ${Number(cy).toFixed(1)}`))
      expect(onSome, `dot ${cx},${cy} is a line's last point`).toBe(true)
    }
    expect(await digest(page)).toBe(d0)
    expect(
      await page.evaluate(() => {
        const s = (window as unknown as Bridge).__loop.graph.getState()
        return [s.canUndo, s.canRedo]
      }),
    ).toEqual(undo0)
  })
})
