import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// fix/timeline-rolling-domain — the Timeline series keeps only the last
// MAX_SERIES (400) steps, but the X axis used to map `step / maxStep`, i.e.
// from 0. Once the head was trimmed the plot started a fraction of the way in
// and looked like it was shrinking toward the right. The axis must run from the
// EARLIEST retained step to the latest, so the first retained point is always
// at the plot's left edge and the newest is always at the right edge.

const MAX_SERIES = 400
const PAD = { l: 40, r: 20 } // must match TimelineChart.tsx

// two pools that accumulate forever (no drain) so values keep climbing and the
// run can be driven well past MAX_SERIES
const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'sA', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'A tap', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pA', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'Pool A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'sB', type: 'source', position: { x: 0, y: 160 }, data: { kind: 'source', label: 'B tap', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pB', type: 'pool', position: { x: 220, y: 160 }, data: { kind: 'pool', label: 'Pool B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'eA', type: 'loop', source: 'sA', target: 'pA', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
    { id: 'eB', type: 'loop', source: 'sB', target: 'pB', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
  ],
})

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string } } }

const advance = (page: Page, n: number) =>
  page.evaluate((k) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) sim.advance()
  }, n)

const digest = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.revisionIO.currentTargetDigest())

/** first + last plotted point of the first pool line, and the plot width */
function lineEnds(page: Page, nth = 0) {
  return page.evaluate((i) => {
    const svg = document.querySelector('.timeline__svg') as SVGSVGElement | null
    const path = document.querySelectorAll('.timeline__line:not(.timeline__line--register)')[i] as SVGPathElement | null
    if (!svg || !path) return null
    const w = Number(svg.getAttribute('viewBox')!.split(' ')[2])
    const pts = [...(path.getAttribute('d') || '').matchAll(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }))
    return { w, first: pts[0] ?? null, last: pts[pts.length - 1] ?? null, count: pts.length }
  }, nth)
}

const stepTicks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.timeline__svg .timeline__tick')]
      .map((t) => t.textContent?.trim() ?? '')
      .filter((s) => s.startsWith('step ')),
  )

async function setup(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
  await expect(page.locator('.timeline__legend').first()).toBeVisible()
}

test.describe('Timeline — rolling X domain', () => {
  test('before the retention cap the axis runs from step 0 across the full width', async ({ page }) => {
    await setup(page)
    await advance(page, 20)
    await expect.poll(() => lineEnds(page).then((e) => e?.count ?? 0)).toBeGreaterThan(10)
    const e = (await lineEnds(page))!
    expect(e.first!.x).toBeCloseTo(PAD.l, 0) // step 0 at the left edge
    expect(e.last!.x).toBeCloseTo(e.w - PAD.r, 0) // step 20 at the right edge
    // no left "step N" tick while the head has not been trimmed
    expect(await stepTicks(page)).toEqual(['step 20'])
  })

  test('past the cap the first RETAINED step is at the left edge, not a fraction in', async ({ page }) => {
    await setup(page)
    await advance(page, MAX_SERIES + 130) // ~step 530; ~130 head steps dropped
    const e = (await lineEnds(page))!
    expect(e.first!.x).toBeCloseTo(PAD.l, 0) // NOT ~0.25·width
    expect(e.last!.x).toBeCloseTo(e.w - PAD.r, 0)
    expect(e.count).toBeLessThanOrEqual(MAX_SERIES)
    // the axis labels name the real visible interval (≈131 … 530), not 0 … 530
    const ticks = await stepTicks(page)
    expect(ticks.length).toBe(2)
    const [lo, hi] = ticks.map((t) => Number(t.replace('step ', '')))
    expect(lo).toBeGreaterThan(0)
    expect(hi - lo).toBe(MAX_SERIES - 1)
  })

  test('one more step past the cap drops exactly one head point and keeps the full width', async ({ page }) => {
    await setup(page)
    await advance(page, MAX_SERIES + 90)
    const before = (await lineEnds(page))!
    const ticksBefore = (await stepTicks(page)).map((t) => Number(t.replace('step ', '')))
    await advance(page, 1)
    const after = (await lineEnds(page))!
    const ticksAfter = (await stepTicks(page)).map((t) => Number(t.replace('step ', '')))
    expect(after.count).toBe(before.count) // still MAX_SERIES points
    expect(after.first!.x).toBeCloseTo(PAD.l, 0)
    expect(after.last!.x).toBeCloseTo(after.w - PAD.r, 0)
    expect(ticksAfter[0]).toBe(ticksBefore[0] + 1) // window slid by one real step
    expect(ticksAfter[1]).toBe(ticksBefore[1] + 1)
  })

  test('every series is plotted against the same real-step domain', async ({ page }) => {
    await setup(page)
    await advance(page, MAX_SERIES + 60)
    const a = (await lineEnds(page, 0))!
    const b = (await lineEnds(page, 1))!
    expect(b.first!.x).toBeCloseTo(a.first!.x, 1) // both lines share step-domain endpoints
    expect(b.last!.x).toBeCloseTo(a.last!.x, 1)
    expect(b.count).toBe(a.count)
  })

  test('pausing mid-run freezes the plotted coordinates', async ({ page }) => {
    await setup(page)
    await advance(page, MAX_SERIES + 30) // roll the window first
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.setSpeed(60)
      s.play()
    })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex))
      .toBeGreaterThan(MAX_SERIES + 34)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
    const d1 = await page.evaluate(() => document.querySelector('.timeline__line:not(.timeline__line--register)')?.getAttribute('d'))
    const t1 = await stepTicks(page)
    await page.waitForTimeout(500)
    const d2 = await page.evaluate(() => document.querySelector('.timeline__line:not(.timeline__line--register)')?.getAttribute('d'))
    expect(d2).toBe(d1)
    expect(await stepTicks(page)).toEqual(t1)
  })

  test('Reset returns the axis to step 0', async ({ page }) => {
    await setup(page)
    await advance(page, MAX_SERIES + 50)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await advance(page, 6)
    const e = (await lineEnds(page))!
    expect(e.first!.x).toBeCloseTo(PAD.l, 0)
    expect(await stepTicks(page)).toEqual(['step 6'])
  })

  test('the rolling domain moves no GraphDoc / revision digest / undo state', async ({ page }) => {
    await setup(page)
    const d0 = await digest(page)
    const undo0 = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return [g.canUndo, g.canRedo]
    })
    await advance(page, MAX_SERIES + 200)
    expect(await digest(page)).toBe(d0)
    expect(
      await page.evaluate(() => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        return [g.canUndo, g.canRedo]
      }),
    ).toEqual(undo0)
  })
})

// Register series after the window rolls: the dashed R(t) lines map onto the
// SAME rolled step-domain as the pool lines, and the invalid-step gaps are
// still not bridged. (Gap-splitting itself — `registerSeriesRuns` — is a pure
// function of the per-step outcomes, unit-tested in
// src/model/model/observe.test.ts; it is unaffected by the X-domain change.)
const REG_FIXTURE = readFileSync(new URL('../examples/model-verification.json', import.meta.url), 'utf8')

test.describe('Timeline — rolling X domain, Register lines', () => {
  test('R(t) lines render on the rolled domain; a still-invalid register draws nothing (never a bridged line)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, REG_FIXTURE)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await expect(page.locator('.timeline__legend').first()).toBeVisible()
    await advance(page, MAX_SERIES + 120) // ~step 520; window ≈ 121 … 520

    const info = await page.evaluate(() => {
      const svg = document.querySelector('.timeline__svg') as SVGSVGElement
      const w = Number(svg.getAttribute('viewBox')!.split(' ')[2])
      const reg = [...document.querySelectorAll('.timeline__line--register')].map((p) => {
        const d = p.getAttribute('d') || ''
        const xs = [...d.matchAll(/[ML]\s*([-\d.]+)/g)].map((m) => +m[1])
        return { runs: (d.match(/M/g) || []).length, minX: xs.length ? Math.min(...xs) : null, maxX: xs.length ? Math.max(...xs) : null }
      })
      const pool = document.querySelector('.timeline__line:not(.timeline__line--register)') as SVGPathElement | null
      const px = [...((pool?.getAttribute('d') || '').matchAll(/[ML]\s*([-\d.]+)/g))].map((m) => +m[1])
      return { w, reg, poolMin: Math.min(...px), poolMax: Math.max(...px) }
    })

    const regKeys = await page.locator('.timeline__key--register').count()
    const drawn = info.reg.filter((r) => r.runs > 0)
    expect(drawn.length).toBeGreaterThan(0) // ≥ 1 always-valid R(t) line renders
    expect(drawn.length).toBeLessThan(regKeys) // ≥ 1 always-invalid register (r_loop) draws NOTHING — never a bridged line
    for (const r of drawn) {
      expect(r.minX!).toBeCloseTo(info.poolMin, 0) // same rolled step-domain as the pool lines
      expect(r.maxX!).toBeLessThanOrEqual(info.w - PAD.r + 1)
      expect(r.minX!).toBeGreaterThanOrEqual(PAD.l - 1)
    }
  })
})
