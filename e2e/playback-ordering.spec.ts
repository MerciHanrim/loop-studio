import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback-ordering.md §PBO8 — the ordered cascade + role cues.
// Every ordering assertion keys on edge.id, never a rendered label, so the
// checks are locale-independent. The Korean Balanced production line screen is
// the human visual-review scene (§PBO11), not asserted here.

const BALANCED = readFileSync(new URL('../examples/equilibrium.json', import.meta.url), 'utf8')
const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')

const STAGGER_SPAN = 0.3

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as any).__loop.sim.getState()[f as string](...(a as unknown[])),
    [fn, args] as const,
  )

const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return {
      status: s.status,
      stepIndex: s.stepIndex,
      tau: s.transition?.tau ?? null,
      onsetByEdge: (s.transition?.onsetByEdge ?? null) as Record<string, number> | null,
      bucketCount: s.transition?.bucketCount ?? null,
      series: s.series.length,
    }
  })

function tokenXs(page: Page, edgeIds: string[]) {
  return page.evaluate((ids) => {
    const out: Record<string, number | null> = {}
    for (const id of ids) {
      const g = document.querySelector(
        `.react-flow__edge[data-id="${id}"] g.pb-move`,
      ) as SVGGElement | null
      const m = g && (g.getAttribute('transform') || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
      out[id] = m ? +m[1] : null
    }
    return out
  }, edgeIds)
}

async function setup(page: Page, json: string, speedMs = 2000) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await call(page, 'reset')
  await call(page, 'setSpeed', speedMs)
}

/** advance immediately to a steady step, Play, and capture the first in-flight
 *  transition's schedule once every expected edge id is present. */
async function scheduleAtPlay(page: Page, warmup: number, edgeIds: string[]) {
  for (let i = 0; i < warmup; i++) await call(page, 'advance')
  await call(page, 'play')
  await expect
    .poll(
      async () => {
        const s = await sim(page)
        return s.onsetByEdge && edgeIds.every((e) => e in s.onsetByEdge!) ? 1 : -1
      },
      { timeout: 8000 },
    )
    .toBe(1)
  const s = await sim(page)
  await call(page, 'pause')
  return s
}

test.describe('playback — ordered cascade & role cues', () => {
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: null, forcedColors: null }).catch(() => {})
  })

  test('§PBO8-1 Balanced line: onsets cascade by graph depth; the scrap branch departs with process', async ({
    page,
  }) => {
    await setup(page, BALANCED)
    const ids = ['tpl-e1', 'tpl-e2', 'tpl-e3', 'tpl-e4', 'tpl-e5', 'tpl-e6']
    const { onsetByEdge, bucketCount } = await scheduleAtPlay(page, 6, ids)
    const o = onsetByEdge!

    expect(o['tpl-e1']).toBe(0) // supply — Phase 1
    expect(o['tpl-e2']).toBeGreaterThan(o['tpl-e1']) // split
    expect(o['tpl-e3']).toBe(o['tpl-e2']) // process branch shares the split onset
    expect(o['tpl-e4']).toBe(o['tpl-e3']) // scrap branch departs WITH process
    expect(o['tpl-e5']).toBeGreaterThan(o['tpl-e3']) // converter → finished goods
    expect(o['tpl-e6']).toBeGreaterThan(o['tpl-e5']) // finished → shipment

    expect(Math.max(...(Object.values(o) as number[]))).toBeLessThanOrEqual(STAGGER_SPAN + 1e-6)
    expect(bucketCount).toBe(4)
  })

  test('§PBO8-2 MMO progression: a wide step stays inside the bounded window and one beat', async ({
    page,
  }) => {
    await setup(page, MMO, 1000)
    for (let i = 0; i < 4; i++) await call(page, 'advance')
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => (s.onsetByEdge ? 1 : -1)), { timeout: 8000 }).toBe(1)
    const s = await sim(page)
    expect(s.bucketCount!).toBeLessThanOrEqual(6)
    expect(Math.max(...(Object.values(s.onsetByEdge!) as number[]))).toBeLessThanOrEqual(
      STAGGER_SPAN + 1e-6,
    )
    // the step still commits — width does not stretch it past a beat
    await expect.poll(() => sim(page).then((x) => x.stepIndex), { timeout: 8000 }).toBeGreaterThan(4)
    await call(page, 'pause')
    const done = await sim(page)
    expect(done.series).toBe(done.stepIndex + 1) // exactly one settle per step
  })

  test('§PBO8-3 the stagger adds no second commit — one settle per step', async ({ page }) => {
    await setup(page, BALANCED, 800)
    await call(page, 'advance')
    await call(page, 'advance')
    await call(page, 'play')
    await expect
      .poll(() => sim(page).then((s) => s.stepIndex), { timeout: 15000 })
      .toBeGreaterThanOrEqual(5)
    await call(page, 'pause')
    const s = await sim(page)
    expect(s.series).toBe(s.stepIndex + 1)
  })

  test('§PBO8-4 Pause mid-stagger freezes every bucket; a late bucket has not started; Resume settles once', async ({
    page,
  }) => {
    await setup(page, BALANCED, 2600)
    for (let i = 0; i < 6; i++) await call(page, 'advance')
    await call(page, 'play')
    // an early bucket is travelling, but the last bucket (tpl-e6, onset = SPAN) has not
    await expect
      .poll(async () => {
        const s = await sim(page)
        return s.tau != null && s.tau > 0.16 && s.tau < 0.29 ? 1 : -1
      }, { timeout: 8000 })
      .toBe(1)
    await call(page, 'pause')
    const paused = await sim(page)
    const a = await tokenXs(page, ['tpl-e1', 'tpl-e3'])
    await page.waitForTimeout(500)
    const b = await tokenXs(page, ['tpl-e1', 'tpl-e3'])
    for (const k of Object.keys(a))
      expect(Math.abs((b[k] ?? 0) - (a[k] ?? 0)), `${k} frozen while paused`).toBeLessThan(1)
    // the deepest bucket's edge has no cue yet
    expect(
      await page
        .locator('.react-flow__edge[data-id="tpl-e6"] .pb-move, .react-flow__edge[data-id="tpl-e6"] .pb-cue')
        .count(),
    ).toBe(0)

    // Step finishes exactly the paused transition — every bucket completes, one settle
    await call(page, 'stepOnce')
    await expect.poll(() => sim(page).then((s) => s.tau), { timeout: 8000 }).toBeNull()
    const s = await sim(page)
    expect(s.stepIndex).toBe(paused.stepIndex + 1)
    expect(s.series).toBe(paused.series + 1) // one commit, not two
    expect(s.series).toBe(s.stepIndex + 1)
  })

  test('§PBO8-5 role cues — emit at the source, converge into a gate, absorb into a drain', async ({
    page,
  }) => {
    await setup(page, BALANCED, 2600)
    for (let i = 0; i < 6; i++) await call(page, 'advance')
    await call(page, 'play')

    const roles: Record<string, Set<string>> = {}
    let sawAbsorbMove = false
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => {
        const out: Record<string, string[]> = {}
        for (const el of document.querySelectorAll('.react-flow__edge .pb-cue[data-cue-role]')) {
          const id = el.closest('.react-flow__edge')?.getAttribute('data-id') ?? '?'
          ;(out[id] ??= []).push(el.getAttribute('data-cue-role')!)
        }
        return {
          out,
          absorbMove: !!document.querySelector(
            '.react-flow__edge[data-id="tpl-e6"] .pb-move--absorb',
          ),
          step: (window as any).__loop.sim.getState().stepIndex,
        }
      })
      for (const [id, rs] of Object.entries(snap.out)) {
        roles[id] ??= new Set()
        for (const r of rs) roles[id].add(r)
      }
      if (snap.absorbMove) sawAbsorbMove = true
      if (snap.step >= 8) break
      await page.waitForTimeout(20)
    }
    await call(page, 'pause')

    expect([...(roles['tpl-e2'] ?? [])].sort()).toEqual(['converge', 'emit']) // into the gate
    expect([...(roles['tpl-e6'] ?? [])].sort()).toEqual(['absorb', 'emit']) // into Shipment (drain)
    expect([...(roles['tpl-e4'] ?? [])]).toContain('absorb') // into Scrap (drain)
    expect(sawAbsorbMove).toBe(true) // the token dissolves into the drain
  })

  test('§PBO8-5 role difference survives forced-colors and reduced-motion', async ({ page }) => {
    await setup(page, BALANCED, 1600)

    await page.emulateMedia({ forcedColors: 'active' })
    for (let i = 0; i < 6; i++) await call(page, 'advance')
    await call(page, 'play')
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelectorAll('.react-flow__edge .pb-cue[data-cue-role]').length,
          ),
        { timeout: 8000 },
      )
      .toBeGreaterThan(0)
    await call(page, 'pause')
    await page.emulateMedia({ forcedColors: null })

    await call(page, 'reset')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (let i = 0; i < 8; i++) await call(page, 'advance')
    await call(page, 'play')
    await expect.poll(() => sim(page).then((s) => s.stepIndex), { timeout: 8000 }).toBeGreaterThan(7)
    await call(page, 'pause')
    await call(page, 'advance') // land a clean committed resting state (transition == null)
    const tells = await page.evaluate(() => ({
      emit: document.querySelectorAll('polygon.pb-rm-tell--emit').length,
      absorb: document.querySelectorAll('circle.pb-rm-tell--absorb').length,
      converge: document.querySelectorAll('circle.pb-rm-tell--converge').length,
    }))
    expect(tells.emit).toBeGreaterThan(0)
    expect(tells.absorb).toBeGreaterThan(0) // tpl-e4 / tpl-e6 into drains
    expect(tells.converge).toBeGreaterThan(0) // tpl-e2 / tpl-e5 elsewhere
    await page.emulateMedia({ reducedMotion: null })
  })

  test('§PBO8-6 deterministic — same graph + seed ⇒ identical onset schedule', async ({ page }) => {
    await setup(page, BALANCED, 2000)
    const grab = async () => {
      await call(page, 'reset')
      for (let i = 0; i < 6; i++) await call(page, 'advance')
      await call(page, 'play')
      await expect
        .poll(
          () =>
            sim(page).then((s) =>
              s.onsetByEdge && Object.keys(s.onsetByEdge).length >= 6 ? 1 : -1,
            ),
          { timeout: 8000 },
        )
        .toBe(1)
      const s = await sim(page)
      await call(page, 'pause')
      return s.onsetByEdge
    }
    const a = await grab()
    const b = await grab()
    expect(b).toEqual(a)
  })
})
