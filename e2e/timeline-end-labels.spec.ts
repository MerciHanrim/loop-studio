import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// fix/timeline-end-label-collisions — when several series end at nearly the same
// value while the Y-max is large, their endpoint value labels used to be drawn
// straight on the data Y and piled on top of each other. The dots stay at their
// real (x, y); the LABELS are stacked with a minimum vertical gap and a leader
// line, deterministically (sorted by y then id), and never leave the plot.

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

// one series climbs to ~305; four capped pools plateau at 4 / 5 / 6 / 10 — all
// within ~1px of each other once the axis reaches ~340.
const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'sBig', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Big tap', activation: 'automatic', mode: 'pushAny' } },
    { id: 'big', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gauge A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ...[4, 5, 6, 10].flatMap((n, i) => [
      { id: `s${n}`, type: 'source', position: { x: 0, y: 120 + i * 90 }, data: { kind: 'source', label: `t${n}`, activation: 'automatic', mode: 'pushAny' } },
      { id: `p${n}`, type: 'pool', position: { x: 240, y: 120 + i * 90 }, data: { kind: 'pool', label: `P${n}`, activation: 'passive', initial: 0, capacity: n, mode: 'pullAny' } },
    ]),
  ],
  edges: [
    { id: 'eBig', type: 'loop', source: 'sBig', target: 'big', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    ...[4, 5, 6, 10].map((n) => ({ id: `e${n}`, type: 'loop', source: `s${n}`, target: `p${n}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '20' } })),
  ],
})

const stepK = (page: Page, k: number) =>
  page.evaluate((n) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < n; i++) sim.advance()
  }, k)

const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

/** endpoint dots, labels (client-rect boxes), leaders and plot box */
function endLabelGeom(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.timeline__svg') as SVGSVGElement | null
    if (!svg) return null
    const plot = svg.getBoundingClientRect()
    const beads = [...svg.querySelectorAll('circle.timeline__bead')].map((c) => {
      const r = (c as SVGCircleElement).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    const labels = [...svg.querySelectorAll('text.timeline__endlabel')].map((t) => {
      const r = (t as SVGTextElement).getBoundingClientRect()
      return { id: t.getAttribute('data-series'), text: t.textContent, x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    })
    const leaders = [...svg.querySelectorAll('polyline.timeline__lead')].map((p) => (p.getAttribute('points') || ''))
    return { plot: { top: plot.top, bottom: plot.bottom, left: plot.left, right: plot.right }, beads, labels, leaders }
  })
}

const overlaps = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

async function openMobileTimeline(page: Page) {
  const tl = page.locator('.pstrip--mobile .pstrip__tl, .pstrip--mobile button[aria-label*="imeline" i]').first()
  if (await tl.count()) await tl.click().catch(() => {})
}

async function setup(page: Page, { mobile = false }: { mobile?: boolean } = {}) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
  if (mobile) await openMobileTimeline(page)
  await expect(page.locator('.timeline__svg')).toBeVisible()
}

test.describe('Timeline — endpoint label collision avoidance', () => {
  test('305 + 4/5/6/10 at once: no label bounding box overlaps another; all stay inside the plot', async ({ page }) => {
    await setup(page)
    await stepK(page, 61) // big ≈ 305; the four capped pools sit at 4/5/6/10
    const g = (await endLabelGeom(page))!
    expect(g.labels.length).toBe(5)
    expect(g.labels.map((l) => l.text).sort()).toEqual(['10', '305', '4', '5', '6'])

    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) {
        expect(overlaps(g.labels[i], g.labels[j]), `${g.labels[i].text} vs ${g.labels[j].text}`).toBe(false)
      }
      // inside the plot rect (small tolerance)
      expect(g.labels[i].top).toBeGreaterThanOrEqual(g.plot.top - 1)
      expect(g.labels[i].bottom).toBeLessThanOrEqual(g.plot.bottom + 1)
      expect(g.labels[i].left).toBeGreaterThanOrEqual(g.plot.left - 1)
    }
  })

  test('a leader line joins every displaced label to an actual endpoint dot', async ({ page }) => {
    await setup(page)
    await stepK(page, 61)
    const g = (await endLabelGeom(page))!
    // the clustered small values are displaced ⇒ at least 3 leaders
    expect(g.leaders.length).toBeGreaterThanOrEqual(3)
    // every leader's first point is at a bead's (x, y) in SVG user units
    const firstPts = g.leaders.map((p) => p.trim().split(/\s+/)[0].split(',').map(Number))
    const svgBeads = await page.evaluate(() =>
      [...document.querySelectorAll('.timeline__svg circle.timeline__bead')].map((c) => [
        +(c as SVGCircleElement).getAttribute('cx')!,
        +(c as SVGCircleElement).getAttribute('cy')!,
      ]),
    )
    for (const [lx, ly] of firstPts) {
      const hit = svgBeads.some(([bx, by]) => Math.hypot(bx - lx, by - ly) < 0.75)
      expect(hit, `leader start ${lx},${ly} lands on a bead`).toBe(true)
    }
  })

  test('three identical values are each shown and separated', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'sBig', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'B', activation: 'automatic', mode: 'pushAny' } },
          { id: 'big', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Big', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
          ...[0, 1, 2].flatMap((i) => [
            { id: `s${i}`, type: 'source', position: { x: 0, y: 120 + i * 90 }, data: { kind: 'source', label: `t${i}`, activation: 'automatic', mode: 'pushAny' } },
            { id: `q${i}`, type: 'pool', position: { x: 240, y: 120 + i * 90 }, data: { kind: 'pool', label: `Q${i}`, activation: 'passive', initial: 0, capacity: 7, mode: 'pullAny' } },
          ]),
        ],
        edges: [
          { id: 'eBig', type: 'loop', source: 'sBig', target: 'big', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
          ...[0, 1, 2].map((i) => ({ id: `e${i}`, type: 'loop', source: `s${i}`, target: `q${i}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '20' } })),
        ],
      }),
    )
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await stepK(page, 61)
    const g = (await endLabelGeom(page))!
    const sevens = g.labels.filter((l) => l.text === '7')
    expect(sevens.length).toBe(3)
    for (let i = 0; i < sevens.length; i++)
      for (let j = i + 1; j < sevens.length; j++) expect(overlaps(sevens[i], sevens[j])).toBe(false)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`no overlap in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await setup(page)
      await stepK(page, 61)
      const g = (await endLabelGeom(page))!
      for (let i = 0; i < g.labels.length; i++)
        for (let j = i + 1; j < g.labels.length; j++) expect(overlaps(g.labels[i], g.labels[j])).toBe(false)
      await page.emulateMedia({ colorScheme: null })
    })
  }

  test('mobile width: still no overlap', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 720 })
    await setup(page, { mobile: true })
    await stepK(page, 61)
    const g = (await endLabelGeom(page))!
    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) expect(overlaps(g.labels[i], g.labels[j])).toBe(false)
      expect(g.labels[i].bottom).toBeLessThanOrEqual(g.plot.bottom + 1)
      expect(g.labels[i].top).toBeGreaterThanOrEqual(g.plot.top - 1)
    }
  })

  test('305 → 306, Pause and rerender do not reshuffle the label order', async ({ page }) => {
    await setup(page)
    await stepK(page, 61)
    const order1 = (await endLabelGeom(page))!.labels
      .slice()
      .sort((a, b) => a.y - b.y)
      .map((l) => l.id)
    await stepK(page, 1) // 305 → 306
    const order2 = (await endLabelGeom(page))!.labels
      .slice()
      .sort((a, b) => a.y - b.y)
      .map((l) => l.id)
    expect(order2).toEqual(order1)
    // Pause + force a rerender (selection) — same order, same positions
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
    const geomA = (await endLabelGeom(page))!.labels.map((l) => [l.id, Math.round(l.y)])
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setSelection('big', null))
    await page.waitForTimeout(80)
    const geomB = (await endLabelGeom(page))!.labels.map((l) => [l.id, Math.round(l.y)])
    expect(geomB).toEqual(geomA)
  })

  test('the endpoint dots and the line path are byte-identical to before the label layout; no GraphDoc / digest / undo change', async ({ page }) => {
    await setup(page)
    const d0 = await digest(page)
    const undo0 = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return [g.canUndo, g.canRedo]
    })
    await stepK(page, 61)
    const dots = await page.evaluate(() =>
      [...document.querySelectorAll('.timeline__svg circle.timeline__bead')].map((c) => [
        (c as SVGCircleElement).getAttribute('cx'),
        (c as SVGCircleElement).getAttribute('cy'),
      ]),
    )
    const paths = await page.evaluate(() =>
      [...document.querySelectorAll('.timeline__svg path.timeline__line:not(.timeline__line--register)')].map((p) => p.getAttribute('d')),
    )
    // dots sit exactly on their line's last point
    for (const [cx, cy] of dots) {
      const onSome = paths.some((d) => (d || '').includes(`L ${Number(cx).toFixed(1)} ${Number(cy).toFixed(1)}`) || (d || '').endsWith(`${Number(cx).toFixed(1)} ${Number(cy).toFixed(1)}`))
      expect(onSome, `dot ${cx},${cy} is the last point of a line`).toBe(true)
    }
    expect(await digest(page)).toBe(d0)
    expect(
      await page.evaluate(() => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        return [g.canUndo, g.canRedo]
      }),
    ).toEqual(undo0)
  })
})
