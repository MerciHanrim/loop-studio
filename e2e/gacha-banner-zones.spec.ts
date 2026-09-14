import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/gacha-banner-zones.md (GZ) — the 3-zone gacha banner comparison
// Template, exercised through the app. The engine-level acceptance (GZ8) is
// already exhaustively proven by src/engine/gacha-banner-zones.test.ts
// against the SAME graph builder this Template's canonical JSON is generated
// from (scripts/gen-gacha-banner-zones-example.ts) — this spec is a smoke
// test that the bundled Template actually opens, runs, and localizes
// correctly through the real UI, not a re-proof of GZ8's properties.
//
// GZ3.5 round 4: exactly ONE global `End`, gated by all three zones having
// actually produced `pulls_per_zone` results. Pulls occupy steps
// `2..pulls_per_zone+1`; the End's own AND-gate reads the PREVIOUS step's
// committed state, so it can only fire at `pulls_per_zone + 2` — one step
// after the last real pull, never earlier.

const DOC = JSON.parse(
  readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8'),
) as {
  nodes: { id: string }[]
  edges: { id: string }[]
  recommendedRunConfig: {
    baseSeed: number
    runs: number
    steps: number
    tracked: string[]
    timelineSeries: string[]
    canvasLocked: boolean
  }
}

const EN_NAME = '3-zone gacha banner comparison'
const KO_NAME = '3존 가챠 배너 비교'
const JA_NAME = '3ゾーン ガチャバナー比較'
const END_STEP = DOC.recommendedRunConfig.steps // pulls_per_zone + 2, GZ3.5 round 4
const PULL_HORIZON = END_STEP - 1 // pulls_per_zone + 1 — the last step any pull occurs

type Loop = Record<string, { getState: () => any }>

const graphCounts = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
    return { nodes: g.nodes.length, edges: g.edges.length, nodeIds: g.nodes.map((n: any) => n.id).sort() }
  })

const mcConfig = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __loop: Loop }).__loop.mc.getState().config }))

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

const templatesBtn = (page: Page) => page.locator('.toolbar__actions .menu').first().locator('> button')

async function pickDesktopTemplate(page: Page, name: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions .menu').first()
    .locator('.menu__pop [role="menuitem"]', { hasText: name })
    .click()
}

/** Step the live sim exactly `n` times (a fixed count, not "until ended" —
 *  lets a caller probe the exact step BEFORE the global End fires as easily
 *  as the step it fires on, GZ3.5 round 4) and return the terminal values.
 *  Caller must emulate reduced motion first so each `stepOnce()` settles
 *  synchronously (§PB9) — otherwise most of a tight-loop `n` calls are
 *  dropped mid-transition. */
const runExactSteps = (page: Page, seed: number, n: number) =>
  page.evaluate(
    ({ seed, n }) => {
      const sget = () => (window as unknown as { __loop: Loop }).__loop.sim.getState()
      sget().setSeed(seed)
      sget().reset()
      for (let i = 0; i < n; i++) sget().stepOnce()
      const st = sget()
      return { values: st.values as Record<string, number>, status: st.status, stepIndex: st.stepIndex }
    },
    { seed, n },
  )

test.describe('3-zone gacha banner comparison Template', () => {
  test('desktop: Templates ▾ loads the canonical graph + its recommended MC config, locked', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    const g = await graphCounts(page)
    expect(g.nodes).toBe(DOC.nodes.length)
    expect(g.edges).toBe(DOC.edges.length)
    expect(g.nodeIds).toEqual([...DOC.nodes.map((n) => n.id)].sort())

    const cfg = await mcConfig(page)
    expect({ baseSeed: cfg.baseSeed, runs: cfg.runs, steps: cfg.steps }).toEqual({
      baseSeed: DOC.recommendedRunConfig.baseSeed,
      runs: DOC.recommendedRunConfig.runs,
      steps: DOC.recommendedRunConfig.steps,
    })
    expect([...cfg.tracked].sort()).toEqual([...DOC.recommendedRunConfig.tracked].sort())

    const isLocked = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().canvasLocked)
    expect(isLocked).toBe(true)
    expect(DOC.recommendedRunConfig.canvasLocked).toBe(true)
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
  })

  test('menu order: Coffee, then MMO, then Gacha (Hanrim, 2026-09-13 reorder)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await templatesBtn(page).click()
    const names = await page
      .locator('.toolbar__actions .menu').first()
      .locator('.menu__pop [role="menuitem"] .menu__name')
      .allInnerTexts()
    const coffeeIdx = names.findIndex((n) => n.includes('Coffee roastery'))
    const mmoIdx = names.findIndex((n) => n.includes('Early MMO progression'))
    const gachaIdx = names.findIndex((n) => n === EN_NAME)
    expect(coffeeIdx).toBeGreaterThanOrEqual(0)
    expect(mmoIdx).toBeGreaterThan(coffeeIdx)
    expect(gachaIdx).toBeGreaterThan(mmoIdx)
  })

  test('runs exactly pulls_per_zone + 1 pull-steps, not yet ended: conserves per zone', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    await page.emulateMedia({ reducedMotion: 'reduce' }) // each Step settles synchronously

    const r = await runExactSteps(page, 1, PULL_HORIZON)
    // the End's AND-gate reads the PREVIOUS step's committed pulls_made, so
    // it cannot yet observe this step's own completion (GZ3.5 round 4).
    expect(r.status).not.toBe('ended')
    expect(r.stepIndex).toBe(PULL_HORIZON)

    for (const zone of ['free', 'standard', 'pickup']) {
      const ssr = r.values[`ssr_count_${zone}`] ?? 0
      const sr = r.values[`sr_count_${zone}`] ?? 0
      const rr = r.values[`r_count_${zone}`] ?? 0
      expect(ssr + sr + rr).toBe(r.values[`pulls_made_${zone}`])
      expect(r.values[`ticket_${zone}`]).toBe(0)
    }
    expect((r.values.pickup_count_pickup ?? 0) + (r.values.standard_count_pickup ?? 0)).toBe(
      r.values.ssr_count_pickup,
    )
  })

  test('ended becomes true at exactly pulls_per_zone + 2; Play auto-stops there; no further step changes anything', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const r = await runExactSteps(page, 1, END_STEP)
    expect(r.status).toBe('ended')
    expect(r.stepIndex).toBe(END_STEP)
    const pullsPerZone = END_STEP - 2 // GZ3.5 round 4: End's horizon is pulls_per_zone + 2
    for (const zone of ['free', 'standard', 'pickup']) {
      // the End firing moves no zone resource — pulls_made is UNCHANGED from
      // the pull horizon (pulls_per_zone + 1), still exactly pulls_per_zone.
      expect(r.values[`pulls_made_${zone}`]).toBe(pullsPerZone)
    }

    // stepping further (manually) changes nothing — the store's own
    // beginTransition() short-circuits once status is 'ended'.
    const after = await page.evaluate(() => {
      const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
      s.stepOnce()
      s.stepOnce()
      return { values: s.values as Record<string, number>, status: s.status, stepIndex: s.stepIndex }
    })
    expect(after.status).toBe('ended')
    expect(after.stepIndex).toBe(END_STEP) // stepOnce() was a no-op past ended
    expect(after.values).toEqual(r.values)

    // Play auto-stops at the same point, through the real UI control — not
    // just the direct stepOnce() calls above. Crank the beat speed WAY up
    // (bypassing the UI slider's own 120ms floor, purely for test speed —
    // reduced motion alone doesn't change how often Play triggers the next
    // beat) so `END_STEP` beats settle in a few seconds, not minutes.
    await page.evaluate((seed) => {
      const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
      s.setSpeed(20)
      s.setSeed(seed)
      s.reset()
      s.play()
    }, 1)
    // `status` is `'idle' | 'running' | 'paused' | 'ended'` — polling for
    // 'ended' here already proves Play stopped itself (mutually exclusive
    // with 'running'), not merely that it will eventually get there.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().status), {
        timeout: 20_000,
      })
      .toBe('ended')
    const played = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().stepIndex)
    expect(played).toBe(END_STEP)

    // give the (now-stopped) Play loop a beat to prove it stays stopped,
    // rather than ticking again right after the poll observed 'ended'.
    await page.waitForTimeout(300)
    const stillEnded = await page.evaluate(() => {
      const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
      return { status: s.status, stepIndex: s.stepIndex }
    })
    expect(stillEnded.status).toBe('ended')
    expect(stillEnded.stepIndex).toBe(END_STEP)
  })

  test('Monte Carlo completes, reports every tracked Pool, and every run ends at exactly pulls_per_zone + 2', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    await page.evaluate(() => {
      const m = (window as unknown as { __loop: Loop }).__loop.mc.getState()
      return m.run() as Promise<void>
    })
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.mc.getState().status),
        { timeout: 20_000 },
      )
      .toBe('done')

    const result = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.mc.getState().result)
    expect(result.droppedTracked).toEqual([])
    expect([...result.pools.map((p: { id: string }) => p.id)].sort()).toEqual(
      [...DOC.recommendedRunConfig.tracked].sort(),
    )
    expect(result.completedRuns).toBe(DOC.recommendedRunConfig.runs)
    // GZ3.5 round 4 — `endedRuns.atOrBeforeStep[t]` is the CUMULATIVE count
    // of runs ended at-or-before step `t` (length steps+1, monotone
    // non-decreasing). Every run reaches the global End at EXACTLY
    // pulls_per_zone + 2, no seed early or late: the cumulative count is 0
    // for every step before that, and jumps straight to every run at that
    // exact step.
    const cum: number[] = result.endedRuns.atOrBeforeStep
    for (let t = 0; t < cum.length; t++) {
      expect(cum[t]).toBe(t < END_STEP ? 0 : DOC.recommendedRunConfig.runs)
    }
  })

  test('KO: the menu item and node labels localize', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await pickDesktopTemplate(page, KO_NAME)

    const label = await page.evaluate(
      () =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .nodes.find((n: any) => n.id === 'zone3_pickup_hard_pity').data.label,
    )
    // Parameter labels DO carry a zone tag (unlike every other node kind) —
    // the flat Inputs panel has no frame context to fall back on.
    expect(label).toBe('프리미엄 픽업 · 하드 천장')
  })

  test('no node overlaps: 1280×720 fit-all, 1600×900 fit-all, or any zone at its own 100% zoom', async ({ page }) => {
    // Node-spacing review (Hanrim, 2026-09-13): the vertical zone stack made
    // fit-to-view illegible, and the Pickup zone had real ~20px node-pair
    // overlaps at its old column width. This is a DOM-geometry regression
    // guard, not a pixel-perfect layout snapshot — it fails the instant any
    // future layout change lets two nodes' drawn boxes intersect, at either
    // of the two reviewed viewports or at any zone's own 100% zoom.
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    type Rect = { id: string; x: number; y: number; w: number; h: number }
    const nodeRects = (): Promise<Rect[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect()
          return { id: el.getAttribute('data-id')!, x: r.x, y: r.y, w: r.width, h: r.height }
        }),
      )

    function assertNoOverlaps(rects: Rect[]) {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]
          const b = rects[j]
          const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
          expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false)
        }
      }
    }

    const fitAll = () =>
      page.evaluate(() => (window as unknown as { __loop: { rf: { fitView: (o: object) => void } } }).__loop.rf.fitView({ padding: 0.05, duration: 0 }))

    await page.setViewportSize({ width: 1280, height: 720 })
    await fitAll()
    assertNoOverlaps(await nodeRects())

    await page.setViewportSize({ width: 1600, height: 900 })
    await fitAll()
    assertNoOverlaps(await nodeRects())

    const frames = await page.evaluate(
      () =>
        (window as unknown as { __loop: { frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } } } })
          .__loop.frame.getState().frames,
    )
    for (const zoneFrameId of ['zone_free', 'zone_standard', 'zone_pickup']) {
      const frame = frames.find((f) => f.id === zoneFrameId)!
      const cx = frame.rect.x + frame.rect.w / 2
      const cy = frame.rect.y + frame.rect.h / 2
      await page.evaluate(
        ({ cx, cy }) => {
          const rf = (window as unknown as { __loop: { rf: { setViewport: (v: object) => void } } }).__loop.rf
          rf.setViewport({ x: window.innerWidth / 2 - cx, y: window.innerHeight / 2 - cy, zoom: 1 })
        },
        { cx, cy },
      )
      assertNoOverlaps(await nodeRects())
    }
  })

  test('edge condition labels never leak an internal @id, in EN/KO/JA', async ({ page }) => {
    // Connector-readability review (Hanrim/Lumi, 2026-09-14, after PR #205): a
    // resource-flow `@id` or an activator RHS `@id` (loop-model/2) used to
    // render as the literal internal id on canvas (e.g. `@zone2_standard_w_sr`,
    // `< @zone2_standard_hard_pity - 1`) — never shown to the user per
    // docs/data-import.md §DI9's own principle for a DIFFERENT internal id,
    // equally true here. `LoopEdge.tsx` now projects it to the referenced
    // Parameter's own current (localized) label.
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    await page.setViewportSize({ width: 1600, height: 900 })

    const labelTexts = (): Promise<{ id: string; text: string }[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-edge-id]')).map((el) => ({
          id: el.getAttribute('data-edge-id')!,
          text: (el.textContent || '').trim(),
        })),
      )

    for (const locale of ['en', 'ko', 'ja'] as const) {
      await setLocale(page, locale)
      for (const { id, text } of await labelTexts()) {
        expect(text, `${locale}: edge ${id} leaks an internal id ("${text}")`).not.toMatch(/@/)
      }
    }
  })

  test('the hard-pity activator condition labels are visually distinct, in EN/KO/JA (Premium Standard + Premium Pickup)', async ({
    page,
  }) => {
    // Connector-readability review (Hanrim/Lumi, 2026-09-14, after PR #205):
    // the pity/guarantee activator edges fanning out of one control node
    // (`pity_standard` / `pity_pickup`) had their bezier-midpoint labels
    // overlapping each other, illegible at the zoom level the screenshots
    // used. Fixed by routing every edge `orthogonal`
    // (scripts/gen-gacha-banner-zones-example.ts, layout round 5), a cosmetic
    // routing choice, never an engine change — this is a regression guard on
    // exactly the labels that were reported overlapping, not a general
    // every-edge-in-the-zone claim (a dense zone's many edges can still share
    // a screen region without any two LABELS actually touching).
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)
    await page.setViewportSize({ width: 1600, height: 900 })

    type Rect = { id: string; text: string; x: number; y: number; w: number; h: number }
    const labelRectsById = (ids: string[]): Promise<Rect[]> =>
      page.evaluate(
        (ids) =>
          ids.map((id) => {
            const el = document.querySelector(`[data-edge-id="${id}"]`)!
            const r = (el as HTMLElement).getBoundingClientRect()
            return { id, text: (el.textContent || '').trim(), x: r.x, y: r.y, w: r.width, h: r.height }
          }),
        ids,
      )

    function assertNoOverlaps(rects: Rect[]) {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]
          const b = rects[j]
          const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
          expect(overlaps, `edge label ${a.id} ("${a.text}") overlaps ${b.id} ("${b.text}")`).toBe(false)
        }
      }
    }

    const frames = await page.evaluate(
      () =>
        (window as unknown as { __loop: { frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } } } })
          .__loop.frame.getState().frames,
    )

    // the exact edges the original screenshots showed overlapping.
    const HARD_PITY_EDGES: Record<'zone_standard' | 'zone_pickup', string[]> = {
      zone_standard: ['e_standard_12', 'e_standard_13'],
      zone_pickup: ['e_pickup_6', 'e_pickup_8', 'e_pickup_10', 'e_pickup_12'],
    }

    for (const locale of ['en', 'ko', 'ja'] as const) {
      await setLocale(page, locale)
      for (const zoneFrameId of ['zone_standard', 'zone_pickup'] as const) {
        const frame = frames.find((f) => f.id === zoneFrameId)!
        const cx = frame.rect.x + frame.rect.w / 2
        const cy = frame.rect.y + frame.rect.h / 2
        await page.evaluate(
          ({ cx, cy }) => {
            const rf = (window as unknown as { __loop: { rf: { setViewport: (v: object) => void } } }).__loop.rf
            rf.setViewport({ x: window.innerWidth / 2 - cx, y: window.innerHeight / 2 - cy, zoom: 1 })
          },
          { cx, cy },
        )
        const rects = await labelRectsById(HARD_PITY_EDGES[zoneFrameId])
        for (const r of rects) {
          expect(r.text, `${locale} ${zoneFrameId}: edge ${r.id} leaks an internal id ("${r.text}")`).not.toMatch(/@/)
        }
        assertNoOverlaps(rects)
      }
    }
  })

  test('comparison frame fully contains every comparison-row node, in EN/KO/JA, at both reviewed viewports', async ({
    page,
  }) => {
    // Comparison-frame review (Hanrim, 2026-09-13): the frame's right edge
    // used to cut through the last card because bbox() assumed a generic
    // node footprint too small for the wide comparison Registers. This pins
    // full containment (not just zero pairwise overlap, which the test above
    // already covers) directly — the frame's own rect (graph coords) must
    // enclose every comparison-row node's rendered box (screen coords),
    // converted through the SAME viewport transform React Flow uses.
    await openApp(page)
    await resetAll(page)
    await pickDesktopTemplate(page, EN_NAME)

    type LoopWindow = {
      __loop: {
        rf: { fitView: (o: object) => void; getViewport: () => { x: number; y: number; zoom: number } }
        frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } }
        i18n: { getState: () => { setLocale: (c: string) => void } }
      }
    }

    const checkContainment = () =>
      page.evaluate(() => {
        const w = window as unknown as LoopWindow
        const vp = w.__loop.rf.getViewport()
        // `getViewport()` is relative to the `.react-flow` PANE's own
        // top-left origin, but `getBoundingClientRect()` (used below) is
        // relative to the whole page — the pane itself sits below the
        // toolbar, so converting a graph coordinate to a page coordinate
        // needs the pane's own on-page offset added, not just the viewport
        // transform.
        const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
        const frame = w.__loop.frame.getState().frames.find((f) => f.id === 'zone_comparison')!
        const frameLeft = pane.left + vp.x + frame.rect.x * vp.zoom
        const frameTop = pane.top + vp.y + frame.rect.y * vp.zoom
        const frameRight = pane.left + vp.x + (frame.rect.x + frame.rect.w) * vp.zoom
        const frameBottom = pane.top + vp.y + (frame.rect.y + frame.rect.h) * vp.zoom
        const cardIds = [
          'pulls_per_zone',
          'cmp1_hit_rate_free',
          'cmp2_hit_rate_standard',
          'cmp3_hit_rate_pickup',
          'cmp4_pickup_rate_pickup',
          'termination_fuel',
          'all_zones_done',
        ]
        return cardIds.map((id) => {
          const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
          const r = el!.getBoundingClientRect()
          const TOL = 0.5 // sub-pixel float slack, not a real margin
          return {
            id,
            containedX: r.left >= frameLeft - TOL && r.right <= frameRight + TOL,
            containedY: r.top >= frameTop - TOL && r.bottom <= frameBottom + TOL,
          }
        })
      })

    const assertAllContained = async () => {
      const results = await checkContainment()
      for (const r of results) {
        expect(r.containedX, `${r.id} escapes the comparison frame horizontally`).toBe(true)
        expect(r.containedY, `${r.id} escapes the comparison frame vertically`).toBe(true)
      }
    }

    const fitAll = () =>
      page.evaluate(() => (window as unknown as LoopWindow).__loop.rf.fitView({ padding: 0.05, duration: 0 }))

    // `fitView()` reads the pane's CURRENT size, which only updates a beat
    // after `setViewportSize()` (a ResizeObserver tick) — without a settle
    // wait, the store's `getViewport()` (what `checkContainment` uses to
    // convert the frame's graph rect to screen coords) can be read before it
    // matches the DOM's actual composed transform, comparing two different
    // moments in time against each other. A fixed-point re-check (call
    // fitView, read the viewport twice, only proceed once two reads agree)
    // is more robust than a guessed timeout.
    const fitAllSettled = async () => {
      let last: { x: number; y: number; zoom: number } | null = null
      for (let i = 0; i < 10; i++) {
        await fitAll()
        const vp = await page.evaluate(() => (window as unknown as LoopWindow).__loop.rf.getViewport())
        if (last && last.x === vp.x && last.y === vp.y && last.zoom === vp.zoom) return
        last = vp
        await page.waitForTimeout(100)
      }
    }

    for (const locale of ['en', 'ko', 'ja']) {
      await page.evaluate((c) => (window as unknown as LoopWindow).__loop.i18n.getState().setLocale(c), locale)
      for (const size of [
        { width: 1280, height: 720 },
        { width: 1600, height: 900 },
      ]) {
        await page.setViewportSize(size)
        await fitAllSettled()
        await assertAllContained()
      }
    }
  })

  test('JA: the menu item and node labels localize', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')
    await pickDesktopTemplate(page, JA_NAME)

    const label = await page.evaluate(
      () =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .nodes.find((n: any) => n.id === 'pickup_hit_pickup').data.label,
    )
    expect(label).toBe('ピックアップ的中') // no zone suffix — the frame title gives that context
  })
})
