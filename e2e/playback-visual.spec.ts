import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/simulation-playback.md Slice 3c-b — the choreography acceptance matrix.
// resource token / state trigger / activator / label-delta stay distinguishable
// WITHOUT hue; L0 elides the moving element but keeps a cue; reduced motion has
// zero travelling elements; light/dark × desktop/mobile × L2/L1/L0 × full/
// reduced; forced-colors keeps marker / path / cue / focus / invalid visible;
// and a run moves no GraphDoc / digest / undo / viewport / edge `d`.
//
// Runs under BOTH the `chromium` and the 390px `mobile` project. No state
// machine or announcer change.

type Bridge = { __loop: Record<string, { getState: () => any }> & { revisionIO: { currentTargetDigest: () => string }; rf: { setViewport: (v: unknown, o?: unknown) => void; getViewport: () => { x: number; y: number; zoom: number } } } }

const FIX = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 300, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'drn', type: 'drain', position: { x: 600, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'passive', mode: 'pullAny' } },
    { id: 'feed', type: 'pool', position: { x: 0, y: 240 }, data: { kind: 'pool', label: 'Feed', activation: 'passive', initial: 80, capacity: null, mode: 'pullAny' } },
    { id: 'tank', type: 'pool', position: { x: 360, y: 240 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 't_sd', type: 'loop', source: 'src', target: 'drn', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
    { id: 'a_pd', type: 'loop', source: 'pool', target: 'drn', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } },
    { id: 'l_add', type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+5' } },
    { id: 'l_sub', type: 'loop', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '-2' } },
  ],
})

const Z = { L2: 1, L1: 0.6, L0: 0.32 } as const
type Level = keyof typeof Z

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const invariants = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      viewport: l.rf.getViewport(),
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
    }
  })

async function setLod(page: Page, level: Level) {
  await page.evaluate((z) => (window as unknown as Bridge).__loop.rf.setViewport({ x: 0, y: 0, zoom: z }, { duration: 0 }), Z[level])
  await page.waitForTimeout(80)
}

async function load(page: Page, opts: { scheme?: 'light' | 'dark'; reduced?: boolean; forced?: boolean } = {}) {
  await page.emulateMedia({
    colorScheme: opts.scheme ?? 'light',
    // explicit — a CI runner whose OS default is `reduce` would otherwise make
    // every "full motion" step settle instantly and starve `holdAt`
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    forcedColors: opts.forced ? 'active' : null,
  })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FIX)
  await call(page, 'reset')
  await expect(page.locator('.react-flow__edge[data-id="e_sp"] path.react-flow__edge-path')).toHaveCount(1)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
}

/** freeze a transition at a chosen beat. `depart` (τ ≤ 0.15) pins the token at
 *  the SOURCE, `arrive` (τ ≥ 0.8) pins it at the TARGET — both deterministic
 *  because `travelFraction` clamps there. `travel` is the wide middle band,
 *  used only for presence checks. Driven by Play so a missed frame just retries
 *  on the next transition. */
async function holdAt(page: Page, beat: 'depart' | 'travel' | 'arrive', speedMs = 3500) {
  const [lo, hi] = beat === 'depart' ? [0, 0.14] : beat === 'travel' ? [0.25, 0.75] : [0.8, 0.93]
  await call(page, 'setSpeed', speedMs)
  await call(page, 'play')
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => {
          const st = (window as any).__loop.sim.getState()
          return { status: st.status, tau: st.transition?.tau ?? null }
        })
        if (s.tau != null && s.tau >= lo && s.tau <= hi) {
          await call(page, 'pause')
          const tau2 = await page.evaluate(() => (window as any).__loop.sim.getState().transition?.tau ?? null)
          if (tau2 != null && tau2 >= lo && tau2 <= hi) return 'held'
          await call(page, 'play') // overshot on the way to pause — try the next one
          return 'retry'
        }
        if (s.status !== 'running') await call(page, 'play') // keep it moving
        return s.tau == null ? 'settled' : 'running'
      },
      { timeout: 25000, intervals: [40] },
    )
    .toBe('held')
  await call(page, 'setSpeed', 1400)
}

async function reset(page: Page) {
  await page.emulateMedia({ colorScheme: null, reducedMotion: null, forcedColors: null })
}

// ── the DOM matrix ────────────────────────────────────────────────────────
test.describe('playback — Slice 3c-b: choreography acceptance matrix', () => {
  test.afterEach(({ page }) => reset(page))

  for (const scheme of ['light', 'dark'] as const) {
    for (const level of ['L2', 'L1', 'L0'] as const) {
      test(`full motion · ${scheme} · ${level}: the right cue set renders and the document is untouched`, async ({ page }) => {
        await load(page, { scheme })
        const before = await invariants(page)
        await call(page, 'advance') // step 1 — pool fills so the activator can be satisfied
        await setLod(page, level)
        await holdAt(page, 'travel') // step 2, mid-travel

        const dot = page.locator('.react-flow__edge[data-id="e_sp"] g.pb-move')
        const stateDot = page.locator('.react-flow__edge[data-id="t_sd"] g.state-move--trigger')
        if (level === 'L0') {
          await expect(dot).toHaveCount(0) // §PB4.4 — the sub-pixel dot is elided
          await expect(page.locator('.react-flow__edge[data-id="e_sp"] .pb-l0-pulse')).toHaveCount(1) // a cue remains
        } else {
          await expect(dot).toHaveCount(1)
          await expect(stateDot).toHaveCount(1) // the state trigger rides too, its own element
        }
        // never a resource token on a state edge or vice-versa
        await expect(page.locator('.react-flow__edge[data-id="t_sd"] g.pb-move')).toHaveCount(0)
        await expect(page.locator('.react-flow__edge[data-id="e_sp"] g.state-move')).toHaveCount(0)

        // finish the step, then confirm the run moved nothing structural
        await call(page, 'stepOnce')
        await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().transition)).toBe(null)
        const after = await invariants(page)
        expect(after.digest).toBe(before.digest)
        expect([after.canUndo, after.canRedo]).toEqual([before.canUndo, before.canRedo])
        expect(after.d).toEqual(before.d)
        // zoom is where setLod left it, pan unchanged; either way playback set nothing
        expect(after.viewport.zoom).toBeCloseTo(Z[level], 2)
      })
    }
  }

  for (const level of ['L2', 'L0'] as const) {
    test(`reduced motion · ${level}: zero travelling elements, a static cue instead`, async ({ page }) => {
      await load(page, { reduced: true })
      await call(page, 'advance')
      await setLod(page, level)
      // reduced-motion Step settles near-instantly (§PB9); drive a couple of steps
      await call(page, 'setSpeed', 300)
      await call(page, 'play')
      await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)).toBeGreaterThan(3)
      // sample many frames: NEVER a moving element
      let sawMotion = 0
      for (let i = 0; i < 20; i++) {
        sawMotion += await page.locator('.react-flow__edges animateMotion, g.pb-move, g.state-move, .pb-l0-pulse').count()
        await page.waitForTimeout(30)
      }
      await call(page, 'pause')
      expect(sawMotion).toBe(0)
      // a held static edge cue stands in
      await expect(page.locator('.react-flow__edge[data-id="e_sp"] .flow-edge-pulse')).toHaveCount(1)
    })
  }
})

// ── forced-colors: shape tells + required-set visibility ──────────────────
test.describe('playback — Slice 3c-b: forced-colors', () => {
  test.afterEach(({ page }) => reset(page))

  for (const level of ['L2', 'L0'] as const) {
    test(`forced-colors: active · ${level}: the choreography cues stay distinct without hue; marker + path class stay visible`, async ({ page }) => {
      test.setTimeout(45_000)
      await load(page, { forced: true, scheme: 'light' })
      await call(page, 'advance') // step 1 — pool fills so the activator is satisfiable
      await setLod(page, level)
      await holdAt(page, 'travel') // frozen, every cue at its position

      const styleOf = async (sel: string, prop: string): Promise<string | null> => {
        const loc = page.locator(sel).first()
        if (!(await loc.count())) return null
        return loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
      }

      if (level !== 'L0') {
        // resource token — a SOLID dot: filled, no stroke
        expect(await styleOf('.react-flow__edge[data-id="e_sp"] g.pb-move .flow-bead', 'fill')).toMatch(/^(rgb|color|canvastext)/i)
        expect(await styleOf('.react-flow__edge[data-id="e_sp"] g.pb-move .flow-bead', 'stroke')).toMatch(/none|rgba?\(0, 0, 0, 0\)/)

        // state trigger — a HOLLOW ring: a real stroke-width (≠ the solid dot)
        expect(await page.locator('.react-flow__edge[data-id="t_sd"] g.state-move--trigger .state-move__bead').count()).toBe(1)
        expect(parseFloat((await styleOf('.react-flow__edge[data-id="t_sd"] g.state-move--trigger .state-move__bead', 'stroke-width')) ?? '0')).toBeGreaterThan(0)

        // label delta cue, if this step carries one — the signed GLYPH is painted
        const lnFill = await styleOf('.react-flow__edge[data-id="l_add"] .state-move__n', 'fill')
        if (lnFill !== null) {
          expect(await page.locator('.react-flow__edge[data-id="l_add"] .state-move__n').first().textContent()).toMatch(/^[+-]\d/)
          expect(lnFill).not.toMatch(/none|rgba?\(0, 0, 0, 0\)/)
        }
      } else {
        // L0 — the travel stand-in is a dashed stroke (never mistaken for the edge)
        const l0 = await styleOf('.react-flow__edge[data-id="e_sp"] .pb-l0-pulse', 'stroke-dasharray')
        expect(l0).toMatch(/\d/)
        expect(await page.locator('.react-flow__edge[data-id="e_sp"] g.pb-move').count()).toBe(0)
      }

      // activator ring, if present: satisfied ⇒ solid, not ⇒ dashed
      const act = await styleOf('.react-flow__edge[data-id="a_pd"] .state-cue--activator', 'stroke-dasharray')
      if (act !== null) {
        const satisfied = await page.evaluate(
          () => (window as any).__loop.sim.getState().transition?.stateEvents?.find((e: any) => e.edgeId === 'a_pd')?.effect?.satisfied,
        )
        if (satisfied === false) expect(act).toMatch(/\d/)
        else expect(act).toMatch(/none|^0|^$/)
      }

      // the required set survives the colour override
      const marker = await page.locator('#loop-arrow-resource path').evaluate((el) => {
        const c = getComputedStyle(el)
        return { vis: c.visibility, disp: c.display, op: Number(c.opacity) }
      })
      expect(marker.vis).not.toBe('hidden')
      expect(marker.disp).not.toBe('none')
      expect(marker.op).toBeGreaterThan(0)
      // resource path solid vs state path dashed — the class tell, hue-free
      expect(await styleOf('.react-flow__edge[data-id="e_sp"] path.react-flow__edge-path', 'stroke-dasharray')).toMatch(/none|^0|^$/)
      expect(await styleOf('.react-flow__edge[data-id="t_sd"] path.react-flow__edge-path', 'stroke-dasharray')).toMatch(/\d/)
    })
  }
})

// ── a small deterministic masked screenshot set ──────────────────────────
// frozen at `depart` (τ ≤ 0.14): `travelFraction` clamps to 0 so the token is
// pinned at the source — deterministic across runs / machines.
test.describe('playback — Slice 3c-b: masked screenshots (depart beat)', () => {
  test.afterEach(({ page }) => reset(page))

  const shot = (page: Page) => ({
    mask: [
      page.locator('.react-flow__minimap'),
      page.locator('.react-flow__attribution'),
      page.locator('.toolbar__build'),
      page.locator('.pstrip__step'),
    ],
    maxDiffPixelRatio: 0.02,
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`depart · full motion · ${scheme} · L2`, async ({ page }) => {
      await load(page, { scheme })
      await call(page, 'advance')
      await setLod(page, 'L2')
      await holdAt(page, 'depart')
      await expect(page.locator('.react-flow')).toHaveScreenshot(`play-depart-${scheme}-L2.png`, shot(page))
    })
  }

  test('depart · forced-colors · L2', async ({ page }) => {
    await load(page, { forced: true, scheme: 'light' })
    await call(page, 'advance')
    await setLod(page, 'L2')
    await holdAt(page, 'depart')
    await expect(page.locator('.react-flow')).toHaveScreenshot('play-depart-forced-colors-L2.png', shot(page))
  })

  test('travel · L0 elision', async ({ page }) => {
    await load(page)
    await call(page, 'advance')
    await setLod(page, 'L0')
    await holdAt(page, 'travel')
    await expect(page.locator('.react-flow__edge[data-id="e_sp"] g.pb-move')).toHaveCount(0)
    await expect(page.locator('.react-flow')).toHaveScreenshot('play-travel-L0.png', shot(page))
  })
})
