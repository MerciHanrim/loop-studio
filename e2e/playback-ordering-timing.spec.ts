import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback-ordering.md §PBO9-2 — real-time verification of the
// staggered cascade: the departure order is legible, the last bucket is not a
// sub-frame flash despite its `(τ − 0.30) / 0.65` compression, no two tokens
// read as one continuous object, and a wide graph adds no per-frame cost.

const BALANCED = readFileSync(new URL('../examples/equilibrium.json', import.meta.url), 'utf8')
const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as any).__loop.sim.getState()[f as string](...(a as unknown[])),
    [fn, args] as const,
  )

/** Poll the DOM every rAF for `ms`, recording per edge the first wall-clock time
 *  it shows an `emit` cue, enters `travel`, and shows an arrive cue; also the
 *  peak `.pb-move` count and rAF frame count seen. */
async function traceCascade(page: Page, ms: number, ids: string[]) {
  return page.evaluate(
    ([budget, edgeIds]) => {
      const first: Record<string, { emit?: number; travel?: number; arrive?: number }> = {}
      for (const id of edgeIds) first[id] = {}
      let peakTokens = 0
      let frames = 0
      const t0 = performance.now()
      return new Promise<{
        first: typeof first
        peakTokens: number
        frames: number
        elapsed: number
      }>((resolve) => {
        const tick = () => {
          frames++
          const now = performance.now() - t0
          peakTokens = Math.max(peakTokens, document.querySelectorAll('g.pb-move').length)
          for (const id of edgeIds) {
            const edge = document.querySelector(`.react-flow__edge[data-id="${id}"]`)
            if (!edge) continue
            const rec = first[id]
            if (rec.emit == null && edge.querySelector('.pb-cue[data-cue-role="emit"]'))
              rec.emit = now
            const ph = edge.querySelector('g.pb-move')?.getAttribute('data-playback-phase')
            if (rec.travel == null && ph === 'travel') rec.travel = now
            if (
              rec.arrive == null &&
              edge.querySelector('.pb-cue[data-cue-role="converge"], .pb-cue[data-cue-role="absorb"]')
            )
              rec.arrive = now
          }
          if (performance.now() - t0 < budget) requestAnimationFrame(tick)
          else resolve({ first, peakTokens, frames, elapsed: performance.now() - t0 })
        }
        requestAnimationFrame(tick)
      })
    },
    [ms, ids] as const,
  )
}

async function setup(page: Page, json: string) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await call(page, 'reset')
  for (let i = 0; i < 6; i++) await call(page, 'advance') // steady state
}

test.describe('playback ordering — real-time cascade timing (PR 2)', () => {
  const IDS = ['tpl-e1', 'tpl-e2', 'tpl-e3', 'tpl-e4', 'tpl-e5', 'tpl-e6']

  for (const speedMs of [2400, 900, 250]) {
    test(`beat ${speedMs}ms — ordered emit, last bucket is not a sub-frame flash`, async ({
      page,
    }) => {
      await setup(page, BALANCED)
      await call(page, 'setSpeed', speedMs)
      await call(page, 'play')
      const { first } = await traceCascade(page, speedMs * 1.3, IDS)
      await call(page, 'pause')

      const emit = (id: string) => first[id].emit ?? Infinity
      const travelMs = (id: string) => (first[id].arrive ?? 0) - (first[id].emit ?? 0)
      const report = {
        speedMs,
        emitMs: Object.fromEntries(IDS.map((id) => [id, Math.round(first[id].emit ?? -1)])),
        gap_b0_b1: Math.round(emit('tpl-e2') - emit('tpl-e1')),
        gap_b1_b2: Math.round(emit('tpl-e5') - emit('tpl-e2')),
        gap_b2_b3: Math.round(emit('tpl-e6') - emit('tpl-e5')),
        firstBucketTravelMs: Math.round(travelMs('tpl-e1')),
        lastBucketTravelMs: Math.round(travelMs('tpl-e6')),
      }
      console.log('CASCADE TIMING', JSON.stringify(report))

      // departure order is strict: bucket 0 < bucket 1 < bucket 2 < bucket 3
      expect(emit('tpl-e1')).toBeLessThan(emit('tpl-e2'))
      expect(Math.max(emit('tpl-e2'), emit('tpl-e3'), emit('tpl-e4'))).toBeLessThan(emit('tpl-e5'))
      expect(emit('tpl-e5')).toBeLessThan(emit('tpl-e6'))
      // same-bucket branches (process + scrap) emit within a frame
      expect(Math.abs(emit('tpl-e3') - emit('tpl-e4'))).toBeLessThan(40)
      // the last bucket's emit→arrive is a real span, not a sub-frame flash,
      // and the (τ−0.30)/0.65 compression keeps it ≥ ~60% of the first bucket
      const floor = speedMs >= 2400 ? 550 : speedMs >= 900 ? 180 : 40
      expect(report.lastBucketTravelMs).toBeGreaterThan(floor)
      expect(report.lastBucketTravelMs / report.firstBucketTravelMs).toBeGreaterThan(0.55)
    })
  }

  test('no two tokens read as one continuous object (no baton pass)', async ({ page }) => {
    await setup(page, BALANCED)
    await call(page, 'setSpeed', 2400)
    await call(page, 'play')
    // over the whole beat, sample every token's (edgeId, path fraction). A
    // "baton pass" = an upstream token at frac ≈ 1 and its downstream token at
    // frac ≈ 0 at the SAME instant on adjacent edges.
    const adjacency: Record<string, string> = {
      'tpl-e1': 'tpl-e2',
      'tpl-e2': 'tpl-e3',
      'tpl-e3': 'tpl-e5',
      'tpl-e5': 'tpl-e6',
    }
    const worst = await page.evaluate((adj) => {
      const t0 = performance.now()
      let handoff = 0
      return new Promise<number>((resolve) => {
        const frac = (id: string): number | null => {
          const edge = document.querySelector(`.react-flow__edge[data-id="${id}"]`)
          const g = edge?.querySelector('g.pb-move') as SVGGElement | null
          const vis = edge?.querySelector('path.react-flow__edge-path') as SVGPathElement | null
          if (!g || !vis) return null
          const m = (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
          if (!m) return null
          const pt = { x: +m[1], y: +m[2] }
          const total = vis.getTotalLength()
          let best = Infinity
          let bestF = 0
          for (let i = 0; i <= 100; i++) {
            const p = vis.getPointAtLength((i / 100) * total)
            const d = Math.hypot(p.x - pt.x, p.y - pt.y)
            if (d < best) {
              best = d
              bestF = i / 100
            }
          }
          return bestF
        }
        const tick = () => {
          for (const [up, down] of Object.entries(adj)) {
            const fu = frac(up)
            const fd = frac(down)
            if (fu != null && fd != null && fu > 0.88 && fd < 0.12) handoff++
          }
          if (performance.now() - t0 < 2600) requestAnimationFrame(tick)
          else resolve(handoff)
        }
        requestAnimationFrame(tick)
      })
    }, adjacency)
    await call(page, 'pause')
    // the downstream token departs long before the upstream arrives — the two
    // are never simultaneously at "just left" / "just arriving" on adjacent edges
    expect(worst).toBe(0)
  })

  test('MMO — a wide step adds no per-frame graph work and does not stretch the beat', async ({
    page,
  }) => {
    await setup(page, MMO)
    await call(page, 'setSpeed', 1200)
    const beforeComputes = await page.evaluate(
      () => (window as any).__staggerComputes ?? 0,
    )
    await call(page, 'play')
    const ids = await page.evaluate(() =>
      (window as any).__loop.graph.getState().edges.slice(0, 8).map((e: any) => e.id),
    )
    const t0 = Date.now()
    const { peakTokens, frames, elapsed } = await traceCascade(page, 1500, ids)
    await call(page, 'pause')
    const afterComputes = await page.evaluate(() => (window as any).__staggerComputes ?? 0)

    // one schedule computation per transition, not per frame
    const stepsRun = await page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)
    expect(afterComputes - beforeComputes).toBeLessThanOrEqual(stepsRun + 2)
    // the render kept up (rAF actually ticked through the window)
    expect(frames).toBeGreaterThan(elapsed / 40) // ≥ ~25fps effective
    // the global 60-token budget still caps concurrent travelling elements
    expect(peakTokens).toBeLessThanOrEqual(60)
    void t0
  })
})
