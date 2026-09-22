import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/large-graph-readability.md §LGR9 — the Activity overlay's edge tell
// under `forced-colors: active`, measured 2026-09-19 (two rounds, see the
// §LGR9 note): the old `1 3` round-cap dash (1.5 px gaps) read as a solid
// line at every zoom, the edge stroke stayed a 2.2:1 grey (an inline `stroke`
// is not force-adjusted), and a state edge's inline `4 4` beat the forced
// rule entirely. The contract now:
//   active resource  stroke Highlight · dasharray 6 3 2 3 · butt · filter none
//   active state     stroke Highlight · dasharray 8 4     · butt · filter none · opacity 1
//   inactive resource / state: unchanged (solid grey / `4 4` grey)
// Official shape-tell range: zoom 0.4–1.0. mmo's fit-view zoom (≈ 0.255) is
// recorded as an observation only (colour tell), never gated.
//
// The pixel check is a 2-D dash count on a clean stretch (any ink within ±2 px
// of the path per sample, runs of such samples = dashes) — NOT a 1-D
// transition count, which has a false-transition floor on an anti-aliased
// solid line.

test.use({ contextOptions: { forcedColors: 'active' } })

type Pt = { x: number; y: number }

const edgePath = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)
const activityBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-activity')

async function loadFixture(page: Page, file: string): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'))
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.evaluate(() => (window as unknown as { __loop: { rf: { fitView: (o: object) => void } } }).__loop.rf.fitView({ duration: 0, padding: 0.1 }))
  await page.waitForTimeout(300)
}
async function commitSteps(page: Page, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce())
    await page.waitForFunction((k) => (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex >= k, i)
  }
  await page.waitForTimeout(250)
}
/** the system colour `Highlight` as this browser paints it (a probe element) */
const highlightRgb = (page: Page) =>
  page.evaluate(() => {
    const el = document.createElement('div')
    el.style.color = 'Highlight'
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  })
const styleOf = (page: Page, id: string) =>
  edgePath(page, id).evaluate((el) => {
    const c = getComputedStyle(el)
    return { stroke: c.stroke, dash: c.strokeDasharray, cap: c.strokeLinecap, width: c.strokeWidth, filter: c.filter, opacity: c.opacity, vectorEffect: c.vectorEffect }
  })
/** centre the viewport on the edge's mid point at `zoom` (no animation) */
async function centreOn(page: Page, id: string, zoom: number): Promise<void> {
  await page.evaluate(
    ([eid, z]) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`) as SVGPathElement
      const q = p.getPointAtLength(p.getTotalLength() / 2)
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: pane.width / 2 - q.x * (z as number), y: pane.height / 2 - q.y * (z as number), zoom: z as number },
        { duration: 0 },
      )
    },
    [id, zoom] as const,
  )
  await page.waitForTimeout(160)
}
/** screen-space points along the edge at 1 px spacing */
const pathPoints = (page: Page, id: string) =>
  page.evaluate((eid) => {
    const p = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`) as SVGPathElement
    const L = p.getTotalLength()
    const m = p.getScreenCTM()!
    const scale = Math.hypot(m.a, m.b)
    const pts: { x: number; y: number }[] = []
    for (let s = 0; s <= L; s += 1 / scale) {
      const q = p.getPointAtLength(s)
      pts.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f })
    }
    return pts
  }, id)
/** 2-D dash count. The band = every pixel within ±2 px of the path's normal
 *  for samples [a, b). Ink = band pixels whose colour distance from the canvas
 *  ≥ `thr`. Dashes = 8-connected components of ink inside the band; `meanLen`
 *  = mean component size in samples-along-the-path (reach-2 connectivity, so
 *  anti-aliasing breaks inside a dash do not split it). A solid line is ONE
 *  component whatever its angle. */
const dashCount = (page: Page, png: Buffer, pts: Pt[], a: number, b: number, thr: number, reach = 1) =>
  page.evaluate(
    async ({ b64, pts, a, b, thr, reach }) => {
      const im = new Image()
      im.src = `data:image/png;base64,${b64}`
      await im.decode()
      const cv = document.createElement('canvas')
      cv.width = im.width
      cv.height = im.height
      const cx = cv.getContext('2d')!
      cx.drawImage(im, 0, 0)
      const d = cx.getImageData(0, 0, cv.width, cv.height).data
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      const at = (x: number, y: number) => {
        const i = (y * cv.width + x) * 4
        return [d[i], d[i + 1], d[i + 2]]
      }
      const bg = at(Math.round(pane.right - 3), Math.round(pane.top + 3))
      const dist = (c: number[]) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) / 255
      // band pixels → the sample index they belong to (first wins)
      const band = new Map<number, number>()
      for (let i = a; i < b && i < pts.length; i++) {
        const p0 = pts[Math.max(0, i - 1)]
        const p1 = pts[Math.min(pts.length - 1, i + 1)]
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1
        const nx = -(p1.y - p0.y) / len
        const ny = (p1.x - p0.x) / len
        for (const o of [-2, -1, 0, 1, 2]) {
          const x = Math.round(pts[i].x + nx * o)
          const y = Math.round(pts[i].y + ny * o)
          const key = y * cv.width + x
          if (!band.has(key)) band.set(key, i)
        }
      }
      const ink = new Set<number>()
      for (const key of band.keys()) {
        const x = key % cv.width
        const y = Math.floor(key / cv.width)
        if (dist(at(x, y)) >= thr) ink.add(key)
      }
      // 8-connected components over the ink set
      const seen = new Set<number>()
      const sizes: number[] = []
      for (const start of ink) {
        if (seen.has(start)) continue
        const stack = [start]
        seen.add(start)
        const idx = new Set<number>()
        while (stack.length) {
          const k = stack.pop()!
          idx.add(band.get(k)!)
          const x = k % cv.width
          const y = Math.floor(k / cv.width)
          // `reach` 1 = plain 8-connectivity (a 3 px gap stays a gap); 2 also bridges
          // the 1 px anti-aliasing breaks a 1 px-wide stroke shows inside a dash
          for (let dy = -reach; dy <= reach; dy++)
            for (let dx = -reach; dx <= reach; dx++) {
              const nk = (y + dy) * cv.width + (x + dx)
              if (ink.has(nk) && !seen.has(nk)) {
                seen.add(nk)
                stack.push(nk)
              }
            }
        }
        sizes.push(idx.size)
      }
      const inkShare = band.size ? ink.size / band.size : 0
      const meanLen = sizes.length ? sizes.reduce((x, y) => x + y, 0) / sizes.length : 0
      return { runs: sizes.length, inkShare, meanLen, n: b - a }
    },
    { b64: png.toString('base64'), pts, a, b, thr, reach },
  )
type Dash = { runs: number; inkShare: number; meanLen: number; n: number }

/** the 80-sample stretch of the edge with the most plain-stroke ink in the
 *  OFF screenshot (the edge may pass under nodes / labels elsewhere), kept
 *  inside the pane — and that stretch's own OFF measurement, at the caller's
 *  threshold and reach.
 *
 *  ONE trip, ONE decode: every candidate window is scored against a single
 *  decode of this screenshot instead of re-sending the same PNG and the same
 *  point array per window. The arithmetic below is unchanged — same band, same
 *  background sample, 0.15 / reach 1 for scoring, `inkShare - 0.05 * runs`,
 *  width 80, stride 20, first window wins a tie. */
async function cleanStretch(
  page: Page,
  offPng: Buffer,
  pts: Pt[],
  offThr: number,
  offReach: number,
): Promise<{ stretch: [number, number]; off: Dash } | null> {
  return page.evaluate(
    async ({ b64, pts, offThr, offReach }) => {
      const im = new Image()
      im.src = `data:image/png;base64,${b64}`
      await im.decode()
      const cv = document.createElement('canvas')
      cv.width = im.width
      cv.height = im.height
      const cx = cv.getContext('2d')!
      cx.drawImage(im, 0, 0)
      const d = cx.getImageData(0, 0, cv.width, cv.height).data
      const rect = document.querySelector('.react-flow')!.getBoundingClientRect()
      const at = (x: number, y: number) => {
        const i = (y * cv.width + x) * 4
        return [d[i], d[i + 1], d[i + 2]]
      }
      const bg = at(Math.round(rect.right - 3), Math.round(rect.top + 3))
      const dist = (c: number[]) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) / 255
      const scan = (a: number, b: number, thr: number, reach: number) => {
        const band = new Map<number, number>()
        for (let i = a; i < b && i < pts.length; i++) {
          const p0 = pts[Math.max(0, i - 1)]
          const p1 = pts[Math.min(pts.length - 1, i + 1)]
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1
          const nx = -(p1.y - p0.y) / len
          const ny = (p1.x - p0.x) / len
          for (const o of [-2, -1, 0, 1, 2]) {
            const x = Math.round(pts[i].x + nx * o)
            const y = Math.round(pts[i].y + ny * o)
            const key = y * cv.width + x
            if (!band.has(key)) band.set(key, i)
          }
        }
        const ink = new Set<number>()
        for (const key of band.keys()) {
          const x = key % cv.width
          const y = Math.floor(key / cv.width)
          if (dist(at(x, y)) >= thr) ink.add(key)
        }
        const seen = new Set<number>()
        const sizes: number[] = []
        for (const start of ink) {
          if (seen.has(start)) continue
          const stack = [start]
          seen.add(start)
          const idx = new Set<number>()
          while (stack.length) {
            const k = stack.pop()!
            idx.add(band.get(k)!)
            const x = k % cv.width
            const y = Math.floor(k / cv.width)
            for (let dy = -reach; dy <= reach; dy++)
              for (let dx = -reach; dx <= reach; dx++) {
                const nk = (y + dy) * cv.width + (x + dx)
                if (ink.has(nk) && !seen.has(nk)) {
                  seen.add(nk)
                  stack.push(nk)
                }
              }
          }
          sizes.push(idx.size)
        }
        return {
          runs: sizes.length,
          inkShare: band.size ? ink.size / band.size : 0,
          meanLen: sizes.length ? sizes.reduce((x, y) => x + y, 0) / sizes.length : 0,
          n: b - a,
        }
      }
      const W = 80
      const pane = { left: rect.left + 48, top: rect.top + 2, right: rect.right - 2, bottom: rect.bottom - 2 }
      let best: [number, number] | null = null
      let bestShare = -1
      for (let a = 0; a + W <= pts.length; a += 20) {
        const inside = pts.slice(a, a + W).every((p) => p.x > pane.left && p.x < pane.right && p.y > pane.top && p.y < pane.bottom)
        if (!inside) continue
        const { inkShare, runs } = scan(a, a + W, 0.15, 1)
        const score = inkShare - 0.05 * runs // a stretch under a label/crossing breaks into pieces
        if (score > bestShare) {
          bestShare = score
          best = [a, a + W]
        }
      }
      if (!best) return null
      return { stretch: best, off: scan(best[0], best[1], offThr, offReach) }
    },
    { b64: offPng.toString('base64'), pts, offThr, offReach },
  )
}

/** the N longest ACTIVE edges of a class (screen length at the current zoom) — independent of
 *  which edges a fixture happens to fire, and long enough to hold several dash periods */
const longestActive = (page: Page, cls: 'edge-resource' | 'edge-state', n: number) =>
  page.evaluate(
    ({ cls, n }) =>
      [...document.querySelectorAll(`path.react-flow__edge-path.lgr-active-tint.${cls}`)]
        .map((p) => ({ id: p.closest('.react-flow__edge')!.getAttribute('data-id')!, len: (p as SVGPathElement).getTotalLength() }))
        .sort((a, b) => b.len - a.len)
        .slice(0, n)
        .map((e) => e.id),
    { cls, n },
  )

/** Every mmo state edge fires on step 1 and stays tinted, so a genuinely INACTIVE state edge has to
 *  be injected: two isolated pools (nothing feeds them, nothing they feed) joined by a trigger edge,
 *  placed just below the midpoint of `nearEdgeId` so it sits inside that edge's capture frame. */
async function injectIdleStateEdge(page: Page, nearEdgeId: string): Promise<string> {
  return page.evaluate((near) => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[]; edges: { id: string }[] }; setState: (p: object) => void } } }).__loop.graph
    const p = document.querySelector(`.react-flow__edge[data-id="${near}"] path.react-flow__edge-path`) as SVGPathElement
    const q = p.getPointAtLength(p.getTotalLength() / 2)
    const st = g.getState()
    const mk = (id: string, x: number, y: number) => ({
      id,
      type: 'pool',
      position: { x, y },
      data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
    })
    const edge = { id: 'e_idle_state', type: 'loop', source: 'idle_a', target: 'idle_b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'state', mode: 'trigger' } }
    g.setState({ nodes: [...st.nodes, mk('idle_a', q.x - 200, q.y + 70), mk('idle_b', q.x + 80, q.y + 70)], edges: [...st.edges, edge] })
    return edge.id
  }, nearEdgeId)
}
/** Give a LIVE edge a manual waypoint inside another node: the router refuses it (§ER4) and the
 *  edge gets `route-invalid` + the `!` flag while keeping whatever activity tint it already has. */
async function makeRouteInvalid(page: Page, edgeId: string): Promise<void> {
  await page.evaluate((id) => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[]; edges: { id: string; source: string; target: string; data: Record<string, unknown> }[]; setEdgeData: (id: string, d: object) => void } } } }).__loop.graph.getState()
    const e = g.edges.find((x) => x.id === id)!
    const obstacle = g.nodes.find((n) => n.id !== e.source && n.id !== e.target)!
    g.setEdgeData(id, { ...e.data, route: 'orthogonal', waypoints: [{ x: obstacle.position.x + 30, y: obstacle.position.y + 20 }] })
  }, edgeId)
  await expect(page.locator(`.react-flow__edge[data-id="${edgeId}"] path.route-invalid`)).toHaveCount(1)
}

/** Hide every text span drawn inside a node (title / value / sub-line) for a capture whose subject
 *  is the edges. `visibility: hidden` removes only the glyphs — the node shapes and any edge passing
 *  under a label keep every pixel, unlike a `mask` box. Under forced colours `color` is
 *  force-adjusted, so this is the one property that reliably takes the text out. */
const NODE_TEXT = '.nodef__title, .nodef__value, .nodef__sub'
async function hideNodeText(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.addStyleTag({ content: `${NODE_TEXT} { visibility: hidden }` })
  // the spans to hide really exist inside the clip, and every one of them computes `hidden`
  const r = await page.evaluate(
    ({ sel, c }) => {
      const all = [...document.querySelectorAll(sel)]
      const inClip = all.filter((el) => {
        const b = el.getBoundingClientRect()
        return b.right > c.x && b.left < c.x + c.width && b.bottom > c.y && b.top < c.y + c.height
      })
      return { inClip: inClip.length, notHidden: all.filter((el) => getComputedStyle(el).visibility !== 'hidden').length }
    },
    { sel: NODE_TEXT, c: clip },
  )
  expect(r.inClip, 'node text spans exist inside the clip').toBeGreaterThan(0)
  expect(r.notHidden, 'every node text span computes visibility: hidden').toBe(0)
}
/** Which edge categories have a path bbox intersecting the clip. */
const categoriesIn = (page: Page, clip: { x: number; y: number; width: number; height: number }) =>
  page.evaluate((c) => {
    const inClip = (p: Element) => {
      const r = p.getBoundingClientRect()
      return r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height
    }
    const has = (sel: string) => [...document.querySelectorAll(sel)].some(inClip)
    return {
      activeResource: has('path.react-flow__edge-path.edge-resource.lgr-active-tint'),
      activeState: has('path.react-flow__edge-path.edge-state.lgr-active-tint'),
      inactiveState: has('path.react-flow__edge-path.edge-state:not(.lgr-active-tint)'),
    }
  }, clip)

const RESOURCE_DASH = '6px, 3px, 2px, 3px'
const STATE_DASH = '8px, 4px'
const RES = {
  coffee: ['e_green_in', 'e_green_wholesale', 'e_green_roast'],
  mmo: ['e_water_up', 'e_water_up_ct', 'e_food_up'],
} as const
const STATE_ACTIVE = ['a_end15', 'a_z3_xp_meter_lo'] // a_z3_xp_meter_lo: activator OFF → opacity 0.5 in light/dark

test.describe('§LGR9 forced-colors — active edge tell: Highlight + butt dashes, state edges included', () => {
  for (const [name, file] of [
    ['coffee', 'coffee-roastery.json'],
    ['mmo', 'mmo-progression.json'],
  ] as const) {
    test(`${name}: computed contract — active resource edges are Highlight ${RESOURCE_DASH} butt, no halo; inactive ones keep the plain solid grey`, async ({ page }) => {
      await loadFixture(page, file)
      const hl = await highlightRgb(page)
      // every edge path carries exactly one class marker and no inline dash / cap (they moved to CSS)
      const markers = await page.evaluate(() =>
        [...document.querySelectorAll('path.react-flow__edge-path')].map((p) => ({
          cls: Number(p.classList.contains('edge-resource')) + Number(p.classList.contains('edge-state')),
          inlineDash: (p as SVGPathElement).style.strokeDasharray,
          inlineCap: (p as SVGPathElement).style.strokeLinecap,
        })),
      )
      expect(markers.length).toBeGreaterThan(0)
      for (const m of markers) {
        expect(m.cls, 'exactly one of edge-resource / edge-state').toBe(1)
        expect(m.inlineDash, 'no inline stroke-dasharray').toBe('')
        expect(m.inlineCap, 'no inline stroke-linecap').toBe('')
      }
      // overlay OFF: plain strokes
      for (const id of RES[name]) {
        const s = await styleOf(page, id)
        expect(s.dash, `${id} off: solid`).toBe('none')
        expect(s.stroke, `${id} off: not the Highlight colour`).not.toBe(hl)
      }
      await activityBtn(page).click()
      await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
      await commitSteps(page, 10)
      for (const id of RES[name]) {
        await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/)
        const s = await styleOf(page, id)
        expect(s.stroke, `${id}: Highlight stroke`).toBe(hl)
        expect(s.dash, `${id}: dash-dot tell`).toBe(RESOURCE_DASH)
        expect(s.cap, `${id}: butt caps (round caps ate the gaps)`).toBe('butt')
        expect(s.filter, `${id}: no halo`).toBe('none')
        expect(s.vectorEffect, `${id}: dashes stay in screen px`).toBe('non-scaling-stroke')
        expect(s.width, `${id}: width unchanged`).toBe('1.5px')
      }
    })

    for (const zoom of [0.4, 0.75]) {
      test(`${name}: at zoom ${zoom} an active resource edge shows ≥ 6 dash pieces on an 80 px stretch where the plain edge is one piece`, async ({ page }) => {
        await loadFixture(page, file)
        await activityBtn(page).click()
        await commitSteps(page, 10)
        const results: { id: string; ok: boolean; why: string }[] = []
        for (const id of await longestActive(page, 'edge-resource', 6)) {
          if (results.filter((r) => r.ok).length >= 3) break
          await centreOn(page, id, zoom)
          // OFF reference (same viewport): the plain grey line
          await activityBtn(page).click()
          await page.waitForTimeout(150)
          const offPng = await page.screenshot()
          const pts = await pathPoints(page, id)
          // reach-2 for the plain stroke: a solid line must count as ONE piece however its anti-aliasing breaks
          const picked = await cleanStretch(page, offPng, pts, 0.15, 2)
          if (!picked) {
            // shorter than 80 screen px at this zoom — too few periods to count
            await activityBtn(page).click()
            await page.waitForTimeout(150)
            continue
          }
          const [a, b] = picked.stretch
          const off = picked.off
          await activityBtn(page).click()
          await page.waitForTimeout(150)
          const onPng = await page.screenshot()
          const on = await dashCount(page, onPng, pts, a, b, 0.2, 1)
          console.log(`[dash] ${name} ${id} z${zoom} resource: off comps ${off.runs} share ${off.inkShare.toFixed(2)} meanLen ${off.meanLen.toFixed(1)} | on comps ${on.runs} share ${on.inkShare.toFixed(2)} meanLen ${on.meanLen.toFixed(1)}`)
          const why: string[] = []
          if (!(off.inkShare > 0.15)) why.push('no clean plain stretch')
          if (!(off.runs <= 3)) why.push(`plain edge in ${off.runs} pieces`)
          // 6 3 2 3 butt on 80 px: two dashes per 14 px → ≥ 6 pieces, short, with less ink than the plain line
          if (!(on.runs >= 6)) why.push(`only ${on.runs} dash pieces`)
          if (!(on.meanLen <= 9)) why.push(`pieces too long (${on.meanLen.toFixed(1)} px)`)
          if (!(on.inkShare < off.inkShare * 0.9)) why.push('no ink removed')
          results.push({ id, ok: why.length === 0, why: why.join(', ') })
        }
        // at least two clean hits among the longest active edges: on a dense graph another ACTIVE
        // edge can run inside the ±2 px band of the one measured and fill its gaps with its own ink
        const ok = results.filter((r) => r.ok).length
        expect(results.length, `${name} z${zoom}: at least two edges long enough to count`).toBeGreaterThanOrEqual(2)
        expect(ok, `${name} z${zoom}: dash tell on at least 2 edges — ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(2)
      })
    }
  }

  test('mmo: active STATE edges get the 8 4 butt Highlight tell (the inline 4 4 no longer wins) and the activator-OFF one is opaque; inactive state edges keep 4 4 grey', async ({ page }) => {
    await loadFixture(page, 'mmo-progression.json')
    const hl = await highlightRgb(page)
    for (const id of STATE_ACTIVE) {
      const s = await styleOf(page, id)
      expect(s.dash, `${id} off: the plain state dash`).toBe('4px, 4px')
      expect(s.stroke).not.toBe(hl)
    }
    await activityBtn(page).click()
    await commitSteps(page, 10)
    for (const id of STATE_ACTIVE) {
      await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/)
      const s = await styleOf(page, id)
      expect(s.stroke, `${id}: Highlight`).toBe(hl)
      expect(s.dash, `${id}: state tell`).toBe(STATE_DASH)
      expect(s.cap).toBe('butt')
      expect(s.filter).toBe('none')
      // measured 2026-09-19: with the inline opacity 0.5 the painted tell was 2.0–2.6:1 vs
      // the canvas at zoom 0.4–0.75; opacity 1 raises it to 2.8–3.4 (0.4) / 7.3–7.6 (0.75)
      expect(s.opacity, `${id}: the forced tell is never faded`).toBe('1')
    }
    // an INACTIVE state edge keeps the plain grey 4 4 — every fixture state edge fires on step 1, so one
    // is injected; the contract must fail loudly if no inactive state edge exists, never skip
    await injectIdleStateEdge(page, 'e_water_up')
    await page.waitForTimeout(200)
    const inactive = await page.evaluate(() =>
      [...document.querySelectorAll('path.react-flow__edge-path.edge-state:not(.lgr-active-tint)')].map((p) => p.closest('.react-flow__edge')!.getAttribute('data-id')),
    )
    expect(inactive.length, 'at least one inactive state edge exists').toBeGreaterThanOrEqual(1)
    for (const id of inactive) {
      const s = await styleOf(page, id!)
      expect(s.stroke, `${id}: an inactive state edge is not Highlight`).not.toBe(hl)
      expect(s.dash, `${id}: an inactive state edge keeps 4 4`).toBe('4px, 4px')
      expect(s.cap).toBe('butt')
    }
  })

  test('mmo: at zoom 0.4 and 0.75 an active state edge is painted as dashes with real gaps (its 8 4 shape vs the plain 4 4 is pinned by computed style + the 0.75 baseline)', async ({ page }) => {
    await loadFixture(page, 'mmo-progression.json')
    await activityBtn(page).click()
    await commitSteps(page, 10)
    for (const zoom of [0.4, 0.75]) {
      for (const id of await longestActive(page, 'edge-state', 2)) {
        await centreOn(page, id, zoom)
        await activityBtn(page).click()
        await page.waitForTimeout(150)
        const offPng = await page.screenshot()
        const pts = await pathPoints(page, id)
        // a state edge is 1 px wide: a low presence threshold for the grey 4 4 (reach-2 for the plain
        // reference); the ON count uses plain 8-connectivity — fragmentation only raises the count
        // an activator-OFF state edge is painted at opacity 0.5 in the plain state → a very low presence threshold
        const picked = await cleanStretch(page, offPng, pts, 0.06, 2)
        expect(picked, `${id} z${zoom}: an 80 px stretch inside the pane`).not.toBeNull()
        const [a, b] = picked!.stretch
        const off = picked!.off
        await activityBtn(page).click()
        await page.waitForTimeout(150)
        const onPng = await page.screenshot()
        const on = await dashCount(page, onPng, pts, a, b, 0.2, 1)
        console.log(`[dash] mmo ${id} z${zoom} state: off comps ${off.runs} share ${off.inkShare.toFixed(2)} meanLen ${off.meanLen.toFixed(1)} | on comps ${on.runs} share ${on.inkShare.toFixed(2)} meanLen ${on.meanLen.toFixed(1)}`)
        // Pixels pin that the active state edge IS dashed with real gaps. The 8 4-vs-4 4 shape
        // difference is pinned by the computed dasharray (test above) and the mmo 0.75 element
        // baseline: a 1 px stroke, faded to 0.5 when its activator is off, does not yield a stable
        // pixel period at zoom 0.4 (measured 2026-09-19), so no ratio is asserted here.
        expect(on.runs, `${id} z${zoom}: the 8 4 tell is dashed`).toBeGreaterThanOrEqual(4)
        expect(on.inkShare, `${id} z${zoom}: gaps survive`).toBeLessThan(0.9)
        expect(on.inkShare, `${id} z${zoom}: the tell is painted`).toBeGreaterThan(0.05)
      }
    }
  })

  test('mmo fit view (≈ 0.255, observation only): the colour tell is present; the dash count is recorded, not gated', async ({ page }) => {
    await loadFixture(page, 'mmo-progression.json')
    const hl = await highlightRgb(page)
    await activityBtn(page).click()
    await commitSteps(page, 10)
    const zoom = await page.evaluate(() => (window as unknown as { __loop: { rf: { getViewport: () => { zoom: number } } } }).__loop.rf.getViewport().zoom)
    const id = RES.mmo[0]
    expect((await styleOf(page, id)).stroke).toBe(hl)
    await centreOn(page, id, zoom)
    const pts = await pathPoints(page, id)
    const png = await page.screenshot()
    const on = await dashCount(page, png, pts, 0, Math.min(100, pts.length), 0.3)
    console.log(`[observation] mmo fit zoom ${zoom.toFixed(3)}: active resource dash runs ${on.runs}, ink share ${on.inkShare.toFixed(2)} (colour tell only expected)`)
  })
})

test.describe('§LGR9 forced-colors — route-invalid keeps its priority and the ! flag under the activity overlay', () => {
  // A live ACTIVE edge (tinted) that is also route-invalid: the invalid tell wins — resource keeps the
  // `6 3` warning dash, a state edge keeps its `4 4`, neither takes the Highlight stroke or the active
  // pattern, the `!` flag stays. Both kinds, with `lgr-active-tint` proven present first.
  for (const [kind, pick, dash, cap] of [
    ['resource', 'edge-resource', '6px, 3px', 'round'],
    ['state', 'edge-state', '4px, 4px', 'butt'],
  ] as const) {
    test(`${kind}: an ACTIVE edge made route-invalid keeps the ${dash} dash, no Highlight, and its ! flag`, async ({ page }) => {
      await loadFixture(page, 'mmo-progression.json')
      const hl = await highlightRgb(page)
      await activityBtn(page).click()
      await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
      await commitSteps(page, 3)
      const [id] = await longestActive(page, pick, 1)
      expect(id, `an active ${kind} edge exists`).toBeTruthy()
      await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/)
      // sanity: while only active it carries the active tell
      expect((await styleOf(page, id)).stroke).toBe(hl)
      await makeRouteInvalid(page, id)
      await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/) // still active
      await expect(edgePath(page, id)).toHaveClass(/route-invalid/)
      await centreOn(page, id, 1) // the ! badge scales with the zoom; judge it at 1:1
      const flag = page.locator(`.react-flow__edge[data-id="${id}"] .route-invalid-flag`)
      await expect(flag).toHaveCount(1)
      await expect(flag).toBeVisible()
      expect((await flag.boundingBox())!.width).toBeGreaterThan(8)
      const on = await styleOf(page, id)
      expect(on.dash, `${kind}: the invalid dash wins over the active pattern`).toBe(dash)
      expect(on.cap, `${kind}: the class cap is kept`).toBe(cap)
      expect(on.stroke, `${kind}: no Highlight on an invalid edge (the ! flag is its tell)`).not.toBe(hl)
      expect(on.filter).toBe('none')
      // overlay OFF: the same invalid tell, so it is the overlay that must not change it
      await activityBtn(page).click()
      await page.waitForTimeout(150)
      const off = await styleOf(page, id)
      expect(off.dash).toBe(dash)
      expect(off.cap).toBe(cap)
      await expect(flag).toBeVisible()
    })
  }
})

test.describe('§LGR9 forced-colors — visual baselines (element policy)', () => {
  test('coffee 0.5: an active resource edge', async ({ page }) => {
    await loadFixture(page, 'coffee-roastery.json')
    await activityBtn(page).click()
    await commitSteps(page, 10)
    await centreOn(page, 'e_green_roast', 0.5)
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    const pane = (await page.locator('.react-flow').boundingBox())!
    const clip = { x: pane.x + pane.width / 2 - 160, y: pane.y + pane.height / 2 - 90, width: 320, height: 180 }
    // the subject is the active resource edge; node text is hidden (see hideNodeText) so the runner's
    // glyph rasterisation cannot move the capture — the frame label, node outlines, handles and every
    // edge stay
    await hideNodeText(page, clip)
    expect((await categoriesIn(page, clip)).activeResource, 'an active resource edge is inside the clip').toBe(true)
    await expect(page).toHaveScreenshot(...snap(page, 'forced-active-resource-coffee-z05', { clip }))
  })
  test('mmo 0.75: active resource, active state and inactive state edges in one frame', async ({ page }) => {
    await loadFixture(page, 'mmo-progression.json')
    await activityBtn(page).click()
    await commitSteps(page, 10)
    await injectIdleStateEdge(page, 'e_water_up')
    await page.waitForTimeout(200)
    await centreOn(page, 'e_water_up', 0.75)
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    const pane = (await page.locator('.react-flow').boundingBox())!
    const clip = { x: pane.x + pane.width / 2 - 200, y: pane.y + pane.height / 2 - 120, width: 400, height: 240 }
    // the subject is the edges: node text is hidden because the runner rasterises the zoomed
    // glyphs differently from a Windows 11 machine (CI on 7b1dd91: 509 px, all inside text rects,
    // 0 on any edge) and the element policy has no headroom for text noise
    await hideNodeText(page, clip)
    // every category the baseline claims to show must actually be inside the clip, after hiding
    expect(await categoriesIn(page, clip)).toEqual({ activeResource: true, activeState: true, inactiveState: true })
    await expect(page).toHaveScreenshot(...snap(page, 'forced-four-state-mmo-z075', { clip }))
  })
})

// ---------------------------------------------------------------------------
// §LGR9 — the INACTIVE edges (measured on REAL Windows contrast themes, 2026-09-20:
// the inline grey is not force-adjusted — 2.23:1 on Desert, 3.04 on Night sky only
// because prefers-dark flips the app tokens). Contract: an inactive resource / state
// edge and every route-invalid edge take the system `GrayText` (Desert 5.4:1, Night
// sky 8.6, emulation 14 — below Highlight in all three measured palettes, so the
// active tell kept the emphasis there); an inactive / invalid STATE edge is 1.5 px
// under forced colours only (a 1 px dash with the app's own colour measured ≈ 1.3:1
// in all three runs); a SELECTED edge keeps its
// 2 px; light / dark rendering is untouched.
// ---------------------------------------------------------------------------
const systemColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement('div')
    el.style.color = n
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

test.describe('§LGR9 forced-colors — inactive edges and route-invalid take the system GrayText', () => {
  test('mmo: inactive resource + inactive state = GrayText, inactive state 1.5 px, active edges still Highlight, a selected inactive state keeps its 2 px, the rest of the contract holds', async ({ page }) => {
    await loadFixture(page, 'mmo-progression.json')
    const hl = await highlightRgb(page)
    const gray = await systemColor(page, 'GrayText')
    expect(gray).not.toBe(hl)
    await activityBtn(page).click()
    await expect(activityBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await commitSteps(page, 3)
    const idle = await injectIdleStateEdge(page, 'e_water_up')
    await page.waitForTimeout(200)
    // inactive RESOURCE edges: GrayText, solid, round, 1.5 px, no halo
    const inactiveRes = await page.evaluate(() =>
      [...document.querySelectorAll('path.react-flow__edge-path.edge-resource:not(.lgr-active-tint):not(.route-invalid)')].map((p) => p.closest('.react-flow__edge')!.getAttribute('data-id')!),
    )
    expect(inactiveRes.length).toBeGreaterThanOrEqual(3)
    for (const id of inactiveRes.slice(0, 6)) {
      const s = await styleOf(page, id)
      expect(s.stroke, `${id}: inactive resource = GrayText`).toBe(gray)
      expect(s.dash).toBe('none')
      expect(s.cap).toBe('round')
      expect(s.width).toBe('1.5px')
      expect(s.filter).toBe('none')
      expect(s.vectorEffect).toBe('non-scaling-stroke')
    }
    // inactive STATE edge: GrayText, 4 4 butt, 1.5 px under forced colours, opaque
    const st = await styleOf(page, idle)
    expect(st.stroke, 'inactive state = GrayText').toBe(gray)
    expect(st.dash).toBe('4px, 4px')
    expect(st.cap).toBe('butt')
    expect(st.width, 'inactive state widened to 1.5 px (forced colours only)').toBe('1.5px')
    expect(st.opacity).toBe('1')
    expect(st.filter).toBe('none')
    // interaction path untouched
    expect(await page.locator(`.react-flow__edge[data-id="${idle}"] .react-flow__edge-interaction`).evaluate((el) => getComputedStyle(el).strokeWidth)).toBe('20px')
    // ACTIVE edges keep Highlight and their patterns
    const [ar] = await longestActive(page, 'edge-resource', 1)
    const [as] = await longestActive(page, 'edge-state', 1)
    const a1 = await styleOf(page, ar)
    expect(a1.stroke).toBe(hl)
    expect(a1.dash).toBe(RESOURCE_DASH)
    const a2 = await styleOf(page, as)
    expect(a2.stroke).toBe(hl)
    expect(a2.dash).toBe(STATE_DASH)
    expect(a2.opacity).toBe('1')
    // a SELECTED inactive state edge keeps the selection width (2 px inline)
    await page.evaluate((eid) => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { edges: { id: string }[] }; setState: (p: object) => void } } }).__loop.graph
      g.setState({ edges: g.getState().edges.map((e) => (e.id === eid ? { ...e, selected: true } : e)) })
    }, idle)
    await page.waitForTimeout(150)
    await expect(page.locator(`.react-flow__edge[data-id="${idle}"]`)).toHaveClass(/selected/)
    expect((await styleOf(page, idle)).width, 'selection width wins over the forced 1.5 px').toBe('2px')
  })

  for (const [kind, pick, dash, cap, width] of [
    ['resource', 'edge-resource', '6px, 3px', 'round', '1.5px'],
    ['state', 'edge-state', '4px, 4px', 'butt', '1.5px'],
  ] as const) {
    test(`${kind}: a route-invalid ACTIVE edge is GrayText (never Highlight), keeps ${dash} ${cap} and its ! flag; invalid state is 1.5 px`, async ({ page }) => {
      await loadFixture(page, 'mmo-progression.json')
      const hl = await highlightRgb(page)
      const gray = await systemColor(page, 'GrayText')
      await activityBtn(page).click()
      await commitSteps(page, 3)
      const [id] = await longestActive(page, pick, 1)
      expect((await styleOf(page, id)).stroke).toBe(hl)
      await makeRouteInvalid(page, id)
      await expect(edgePath(page, id)).toHaveClass(/lgr-active-tint/)
      await centreOn(page, id, 1)
      const s = await styleOf(page, id)
      expect(s.stroke, `${kind}: route-invalid = GrayText`).toBe(gray)
      expect(s.stroke).not.toBe(hl)
      expect(s.dash).toBe(dash)
      expect(s.cap).toBe(cap)
      expect(s.width, `${kind}: forced width`).toBe(width)
      expect(s.filter).toBe('none')
      const flag = page.locator(`.react-flow__edge[data-id="${id}"] .route-invalid-flag`)
      await expect(flag).toHaveCount(1)
      await expect(flag).toBeVisible()
      // overlay OFF: still GrayText + invalid tell
      await activityBtn(page).click()
      await page.waitForTimeout(150)
      const off = await styleOf(page, id)
      expect(off.stroke).toBe(gray)
      expect(off.dash).toBe(dash)
      expect(off.width).toBe(width)
    })
  }

  test.describe('outside forced colours (light and dark) nothing changes', () => {
    test.use({ contextOptions: { forcedColors: 'none' } })
    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: inactive edges keep the app tokens and the 1 px state width`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await loadFixture(page, 'mmo-progression.json')
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(false)
        const tokens = await page.evaluate(() => {
          const probe = (v: string) => {
            const el = document.createElement('div')
            el.style.color = v
            document.body.appendChild(el)
            const c = getComputedStyle(el).color
            el.remove()
            return c
          }
          return { resource: probe('var(--edge-resource)'), state: probe('var(--edge-state)') }
        })
        const idle = await injectIdleStateEdge(page, 'e_water_up')
        await page.waitForTimeout(200)
        const res = await page.evaluate(() => (document.querySelector('path.react-flow__edge-path.edge-resource') as Element).closest('.react-flow__edge')!.getAttribute('data-id')!)
        const r = await styleOf(page, res)
        expect(r.stroke, `${scheme}: resource stroke = --edge-resource`).toBe(tokens.resource)
        expect(r.width).toBe('1.5px')
        const st = await styleOf(page, idle)
        expect(st.stroke, `${scheme}: state stroke = --edge-state`).toBe(tokens.state)
        expect(st.width, `${scheme}: state width stays 1 px`).toBe('1px')
        expect(st.dash).toBe('4px, 4px')
      })
    }
  })
})
