import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback-ordering.md §PBO8-7 — steady-state detection + the
// "Steady state — flows continue" chip. The detector's boundary cases (2 equal
// steps, a one-step stall, a stopped run, sub-ε vs supra-ε drift) are covered by
// the pure unit test `src/store/steadyState.test.ts`; this spec covers the
// store integration + the chip's UI contract (no layout shift, no control
// overlap, announce once, localised, reset triggers).

// Source ─4→ Pool ─all→ Drain : reaches a fixed point after the drain engages.
const STEADY_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'd', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 's', target: 'p', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '4' } },
    { id: 'e_pd', type: 'loop', source: 'p', target: 'd', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
  ],
})

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as any).__loop.sim.getState()[f as string](...(a as unknown[])),
    [fn, args] as const,
  )
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    return { status: s.status, stepIndex: s.stepIndex, steadyState: s.steadyState }
  })
const setLocale = (page: Page, code: string) =>
  page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)

async function advanceToSteady(page: Page, max = 12) {
  for (let i = 0; i < max; i++) {
    await call(page, 'advance')
    if ((await sim(page)).steadyState) return
  }
  throw new Error('never reached steady state')
}

async function setup(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, STEADY_GRAPH)
  await call(page, 'reset')
}

const chip = (page: Page) => page.locator('.pstrip__steady')
const chipShown = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.pstrip__steady') as HTMLElement | null
    return !!el && el.classList.contains('is-on') && getComputedStyle(el).visibility === 'visible'
  })

test.describe('playback — steady-state (§PBO8-7)', () => {
  test('reaches steady after ≥3 identical committed steps; not before', async ({ page }) => {
    await setup(page)
    expect((await sim(page)).steadyState).toBe(false)
    await call(page, 'advance')
    await call(page, 'advance')
    expect((await sim(page)).steadyState).toBe(false) // only 2 samples
    await advanceToSteady(page)
    expect((await sim(page)).steadyState).toBe(true)
  })

  test('the chip shows only while running & steady; Pause hides it, Resume shows it immediately', async ({
    page,
  }) => {
    await setup(page)
    await advanceToSteady(page) // steady, but status is 'paused' (advance path)
    expect(await chipShown(page)).toBe(false) // not running ⇒ hidden

    await call(page, 'play')
    await expect.poll(() => chipShown(page), { timeout: 4000 }).toBe(true)
    const steadyDuringPlay = (await sim(page)).steadyState

    await call(page, 'pause')
    expect(await chipShown(page)).toBe(false) // hidden on pause…
    expect((await sim(page)).steadyState).toBe(steadyDuringPlay) // …but the verdict is preserved

    await call(page, 'play')
    // reappears immediately — the render condition is `steadyState && running`,
    // it does not wait for the next commit
    await expect.poll(() => chipShown(page), { timeout: 2000 }).toBe(true)
    await call(page, 'pause')
  })

  test('screen reader is told once on entering steady, not every step', async ({ page }) => {
    await setup(page)
    const srText = () =>
      page.evaluate(
        () => document.querySelector('.pstrip [role="status"]')?.textContent?.trim() ?? '',
      )
    expect(await srText()).toBe('')
    await advanceToSteady(page)
    await call(page, 'play')
    await expect.poll(srText, { timeout: 4000 }).toBe('Steady state — flows continue')
    // several more committed steps — the text must not churn (aria-live re-announces on change)
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      seen.add(await srText())
      await page.waitForTimeout(120)
    }
    await call(page, 'pause')
    expect([...seen]).toEqual(['Steady state — flows continue'])
  })

  test('the chip never shifts a control or the strip height, and never overlaps a control', async ({
    page,
  }) => {
    await setup(page)

    const layout = () =>
      page.evaluate(() => {
        const strip = document.querySelector('.pstrip') as HTMLElement
        const rects: Record<string, DOMRect> = {}
        for (const sel of [
          '.pstrip__group',
          '.pstrip__step',
          '.pstrip__field',
          '.pstrip__mc',
          '.pstrip__collapse',
        ]) {
          const el = strip.querySelector(sel) as HTMLElement | null
          if (el) rects[sel] = el.getBoundingClientRect().toJSON()
        }
        return { stripH: strip.getBoundingClientRect().height, rects }
      })

    const before = await layout()
    await advanceToSteady(page)
    await call(page, 'play')
    await expect.poll(() => chipShown(page), { timeout: 4000 }).toBe(true)
    const during = await layout()

    // strip height unchanged, every control in the same place
    expect(during.stripH).toBeCloseTo(before.stripH, 0)
    for (const k of Object.keys(before.rects)) {
      expect(during.rects[k].left, `${k}.left`).toBeCloseTo(before.rects[k].left, 0)
      expect(during.rects[k].top, `${k}.top`).toBeCloseTo(before.rects[k].top, 0)
    }

    // and the chip's box does not intersect any control
    const overlap = await page.evaluate(() => {
      const strip = document.querySelector('.pstrip') as HTMLElement
      const chip = strip.querySelector('.pstrip__steady') as HTMLElement
      if (!chip.classList.contains('is-on')) return 'not-shown'
      const c = chip.getBoundingClientRect()
      const hits: string[] = []
      for (const sel of ['.pstrip__group', '.pstrip__step', '.pstrip__field', '.pstrip__mc', '.pstrip__collapse']) {
        for (const el of strip.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          if (c.left < r.right - 0.5 && c.right > r.left + 0.5 && c.top < r.bottom - 0.5 && c.bottom > r.top + 0.5)
            hits.push(sel)
        }
      }
      return hits.join(',') || 'clear'
    })
    expect(overlap).toBe('clear')
    await call(page, 'pause')
  })

  test('a narrow strip: the chip is hidden rather than overlapping controls', async ({ page }) => {
    await setup(page)
    // 860px keeps the DESKTOP strip (mobile query is max-width 720) but squeezes
    // the MC↔collapse gap so a full-width chip can no longer fit
    await page.setViewportSize({ width: 860, height: 800 })
    await advanceToSteady(page)
    await call(page, 'play')
    await page.waitForTimeout(300)
    const state = await page.evaluate(() => {
      const strip = document.querySelector('.pstrip') as HTMLElement | null
      if (!strip) return { on: false, overlap: 'no-strip' }
      const chip = strip.querySelector('.pstrip__steady') as HTMLElement
      const on = chip.classList.contains('is-on')
      if (!on) return { on, overlap: 'n/a' }
      const c = chip.getBoundingClientRect()
      let overlap = 'clear'
      for (const el of strip.querySelectorAll('.pstrip__group, .pstrip__step, .pstrip__field, .pstrip__mc, .pstrip__collapse')) {
        const r = el.getBoundingClientRect()
        if (c.left < r.right - 0.5 && c.right > r.left + 0.5 && c.top < r.bottom - 0.5 && c.bottom > r.top + 0.5)
          overlap = 'HIT'
      }
      return { on, overlap }
    })
    // either it fit with no overlap, or it correctly hid itself — never overlapping
    expect(state.overlap).not.toBe('HIT')
    await call(page, 'pause')
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('reset / seed change / a simulation-relevant graph edit each clear it', async ({ page }) => {
    await setup(page)

    await advanceToSteady(page)
    await call(page, 'reset')
    expect((await sim(page)).steadyState).toBe(false)

    await advanceToSteady(page)
    await call(page, 'setSeed', 99)
    expect((await sim(page)).steadyState).toBe(false)

    await advanceToSteady(page)
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      const e = g.edges.find((x: any) => x.id === 'e_sp')
      g.setEdgeData(e.id, { kind: 'resource', flow: '9' })
    })
    expect((await sim(page)).steadyState).toBe(false)
    expect((await sim(page)).stepIndex).toBe(0)
  })

  test('the label is localised (EN / KO / JA) and moves no digest / undo / autosave', async ({
    page,
  }) => {
    await setup(page)
    const inv = () =>
      page.evaluate(() => {
        const l = (window as any).__loop
        return {
          digest: l.revisionIO.currentTargetDigest(),
          canUndo: l.graph.getState().canUndo,
          canRedo: l.graph.getState().canRedo,
        }
      })
    const before = await inv()

    await advanceToSteady(page)
    await call(page, 'play')
    await expect.poll(() => chipShown(page), { timeout: 4000 }).toBe(true)

    for (const [code, text] of [
      ['en', 'Steady state — flows continue'],
      ['ko', '정상 상태 — 흐름은 계속됨'],
      ['ja', '定常状態 — フローは継続'],
    ] as const) {
      await setLocale(page, code)
      await expect(chip(page)).toHaveText(text)
    }
    await setLocale(page, 'en')
    await call(page, 'pause')

    expect(await inv()).toEqual(before) // steady-state detection touched nothing persistent
  })
})
